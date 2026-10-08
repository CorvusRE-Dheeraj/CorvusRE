import { useEffect, useState } from "react";
import { Check, FileText, Lock, Minus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getComps, type CompsResult } from "@/lib/cad-comps";
import { computeComparableStats } from "@/lib/comps-analysis";
import type { PropertyRecord } from "@/lib/properties";
import type { PropertyAiScore } from "@/lib/property-scores";
import { casePreview, UNLOCKS, type CasePreview as Preview } from "@/lib/case-preview";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const LEVEL_TONE = {
  potential: "text-success",
  possible: "text-warning-foreground",
  not_yet: "text-muted-foreground",
} as const;

const QUALITY_TONE = {
  Strong: "bg-success/15 text-success",
  Moderate: "bg-accent/15 text-accent",
  Limited: "bg-warning/15 text-warning-foreground",
  None: "bg-secondary text-muted-foreground",
} as const;

// Loads what the preview needs that isn't already on the property row: the
// latest county-data score, the county comparables (free, the same call the
// AI Report's comps module makes) and the count of documents on file.
export function useCasePreview(property: PropertyRecord, knownScore?: PropertyAiScore | null) {
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [scoreRes, compsRes, docsRes] = await Promise.allSettled([
        knownScore !== undefined
          ? Promise.resolve(knownScore)
          : supabase
              .from("property_ai_scores")
              .select("score, summary, factors")
              .eq("property_id", property.id)
              .order("computed_at", { ascending: false })
              .limit(1)
              .maybeSingle()
              .then(({ data }) => (data as PropertyAiScore | null) ?? null),
        property.cad && property.accountNumber
          ? getComps({
              cad: property.cad,
              accountNumber: property.accountNumber,
              address: property.address,
              totalValue: property.totalValue ?? undefined,
            })
          : Promise.resolve<CompsResult | null>(null),
        supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("property_id", property.id)
          .is("deleted_at", null)
          .then(({ count }) => count ?? 0),
      ]);
      if (cancelled) return;
      const comps = compsRes.status === "fulfilled" ? compsRes.value : null;
      const compStats =
        comps && comps.subject
          ? computeComparableStats(comps.subject, comps.comps, property.totalValue)
          : null;
      setPreview(
        casePreview({
          property,
          score: scoreRes.status === "fulfilled" ? scoreRes.value : null,
          comps,
          compStats,
          evidenceDocuments: docsRes.status === "fulfilled" ? docsRes.value : 0,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [property, knownScore]);
  return preview;
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[1.5rem_1fr] gap-x-2">
      <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-secondary text-[11px] font-semibold">
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <div className="mt-1 text-sm">{children}</div>
      </div>
    </section>
  );
}

// "Show me you found the case before asking me to buy the case": everything
// Corvus found for this property, shown before checkout (lib/case-preview.ts).
export function CasePreview({ preview, address }: { preview: Preview | null; address: string }) {
  if (!preview) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Gathering what Corvus found for {address}…
      </div>
    );
  }
  const { assessment: a, opportunity: o, comps: c } = preview;
  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border p-4">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
          What Corvus found — before you pay
        </div>
        <div className={`mt-1 font-serif text-lg font-semibold ${LEVEL_TONE[o.level]}`}>
          {o.label}
        </div>
        <div className="truncate text-xs text-muted-foreground">{address}</div>
      </div>

      <div className="grid gap-4 p-4">
        <Section n={1} title="Official assessment">
          {a.total != null ? (
            <>
              <div className="font-semibold">
                {usd(a.total)}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {a.cad ?? "County"}
                  {a.taxYear ? ` ${a.taxYear}` : ""} · Account {a.accountNumber ?? "—"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {a.land != null && a.improvement != null
                  ? `Land ${usd(a.land)} · Improvements ${usd(a.improvement)}`
                  : null}
                {a.priorYear && a.changePct != null
                  ? `${a.land != null ? " · " : ""}${a.changePct > 0 ? "+" : ""}${a.changePct}% vs ${a.priorYear.year} (${usd(a.priorYear.total)})`
                  : null}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">Not matched to the county record yet.</span>
          )}
        </Section>

        <Section n={2} title="Preliminary protest opportunity">
          <div>
            {o.score != null ? (
              <span className="font-semibold">County-data score {o.score}/100. </span>
            ) : null}
            {o.reasons.length === 0 && o.score == null && (
              <span className="text-muted-foreground">Score still computing.</span>
            )}
          </div>
          {o.reasons.length > 0 && (
            <ul className="mt-0.5 grid gap-0.5 text-xs text-muted-foreground">
              {o.reasons.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section n={3} title="Evidence categories found">
          <ul className="grid gap-1 sm:grid-cols-2">
            {preview.evidence.map((e) => (
              <li key={e.label} className="flex gap-1.5 text-xs">
                {e.found ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-label="Found" />
                ) : (
                  <Minus
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-label="Not found"
                  />
                )}
                <span>
                  <span className="font-medium">{e.label}</span>
                  <span className="text-muted-foreground"> — {e.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section n={4} title="Comparables">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.count} found</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${QUALITY_TONE[c.quality]}`}
            >
              {c.quality} quality
            </span>
            {c.count > 0 && (
              <span className="text-xs text-muted-foreground">
                {c.belowSubject} appraised below this property
                {c.median != null ? ` · median ${usd(c.median)}` : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{c.qualityBasis}</p>
        </Section>

        <Section n={5} title="Estimated savings range">
          {preview.savingsRange ? (
            <>
              <div className="font-semibold text-success">
                {usd(preview.savingsRange.low)}–{usd(preview.savingsRange.high)} a year
              </div>
              <p className="text-xs text-muted-foreground">
                {preview.savingsRange.basis}. An estimate, not a promise of any outcome.
              </p>
            </>
          ) : (
            <span className="text-muted-foreground">
              Not enough data for a range yet — the full valuation builds one.
            </span>
          )}
        </Section>

        <Section n={6} title="Data sources">
          <ul className="grid gap-0.5 text-xs">
            {preview.sources.map((s) => (
              <li key={s.name}>
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground"> — {s.used}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section n={7} title="Sample evidence pages">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-background p-3 shadow-sm">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <FileText className="h-3 w-3" aria-hidden="true" /> Page 1 · Property summary
              </div>
              <div className="mt-1 truncate text-xs font-semibold">{address}</div>
              <div className="text-[11px] text-muted-foreground">
                {a.cad ?? "County"} · Account {a.accountNumber ?? "—"}
              </div>
              <div className="mt-1 text-[11px]">
                Appraised: {a.total != null ? usd(a.total) : "—"}
              </div>
              {a.changePct != null && a.priorYear && (
                <div className="text-[11px]">
                  Change since {a.priorYear.year}: {a.changePct > 0 ? "+" : ""}
                  {a.changePct}%
                </div>
              )}
            </div>
            <div className="rounded-md border border-border bg-background p-3 shadow-sm">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <FileText className="h-3 w-3" aria-hidden="true" /> Page 2 · Equal & uniform
              </div>
              {c.sample.length > 0 ? (
                <table className="mt-1 w-full text-[11px]">
                  <tbody>
                    {c.sample.map((s) => (
                      <tr key={s.address}>
                        <td className="truncate pr-2">{s.address}</td>
                        <td className="text-right tabular-nums">{usd(s.value)}</td>
                      </tr>
                    ))}
                    {c.lockedCount > 0 && (
                      <tr className="text-muted-foreground">
                        <td colSpan={2} className="pt-0.5">
                          <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />+
                          {c.lockedCount} more in the full packet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Built from the full valuation for counties without public comparables.
                </p>
              )}
            </div>
          </div>
        </Section>

        <Section n={8} title="Sample hearing plan">
          <ol className="grid gap-1 text-xs">
            {preview.hearingPlan.map((s, i) => (
              <li key={s.title} className={s.locked ? "text-muted-foreground" : ""}>
                <span className="font-medium">
                  {i + 1}. {s.title}
                </span>
                {s.locked ? (
                  <Lock className="ml-1 inline h-3 w-3" aria-label="Unlocks after purchase" />
                ) : null}
                <span className={s.locked ? "" : "text-muted-foreground"}> — {s.detail}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section n={9} title="Exactly what unlocks after purchase">
          <ul className="grid gap-1 text-xs">
            {UNLOCKS.map((u) => (
              <li key={u.title} className="flex gap-1.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                <span>
                  <span className="font-medium">{u.title}</span>
                  <span className="text-muted-foreground"> — {u.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

export function CasePreviewFor({
  property,
  score,
}: {
  property: PropertyRecord;
  score?: PropertyAiScore | null;
}) {
  const preview = useCasePreview(property, score);
  return <CasePreview preview={preview} address={property.address} />;
}
