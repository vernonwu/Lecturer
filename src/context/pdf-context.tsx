"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useSettings } from "@/context/settings-context";
import { renderPdfFileToJpegPages } from "@/lib/pdf-processing";
import type { PdfDocumentData } from "@/types/pdf";

interface RenderProgress {
  currentPage: number;
  totalPages: number;
}

export interface PageGenerationState {
  lectureMarkdown: string;
  memoryUpdate: string;
  isGenerating: boolean;
  error: string | null;
}

interface PdfContextValue {
  documentData: PdfDocumentData | null;
  sourceFile: File | null;
  isProcessing: boolean;
  processingError: string | null;
  progress: RenderProgress | null;
  currentPage: number;
  pageGenerations: Record<number, PageGenerationState>;
  processPdfFile: (file: File) => Promise<void>;
  clearPdf: () => void;
  setCurrentPage: (pageNumber: number) => void;
  updatePageGeneration: (
    pageNumber: number,
    updater: (current: PageGenerationState) => PageGenerationState,
  ) => void;
  resetPageGenerations: () => void;
}

const PdfContext = createContext<PdfContextValue | undefined>(undefined);
const EMPTY_PAGE_GENERATION: PageGenerationState = {
  lectureMarkdown: "",
  memoryUpdate: "",
  isGenerating: false,
  error: null,
};

function isPdfFile(file: File) {
  const byMime = file.type === "application/pdf";
  const byName = /\.pdf$/i.test(file.name);
  return byMime || byName;
}

export function PdfProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [documentData, setDocumentData] = useState<PdfDocumentData | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageGenerations, setPageGenerations] = useState<
    Record<number, PageGenerationState>
  >({});

  const resetPageGenerations = useCallback(() => {
    setPageGenerations({});
  }, []);

  const updatePageGeneration = useCallback(
    (
      pageNumber: number,
      updater: (current: PageGenerationState) => PageGenerationState,
    ) => {
      setPageGenerations((current) => {
        const currentState = current[pageNumber] ?? EMPTY_PAGE_GENERATION;
        return {
          ...current,
          [pageNumber]: updater(currentState),
        };
      });
    },
    [],
  );

  const clearPdf = useCallback(() => {
    setDocumentData(null);
    setSourceFile(null);
    setIsProcessing(false);
    setProcessingError(null);
    setProgress(null);
    setCurrentPage(1);
    setPageGenerations({});
  }, []);

  const processPdfFile = useCallback(async (file: File) => {
    if (!isPdfFile(file)) {
      setProcessingError("Unsupported file type. Please upload a .pdf file.");
      return;
    }

    setIsProcessing(true);
    setProcessingError(null);
    setProgress(null);
    setDocumentData(null);
    setSourceFile(file);
    setCurrentPage(1);
    setPageGenerations({});

    try {
      const processedDocument = await renderPdfFileToJpegPages(file, {
        compression: settings.compression,
        onPageRendered: (current, total) => {
          setProgress({ currentPage: current, totalPages: total });
        },
      });

      setDocumentData(processedDocument);
      setProgress({
        currentPage: processedDocument.totalPages,
        totalPages: processedDocument.totalPages,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to render PDF. Please try again.";
      setProcessingError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [settings.compression]);

  const value = useMemo(
    () => ({
      documentData,
      sourceFile,
      isProcessing,
      processingError,
      progress,
      currentPage,
      pageGenerations,
      processPdfFile,
      clearPdf,
      setCurrentPage,
      updatePageGeneration,
      resetPageGenerations,
    }),
    [
      documentData,
      sourceFile,
      isProcessing,
      processingError,
      progress,
      currentPage,
      pageGenerations,
      processPdfFile,
      clearPdf,
      setCurrentPage,
      updatePageGeneration,
      resetPageGenerations,
    ],
  );

  return <PdfContext.Provider value={value}>{children}</PdfContext.Provider>;
}

export function usePdf() {
  const context = useContext(PdfContext);
  if (!context) {
    throw new Error("usePdf must be used inside PdfProvider.");
  }
  return context;
}
