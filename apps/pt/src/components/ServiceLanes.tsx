import { Link } from "@tanstack/react-router";
import { ArrowRight, FileText, Gavel, Landmark, Search, UserRound, Users } from "lucide-react";
import { ScrollReveal } from "@/components/ScrollReveal";
import { QUESTIONS, SERVICE_LANES, type LaneId } from "@/lib/service-lanes";

const LANE_ICON: Record<LaneId, typeof Search> = {
  free_review: Search,
  owner_managed: UserRound,
  expert_managed: Users,
};

const LANE_TONE: Record<LaneId, string> = {
  free_review: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  owner_managed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  expert_managed: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

// "You do" vs "CorvusPT does" is the point of the comparison, so the answer's
// headline carries the lane's colour and weight; the detail stays quiet.
const LEAD_TONE: Record<LaneId, string> = {
  free_review: "text-foreground",
  owner_managed: "text-emerald-700 dark:text-emerald-300",
  expert_managed: "text-violet-700 dark:text-violet-300",
};

const ROLE_QUESTIONS = QUESTIONS.filter(
  (q): q is (typeof QUESTIONS)[number] & { key: "whoFiles" | "whoAppears" | "whoCommunicates" } =>
    q.key !== "buying",
);
const QUESTION_ICON: Record<(typeof ROLE_QUESTIONS)[number]["key"], typeof Search> = {
  whoFiles: FileText,
  whoAppears: Gavel,
  whoCommunicates: Landmark,
};

// The three lanes side by side: Free Property Review → Owner-Managed
// CorvusPT → Expert/Managed Help, each saying plainly who files, who appears
// and who talks to the county. See lib/service-lanes.ts.
export function ServiceLanes({ showCta = true }: { showCta?: boolean }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {SERVICE_LANES.map((lane, i) => {
        const Icon = LANE_ICON[lane.id];
        return (
          <ScrollReveal key={lane.id} delay={i * 120} className="relative h-full">
            {i < SERVICE_LANES.length - 1 && (
              <ArrowRight
                aria-hidden="true"
                className="absolute -right-5 top-10 z-10 hidden h-5 w-5 text-accent md:block"
              />
            )}
            <div className="card-elev flex h-full flex-col p-6">
              <div className="flex items-center gap-3">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${LANE_TONE[lane.id]}`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Lane {i + 1}
                </div>
              </div>
              <h3 className="mt-3 font-serif text-xl font-semibold">{lane.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{lane.tagline}</p>
              <div className="mt-3">
                <span className="text-2xl font-semibold">{lane.price}</span>
                <div className="text-xs text-muted-foreground">{lane.priceNote}</div>
              </div>
              <dl className="mt-5 divide-y divide-border/70 border-y border-border/70 text-sm">
                {ROLE_QUESTIONS.map((q) => {
                  const QIcon = QUESTION_ICON[q.key];
                  const a = lane.answers[q.key];
                  return (
                    <div key={q.key} className="flex gap-3 py-3">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                        <QIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{q.label}</dt>
                        <dd className="mt-0.5">
                          <span className={`text-base font-semibold ${LEAD_TONE[lane.id]}`}>
                            {a.lead}
                          </span>
                          {/* two lines reserved side by side, so each question
                              sits at the same height in every lane */}
                          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground md:min-h-[2.75em]">
                            {a.detail}
                          </span>
                        </dd>
                      </div>
                    </div>
                  );
                })}
              </dl>
              {showCta && (
                <>
                  <div className="mt-5 flex-1" />
                  <Link
                    to={lane.cta.to}
                    className={
                      lane.id === "owner_managed"
                        ? "btn-accent text-center"
                        : "btn-outline text-center"
                    }
                  >
                    {lane.cta.label}
                  </Link>
                </>
              )}
            </div>
          </ScrollReveal>
        );
      })}
    </div>
  );
}

// The same four questions answered lane by lane, as a table — the Pricing
// page's at-a-glance comparison.
export function LaneComparisonTable() {
  return (
    <div
      className="card-elev overflow-x-auto"
      // Scrolls sideways on phones; focusable so keyboard users can scroll it too
      // (WCAG scrollable-region pattern, which this lint rule does not know about).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="region"
      aria-label="Compare service lanes"
    >
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="w-48 p-4" />
            {SERVICE_LANES.map((lane, i) => (
              <th key={lane.id} scope="col" className="p-4 align-bottom">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Lane {i + 1}
                </div>
                <div className="font-serif text-base font-semibold">{lane.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {QUESTIONS.map((q) => (
            <tr key={q.key} className="border-b border-border last:border-0">
              <th scope="row" className="p-4 align-top font-semibold">
                {q.label}
              </th>
              {SERVICE_LANES.map((lane) => (
                <td key={lane.id} className="p-4 align-top text-muted-foreground">
                  {q.key === "buying" ? (
                    lane.buying
                  ) : (
                    <>
                      <span className={`font-semibold ${LEAD_TONE[lane.id]}`}>
                        {lane.answers[q.key].lead}
                      </span>
                      {lane.answers[q.key].detail && (
                        <span className="mt-0.5 block">{lane.answers[q.key].detail}</span>
                      )}
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
