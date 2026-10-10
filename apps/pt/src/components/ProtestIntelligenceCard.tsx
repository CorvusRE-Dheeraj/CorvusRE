import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronsUpDown, Info } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ArgumentStrength, Answer, ProtestIntelligence } from "@/lib/protest-intelligence";
import type { NextAction } from "@/lib/case-pipeline";
import { VERDICT_LABEL } from "@/lib/decision-card";
import { SettlementHistory } from "@/components/SettlementHistory";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const m = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
    : Math.abs(n) >= 1_000
      ? `$${Math.round(n / 1_000)}K`
      : usd(n);
const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

const VERDICT_TONE = {
  PROTEST: "text-success",
  REVIEW: "text-warning-foreground",
  "NO PROTEST": "text-muted-foreground",
} as const;

const ANSWER_TONE: Record<Answer["tone"], string> = {
  good: "text-success",
  caution: "text-warning-foreground",
  neutral: "text-foreground",
};

const STRENGTH_STYLE: Record<ArgumentStrength["strength"], string> = {
  Strong: "bg-success/15 text-success",
  Moderate: "bg-accent/15 text-accent",
  Weak: "bg-warning/15 text-warning-foreground",
  "Supports county": "bg-destructive/10 text-destructive",
  "Not run": "bg-secondary text-muted-foreground",
};

function ArgumentTable({ args }: { args: ArgumentStrength[] }) {
  if (args.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Run the Commercial Valuation in the property&apos;s report to score each argument.
      </p>
    );
  }
  return (
    <ul className="mt-1 grid gap-1.5">
      {args.map((a) => (
        <li
          key={a.id}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-medium">{a.name}</span>
            <span title={a.why} className="inline-flex text-muted-foreground">
              <Info className="h-3 w-3" aria-label={a.why} />
            </span>
          </span>
          <span className="flex items-center gap-2">
            {a.value != null && (
              <span className="tabular-nums text-muted-foreground">
                {m(a.value)}
                {a.gapPct != null && a.gapPct > 0 ? ` · ${a.gapPct}% under` : ""}
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STRENGTH_STYLE[a.strength]}`}
            >
              {a.strength}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// Protest Intelligence for one property: the nine questions a commercial owner
// needs answered — whether to protest, why, what value to defend, the evidence
// and how strong each argument is, what the district will argue, what to
// accept informally, what to ask the ARB for, and whether a further appeal
// pays — each answered from the case's own facts (lib/protest-intelligence.ts).
// One entry in the card's own property picker (the header tile is the dropdown).
export type IntelPickerOption = {
  id: string;
  address: string;
  verdict: ProtestIntelligence["card"]["verdict"];
  strength: string;
  savings: number | null;
};

export function ProtestIntelligenceCard({
  intel,
  next,
  address,
  propertyId,
  hasCase,
  onStart,
  onReviewEvidence,
  defaultOpen = true,
  settlement,
  picker,
}: {
  intel: ProtestIntelligence;
  next: NextAction;
  address: string;
  propertyId: string;
  hasCase: boolean;
  onStart: () => void;
  onReviewEvidence: () => void;
  defaultOpen?: boolean;
  // The property facts the settlement history is matched on.
  settlement?: { cad: string | null; propertyType: string | null; value: number | null };
  // With more than one property, the header tile opens a property list.
  picker?: { options: IntelPickerOption[]; onSelect: (id: string) => void };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { card } = intel;
  const caseLink = (anchor: string) => ({
    to: "/dashboard/case" as const,
    search: { propertyId, anchor },
  });

  return (
    <article className="card-elev overflow-hidden">
      <div className="flex items-stretch">
        {(() => {
          const summary = (
            <div className="min-w-0">
              <div className="font-serif text-2xl font-semibold">
                <span className={VERDICT_TONE[card.verdict]}>{VERDICT_LABEL[card.verdict]}</span>
                <span className="text-muted-foreground"> — {card.strength}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="truncate">{address}</span>
                {picker && picker.options.length > 1 && (
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
              </div>
            </div>
          );
          const savings = card.savingsAtSettlement != null && (
            <div className="hidden shrink-0 text-right sm:block">
              <div className="text-[11px] text-muted-foreground">Potential annual savings</div>
              <div className="text-lg font-semibold text-success">
                {usd(card.savingsAtSettlement)}
              </div>
            </div>
          );
          const tileCls =
            "flex min-w-0 flex-1 items-start justify-between gap-3 p-5 text-left transition-colors hover:bg-secondary/30";
          if (!picker || picker.options.length < 2) {
            return (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className={tileCls}
              >
                {summary}
                {savings}
              </button>
            );
          }
          return (
            <DropdownMenu>
              <DropdownMenuTrigger className={tileCls} aria-label="Choose a property">
                {summary}
                {savings}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-80 w-[min(36rem,90vw)] overflow-y-auto"
              >
                {picker.options.map((o) => (
                  <DropdownMenuItem
                    key={o.id}
                    onSelect={() => picker.onSelect(o.id)}
                    className={`flex items-center justify-between gap-3 py-2 ${o.id === propertyId ? "bg-secondary" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${VERDICT_TONE[o.verdict]}`}>
                        {VERDICT_LABEL[o.verdict]}{" "}
                        <span className="font-normal text-muted-foreground">— {o.strength}</span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {o.address}
                      </span>
                    </span>
                    {o.savings != null && (
                      <span className="shrink-0 text-sm font-semibold text-success">
                        {usd(o.savings)}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })()}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide details" : "Show details"}
          className="shrink-0 px-4 hover:bg-secondary/30"
        >
          <ChevronDown
            className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {open && (
        <div className="border-t border-border p-5">
          <ol className="grid gap-4">
            {intel.answers.map((a, i) => (
              <li key={a.id} className="grid grid-cols-[1.75rem_1fr] gap-x-2">
                <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full bg-secondary text-xs font-semibold">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {a.question}
                  </div>
                  <div className={`font-semibold ${ANSWER_TONE[a.tone]}`}>{a.headline}</div>
                  {a.id === "strength" && <ArgumentTable args={intel.arguments} />}
                  {a.points.length > 0 && (
                    <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
                      {a.points.map((p) => (
                        <li key={p} className="flex gap-1.5">
                          <span aria-hidden="true">·</span>
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {settlement && (
            <div className="mt-5">
              <SettlementHistory
                cad={settlement.cad}
                propertyType={settlement.propertyType}
                value={settlement.value}
                offer={
                  card.offer ? { original: card.offer.original, offer: card.offer.offer } : null
                }
              />
            </div>
          )}

          <section aria-label="Next action" className="mt-5 rounded-lg bg-secondary/50 p-4">
            <p className="text-sm">
              <span className="font-semibold">Next action:</span> {next.title}
              {next.dueDate && <> by {fmtDate(next.dueDate)}</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {hasCase ? (
                <Link
                  {...caseLink("case-documents")}
                  className="btn-primary btn-primary-hover text-sm"
                >
                  File Myself — Instructions
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onStart}
                  className="btn-primary btn-primary-hover text-sm"
                >
                  File Myself — Instructions
                </button>
              )}
              {hasCase ? (
                <Link {...caseLink("case-documents")} className="btn-outline text-sm">
                  Download Form
                </Link>
              ) : (
                <button type="button" onClick={onStart} className="btn-outline text-sm">
                  Download Form
                </button>
              )}
              <button type="button" onClick={onReviewEvidence} className="btn-outline text-sm">
                Review Evidence
              </button>
              {hasCase && (
                <Link {...caseLink("case-hearing-prep")} className="btn-outline text-sm">
                  Prepare for Hearing
                </Link>
              )}
            </div>
          </section>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Corvus AI&apos;s analysis is computed from your county record, its valuation approaches
            and your case. It presents estimates and options to inform your own decisions — it
            isn&apos;t property tax advice or a guarantee of any outcome.
          </p>
        </div>
      )}
    </article>
  );
}
