import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/error-message";
import {
  REQUIREMENT_LABEL,
  listCountyTaxSettings,
  listPaymentPlans,
  saveCountyTaxSettings,
  savePaymentPlan,
  type CountyTaxSettings,
  type PaymentPlan,
  type PlanKind,
  type PlanPropertyType,
  type PlanScheduleStep,
} from "@/lib/pay-taxes";

// Operations → County Tax Rules: the county-wise payment plans and payment
// portals the Pay Taxes tab reads (county_payment_plans / county_tax_settings).
// A county that changes its policy is updated here — no code change.
const KINDS: PlanKind[] = ["half", "quarter", "monthly", "prepay", "discount", "disaster", "other"];
const TYPES: PlanPropertyType[] = ["commercial", "residential", "bpp"];
const input = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

const blankPlan = (): PaymentPlan => ({
  county: "",
  planKey: "half_payment",
  name: "Half-Payment Plan",
  kind: "half",
  propertyTypes: [],
  requirement: null,
  schedule: [
    { label: "First half", pct: 50, month: 11, day: 30, yearOffset: 0 },
    { label: "Second half", pct: 50, month: 6, day: 30, yearOffset: 1 },
  ],
  enrollmentNote: "",
  status: "to_confirm",
  sourceUrl: "",
  active: true,
});

const blankSettings = (): CountyTaxSettings => ({
  county: "",
  paymentPortalUrl: "",
  accountUrlTemplate: "",
  accountPattern: "",
  delinquencyMonthDay: "02-01",
  notes: "",
  sourceUrl: "",
  updatedAt: null,
});

export function AdminCountyTaxRules() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [settings, setSettings] = useState<CountyTaxSettings[]>([]);
  const [editPlan, setEditPlan] = useState<PaymentPlan | null>(null);
  const [editSettings, setEditSettings] = useState<CountyTaxSettings | null>(null);
  const [q, setQ] = useState("");

  const reload = () =>
    Promise.all([listPaymentPlans(), listCountyTaxSettings()])
      .then(([p, s]) => {
        setPlans(p);
        setSettings(s);
      })
      .catch((err) => toast.error(getErrorMessage(err, "Could not load county tax rules.")));
  useEffect(() => {
    reload();
  }, []);

  const match = (county: string) => !q || county.toLowerCase().includes(q.toLowerCase());

  return (
    <div className="mt-6 grid gap-6">
      <p className="text-sm text-muted-foreground">
        Payment plans and payment links per county, used by every owner&apos;s Pay Taxes tab. A plan
        marked <em>To be confirmed</em> is never shown as eligible. County &quot;*&quot; is a
        statewide rule.
      </p>
      <input
        className={`${input} max-w-xs`}
        placeholder="Filter by county"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Payment plans</h2>
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={() => setEditPlan(blankPlan())}
          >
            Add plan
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">County</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Property types</th>
                <th className="px-3 py-2">Schedule</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {plans
                .filter((p) => match(p.county))
                .map((p) => (
                  <tr
                    key={`${p.county}:${p.planKey}`}
                    className={`border-t border-border/60 ${p.active ? "" : "opacity-50"}`}
                  >
                    <td className="px-3 py-2 font-medium">
                      {p.county === "*" ? "Statewide" : p.county}
                    </td>
                    <td className="px-3 py-2">
                      {p.name}
                      {p.requirement && (
                        <div className="text-xs text-muted-foreground">
                          {REQUIREMENT_LABEL[p.requirement] ?? p.requirement}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.propertyTypes.length ? p.propertyTypes.join(", ") : "Any"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.schedule
                        .map(
                          (s) =>
                            `${s.pct}% by ${s.month}/${s.day}${s.yearOffset ? ` (+${s.yearOffset}y)` : ""}`,
                        )
                        .join(" · ")}
                    </td>
                    <td className="px-3 py-2">
                      {p.status === "confirmed" ? "Confirmed" : "To be confirmed"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-accent underline"
                        onClick={() => setEditPlan(p)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">County payment links</h2>
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={() => setEditSettings(blankSettings())}
          >
            Add county
          </button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          All 254 counties, from each tax office&apos;s own website (rebuilt by
          scripts/build-tx-payment-plans.mjs). Half-payment: <em>offered</em> / <em>not offered</em>{" "}
          come with the county&apos;s own sentence; <em>unknown</em> means the site doesn&apos;t say
          — call the office and set it here. No payment portal → the Comptroller directory&apos;s
          tax office website is used.
        </p>
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          {(["offered", "not_offered", "unknown"] as const).map((k) => (
            <span key={k} className="rounded-full bg-secondary px-2 py-0.5">
              {k.replace("_", " ")}:{" "}
              {settings.filter((s) => (s.halfPayment ?? "unknown") === k).length}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">County</th>
                <th className="px-3 py-2">Payment portal</th>
                <th className="px-3 py-2">Account deep link</th>
                <th className="px-3 py-2">Delinquent from</th>
                <th className="px-3 py-2">Half-payment</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {settings
                .filter((s) => match(s.county))
                .map((s) => (
                  <tr key={s.county} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{s.county}</td>
                    <td className="max-w-[18rem] truncate px-3 py-2 text-xs">
                      {s.paymentPortalUrl ?? "—"}
                    </td>
                    <td className="max-w-[18rem] truncate px-3 py-2 text-xs">
                      {s.accountUrlTemplate ?? "—"}
                    </td>
                    <td className="px-3 py-2">{s.delinquencyMonthDay}</td>
                    <td className="max-w-[16rem] px-3 py-2 text-xs">
                      <span
                        className={
                          s.halfPayment === "offered"
                            ? "font-semibold text-success"
                            : s.halfPayment === "not_offered"
                              ? "font-semibold"
                              : "text-muted-foreground"
                        }
                      >
                        {(s.halfPayment ?? "unknown").replace("_", " ")}
                      </span>
                      {s.halfPaymentUrl && (
                        <a
                          href={s.halfPaymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={s.halfPaymentQuote ?? undefined}
                          className="ml-1 text-accent underline"
                        >
                          evidence
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-accent underline"
                        onClick={() => setEditSettings(s)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {editPlan && user && (
        <PlanEditor
          plan={editPlan}
          onCancel={() => setEditPlan(null)}
          onSave={async (p) => {
            await savePaymentPlan(p, user.id);
            setEditPlan(null);
            toast.success("Plan saved.");
            reload();
          }}
        />
      )}
      {editSettings && user && (
        <SettingsEditor
          settings={editSettings}
          onCancel={() => setEditSettings(null)}
          onSave={async (s) => {
            await saveCountyTaxSettings(s, user.id);
            setEditSettings(null);
            toast.success("County saved.");
            reload();
          }}
        />
      )}
    </div>
  );
}

function PlanEditor({
  plan,
  onCancel,
  onSave,
}: {
  plan: PaymentPlan;
  onCancel: () => void;
  onSave: (p: PaymentPlan) => Promise<void>;
}) {
  const [p, setP] = useState<PaymentPlan>(plan);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof PaymentPlan>(k: K, v: PaymentPlan[K]) =>
    setP((x) => ({ ...x, [k]: v }));
  const setStep = (i: number, patch: Partial<PlanScheduleStep>) =>
    set(
      "schedule",
      p.schedule.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  const pctTotal = p.schedule.reduce((s, x) => s + (Number(x.pct) || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!p.county.trim() || !p.planKey.trim() || !p.name.trim()) {
      toast.error("County, plan key and name are required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(p);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save the plan."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-elev grid gap-3 p-4 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">
        {plan.county ? `Edit ${plan.name}` : "New payment plan"}
      </h3>
      <label className="grid gap-1 text-sm">
        County (&quot;*&quot; = statewide)
        <input className={input} value={p.county} onChange={(e) => set("county", e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Plan key
        <input
          className={input}
          value={p.planKey}
          onChange={(e) => set("planKey", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Name
        <input className={input} value={p.name} onChange={(e) => set("name", e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Kind
        <select
          className={input}
          value={p.kind}
          onChange={(e) => set("kind", e.target.value as PlanKind)}
        >
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <fieldset className="grid gap-1 text-sm">
        <legend>Property types (none ticked = any)</legend>
        <div className="flex gap-3">
          {TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={p.propertyTypes.includes(t)}
                onChange={(e) =>
                  set(
                    "propertyTypes",
                    e.target.checked
                      ? [...p.propertyTypes, t]
                      : p.propertyTypes.filter((x) => x !== t),
                  )
                }
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1 text-sm">
        Taxpayer requirement
        <select
          className={input}
          value={p.requirement ?? ""}
          onChange={(e) => set("requirement", e.target.value || null)}
        >
          <option value="">None</option>
          {Object.entries(REQUIREMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-1 text-sm sm:col-span-2">
        <span>
          Schedule (relative to the tax year){" "}
          {pctTotal !== 100 && (
            <span className="text-destructive">— adds up to {pctTotal}%, not 100%</span>
          )}
        </span>
        {p.schedule.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} w-36`}
              value={s.label}
              onChange={(e) => setStep(i, { label: e.target.value })}
              aria-label="Label"
            />
            <input
              className={`${input} w-16`}
              type="number"
              value={s.pct}
              onChange={(e) => setStep(i, { pct: Number(e.target.value) })}
              aria-label="Percent"
            />
            % by month
            <input
              className={`${input} w-16`}
              type="number"
              min={1}
              max={12}
              value={s.month}
              onChange={(e) => setStep(i, { month: Number(e.target.value) })}
              aria-label="Month"
            />
            day
            <input
              className={`${input} w-16`}
              type="number"
              min={1}
              max={31}
              value={s.day}
              onChange={(e) => setStep(i, { day: Number(e.target.value) })}
              aria-label="Day"
            />
            <select
              className={input}
              value={s.yearOffset}
              onChange={(e) => setStep(i, { yearOffset: Number(e.target.value) })}
              aria-label="Year"
            >
              <option value={0}>of the tax year</option>
              <option value={1}>of the following year</option>
            </select>
            <button
              type="button"
              className="text-xs text-destructive underline"
              onClick={() =>
                set(
                  "schedule",
                  p.schedule.filter((_, j) => j !== i),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="w-fit text-xs text-accent underline"
          onClick={() =>
            set("schedule", [
              ...p.schedule,
              { label: "Installment", pct: 0, month: 1, day: 31, yearOffset: 1 },
            ])
          }
        >
          Add installment
        </button>
      </div>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Enrollment / eligibility note (shown to owners)
        <textarea
          className={input}
          rows={2}
          value={p.enrollmentNote ?? ""}
          onChange={(e) => set("enrollmentNote", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Source URL (official)
        <input
          className={input}
          value={p.sourceUrl ?? ""}
          onChange={(e) => set("sourceUrl", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Status
        <select
          className={input}
          value={p.status}
          onChange={(e) => set("status", e.target.value as PaymentPlan["status"])}
        >
          <option value="confirmed">Confirmed with the county</option>
          <option value="to_confirm">To be confirmed</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={p.active}
          onChange={(e) => set("active", e.target.checked)}
        />
        Active (shown to owners)
      </label>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" className="btn-outline text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-accent text-sm">
          {saving ? "Saving…" : "Save plan"}
        </button>
      </div>
    </form>
  );
}

function SettingsEditor({
  settings,
  onCancel,
  onSave,
}: {
  settings: CountyTaxSettings;
  onCancel: () => void;
  onSave: (s: CountyTaxSettings) => Promise<void>;
}) {
  const [s, setS] = useState(settings);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof CountyTaxSettings>(k: K, v: CountyTaxSettings[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!s.county.trim()) return;
    setSaving(true);
    try {
      await onSave(s);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save the county."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="card-elev grid gap-3 p-4 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">
        {settings.county ? `Edit ${settings.county}` : "New county"}
      </h3>
      <label className="grid gap-1 text-sm">
        County
        <input
          className={input}
          value={s.county}
          onChange={(e) => set("county", e.target.value)}
          disabled={!!settings.county}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Taxes delinquent from (MM-DD)
        <input
          className={input}
          value={s.delinquencyMonthDay}
          onChange={(e) => set("delinquencyMonthDay", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Half-payment (split) option
        <select
          className={input}
          value={s.halfPayment ?? "unknown"}
          onChange={(e) => set("halfPayment", e.target.value as CountyTaxSettings["halfPayment"])}
        >
          <option value="offered">Offered</option>
          <option value="not_offered">Not offered</option>
          <option value="unknown">Unknown — to be confirmed</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Evidence page URL
        <input
          className={input}
          value={s.halfPaymentUrl ?? ""}
          onChange={(e) => set("halfPaymentUrl", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Evidence (the county&apos;s own words, or &quot;Confirmed by phone with … on …&quot;)
        <input
          className={input}
          value={s.halfPaymentQuote ?? ""}
          onChange={(e) => set("halfPaymentQuote", e.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Setting &quot;Offered&quot; here records the finding; add a Half-Payment Plan for the county
        above so owners see the installments.
      </p>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Payment portal URL
        <input
          className={input}
          value={s.paymentPortalUrl ?? ""}
          onChange={(e) => set("paymentPortalUrl", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Account deep link (use {"{account}"})
        <input
          className={input}
          value={s.accountUrlTemplate ?? ""}
          onChange={(e) => set("accountUrlTemplate", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Account number pattern (regex)
        <input
          className={input}
          value={s.accountPattern ?? ""}
          onChange={(e) => set("accountPattern", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Source URL
        <input
          className={input}
          value={s.sourceUrl ?? ""}
          onChange={(e) => set("sourceUrl", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Notes
        <input
          className={input}
          value={s.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" className="btn-outline text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-accent text-sm">
          {saving ? "Saving…" : "Save county"}
        </button>
      </div>
    </form>
  );
}
