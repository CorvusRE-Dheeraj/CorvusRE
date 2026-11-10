import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Briefcase, ExternalLink } from "lucide-react";
import { Modal } from "@/components/Modal";
import { currency } from "@/lib/intake-store";
import { getErrorMessage } from "@/lib/error-message";
import { TEXAS_COUNTY_NAMES } from "@/lib/county-coverage";
import { CURRENT_TAX_YEAR } from "@/lib/tax-calendar";
import { addBppAccount, deleteBppAccount, updateBppTaxBill } from "@/lib/bpp-accounts";
import { PAY_STATUS_LABEL, type BppTaxRow, type PayStatus } from "@/lib/pay-taxes";

// Pay Taxes → business personal property (furniture, fixtures, equipment,
// inventory): each BPP account's tax for the year beside the real-estate
// properties — amount, due date, status and the county's payment page. The
// bill is the owner's own entry on the BPP account (bpp_accounts.tax_amount_due
// etc. — supabase/pt/bpp-tax-bills.sql); without one it's an estimate.

const money = (n: number | null | undefined) => (n == null ? "—" : currency(n));
const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) ? n : undefined;
};

const STATUS_TONE: Record<PayStatus, string> = {
  unpaid: "bg-secondary text-foreground",
  initiated: "bg-sky-100 text-sky-800",
  partial: "bg-amber-100 text-amber-900",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/15 text-destructive",
  verifying: "bg-violet-100 text-violet-800",
};

const field =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function EstimateChip() {
  return (
    <span
      className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900"
      title="No tax bill entered — the account's value × the county's typical rate"
    >
      Estimate
    </span>
  );
}

export function BppTaxSection({
  rows,
  onAdd,
  onChanged,
}: {
  rows: BppTaxRow[];
  onAdd: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<BppTaxRow | null>(null);
  const [paying, setPaying] = useState<BppTaxRow | null>(null);
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
            <Briefcase className="h-5 w-5 text-sky-700" /> Business Personal Property
          </h2>
          <p className="text-sm text-muted-foreground">
            Furniture, fixtures, equipment and inventory — taxed on their own account, separate from
            the land and building.
          </p>
        </div>
        <button type="button" onClick={onAdd} className="btn-outline text-sm">
          Add BPP
        </button>
      </div>
      <div className="card-elev mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Business</th>
              <th className="px-3 py-2.5 font-semibold">County / Account</th>
              <th className="px-3 py-2.5 font-semibold">Tax year</th>
              <th className="px-3 py-2.5 font-semibold">Total tax</th>
              <th className="px-3 py-2.5 font-semibold">Due date</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.account.id} className="border-t border-border/60 align-top">
                <td className="max-w-[16rem] px-3 py-3">
                  <div className="truncate font-medium" title={row.account.businessName}>
                    {row.account.businessName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {row.account.locationAddress ?? "Location not on file"}
                  </div>
                  <div className="mt-2 flex flex-nowrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPaying(row)}
                      disabled={!row.link}
                      className="btn-accent whitespace-nowrap !px-3 !py-1.5 text-xs disabled:opacity-50"
                    >
                      Pay Taxes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(row)}
                      aria-label={`Update the tax bill for ${row.account.businessName}`}
                      className="btn-outline whitespace-nowrap !px-3 !py-1.5 text-xs"
                    >
                      Update
                    </button>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div>{row.county ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.account.accountNumber ?? "No account #"}
                  </div>
                </td>
                <td className="px-3 py-3">{row.taxYear}</td>
                <td className="whitespace-nowrap px-3 py-3 font-semibold">
                  {money(row.totalTax)}
                  {row.totalTaxIsEstimate && <EstimateChip />}
                  {row.totalTax == null && (
                    <div className="text-xs font-normal text-muted-foreground">
                      Enter the bill amount
                    </div>
                  )}
                  {row.amountPaid > 0 && row.status !== "paid" && (
                    <div className="text-xs font-normal text-muted-foreground">
                      {money(row.outstanding)} left
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <div>{fmtDate(row.dueDate)}</div>
                  {row.dueDateIsStandard && (
                    <div className="text-xs text-muted-foreground">Standard deadline</div>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[row.status]}`}
                  >
                    {PAY_STATUS_LABEL[row.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <BppBillModal row={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      )}
      {paying && <BppPayConfirm row={paying} onClose={() => setPaying(null)} />}
    </section>
  );
}

// Shows what's owed and by when before leaving for the county's site. The
// click is never recorded as a payment.
function BppPayConfirm({ row, onClose }: { row: BppTaxRow; onClose: () => void }) {
  const link = row.link;
  return (
    <Modal onClose={onClose}>
      <h3 className="font-serif text-xl font-semibold">Pay at the county tax office</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {row.account.businessName} — business personal property
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Amount outstanding
          </div>
          <div className="text-xl font-bold">
            {money(row.outstanding)}
            {row.totalTaxIsEstimate && <EstimateChip />}
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Pay by</div>
          <div className="text-xl font-bold">{fmtDate(row.dueDate)}</div>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {link?.kind === "account"
          ? "This opens your own tax account on the county's site."
          : `This opens the county's payment page — search for BPP account ${
              row.account.accountNumber ?? "(your account number)"
            } there.`}{" "}
        CorvusPT doesn&apos;t take the payment or mark it paid — use Update once you&apos;ve paid.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-outline text-sm">
          Cancel
        </button>
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="btn-accent inline-flex items-center gap-1.5 text-sm"
          >
            Open {link.label} <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </Modal>
  );
}

// Update the bill: amount, paid so far, due date, paid in full — or remove
// the account.
function BppBillModal({
  row,
  onClose,
  onSaved,
}: {
  row: BppTaxRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const a = row.account;
  const [due, setDue] = useState(a.taxAmountDue != null ? String(a.taxAmountDue) : "");
  const [paid, setPaid] = useState(a.taxAmountPaid != null ? String(a.taxAmountPaid) : "");
  const [dueDate, setDueDate] = useState(a.paymentDueDate ?? "");
  const [paidInFull, setPaidInFull] = useState(!!a.paidAt);
  const [saving, setSaving] = useState(false);
  // the database won't delete an account under a running subscription
  const subscribed = ["active", "trialing", "past_due", "incomplete", "unpaid"].includes(
    a.subscriptionStatus ?? "",
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateBppTaxBill(a.id, {
        taxAmountDue: num(due) ?? null,
        taxAmountPaid: num(paid) ?? null,
        paymentDueDate: dueDate || null,
        paid: paidInFull,
      });
      toast.success("BPP tax bill updated.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save the bill."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${a.businessName} from your BPP accounts?`)) return;
    setSaving(true);
    try {
      await deleteBppAccount(a.id);
      toast.success("BPP account removed.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't remove this account."));
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h3 className="font-serif text-xl font-semibold">BPP tax bill — {row.taxYear}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {a.businessName}
          {a.accountNumber ? ` · account ${a.accountNumber}` : ""}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Amount due
            <input
              className={field}
              inputMode="decimal"
              placeholder={row.totalTaxIsEstimate ? `Estimate ${money(row.totalTax)}` : "$0.00"}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            Paid so far
            <input
              className={field}
              inputMode="decimal"
              placeholder="$0.00"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            Due date
            <input
              type="date"
              className={field}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={paidInFull}
              onChange={(e) => setPaidInFull(e.target.checked)}
            />
            Paid in full
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Leave the due date blank for the standard deadline ({fmtDate(row.dueDate)}).
        </p>
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={remove}
            disabled={saving || subscribed}
            title={subscribed ? "This account has a subscription — cancel it first" : undefined}
            className="text-sm font-medium text-destructive hover:underline disabled:opacity-50"
          >
            Remove account
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-outline text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-accent text-sm">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// Pay Taxes → "Add BPP": the account and, if the owner has it, this year's bill.
export function AddBppModal({
  userId,
  onClose,
  onAdded,
}: {
  userId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [businessName, setBusinessName] = useState("");
  const [county, setCounty] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [location, setLocation] = useState("");
  const [taxYear, setTaxYear] = useState(String(CURRENT_TAX_YEAR));
  const [value, setValue] = useState("");
  const [due, setDue] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  // a ref, not just `saving`: a fast double-click would otherwise add two
  const savingRef = useRef(false);
  const valid = businessName.trim() !== "" && county !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await addBppAccount(userId, {
        businessName: businessName.trim(),
        cad: county,
        accountNumber: accountNumber.trim() || undefined,
        locationAddress: location.trim() || undefined,
        taxYear: num(taxYear),
        renderedValue: num(value),
        taxAmountDue: num(due),
        paymentDueDate: dueDate || undefined,
      });
      toast.success(`${businessName.trim()} added.`);
      onAdded();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't add this BPP account."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h3 className="font-serif text-xl font-semibold">Add business personal property</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A business&apos;s furniture, fixtures, equipment and inventory have their own tax account
          with the county, separate from the land and building.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">
            Business name *
            <input
              className={field}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
            />
          </label>
          <label className="text-sm font-medium">
            County *
            <select
              className={field}
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              required
            >
              <option value="">Select a county</option>
              {TEXAS_COUNTY_NAMES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            BPP account number
            <input
              className={field}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Business location
            <input
              className={field}
              placeholder="Street, city, ZIP"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            Tax year
            <input
              className={field}
              inputMode="numeric"
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            Assessed / rendered value
            <input
              className={field}
              inputMode="decimal"
              placeholder="$0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            Tax amount due
            <input
              className={field}
              inputMode="decimal"
              placeholder="From the tax bill"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            Due date
            <input
              type="date"
              className={field}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          No bill yet? Leave the amount blank — the tax is estimated from the value, and the due
          date defaults to January 31.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline text-sm">
            Cancel
          </button>
          <button type="submit" disabled={!valid || saving} className="btn-accent text-sm">
            {saving ? "Adding…" : "Add BPP"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
