import { useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { Confetti } from "@/components/Confetti";
import type { PropertyRecord } from "@/lib/properties";
import { INFORMAL_STATUS_LABEL, type ProtestRecord } from "@/lib/protests";
import { buildCaseOutcome } from "@/lib/case-outcome";
import { currency } from "@/lib/intake-store";

// Confetti plays once per case per browser — reopening the tab later stays calm.
const celebrateKey = (id: string) => `corvuspt.celebrated.${id}`;
function alreadyCelebrated(id: string): boolean {
  try {
    return localStorage.getItem(celebrateKey(id)) === "1";
  } catch {
    return false;
  }
}

// Counts up to `to` over ~1.2s (jumps straight there for reduced motion).
function useCountUp(to: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || to <= 0) {
      setN(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1200);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return n;
}

type OpenTab = "informal" | "hearing" | "decision" | "arbitration" | "court";

const pct = (n: number | null) =>
  n == null ? "—" : `${n.toFixed(n >= 10 ? 1 : 2).replace(/\.?0+$/, "")}%`;

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString() : null;

// The last step: how the whole case ended, whichever route it took (informal
// settlement, ARB decision, arbitration, or court), with the value, what it saved,
// and a short trail of the routes tried. Numbers come from buildCaseOutcome, the
// same deterministic figures the Decision tab uses.
export function FinalOutcomeSection({
  protest,
  property,
  onOpenTab,
}: {
  protest: ProtestRecord;
  property: PropertyRecord;
  onOpenTab: (tab: OpenTab) => void;
}) {
  const outcome = buildCaseOutcome(property, protest);
  const closed = protest.status === "resolved";
  const savings = outcome?.taxSavings ?? 0;
  const counted = useCountUp(closed ? savings : 0);
  const [celebrate] = useState(() => !alreadyCelebrated(protest.id));
  useEffect(() => {
    if (!closed || !celebrate) return;
    try {
      localStorage.setItem(celebrateKey(protest.id), "1");
    } catch {
      // storage blocked — the confetti may replay next visit, harmless
    }
  }, [closed, celebrate, protest.id]);

  if (!outcome || !closed) {
    return (
      <div className="mt-2 rounded-md border border-border p-4 text-sm">
        <h4 className="font-serif text-base font-semibold">Final outcome</h4>
        <p className="mt-1 text-muted-foreground">
          Your case isn&apos;t concluded yet. When it ends — an informal settlement, an ARB
          decision, arbitration or a court result — the final value and what you saved appear here.
        </p>
      </div>
    );
  }

  const route =
    protest.escalationPath === "arbitration"
      ? "Binding arbitration"
      : protest.escalationPath === "appeal"
        ? "District court appeal"
        : protest.arbDecision
          ? "Formal hearing (ARB)"
          : "Informal review settlement";

  const trail: { label: string; detail: string; tab: OpenTab }[] = [];
  if (protest.informalStatus !== "not_requested") {
    trail.push({
      label: "Informal review",
      detail: INFORMAL_STATUS_LABEL[protest.informalStatus],
      tab: "informal",
    });
  }
  if (protest.hearingDate || protest.hearingCompletedAt || protest.arbDecision) {
    trail.push({
      label: "Formal hearing",
      detail: protest.arbDecision
        ? `ARB decision: ${protest.arbDecision}${protest.arbDecisionDate ? ` (${fmt(protest.arbDecisionDate)})` : ""}`
        : protest.hearingCompletedAt
          ? `Held ${fmt(protest.hearingCompletedAt)}`
          : `Scheduled ${fmt(protest.hearingDate)}`,
      tab: "hearing",
    });
  }
  if (protest.escalationPath === "arbitration" || protest.arbitrationFiledAt) {
    trail.push({
      label: "Arbitration",
      detail: protest.arbitrationFiledAt
        ? `Request filed ${fmt(protest.arbitrationFiledAt)}`
        : "Chosen as the next step",
      tab: "arbitration",
    });
  }
  if (protest.escalationPath === "appeal" || protest.courtAppeal) {
    trail.push({
      label: "Court appeal",
      detail: protest.courtAppeal?.petitionFiledAt
        ? `Petition filed ${fmt(protest.courtAppeal.petitionFiledAt)}`
        : "Chosen as the next step",
      tab: "court",
    });
  }

  return (
    <div className="mt-2 grid gap-4">
      <div className="tu-rise relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-800 p-6 text-white">
        {celebrate && <Confetti />}
        <div className="tu-glow pointer-events-none absolute -right-8 -top-8 h-44 w-44 rounded-full bg-white/25 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="tu-float grid h-14 w-14 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30">
            <PartyPopper className="h-7 w-7" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-white/80">
              Case closed
            </div>
            <div className="font-serif text-3xl font-semibold sm:text-4xl">
              {savings > 0 ? (
                <>
                  You saved about {currency(counted)} <span className="text-lg">a year</span>
                </>
              ) : (
                "Your case is closed"
              )}
            </div>
            <p className="text-sm text-white/85">
              Final value {currency(outcome.finalValue)}
              {outcome.valueReductionPct != null && outcome.valueReductionPct > 0
                ? ` — ${Math.round(outcome.valueReductionPct)}% lower than the original.`
                : "."}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-serif text-base font-semibold">Final outcome</h4>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
            Resolved · {route}
          </span>
        </div>
        <p className="mt-1 text-sm">
          Your protest ended at <strong>{currency(outcome.finalValue)}</strong>
          {protest.closedAt ? ` on ${fmt(protest.closedAt)}` : ""}.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Value reduced
            </div>
            <div className="mt-0.5 text-sm">
              {currency(outcome.originalValue)} → <strong>{currency(outcome.finalValue)}</strong>
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              You saved
            </div>
            <div className="mt-0.5 text-lg font-semibold text-success">
              {outcome.taxSavings != null ? currency(outcome.taxSavings) : "—"}
              <span className="text-xs font-normal text-muted-foreground"> /yr in tax</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {pct(outcome.valueReductionPct)} lower value
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Your tax now
            </div>
            <div className="mt-0.5 text-sm">
              {outcome.taxBefore != null ? currency(outcome.taxBefore) : "—"} →{" "}
              <strong>{outcome.taxAfter != null ? currency(outcome.taxAfter) : "—"}</strong>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Tax figures apply your county&apos;s average combined rate (
          {(outcome.taxRate * 100).toFixed(2)}
          %) to the value change — an estimate; your actual bill uses each taxing unit&apos;s exact
          rate. Your property returns to tax monitoring for next year.
        </p>
      </div>

      {trail.length > 0 && (
        <div className="rounded-md border border-border p-4">
          <h4 className="text-sm font-semibold">How it got here</h4>
          <ol className="mt-2 grid gap-2">
            {trail.map((t) => (
              <li
                key={t.label}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  <span className="font-medium">{t.label}</span>
                  <span className="text-muted-foreground"> — {t.detail}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onOpenTab(t.tab)}
                  className="text-xs text-accent hover:underline"
                >
                  Open →
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => onOpenTab("decision")}
            className="mt-3 text-xs text-muted-foreground hover:underline"
          >
            Made a mistake? Review or undo on the Decision tab →
          </button>
        </div>
      )}
    </div>
  );
}
