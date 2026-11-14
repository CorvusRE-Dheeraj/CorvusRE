// Post ARB Options — every remedy after the ARB's order in ONE comparison
// table (inside the Post-hearing decision card, or on its own before a final
// value is recorded): estimated cost, deadline, risk, evidence strength, ROI
// and potential additional savings per option. Hover a row for a summary,
// click it for the full calculation and practical benefits. Options that
// don't apply to this case are faded and can't be opened. Below the table:
// Corvus AI's assessment of the options, the county's ARB guidelines and the
// further-appeal routes, and the record / close actions.
//
// Every number is deterministic (lib/escalation-eval.ts — statutory windows,
// the Comptroller's deposit schedule, value gap × effective tax rate). Only
// the written assessment is AI, and it's told to use only these figures.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ExternalLink, Info, Sparkles } from "lucide-react";
import { askAboutDocument } from "@/lib/document-ai";
import { MarkdownLite } from "@/components/MarkdownLite";
import { type PropertyRecord } from "@/lib/properties";
import { type ProtestRecord } from "@/lib/protests";
import { recordEscalation, closeCase } from "@/lib/protest-case";
import { getEffectiveTaxRate } from "@/lib/texas-tax-rates";
import { getCountyProtestInfo, telHref } from "@/lib/county-protest-info";
import { daysBetween, localTodayIso } from "@/lib/case-pipeline";
import {
  evaluateEscalation,
  type EscalationOption,
  type EscalationOptionId,
} from "@/lib/escalation-eval";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
// Small, stable hash of the AI context (djb2) — only used as a storage key.
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSaved(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked — the assessment still shows, just isn't kept.
  }
}

const cost = (o: EscalationOption) =>
  o.estimatedCost
    ? o.estimatedCost.min === o.estimatedCost.max
      ? usd(o.estimatedCost.min)
      : `${usd(o.estimatedCost.min)}–${usd(o.estimatedCost.max)}`
    : "—";
const midCost = (o: EscalationOption) =>
  o.estimatedCost ? (o.estimatedCost.min + o.estimatedCost.max) / 2 : null;

const VALUE_REMEDIES: EscalationOptionId[] = ["binding_arbitration", "district_court", "soah"];
// Years a value win usually carries forward (it becomes next year's starting
// point) — shown as an illustration, clearly labelled.
const CARRY_YEARS = 3;

// Official, statewide procedure pages — each checked to load (2026-11-12).
const STATEWIDE_LINKS = [
  {
    label: "Appraisal review boards — Texas Comptroller",
    href: "https://comptroller.texas.gov/taxes/property-tax/arb/",
  },
  {
    label: "Regular binding arbitration — Texas Comptroller",
    href: "https://comptroller.texas.gov/taxes/property-tax/arbitration/",
  },
  {
    label: "Property tax protests & remedies — Texas Comptroller",
    href: "https://comptroller.texas.gov/taxes/property-tax/protests/",
  },
  {
    label: "Property Taxpayer Remedies (guide, PDF)",
    href: "https://comptroller.texas.gov/taxes/property-tax/docs/96-295.pdf",
  },
  {
    label: "SOAH appeals of ARB orders",
    href: "https://www.soah.texas.gov/appraisal-review-board",
  },
  {
    label: "Tax Code ch. 41A (arbitration)",
    href: "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41A.htm",
  },
  {
    label: "Tax Code ch. 42 (judicial review, SOAH)",
    href: "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.42.htm",
  },
];

type Row = {
  o: EscalationOption;
  // why the row is faded, or null when it can be opened
  unavailable: string | null;
  daysLeft: number | null;
};

export function PostArbOptions({
  property,
  protest,
  evidenceDocumentCount,
  supportableLow = null,
  onUpdate,
  onChosen,
}: {
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceDocumentCount: number;
  // what the evidence supports (the valuation worksheet's low end) — the
  // default opinion of value for the savings and ROI columns
  supportableLow?: number | null;
  onUpdate?: (patch: Partial<ProtestRecord>) => void;
  onChosen?: (path: "appeal" | "arbitration") => void;
}) {
  const today = localTodayIso();
  const [opinionInput, setOpinionInput] = useState("");
  const typed = opinionInput ? Number(opinionInput.replace(/[^0-9.]/g, "")) : null;
  const opinion = typed && typed > 0 ? typed : supportableLow;
  const evalr = useMemo(
    () => evaluateEscalation(property, protest, evidenceDocumentCount, opinion),
    [property, protest, evidenceDocumentCount, opinion],
  );
  const [open, setOpen] = useState<EscalationOption | null>(null);

  // Remedies open once the ARB has ruled against the owner (fully or in part).
  const arbRuled = protest.arbDecision != null;
  const arbAgainst = protest.arbDecision === "denied" || protest.arbDecision === "partial";
  const rows: Row[] = evalr.options.map((o) => {
    const daysLeft = o.deadline.date ? daysBetween(today, o.deadline.date) : null;
    let unavailable: string | null = null;
    if (o.id !== "no_further_action") {
      if (!arbRuled)
        unavailable = "Opens once the ARB's written order (Order Determining Protest) is recorded.";
      else if (!arbAgainst)
        unavailable = "The ARB granted the requested value — there's nothing left to appeal.";
      else if (!o.eligible) unavailable = o.eligibilityBasis;
      else if (daysLeft != null && daysLeft < 0)
        unavailable = `The deadline passed on ${fmtDate(o.deadline.date!)}.`;
    }
    return { o, unavailable, daysLeft };
  });
  const recommended = rows.find((r) => r.o.recommended && !r.unavailable)?.o ?? null;

  // ── Corvus AI assessment ──────────────────────────────────────────────
  const [assessment, setAssessment] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const assessedFor = useRef<string | null>(null);
  async function assess(useSaved = false) {
    if (assessing) return;
    setAssessing(true);
    try {
      const lines = rows.map(
        ({ o, unavailable, daysLeft }) =>
          `- ${o.title} (${o.statute}): ${unavailable ? `NOT AVAILABLE — ${unavailable}` : "available"}; ` +
          `deadline ${o.deadline.date ?? "n/a"}${daysLeft != null ? ` (${daysLeft} days left)` : ""}; ` +
          `est. cost ${cost(o)}; added savings/yr ${o.potentialAdditionalSavings.amount != null ? usd(o.potentialAdditionalSavings.amount) : "n/a"}; ` +
          `ROI ${o.estimatedRoi.ratio != null ? `${o.estimatedRoi.ratio}x` : "n/a"}; evidence ${o.evidenceStrength}; risk ${o.risk.band}. ${o.practicalBenefit}`,
      );
      const context =
        `CASE: ${property.address}; county ${property.cad ?? "n/a"}; ARB decision ${protest.arbDecision ?? "not recorded"}` +
        `${protest.arbDecisionDate ? ` on ${protest.arbDecisionDate}` : ""}; original value ${protest.originalValue ?? "n/a"}; ` +
        `ARB/final value ${protest.finalValue ?? "n/a"}; owner's opinion of value ${opinion ?? "not given"}; ` +
        `evidence documents on file ${evidenceDocumentCount}; effective tax rate ${(getEffectiveTaxRate(property.cad) * 100).toFixed(2)}%.\n` +
        `MARKET EVIDENCE: ${evalr.marketDisconnectEvidence.narrative}\nOPTIONS:\n${lines.join("\n")}`;
      // Speed: the automatic assessment used to call the AI (~10 s) on every
      // visit. The same case figures give the same inputs, so the answer is
      // kept in this browser per exact context and shown instantly next time;
      // any changed figure (or the Refresh button) asks the AI again.
      const savedKey = `corvuspt.arbAssessment.${protest.id}.${hashText(context)}`;
      const saved = useSaved ? readSaved(savedKey) : null;
      if (saved) {
        setAssessment(saved);
        return;
      }
      const { answer } = await askAboutDocument({
        question:
          "Assess my options after the appraisal review board's decision and say which one may be worth considering, and why. " +
          "Reply as short bullets under these labels: Assessment; Worth considering; Why; Main risks; Before you decide. " +
          "Weigh the potential additional savings against the cost, deadline, risk and evidence strength. Only consider options marked available. " +
          "Use only the data below — no other numbers. Don't give legal advice or predict outcomes; remind me to confirm deadlines with the appraisal district.",
        context,
      });
      writeSaved(savedKey, answer);
      setAssessment(answer);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Corvus AI couldn't assess the options.");
    } finally {
      setAssessing(false);
    }
  }
  // Run once by itself when the ARB has ruled against the owner; again only
  // when asked (or after the opinion of value changes and they ask).
  const key = `${protest.id}:${protest.arbDecision}:${protest.finalValue}`;
  useEffect(() => {
    if (!arbAgainst || assessedFor.current === key) return;
    assessedFor.current = key;
    void assess(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, arbAgainst]);

  // ── Record a decision / close ────────────────────────────────────────
  const eligibleRemedies = rows.filter((r) => !r.unavailable && VALUE_REMEDIES.includes(r.o.id));
  const [approveId, setApproveId] = useState("");
  const [showApprove, setShowApprove] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [closeValue, setCloseValue] = useState(String(protest.finalValue ?? ""));
  const [busy, setBusy] = useState(false);
  async function approve() {
    const id = approveId || recommended?.id || eligibleRemedies[0]?.o.id;
    if (!id) return;
    const path = id === "district_court" ? "appeal" : "arbitration";
    setBusy(true);
    try {
      await recordEscalation(protest.id, path);
      onUpdate?.({ escalationPath: path, status: path === "appeal" ? "appealing" : "arbitrating" });
      toast.success(
        path === "appeal"
          ? "Recorded — district court appeal. This proceeds outside CorvusPT."
          : "Recorded — binding arbitration. This is handled with the Comptroller's office.",
      );
      setShowApprove(false);
      onChosen?.(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this next step.");
    } finally {
      setBusy(false);
    }
  }
  async function closeNow(e: FormEvent) {
    e.preventDefault();
    if (!closeValue) return;
    setBusy(true);
    try {
      const finalValue = Number(closeValue);
      await closeCase(protest.id, finalValue);
      onUpdate?.({ finalValue, closedAt: new Date().toISOString(), status: "resolved" });
      toast.success("Case closed.");
      setShowClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close this case.");
    } finally {
      setBusy(false);
    }
  }

  const county = getCountyProtestInfo(property.cad);
  const arbPhone = county?.arbContact?.phone ?? null;

  return (
    <div id="case-escalation">
      {!arbRuled && (
        <p className="mt-1 rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          These are the options after the ARB&apos;s decision. They open once the ARB&apos;s written
          order is recorded — the deadlines count from the day you receive it.
        </p>
      )}

      <label className="mt-2 block text-xs font-medium text-muted-foreground">
        Your opinion of value{" "}
        {supportableLow != null && !opinionInput
          ? `(using ${usd(supportableLow)}, what the evidence supports — change it if yours differs)`
          : "(enables the savings & ROI columns)"}
        <input
          inputMode="numeric"
          value={opinionInput}
          onChange={(e) => setOpinionInput(e.target.value)}
          placeholder={supportableLow != null ? usd(supportableLow) : "e.g. 450,000"}
          className="mt-1 w-full max-w-xs rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        />
      </label>

      <div className="mt-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-secondary/60 text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Option</th>
              <th className="p-2">Deadline</th>
              <th className="p-2 text-right">Est. cost</th>
              <th className="p-2 text-right">Added savings / yr</th>
              <th className="p-2 text-right">Est. ROI</th>
              <th className="p-2">Evidence</th>
              <th className="p-2">Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <OptionRow key={r.o.id} row={r} onOpen={() => setOpen(r.o)} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Hover an option for a summary; click it for the calculation, costs, deadline, risk and what
        it would get you. Faded options don&apos;t apply to this case.
      </p>

      {/* Corvus AI assessment */}
      <div className="mt-4 rounded-md border border-accent/30 bg-accent/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" /> Corvus AI assessment
          </div>
          <button
            type="button"
            onClick={() => void assess()}
            disabled={assessing}
            className="btn-outline py-1 text-xs disabled:opacity-60"
          >
            {assessing ? "Assessing…" : assessment ? "Assess again" : "Assess my options"}
          </button>
        </div>
        {assessment ? (
          <MarkdownLite text={assessment} className="mt-2 text-sm text-foreground" />
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {assessing
              ? "Comparing the options for this case…"
              : arbRuled
                ? "Corvus AI compares the options for this case — savings against cost, risk, deadline and evidence — and says which may be worth considering."
                : "Available once the ARB's decision is recorded."}
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">{evalr.disclaimer}</p>
      </div>

      {evalr.marketDisconnectEvidence.available && (
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-semibold">
            {evalr.marketDisconnectEvidence.overCeiling
              ? "Statistical evidence: "
              : "Countywide ratio study: "}
          </span>
          {evalr.marketDisconnectEvidence.narrative}{" "}
          <a
            href={evalr.marketDisconnectEvidence.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2"
          >
            Texas Comptroller ratio study
          </a>
        </p>
      )}

      {/* County guidelines and further appeal */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {county?.cad ?? property.cad ?? "County"} — ARB guidelines
          </h4>
          <ul className="mt-1 grid gap-1 text-sm">
            {county?.sourceUrl && (
              <LinkItem href={county.sourceUrl}>
                The district&apos;s protest &amp; ARB page
              </LinkItem>
            )}
            {county?.website && county.website !== county.sourceUrl && (
              <LinkItem href={county.website}>Appraisal district website</LinkItem>
            )}
            {arbPhone && (
              <li className="text-muted-foreground">
                Review board:{" "}
                <a
                  href={telHref(arbPhone) ?? undefined}
                  className="text-accent underline underline-offset-2"
                >
                  {arbPhone}
                </a>
                {county?.arbContact?.email && (
                  <>
                    {" · "}
                    <a
                      href={`mailto:${county.arbContact.email}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {county.arbContact.email}
                    </a>
                  </>
                )}
              </li>
            )}
            {!county && (
              <li className="text-muted-foreground">
                No county page on file — the statewide guides apply.
              </li>
            )}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Further appeal after the ARB — official guides
          </h4>
          <ul className="mt-1 grid gap-1 text-sm">
            {STATEWIDE_LINKS.map((l) => (
              <LinkItem key={l.href} href={l.href}>
                {l.label}
              </LinkItem>
            ))}
          </ul>
        </div>
      </div>

      {/* Record / close */}
      <div className="mt-4 flex flex-wrap gap-2">
        {eligibleRemedies.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setApproveId(recommended?.id ?? eligibleRemedies[0].o.id);
              setShowApprove((v) => !v);
              setShowClose(false);
            }}
            className="btn-primary py-1.5 text-sm"
          >
            Approve Escalation
          </button>
        )}
        {arbRuled && (
          <button
            type="button"
            onClick={() => {
              setShowClose((v) => !v);
              setShowApprove(false);
            }}
            className="btn-outline py-1.5 text-sm"
          >
            Accept ARB decision &amp; Close Case
          </button>
        )}
      </div>
      {showApprove && eligibleRemedies.length > 0 && (
        <div className="mt-3 rounded-md border border-border p-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Record which escalation you&apos;re pursuing
            <select
              value={approveId}
              onChange={(e) => setApproveId(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            >
              {eligibleRemedies.map(({ o }) => (
                <option key={o.id} value={o.id}>
                  {o.title} ({o.statute})
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-[11px] text-muted-foreground">
            This records your decision on the case. CorvusPT doesn&apos;t file the arbitration
            request or court petition for you — you or your attorney do that by the deadline.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void approve()}
            className="btn-primary mt-2 py-1.5 text-sm disabled:opacity-60"
          >
            {busy ? "Recording…" : "Confirm"}
          </button>
        </div>
      )}
      {showClose && (
        <form onSubmit={closeNow} className="mt-3 rounded-md border border-border p-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Final value to record
            <input
              inputMode="numeric"
              value={closeValue}
              onChange={(e) => setCloseValue(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !closeValue}
            className="btn-primary mt-2 py-1.5 text-sm disabled:opacity-60"
          >
            {busy ? "Closing…" : "Close case at this value"}
          </button>
        </form>
      )}

      <OptionDetail
        option={open}
        row={rows.find((r) => r.o.id === open?.id) ?? null}
        currentValue={protest.finalValue ?? protest.originalValue ?? property.totalValue ?? null}
        opinion={opinion}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

function LinkItem({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-accent underline underline-offset-2 hover:no-underline"
      >
        {children} <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </li>
  );
}

function OptionRow({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const { o, unavailable, daysLeft } = row;
  const cells = (
    <>
      <td className="p-2">
        <div className="font-medium">
          {o.title}
          {o.recommended && !unavailable && (
            <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              Strongest by Corvus AI&apos;s numbers
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {unavailable ?? (o.statute !== "—" ? o.statute : "")}
        </div>
      </td>
      <td className="p-2 text-xs">
        {o.deadline.date
          ? `${fmtDate(o.deadline.date)}${daysLeft != null ? ` · ${daysLeft < 0 ? "passed" : `${daysLeft} days`}` : ""}`
          : o.id === "no_further_action"
            ? "None"
            : "See details"}
      </td>
      <td className="p-2 text-right tabular-nums">{cost(o)}</td>
      <td className="p-2 text-right tabular-nums">
        {o.potentialAdditionalSavings.amount != null
          ? usd(o.potentialAdditionalSavings.amount)
          : "—"}
      </td>
      <td className="p-2 text-right tabular-nums">
        {o.estimatedRoi.ratio != null ? `${o.estimatedRoi.ratio}×` : "—"}
      </td>
      <td className="p-2 capitalize">{o.evidenceStrength}</td>
      <td className="p-2 capitalize">{o.risk.band}</td>
    </>
  );
  if (unavailable)
    return (
      <tr
        className="border-t border-border align-top text-muted-foreground opacity-50"
        aria-disabled="true"
        title={unavailable}
      >
        {cells}
      </tr>
    );
  return (
    <HoverCard openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>
        <tr
          tabIndex={0}
          role="button"
          aria-label={`${o.title} — open details`}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen();
            }
          }}
          className={`cursor-pointer border-t border-border align-top hover:bg-secondary/50 focus:bg-secondary/50 focus:outline-none ${
            o.recommended ? "bg-accent/5" : ""
          }`}
        >
          {cells}
        </tr>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 text-xs" side="top">
        <div className="font-semibold">{o.title}</div>
        <p className="mt-1 text-muted-foreground">{o.practicalBenefit}</p>
        <p className="mt-1">
          {cost(o)} · {o.risk.band} risk · {o.evidenceStrength} evidence
          {o.potentialAdditionalSavings.amount != null
            ? ` · ${usd(o.potentialAdditionalSavings.amount)}/yr`
            : ""}
        </p>
        <p className="mt-1 flex items-center gap-1 text-accent">
          <Info className="h-3 w-3" aria-hidden="true" /> Click for the full details
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

function Fact({ label, value, basis }: { label: string; value: string; basis: string }) {
  return (
    <div className="rounded-md bg-secondary/40 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{basis}</div>
    </div>
  );
}

function OptionDetail({
  option: o,
  row,
  currentValue,
  opinion,
  onClose,
}: {
  option: EscalationOption | null;
  row: Row | null;
  currentValue: number | null;
  opinion: number | null;
  onClose: () => void;
}) {
  const savings = o?.potentialAdditionalSavings.amount ?? null;
  const mid = o ? midCost(o) : null;
  return (
    <Dialog open={!!o} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {o && (
          <>
            <DialogHeader>
              <DialogTitle>{o.title}</DialogTitle>
              <DialogDescription>
                {o.statute !== "—" ? `${o.statute} · ` : ""}
                {o.eligibilityBasis}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 sm:grid-cols-2">
              <Fact label="Estimated cost" value={cost(o)} basis={o.estimatedCost?.basis ?? "—"} />
              <Fact
                label="Deadline"
                value={
                  o.deadline.date
                    ? `${fmtDate(o.deadline.date)}${row?.daysLeft != null ? ` (${row.daysLeft < 0 ? "passed" : `${row.daysLeft} days left`})` : ""}`
                    : "—"
                }
                basis={o.deadline.basis}
              />
              <Fact
                label="Potential additional savings"
                value={savings != null ? `${usd(savings)} / yr` : "—"}
                basis={o.potentialAdditionalSavings.basis}
              />
              <Fact
                label="Estimated ROI"
                value={o.estimatedRoi.ratio != null ? `${o.estimatedRoi.ratio}×` : "—"}
                basis={o.estimatedRoi.basis}
              />
              <Fact
                label="Evidence strength"
                value={o.evidenceStrength[0].toUpperCase() + o.evidenceStrength.slice(1)}
                basis="Based on the evidence documents on file for this case."
              />
              <Fact
                label="Risk"
                value={o.risk.band[0].toUpperCase() + o.risk.band.slice(1)}
                basis={o.risk.basis}
              />
            </div>

            {savings != null && savings > 0 && (
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="font-semibold">The calculation</div>
                <ul className="mt-1 grid gap-0.5 text-muted-foreground">
                  {currentValue != null && opinion != null && (
                    <li>
                      Value still in dispute: {usd(currentValue)} − {usd(opinion)} ={" "}
                      {usd(Math.max(0, currentValue - opinion))}
                    </li>
                  )}
                  <li>Additional tax saved in the first year: {usd(savings)}</li>
                  {mid != null && mid > 0 && (
                    <li>
                      After the cost ({usd(mid)} midpoint): {usd(savings - mid)} net in year one
                    </li>
                  )}
                  <li>
                    If the lower value carries forward {CARRY_YEARS} years:{" "}
                    {usd(savings * CARRY_YEARS)}
                    {mid ? ` (${usd(savings * CARRY_YEARS - mid)} net)` : ""} — an illustration, not
                    a promise; each year&apos;s value is set again.
                  </li>
                </ul>
              </div>
            )}

            <div className="rounded-md bg-accent/5 p-3 text-sm">
              <div className="font-semibold">Why pursue it</div>
              <p className="mt-1 text-muted-foreground">{o.practicalBenefit}</p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Not legal advice or a prediction of the outcome. Confirm deadlines and eligibility
              with the appraisal district before relying on them.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
