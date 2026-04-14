"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDiagnostics } from "@/context/diagnostics-context";

interface DiagnosticsModalProps {
  onClose: () => void;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatLatency(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0 ms";
  }
  if (ms < 1000) {
    return `${ms.toFixed(0)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

function toNumeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function DiagnosticsModal({ onClose }: DiagnosticsModalProps) {
  const {
    samples,
    avgTps,
    avgLatencyMs,
    totalTokensConsumed,
    backgroundTokensConsumed,
    generatedSlides,
    latestTps,
    latestContextTokens,
    latestContextWindowTokens,
    latestContextOccupancyPct,
  } = useDiagnostics();

  const hasSamples = samples.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Close diagnostics"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/55"
      />
      <section className="relative z-10 flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/50 bg-white/40 p-6 text-zinc-900 shadow-2xl backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/82 dark:text-slate-100">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Engine Activity</h2>
            <p className="mt-1 text-sm text-zinc-700 dark:text-slate-400">
              Real-time diagnostics for speed and context usage during generation.
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

        <div className="mb-5 grid gap-3 md:grid-cols-3">
          <article className="rounded-xl border border-white/50 bg-white/50 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/65">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-600 dark:text-slate-400">
              Avg. TPS
            </p>
            <p className="mt-1 text-2xl font-semibold">{avgTps.toFixed(1)}</p>
          </article>
          <article className="rounded-xl border border-white/50 bg-white/50 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/65">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-600 dark:text-slate-400">
              Avg. Latency / Slide
            </p>
            <p className="mt-1 text-2xl font-semibold">{formatLatency(avgLatencyMs)}</p>
          </article>
          <article className="rounded-xl border border-white/50 bg-white/50 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/65">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-600 dark:text-slate-400">
              Total Tokens Consumed
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCompactNumber(totalTokensConsumed)}
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-slate-400">
              Generated Slides: {generatedSlides}
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-slate-400">
              Background Mapping: {formatCompactNumber(backgroundTokensConsumed)} tokens
            </p>
          </article>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <article className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/45 bg-white/55 p-3 shadow-sm dark:border-slate-700/65 dark:bg-slate-800/65">
            <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-slate-200">
              Real-time Speed (TPS)
            </h3>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={samples}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                  <XAxis
                    dataKey="sample"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "currentColor", fontSize: 12 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "currentColor", fontSize: 12 }}
                    width={54}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid rgba(148, 163, 184, 0.35)",
                      background: "rgba(15, 23, 42, 0.92)",
                      color: "#e2e8f0",
                    }}
                    formatter={(value) => {
                      const numericValue = toNumeric(value);
                      return [`${numericValue.toFixed(2)} TPS`, "Speed"];
                    }}
                    labelFormatter={(label) => `Sample ${label}`}
                  />
                  <Legend
                    verticalAlign="top"
                    align="left"
                    content={() => (
                      <div className="pb-2 text-xs font-semibold text-zinc-700 dark:text-slate-300">
                        Speed: {latestTps.toFixed(1)} TPS
                      </div>
                    )}
                  />
                  <ReferenceLine
                    y={avgTps}
                    stroke="#0f5b8f"
                    strokeDasharray="6 6"
                    label={{
                      value: `Session Avg ${avgTps.toFixed(1)} TPS`,
                      position: "insideTopRight",
                      fill: "#0f5b8f",
                      fontSize: 11,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="tps"
                    stroke="#0f5b8f"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/45 bg-white/55 p-3 shadow-sm dark:border-slate-700/65 dark:bg-slate-800/65">
            <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-slate-200">
              Context Capacity
            </h3>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={samples}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                  <XAxis
                    dataKey="sample"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "currentColor", fontSize: 12 }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "currentColor", fontSize: 12 }}
                    width={54}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid rgba(148, 163, 184, 0.35)",
                      background: "rgba(15, 23, 42, 0.92)",
                      color: "#e2e8f0",
                    }}
                    formatter={(value) => {
                      const numericValue = toNumeric(value);
                      return [`${numericValue.toFixed(1)}%`, "Occupancy"];
                    }}
                    labelFormatter={(label) => `Sample ${label}`}
                  />
                  <Legend
                    verticalAlign="top"
                    align="left"
                    content={() => (
                      <div className="pb-2 text-xs font-semibold text-zinc-700 dark:text-slate-300">
                        Memory: {latestContextOccupancyPct.toFixed(1)}% |{" "}
                        {latestContextTokens.toLocaleString()} /{" "}
                        {formatCompactNumber(latestContextWindowTokens)} Tokens
                      </div>
                    )}
                  />
                  <ReferenceLine
                    y={90}
                    stroke="#dc2626"
                    strokeDasharray="6 6"
                    label={{
                      value: "Danger Zone",
                      position: "insideTopRight",
                      fill: "#dc2626",
                      fontSize: 11,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="contextOccupancyPct"
                    stroke="#2563eb"
                    fill="#2563eb"
                    fillOpacity={0.22}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>
        </div>

        {!hasSamples ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
            <div className="mt-20 rounded-lg border border-white/40 bg-white/65 px-4 py-2 text-sm text-zinc-700 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/80 dark:text-slate-300">
              Start generation to collect live diagnostics.
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
