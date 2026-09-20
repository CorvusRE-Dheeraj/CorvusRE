import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { currency } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import {
  listTaxBills,
  addTaxBill,
  recordPayment,
  recordRefund,
  reconcileSavings,
  type TaxBillRecord,
} from "@/lib/tax-bills";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/Modal";
import { ComingSoonLock } from "@/components/ComingSoonLock";

export const Route = createFileRoute("/dashboard/_layout/tax-bills")({
  component: TaxBills,
});

// Re-locked 2026-09-20 — still under active development, gray out (see
// AppShell.tsx's own `locked: true` for this tab) and block direct access
// too, not just the nav link. The page/logic below is untouched, just
// unreachable while this is true.
const LOCKED = true;

function TaxBills() {
  if (LOCKED) {
    return (
      <ComingSoonLock
        title="Tax Bills"
        description="Track what the county actually billed, whether it's paid, and any refund — per property, per tax year."
      />
    );
  }
  return <TaxBillsContent />;
}

function TaxBillsContent() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [bills, setBills] = useState<TaxBillRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addPropertyId, setAddPropertyId] = useState("");
  const [addTaxYear, setAddTaxYear] = useState("");
  const [addAmountDue, setAddAmountDue] = useState("");
  const [addDueDate, setAddDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const [payModal, setPayModal] = useState<TaxBillRecord | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState("");
  const [payConfirmation, setPayConfirmation] = useState("");
  const [paySaving, setPaySaving] = useState(false);

  const [refundModal, setRefundModal] = useState<TaxBillRecord | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundExpected, setRefundExpected] = useState("");
  const [refundReceived, setRefundReceived] = useState("");
  const [refundSaving, setRefundSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([listProperties(user.id), listTaxBills(user.id)])
      .then(([props, b]) => {
        setProperties(props);
        setBills(b);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load tax bills."))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!user || !addPropertyId) return;
    setSaving(true);
    try {
      const created = await addTaxBill(user.id, addPropertyId, {
        taxYear: addTaxYear ? Number(addTaxYear) : undefined,
        amountDue: addAmountDue ? Number(addAmountDue) : undefined,
        dueDate: addDueDate || undefined,
      });
      setBills((prev) => [created, ...prev]);
      setAddPropertyId("");
      setAddTaxYear("");
      setAddAmountDue("");
      setAddDueDate("");
      setShowAddForm(false);
      toast.success("Tax bill added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add this tax bill.");
    } finally {
      setSaving(false);
    }
  }

  function openPayModal(bill: TaxBillRecord) {
    setPayModal(bill);
    setPayAmount(bill.amountDue != null ? String(bill.amountDue) : "");
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayConfirmation("");
  }

  async function handleRecordPayment(e: FormEvent) {
    e.preventDefault();
    if (!payModal || !payAmount || !payDate) return;
    setPaySaving(true);
    try {
      const updated = await recordPayment(payModal.id, payModal.propertyId, {
        amountPaid: Number(payAmount),
        paidAt: new Date(payDate).toISOString(),
        confirmation: payConfirmation.trim() || undefined,
      });
      setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      setPayModal(null);
      toast.success("Payment recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this payment.");
    } finally {
      setPaySaving(false);
    }
  }

  function openRefundModal(bill: TaxBillRecord) {
    setRefundModal(bill);
    setRefundAmount(bill.refundAmount != null ? String(bill.refundAmount) : "");
    setRefundExpected(bill.refundExpectedAt ?? "");
    setRefundReceived(bill.refundReceivedAt ? bill.refundReceivedAt.slice(0, 10) : "");
  }

  async function handleRecordRefund(e: FormEvent) {
    e.preventDefault();
    if (!refundModal) return;
    setRefundSaving(true);
    try {
      const updated = await recordRefund(refundModal.id, {
        amount: refundAmount ? Number(refundAmount) : undefined,
        expectedAt: refundExpected || undefined,
        receivedAt: refundReceived ? new Date(refundReceived).toISOString() : undefined,
      });
      setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      setRefundModal(null);
      toast.success("Refund saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this refund.");
    } finally {
      setRefundSaving(false);
    }
  }

  const dueCount = bills.filter((b) => !b.paidAt).length;
  const paidCount = bills.filter((b) => !!b.paidAt).length;
  const refundPendingCount = bills.filter(
    (b) => (b.refundAmount != null || b.refundExpectedAt) && !b.refundReceivedAt,
  ).length;

  const groups = properties
    .map((property) => ({
      property,
      bills: bills
        .filter((b) => b.propertyId === property.id)
        .sort((a, b) => (b.taxYear ?? 0) - (a.taxYear ?? 0)),
    }))
    .filter((g) => g.bills.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Tax Bills</h1>
          <p className="text-muted-foreground text-sm">
            Track what the county actually billed, whether it's paid, and any refund — per property,
            per tax year.
          </p>
        </div>
        <button onClick={() => setShowAddForm((v) => !v)} className="btn-primary btn-primary-hover">
          {showAddForm ? "Cancel" : "Add Tax Bill"}
        </button>
      </div>

      {bills.length > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {dueCount} bill{dueCount === 1 ? "" : "s"} due, {paidCount} paid
          {refundPendingCount > 0
            ? `, ${refundPendingCount} refund${refundPendingCount === 1 ? "" : "s"} pending`
            : ""}
          .
        </p>
      )}

      {showAddForm && (
        <form onSubmit={handleAdd} className="mt-6 card-elev p-6 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="font-medium">
              Property<span className="text-destructive"> *</span>
            </span>
            <select
              required
              value={addPropertyId}
              onChange={(e) => setAddPropertyId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                </option>
              ))}
            </select>
          </label>
          <input
            value={addTaxYear}
            onChange={(e) => setAddTaxYear(e.target.value)}
            placeholder="Tax year (optional)"
            inputMode="numeric"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            value={addAmountDue}
            onChange={(e) => setAddAmountDue(e.target.value)}
            placeholder="Amount due (optional)"
            inputMode="decimal"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={addDueDate}
            onChange={(e) => setAddDueDate(e.target.value)}
            placeholder="Due date (optional)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm sm:col-span-2"
          />
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Have the actual bill?{" "}
            <Link to="/intake" className="underline">
              Upload it
            </Link>{" "}
            instead and AI will fill these fields in for you.
          </p>
          <button type="submit" disabled={saving} className="btn-accent w-fit disabled:opacity-60">
            {saving ? "Saving…" : "Save Tax Bill"}
          </button>
        </form>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="grid gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="card-elev p-5 grid gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            ))}
          </div>
        ) : groups.length > 0 ? (
          <div className="grid gap-6">
            {groups.map(({ property, bills: propertyBills }) => (
              <div key={property.id}>
                <h2 className="font-semibold">{property.address}</h2>
                <div className="mt-3 grid gap-3">
                  {propertyBills.map((bill) => {
                    const rec = reconcileSavings(bill, property);
                    const isPaid = !!bill.paidAt;
                    const hasRefund = bill.refundAmount != null || bill.refundReceivedAt;
                    return (
                      <div key={bill.id} className="card-elev row-hover p-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <div className="font-medium">
                              {bill.taxYear ? `Tax Year ${bill.taxYear}` : "Tax bill"}
                              {bill.amountDue != null ? ` • ${currency(bill.amountDue)}` : ""}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {bill.dueDate
                                ? `Due ${new Date(bill.dueDate).toLocaleDateString()}`
                                : "No due date on file"}
                              {isPaid && bill.paidAt
                                ? ` • Paid ${new Date(bill.paidAt).toLocaleDateString()}${
                                    bill.amountPaid != null ? ` (${currency(bill.amountPaid)})` : ""
                                  }`
                                : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isPaid ? (
                              <span className="badge-soft text-success">Paid</span>
                            ) : (
                              <button
                                onClick={() => openPayModal(bill)}
                                className="btn-outline text-sm"
                              >
                                Mark Paid
                              </button>
                            )}
                            <button
                              onClick={() => openRefundModal(bill)}
                              className="btn-outline text-sm"
                            >
                              {hasRefund ? "Update Refund" : "Record Refund"}
                            </button>
                          </div>
                        </div>
                        {hasRefund && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Refund:{" "}
                            {bill.refundAmount != null
                              ? currency(bill.refundAmount)
                              : "amount unknown"}
                            {bill.refundReceivedAt
                              ? ` • received ${new Date(bill.refundReceivedAt).toLocaleDateString()}`
                              : bill.refundExpectedAt
                                ? ` • expected ${new Date(bill.refundExpectedAt).toLocaleDateString()}`
                                : ""}
                          </p>
                        )}
                        {rec && (
                          <p
                            className={`mt-2 text-xs ${rec.flagged ? "text-warning-foreground font-medium" : "text-muted-foreground"}`}
                          >
                            Estimated savings at intake:{" "}
                            {rec.estimatedSavings != null ? currency(rec.estimatedSavings) : "—"}
                            {" • "}
                            Actual vs. no-protest baseline ({currency(
                              rec.expectedWithoutProtest,
                            )}): {currency(rec.actualSavings)}
                            {rec.flagged
                              ? " — differs a lot from the estimate, worth a second look."
                              : ""}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card-elev p-8 text-center">
            <h3 className="font-serif text-xl font-semibold">No tax bills tracked yet.</h3>
            <p className="text-muted-foreground mt-1">
              Add one manually above, or{" "}
              <Link to="/intake" className="underline">
                upload a tax bill or refund notice
              </Link>{" "}
              and AI will extract it for you.
            </p>
          </div>
        )}
      </div>

      {payModal && (
        <Modal onClose={() => setPayModal(null)}>
          <h3 className="font-serif text-xl font-semibold">Mark as Paid</h3>
          <form onSubmit={handleRecordPayment} className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm">
              Amount paid<span className="text-destructive"> *</span>
              <input
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                inputMode="decimal"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Date paid<span className="text-destructive"> *</span>
              <input
                required
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Confirmation number (optional)
              <input
                value={payConfirmation}
                onChange={(e) => setPayConfirmation(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <div className="mt-2 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPayModal(null)}
                className="btn-outline text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={paySaving}
                className="btn-accent text-sm disabled:opacity-60"
              >
                {paySaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {refundModal && (
        <Modal onClose={() => setRefundModal(null)}>
          <h3 className="font-serif text-xl font-semibold">Record Refund</h3>
          <form onSubmit={handleRecordRefund} className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm">
              Refund amount
              <input
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                inputMode="decimal"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Expected date (optional)
              <input
                type="date"
                value={refundExpected}
                onChange={(e) => setRefundExpected(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Received date (optional — leave blank if still pending)
              <input
                type="date"
                value={refundReceived}
                onChange={(e) => setRefundReceived(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <div className="mt-2 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRefundModal(null)}
                className="btn-outline text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={refundSaving}
                className="btn-accent text-sm disabled:opacity-60"
              >
                {refundSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
