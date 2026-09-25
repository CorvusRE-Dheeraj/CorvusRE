import type { ComponentType, ReactNode } from "react";

export type HeroTone =
  "emerald" | "sky" | "violet" | "amber" | "teal" | "rose" | "indigo" | "slate";

// One gradient per tone — full class strings so Tailwind can see them.
const TONE: Record<HeroTone, { bg: string; blob1: string; blob2: string }> = {
  emerald: {
    bg: "from-emerald-600 via-teal-600 to-sky-700",
    blob1: "bg-white/25",
    blob2: "bg-lime-300/30",
  },
  sky: {
    bg: "from-sky-600 via-blue-600 to-indigo-700",
    blob1: "bg-white/25",
    blob2: "bg-cyan-300/30",
  },
  violet: {
    bg: "from-violet-600 via-purple-600 to-fuchsia-700",
    blob1: "bg-white/25",
    blob2: "bg-pink-300/30",
  },
  amber: {
    bg: "from-amber-500 via-orange-500 to-rose-600",
    blob1: "bg-white/30",
    blob2: "bg-yellow-200/30",
  },
  teal: {
    bg: "from-teal-600 via-cyan-600 to-blue-700",
    blob1: "bg-white/25",
    blob2: "bg-emerald-300/30",
  },
  rose: {
    bg: "from-rose-500 via-pink-600 to-purple-700",
    blob1: "bg-white/25",
    blob2: "bg-orange-300/30",
  },
  indigo: {
    bg: "from-indigo-600 via-blue-700 to-slate-800",
    blob1: "bg-white/20",
    blob2: "bg-sky-300/30",
  },
  slate: {
    bg: "from-slate-700 via-slate-800 to-emerald-900",
    blob1: "bg-white/15",
    blob2: "bg-emerald-300/25",
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
          <div className="tu-float grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur sm:h-14 sm:w-14">
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
    </div>
  );
}

// A white "glass" button style for use on the hero's coloured background.
export const heroButton =
  "inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-transform hover:scale-[1.03] disabled:opacity-60";
export const heroButtonGhost =
  "inline-flex items-center gap-2 rounded-full border border-white/50 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10";
