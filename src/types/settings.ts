import {
  PDF_JPEG_QUALITY,
  PDF_RENDER_BASE_SCALE,
  type PdfCompressionSettings,
} from "@/types/pdf";

export type ProviderType = "openai" | "anthropic" | "gemini" | "custom";
export type GenerationContextMode = "fast" | "full";

export const COMPRESSION_LIMITS = {
  renderScaleMin: 1,
  renderScaleMax: 4,
  jpegQualityMin: 0.5,
  jpegQualityMax: 1,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCompressionSettings(
  compression: Partial<PdfCompressionSettings> | undefined,
): PdfCompressionSettings {
  const renderScale =
    typeof compression?.renderScale === "number"
      ? compression.renderScale
      : PDF_RENDER_BASE_SCALE;
  const jpegQuality =
    typeof compression?.jpegQuality === "number"
      ? compression.jpegQuality
      : PDF_JPEG_QUALITY;

  return {
    renderScale: clamp(
      renderScale,
      COMPRESSION_LIMITS.renderScaleMin,
      COMPRESSION_LIMITS.renderScaleMax,
    ),
    jpegQuality: clamp(
      jpegQuality,
      COMPRESSION_LIMITS.jpegQualityMin,
      COMPRESSION_LIMITS.jpegQualityMax,
    ),
  };
}

export interface LecturerSettings {
  providerType: ProviderType;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  contextMode: GenerationContextMode;
  outputLanguage: string;
  customPrompt: string;
  compression: PdfCompressionSettings;
}

export const SETTINGS_STORAGE_KEY = "lecturer.settings.v1";

export const DEFAULT_BASE_URL_BY_PROVIDER: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  custom: "http://localhost:11434/v1",
};

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderType, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-7-sonnet-latest",
  gemini: "gemini-2.5-flash",
  custom: "llava:latest",
};

export const OUTPUT_LANGUAGE_SUGGESTIONS = [
  "English",
  "中文",
  "日本語",
  "한국어",
  "Español",
  "Français",
  "Deutsch",
  "Português",
  "Italiano",
  "Nederlands",
  "Polski",
  "Русский",
  "العربية",
  "हिन्दी",
] as const;

export const CONTEXT_MODE_LABELS: Record<GenerationContextMode, string> = {
  fast: "Fast (Default)",
  full: "Full",
};

export const CONTEXT_MODE_TOOLTIPS: Record<GenerationContextMode, string> = {
  fast: "Optimized for speed and token savings. Uses a rolling summary.",
  full: "Highest precision for complex derivations. Passes all previous notes as context.",
};

export const DEFAULT_SETTINGS: LecturerSettings = {
  providerType: "openai",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL_BY_PROVIDER.openai,
  modelName: DEFAULT_MODEL_BY_PROVIDER.openai,
  contextMode: "fast",
  outputLanguage: "English",
  customPrompt: "",
  compression: normalizeCompressionSettings(undefined),
};
