"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { DiagnosticsModal } from "@/components/diagnostics-modal";
import { DualPaneReader } from "@/components/dual-pane-reader";
import { PdfUploadZone } from "@/components/pdf-upload-zone";
import { SettingsModal } from "@/components/settings-modal";
import { usePdf } from "@/context/pdf-context";
import { useSettings } from "@/context/settings-context";
import { CONTEXT_MODE_LABELS } from "@/types/settings";

export function LecturerShell() {
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    documentData,
    sourceFile,
    isProcessing,
    processingError,
    progress,
    clearPdf,
  } = usePdf();
  const { settings } = useSettings();
  const { resolvedTheme, setTheme } = useTheme();

  const compressionSummary = useMemo(
    () =>
      `Render scale ${settings.compression.renderScale.toFixed(2)}, JPEG quality ${settings.compression.jpegQuality.toFixed(2)}`,
    [settings.compression.jpegQuality, settings.compression.renderScale],
  );
  const isDarkTheme = resolvedTheme === "dark";

  return (
    <div className="min-h-screen p-4 text-slate-900 dark:text-slate-100 md:p-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/45 bg-white/30 shadow-2xl backdrop-blur-xl dark:border-slate-700/55 dark:bg-slate-900/45">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/50 bg-white/25 px-6 py-4 backdrop-blur-md dark:border-slate-700/55 dark:bg-slate-900/35">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/70 bg-white/45 shadow-sm dark:border-slate-600/70 dark:bg-slate-800/65">
              <svg
                viewBox="0 0 48 48"
                aria-hidden="true"
                className="h-6 w-6 text-accent"
              >
                <path
                  d="M8 16 24 8l16 8-16 8-16-8Zm4 6.2V32l12 6 12-6v-9.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="font-serif text-3xl leading-none tracking-tight text-zinc-900 dark:text-slate-100">
              Lecturer
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Open activity diagnostics"
              onClick={() => setIsDiagnosticsOpen(true)}
              className="rounded-lg border border-white/70 bg-white/60 p-2 text-zinc-800 hover:bg-white dark:border-slate-600/70 dark:bg-slate-800/75 dark:text-slate-100 dark:hover:bg-slate-700/80"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M3 12h3l2-5 4 10 2-5h7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={() => {
                setTheme(isDarkTheme ? "light" : "dark");
              }}
              className="rounded-lg border border-white/70 bg-white/60 p-2 text-zinc-800 hover:bg-white dark:border-slate-600/70 dark:bg-slate-800/75 dark:text-slate-100 dark:hover:bg-slate-700/80"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 dark:hidden"
                aria-hidden="true"
              >
                <path
                  d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <svg
                viewBox="0 0 24 24"
                className="hidden h-4 w-4 dark:block"
                aria-hidden="true"
              >
                <path
                  d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36 6.36-1.41-1.41M7.05 7.05 5.64 5.64m12.72 0-1.41 1.41M7.05 16.95l-1.41 1.41M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={clearPdf}
              disabled={!documentData || isProcessing}
              className="rounded-lg border border-white/70 bg-white/60 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600/70 dark:bg-slate-800/75 dark:text-slate-100 dark:hover:bg-slate-700/80"
            >
              Clear PDF
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
            >
              Open Settings
            </button>
          </div>
        </header>

        <main className="space-y-6 px-6 py-6">
          <section className="grid gap-4 lg:grid-cols-3">
            <PdfUploadZone />

            <section className="rounded-2xl border border-white/50 bg-white/35 p-5 shadow-lg backdrop-blur-md dark:border-slate-700/55 dark:bg-slate-900/52">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-slate-100">
                Render Status
              </h2>
              <dl className="mt-3 grid grid-cols-[130px_1fr] gap-y-2 text-sm">
                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  File
                </dt>
                <dd className="break-all">{sourceFile?.name ?? "None"}</dd>

                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Title
                </dt>
                <dd className="break-all">{documentData?.title ?? "N/A"}</dd>

                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Pages
                </dt>
                <dd>{documentData?.totalPages ?? 0}</dd>

                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Progress
                </dt>
                <dd>
                  {progress
                    ? `${progress.currentPage}/${progress.totalPages}`
                    : isProcessing
                      ? "Preparing..."
                      : "Idle"}
                </dd>

                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Compression
                </dt>
                <dd>{compressionSummary}</dd>
              </dl>
            </section>

            <section className="rounded-2xl border border-white/50 bg-white/35 p-5 shadow-lg backdrop-blur-md dark:border-slate-700/55 dark:bg-slate-900/52">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-slate-100">
                Settings Snapshot
              </h2>
              <dl className="mt-3 grid grid-cols-[100px_1fr] gap-y-2 text-sm">
                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Provider
                </dt>
                <dd className="uppercase">{settings.providerType}</dd>

                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Base URL
                </dt>
                <dd className="break-all">{settings.baseUrl || "Not set"}</dd>

                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Model
                </dt>
                <dd className="break-all">{settings.modelName || "Not set"}</dd>

                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Context
                </dt>
                <dd className="break-all">
                  {CONTEXT_MODE_LABELS[settings.contextMode]}
                </dd>

                <dt className="font-medium text-zinc-600 dark:text-slate-400">
                  Language
                </dt>
                <dd className="break-all">
                  {settings.outputLanguage || "English"}
                </dd>
              </dl>
            </section>

            {processingError ? (
              <section className="rounded-2xl border border-red-300/70 bg-red-50/90 p-4 text-sm text-red-700 shadow-sm backdrop-blur-sm">
                {processingError}
              </section>
            ) : null}
          </section>

          <DualPaneReader />
        </main>
      </div>

      {isDiagnosticsOpen ? (
        <DiagnosticsModal onClose={() => setIsDiagnosticsOpen(false)} />
      ) : null}

      {isSettingsOpen ? (
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />
      ) : null}
    </div>
  );
}
