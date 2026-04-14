"use client";

import { useMemo, useState } from "react";
import { useSettings } from "@/context/settings-context";
import {
  CONCURRENCY_LIMITS,
  COMPRESSION_LIMITS,
  CONTEXT_MODE_LABELS,
  CONTEXT_MODE_TOOLTIPS,
  DEFAULT_BASE_URL_BY_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SETTINGS,
  OUTPUT_LANGUAGE_SUGGESTIONS,
  normalizeMaxConcurrentRequests,
  normalizeCompressionSettings,
  type GenerationContextMode,
  type LecturerSettings,
  type ProviderType,
} from "@/types/settings";

interface SettingsModalProps {
  onClose: () => void;
}

const providerLabels: Record<ProviderType, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  custom: "Custom / Local (Ollama, vLLM)",
};

const contextModeOptions: GenerationContextMode[] = ["fast", "full"];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useSettings();
  const [draft, setDraft] = useState<LecturerSettings>(settings);
  const presetLanguages = OUTPUT_LANGUAGE_SUGGESTIONS;
  const isPresetLanguage = useMemo(
    () =>
      presetLanguages.includes(
        draft.outputLanguage as (typeof OUTPUT_LANGUAGE_SUGGESTIONS)[number],
      ),
    [draft.outputLanguage, presetLanguages],
  );
  const selectedLanguageValue = isPresetLanguage
    ? draft.outputLanguage
    : "__custom__";

  const onProviderChange = (nextProvider: ProviderType) => {
    setDraft((current) => {
      const keepBaseUrl =
        current.baseUrl !== "" &&
        current.baseUrl !== DEFAULT_BASE_URL_BY_PROVIDER[current.providerType];
      const keepModelName =
        current.modelName !== "" &&
        current.modelName !== DEFAULT_MODEL_BY_PROVIDER[current.providerType];

      return {
        ...current,
        providerType: nextProvider,
        baseUrl: keepBaseUrl
          ? current.baseUrl
          : DEFAULT_BASE_URL_BY_PROVIDER[nextProvider],
        modelName: keepModelName
          ? current.modelName
          : DEFAULT_MODEL_BY_PROVIDER[nextProvider],
      };
    });
  };

  const save = () => {
    updateSettings({
      ...draft,
      outputLanguage:
        draft.outputLanguage.trim() || DEFAULT_SETTINGS.outputLanguage,
      customPrompt: draft.customPrompt.trim(),
      maxConcurrentRequests: normalizeMaxConcurrentRequests(
        draft.maxConcurrentRequests,
      ),
      compression: normalizeCompressionSettings(draft.compression),
    });
    onClose();
  };

  const resetDraft = () => {
    setDraft(DEFAULT_SETTINGS);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/55"
      />
      <section className="relative z-10 flex max-h-[calc(100dvh-3rem)] w-full max-w-2xl flex-col rounded-2xl border border-white/50 bg-white/40 p-6 text-zinc-900 shadow-2xl backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/82 dark:text-slate-100">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">General Settings</h2>
            <p className="mt-1 text-sm text-zinc-700 dark:text-slate-400">
              Keys are stored only in this browser via localStorage.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/70 bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-white dark:border-slate-600/70 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-700/80"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Model Provider</span>
              <select
                value={draft.providerType}
                onChange={(event) =>
                  onProviderChange(event.target.value as ProviderType)
                }
                className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
              >
                {Object.entries(providerLabels).map(([provider, label]) => (
                  <option key={provider} value={provider}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium">API Key</span>
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder="sk-..."
                className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Base URL</span>
              <input
                type="url"
                value={draft.baseUrl}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))
                }
                placeholder="https://api.openai.com/v1"
                className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Model Name</span>
              <input
                type="text"
                value={draft.modelName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    modelName: event.target.value,
                  }))
                }
                placeholder="gpt-4.1-mini"
                className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
              />
            </label>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">
                Context Precision Mode
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {contextModeOptions.map((mode) => {
                  const selected = draft.contextMode === mode;
                  return (
                    <label
                      key={mode}
                      title={CONTEXT_MODE_TOOLTIPS[mode]}
                      className={[
                        "grid gap-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                        selected
                          ? "border-accent bg-accent/10"
                          : "border-border/80 bg-white/90 dark:border-slate-700/70 dark:bg-slate-800/70",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="context-mode"
                          value={mode}
                          checked={selected}
                          onChange={() =>
                            setDraft((current) => ({
                              ...current,
                              contextMode: mode,
                            }))
                          }
                        />
                        <span className="font-medium">
                          {CONTEXT_MODE_LABELS[mode]}
                        </span>
                      </span>
                      <span className="text-xs text-zinc-600 dark:text-slate-400">
                        {CONTEXT_MODE_TOOLTIPS[mode]}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Max Concurrent Requests</span>
              <input
                type="number"
                min={CONCURRENCY_LIMITS.min}
                max={CONCURRENCY_LIMITS.max}
                step={1}
                value={draft.maxConcurrentRequests}
                onChange={(event) => {
                  const parsedValue = Number.parseInt(event.target.value, 10);
                  if (Number.isNaN(parsedValue)) {
                    return;
                  }
                  setDraft((current) => ({
                    ...current,
                    maxConcurrentRequests: parsedValue,
                  }));
                }}
                className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
              />
              <span className="text-xs text-zinc-600 dark:text-slate-400">
                Controls concurrent takeaway mapping requests ({CONCURRENCY_LIMITS.min}-
                {CONCURRENCY_LIMITS.max}).
              </span>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Output Language</span>
              <select
                value={selectedLanguageValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "__custom__") {
                    setDraft((current) => ({
                      ...current,
                      outputLanguage: isPresetLanguage
                        ? ""
                        : current.outputLanguage,
                    }));
                    return;
                  }
                  setDraft((current) => ({
                    ...current,
                    outputLanguage: nextValue,
                  }));
                }}
                className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
              >
                {presetLanguages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
              {selectedLanguageValue === "__custom__" ? (
                <input
                  type="text"
                  value={draft.outputLanguage}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      outputLanguage: event.target.value,
                    }))
                  }
                  placeholder="Enter language"
                  className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
                />
              ) : null}
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium">
                Custom Prompt / Instructions
              </span>
              <textarea
                value={draft.customPrompt}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    customPrompt: event.target.value,
                  }))
                }
                placeholder="Explain it like I am 5. Focus only on equations."
                rows={4}
                className="resize-y rounded-lg border border-border/80 bg-white/90 px-3 py-2 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
              />
            </label>

            <div className="rounded-lg border border-border/80 bg-panel-strong/65 p-3 dark:border-slate-700/70 dark:bg-slate-800/60">
              <p className="text-sm font-semibold">Compression Parameters</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">Render Scale</span>
                  <input
                    type="number"
                    min={COMPRESSION_LIMITS.renderScaleMin}
                    max={COMPRESSION_LIMITS.renderScaleMax}
                    step={0.1}
                    value={draft.compression.renderScale}
                    onChange={(event) => {
                      const parsedValue = Number.parseFloat(event.target.value);
                      if (Number.isNaN(parsedValue)) {
                        return;
                      }
                      setDraft((current) => ({
                        ...current,
                        compression: {
                          ...current.compression,
                          renderScale: parsedValue,
                        },
                      }));
                    }}
                    className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">JPEG Quality</span>
                  <input
                    type="number"
                    min={COMPRESSION_LIMITS.jpegQualityMin}
                    max={COMPRESSION_LIMITS.jpegQualityMax}
                    step={0.01}
                    value={draft.compression.jpegQuality}
                    onChange={(event) => {
                      const parsedValue = Number.parseFloat(event.target.value);
                      if (Number.isNaN(parsedValue)) {
                        return;
                      }
                      setDraft((current) => ({
                        ...current,
                        compression: {
                          ...current.compression,
                          jpegQuality: parsedValue,
                        },
                      }));
                    }}
                    className="h-11 rounded-lg border border-border/80 bg-white/90 px-3 text-sm outline-none focus:border-accent dark:border-slate-700/70 dark:bg-slate-800/85 dark:text-slate-100"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={resetDraft}
            className="rounded-md border border-white/70 bg-white/70 px-3 py-2 text-sm font-medium hover:bg-white dark:border-slate-600/70 dark:bg-slate-800/70 dark:hover:bg-slate-700/80"
          >
            Reset Form
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Save Settings
          </button>
        </footer>
      </section>
    </div>
  );
}
