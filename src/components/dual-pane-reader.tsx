"use client";

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { usePdf } from "@/context/pdf-context";
import { usePageGeneration } from "@/hooks/use-page-generation";
import { PdfPageCanvas } from "@/components/pdf-page-canvas";
import { GlobalMappingLoader } from "@/components/global-mapping-loader";

const OBSERVER_MARGIN = "-20% 0px -70% 0px";
const OBSERVER_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];
const PROGRAMMATIC_LOCK_MS = 800;
const MARKDOWN_OBSERVER_DEBOUNCE_MS = 100;
const STREAM_DRAIN_INTERVAL_MS = 18;
const TAIL_SYNC_THRESHOLD_PX = 100;

function pickClosestIntersection(
  entries: IntersectionObserverEntry[],
  rootTop: number,
  rootHeight: number,
) {
  const targetTop = rootTop + rootHeight * 0.2;
  let best: IntersectionObserverEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    if (!entry.isIntersecting) {
      continue;
    }
    const distance = Math.abs(entry.boundingClientRect.top - targetTop);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }

  return best;
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function hasTextSelection() {
  if (typeof window === "undefined") {
    return false;
  }
  const selection = window.getSelection();
  return Boolean(selection && selection.toString().trim());
}

function scrollElementWithinContainer(options: {
  container: HTMLElement | null;
  target: HTMLElement | null;
  behavior: ScrollBehavior;
  block: "start" | "end";
}) {
  const { container, target, behavior, block } = options;
  if (!container || !target || container.clientHeight <= 0) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTopInContainer =
    container.scrollTop + (targetRect.top - containerRect.top);
  const targetBottomInContainer = targetTopInContainer + targetRect.height;

  const rawTop =
    block === "start"
      ? targetTopInContainer
      : targetBottomInContainer - container.clientHeight;
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const clampedTop = Math.min(maxTop, Math.max(0, rawTop));

  if (Math.abs(container.scrollTop - clampedTop) < 1) {
    return;
  }

  container.scrollTo({
    top: clampedTop,
    behavior,
  });
}

export function DualPaneReader() {
  const { documentData, currentPage, setCurrentPage, pageGenerations } =
    usePdf();
  const {
    generatePage,
    generateFullDocument,
    cancelGeneration,
    isGenerating,
    generationMode,
    activePage,
    queueProgress,
  } = usePageGeneration();
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);
  const currentPageRef = useRef(currentPage);
  const isProgrammaticScroll = useRef(false);
  const lockReleaseTimerRef = useRef<number | null>(null);
  const lockCleanupCallbacksRef = useRef<Array<() => void>>([]);
  const markdownDebounceTimerRef = useRef<number | null>(null);
  const pendingMarkdownPageRef = useRef<number | null>(null);
  const copyStatusTimerRef = useRef<number | null>(null);
  const drainIntervalRef = useRef<number | null>(null);
  const streamBufferRef = useRef("");
  const previousRawStreamingRef = useRef("");
  const streamingPageRef = useRef<number | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const aiCursorRef = useRef<HTMLSpanElement | null>(null);
  const isUserScrolledUp = useRef(false);
  const [displayedStreamingText, setDisplayedStreamingText] = useState("");
  const [showResumeButton, setShowResumeButton] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );

  const pageCount = documentData?.totalPages ?? 0;
  const pageIndexByNumber = useMemo(() => {
    const indexByNumber = new Map<number, number>();
    documentData?.pages.forEach((page, index) => {
      indexByNumber.set(page.pageNumber, index);
    });
    return indexByNumber;
  }, [documentData?.pages]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  const clearMarkdownDebounce = useCallback(() => {
    if (markdownDebounceTimerRef.current !== null) {
      window.clearTimeout(markdownDebounceTimerRef.current);
      markdownDebounceTimerRef.current = null;
    }
    pendingMarkdownPageRef.current = null;
  }, []);

  const clearProgrammaticLock = useCallback(() => {
    if (lockReleaseTimerRef.current !== null) {
      window.clearTimeout(lockReleaseTimerRef.current);
      lockReleaseTimerRef.current = null;
    }

    lockCleanupCallbacksRef.current.forEach((cleanup) => cleanup());
    lockCleanupCallbacksRef.current = [];
    isProgrammaticScroll.current = false;
  }, []);

  useEffect(() => {
    return () => {
      clearMarkdownDebounce();
      clearProgrammaticLock();
    };
  }, [clearMarkdownDebounce, clearProgrammaticLock]);

  useEffect(() => {
    return () => {
      if (copyStatusTimerRef.current !== null) {
        window.clearTimeout(copyStatusTimerRef.current);
        copyStatusTimerRef.current = null;
      }
      if (drainIntervalRef.current !== null) {
        window.clearInterval(drainIntervalRef.current);
        drainIntervalRef.current = null;
      }
    };
  }, []);

  const withProgrammaticLock = useCallback(
    (options: {
      scrollAction: () => void;
      lockTargets: Array<HTMLElement | null>;
    }) => {
      const lockTargets = Array.from(
        new Set(
          options.lockTargets.filter((target): target is HTMLElement =>
            Boolean(target),
          ),
        ),
      );

      clearProgrammaticLock();
      isProgrammaticScroll.current = true;

      let remainingScrollEnds = lockTargets.length;
      const onScrollEnd = () => {
        remainingScrollEnds -= 1;
        if (remainingScrollEnds <= 0) {
          clearProgrammaticLock();
        }
      };

      lockTargets.forEach((target) => {
        target.addEventListener("scrollend", onScrollEnd, { once: true });
        lockCleanupCallbacksRef.current.push(() => {
          target.removeEventListener("scrollend", onScrollEnd);
        });
      });

      options.scrollAction();

      if (remainingScrollEnds <= 0) {
        clearProgrammaticLock();
        return;
      }

      lockReleaseTimerRef.current = window.setTimeout(() => {
        clearProgrammaticLock();
      }, PROGRAMMATIC_LOCK_MS);
    },
    [clearProgrammaticLock],
  );

  const scrollPdfToPage = useCallback(
    (pageNumber: number, behavior: ScrollBehavior) => {
      const container = pdfContainerRef.current;
      const target = container?.querySelector<HTMLElement>(
        `[data-pdf-page="${pageNumber}"]`,
      );
      scrollElementWithinContainer({
        container,
        target: target ?? null,
        behavior,
        block: "start",
      });
    },
    [],
  );

  const scrollMarkdownToPage = useCallback(
    (pageNumber: number, behavior: ScrollBehavior) => {
      const container = markdownContainerRef.current;
      const target = container?.querySelector<HTMLElement>(
        `[data-page="${pageNumber}"]`,
      );
      scrollElementWithinContainer({
        container,
        target: target ?? null,
        behavior,
        block: "start",
      });
    },
    [],
  );

  const clampPageNumber = useCallback(
    (pageNumber: number) => {
      if (!pageCount) {
        return 1;
      }
      return Math.min(pageCount, Math.max(1, pageNumber));
    },
    [pageCount],
  );

  const jumpToPage = useCallback(
    (
      pageNumber: number,
      options: {
        behavior?: ScrollBehavior;
        syncPdf?: boolean;
        syncMarkdown?: boolean;
      } = {},
    ) => {
      const {
        behavior = "auto",
        syncPdf = true,
        syncMarkdown = true,
      } = options;
      const nextPage = clampPageNumber(pageNumber);
      if (nextPage === currentPageRef.current) {
        return;
      }

      currentPageRef.current = nextPage;
      setCurrentPage(nextPage);
      withProgrammaticLock({
        lockTargets: [
          syncPdf ? pdfContainerRef.current : null,
          syncMarkdown ? markdownContainerRef.current : null,
        ],
        scrollAction: () => {
          if (syncPdf) {
            scrollPdfToPage(nextPage, behavior);
          }
          if (syncMarkdown) {
            scrollMarkdownToPage(nextPage, behavior);
          }
        },
      });
    },
    [
      clampPageNumber,
      setCurrentPage,
      scrollPdfToPage,
      scrollMarkdownToPage,
      withProgrammaticLock,
    ],
  );

  const goToPageFromNavigation = useCallback(
    (pageNumber: number) => {
      jumpToPage(pageNumber, {
        behavior: "smooth",
        syncPdf: true,
        syncMarkdown: true,
      });
    },
    [jumpToPage],
  );

  const handleViewportScroll = useCallback(() => {
    if (isProgrammaticScroll.current) {
      return;
    }

    const viewport = markdownContainerRef.current;
    const target = aiCursorRef.current ?? bottomAnchorRef.current;
    if (!viewport || !target) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const distanceFromTail = targetRect.bottom - viewportRect.bottom;
    const isNearTail = Math.abs(distanceFromTail) < TAIL_SYNC_THRESHOLD_PX;
    const nextShowResumeButton = !isNearTail;

    isUserScrolledUp.current = nextShowResumeButton;
    setShowResumeButton((current) =>
      current === nextShowResumeButton ? current : nextShowResumeButton,
    );
  }, []);

  useEffect(() => {
    const root = markdownContainerRef.current;
    if (!root || !documentData?.pages.length) {
      return;
    }

    const targets = root.querySelectorAll<HTMLElement>("[data-page]");
    if (!targets.length) {
      return;
    }

    const scheduleMarkdownSync = (nextPage: number) => {
      pendingMarkdownPageRef.current = nextPage;
      if (markdownDebounceTimerRef.current !== null) {
        window.clearTimeout(markdownDebounceTimerRef.current);
      }
      markdownDebounceTimerRef.current = window.setTimeout(() => {
        markdownDebounceTimerRef.current = null;
        const pendingPage = pendingMarkdownPageRef.current;
        pendingMarkdownPageRef.current = null;
        if (pendingPage === null || isProgrammaticScroll.current) {
          return;
        }
        if (pendingPage === currentPageRef.current) {
          return;
        }

        currentPageRef.current = pendingPage;
        setCurrentPage(pendingPage);
        withProgrammaticLock({
          lockTargets: [pdfContainerRef.current],
          scrollAction: () => {
            scrollPdfToPage(pendingPage, "smooth");
          },
        });
      }, MARKDOWN_OBSERVER_DEBOUNCE_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScroll.current) {
          return;
        }

        const rootBounds = root.getBoundingClientRect();
        const best = pickClosestIntersection(
          entries,
          rootBounds.top,
          rootBounds.height,
        );
        if (!best) {
          return;
        }

        const pageValue = Number((best.target as HTMLElement).dataset.page);
        if (!Number.isFinite(pageValue)) {
          return;
        }

        const nextPage = clampPageNumber(pageValue);
        if (nextPage === currentPageRef.current) {
          return;
        }

        scheduleMarkdownSync(nextPage);
      },
      {
        root,
        rootMargin: OBSERVER_MARGIN,
        threshold: OBSERVER_THRESHOLDS,
      },
    );

    targets.forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
      clearMarkdownDebounce();
    };
  }, [
    clearMarkdownDebounce,
    clampPageNumber,
    documentData?.pages.length,
    scrollPdfToPage,
    setCurrentPage,
    withProgrammaticLock,
  ]);

  useEffect(() => {
    const root = pdfContainerRef.current;
    if (!root || !documentData?.pages.length) {
      return;
    }

    const targets = root.querySelectorAll<HTMLElement>("[data-pdf-page]");
    if (!targets.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScroll.current) {
          return;
        }

        const rootBounds = root.getBoundingClientRect();
        const best = pickClosestIntersection(
          entries,
          rootBounds.top,
          rootBounds.height,
        );
        if (!best) {
          return;
        }

        const pageValue = Number((best.target as HTMLElement).dataset.pdfPage);
        if (!Number.isFinite(pageValue)) {
          return;
        }

        const nextPage = clampPageNumber(pageValue);
        if (nextPage === currentPageRef.current) {
          return;
        }

        currentPageRef.current = nextPage;
        setCurrentPage(nextPage);
        withProgrammaticLock({
          lockTargets: [markdownContainerRef.current],
          scrollAction: () => {
            scrollMarkdownToPage(nextPage, "smooth");
          },
        });
      },
      {
        root,
        rootMargin: OBSERVER_MARGIN,
        threshold: OBSERVER_THRESHOLDS,
      },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [
    clampPageNumber,
    documentData?.pages.length,
    scrollMarkdownToPage,
    setCurrentPage,
    withProgrammaticLock,
  ]);

  const activePageGeneration = activePage ? pageGenerations[activePage] : null;
  const activeRawMarkdown = activePageGeneration?.lectureMarkdown || "";
  const isActiveStreaming = Boolean(
    isGenerating &&
    queueProgress?.phase === "streaming" &&
    activePage !== null &&
    activePageGeneration?.isGenerating,
  );

  const scrollToActiveTail = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const container = markdownContainerRef.current;
      const target = aiCursorRef.current ?? bottomAnchorRef.current;
      scrollElementWithinContainer({
        container,
        target,
        behavior,
        block: "end",
      });
    },
    [],
  );

  useEffect(() => {
    if (streamingPageRef.current === activePage) {
      return;
    }

    streamingPageRef.current = activePage;
    streamBufferRef.current = "";
    previousRawStreamingRef.current = "";
    setDisplayedStreamingText("");
  }, [activePage]);

  useEffect(() => {
    if (!activePage) {
      return;
    }

    const previousRaw = previousRawStreamingRef.current;
    if (!previousRaw || activeRawMarkdown.startsWith(previousRaw)) {
      const appendChunk = activeRawMarkdown.slice(previousRaw.length);
      if (appendChunk) {
        streamBufferRef.current += appendChunk;
      }
    } else {
      streamBufferRef.current = activeRawMarkdown;
      setDisplayedStreamingText("");
    }

    previousRawStreamingRef.current = activeRawMarkdown;
  }, [activePage, activeRawMarkdown]);

  useEffect(() => {
    if (!isActiveStreaming) {
      aiCursorRef.current = null;
    }
  }, [isActiveStreaming]);

  useEffect(() => {
    if (drainIntervalRef.current !== null) {
      window.clearInterval(drainIntervalRef.current);
      drainIntervalRef.current = null;
    }

    const shouldDrain = isActiveStreaming || streamBufferRef.current.length > 0;
    if (!shouldDrain) {
      return;
    }

    drainIntervalRef.current = window.setInterval(() => {
      const backlog = streamBufferRef.current.length;
      if (!backlog) {
        return;
      }

      const step =
        backlog > 300 ? 22 : backlog > 200 ? 15 : backlog > 100 ? 9 : 3;
      const nextChunk = streamBufferRef.current.slice(0, step);
      streamBufferRef.current = streamBufferRef.current.slice(step);
      setDisplayedStreamingText((current) => `${current}${nextChunk}`);
    }, STREAM_DRAIN_INTERVAL_MS);

    return () => {
      if (drainIntervalRef.current !== null) {
        window.clearInterval(drainIntervalRef.current);
        drainIntervalRef.current = null;
      }
    };
  }, [isActiveStreaming, activePage]);

  useEffect(() => {
    if (isGenerating) {
      return;
    }
    isUserScrolledUp.current = false;
    setShowResumeButton(false);
  }, [isGenerating]);

  useEffect(() => {
    if (!isGenerating || isUserScrolledUp.current) {
      return;
    }
    scrollToActiveTail("auto");
  }, [displayedStreamingText, isGenerating, scrollToActiveTail]);

  useEffect(() => {
    if (
      !isGenerating ||
      queueProgress?.phase !== "streaming" ||
      activePage === null ||
      isUserScrolledUp.current
    ) {
      return;
    }
    jumpToPage(activePage, {
      behavior: "smooth",
      syncPdf: false,
      syncMarkdown: true,
    });
  }, [activePage, isGenerating, jumpToPage, queueProgress?.phase]);

  const isReady = Boolean(documentData?.pages.length);
  const currentPageGeneration = pageGenerations[currentPage];
  const fullNotesMarkdown = useMemo(() => {
    if (!documentData?.pages.length) {
      return "";
    }

    const sections = documentData.pages.map((page) => {
      const lectureMarkdown =
        pageGenerations[page.pageNumber]?.lectureMarkdown.trim() ||
        "_No notes generated for this page yet._";
      return `## Page ${page.pageNumber}\n\n${lectureMarkdown}`;
    });

    return `# ${documentData.title} Notes\n\n${sections.join("\n\n---\n\n")}\n`;
  }, [documentData, pageGenerations]);
  const exportFileName = useMemo(() => {
    const safeTitle = sanitizeFileName(documentData?.title || "Lecturer");
    return `${safeTitle || "Lecturer"}-Notes.md`;
  }, [documentData?.title]);
  const generationStatusText = useMemo(() => {
    if (!isGenerating) {
      return null;
    }
    if (generationMode === "full" && queueProgress?.phase === "streaming") {
      const pageLabel = activePage ? ` · Page ${activePage}` : "";
      return `Generating full document ${queueProgress.current}/${queueProgress.total}${pageLabel}`;
    }
    if (activePage) {
      return `Generating page ${activePage}...`;
    }
    return "Generating...";
  }, [activePage, generationMode, isGenerating, queueProgress]);
  const isMappingPhase = isGenerating && queueProgress?.phase === "mapping";
  const mappingCompletedExtractions = isMappingPhase
    ? queueProgress.current
    : 0;
  const mappingTotalSlides = isMappingPhase
    ? queueProgress.total
    : (documentData?.totalPages ?? 0);

  const notesHeaderText = useMemo(() => {
    if (!isReady) {
      return "Upload a PDF to begin generating lecture notes.";
    }
    if (!currentPageGeneration?.lectureMarkdown) {
      return `Page ${currentPage} has no generated notes yet.`;
    }
    return `Viewing generated notes for page ${currentPage}.`;
  }, [currentPage, currentPageGeneration?.lectureMarkdown, isReady]);

  const setCopyFeedback = useCallback((nextStatus: "success" | "error") => {
    setCopyStatus(nextStatus);
    if (copyStatusTimerRef.current !== null) {
      window.clearTimeout(copyStatusTimerRef.current);
    }
    copyStatusTimerRef.current = window.setTimeout(() => {
      setCopyStatus("idle");
      copyStatusTimerRef.current = null;
    }, 1800);
  }, []);

  const copyFullNotes = useCallback(async () => {
    if (!fullNotesMarkdown.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(fullNotesMarkdown);
      setCopyFeedback("success");
    } catch {
      setCopyFeedback("error");
    }
  }, [fullNotesMarkdown, setCopyFeedback]);

  const downloadFullNotes = useCallback(() => {
    if (!fullNotesMarkdown.trim()) {
      return;
    }

    const blob = new Blob([fullNotesMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = exportFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }, [exportFileName, fullNotesMarkdown]);

  const copyStatusText =
    copyStatus === "success"
      ? "Copied to clipboard."
      : copyStatus === "error"
        ? "Copy failed."
        : null;

  const onMarkdownCardClick = useCallback(
    (pageNumber: number, event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("a, button, input, textarea, select, summary")) {
        return;
      }
      if (hasTextSelection()) {
        return;
      }
      jumpToPage(pageNumber, {
        behavior: "smooth",
        syncPdf: true,
        syncMarkdown: false,
      });
    },
    [jumpToPage],
  );

  const resumeAutoScroll = useCallback(() => {
    isUserScrolledUp.current = false;
    setShowResumeButton(false);
    scrollToActiveTail("smooth");
  }, [scrollToActiveTail]);

  return (
    <section className="relative grid h-[72vh] min-h-[560px] gap-4 md:grid-cols-2">
      {isMappingPhase ? (
        <GlobalMappingLoader
          completedExtractions={mappingCompletedExtractions}
          totalSlides={mappingTotalSlides}
        />
      ) : null}
      <article className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/55 bg-white/32 shadow-xl backdrop-blur-md dark:border-slate-700/55 dark:bg-slate-900/50">
        <header className="border-b border-white/55 bg-white/30 px-4 py-3 backdrop-blur-sm dark:border-slate-700/55 dark:bg-slate-900/45">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-slate-100">
              PDF Viewer
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => goToPageFromNavigation(currentPage - 1)}
                disabled={!isReady || currentPage <= 1}
                className="rounded-md border border-white/65 bg-white/65 px-2.5 py-1 text-xs font-medium hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600/70 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-700/80"
              >
                Previous
              </button>
              <span className="text-xs text-zinc-600 dark:text-slate-400">
                Page {isReady ? currentPage : 0}/{pageCount}
              </span>
              <button
                type="button"
                onClick={() => goToPageFromNavigation(currentPage + 1)}
                disabled={!isReady || currentPage >= pageCount}
                className="rounded-md border border-white/65 bg-white/65 px-2.5 py-1 text-xs font-medium hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600/70 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-700/80"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isGenerating) {
                    cancelGeneration();
                    return;
                  }
                  void generateFullDocument();
                }}
                disabled={!isReady && !isGenerating}
                className={[
                  "rounded-md px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50",
                  isGenerating
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-accent hover:opacity-90",
                ].join(" ")}
              >
                {isGenerating ? "Cancel Generation" : "Generate Full Document"}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-slate-400">
            {isMappingPhase
              ? "\u00A0"
              : (generationStatusText ?? "Ready to generate.")}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {documentData?.pages.length ? (
            <div
              ref={pdfContainerRef}
              className="h-full min-h-0 space-y-4 overflow-auto p-4"
            >
              {documentData.pages.map((page) => {
                const active = page.pageNumber === currentPage;
                const isPageGenerating =
                  isGenerating && activePage === page.pageNumber;

                return (
                  <section
                    key={page.pageNumber}
                    data-pdf-page={page.pageNumber}
                    className={[
                      "overflow-hidden rounded-xl border bg-panel shadow-sm",
                      active
                        ? "border-accent shadow-[0_0_0_1px_rgba(15,91,143,0.25)]"
                        : "border-border/70 dark:border-slate-700/75",
                    ].join(" ")}
                  >
                    <header className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-zinc-600 dark:border-slate-700/75 dark:text-slate-400">
                      <button
                        type="button"
                        onClick={() =>
                          jumpToPage(page.pageNumber, {
                            behavior: "auto",
                            syncPdf: true,
                            syncMarkdown: true,
                          })
                        }
                        className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-slate-100"
                      >
                        Page {page.pageNumber}
                      </button>
                      <span>
                        {page.width} × {page.height}
                      </span>
                    </header>
                    <button
                      type="button"
                      onClick={() =>
                        jumpToPage(page.pageNumber, {
                          behavior: "auto",
                          syncPdf: true,
                          syncMarkdown: true,
                        })
                      }
                      className="block w-full text-left"
                    >
                      <PdfPageCanvas
                        imageDataUrl={page.imageDataUrl}
                        width={page.width}
                        height={page.height}
                      />
                    </button>
                    <div className="border-t border-border px-3 py-2 dark:border-slate-700/75">
                      <button
                        type="button"
                        onClick={() => {
                          void generatePage(page.pageNumber);
                        }}
                        disabled={isGenerating}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPageGenerating ? "Generating..." : "Generate"}
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="p-4">
              <p className="text-sm text-zinc-600 dark:text-slate-400">
                No PDF loaded yet.
              </p>
            </div>
          )}
        </div>
      </article>

      <article className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/55 bg-white/32 shadow-xl backdrop-blur-md dark:border-slate-700/55 dark:bg-slate-900/50">
        <header className="border-b border-white/55 bg-white/30 px-4 py-3 backdrop-blur-sm dark:border-slate-700/55 dark:bg-slate-900/45">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-slate-100">
            Markdown Notes Stream
          </h3>
          <p className="mt-1 text-xs text-zinc-600 dark:text-slate-400">
            {notesHeaderText}
          </p>
        </header>

        <div
          ref={markdownContainerRef}
          data-pane="markdown"
          onScroll={handleViewportScroll}
          className="min-h-0 flex-1 overflow-auto"
        >
          <div className="space-y-4 p-4 pb-6">
            {documentData?.pages.length ? (
              documentData.pages.map((page) => {
                const generation = pageGenerations[page.pageNumber];
                const rawLectureMarkdown = generation?.lectureMarkdown || "";
                const active = page.pageNumber === currentPage;
                const pageIndex = pageIndexByNumber.get(page.pageNumber) ?? -1;
                const activePageIndex =
                  activePage !== null
                    ? (pageIndexByNumber.get(activePage) ?? -1)
                    : -1;
                const isStreaming =
                  isGenerating &&
                  queueProgress?.phase === "streaming" &&
                  activePage === page.pageNumber &&
                  generation?.isGenerating === true;
                const isQueued =
                  isGenerating &&
                  generationMode === "full" &&
                  queueProgress?.phase === "streaming" &&
                  pageIndex > activePageIndex;
                const slideStatus = isQueued
                  ? "Queued"
                  : isStreaming
                    ? "Streaming"
                    : "Completed";
                const renderedLectureMarkdown = isStreaming
                  ? displayedStreamingText
                  : rawLectureMarkdown;
                return (
                  <div
                    key={page.pageNumber}
                    data-page={page.pageNumber}
                    onClick={(event) =>
                      onMarkdownCardClick(page.pageNumber, event)
                    }
                    className={[
                      "cursor-pointer rounded-xl border bg-panel px-4 py-3 text-zinc-800 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:text-slate-100 dark:hover:bg-slate-800",
                      isQueued ? "opacity-50" : "opacity-100",
                      isStreaming
                        ? "border-t-2 border-t-blue-400/70 shadow-[0_0_15px_rgba(59,130,246,0.15)] dark:shadow-[0_0_15px_rgba(59,130,246,0.15)]"
                        : "",
                      active
                        ? "border-accent shadow-[0_0_0_0.9px_rgba(15,91,143,0.35),0_12px_22px_-14px_rgba(15,91,143,0.6)]"
                        : "border-border/70 dark:border-slate-700/75",
                    ].join(" ")}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="inline-flex rounded-full border border-white/70 bg-white/75 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-700 dark:border-slate-600/70 dark:bg-slate-800/85 dark:text-slate-300">
                        Page {page.pageNumber}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isStreaming ? (
                          <span
                            aria-hidden="true"
                            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-300/45 border-t-blue-500"
                          />
                        ) : null}
                        <span
                          className={[
                            "text-xs font-medium",
                            isStreaming
                              ? "text-accent"
                              : "text-zinc-500 dark:text-slate-400",
                          ].join(" ")}
                        >
                          {slideStatus}
                        </span>
                      </div>
                    </div>

                    {generation?.error ? (
                      <p className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700/70 dark:bg-red-900/35 dark:text-red-200">
                        {generation.error}
                      </p>
                    ) : null}

                    {isQueued ? (
                      <div className="space-y-2 py-1">
                        <div className="h-4 w-11/12 rounded-md bg-slate-200 animate-pulse dark:bg-slate-800" />
                        <div className="h-4 w-10/12 rounded-md bg-slate-200 animate-pulse dark:bg-slate-800" />
                        <div className="h-4 w-8/12 rounded-md bg-slate-200 animate-pulse dark:bg-slate-800" />
                        <div className="h-4 w-7/12 rounded-md bg-slate-200 animate-pulse dark:bg-slate-800" />
                      </div>
                    ) : isStreaming || renderedLectureMarkdown ? (
                      <div className="markdown-content prose prose-slate max-w-none select-text dark:prose-invert">
                        <ReactMarkdown
                          remarkPlugins={[remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {renderedLectureMarkdown}
                        </ReactMarkdown>
                        {isStreaming ? (
                          <span
                            ref={(node) => {
                              if (isStreaming) {
                                aiCursorRef.current = node;
                              }
                            }}
                            className="ml-1 inline-block align-baseline font-mono text-accent animate-pulse"
                          >
                            ▉
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500 dark:text-slate-400">
                        No generated lecture for this page yet.
                      </p>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-zinc-600 dark:text-slate-400">
                Upload a PDF and generate at least one page to begin.
              </p>
            )}
            <div ref={bottomAnchorRef} className="h-1" />
          </div>
        </div>

        {showResumeButton && isGenerating ? (
          <button
            type="button"
            onClick={resumeAutoScroll}
            className="absolute bottom-20 left-1/2 z-20 flex -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full bg-blue-500/80 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur animate-bounce"
          >
            <span aria-hidden="true"></span>
            New content generating...
          </button>
        ) : null}

        <div className="shrink-0 border-t border-white/20 bg-white/10 p-4 backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-zinc-600 dark:text-slate-400">
              {`Pages: ${pageCount}${
                copyStatusText
                  ? ` · ${copyStatusText}`
                  : !isMappingPhase && generationStatusText
                    ? ` · ${generationStatusText}`
                    : ""
              }`}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void copyFullNotes();
                }}
                disabled={!isReady}
                className="rounded-md border border-white/40 bg-white/20 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600/70 dark:bg-slate-800/45 dark:text-slate-200 dark:hover:bg-slate-700/55"
              >
                Copy Full Notes
              </button>
              <button
                type="button"
                onClick={downloadFullNotes}
                disabled={!isReady}
                className="rounded-md border border-white/40 bg-white/20 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600/70 dark:bg-slate-800/45 dark:text-slate-200 dark:hover:bg-slate-700/55"
              >
                Download .md
              </button>
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}
