import type { ComponentType, ReactNode } from "react";
import { CountUp } from "@/components/CountUp";

export type HeroStat = { label: string; value: number; format?: (n: number) => string };

export type HeroTone =
  "emerald" | "sky" | "violet" | "amber" | "teal" | "rose" | "indigo" | "slate";

// One gradient per tone — full class strings so Tailwind can see them.
const TONE: Record<HeroTone, { bg: string; blob1: string; blob2: string }> = {
  emerald: {
    bg: "from-emerald-700 via-teal-700 to-cyan-800",
    blob1: "bg-white/10",
    blob2: "bg-emerald-300/15",
  },
  sky: {
    bg: "from-sky-800 via-blue-800 to-indigo-900",
    blob1: "bg-white/10",
    blob2: "bg-sky-300/15",
  },
  violet: {
    bg: "from-violet-800 via-purple-800 to-indigo-900",
    blob1: "bg-white/10",
    blob2: "bg-fuchsia-300/12",
  },
  amber: {
    bg: "from-amber-700 via-orange-700 to-rose-800",
    blob1: "bg-white/10",
    blob2: "bg-amber-200/12",
  },
  teal: {
    bg: "from-teal-700 via-cyan-800 to-blue-900",
    blob1: "bg-white/10",
    blob2: "bg-emerald-300/15",
  },
  rose: {
    bg: "from-rose-700 via-pink-800 to-purple-900",
    blob1: "bg-white/10",
    blob2: "bg-rose-200/12",
  },
  indigo: {
    bg: "from-indigo-700 via-blue-800 to-slate-900",
    blob1: "bg-white/10",
    blob2: "bg-sky-300/15",
  },
  slate: {
    bg: "from-slate-700 via-slate-800 to-emerald-950",
    blob1: "bg-white/10",
    blob2: "bg-emerald-300/12",
  },
};

// The colourful banner at the top of a dashboard page: a gradient with soft glowing
// blobs, a floating icon tile, the page title and a one-line description, and room on
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
      className={`tu-rise relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-sm sm:p-6 ${t.bg} ${className}`}
    >
      <div
        className={`tu-glow pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full blur-3xl ${t.blob1}`}
      />
      <div
        className={`tu-glow pointer-events-none absolute -bottom-16 left-1/3 h-44 w-44 rounded-full blur-3xl ${t.blob2}`}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="tu-float hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur sm:grid sm:h-14 sm:w-14">
            <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-2xl font-semibold sm:text-3xl">{title}</h1>
              {badges}
            </div>
            {subtitle && <p className="mt-1 max-w-2xl text-sm text-white/85">{subtitle}</p>}
          </div>
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {stats && stats.length > 0 && (
        <div className="relative mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {stats.map((st) => (
            <div key={st.label} className="rounded-xl bg-white/15 px-4 py-2 ring-1 ring-white/20">
              <div className="text-2xl font-semibold tabular-nums">
                <CountUp to={st.value} format={st.format} />
              </div>
              <div className="text-[11px] uppercase tracking-wide text-white/80">{st.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A white "glass" button style for use on the hero's coloured background.
export const heroButton =
  "inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-transform hover:scale-[1.03] disabled:opacity-60";
export const heroButtonGhost =
  "inline-flex items-center gap-2 rounded-full border border-white/50 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10";
