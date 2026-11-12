import { useState, type ReactNode } from "react";
import { ExternalLink, Landmark, RefreshCw } from "lucide-react";
import type { SavedStatement, TaxOfficeStatement } from "@/lib/tax-office-statements";

// Pay Taxes → a property's detail: the county tax office's own account page
// (lib/tax-office-statements.ts), shown field for field — levy, amount due,
// half payment, last payment, values, exemptions, each jurisdiction's levy,
// the payment history and the county's own links.

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const date = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

function Field({
  label,
  children,
  tone,
}: {
  label: string;
  children: ReactNode;
  tone?: "due" | "good";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 break-words font-semibold ${
          tone === "due" ? "text-destructive" : tone === "good" ? "text-success" : ""
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

function OutLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-accent underline underline-offset-2 hover:no-underline"
    >
      {children} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

export function TaxOfficeStatementPanel({
  saved,
  county,
  connected,
  loading,
  onRefresh,
}: {
  saved: SavedStatement | null;
  county: string | null;
  connected: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [allPayments, setAllPayments] = useState(false);
  const s: TaxOfficeStatement | null = saved?.statement ?? null;
  const title = `${county ?? "County"} County Tax Office`;

  if (!connected) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        CorvusPT doesn&apos;t read {county ? `${county} County's` : "this county's"} tax office yet,
        so the amounts here come from your tax statement or an estimate. Use the county link above
        to see the live account.
      </p>
    );
  }
  if (!s) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        <span>
          {loading
            ? `Reading the account from the ${title}…`
            : saved
              ? `The ${title} didn't return an account for property ID ${saved.accountNumber ?? "(none on file)"} — check the account number on this property, or try again later.`
              : `Not read from the ${title} yet.`}
        </span>
        {!loading && (
          <button type="button" onClick={onRefresh} className="btn-outline text-xs">
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Check now
          </button>
        )}
      </div>
    );
  }

  const yr = s.taxYear ?? "";
  const payments = allPayments ? s.payments : s.payments.slice(0, 6);
  const jurisdictionYear = s.jurisdictions[0]?.year ?? s.taxYear;
  const totalLevy = s.jurisdictions.reduce((sum, j) => sum + (j.levy ?? 0), 0);

  return (
    <div className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Landmark className="h-4 w-4 text-accent" aria-hidden />
          {title} · {yr} tax information
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Checked {saved ? new Date(saved.retrievedAt).toLocaleString() : ""}</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid gap-5 p-4 md:grid-cols-[3fr_2fr]">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Account number">
            {s.taxAccount}
            {s.longAccount && (
              <span className="block text-xs font-normal text-muted-foreground">
                Long account {s.longAccount}
              </span>
            )}
          </Field>
          <Field label="Owner / mailing address">
            {s.ownerLines.length
              ? s.ownerLines.map((l) => (
                  <span key={l} className="block font-normal">
                    {l}
                  </span>
                ))
              : "—"}
          </Field>
          <Field label="Property site address">{s.siteAddress ?? "—"}</Field>
          <Field label="Legal description">
            <span className="font-normal">{s.legal ?? "—"}</span>
          </Field>
          <Field label={`${yr} year tax levy`}>{usd(s.levy)}</Field>
          <Field
            label={`${yr} year amount due`}
            tone={(s.yearAmountDue ?? 0) > 0 ? undefined : "good"}
          >
            {usd(s.yearAmountDue)}
          </Field>
          <Field label="Delinquent after">{date(s.delinquentAfter)}</Field>
          <Field label="Half payment option (½ of current levy)">
            {usd(s.halfPaymentAmount)}
            {s.halfPaymentDeadline && (
              <span className="block text-xs font-normal text-muted-foreground">
                Deadline {date(s.halfPaymentDeadline)}
              </span>
            )}
          </Field>
          <Field
            label="Prior year(s) amount due"
            tone={(s.priorYearsDue ?? 0) > 0 ? "due" : undefined}
          >
            {usd(s.priorYearsDue)}
          </Field>
          <Field label="Total amount due" tone={(s.totalDue ?? 0) > 0 ? "due" : "good"}>
            {usd(s.totalDue)}
          </Field>
          <Field label="Last payment amount received">{usd(s.lastPaymentAmount)}</Field>
          <Field label="Last payer">{s.lastPayer ?? "—"}</Field>
          <Field label="Last payment date">{date(s.lastPaymentDate)}</Field>
          {s.lawsuits && <Field label="Active lawsuits">{s.lawsuits}</Field>}
        </dl>

        <div className="grid content-start gap-3">
          <dl className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Pending credit card or eCheck payments">
                {s.pendingPayments ?? "—"}
              </Field>
            </div>
            <Field label="Total market value">{usd0(s.marketValue)}</Field>
            <Field label="Land value">{usd0(s.landValue)}</Field>
            <Field label="Improvement value">{usd0(s.improvementValue)}</Field>
            <Field label="Capped value">{usd0(s.cappedValue)}</Field>
            <Field label="Agricultural value">{usd0(s.agValue)}</Field>
            <Field label="Exemptions (current year)">{s.exemptions ?? "None"}</Field>
            {s.jurisdictionsNote && (
              <div className="col-span-2">
                <Field label="Jurisdictions (current year)">{s.jurisdictionsNote}</Field>
              </div>
            )}
          </dl>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <a
              href={s.links.pay ?? s.links.account}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-accent inline-flex w-fit items-center gap-1.5 text-sm"
            >
              Pay now on the county&apos;s site <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
            <OutLink href={s.links.statement}>Print current tax statement</OutLink>
            <OutLink href={s.links.delinquentStatement}>Print delinquent statement</OutLink>
            <OutLink href={s.links.autoPay}>Set up an automatic payment plan</OutLink>
            <OutLink href={s.links.paymentRecord}>Print payment record</OutLink>
            <OutLink href={s.links.taxByYear}>Taxes due by year and jurisdiction</OutLink>
            <OutLink href={s.links.map}>Show map</OutLink>
            <OutLink href={s.links.account}>Open this account on the tax office site</OutLink>
          </div>
        </div>
      </div>

      {s.jurisdictions.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h5 className="text-sm font-semibold">
              Jurisdictions{jurisdictionYear ? ` · ${jurisdictionYear}` : ""}
            </h5>
            <OutLink href={s.links.jurisdictions}>Jurisdiction details</OutLink>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-semibold">Jurisdiction</th>
                  <th className="py-1 pr-3 text-right font-semibold">Taxable value</th>
                  {s.jurisdictions.some((j) => j.rate != null) && (
                    <th className="py-1 pr-3 text-right font-semibold">Rate / $100</th>
                  )}
                  <th className="py-1 pr-3 text-right font-semibold">Tax levy</th>
                  {s.jurisdictions.some((j) => j.totalDue != null) && (
                    <th className="py-1 text-right font-semibold">Total due</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {s.jurisdictions.map((j) => (
                  <tr key={`${j.year}-${j.name}`} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">{j.name}</td>
                    <td className="py-1.5 pr-3 text-right">{usd0(j.taxableValue)}</td>
                    {s.jurisdictions.some((x) => x.rate != null) && (
                      <td className="py-1.5 pr-3 text-right">{j.rate ?? "—"}</td>
                    )}
                    <td className="py-1.5 pr-3 text-right">{usd(j.levy)}</td>
                    {s.jurisdictions.some((x) => x.totalDue != null) && (
                      <td className="py-1.5 text-right">{usd(j.totalDue)}</td>
                    )}
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold">
                  <td className="py-1.5 pr-3">Total</td>
                  <td />
                  {s.jurisdictions.some((x) => x.rate != null) && <td />}
                  <td className="py-1.5 pr-3 text-right">{usd(totalLevy)}</td>
                  {s.jurisdictions.some((x) => x.totalDue != null) && <td />}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {s.payments.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h5 className="text-sm font-semibold">Payment history</h5>
            <OutLink href={s.links.paymentHistory}>
              Payment history on the county&apos;s site
            </OutLink>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-semibold">Date paid</th>
                  <th className="py-1 pr-3 font-semibold">Roll year</th>
                  <th className="py-1 pr-3 text-right font-semibold">Amount</th>
                  <th className="py-1 pr-3 font-semibold">Description</th>
                  <th className="py-1 font-semibold">Payer</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={`${p.date}-${i}`} className="border-t border-border/60">
                    <td className="whitespace-nowrap py-1.5 pr-3">{date(p.date)}</td>
                    <td className="py-1.5 pr-3">{p.rollYear ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right">{usd(p.amount)}</td>
                    <td className="py-1.5 pr-3">{p.description ?? "—"}</td>
                    <td className="py-1.5">{p.payer ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.payments.length > 6 && (
            <button
              type="button"
              onClick={() => setAllPayments((v) => !v)}
              className="mt-2 text-xs font-medium text-accent hover:underline"
            >
              {allPayments ? "Show fewer" : `Show all ${s.payments.length} payments`}
            </button>
          )}
        </div>
      )}

      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        From the {title}&apos;s public account page. All amounts due include penalty, interest and
        attorney fees when applicable; the tax office&apos;s data may differ from the appraisal
        district&apos;s.
      </p>
    </div>
  );
}
