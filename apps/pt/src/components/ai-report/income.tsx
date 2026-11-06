import { LoadingLine } from "@/components/LoadingLine";
import { type ModuleResultMap } from "@/lib/ai-report-modules";
import { type CompsResult } from "@/lib/cad-comps";
import { computeComparableStats } from "@/lib/comps-analysis";
import { type DocumentRecord } from "@/lib/documents";
import { categorizeEvidenceUploads } from "@/lib/evidence-categorize";
import {
  type IncomeAnalysis,
  type IncomeAnalysisInput,
  type IncomeExtraction,
} from "@/lib/income-analysis";
import { incomeSupportsCad, type IncomeApproach } from "@/lib/income-approach";
import { currency, type IntakeState } from "@/lib/intake-store";
import { type Module } from "@/lib/modules";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  DollarSign,
  FileWarning,
  Gauge,
  RefreshCw,
  Scale,
  Upload,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { compactCurrency } from "./comps";
import { AiVerdictLine } from "./module-preview";
import { ModuleAsyncState } from "./shared";
import { AnalysisPipeline } from "./strategy";
import { ZoningImpactCol } from "./zoning";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: income.
// ── Module 7 (Income Value) ───────────────────────────────────────────────
// Every figure rendered here is the deterministic result from
// src/lib/income-approach.ts (computed from owner-confirmed data) — never an
// AI value. The AI narrative (moduleData.income) only explains these.

export const INCOME_DOC_KINDS = ["P&L", "Operating Statement", "Rent Roll", "Appraisal"] as const;

// A recharts waterfall: Potential Income → −Vacancy → −Operating Expenses →
// NOI → (÷ Cap Rate) → Indicated Value. Two stacked bars — a transparent
// spacer that lifts each step to its running total, then the visible delta.
export function IncomeWaterfall({
  c,
  height = 210,
  compact = false,
}: {
  c: IncomeApproach;
  height?: number;
  compact?: boolean;
}) {
  // Caller renders the ladder preview / table for the incomplete state.
  if (!c.dataComplete || c.gpi == null || c.egi == null || c.noi == null) return null;
  const potential = c.gpi + c.otherIncome;
  const vac = c.vacancyLoss ?? 0;
  const opex = c.operatingExpenses ?? 0;
  const indicated = c.indicatedValue;
  // name = short axis label; base = transparent lift to the running total;
  // delta = the visible change; show = the number printed on the bar.
  const steps: { name: string; base: number; delta: number; fill: string; show: string }[] = [
    {
      name: "Potential",
      base: 0,
      delta: potential,
      fill: "#3b82f6",
      show: compactCurrency(potential),
    },
    {
      name: "Vacancy",
      base: potential - vac,
      delta: vac,
      fill: "#f87171",
      show: `−${compactCurrency(vac)}`,
    },
    {
      name: "Op. Exp.",
      base: c.noi,
      delta: opex,
      fill: "#fb923c",
      show: `−${compactCurrency(opex)}`,
    },
    { name: "NOI", base: 0, delta: c.noi, fill: "#1d4ed8", show: compactCurrency(c.noi) },
    {
      name: `Cap ${c.capRatePct != null ? `${c.capRatePct}%` : ""}`.trim(),
      base: 0,
      delta: 0,
      fill: "#2dd4bf",
      show: "",
    },
    indicated != null
      ? {
          name: "Value",
          base: 0,
          delta: indicated,
          fill: "#22c55e",
          show: compactCurrency(indicated),
        }
      : { name: "Value", base: 0, delta: 0, fill: "#94a3b8", show: "cap rate needed" },
  ];
  const yMax = Math.ceil(Math.max(potential, indicated ?? 0) * 1.18);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={steps}
        margin={{ top: 18, right: 8, left: 8, bottom: 4 }}
        barCategoryGap="22%"
      >
        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: compact ? 9 : 10 }}
          interval={0}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          hide={compact}
          width={compact ? 0 : 44}
          domain={[0, yMax]}
          tick={{ fontSize: 9 }}
          tickFormatter={compactCurrency}
          axisLine={false}
          tickLine={false}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="delta" stackId="w" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {steps.map((s, i) => (
            <Cell key={i} fill={s.fill} />
          ))}
          <LabelList dataKey="show" position="top" fontSize={compact ? 9 : 10} fontWeight={600} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Card empty/partial state — the exact ladder the module computes. When
// `editable`, the four owner-driven rows (GPI, Vacancy %, Operating
// Expenses, Cap Rate %) are inline inputs so the values can be entered right
// on the card, without opening the module; EGI / NOI / Indicated Value stay
// computed. Nothing here is estimated.
export function IncomeLadderPreview({
  computed,
  editable,
  analysis,
  onSave,
  onOpen,
}: {
  computed: IncomeApproach;
  editable?: boolean;
  analysis?: IncomeAnalysis | null;
  onSave?: (input: IncomeAnalysisInput) => void;
  onOpen?: () => void;
}) {
  const seed = () => ({
    gpi: computed.gpi != null ? String(computed.gpi) : "",
    vac: computed.vacancyPct != null ? String(computed.vacancyPct) : "",
    opex: computed.operatingExpenses != null ? String(computed.operatingExpenses) : "",
    cap: computed.capRatePct != null ? String(computed.capRatePct) : "",
  });
  const [f, setF] = useState(seed);
  const extKey = [
    computed.gpi,
    computed.vacancyPct,
    computed.operatingExpenses,
    computed.capRatePct,
  ].join("|");
  useEffect(() => {
    setF(seed());
  }, [extKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const parse = (v: string): number | null => {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  const dirty =
    f.gpi !== seed().gpi || f.vac !== seed().vac || f.opex !== seed().opex || f.cap !== seed().cap;
  const money = (v: number | null | undefined) => (v != null ? compactCurrency(v) : "—");

  // One fixed-width value column so every input box and read-only value
  // shares the same right edge and width, whatever the $ / % affix.
  const VALUE_COL = "w-24 shrink-0 sm:w-[8.5rem]";
  const inputCell = (key: "gpi" | "vac" | "opex" | "cap", prefix?: string, suffix?: string) => (
    <span
      className={`${VALUE_COL} flex items-center rounded border border-border bg-background px-1.5 focus-within:border-accent`}
    >
      <span className="w-2.5 shrink-0 text-muted-foreground">{prefix ?? ""}</span>
      <input
        inputMode="decimal"
        value={f[key]}
        placeholder="—"
        onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))}
        className="min-w-0 flex-1 bg-transparent py-0.5 text-right text-xs tabular-nums outline-none"
      />
      <span className="w-2.5 shrink-0 text-right text-muted-foreground">{suffix ?? ""}</span>
    </span>
  );
  const readCell = (v: string) => (
    <span className={`${VALUE_COL} text-right tabular-nums`}>{v}</span>
  );

  const rows: { label: string; cell: React.ReactNode }[] = [
    {
      label: "Gross Potential Income",
      cell: editable ? inputCell("gpi", "$") : readCell(money(computed.gpi)),
    },
    {
      label: "(−) Vacancy",
      cell: editable ? inputCell("vac", "", "%") : readCell(money(computed.vacancyLoss)),
    },
    { label: "Effective Gross Income", cell: readCell(money(computed.egi)) },
    {
      label: "(−) Operating Expenses",
      cell: editable ? inputCell("opex", "$") : readCell(money(computed.operatingExpenses)),
    },
    { label: "Net Operating Income", cell: readCell(money(computed.noi)) },
    {
      label: "÷ Market Cap Rate",
      cell: editable ? inputCell("cap", "", "%") : readCell(money(computed.capRatePct)),
    },
  ];

  function save() {
    if (!onSave) return;
    onSave({
      grossPotentialIncome: parse(f.gpi),
      vacancyPct: parse(f.vac),
      operatingExpenses: parse(f.opex),
      capRatePct: parse(f.cap),
      capRateSource: parse(f.cap) != null ? (analysis?.capRateSource ?? "owner") : null,
      otherIncome: analysis?.otherIncome ?? null,
      noiStated: analysis?.noiStated ?? null,
      rentableSqft: analysis?.rentableSqft ?? null,
      sourceDocumentIds: analysis?.sourceDocumentIds ?? [],
      notes: analysis?.notes ?? null,
    });
  }

  // Same non-blocking sanity check as the full income form (a real
  // commercial cap rate is usually ~5-10%; well outside that, NOI ÷ cap
  // rate swings the indicated value 5-10x) — this compact card is the more
  // commonly used entry point, so it needs the same warning, not just the
  // "More options" modal.
  const capRateNum = parse(f.cap);
  const capRateHint =
    editable && capRateNum != null && (capRateNum < 3 || capRateNum > 20)
      ? `${capRateNum}% is unusual for commercial property (typically 5–10%) — double-check this before saving.`
      : null;

  return (
    <div className="grid gap-2">
      <div
        className={`rounded-lg border p-3 ${editable ? "border-border" : "border-dashed border-border"}`}
      >
        <div className="grid gap-1 text-xs text-muted-foreground">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-2">
              <span>{r.label}</span>
              {r.cell}
            </div>
          ))}
          {capRateHint && (
            <p className="text-[10px] leading-tight text-warning-foreground">{capRateHint}</p>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-border/60 pt-1.5 text-sm font-semibold text-foreground">
            <span>Indicated Value</span>
            <span className={`${VALUE_COL} pr-2.5 text-right tabular-nums`}>
              {computed.indicatedValue != null ? compactCurrency(computed.indicatedValue) : "—"}
            </span>
          </div>
        </div>
        {computed.cadValue != null && (
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Current CAD value</span>
            <span
              className={`${VALUE_COL} pr-2.5 text-right font-semibold tabular-nums text-foreground`}
            >
              {compactCurrency(computed.cadValue)}
            </span>
          </div>
        )}
      </div>
      {editable ? (
        <div className="flex items-center justify-between gap-2">
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className="text-xs font-medium text-accent hover:underline"
            >
              More options & upload docs
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="btn-primary text-xs disabled:opacity-50"
          >
            Save values
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-muted-foreground">
          <FileWarning className="h-4 w-4 shrink-0" />
          <span className="text-xs">Add a P&amp;L, rent roll, or appraisal to run this</span>
        </div>
      )}
    </div>
  );
}

export const INCOME_VERDICT: Record<
  "supports" | "does-not-support" | "inconclusive",
  { label: string; cls: string }
> = {
  supports: { label: "Income Supports CAD Value", cls: "bg-success/10 text-success" },
  "does-not-support": {
    label: "Income Does Not Support CAD Value",
    cls: "bg-accent/10 text-accent",
  },
  inconclusive: {
    label: "Income Analysis Inconclusive",
    cls: "bg-secondary text-muted-foreground",
  },
};

export function IncomeVerdictBand({
  supports,
  onClick,
}: {
  supports: "supports" | "does-not-support" | "inconclusive";
  onClick?: () => void;
}) {
  const v = INCOME_VERDICT[supports];
  const inner = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/60">
        <DollarSign className="h-4 w-4" />
      </span>
      <span className="flex-1 text-left text-sm font-semibold">{v.label}</span>
      {onClick && <ArrowRight className="h-4 w-4 shrink-0" />}
    </>
  );
  return onClick ? (
    <button
      onClick={onClick}
      className={`mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 ${v.cls}`}
    >
      {inner}
    </button>
  ) : (
    <div className={`mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 ${v.cls}`}>
      {inner}
    </div>
  );
}

// Compact card visual (ModuleVisual) — mini waterfall + Income Value vs CAD
// Value tiles + the verdict band. Mirrors the reference card.
export function IncomeCardVisual({
  computed,
  supports,
  onOpen,
}: {
  computed: IncomeApproach;
  supports: "supports" | "does-not-support" | "inconclusive";
  onOpen: () => void;
}) {
  return (
    <div>
      <IncomeWaterfall c={computed} height={130} compact />
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="rounded-lg bg-accent/10 p-2 text-center">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-accent">
            Income Value
          </div>
          <div className="text-sm font-bold text-accent">
            {computed.indicatedValue != null ? compactCurrency(computed.indicatedValue) : "—"}
          </div>
        </div>
        <span className="text-[10px] font-bold text-muted-foreground">vs</span>
        <div className="rounded-lg bg-destructive/10 p-2 text-center">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-destructive">
            CAD Value
          </div>
          <div className="text-sm font-bold text-destructive">
            {computed.cadValue != null ? compactCurrency(computed.cadValue) : "—"}
          </div>
        </div>
      </div>
      <IncomeVerdictBand supports={supports} onClick={onOpen} />
    </div>
  );
}

// The full 3-up value comparison in the modal: Income Value · AI Market Value
// Range (from Module 3's comps) · CAD Value, then the verdict band.
export function IncomeValueComparison({
  computed,
  compsRange,
  supports,
}: {
  computed: IncomeApproach;
  compsRange: { min: number; max: number } | null;
  supports: "supports" | "does-not-support" | "inconclusive";
}) {
  return (
    <div>
      <div className={`grid gap-2 ${compsRange ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="rounded-lg bg-accent/10 p-3 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-accent">
            Income Value
          </div>
          <div className="font-serif text-xl font-bold text-accent">
            {computed.indicatedValue != null ? compactCurrency(computed.indicatedValue) : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {computed.reliability} reliability
          </div>
        </div>
        {compsRange && (
          <div className="rounded-lg bg-success/10 p-3 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-success">
              AI Market Value Range
            </div>
            <div className="font-serif text-xl font-bold text-success">
              {compactCurrency(compsRange.min)}–{compactCurrency(compsRange.max)}
            </div>
            <div className="text-[10px] text-muted-foreground">from comparable sales</div>
          </div>
        )}
        <div className="rounded-lg bg-destructive/10 p-3 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
            CAD Value
          </div>
          <div className="font-serif text-xl font-bold text-destructive">
            {computed.cadValue != null ? compactCurrency(computed.cadValue) : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">current assessed</div>
        </div>
      </div>
      <IncomeVerdictBand supports={supports} />
    </div>
  );
}

// The income-approach summary ladder — every value straight from `c`.
export function IncomeApproachTable({ c }: { c: IncomeApproach }) {
  const money = (v: number | null | undefined) => (v != null ? currency(v) : "—");
  const rows: {
    label: string;
    value: string;
    hint?: string;
    strong?: boolean;
    accent?: boolean;
  }[] = [
    {
      label: "Gross Potential Income",
      value: money(c.gpi),
      hint: c.gpi == null ? "Needs data" : undefined,
    },
    {
      label: `(−) Vacancy${c.vacancyPct != null ? ` (${c.vacancyPct}%)` : ""}`,
      value: c.vacancyLoss != null ? `(${currency(c.vacancyLoss)})` : "—",
      hint: c.vacancyPct == null ? "Needs data" : undefined,
    },
    c.otherIncome
      ? { label: "(+) Other Income", value: currency(c.otherIncome) }
      : { label: "(+) Other Income", value: "—" },
    { label: "Effective Gross Income", value: money(c.egi), strong: true },
    {
      label: `(−) Operating Expenses${c.opexRatioPct != null ? ` (${c.opexRatioPct}% of EGI)` : ""}`,
      value: c.operatingExpenses != null ? `(${currency(c.operatingExpenses)})` : "—",
      hint: c.operatingExpenses == null ? "Needs data" : undefined,
    },
    { label: "Net Operating Income (NOI)", value: money(c.noi), strong: true },
    {
      label: "÷ Market Cap Rate",
      value:
        c.capRatePct != null
          ? `${c.capRatePct}%${c.capRateSource ? ` (${c.capRateSource === "appraisal" ? "appraisal" : "your input"})` : ""}`
          : "—",
      hint: c.capRatePct == null ? "Needs a cap rate" : undefined,
    },
    {
      label: "Indicated Value",
      value: c.indicatedValue != null ? currency(c.indicatedValue) : "—",
      accent: true,
      hint: c.indicatedValue == null ? "Complete the figures above" : undefined,
    },
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="bg-secondary/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Income Approach (Summary)
      </div>
      <table className="w-full text-xs sm:text-sm">
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              className={`border-t border-border/60 ${r.accent ? "bg-success/10" : r.strong ? "bg-secondary/30" : ""}`}
            >
              <td className={`px-3 py-2 sm:px-4 ${r.strong || r.accent ? "font-semibold" : ""}`}>
                {r.label}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums sm:px-4 ${
                  r.accent
                    ? "font-serif text-sm font-bold text-success sm:text-base"
                    : r.strong
                      ? "font-semibold"
                      : ""
                }`}
              >
                {r.value}
                {r.hint && (
                  <span className="ml-2 rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground">
                    {r.hint}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Data Availability panel — which income source documents the owner has
// provided. One "Upload documents" control at the bottom; the AI reads each
// file and tags it to the right kind (see IncomeWorkspace.handleAutoUpload),
// so the owner never has to pick a category. Documents already tagged to
// this section are listed underneath the four kind rows.
export function IncomeDataAvailability({
  docKinds,
  incomeDocs,
  onUpload,
  uploading,
  categorizing,
}: {
  docKinds: string[];
  incomeDocs: DocumentRecord[];
  onUpload?: (files: File[]) => void;
  uploading?: boolean;
  categorizing?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="bg-secondary/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Data Availability
      </div>
      <ul className="divide-y divide-border/60">
        {INCOME_DOC_KINDS.map((kind) => {
          const has = docKinds.includes(kind);
          return (
            <li
              key={kind}
              className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs sm:px-4 sm:text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                {has ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <FileWarning className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">
                  {kind}
                  {kind === "Appraisal" && (
                    <span className="ml-1 text-muted-foreground">(cap rate)</span>
                  )}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs font-semibold ${has ? "text-success" : "text-muted-foreground"}`}
              >
                {has ? "Provided" : "Not provided"}
              </span>
            </li>
          );
        })}
      </ul>

      {incomeDocs.length > 0 && (
        <div className="border-t border-border/60 px-3 py-2.5 sm:px-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Documents in this section
          </div>
          <ul className="mt-1 grid gap-1">
            {incomeDocs.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{doc.fileName}</span>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {doc.documentType?.replace(/^Income:\s*/, "") || "Income"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onUpload && (
        <div className="border-t border-border/60 px-3 py-3 text-center sm:px-4">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-accent/50 bg-background px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10">
            <input
              type="file"
              accept="image/*,.pdf,.csv,.xlsx,.xls"
              multiple
              disabled={uploading || categorizing}
              className="hidden"
              onChange={(e) => {
                const sel = Array.from(e.target.files ?? []);
                if (sel.length > 0) onUpload(sel);
                e.target.value = "";
              }}
            />
            <Upload className="h-3.5 w-3.5" />
            {categorizing ? "Reading documents…" : uploading ? "Uploading…" : "Upload documents"}
          </label>
          <p className="mt-1 text-[10px] text-muted-foreground">
            The AI reads each file and tags it (P&amp;L, rent roll, operating statement, appraisal).
          </p>
        </div>
      )}
    </div>
  );
}

export type IncomeFormState = {
  grossPotentialIncome: string;
  otherIncome: string;
  vacancyPct: string;
  operatingExpenses: string;
  noiStated: string;
  rentableSqft: string;
  capRatePct: string;
  capRateSource: "appraisal" | "owner";
};

export function toFormState(a: IncomeAnalysis | null): IncomeFormState {
  const s = (v: number | null | undefined) => (v != null ? String(v) : "");
  return {
    grossPotentialIncome: s(a?.grossPotentialIncome),
    otherIncome: s(a?.otherIncome),
    vacancyPct: s(a?.vacancyPct),
    operatingExpenses: s(a?.operatingExpenses),
    noiStated: s(a?.noiStated),
    rentableSqft: s(a?.rentableSqft),
    capRatePct: s(a?.capRatePct),
    capRateSource: a?.capRateSource ?? "owner",
  };
}

export const numOrNull = (v: string): number | null => {
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

// The editable review form — pre-fills from AI-extracted document figures,
// the owner confirms/corrects, then Save persists and re-runs Module 7.
export function IncomeFiguresForm({
  analysis,
  incomeDocs,
  canEdit,
  onExtractIncome,
  onSave,
}: {
  analysis: IncomeAnalysis | null;
  incomeDocs: DocumentRecord[];
  canEdit: boolean;
  onExtractIncome: (documentId: string) => Promise<IncomeExtraction>;
  onSave: (input: IncomeAnalysisInput) => void;
}) {
  const [form, setForm] = useState<IncomeFormState>(() => toFormState(analysis));
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const analysisKey = analysis?.updatedAt ?? "none";
  useEffect(() => {
    setForm(toFormState(analysis));
  }, [analysisKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof IncomeFormState>(k: K, v: IncomeFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function runExtract() {
    if (incomeDocs.length === 0) return;
    setExtracting(true);
    setExtractNote(null);
    try {
      const results = await Promise.all(
        incomeDocs.map((d) => onExtractIncome(d.id).catch(() => null)),
      );
      setForm((f) => {
        const next = { ...f };
        const fill = (k: Exclude<keyof IncomeFormState, "capRateSource">, v: number | null) => {
          if (v != null && next[k] === "") next[k] = String(v);
        };
        for (const r of results) {
          if (!r) continue;
          fill("grossPotentialIncome", r.grossPotentialIncome);
          fill("otherIncome", r.otherIncome);
          fill("vacancyPct", r.vacancyPct);
          fill("operatingExpenses", r.operatingExpenses);
          fill("noiStated", r.noi);
          fill("rentableSqft", r.rentableSqft);
          if (r.capRatePct != null && next.capRatePct === "") {
            next.capRatePct = String(r.capRatePct);
            next.capRateSource = "appraisal";
          }
        }
        return next;
      });
      const got = results.filter(Boolean).length;
      setExtractNote(
        got > 0
          ? `Read ${got} document${got === 1 ? "" : "s"}. Review and correct anything below, then Save.`
          : "Couldn't read figures from the uploaded documents — enter them below.",
      );
    } finally {
      setExtracting(false);
    }
  }

  function submit() {
    onSave({
      grossPotentialIncome: numOrNull(form.grossPotentialIncome),
      otherIncome: numOrNull(form.otherIncome),
      vacancyPct: numOrNull(form.vacancyPct),
      operatingExpenses: numOrNull(form.operatingExpenses),
      noiStated: numOrNull(form.noiStated),
      rentableSqft: numOrNull(form.rentableSqft),
      capRatePct: numOrNull(form.capRatePct),
      capRateSource: form.capRatePct.trim() !== "" ? form.capRateSource : null,
      sourceDocumentIds: incomeDocs.map((d) => d.id),
    });
  }

  const field = (
    label: string,
    k: keyof IncomeFormState,
    opts?: { prefix?: string; suffix?: string; hint?: string },
  ) => (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="flex items-center rounded-md border border-border bg-background px-2 focus-within:border-accent">
        {opts?.prefix && <span className="text-muted-foreground">{opts.prefix}</span>}
        <input
          inputMode="decimal"
          disabled={!canEdit}
          value={form[k] as string}
          onChange={(e) => set(k, e.target.value)}
          className="w-full bg-transparent py-1.5 text-sm outline-none disabled:opacity-60"
        />
        {opts?.suffix && <span className="text-muted-foreground">{opts.suffix}</span>}
      </span>
      {opts?.hint && <span className="text-[11px] text-warning-foreground">{opts.hint}</span>}
    </label>
  );

  // A real commercial cap rate is usually ~5-10% — well outside that, NOI ÷
  // cap rate swings wildly (e.g. a 1% entry meant to be a placeholder or a
  // typo can produce an indicated value 5-10x too high), so this flags it
  // right where it's entered instead of only showing up as a confusing
  // Income Value number later. Non-blocking: still saves either way, in case
  // the property genuinely has an unusual rate.
  const capRateNum = numOrNull(form.capRatePct);
  const capRateHint =
    capRateNum != null && (capRateNum < 3 || capRateNum > 20)
      ? `${capRateNum}% is unusual for commercial property (typically 5–10%) — double-check this before saving; it has a big effect on the indicated value.`
      : undefined;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Income Figures
        </div>
        {canEdit && incomeDocs.length > 0 && (
          <button
            type="button"
            onClick={runExtract}
            disabled={extracting}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-60"
          >
            {extracting ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
            {extracting ? "Reading documents…" : "Extract from uploaded documents"}
          </button>
        )}
      </div>
      {extractNote && <p className="mt-1.5 text-[11px] text-muted-foreground">{extractNote}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field("Gross potential income (annual)", "grossPotentialIncome", { prefix: "$" })}
        {field("Other income (annual)", "otherIncome", { prefix: "$" })}
        {field("Vacancy / collection loss", "vacancyPct", { suffix: "%" })}
        {field("Operating expenses (annual)", "operatingExpenses", { prefix: "$" })}
        {field("Stated NOI (optional, from a doc)", "noiStated", { prefix: "$" })}
        {field("Rentable area (optional)", "rentableSqft", { suffix: "SF" })}
        {field("Capitalization rate", "capRatePct", { suffix: "%", hint: capRateHint })}
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Cap rate source</span>
          <select
            disabled={!canEdit}
            value={form.capRateSource}
            onChange={(e) => set("capRateSource", e.target.value as "owner" | "appraisal")}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-60"
          >
            <option value="owner">I'm providing this rate</option>
            <option value="appraisal">From an appraisal</option>
          </select>
        </label>
      </div>
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={submit} className="btn-primary text-sm">
            Save figures
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Figures come only from your documents or your entry — nothing here is estimated. The
        indicated value is <span className="font-medium">NOI ÷ cap rate</span>, computed from what
        you enter.
      </p>
    </div>
  );
}

// The full Module 7 workspace shown in the preview modal.
export function IncomeWorkspace({
  m,
  state,
  moduleState,
  compsMap,
  analysis,
  computed,
  evidenceDocs,
  allowEvidenceUpload,
  uploadingEvidence,
  onUploadEvidence,
  onSaveIncomeAnalysis,
  onExtractIncome,
  onForceReload,
  onMarkNotApplicable,
}: {
  m: Module;
  state: IntakeState;
  moduleState: ModuleAsyncState | undefined;
  compsMap: { data: CompsResult | null; loading: boolean };
  analysis: IncomeAnalysis | null;
  computed: IncomeApproach;
  evidenceDocs: DocumentRecord[];
  allowEvidenceUpload: boolean;
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[], strategyId?: string, documentTypeOverride?: string) => void;
  onSaveIncomeAnalysis: (input: IncomeAnalysisInput) => void;
  onExtractIncome: (documentId: string) => Promise<IncomeExtraction>;
  onForceReload: () => void;
  onMarkNotApplicable: () => void;
}) {
  const incomeDocs = evidenceDocs.filter(
    (d) => d.modules?.includes("income") || d.documentType?.startsWith("Income: "),
  );
  const docKinds = [
    ...new Set(
      incomeDocs
        .map((d) => d.documentType?.replace(/^Income:\s*/, "").trim())
        .filter((k): k is string => !!k),
    ),
  ];
  const d = moduleState?.data as ModuleResultMap["income"] | undefined;

  // One upload -> the AI reads each file and tags it to the right income
  // kind, so the four per-row upload buttons collapse to one. Mirrors
  // Module 8's handleBulkUploadEvidence: categorize, group, upload per
  // group; a failed categorization just tags everything "Income: Other"
  // and the upload still happens.
  const [categorizingIncomeDocs, setCategorizingIncomeDocs] = useState(false);
  async function handleAutoUpload(files: File[]) {
    setCategorizingIncomeDocs(true);
    try {
      const categorized = await categorizeEvidenceUploads([...INCOME_DOC_KINDS], files);
      const groups = new Map<string, File[]>();
      for (const file of files) {
        const matched = categorized.find((c) => c.fileName === file.name)?.matchedItem ?? null;
        const key =
          matched && (INCOME_DOC_KINDS as readonly string[]).includes(matched) ? matched : "Other";
        const g = groups.get(key);
        if (g) g.push(file);
        else groups.set(key, [file]);
      }
      for (const [kind, groupFiles] of groups) {
        await onUploadEvidence(groupFiles, undefined, `Income: ${kind}`);
      }
    } finally {
      setCategorizingIncomeDocs(false);
    }
  }
  const supports = d?.supportsCadValue ?? incomeSupportsCad(computed);
  const cs = computeComparableStats(
    compsMap.data?.subject ?? null,
    compsMap.data?.comps ?? [],
    state.totalValue,
  );
  const compsRange = cs.indicated ? { min: cs.indicated.min, max: cs.indicated.max } : null;
  const aiLoading = computed.dataComplete && (!moduleState || moduleState.loading);

  return (
    <div className="mt-4 grid gap-4">
      <p className="-mb-1 text-sm text-muted-foreground">
        AI models the income approach when the figures are available — every number below is yours,
        computed as <span className="font-medium">NOI ÷ cap rate</span>, never estimated.
      </p>
      <AnalysisPipeline
        steps={[
          { eyebrow: "User input", label: "Income data (P&L, rent roll)", Icon: User },
          { eyebrow: "AI processing", label: "Income modeling engine", Icon: Cpu },
          { eyebrow: "Logic / decision", label: "NOI & cap-rate model", Icon: Scale },
          { eyebrow: "AI output", label: "Income value estimate", Icon: Gauge, current: true },
          { eyebrow: "Next step", label: "Compare & apply weight", Icon: ArrowRight },
        ]}
      />

      <IncomeDataAvailability
        docKinds={docKinds}
        incomeDocs={incomeDocs}
        onUpload={allowEvidenceUpload ? handleAutoUpload : undefined}
        uploading={uploadingEvidence}
        categorizing={categorizingIncomeDocs}
      />

      <IncomeFiguresForm
        analysis={analysis}
        incomeDocs={incomeDocs}
        canEdit={allowEvidenceUpload}
        onExtractIncome={onExtractIncome}
        onSave={onSaveIncomeAnalysis}
      />

      <IncomeApproachTable c={computed} />
      {computed.dataComplete && (
        <div className="rounded-lg border border-border p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Income Waterfall
          </div>
          <IncomeWaterfall c={computed} />
        </div>
      )}
      <IncomeValueComparison computed={computed} compsRange={compsRange} supports={supports} />

      {aiLoading && <LoadingLine text="Modeling the income approach…" className="text-sm" />}
      {d && (
        <div className="grid gap-3">
          <AiVerdictLine icon={m.icon} text={d.assessment} color={m.color} />
          {d.cadComparisonNarrative && (
            <p className="text-sm text-muted-foreground">{d.cadComparisonNarrative}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <ZoningImpactCol title="Valuation basis" tone="success">
              <p className="mb-1">
                <span className="font-medium text-foreground">Vacancy:</span>{" "}
                {d.vacancyBasis || "—"}
              </p>
              <p className="mb-1">
                <span className="font-medium text-foreground">Operating expenses:</span>{" "}
                {d.opexBasis || "—"}
              </p>
              <p>
                <span className="font-medium text-foreground">Cap rate:</span>{" "}
                {d.capRateBasis || "—"}
              </p>
            </ZoningImpactCol>
            <ZoningImpactCol title="Assumptions & sources" tone="accent">
              {d.assumptions.length > 0 && (
                <ul className="mb-2 grid list-disc gap-1 pl-4">
                  {d.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              )}
              {d.sources.length > 0 ? (
                <p className="text-[11px]">
                  <span className="font-medium text-foreground">Sources:</span>{" "}
                  {d.sources.join("; ")}
                </p>
              ) : (
                <p>—</p>
              )}
            </ZoningImpactCol>
            <ZoningImpactCol title="Confidence & missing info" tone="success">
              <p className="mb-1">{d.confidenceNote || "—"}</p>
              {d.missingInformation.length > 0 && (
                <ul className="grid list-disc gap-1 pl-4">
                  {d.missingInformation.map((mi, i) => (
                    <li key={i}>{mi}</li>
                  ))}
                </ul>
              )}
            </ZoningImpactCol>
          </div>
        </div>
      )}
      {moduleState?.error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span className="text-destructive">Couldn't generate the income narrative.</span>
          <button onClick={onForceReload} className="btn-outline text-xs">
            Retry
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onMarkNotApplicable}
        className="justify-self-start text-xs font-medium text-accent hover:underline"
      >
        I don't have this — mark Not Applicable
      </button>
    </div>
  );
}
