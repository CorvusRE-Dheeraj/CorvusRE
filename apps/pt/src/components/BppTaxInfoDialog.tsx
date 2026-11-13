import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { WorkflowPopup, FileButton } from "@/components/case/workflow-ui";
import { currency, fileToDataUrl } from "@/lib/intake-store";
import { getErrorMessage } from "@/lib/error-message";
import { askAboutDocument } from "@/lib/document-ai";
import { extractJson } from "@/lib/bpp-rendition";
import {
  recordBppPayment,
  saveBppTaxBill,
  signedRenditionUrl,
  updateBppAccount,
  type BppAccountRecord,
  type TaxingUnit,
} from "@/lib/bpp-accounts";
import { PAY_STATUS_LABEL, type BppTaxRow } from "@/lib/pay-taxes";

// A BPP account's tax bill and payment — shared by the Personal Property tab
// (View Tax Information) and Pay Taxes. Corvus AI reads an uploaded bill; the
// owner reviews it before anything is saved. Paying happens on the county's
// site — CorvusPT only records a payment the owner reports.

const money = (n: number | null | undefined) => (n == null ? "—" : currency(n));
const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const num = (s: string): number | null => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) ? n : null;
};
const input = "mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";
const PAY_METHODS = [
  "Online (card)",
  "Online (eCheck)",
  "Check by mail",
  "In person",
  "Escrow / lender",
  "Other",
];

type BillDraft = {
  accountNumber: string;
  taxYear: string;
  taxableValue: string;
  exemptions: string;
  taxingUnits: TaxingUnit[];
  amountDue: string;
  dueDate: string;
  file: File;
};

export function BppTaxInfoDialog({
  row,
  onClose,
  onUpdate,
}: {
  row: BppTaxRow;
  onClose: () => void;
  onUpdate: (a: BppAccountRecord) => void;
}) {
  const a = row.account;
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<BillDraft | null>(null);
  const [useBillAccount, setUseBillAccount] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payAmount, setPayAmount] = useState(
    row.outstanding != null ? String(row.outstanding) : "",
  );
  const [payMethod, setPayMethod] = useState(PAY_METHODS[0]);
  const [payProof, setPayProof] = useState<File | null>(null);

  async function readBill(file: File) {
    if (file.size > 8 * 1024 * 1024) return toast.error("That file is over 8 MB.");
    setBusy("read");
    try {
      const { answer } = await askAboutDocument({
        question: `This should be a Texas property tax bill/statement for business personal property. Reply with ONLY JSON: {"accountNumber": string|null, "taxYear": number|null, "taxableValue": number|null, "exemptions": [string], "taxingUnits": [{"name": string, "amount": number|null}], "amountDue": number|null, "dueDate": "YYYY-MM-DD"|null}. amountDue = total currently due; dueDate = the date it must be paid by to avoid penalty (usually January 31). Use null for anything not printed on the bill — never guess.`,
        file: { dataUrl: await fileToDataUrl(file) },
      });
      const r = extractJson<{
        accountNumber?: string | null;
        taxYear?: number | null;
        taxableValue?: number | null;
        exemptions?: string[] | null;
        taxingUnits?: TaxingUnit[] | null;
        amountDue?: number | null;
        dueDate?: string | null;
      }>(answer);
      if (!r) throw new Error("Corvus AI couldn't read that bill — enter it with Update instead.");
      setDraft({
        accountNumber: r.accountNumber ?? "",
        taxYear: r.taxYear ? String(r.taxYear) : "",
        taxableValue: r.taxableValue != null ? String(r.taxableValue) : "",
        exemptions: (r.exemptions ?? []).join(", "),
        taxingUnits: Array.isArray(r.taxingUnits)
          ? r.taxingUnits
              .filter((u) => u && u.name)
              .map((u) => ({ name: String(u.name), amount: u.amount ?? null }))
          : [],
        amountDue: r.amountDue != null ? String(r.amountDue) : "",
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate ?? "") ? r.dueDate! : "",
        file,
      });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not read the bill."));
    } finally {
      setBusy(null);
    }
  }

  const billAcct = draft?.accountNumber.replace(/\W/g, "") ?? "";
  const acctDiffers =
    !!draft && !!billAcct && !!a.accountNumber && billAcct !== a.accountNumber.replace(/\W/g, "");

  async function saveBill() {
    if (!draft) return;
    setBusy("save");
    try {
      let updated = await saveBppTaxBill(a.id, {
        taxableValue: num(draft.taxableValue),
        exemptions: draft.exemptions.trim() || null,
        taxingUnits: draft.taxingUnits.length ? draft.taxingUnits : null,
        taxAmountDue: num(draft.amountDue),
        paymentDueDate: draft.dueDate || null,
        file: draft.file,
      });
      const meta: { accountNumber?: string; taxYear?: number } = {};
      if (draft.accountNumber && (!a.accountNumber || useBillAccount))
        meta.accountNumber = draft.accountNumber.trim();
      if (num(draft.taxYear)) meta.taxYear = num(draft.taxYear)!;
      if (Object.keys(meta).length) updated = await updateBppAccount(a.id, meta);
      onUpdate(updated);
      setDraft(null);
      toast.success("Tax bill saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save the bill."));
    } finally {
      setBusy(null);
    }
  }

  async function savePayment() {
    setBusy("pay");
    try {
      const updated = await recordBppPayment(a.id, {
        amount: num(payAmount),
        method: payMethod,
        confirmation: payProof,
      });
      onUpdate(updated);
      setPaying(false);
      toast.success("Payment recorded.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not record the payment."));
    } finally {
      setBusy(null);
    }
  }

  async function openFile(path: string) {
    try {
      window.open(await signedRenditionUrl(path), "_blank", "noopener");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not open the file."));
    }
  }

  return (
    <WorkflowPopup
      open
      onClose={onClose}
      title={`BPP tax — ${a.businessName}`}
      description={`${row.county ?? a.cad ?? "County not set"}${a.accountNumber ? ` · account ${a.accountNumber}` : ""} · tax year ${row.taxYear}. Shown separately from the real property tax.`}
    >
      <div className="grid gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-3 rounded-md bg-secondary/40 p-3 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Amount due</dt>
            <dd className="font-semibold">
              {money(row.totalTax)}
              {row.totalTaxIsEstimate && (
                <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-900">
                  Estimate
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Paid</dt>
            <dd className="font-semibold">{money(row.amountPaid)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Due by</dt>
            <dd className="font-semibold">
              {fmtDate(row.dueDate)}
              {row.dueDateIsStandard && (
                <span className="block text-[11px] font-normal text-muted-foreground">
                  standard deadline
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="font-semibold">{PAY_STATUS_LABEL[row.status]}</dd>
          </div>
          {a.taxableValue != null && (
            <div>
              <dt className="text-xs text-muted-foreground">Taxable value</dt>
              <dd>{money(a.taxableValue)}</dd>
            </div>
          )}
          {a.exemptions && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Exemptions</dt>
              <dd>{a.exemptions}</dd>
            </div>
          )}
        </dl>
        {row.totalTaxIsEstimate && (
          <p className="text-xs text-muted-foreground">
            The estimate is this account's value × the county's typical rate. Upload the bill for
            the real amount.
          </p>
        )}
        {a.taxingUnits?.length ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Taxing units
            </p>
            <ul className="mt-1 grid gap-0.5">
              {a.taxingUnits.map((u) => (
                <li key={u.name} className="flex justify-between">
                  <span>{u.name}</span>
                  <span>{money(u.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {draft ? (
          <div className="grid gap-2 rounded-md border border-accent/40 p-3">
            <p className="text-xs font-semibold">
              Corvus AI read this from {draft.file.name} — check it before saving
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["Account number on the bill", "accountNumber"],
                  ["Tax year", "taxYear"],
                  ["Taxable value", "taxableValue"],
                  ["Amount due", "amountDue"],
                  ["Due date (YYYY-MM-DD)", "dueDate"],
                  ["Exemptions", "exemptions"],
                ] as const
              ).map(([label, k]) => (
                <label key={k} className="text-xs">
                  {label}
                  <input
                    className={input}
                    value={draft[k]}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            {draft.taxingUnits.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Taxing units:{" "}
                {draft.taxingUnits
                  .map((u) => `${u.name}${u.amount != null ? ` ${money(u.amount)}` : ""}`)
                  .join("; ")}
              </p>
            )}
            {acctDiffers && (
              <div className="rounded bg-warning/15 p-2 text-xs">
                The bill's account number ({draft.accountNumber}) is different from this BPP
                account's ({a.accountNumber}). BPP and real-property accounts often have different
                numbers — make sure this is the right bill.
                <label className="mt-1 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={useBillAccount}
                    onChange={(e) => setUseBillAccount(e.target.checked)}
                  />
                  Use the bill's account number for this BPP account
                </label>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => void saveBill()}
                disabled={!!busy}
                className="btn-accent py-1 text-xs disabled:opacity-60"
              >
                {busy === "save" ? "Saving…" : "Confirm & Save"}
              </button>
              <button onClick={() => setDraft(null)} className="btn-outline py-1 text-xs">
                Discard
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <FileButton
              label={busy === "read" ? "Reading…" : "Upload BPP Tax Bill"}
              disabled={!!busy}
              onFile={(f) => void readBill(f)}
            />
            {a.taxBillPath && (
              <button
                onClick={() => void openFile(a.taxBillPath!)}
                className="text-xs text-accent hover:underline"
              >
                View uploaded bill
              </button>
            )}
          </div>
        )}

        <div className="grid gap-2 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Payment
          </p>
          {a.paidAt ? (
            <p>
              Recorded as paid {fmtDate(a.paidAt)}
              {a.taxAmountPaid != null ? ` — ${money(a.taxAmountPaid)}` : ""}
              {a.paymentMethod ? ` (${a.paymentMethod})` : ""}.{" "}
              {a.paymentConfirmationPath && (
                <button
                  onClick={() => void openFile(a.paymentConfirmationPath!)}
                  className="text-accent hover:underline"
                >
                  View confirmation
                </button>
              )}
            </p>
          ) : paying ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs">
                Amount paid
                <input
                  className={input}
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Method
                <select
                  className={input}
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                >
                  {PAY_METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <div className="text-xs">
                Confirmation / receipt
                <div className="mt-1">
                  <FileButton
                    label={payProof ? payProof.name : "Upload (optional)"}
                    onFile={setPayProof}
                  />
                </div>
              </div>
              <div className="flex gap-2 sm:col-span-3">
                <button
                  onClick={() => void savePayment()}
                  disabled={!!busy}
                  className="btn-accent py-1 text-xs disabled:opacity-60"
                >
                  {busy === "pay" ? "Saving…" : "Record Payment"}
                </button>
                <button onClick={() => setPaying(false)} className="btn-outline py-1 text-xs">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {row.link && (
                <a
                  href={row.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-accent inline-flex items-center gap-1 py-1 text-xs"
                >
                  Pay at {row.link.label} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <button onClick={() => setPaying(true)} className="btn-outline py-1 text-xs">
                I've Paid — Record Payment
              </button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            CorvusPT doesn&apos;t take payments or mark a bill paid on its own — record it once
            you&apos;ve paid the county.
          </p>
        </div>
      </div>
    </WorkflowPopup>
  );
}
