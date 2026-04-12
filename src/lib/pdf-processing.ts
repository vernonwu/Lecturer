import { getPdfJs } from "@/lib/pdfjs-client";
import {
  PDF_RENDER_BASE_SCALE,
  PDF_JPEG_QUALITY,
  type PdfCompressionSettings,
  type PdfDocumentData,
  type ProcessedPdfPage,
} from "@/types/pdf";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

interface RenderPdfOptions {
  onPageRendered?: (currentPage: number, totalPages: number) => void;
  compression?: PdfCompressionSettings;
}

function deriveTitleFromFilename(fileName: string) {
  const withoutExtension = fileName.replace(/\.pdf$/i, "").trim();
  return withoutExtension || "Untitled PDF";
}

async function renderPageToCompressedJpeg(
  pdfDocument: PDFDocumentProxy,
  pageNumber: number,
  compression: PdfCompressionSettings,
): Promise<ProcessedPdfPage> {
  const page = await pdfDocument.getPage(pageNumber);
  const deviceScale =
    typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
  const scaleFactor = Math.max(compression.renderScale, deviceScale);
  const renderViewport = page.getViewport({ scale: scaleFactor });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(renderViewport.width));
  canvas.height = Math.max(1, Math.round(renderViewport.height));

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  await page.render({
    canvas,
    canvasContext: context,
    viewport: renderViewport,
  }).promise;

  const imageDataUrl = canvas.toDataURL("image/jpeg", compression.jpegQuality);
  page.cleanup();

  return {
    pageNumber,
    width: canvas.width,
    height: canvas.height,
    scaleFactor,
    imageDataUrl,
  };
}

export async function renderPdfFileToJpegPages(
  file: File,
  options: RenderPdfOptions = {},
): Promise<PdfDocumentData> {
  const compression: PdfCompressionSettings = {
    renderScale: options.compression?.renderScale ?? PDF_RENDER_BASE_SCALE,
    jpegQuality: options.compression?.jpegQuality ?? PDF_JPEG_QUALITY,
  };
  const pdfjs = await getPdfJs();
  const rawBytes = await file.arrayBuffer();
  const cMapUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`;
  const loadingTask = pdfjs.getDocument({
    data: rawBytes,
    cMapUrl,
    cMapPacked: true,
  });

  try {
    const pdfDocument = await loadingTask.promise;
    const pages: ProcessedPdfPage[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const pageData = await renderPageToCompressedJpeg(
        pdfDocument,
        pageNumber,
        compression,
      );
      pages.push(pageData);
      options.onPageRendered?.(pageNumber, pdfDocument.numPages);
    }

    pdfDocument.cleanup();
    await pdfDocument.destroy();

    return {
      fileName: file.name,
      title: deriveTitleFromFilename(file.name),
      totalPages: pages.length,
      pages,
    };
  } finally {
    await loadingTask.destroy();
  }
}
