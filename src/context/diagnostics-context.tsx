"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

const TOKENS_PER_CHAR = 0.25;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000;

interface ActiveSlideRun {
  pageNumber: number;
  startedAtMs: number;
  outputChars: number;
  contextTokens: number;
  contextWindowTokens: number;
}

export interface DiagnosticsSample {
  sample: number;
  pageNumber: number;
  elapsedSeconds: number;
  tps: number;
  avgTps: number;
  contextOccupancyPct: number;
  contextTokens: number;
  contextWindowTokens: number;
}

interface DiagnosticsTotals {
  totalOutputChars: number;
  totalDurationMs: number;
  generatedSlides: number;
}

interface DiagnosticsState {
  sessionStartedAtMs: number;
  totals: DiagnosticsTotals;
  samples: DiagnosticsSample[];
  activeRuns: Record<number, ActiveSlideRun>;
}

interface BeginSlidePayload {
  pageNumber: number;
  contextTokens: number;
  contextWindowTokens?: number;
}

interface RecordChunkPayload {
  pageNumber: number;
  chunk: string;
}

interface FinishSlidePayload {
  pageNumber: number;
  success: boolean;
}

interface DiagnosticsStateValue {
  samples: DiagnosticsSample[];
  avgTps: number;
  avgLatencyMs: number;
  totalTokensConsumed: number;
  generatedSlides: number;
  totalTimeMs: number;
  latestTps: number;
  latestContextTokens: number;
  latestContextWindowTokens: number;
  latestContextOccupancyPct: number;
}

interface DiagnosticsActionsValue {
  beginSlide: (payload: BeginSlidePayload) => void;
  recordChunk: (payload: RecordChunkPayload) => void;
  finishSlide: (payload: FinishSlidePayload) => void;
  resetDiagnostics: () => void;
}

const DiagnosticsStateContext = createContext<DiagnosticsStateValue | undefined>(
  undefined,
);
const DiagnosticsActionsContext = createContext<DiagnosticsActionsValue | undefined>(
  undefined,
);

function nowMs() {
  if (typeof performance !== "undefined") {
    return performance.now();
  }
  return Date.now();
}

function initialState(): DiagnosticsState {
  return {
    sessionStartedAtMs: nowMs(),
    totals: {
      totalOutputChars: 0,
      totalDurationMs: 0,
      generatedSlides: 0,
    },
    samples: [],
    activeRuns: {},
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function charsToTokens(value: number) {
  return value * TOKENS_PER_CHAR;
}

function textToTokenEstimate(value: string) {
  return charsToTokens(Array.from(value).length);
}

export function estimateTokenCountFromText(value: string) {
  return Math.round(textToTokenEstimate(value));
}

export function DiagnosticsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DiagnosticsState>(() => initialState());
  const sampleCounterRef = useRef(0);

  const beginSlide = useCallback((payload: BeginSlidePayload) => {
    const startedAtMs = nowMs();
    setState((current) => {
      const contextWindowTokens = Math.max(
        1,
        payload.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
      );
      return {
        ...current,
        activeRuns: {
          ...current.activeRuns,
          [payload.pageNumber]: {
            pageNumber: payload.pageNumber,
            startedAtMs,
            outputChars: 0,
            contextTokens: Math.max(0, payload.contextTokens),
            contextWindowTokens,
          },
        },
      };
    });
  }, []);

  const recordChunk = useCallback((payload: RecordChunkPayload) => {
    if (!payload.chunk) {
      return;
    }

    const chunkChars = Array.from(payload.chunk).length;
    const receivedAtMs = nowMs();

    setState((current) => {
      const run = current.activeRuns[payload.pageNumber];
      if (!run) {
        return current;
      }

      const updatedRun: ActiveSlideRun = {
        ...run,
        outputChars: run.outputChars + chunkChars,
      };
      const elapsedMs = Math.max(1, receivedAtMs - updatedRun.startedAtMs);
      const runTokens = charsToTokens(updatedRun.outputChars);
      const instantTps = runTokens / (elapsedMs / 1000);
      const totalOutputChars = current.totals.totalOutputChars + chunkChars;
      const averageDenominatorMs = Math.max(
        1,
        current.totals.totalDurationMs + elapsedMs,
      );
      const avgTps = charsToTokens(totalOutputChars) / (averageDenominatorMs / 1000);
      const contextOccupancyPct = clamp(
        (updatedRun.contextTokens / updatedRun.contextWindowTokens) * 100,
        0,
        100,
      );

      sampleCounterRef.current += 1;
      const sample: DiagnosticsSample = {
        sample: sampleCounterRef.current,
        pageNumber: payload.pageNumber,
        elapsedSeconds: Math.max(
          0,
          (receivedAtMs - current.sessionStartedAtMs) / 1000,
        ),
        tps: instantTps,
        avgTps,
        contextOccupancyPct,
        contextTokens: updatedRun.contextTokens,
        contextWindowTokens: updatedRun.contextWindowTokens,
      };

      return {
        ...current,
        totals: {
          ...current.totals,
          totalOutputChars,
        },
        samples: [...current.samples, sample],
        activeRuns: {
          ...current.activeRuns,
          [payload.pageNumber]: updatedRun,
        },
      };
    });
  }, []);

  const finishSlide = useCallback((payload: FinishSlidePayload) => {
    const finishedAtMs = nowMs();

    setState((current) => {
      const run = current.activeRuns[payload.pageNumber];
      if (!run) {
        return current;
      }

      const remainingRuns = { ...current.activeRuns };
      delete remainingRuns[payload.pageNumber];

      if (!payload.success) {
        return {
          ...current,
          activeRuns: remainingRuns,
        };
      }

      const elapsedMs = Math.max(1, finishedAtMs - run.startedAtMs);
      return {
        ...current,
        totals: {
          ...current.totals,
          totalDurationMs: current.totals.totalDurationMs + elapsedMs,
          generatedSlides: current.totals.generatedSlides + 1,
        },
        activeRuns: remainingRuns,
      };
    });
  }, []);

  const resetDiagnostics = useCallback(() => {
    sampleCounterRef.current = 0;
    setState(initialState());
  }, []);

  const stateValue = useMemo<DiagnosticsStateValue>(() => {
    const latest = state.samples[state.samples.length - 1];
    const totalTokensConsumed = Math.round(charsToTokens(state.totals.totalOutputChars));
    const avgTps =
      state.totals.totalDurationMs > 0
        ? charsToTokens(state.totals.totalOutputChars) /
          (state.totals.totalDurationMs / 1000)
        : 0;
    const avgLatencyMs =
      state.totals.generatedSlides > 0
        ? state.totals.totalDurationMs / state.totals.generatedSlides
        : 0;

    return {
      samples: state.samples,
      avgTps,
      avgLatencyMs,
      totalTokensConsumed,
      generatedSlides: state.totals.generatedSlides,
      totalTimeMs: state.totals.totalDurationMs,
      latestTps: latest?.tps ?? 0,
      latestContextTokens: latest?.contextTokens ?? 0,
      latestContextWindowTokens:
        latest?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
      latestContextOccupancyPct: latest?.contextOccupancyPct ?? 0,
    };
  }, [state]);

  const actionsValue = useMemo<DiagnosticsActionsValue>(
    () => ({
      beginSlide,
      recordChunk,
      finishSlide,
      resetDiagnostics,
    }),
    [beginSlide, finishSlide, recordChunk, resetDiagnostics],
  );

  return (
    <DiagnosticsActionsContext.Provider value={actionsValue}>
      <DiagnosticsStateContext.Provider value={stateValue}>
        {children}
      </DiagnosticsStateContext.Provider>
    </DiagnosticsActionsContext.Provider>
  );
}

export function useDiagnostics() {
  const context = useContext(DiagnosticsStateContext);
  if (!context) {
    throw new Error("useDiagnostics must be used inside DiagnosticsProvider.");
  }
  return context;
}

export function useDiagnosticsActions() {
  const context = useContext(DiagnosticsActionsContext);
  if (!context) {
    throw new Error("useDiagnosticsActions must be used inside DiagnosticsProvider.");
  }
  return context;
}
