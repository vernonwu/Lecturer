"use client";

import { useRef, useState } from "react";
import { usePdf } from "@/context/pdf-context";

export function PdfUploadZone() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { isProcessing, processPdfFile } = usePdf();

  const onOpenPicker = () => {
    inputRef.current?.click();
  };

  const onFilePicked = async (file: File | null) => {
    if (!file) {
      return;
    }
    await processPdfFile(file);
  };

  return (
    <section
      className={[
        "rounded-2xl border-2 border-dashed p-6 shadow-lg backdrop-blur-md transition-colors",
        isDragging
          ? "border-accent bg-white/55 dark:bg-slate-800/65"
          : "border-white/60 bg-white/35 dark:border-slate-700/60 dark:bg-slate-900/52",
        isProcessing ? "pointer-events-none opacity-75" : "",
      ].join(" ")}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragging(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files?.[0] ?? null;
        await onFilePicked(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const inputElement = event.currentTarget;
          const file = inputElement.files?.[0] ?? null;
          inputElement.value = "";
          void onFilePicked(file);
        }}
      />

      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-lg font-semibold text-zinc-900 dark:text-slate-100">Upload Academic PDF</p>
        <p className="max-w-lg text-sm text-zinc-600 dark:text-slate-400">
          Drag and drop a PDF here, or choose a file. Pages are rendered
          client-side via PDF.js at high scale and compressed as high-quality
          JPEG for readability.
        </p>
        <button
          type="button"
          onClick={onOpenPicker}
          disabled={isProcessing}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Choose PDF
        </button>
      </div>
    </section>
  );
}
