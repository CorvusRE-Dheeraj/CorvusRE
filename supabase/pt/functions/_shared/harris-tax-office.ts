// Harris County Tax Office (hctax.net) account statements — the same
// TaxOfficeStatement shape as the ACT counties (act-tax-office.ts), so Pay
// Taxes shows Harris accounts the same way.
//
// The tax account is the HCAD account (13 digits). hctax.net opens a
// statement by an encrypted token: GET /Property/AccountEncrypt?account=…
// returns it, then /Property/TaxStatement?account=<token> is the current
// statement (values, exemptions, each jurisdiction's rate and tax, the
// year's total, payments applied, current and prior-year amounts due) and
// /Property/Receipt?account=<token> lists receipt dates by year. Plain public
// pages, no CAPTCHA; a change in layout leaves fields null, never wrong.
// Parsers are pure so the app's vitest suite tests them.

import {
  isoDate,
  moneyValue,
  type TaxOfficeJurisdiction,
  type TaxOfficePayment,
  type TaxOfficeStatement,
} from "./act-tax-office.ts";

const BASE = "https://www.hctax.net/Property";

const decode = (s: string) =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
const text = (html: string) =>
  decode(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const lines = (html: string) =>
  html
    .split(/<br\s*\/?>/i)
    .map(text)
    .filter(Boolean);
const num = (s: string | null | undefined) => {
  const m = (s ?? "").replace(/[$,\s]/g, "").match(/^-?\d+(\.\d+)?$/);
  return m ? Number(m[0]) : null;
};

// 1350240030002 / "135-024-003-0002" → "1350240030002"
export function harrisAccount(id: string): string | null {
  const d = id.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 13 ? d.padStart(13, "0") : null;
}

type Cell = { html: string; text: string };

// Innermost rows as cells (raw html kept for <br>-separated values).
function rows(html: string): Cell[][] {
  const page = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  return [...page.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?)<\/tr>/gi)]
    .map((m) =>
      [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => ({
        html: c[1],
        text: text(c[1]),
      })),
    )
    .filter((r) => r.length > 0);
}

export type HarrisStatement = Omit<
  TaxOfficeStatement,
  "county" | "cadPropertyId" | "links" | "payments"
>;

// /Property/TaxStatement — the current statement.
export function parseHarrisStatement(html: string): HarrisStatement {
  const out: HarrisStatement = {
    source: "harris",
    taxAccount: "",
    longAccount: null,
    taxYear: null,
    ownerLines: [],
    siteAddress: null,
    legal: null,
    levy: null,
    yearAmountDue: null,
    delinquentAfter: null,
    halfPaymentAmount: null,
    halfPaymentDeadline: null,
    priorYearsDue: null,
    totalDue: null,
    lastPaymentAmount: null,
    lastPayer: null,
    lastPaymentDate: null,
    pendingPayments: null,
    marketValue: null,
    landValue: null,
    improvementValue: null,
    cappedValue: null,
    agValue: null,
    exemptions: null,
    jurisdictionsNote: null,
    lawsuits: null,
    jurisdictions: [],
  };
  const all = rows(html);
  let paid: number | null = null;
  let inJurisdictions = false;
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const t = r.map((c) => c.text);
    // header rows, then the row of values under them
    if (t[0] === "Account Number" && all[i + 1]) {
      const v = all[i + 1];
      out.taxAccount = (v[0]?.text ?? "").replace(/\D/g, "");
      out.ownerLines = lines(v[2]?.html ?? "");
      continue;
    }
    if (t[0] === "Taxing Jurisdiction") {
      inJurisdictions = true;
      continue;
    }
    const label = t[0] ?? "";
    const value = t[t.length - 1] ?? "";
    if (inJurisdictions && r.length === 5 && /\$/.test(t[4])) {
      out.jurisdictions.push({
        year: null,
        name: t[0],
        taxableValue: num(t[2]),
        rate: num(t[3]),
        levy: moneyValue(t[4]),
        totalDue: null,
      } satisfies TaxOfficeJurisdiction);
      continue;
    }
    if (r.length !== 2) continue;
    let m: RegExpMatchArray | null;
    if (/^Land - Market Value:/i.test(label)) out.landValue = num(value);
    else if (/^Impr - Market Value:/i.test(label))
      out.improvementValue = num(value);
    else if (/^Total Market Value:/i.test(label)) out.marketValue = num(value);
    else if (/^Less Capped Mkt Value:/i.test(label))
      out.cappedValue = num(value);
    else if ((m = label.match(/^Total (\d{4}) Taxes Due by (.+?):?$/i))) {
      inJurisdictions = false;
      out.taxYear = Number(m[1]);
      out.levy = moneyValue(value);
      const due = isoDate(m[2]);
      if (due) {
        const d = new Date(`${due}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        out.delinquentAfter = d.toISOString().slice(0, 10);
      }
    } else if (/^Payments applied to \d{4} taxes:/i.test(label))
      paid = moneyValue(value);
    else if (/^Total Current Taxes Due:/i.test(label))
      out.yearAmountDue = moneyValue(value);
    else if (/^Prior year\(s\) taxes due/i.test(label))
      out.priorYearsDue = moneyValue(value.replace(/^-\s*/, ""));
    else if (/^Total Amount Due For/i.test(label))
      out.totalDue = moneyValue(value);
  }
  // Description | Appraised Values (a nested table) | Notes/Exemptions — the
  // row holds a table, so it's read straight from the html.
  const desc = html.match(
    /Property Description<\/td>[\s\S]*?<\/tr>\s*<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
  );
  if (desc) {
    const d = lines(desc[1]);
    out.siteAddress = d[0] ?? null;
    out.legal = d.slice(1).join(" ") || null;
  }
  const notes = html.match(
    /id="notes"[\s\S]*?class="subtable"[\s\S]*?<\/table>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
  );
  // exemption codes only, not notices ("Our records indicate that …")
  if (notes)
    out.exemptions =
      lines(notes[1])
        .filter((l) => !/[a-z]{3}/.test(l))
        .join(", ") || null;
  if (out.yearAmountDue == null && out.levy != null && paid != null)
    out.yearAmountDue = Math.round((out.levy - paid) * 100) / 100;
  out.jurisdictionsNote =
    out.jurisdictions.map((j) => j.name).join(", ") || null;
  return out;
}

// /Property/Receipt — "Tax Receipts (By Calendar Year)": a year, then the
// date of the payment that year. Amounts are only on each printed receipt.
export function parseHarrisReceipts(html: string): TaxOfficePayment[] {
  const t = text(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, ""),
  );
  const at = t.lastIndexOf("Tax Receipts");
  if (at < 0) return [];
  const out: TaxOfficePayment[] = [];
  for (const m of t
    .slice(at)
    .matchAll(/\b(\d{4})\s+([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})/g)) {
    out.push({
      date: isoDate(m[2]),
      rollYear: Number(m[1]),
      amount: null,
      description: "Payment",
      payer: null,
    });
  }
  return out;
}

export async function fetchHarrisStatement(
  cadId: string,
  timeoutMs: number,
): Promise<TaxOfficeStatement | null> {
  const account = harrisAccount(cadId);
  if (!account) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = {
    "User-Agent": "Mozilla/5.0 (CorvusPT property lookup)",
    Accept: "text/html",
  };
  const token = (
    await (
      await fetch(`${BASE}/AccountEncrypt?account=${account}`, {
        headers: { ...headers, "X-Requested-With": "XMLHttpRequest" },
        signal,
      })
    ).text()
  ).trim();
  if (!token || token.length > 200 || /</.test(token)) return null;
  const q = encodeURIComponent(token);
  const [statementHtml, receiptHtml] = await Promise.all([
    fetch(`${BASE}/TaxStatement?account=${q}`, { headers, signal }).then((r) =>
      r.ok ? r.text() : "",
    ),
    fetch(`${BASE}/Receipt?account=${q}`, { headers, signal })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => ""),
  ]);
  const s = parseHarrisStatement(statementHtml);
  if (!s.taxAccount && s.levy == null) return null;
  const payments = parseHarrisReceipts(receiptHtml);
  const last = payments[0] ?? null;
  return {
    ...s,
    taxAccount: s.taxAccount || account,
    county: "Harris",
    cadPropertyId: account,
    lastPaymentDate: last?.date ?? null,
    payments,
    links: {
      account: `${BASE}/TaxStatement?account=${q}`,
      pay: `https://payments.myharriscountytax.com/form/property-tax?criteria=account_number&account_number=${account}`,
      statement: `${BASE}/TaxStatement?account=${q}`,
      delinquentStatement: null,
      paymentHistory: `${BASE}/Receipt?account=${q}`,
      jurisdictions: null,
      taxByYear: null,
      paymentRecord: `${BASE}/Receipt?account=${q}`,
      autoPay: null,
      map: null,
    },
  };
}
