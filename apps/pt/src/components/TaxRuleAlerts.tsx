import { useEffect, useState } from "react";
import { AlertTriangle, BellRing, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  CASE_STATUS_WORDS,
  markRuleAlertsRead,
  myRuleAlerts,
  type MyRuleAlert,
} from "@/lib/tax-rule-alerts";

// "Alerts for your properties" at the top of Texas Tax Updates: every Texas
// rule change the Regulatory Watch found that applies to this owner's
// properties — what changed, which properties, an open case it touches, what to
// do, and the official source. Opening the tab marks them read.
export function TaxRuleAlerts() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<MyRuleAlert[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!user) return;
    myRuleAlerts()
      .then((a) => {
        setAlerts(a);
        void markRuleAlertsRead(a.filter((x) => !x.readAt).map((x) => x.deliveryId));
      })
      .catch(() => setAlerts([]));
  }, [user]);
  if (!user || !alerts || alerts.length === 0) return null;
  const list = showAll ? alerts : alerts.slice(0, 3);
  return (
    <section className="card-elev mt-6 p-5" aria-label="Rule changes that affect your properties">
      <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
        <BellRing className="h-5 w-5 text-accent" aria-hidden /> Rule changes that affect your
        properties
      </h2>
      <p className="text-xs text-muted-foreground">
        Found by Corvus AI&apos;s daily check of official Texas sources. General information, not
        legal advice.
      </p>
      <ul className="mt-4 grid gap-4">
        {list.map((a) => (
          <li
            key={a.deliveryId}
            className={`rounded-lg border p-4 ${a.affectsOpenCase ? "border-destructive/40 bg-destructive/5" : "border-border"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">
                {!a.readAt && (
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-700 align-middle"
                    aria-label="New"
                  />
                )}
                {a.title}
              </h3>
              <span className="text-xs text-muted-foreground">
                {a.effectiveDate ? `Effective ${a.effectiveDate}` : "Effective date not stated"}
              </span>
            </div>
            {a.affectsOpenCase && (
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden /> This affects a case you have open.
              </p>
            )}
            <p className="mt-2 text-sm">{a.summary}</p>
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  What changed
                </dt>
                <dd>{a.whatChanged}</dd>
              </div>
              {a.whyItMatters && (
                <div>
                  <dt className="text-xs font-semibold uppercase text-muted-foreground">
                    Why it matters
                  </dt>
                  <dd>{a.whyItMatters}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  Your properties
                </dt>
                <dd>
                  <ul>
                    {a.properties.map((p) => (
                      <li key={p.id}>
                        {p.address}
                        {p.openCase && (
                          <span className="ml-1 text-xs font-semibold text-destructive">
                            — {CASE_STATUS_WORDS[p.caseStatus ?? ""] ?? "open case"}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              {a.recommendedAction && (
                <div>
                  <dt className="text-xs font-semibold uppercase text-muted-foreground">
                    What to do
                  </dt>
                  <dd>{a.recommendedAction}</dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Official source:{" "}
              <a
                href={a.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent underline"
              >
                {a.sourceName} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>{" "}
              — “{a.quote.length > 300 ? `${a.quote.slice(0, 300)}…` : a.quote}”
            </p>
          </li>
        ))}
      </ul>
      {alerts.length > 3 && (
        <button
          type="button"
          className="mt-3 text-sm text-accent underline"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show fewer" : `Show all ${alerts.length}`}
        </button>
      )}
    </section>
  );
}
