import { CalendarClock, PiggyBank, ShieldCheck } from "lucide-react";
import { ScrollReveal } from "@/components/ScrollReveal";

// A small, decorative "here's what you get" collage built from real UI patterns — a score
// gauge, a savings figure and a deadline chip — clearly labelled as sample data. Not a
// screenshot and not a claim about anyone's property.
export function ProductPreview() {
  return (
    <section className="container-page overflow-x-clip py-14 md:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <span className="badge-soft">A peek inside</span>
        <h2 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">
          Everything about your protest, in one place
        </h2>
        <p className="mt-2 text-muted-foreground">
          Sample data shown — your own property gets its real score, savings and deadlines.
        </p>
      </div>

      <ScrollReveal>
        <div className="relative mx-auto mt-10 max-w-3xl">
          <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-emerald-200/60 via-sky-200/50 to-violet-200/60 blur-2xl dark:from-emerald-500/10 dark:via-sky-500/10 dark:to-violet-500/10" />
          <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
            <div className="card-elev tu-float-slow p-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                <ShieldCheck className="h-4 w-4" /> Protest opportunity
              </div>
              <svg viewBox="0 0 200 110" className="mx-auto mt-3 h-32 w-56">
                <defs>
                  <linearGradient id="pp-gauge" x1="0" x2="1">
                    <stop offset="0" stopColor="#f59e0b" />
                    <stop offset="1" stopColor="#10b981" />
                  </linearGradient>
                </defs>
                <path
                  d="M20 100a80 80 0 0 1 160 0"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.1"
                  strokeWidth="16"
                  strokeLinecap="round"
                />
                <path
                  d="M20 100a80 80 0 0 1 160 0"
                  fill="none"
                  stroke="url(#pp-gauge)"
                  strokeWidth="16"
                  strokeLinecap="round"
                  strokeDasharray="251"
                  strokeDashoffset="55"
                />
                <text
                  x="100"
                  y="92"
                  textAnchor="middle"
                  fontSize="34"
                  fontWeight="800"
                  fill="#059669"
                >
                  78
                </text>
                <text
                  x="100"
                  y="106"
                  textAnchor="middle"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.6"
                >
                  /100 · Strong
                </text>
              </svg>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                Assessment sits above nearby comparable parcels.
              </p>
            </div>

            <div className="grid gap-4">
              <div className="card-elev p-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-700">
                  <PiggyBank className="h-4 w-4" /> Potential savings
                </div>
                <div className="mt-1 font-serif text-4xl font-bold text-emerald-700">$2,240</div>
                <div className="text-xs text-muted-foreground">
                  per year · about 18% lower value
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-emerald-500 to-sky-500" />
                </div>
              </div>
              <div className="card-elev flex items-center gap-3 p-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/15 text-amber-700">
                  <CalendarClock className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-semibold">Protest deadline: May 15</div>
                  <div className="text-xs text-muted-foreground">
                    We remind you 30, 15, 7, 3 and 2 days out
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
