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

// One look for every page: a white card with a hairline border and a
// brand-green icon tile. `tone` is still accepted (callers pass it) but no
// longer colours the banner — one accent colour across the app reads calmer.
const ICON_TILE =
  "bg-accent/10 text-accent ring-accent/20 dark:bg-accent/15 dark:text-accent dark:ring-accent/25";

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
  return (
    <div
      className={`tu-rise relative overflow-hidden rounded-2xl border border-border bg-card p-5 text-slate-800 shadow-[var(--shadow-card)] dark:text-slate-100 sm:p-6 ${className}`}
    >
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={`hidden h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1 sm:grid sm:h-14 sm:w-14 ${ICON_TILE}`}
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
                    className="rounded-xl bg-secondary/60 px-3 py-2 ring-1 ring-border/70 dark:bg-white/5 dark:ring-white/10 sm:px-4"
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
  "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold sm:gap-2 sm:px-4 sm:py-2 sm:text-sm text-slate-800 shadow-sm transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-slate-100";
export const heroButtonGhost =
  "inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white dark:border-white/20 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/10";
// A small chip next to the banner title.
export const heroChip =
  "inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-200 dark:ring-white/15";
