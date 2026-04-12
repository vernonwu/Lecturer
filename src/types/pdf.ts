export const PDF_RENDER_BASE_SCALE = 2.0;
export const PDF_JPEG_QUALITY = 0.95;

export interface PdfCompressionSettings {
  renderScale: number;
  jpegQuality: number;
}

export interface ProcessedPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  scaleFactor: number;
  imageDataUrl: string;
}

export interface PdfDocumentData {
  fileName: string;
  title: string;
  totalPages: number;
  pages: ProcessedPdfPage[];
}
