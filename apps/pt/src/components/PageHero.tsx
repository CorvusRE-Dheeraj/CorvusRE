import type { ComponentType, ReactNode } from "react";
import { CountUp } from "@/components/CountUp";

// `text`, when set, replaces the animated number entirely — for a stat that has no real
// figure to show yet (e.g. a county that hasn't published an assessed value), so the tile
// reads "Not on file" instead of a fabricated $0 that looks like a real, zero-dollar answer.
export type HeroStat = {
  label: string;
  value: number;
  format?: (n: number) => string;
  text?: string;
};

export type HeroTone =
  "emerald" | "sky" | "violet" | "amber" | "teal" | "rose" | "indigo" | "slate";

// One soft tint per tone — a light wash with dark text, so the banner reads as
// part of the page rather than a block of strong colour. Full class strings so
// Tailwind can see them.
const TONE: Record<HeroTone, { bg: string; icon: string }> = {
  emerald: {
    bg: "from-emerald-50 via-white to-emerald-50/60 border-emerald-100 dark:from-emerald-950/40 dark:via-card dark:to-card dark:border-emerald-900/50",
    icon: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-200 dark:ring-emerald-800",
  },
  sky: {
    bg: "from-sky-50 via-white to-sky-50/60 border-sky-100 dark:from-sky-950/40 dark:via-card dark:to-card dark:border-sky-900/50",
    icon: "bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-900/50 dark:text-sky-200 dark:ring-sky-800",
  },
  violet: {
    bg: "from-violet-50 via-white to-violet-50/60 border-violet-100 dark:from-violet-950/40 dark:via-card dark:to-card dark:border-violet-900/50",
    icon: "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-900/50 dark:text-violet-200 dark:ring-violet-800",
  },
  amber: {
    bg: "from-amber-50 via-white to-amber-50/60 border-amber-100 dark:from-amber-950/40 dark:via-card dark:to-card dark:border-amber-900/50",
    icon: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-900/50 dark:text-amber-200 dark:ring-amber-800",
  },
  teal: {
    bg: "from-teal-50 via-white to-teal-50/60 border-teal-100 dark:from-teal-950/40 dark:via-card dark:to-card dark:border-teal-900/50",
    icon: "bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-900/50 dark:text-teal-200 dark:ring-teal-800",
  },
  rose: {
    bg: "from-rose-50 via-white to-rose-50/60 border-rose-100 dark:from-rose-950/40 dark:via-card dark:to-card dark:border-rose-900/50",
    icon: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-900/50 dark:text-rose-200 dark:ring-rose-800",
  },
  indigo: {
    bg: "from-indigo-50 via-white to-indigo-50/60 border-indigo-100 dark:from-indigo-950/40 dark:via-card dark:to-card dark:border-indigo-900/50",
    icon: "bg-indigo-100 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/50 dark:text-indigo-200 dark:ring-indigo-800",
  },
  slate: {
    bg: "from-slate-50 via-white to-slate-50/60 border-slate-100 dark:from-slate-950/40 dark:via-card dark:to-card dark:border-slate-900/50",
    icon: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-900/50 dark:text-slate-200 dark:ring-slate-800",
  },
};

// The banner at the top of a dashboard page: a soft tinted wash, an icon tile, the page title and a one-line description, and room on
// the right for the page's main actions. Purely presentational.
export function PageHero({
  icon: Icon,
  title,
  subtitle,
  tone = "emerald",
  children,
  badges,
  stats,
  className = "",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: ReactNode;
  tone?: HeroTone;
  // Actions (buttons/links) shown on the right.
  children?: ReactNode;
  // Small chips shown next to the title.
  badges?: ReactNode;
  // Live numbers shown in tiles under the title; they count up when the page loads.
  stats?: HeroStat[];
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      className={`tu-rise relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 text-slate-800 shadow-sm dark:text-slate-100 sm:p-6 ${t.bg} ${className}`}
    >
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={`hidden h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1 sm:grid sm:h-14 sm:w-14 ${t.icon}`}
          >
            <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-2xl font-semibold text-slate-900 dark:text-white sm:text-3xl">
                {title}
              </h1>
              {badges}
            </div>
            {subtitle && (
              <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {/* Stats sit up here on the right, next to the title, instead of their own
            row below — that second row was making the banner taller than its
            content needed and leaving the space beside the title empty. On a
            narrow screen this whole group still wraps below the title (same as
            before), where the grid keeps the tiles evenly sized. */}
        {((stats && stats.length > 0) || children) && (
          <div className="flex w-full flex-wrap items-center justify-end gap-4 sm:w-auto">
            {stats && stats.length > 0 && (
              <div
                className={`grid w-full gap-2 sm:w-auto sm:flex sm:flex-wrap ${stats.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
              >
                {stats.map((st) => (
                  <div
                    key={st.label}
                    className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10 sm:px-4"
                  >
                    <div className="text-xl font-semibold tabular-nums sm:text-2xl">
                      {st.text ?? <CountUp to={st.value} format={st.format} />}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-[11px]">
                      {st.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// Banner actions: white buttons with a thin border (green on hover), and a
// quieter outline one.
export const heroButton =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-slate-100";
export const heroButtonGhost =
  "inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white dark:border-white/20 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/10";
// A small chip next to the banner title.
export const heroChip =
  "inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-200 dark:ring-white/15";
