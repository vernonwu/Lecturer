"use client";

import Image from "next/image";
import { usePdf } from "@/context/pdf-context";
import { usePageGeneration } from "@/hooks/use-page-generation";

export function PdfPageGallery() {
  const { documentData, currentPage, setCurrentPage, pageGenerations } = usePdf();
  const { generatePage } = usePageGeneration();

  if (!documentData) {
    return (
      <div className="rounded-2xl border border-border bg-white p-5 text-sm text-zinc-600">
        No PDF loaded yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {documentData.pages.map((page) => {
        const isActive = page.pageNumber === currentPage;
        const generation = pageGenerations[page.pageNumber];
        return (
          <article
            key={page.pageNumber}
            className={[
              "overflow-hidden rounded-2xl border bg-white shadow-sm",
              isActive ? "border-accent" : "border-border",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => setCurrentPage(page.pageNumber)}
              className="flex w-full items-center justify-between border-b border-border px-4 py-2 text-left text-xs text-zinc-600 hover:bg-panel-strong"
            >
              <span className="font-semibold text-zinc-700">
                Page {page.pageNumber}
              </span>
              <span>
                {page.width} × {page.height} · scale {page.scaleFactor.toFixed(3)}
              </span>
            </button>
            <Image
              src={page.imageDataUrl}
              alt={`PDF page ${page.pageNumber}`}
              width={page.width}
              height={page.height}
              unoptimized
              className="h-auto w-full"
            />
            <div className="space-y-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  void generatePage(page.pageNumber);
                }}
                disabled={generation?.isGenerating}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generation?.isGenerating ? "Generating..." : "Generate"}
              </button>

              {generation?.error ? (
                <p className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">
                  {generation.error}
                </p>
              ) : null}

              {generation?.lectureMarkdown ? (
                <pre className="max-h-48 overflow-auto rounded-md border border-border bg-panel p-2 text-xs whitespace-pre-wrap text-zinc-800">
                  {generation.lectureMarkdown}
                </pre>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
