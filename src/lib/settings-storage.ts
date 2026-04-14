import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  normalizeMaxConcurrentRequests,
  normalizeCompressionSettings,
  type GenerationContextMode,
  type LecturerSettings,
  type ProviderType,
} from "@/types/settings";

let cachedRawSettings: string | null | undefined;
let cachedParsedSettings: LecturerSettings = DEFAULT_SETTINGS;

function isProviderType(value: unknown): value is ProviderType {
  return (
    value === "openai" ||
    value === "anthropic" ||
    value === "gemini" ||
    value === "custom"
  );
}

function isGenerationContextMode(value: unknown): value is GenerationContextMode {
  return value === "fast" || value === "full";
}

function parseSettings(storedValue: string | null): LecturerSettings {
  if (!storedValue) {
    return DEFAULT_SETTINGS;
  }
  try {
    const parsed = JSON.parse(storedValue) as Partial<LecturerSettings>;
    if (!isProviderType(parsed.providerType)) {
      return DEFAULT_SETTINGS;
    }

    return {
      providerType: parsed.providerType,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      baseUrl:
        typeof parsed.baseUrl === "string"
          ? parsed.baseUrl
          : DEFAULT_SETTINGS.baseUrl,
      modelName:
        typeof parsed.modelName === "string"
          ? parsed.modelName
          : DEFAULT_SETTINGS.modelName,
      contextMode: isGenerationContextMode(parsed.contextMode)
        ? parsed.contextMode
        : DEFAULT_SETTINGS.contextMode,
      maxConcurrentRequests: normalizeMaxConcurrentRequests(
        parsed.maxConcurrentRequests,
      ),
      outputLanguage:
        typeof parsed.outputLanguage === "string" && parsed.outputLanguage.trim()
          ? parsed.outputLanguage
          : DEFAULT_SETTINGS.outputLanguage,
      customPrompt:
        typeof parsed.customPrompt === "string"
          ? parsed.customPrompt
          : DEFAULT_SETTINGS.customPrompt,
      compression: normalizeCompressionSettings(
        typeof parsed.compression === "object" &&
          parsed.compression !== null &&
          !Array.isArray(parsed.compression)
          ? parsed.compression
          : undefined,
      ),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function loadSettingsFromStorage(): LecturerSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  const storedValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (storedValue === cachedRawSettings) {
    return cachedParsedSettings;
  }

  cachedRawSettings = storedValue;
  cachedParsedSettings = parseSettings(storedValue);
  return cachedParsedSettings;
}

export function saveSettingsToStorage(settings: LecturerSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedSettings: LecturerSettings = {
    ...settings,
    maxConcurrentRequests: normalizeMaxConcurrentRequests(
      settings.maxConcurrentRequests,
    ),
    compression: normalizeCompressionSettings(settings.compression),
  };

  const serializedSettings = JSON.stringify(normalizedSettings);
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, serializedSettings);
  cachedRawSettings = serializedSettings;
  cachedParsedSettings = {
    ...normalizedSettings,
    compression: { ...normalizedSettings.compression },
  };
}
