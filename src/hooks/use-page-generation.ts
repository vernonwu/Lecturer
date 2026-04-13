"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePdf } from "@/context/pdf-context";
import { useLectureStream } from "@/hooks/use-lecture-stream";
import { useSettings } from "@/context/settings-context";

function buildHistoryContext(
  pageNumber: number,
  generations: Record<number, { memoryUpdate: string }>,
) {
  const memoryLines = Object.entries(generations)
    .map(([page, memory]) => ({
      page: Number(page),
      memory: memory.memoryUpdate,
    }))
    .filter(
      (entry) => Number.isFinite(entry.page) && entry.page <= pageNumber - 2 && entry.memory.trim(),
    )
    .sort((a, b) => a.page - b.page)
    .map((entry) => `- Page ${entry.page}: ${entry.memory.trim()}`);

  return memoryLines.join("\n");
}

function buildFullHistoryMarkdown(
  pageNumber: number,
  generations: Record<number, { lectureMarkdown: string }>,
) {
  const historySections = Object.entries(generations)
    .map(([page, generation]) => ({
      page: Number(page),
      lectureMarkdown: generation.lectureMarkdown,
    }))
    .filter(
      (entry) =>
        Number.isFinite(entry.page) &&
        entry.page <= pageNumber - 1 &&
        entry.lectureMarkdown.trim(),
    )
    .sort((a, b) => a.page - b.page)
    .map(
      (entry) =>
        `### Page ${entry.page}\n${entry.lectureMarkdown.trim()}`,
    );

  return historySections.join("\n\n");
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

type GenerationMode = "single" | "full" | null;

interface QueueProgress {
  current: number;
  total: number;
}

interface GenerationContextEntry {
  lectureMarkdown: string;
  memoryUpdate: string;
}

export function usePageGeneration() {
  const { streamLecture } = useLectureStream();
  const { settings } = useSettings();
  const { documentData, pageGenerations, updatePageGeneration } = usePdf();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(null);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [queueProgress, setQueueProgress] = useState<QueueProgress | null>(null);
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const isGeneratingRef = useRef(false);
  const generationContextRef = useRef<Record<number, GenerationContextEntry>>({});

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
  }, [pageGenerations]);

  useEffect(() => {
    return () => {
      generationAbortControllerRef.current?.abort();
    };
  }, []);

  const beginGenerationSession = useCallback(
    (mode: Exclude<GenerationMode, null>, totalPages: number | null) => {
      isGeneratingRef.current = true;
      setIsGenerating(true);
      setGenerationMode(mode);
      setQueueProgress(
        mode === "full" && typeof totalPages === "number"
          ? {
              current: 0,
              total: totalPages,
            }
          : null,
      );
      setActivePage(null);
    },
    [],
  );

  const endGenerationSession = useCallback(() => {
    isGeneratingRef.current = false;
    generationAbortControllerRef.current = null;
    setIsGenerating(false);
    setGenerationMode(null);
    setQueueProgress(null);
    setActivePage(null);
  }, []);

  const runSinglePageGeneration = useCallback(
    async (pageNumber: number, signal: AbortSignal) => {
      if (!documentData) {
        return;
      }

      const page = documentData.pages.find((item) => item.pageNumber === pageNumber);
      if (!page) {
        return;
      }

      const generationsSnapshot = generationContextRef.current;
      const previousPageMarkdown =
        generationsSnapshot[pageNumber - 1]?.lectureMarkdown || "";
      const historyContext =
        settings.contextMode === "fast"
          ? buildHistoryContext(pageNumber, generationsSnapshot)
          : "";
      const fullHistoryMarkdown =
        settings.contextMode === "full"
          ? buildFullHistoryMarkdown(pageNumber, generationsSnapshot)
          : "";

      generationContextRef.current[pageNumber] = {
        lectureMarkdown: "",
        memoryUpdate: "",
      };

      updatePageGeneration(pageNumber, () => ({
        lectureMarkdown: "",
        memoryUpdate: "",
        isGenerating: true,
        error: null,
      }));

      try {
        await streamLecture({
          request: {
            pageNumber,
            imageDataUrl: page.imageDataUrl,
            pdfTitle: documentData.title,
            contextMode: settings.contextMode,
            historyContext,
            previousPageMarkdown,
            fullHistoryMarkdown,
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
            generationContextRef.current[pageNumber] = {
              ...generationContextRef.current[pageNumber],
              lectureMarkdown:
                `${generationContextRef.current[pageNumber]?.lectureMarkdown || ""}${chunk}`,
            };
            updatePageGeneration(pageNumber, (current) => ({
              ...current,
              lectureMarkdown: `${current.lectureMarkdown}${chunk}`,
            }));
          },
          onMemoryChunk: (chunk) => {
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
          error: null,
        }));
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          generationContextRef.current[pageNumber] = {
            ...generationContextRef.current[pageNumber],
            memoryUpdate:
              generationContextRef.current[pageNumber]?.memoryUpdate.trim() || "",
          };
          updatePageGeneration(pageNumber, (current) => ({
            ...current,
            memoryUpdate: current.memoryUpdate.trim(),
            isGenerating: false,
            error: null,
          }));
          throw createAbortError();
        }

        const message =
          error instanceof Error ? error.message : "Generation failed.";
        generationContextRef.current[pageNumber] = {
          ...generationContextRef.current[pageNumber],
          memoryUpdate:
            generationContextRef.current[pageNumber]?.memoryUpdate.trim() || "",
        };
        updatePageGeneration(pageNumber, (current) => ({
          ...current,
          memoryUpdate: current.memoryUpdate.trim(),
          isGenerating: false,
          error: message,
        }));
        throw error;
      }
    },
    [
      documentData,
      settings.providerType,
      settings.apiKey,
      settings.baseUrl,
      settings.modelName,
      settings.contextMode,
      settings.outputLanguage,
      settings.customPrompt,
      streamLecture,
      updatePageGeneration,
    ],
  );

  const generatePage = useCallback(
    async (pageNumber: number) => {
      if (!documentData || isGeneratingRef.current) {
        return;
      }

      const abortController = new AbortController();
      generationAbortControllerRef.current = abortController;
      beginGenerationSession("single", null);
      setActivePage(pageNumber);

      try {
        await runSinglePageGeneration(pageNumber, abortController.signal);
      } catch (error) {
        if (!isAbortError(error)) {
          // Page-level error state is already captured inside runSinglePageGeneration.
        }
      } finally {
        if (generationAbortControllerRef.current === abortController) {
          endGenerationSession();
        }
      }
    },
    [beginGenerationSession, documentData, endGenerationSession, runSinglePageGeneration],
  );

  const generateFullDocument = useCallback(async () => {
    if (!documentData || isGeneratingRef.current) {
      return;
    }

    const abortController = new AbortController();
    generationAbortControllerRef.current = abortController;
    beginGenerationSession("full", documentData.pages.length);

    try {
      for (const [index, page] of documentData.pages.entries()) {
        if (abortController.signal.aborted) {
          break;
        }

        setActivePage(page.pageNumber);
        setQueueProgress({
          current: index + 1,
          total: documentData.pages.length,
        });
        await runSinglePageGeneration(page.pageNumber, abortController.signal);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        // Page-level error state is already captured inside runSinglePageGeneration.
      }
    } finally {
      if (generationAbortControllerRef.current === abortController) {
        endGenerationSession();
      }
    }
  }, [beginGenerationSession, documentData, endGenerationSession, runSinglePageGeneration]);

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
