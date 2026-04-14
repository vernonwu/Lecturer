"use client";

interface GlobalMappingLoaderProps {
  completedExtractions: number;
  totalSlides: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function GlobalMappingLoader({
  completedExtractions,
  totalSlides,
}: GlobalMappingLoaderProps) {
  const normalizedTotal = Math.max(1, totalSlides);
  const normalizedCompleted = clamp(completedExtractions, 0, normalizedTotal);
  const progressPercent = Math.round(
    (normalizedCompleted / normalizedTotal) * 100,
  );
  const isComplete = totalSlides > 0 && progressPercent >= 100;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center px-6">
      <div
        className={[
          "w-full max-w-md rounded-2xl border border-white/55 bg-white/55 p-5 text-center shadow-xl backdrop-blur-xl transition-all duration-300",
          "dark:border-slate-700/60 dark:bg-slate-900/78",
          isComplete
            ? "border-green-400/60 shadow-[0_0_18px_rgba(74,222,128,0.25)]"
            : "",
        ].join(" ")}
      >
        <p className="text-sm font-semibold text-zinc-800 animate-pulse dark:text-slate-100">
          {isComplete
            ? "Map Complete! Starting generation..."
            : `Mapping Document Structure... (${normalizedCompleted}/${totalSlides})`}
        </p>
        <div className="relative mx-auto mt-4 h-2 w-64 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className={[
              "absolute left-0 top-0 h-full overflow-hidden rounded-full transition-all duration-300 ease-out",
              isComplete ? "bg-green-500" : "bg-blue-500",
            ].join(" ")}
            style={{ width: `${progressPercent}%` }}
          >
            <div className="mapping-progress-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          </div>
        </div>
      </div>
    </div>
  );
}
