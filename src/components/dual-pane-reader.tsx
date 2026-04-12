"use client";

import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { usePdf } from "@/context/pdf-context";
import { usePageGeneration } from "@/hooks/use-page-generation";
import { PdfPageCanvas } from "@/components/pdf-page-canvas";

const OBSERVER_MARGIN = "-20% 0px -70% 0px";
const OBSERVER_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];
const PROGRAMMATIC_LOCK_MS = 800;
const MARKDOWN_OBSERVER_DEBOUNCE_MS = 100;

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

export function DualPaneReader() {
  const { documentData, currentPage, setCurrentPage, pageGenerations } = usePdf();
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
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

  const pageCount = documentData?.totalPages ?? 0;

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
    };
  }, []);

  const withProgrammaticLock = useCallback(
    (options: { scrollAction: () => void; lockTargets: Array<HTMLElement | null> }) => {
      const lockTargets = Array.from(
        new Set(options.lockTargets.filter((target): target is HTMLElement => Boolean(target))),
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

  const scrollPdfToPage = useCallback((pageNumber: number, behavior: ScrollBehavior) => {
    const target = pdfContainerRef.current?.querySelector<HTMLElement>(
      `[data-pdf-page="${pageNumber}"]`,
    );
    target?.scrollIntoView({ behavior, block: "start" });
  }, []);

  const scrollMarkdownToPage = useCallback(
    (pageNumber: number, behavior: ScrollBehavior) => {
      const target = markdownContainerRef.current?.querySelector<HTMLElement>(
        `[data-page="${pageNumber}"]`,
      );
      target?.scrollIntoView({ behavior, block: "start" });
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
      jumpToPage(pageNumber, { behavior: "smooth", syncPdf: true, syncMarkdown: true });
    },
    [jumpToPage],
  );

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
        const best = pickClosestIntersection(entries, rootBounds.top, rootBounds.height);
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
        const best = pickClosestIntersection(entries, rootBounds.top, rootBounds.height);
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
    if (generationMode === "full" && queueProgress) {
      const pageLabel = activePage ? ` · Page ${activePage}` : "";
      return `Generating full document ${queueProgress.current}/${queueProgress.total}${pageLabel}`;
    }
    if (activePage) {
      return `Generating page ${activePage}...`;
    }
    return "Generating...";
  }, [activePage, generationMode, isGenerating, queueProgress]);

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

  return (
    <section className="grid h-[72vh] min-h-[560px] gap-4 md:grid-cols-2">
      <article className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/55 bg-white/32 shadow-xl backdrop-blur-md dark:border-slate-700/55 dark:bg-slate-900/50">
        <header className="border-b border-white/55 bg-white/30 px-4 py-3 backdrop-blur-sm dark:border-slate-700/55 dark:bg-slate-900/45">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-slate-100">PDF Viewer</h3>
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
                  isGenerating ? "bg-red-600 hover:bg-red-500" : "bg-accent hover:opacity-90",
                ].join(" ")}
              >
                {isGenerating ? "Cancel Generation" : "Generate Full Document"}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-slate-400">
            {generationStatusText ?? "Ready to generate."}
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
              <p className="text-sm text-zinc-600 dark:text-slate-400">No PDF loaded yet.</p>
            </div>
          )}
        </div>
      </article>

      <article className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/55 bg-white/32 shadow-xl backdrop-blur-md dark:border-slate-700/55 dark:bg-slate-900/50">
        <header className="border-b border-white/55 bg-white/30 px-4 py-3 backdrop-blur-sm dark:border-slate-700/55 dark:bg-slate-900/45">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-slate-100">Markdown Notes Stream</h3>
          <p className="mt-1 text-xs text-zinc-600 dark:text-slate-400">{notesHeaderText}</p>
        </header>

        <div
          ref={markdownContainerRef}
          data-pane="markdown"
          className="min-h-0 flex-1 overflow-auto"
        >
          <div className="space-y-4 p-4 pb-6">
            {documentData?.pages.length ? (
              documentData.pages.map((page) => {
                const generation = pageGenerations[page.pageNumber];
                const active = page.pageNumber === currentPage;
                const isPageGenerating =
                  isGenerating && activePage === page.pageNumber;
                return (
                  <div
                    key={page.pageNumber}
                    data-page={page.pageNumber}
                    onClick={(event) => onMarkdownCardClick(page.pageNumber, event)}
                    className={[
                      "cursor-pointer rounded-xl border bg-panel px-4 py-3 text-zinc-800 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:text-slate-100 dark:hover:bg-slate-800",
                      active
                        ? "border-accent shadow-[0_0_0_0.9px_rgba(15,91,143,0.35),0_12px_22px_-14px_rgba(15,91,143,0.6)]"
                        : "border-border/70 dark:border-slate-700/75",
                    ].join(" ")}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="inline-flex rounded-full border border-white/70 bg-white/75 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-700 dark:border-slate-600/70 dark:bg-slate-800/85 dark:text-slate-300">
                        Page {page.pageNumber}
                      </span>
                      {isPageGenerating ? (
                        <span className="text-xs font-medium text-accent">
                          Generating...
                        </span>
                      ) : null}
                    </div>

                    {generation?.error ? (
                      <p className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700/70 dark:bg-red-900/35 dark:text-red-200">
                        {generation.error}
                      </p>
                    ) : null}

                    {generation?.lectureMarkdown ? (
                      <div className="markdown-content prose prose-slate max-w-none select-text dark:prose-invert">
                        <ReactMarkdown
                          remarkPlugins={[remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {generation.lectureMarkdown}
                        </ReactMarkdown>
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
          </div>
        </div>

        <div className="shrink-0 border-t border-white/20 bg-white/10 p-4 backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-zinc-600 dark:text-slate-400">
              {`Pages: ${pageCount}${
                copyStatusText
                  ? ` · ${copyStatusText}`
                  : generationStatusText
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
