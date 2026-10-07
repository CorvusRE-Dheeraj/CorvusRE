import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Impairment } from "@/lib/commercial-valuation";
import type { ValueSignal } from "@/lib/evidence-value";
import {
  CATEGORIES,
  estimateRange,
  impactSummary,
  importableBids,
  SUPPORT_LABEL,
  type ImpairmentCategory,
  type Support,
} from "@/lib/impairment-builder";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const STRENGTH_TONE = {
  Strong: "text-success",
  Moderate: "text-accent",
  Weak: "text-warning-foreground",
  None: "text-muted-foreground",
} as const;

type BidDoc = { id: string; fileName: string; costToCure: number | null; kind: string | null };

// Repair / deferred-maintenance impact builder (lib/impairment-builder.ts):
// itemize what a buyer would discount for, priced from a bid, an inspection
// report or a typical cost range, with remaining life for short-lived
// components — and import bids already read from uploaded documents.
export function ImpairmentBuilder({
  items,
  propertyId,
  buildingSqft,
  onChange,
}: {
  items: Impairment[];
  propertyId: string | null;
  buildingSqft: number | null;
  onChange: (items: Impairment[]) => void;
}) {
  const [docs, setDocs] = useState<BidDoc[]>([]);
  const [category, setCategory] = useState<ImpairmentCategory>("roof");
  const [quantity, setQuantity] = useState("");
  const [support, setSupport] = useState<Support>("estimate");
  const [amount, setAmount] = useState("");
  const [remaining, setRemaining] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!propertyId) return;
    supabase
      .from("documents")
      .select("id, file_name, value_signal")
      .eq("property_id", propertyId)
      .is("deleted_at", null)
      .not("value_signal", "is", null)
      .then(({ data }) =>
        setDocs(
          (
            (data ?? []) as { id: string; file_name: string; value_signal: ValueSignal | null }[]
          ).map((d) => ({
            id: d.id,
            fileName: d.file_name,
            costToCure: d.value_signal?.costToCure ?? null,
            kind: d.value_signal?.kind ?? null,
          })),
        ),
      );
  }, [propertyId]);

  const spec = CATEGORIES[category];
  const range = estimateRange(category, num(quantity));
  const documented = support === "bid" || support === "inspection";
  const summary = useMemo(() => impactSummary(items), [items]);
  const bids = importableBids(docs, items);

  // A sensible default quantity for per-SF categories.
  useEffect(() => {
    if (spec.unit?.includes("SF of floor") && buildingSqft) setQuantity(String(buildingSqft));
    else setQuantity("");
  }, [category, spec.unit, buildingSqft]);

  const exact = num(amount);
  const canAdd = documented ? exact != null : range != null || exact != null;

  function add() {
    if (!canAdd) return;
    const high = exact ?? range!.high;
    const low = exact ?? range!.low;
    const rem = remaining === "" ? undefined : Math.max(0, Number(remaining));
    onChange([
      ...items,
      {
        id: crypto.randomUUID(),
        label: label.trim() || spec.label,
        category,
        support,
        quantity: num(quantity) ?? undefined,
        costToCure: high,
        costLow: exact == null ? low : undefined,
        remainingLifeYrs:
          spec.typicalLifeYrs && rem != null && Number.isFinite(rem) ? rem : undefined,
      },
    ]);
    setLabel("");
    setAmount("");
    setRemaining("");
  }

  function importBid(b: { id: string; fileName: string; costToCure: number }) {
    onChange([
      ...items,
      {
        id: crypto.randomUUID(),
        label: b.fileName.replace(/\.[a-z0-9]+$/i, ""),
        category: "other",
        support: "bid",
        costToCure: b.costToCure,
        documentId: b.id,
        documentName: b.fileName,
      },
    ]);
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border p-3 text-xs">
      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5">
          {items.map((x, i) => {
            const s = summary.byItem[i];
            return (
              <div key={x.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{x.label}</div>
                  <div className="text-muted-foreground">
                    {s.note}
                    {x.documentName ? ` · ${x.documentName}` : ""}
                    {x.costLow != null && x.costLow !== x.costToCure
                      ? ` · range ${usd(x.costLow)}–${usd(x.costToCure)}`
                      : ""}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums font-medium">−{usd(s.counted)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${x.label}`}
                    onClick={() => onChange(items.filter((y) => y.id !== x.id))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            );
          })}
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-1.5">
            <span>
              Total impact{" "}
              <span className={`font-semibold ${STRENGTH_TONE[summary.strength]}`}>
                · {summary.strength} support
              </span>
            </span>
            <span className="tabular-nums font-semibold">−{usd(summary.total)}</span>
          </div>
          <p className="text-muted-foreground">
            {usd(summary.documented)} is backed by bids or inspection reports. ARBs give the most
            weight to documented repairs; photo-supported and estimated items are counted at the low
            end of their range.
          </p>
        </div>
      )}

      {bids.length > 0 && (
        <div className="grid gap-1 rounded-md bg-accent/5 p-2">
          <div className="font-semibold">Repair bids found in your documents</div>
          {bids.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{b.fileName}</span>
              </span>
              <button
                type="button"
                onClick={() => importBid(b)}
                className="btn-outline inline-flex shrink-0 items-center gap-1 px-2 py-1 text-xs"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add {usd(b.costToCure)}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        <div className="font-semibold">Add a repair or deferred-maintenance item</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-muted-foreground">What needs work</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ImpairmentCategory)}
              className="rounded-md border border-input bg-background px-2 py-1.5"
            >
              {(Object.keys(CATEGORIES) as ImpairmentCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORIES[c].label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Support</span>
            <select
              value={support}
              onChange={(e) => setSupport(e.target.value as Support)}
              className="rounded-md border border-input bg-background px-2 py-1.5"
            >
              {(Object.keys(SUPPORT_LABEL) as Support[]).map((s) => (
                <option key={s} value={s}>
                  {SUPPORT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {spec.unit && (
            <label className="grid gap-1">
              <span className="text-muted-foreground">Quantity ({spec.unit})</span>
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                inputMode="decimal"
                className="rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-muted-foreground">
              {documented ? "Amount on the bid / report" : "Your figure (optional)"}
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="$"
              inputMode="decimal"
              className="rounded-md border border-input bg-background px-2 py-1.5"
            />
          </label>
          {spec.typicalLifeYrs && (
            <label className="grid gap-1">
              <span className="text-muted-foreground">
                Years of life left (typical life {spec.typicalLifeYrs}; 0 if failed)
              </span>
              <input
                value={remaining}
                onChange={(e) => setRemaining(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0"
                className="rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-muted-foreground">Description (optional)</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={spec.example}
              className="rounded-md border border-input bg-background px-2 py-1.5"
            />
          </label>
        </div>
        {!documented && range && exact == null && (
          <p className="text-muted-foreground">
            Typical Texas commercial cost: {usd(range.low)}–{usd(range.high)} (
            {usd(spec.unitCost!.low)}–{usd(spec.unitCost!.high)} per{" "}
            {spec.unit!.replace(/^SF of /, "SF of ")}
            ). A contractor bid replaces this estimate and carries more weight.
          </p>
        )}
        {!spec.unit && !documented && exact == null && (
          <p className="text-muted-foreground">
            This kind of work is priced per job — enter a figure, or better, a contractor bid.
          </p>
        )}
        <div>
          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className="btn-outline inline-flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add item
          </button>
        </div>
      </div>
    </div>
  );
}
