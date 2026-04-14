"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  estimateTokenCountFromText,
  useDiagnosticsActions,
} from "@/context/diagnostics-context";
import { usePdf } from "@/context/pdf-context";
import { useLectureStream } from "@/hooks/use-lecture-stream";
import { useSettings } from "@/context/settings-context";
import {
  TAKEAWAY_EXTRACTOR_PROMPT,
  buildEmptyTakeaway,
  type SlideTakeaway,
} from "@/lib/lecture-prompts";

const TAKEAWAY_RETRY_ATTEMPTS = 3;
const TAKEAWAY_RETRY_BASE_DELAY_MS = 300;
const MAPPING_COMPLETION_HANDOFF_MS = 300;

type GenerationMode = "single" | "full" | null;
type QueuePhase = "mapping" | "streaming";

interface QueueProgress {
  phase: QueuePhase;
  current: number;
  total: number;
}

interface GenerationContextEntry {
  lectureMarkdown: string;
  memoryUpdate: string;
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && /abort/i.test(error.message)) {
    return true;
  }
  return false;
}

function createAbortError() {
  const abortError = new Error("Generation aborted.");
  abortError.name = "AbortError";
  return abortError;
}

function sortTakeaways(takeaways: SlideTakeaway[]) {
  return [...takeaways].sort((a, b) => a.slide_number - b.slide_number);
}

function nowMs() {
  if (typeof performance !== "undefined") {
    return performance.now();
  }
  return Date.now();
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithRetry<T>(options: {
  signal: AbortSignal;
  operation: (attempt: number) => Promise<T>;
  maxAttempts?: number;
  baseDelayMs?: number;
}) {
  const maxAttempts = options.maxAttempts ?? TAKEAWAY_RETRY_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? TAKEAWAY_RETRY_BASE_DELAY_MS;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    if (options.signal.aborted) {
      throw createAbortError();
    }

    try {
      return await options.operation(attempt + 1);
    } catch (error) {
      if (options.signal.aborted || isAbortError(error)) {
        throw createAbortError();
      }

      lastError = error;
      attempt += 1;
      if (attempt >= maxAttempts) {
        break;
      }

      await sleep(baseDelayMs * 2 ** (attempt - 1), options.signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Request failed after retries.");
}

async function processWithConcurrency<T>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  if (!items.length) {
    return;
  }

  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length));
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

export function usePageGeneration() {
  const { streamLecture, extractTakeaway } = useLectureStream();
  const { beginSlide, recordChunk, finishSlide, recordBackgroundUsage } =
    useDiagnosticsActions();
  const { settings } = useSettings();
  const { documentData, pageGenerations, updatePageGeneration } = usePdf();

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(null);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [queueProgress, setQueueProgress] = useState<QueueProgress | null>(null);

  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const isGeneratingRef = useRef(false);
  const generationContextRef = useRef<Record<number, GenerationContextEntry>>({});
  const resolvedTakeawaysRef = useRef<Record<number, SlideTakeaway>>({});
  const extractionPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    generationContextRef.current = Object.fromEntries(
      Object.entries(pageGenerations).map(([page, generation]) => [
        Number(page),
        {
          lectureMarkdown: generation.lectureMarkdown,
          memoryUpdate: generation.memoryUpdate,
        },
      ]),
    );

    resolvedTakeawaysRef.current = Object.fromEntries(
      Object.entries(pageGenerations)
        .map(([page, generation]) => ({
          pageNumber: Number(page),
          takeaway: generation.takeaway,
        }))
        .filter(
          (entry): entry is { pageNumber: number; takeaway: SlideTakeaway } =>
            Number.isFinite(entry.pageNumber) && Boolean(entry.takeaway),
        )
        .map((entry) => [entry.pageNumber, entry.takeaway]),
    );
  }, [pageGenerations]);

  useEffect(() => {
    return () => {
      generationAbortControllerRef.current?.abort();
    };
  }, []);

  const registerTakeaway = useCallback(
    (takeaway: SlideTakeaway) => {
      resolvedTakeawaysRef.current[takeaway.slide_number] = takeaway;
      updatePageGeneration(takeaway.slide_number, (current) => ({
        ...current,
        takeaway,
      }));
    },
    [updatePageGeneration],
  );

  const getAvailableTakeawaysSnapshot = useCallback(
    () => sortTakeaways(Object.values(resolvedTakeawaysRef.current)),
    [],
  );

  const beginGenerationSession = useCallback((mode: Exclude<GenerationMode, null>) => {
    isGeneratingRef.current = true;
    setIsGenerating(true);
    setGenerationMode(mode);
    setQueueProgress(null);
    setActivePage(null);
  }, []);

  const endGenerationSession = useCallback(() => {
    isGeneratingRef.current = false;
    generationAbortControllerRef.current = null;
    extractionPromiseRef.current = null;
    setIsGenerating(false);
    setGenerationMode(null);
    setQueueProgress(null);
    setActivePage(null);
  }, []);

  const extractTakeawayForSlide = useCallback(
    async (
      page: { pageNumber: number; imageDataUrl: string },
      signal: AbortSignal,
    ) => {
      const promptTokenEstimate = estimateTokenCountFromText(
        [
          TAKEAWAY_EXTRACTOR_PROMPT,
          documentData?.title || "",
          `Slide ${page.pageNumber}`,
          settings.outputLanguage,
        ].join("\n"),
      );

      return fetchWithRetry({
        signal,
        maxAttempts: TAKEAWAY_RETRY_ATTEMPTS,
        baseDelayMs: TAKEAWAY_RETRY_BASE_DELAY_MS,
        operation: async () => {
          const startedAtMs = nowMs();
          try {
            const takeaway = await extractTakeaway({
              request: {
                pageNumber: page.pageNumber,
                imageDataUrl: page.imageDataUrl,
                pdfTitle: documentData?.title || "",
                outputLanguage: settings.outputLanguage,
              },
              provider: {
                provider: settings.providerType,
                apiKey: settings.apiKey,
                baseUrl: settings.baseUrl,
                model: settings.modelName,
              },
              signal,
            });

            registerTakeaway(takeaway);
            recordBackgroundUsage({
              kind: "takeaway",
              pageNumber: page.pageNumber,
              promptTokens: promptTokenEstimate,
              outputTokens: estimateTokenCountFromText(JSON.stringify(takeaway)),
              durationMs: Math.max(1, nowMs() - startedAtMs),
              success: true,
            });
            return takeaway;
          } catch (error) {
            recordBackgroundUsage({
              kind: "takeaway",
              pageNumber: page.pageNumber,
              promptTokens: promptTokenEstimate,
              outputTokens: 0,
              durationMs: Math.max(1, nowMs() - startedAtMs),
              success: false,
            });
            throw error;
          }
        },
      });
    },
    [
      documentData?.title,
      extractTakeaway,
      recordBackgroundUsage,
      registerTakeaway,
      settings.apiKey,
      settings.baseUrl,
      settings.modelName,
      settings.outputLanguage,
      settings.providerType,
    ],
  );

  const extractAllTakeaways = useCallback(
    async (
      pages: Array<{ pageNumber: number; imageDataUrl: string }>,
      signal: AbortSignal,
      options?: { reportProgress?: boolean },
    ) => {
      const totalSlides = pages.length;
      if (!totalSlides) {
        return;
      }

      const preResolvedCount = pages.reduce(
        (count, page) =>
          count + (resolvedTakeawaysRef.current[page.pageNumber] ? 1 : 0),
        0,
      );
      const unresolvedPages = pages.filter(
        (page) => !resolvedTakeawaysRef.current[page.pageNumber],
      );

      if (options?.reportProgress) {
        setQueueProgress({
          phase: "mapping",
          current: preResolvedCount,
          total: totalSlides,
        });
      }

      if (!unresolvedPages.length) {
        return;
      }

      let completed = preResolvedCount;

      await processWithConcurrency(
        unresolvedPages,
        settings.maxConcurrentRequests,
        async (page) => {
          try {
            await extractTakeawayForSlide(page, signal);
          } catch (error) {
            if (signal.aborted || isAbortError(error)) {
              throw createAbortError();
            }
            registerTakeaway(buildEmptyTakeaway(page.pageNumber));
          } finally {
            completed += 1;
            if (options?.reportProgress) {
              setQueueProgress({
                phase: "mapping",
                current: completed,
                total: totalSlides,
              });
            }
          }
        },
      );
    },
    [extractTakeawayForSlide, registerTakeaway, settings.maxConcurrentRequests],
  );

  const runSinglePageGeneration = useCallback(
    async (
      pageNumber: number,
      signal: AbortSignal,
      availableTakeaways: SlideTakeaway[],
    ) => {
      if (!documentData) {
        return;
      }

      const page = documentData.pages.find((item) => item.pageNumber === pageNumber);
      if (!page) {
        return;
      }

      const previousPageMarkdown =
        generationContextRef.current[pageNumber - 1]?.lectureMarkdown || "";

      const contextPayload = [
        documentData.title,
        JSON.stringify(availableTakeaways),
        previousPageMarkdown,
      ]
        .filter(Boolean)
        .join("\n");

      beginSlide({
        pageNumber,
        contextTokens: estimateTokenCountFromText(contextPayload),
      });

      generationContextRef.current[pageNumber] = {
        lectureMarkdown: "",
        memoryUpdate: "",
      };

      updatePageGeneration(pageNumber, (current) => ({
        ...current,
        lectureMarkdown: "",
        memoryUpdate: "",
        isGenerating: true,
        status: "pending_streaming",
        error: null,
      }));

      try {
        await streamLecture({
          request: {
            pageNumber,
            totalSlides: documentData.totalPages,
            imageDataUrl: page.imageDataUrl,
            pdfTitle: documentData.title,
            takeaways: availableTakeaways,
            previousPageMarkdown,
            outputLanguage: settings.outputLanguage,
            customPrompt: settings.customPrompt,
          },
          provider: {
            provider: settings.providerType,
            apiKey: settings.apiKey,
            baseUrl: settings.baseUrl,
            model: settings.modelName,
          },
          signal,
          onLectureChunk: (chunk) => {
            recordChunk({ pageNumber, chunk });
            generationContextRef.current[pageNumber] = {
              ...generationContextRef.current[pageNumber],
              lectureMarkdown:
                `${generationContextRef.current[pageNumber]?.lectureMarkdown || ""}${chunk}`,
            };
            updatePageGeneration(pageNumber, (current) => ({
              ...current,
              lectureMarkdown: `${current.lectureMarkdown}${chunk}`,
              status: "pending_streaming",
            }));
          },
          onMemoryChunk: (chunk) => {
            recordChunk({ pageNumber, chunk });
            generationContextRef.current[pageNumber] = {
              ...generationContextRef.current[pageNumber],
              memoryUpdate:
                `${generationContextRef.current[pageNumber]?.memoryUpdate || ""}${chunk}`,
            };
            updatePageGeneration(pageNumber, (current) => ({
              ...current,
              memoryUpdate: `${current.memoryUpdate}${chunk}`,
            }));
          },
        });

        generationContextRef.current[pageNumber] = {
          ...generationContextRef.current[pageNumber],
          memoryUpdate:
            generationContextRef.current[pageNumber]?.memoryUpdate.trim() || "",
        };

        updatePageGeneration(pageNumber, (current) => ({
          ...current,
          memoryUpdate: current.memoryUpdate.trim(),
          isGenerating: false,
          status: "completed",
          error: null,
        }));

        finishSlide({ pageNumber, success: true });
      } catch (error) {
        generationContextRef.current[pageNumber] = {
          ...generationContextRef.current[pageNumber],
          memoryUpdate:
            generationContextRef.current[pageNumber]?.memoryUpdate.trim() || "",
        };

        if (signal.aborted || isAbortError(error)) {
          updatePageGeneration(pageNumber, (current) => ({
            ...current,
            memoryUpdate: current.memoryUpdate.trim(),
            isGenerating: false,
            status: "completed",
            error: null,
          }));
          finishSlide({ pageNumber, success: false });
          throw createAbortError();
        }

        const message =
          error instanceof Error ? error.message : "Generation failed.";
        updatePageGeneration(pageNumber, (current) => ({
          ...current,
          memoryUpdate: current.memoryUpdate.trim(),
          isGenerating: false,
          status: "completed",
          error: message,
        }));
        finishSlide({ pageNumber, success: false });
        throw error;
      }
    },
    [
      beginSlide,
      documentData,
      finishSlide,
      recordChunk,
      settings.providerType,
      settings.apiKey,
      settings.baseUrl,
      settings.modelName,
      settings.outputLanguage,
      settings.customPrompt,
      streamLecture,
      updatePageGeneration,
    ],
  );

  const runSequentialGeneration = useCallback(
    async (
      pages: Array<{ pageNumber: number; imageDataUrl: string }>,
      signal: AbortSignal,
    ) => {
      if (!pages.length) {
        return;
      }

      setQueueProgress({
        phase: "streaming",
        current: 0,
        total: pages.length,
      });

      for (const [index, page] of pages.entries()) {
        if (signal.aborted) {
          throw createAbortError();
        }

        setActivePage(page.pageNumber);
        setQueueProgress({
          phase: "streaming",
          current: index + 1,
          total: pages.length,
        });

        const availableTakeaways = getAvailableTakeawaysSnapshot();
        await runSinglePageGeneration(
          page.pageNumber,
          signal,
          availableTakeaways,
        );
      }
    },
    [getAvailableTakeawaysSnapshot, runSinglePageGeneration],
  );

  const startTakeawayPipeline = useCallback(
    (
      pages: Array<{ pageNumber: number; imageDataUrl: string }>,
      signal: AbortSignal,
      waitForCompletion: boolean,
    ) => {
      const extractionPromise = extractAllTakeaways(pages, signal, {
        reportProgress: waitForCompletion,
      });
      extractionPromiseRef.current = extractionPromise;

      if (!waitForCompletion) {
        void extractionPromise.catch((error) => {
          if (!isAbortError(error)) {
            // Per-slide fallback is already handled in extractAllTakeaways.
          }
        });
      }

      return extractionPromise;
    },
    [extractAllTakeaways],
  );

  const generatePage = useCallback(
    async (pageNumber: number) => {
      if (!documentData || isGeneratingRef.current) {
        return;
      }

      const targetPage = documentData.pages.find(
        (page) => page.pageNumber === pageNumber,
      );
      if (!targetPage) {
        return;
      }

      const abortController = new AbortController();
      generationAbortControllerRef.current = abortController;
      beginGenerationSession("single");
      setActivePage(pageNumber);

      try {
        const shouldAwaitExtraction = settings.contextMode === "full";
        const extractionPromise = startTakeawayPipeline(
          documentData.pages,
          abortController.signal,
          shouldAwaitExtraction,
        );

        if (shouldAwaitExtraction) {
          await extractionPromise;
          await sleep(MAPPING_COMPLETION_HANDOFF_MS, abortController.signal);
        }

        await runSequentialGeneration([targetPage], abortController.signal);
      } catch (error) {
        if (!isAbortError(error)) {
          // Page-level error state is captured inside runSinglePageGeneration.
        }
      } finally {
        if (generationAbortControllerRef.current === abortController) {
          endGenerationSession();
        }
      }
    },
    [
      beginGenerationSession,
      documentData,
      endGenerationSession,
      runSequentialGeneration,
      settings.contextMode,
      startTakeawayPipeline,
    ],
  );

  const generateFullDocument = useCallback(async () => {
    if (!documentData || isGeneratingRef.current) {
      return;
    }

    const abortController = new AbortController();
    generationAbortControllerRef.current = abortController;
    beginGenerationSession("full");

    try {
      const shouldAwaitExtraction = settings.contextMode === "full";
      const extractionPromise = startTakeawayPipeline(
        documentData.pages,
        abortController.signal,
        shouldAwaitExtraction,
      );

      if (shouldAwaitExtraction) {
        await extractionPromise;
        await sleep(MAPPING_COMPLETION_HANDOFF_MS, abortController.signal);
      }

      await runSequentialGeneration(documentData.pages, abortController.signal);
    } catch (error) {
      if (!isAbortError(error)) {
        // Page-level error state is captured inside runSinglePageGeneration.
      }
    } finally {
      if (generationAbortControllerRef.current === abortController) {
        endGenerationSession();
      }
    }
  }, [
    beginGenerationSession,
    documentData,
    endGenerationSession,
    runSequentialGeneration,
    settings.contextMode,
    startTakeawayPipeline,
  ]);

  const cancelGeneration = useCallback(() => {
    generationAbortControllerRef.current?.abort();
  }, []);

  return {
    generatePage,
    generateFullDocument,
    cancelGeneration,
    isGenerating,
    generationMode,
    activePage,
    queueProgress,
  };
}
