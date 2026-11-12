// County tax office account statements from ACT's hosted tax office sites
// (Appraisal & Collection Technologies — "act_webdev"), used by about thirty
// Texas county tax offices. Pay Taxes shows, per property, everything the
// account page lists: the year's levy, amount due, delinquency date,
// half-payment amount and deadline, prior years due, total due, last payment
// (amount, payer, date), pending payments, values, exemptions — plus each
// jurisdiction's levy and the payment history, and links to the county's own
// pages (pay, statement, receipts). Stored by property-tax-history
// ({"kind":"statement"}) in public.property_tax_statements.
//
// Two page layouts exist: the newer one (Bexar: <div><label>Name:</label>
// value</div>, tables with data-label cells) and the older one (Galveston,
// Hidalgo, McLennan…: <h3><b>Name:</b> value</h3>, tables whose first row
// holds the column names). Both are read the same way: the page is flattened
// to "Name: value" lines and table rows are matched to their column names.
// Plain public HTML (no CAPTCHA); any change in a page makes a field null,
// never a wrong number. Parsers are pure so the app's vitest suite tests them.

export type ActSearch = "searchby5" | "propertyId" | "modern" | "direct";
export type ActCounty = { base: string; search: ActSearch };

// County → its ACT site, checked 2026-11-11 (each one's search form).
// search: "searchby5" = POST showlist.jsp searchby=5 (CAD reference);
// "propertyId" = GET showlist.jsp?propertyId= (El Paso); "modern" = ACT's
// newer design, POST search-result.jsp search-type=cad, the results as JSON in
// the page, accounts at account-details.jsp; "direct" = the tax account IS
// the appraisal district account (Dallas), opened straight away.
const ACT = "https://actweb.acttax.com";
// (Webb's ACT site is the Webb CISD tax office, not the county's.)
export const ACT_COUNTIES: Record<string, ActCounty> = {
  angelina: { base: `${ACT}/angelina/angelina`, search: "modern" },
  atascosa: { base: `${ACT}/atascosa/atascosa`, search: "modern" },
  bexar: {
    base: "https://bexar.acttax.com/act_webdev/bexar",
    search: "searchby5",
  },
  brooks: { base: `${ACT}/act_webdev/brooks`, search: "searchby5" },
  cass: { base: `${ACT}/cass/cass`, search: "modern" },
  dallas: {
    base: "https://www.dallasact.com/act_webdev/dallas",
    search: "direct",
  },
  duval: { base: `${ACT}/act_webdev/duval`, search: "searchby5" },
  "el paso": { base: `${ACT}/act_webdev/elpaso`, search: "propertyId" },
  "fort bend": { base: `${ACT}/act_webdev/fbc`, search: "searchby5" },
  galveston: { base: `${ACT}/act_webdev/galveston`, search: "searchby5" },
  goliad: { base: `${ACT}/goliad/goliad`, search: "modern" },
  gregg: { base: `${ACT}/act_webdev/gregg`, search: "searchby5" },
  hidalgo: { base: `${ACT}/act_webdev/hidalgo`, search: "searchby5" },
  jackson: { base: `${ACT}/jackson/jackson`, search: "modern" },
  jefferson: { base: `${ACT}/act_webdev/jefferson`, search: "searchby5" },
  kaufman: { base: `${ACT}/kaufman/kaufman`, search: "modern" },
  kleberg: { base: `${ACT}/kleberg/kleberg`, search: "modern" },
  mclennan: { base: `${ACT}/act_webdev/mclennan`, search: "searchby5" },
  mcmullen: { base: `${ACT}/mcmullen/mcmullen`, search: "modern" },
  montgomery: { base: `${ACT}/montgomery/montgomery`, search: "modern" },
  navarro: { base: `${ACT}/act_webdev/navarro`, search: "searchby5" },
  nueces: { base: `${ACT}/nueces/nueces`, search: "modern" },
  refugio: { base: `${ACT}/act_webdev/refugio`, search: "searchby5" },
  "san patricio": {
    base: `${ACT}/act_webdev/sanpatricio`,
    search: "searchby5",
  },
  upshur: { base: `${ACT}/act_webdev/upshur`, search: "searchby5" },
  "val verde": { base: `${ACT}/valverde/valverde`, search: "modern" },
  victoria: { base: `${ACT}/victoria/victoria`, search: "modern" },
};

export type TaxOfficeJurisdiction = {
  year: number | null;
  name: string;
  taxableValue: number | null;
  rate: number | null; // per $100
  levy: number | null;
  totalDue: number | null;
};

export type TaxOfficePayment = {
  date: string | null; // YYYY-MM-DD
  rollYear: number | null;
  amount: number | null;
  description: string | null;
  payer: string | null;
};

export type TaxOfficeLinks = {
  account: string;
  pay: string | null;
  statement: string | null;
  delinquentStatement: string | null;
  paymentHistory: string | null;
  jurisdictions: string | null;
  taxByYear: string | null;
  paymentRecord: string | null;
  autoPay: string | null;
  map: string | null;
};

export type TaxOfficeStatement = {
  county: string; // "Bexar"
  source: "act";
  taxAccount: string;
  longAccount: string | null;
  cadPropertyId: string | null;
  taxYear: number | null;
  ownerLines: string[];
  siteAddress: string | null;
  legal: string | null;
  levy: number | null; // the year's tax levy
  yearAmountDue: number | null; // what's left of this year's levy
  delinquentAfter: string | null; // YYYY-MM-DD
  halfPaymentAmount: number | null;
  halfPaymentDeadline: string | null; // YYYY-MM-DD
  priorYearsDue: number | null;
  totalDue: number | null;
  lastPaymentAmount: number | null;
  lastPayer: string | null;
  lastPaymentDate: string | null; // YYYY-MM-DD
  pendingPayments: string | null;
  marketValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  cappedValue: number | null;
  agValue: number | null;
  exemptions: string | null;
  jurisdictionsNote: string | null;
  lawsuits: string | null;
  jurisdictions: TaxOfficeJurisdiction[];
  payments: TaxOfficePayment[];
  links: TaxOfficeLinks;
};

export type ParsedAccountPage = Omit<
  TaxOfficeStatement,
  "county" | "cadPropertyId" | "jurisdictions" | "payments" | "links"
>;

// ── Small text helpers ──────────────────────────────────────────────────────

const decode = (s: string) =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const strip = (html: string) =>
  decode(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

// "$71,314.39" / "$0" → number; anything else → null
export function moneyValue(s: string | null | undefined): number | null {
  const m = (s ?? "").match(/\$\s*(-?[\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// "02/01/2027" / "2027-02-01" / "November 30, 2026" → "2027-02-01"
export function isoDate(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  // 02/01/2027, or 07-20-2026 (El Paso)
  const us = t.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = t.match(/([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/);
  if (long) {
    const m = MONTHS.indexOf(long[1].toLowerCase());
    if (m >= 0)
      return `${long[3]}-${String(m + 1).padStart(2, "0")}-${long[2].padStart(2, "0")}`;
  }
  return null;
}

const NOT_RECEIVED = /^(not received|none|n\/a)$/i;
const orNull = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t && !NOT_RECEIVED.test(t) ? t : null;
};

// ── The account page (showdetail2.jsp) ─────────────────────────────────────

const BR = " ⏎ ";

// Every field name an ACT account page uses, longest spelling first. Also
// some names that only end the value before them (Active Judgments,
// Total Due for … & Prior Years, the payable-to notice).
const FIELD_NAMES = [
  "Long Account Number",
  "Account Number",
  "Account No\\.",
  "Prop\\. Id\\. No\\.",
  "Current Taxes \\(Levy\\)",
  "Property Site Address",
  "(?:Owner |Mailing )?Address",
  "Legal Description",
  "(?:\\d{4} Year|Current(?: Year)?) Tax Levy",
  "Current Year Levy",
  "(?:\\d{4} Year|Current(?: Year)?) Amount Due",
  "Current Year Due",
  "Delinquent After",
  "Half Payment[^:\\n]{0,60}",
  "Prior Year(?:\\(s\\)|s)? (?:Amount )?Due",
  "Total Amount Due",
  "Total (?:Amount )?Due for \\d{4}[^:\\n]{0,30}",
  "Last Payment Amount[^:\\n]{0,40}",
  "Last Payer[^:\\n]{0,40}",
  "Last Payment Date[^:\\n]{0,40}",
  "Pending (?:Credit Card or eCheck|Credit/Debit or e-Check|Internet|Online) Payments",
  "Total Market Value",
  "Gross Value",
  "Appraised Value",
  "Market Value",
  "Land Value",
  "Improvement Value",
  "Capped Value",
  "Agricultural Value",
  "Exemptions[^:\\n]{0,30}",
  "Jurisdictions[^:\\n]{0,70}",
  "Active Lawsuits[^:\\n]{0,30}",
  "Active Judgments",
  "Make your check or money order payable to",
  "Disclaimer",
]
  .join("|")
  // a label may wrap ("Pending<br>Credit Card or eCheck<br>Payments")
  .replace(/ /g, "[\\s⏎]+");

// The page as "Name: value" lines; a <br> inside a value becomes BR.
function labelLines(
  html: string,
): { label: string; value: string[]; all: string }[] {
  const flat = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // hidden blocks (lawsuits, deferral notices that don't apply)
    .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, "")
    // the newer design hides what doesn't apply with data-if="false"
    .replace(/<(div|li|form)\b[^>]*data-if="false"[^>]*>[\s\S]*?<\/\1>/gi, "")
    // the source's own line breaks mean nothing; only tags break lines
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, BR)
    .replace(/<\/?(div|h\d|p|td|tr|li|table|form|button|a)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  // Layouts disagree on where a label ends and its value starts (same block,
  // next block, several labels on one line), so find the known field names
  // wherever they are; a value runs to the next field name, and only its
  // first non-empty line counts (what follows is buttons and notices).
  const text = decode(flat).replace(/[ \t]+/g, " ");
  const out: { label: string; value: string[]; all: string }[] = [];
  const hits = [...text.matchAll(new RegExp(`(${FIELD_NAMES})\\s*:`, "gi"))];
  hits.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index! : text.length;
    const region = text.slice(start, end);
    // everything up to the next field, for values laid out as a small table
    // (Fort Bend's pending payments: Date / Amount / Payer …)
    const all = region
      .replace(/[\s⏎]+/g, " ")
      .trim()
      .slice(0, 300);
    const firstLine =
      region
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.replace(/⏎/g, "").trim()) ?? "";
    const value = firstLine
      .split("⏎")
      .map((v) => v.trim())
      .filter(Boolean);
    out.push({ label: m[1].replace(/[\s⏎]+/g, " ").trim(), value, all });
  });
  return out;
}

export function parseAccountPage(html: string): ParsedAccountPage {
  const out: ParsedAccountPage = {
    source: "act",
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
  };
  // "…tax information for 2026" / "All tax information refers to the 2026
  // Tax Year" (Dallas)
  const year = strip(html).match(
    /tax information (?:for|refers to the) (\d{4})/i,
  );
  if (year) out.taxYear = Number(year[1]);

  for (const { label, value, all } of labelLines(html)) {
    const v = value.join(" ");
    if (/^Account (Number|No.)$/i.test(label))
      // Dallas accounts have letters (200701800C0260000)
      out.taxAccount ||= (value[0] ?? "").replace(/[^\dA-Z]/gi, "");
    else if (/^Long Account Number$/i.test(label))
      out.longAccount = v.replace(/\D/g, "") || null;
    else if (/^(Owner |Mailing )?Address$/i.test(label)) {
      if (!out.ownerLines.length) out.ownerLines = value;
    } else if (/^Property Site Address$/i.test(label))
      out.siteAddress = orNull(value.join(" "));
    else if (/^Legal Description$/i.test(label))
      out.legal = orNull(value.join(" "));
    else if (/Levy\)?$/i.test(label) && !/half/i.test(label)) {
      out.levy = moneyValue(v);
      const y = label.match(/^(\d{4})/);
      if (y) out.taxYear ??= Number(y[1]);
    } else if (/^Prior Year/i.test(label)) out.priorYearsDue = moneyValue(v);
    else if (/^Total Amount Due$/i.test(label)) out.totalDue = moneyValue(v);
    // Fort Bend shows only "Total Amount Due for 2026 & Prior Years"
    else if (/^Total (Amount )?Due for (\d{4})/i.test(label)) {
      out.totalDue ??= moneyValue(v);
      out.taxYear ??= Number(label.match(/(\d{4})/)![1]);
    } else if (/^(\d{4} Year|Current)( Year)? (Amount )?Due$/i.test(label))
      out.yearAmountDue = moneyValue(v);
    else if (/^Delinquent After$/i.test(label))
      out.delinquentAfter = isoDate(v);
    else if (/^Half Payment/i.test(label)) {
      out.halfPaymentAmount = moneyValue(v);
      out.halfPaymentDeadline = isoDate(
        v.match(/Deadline\s+(.+)$/i)?.[1] ?? null,
      );
    } else if (/^Last Payment Amount/i.test(label))
      out.lastPaymentAmount = moneyValue(v);
    else if (/^Last Payer/i.test(label)) out.lastPayer = orNull(v);
    else if (/^Last Payment Date/i.test(label))
      out.lastPaymentDate = isoDate(v);
    else if (/^Pending (Credit|Internet|Online)/i.test(label))
      out.pendingPayments = /^date\b/i.test(v)
        ? orNull(all.replace(/^Date Amount Payer\s*/i, ""))
        : orNull(v);
    else if (/^((Total )?Market|Gross|Appraised) Value$/i.test(label))
      out.marketValue = moneyValue(v);
    else if (/^Land Value$/i.test(label)) out.landValue = moneyValue(v);
    else if (/^Improvement Value$/i.test(label))
      out.improvementValue = moneyValue(v);
    else if (/^Capped Value$/i.test(label)) out.cappedValue = moneyValue(v);
    else if (/^Agricultural Value$/i.test(label)) out.agValue = moneyValue(v);
    else if (/^Exemptions/i.test(label))
      out.exemptions = orNull(value.join(", ") || v);
    else if (/^Jurisdictions/i.test(label))
      // "Jurisdictions Collected: *" — the names follow the footnote mark
      out.jurisdictionsNote = orNull(
        value.join(", ") === "*"
          ? all
              .replace(/^\*\s*/, "")
              // Fort Bend's "Active Lawsuits" has no colon to stop at
              .replace(/\s*\b(Active Lawsuits|Bankruptcy)\b[\s\S]*$/i, "")
          : value.join(", "),
      );
    else if (/^Active Lawsuits/i.test(label)) out.lawsuits = orNull(v);
  }
  // The newer design names the year only in its links and headings.
  if (out.taxYear == null) {
    const y = strip(html).match(
      /(?:Total Due for|Payment Information for) (\d{4})/i,
    );
    // last resort: the year in a "future amount due" link (El Paso)
    const link = html.match(/taxYear=(\d{4})/i);
    if (y) out.taxYear = Number(y[1]);
    else if (link) out.taxYear = Number(link[1]);
  }
  // The older layout puts the half payment on a "Pay Half" button instead.
  if (out.halfPaymentAmount == null) {
    const half = html.match(
      /id="payHalfForm"[\s\S]{0,600}?name\s*=\s*"amount"\s+value\s*=\s*"([\d.,]+)"/i,
    );
    if (half) out.halfPaymentAmount = Number(half[1].replace(/,/g, ""));
  }
  return out;
}

// ── Tables (jurisdictions, payment history) ─────────────────────────────────

type Row = Record<string, string>;

// Innermost <tr>s as {column name: text}. Column names come from data-label
// attributes (newer layout) or the nearest row above that reads like a
// header (older layout).
function tableRowsByHeader(html: string): Row[] {
  const page = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const rows = [
    ...page.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?)<\/tr>/gi),
  ].map((m) => m[1]);
  const HEADER =
    /date|year|amount|payer|description|jurisdiction|entity|levy|taxable|rate|total due/i;
  let header: string[] | null = null;
  const out: Row[] = [];
  for (const r of rows) {
    const cells = [...r.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map(
      (m) => ({
        label: m[1].match(/data-label="([^"]+)"/i)?.[1] ?? null,
        text: strip(m[2]),
      }),
    );
    if (cells.length < 2) continue;
    const texts = cells.map((c) => c.text);
    if (
      !cells.some((c) => c.label) &&
      !texts.some((t) => /\$\s*[\d,]/.test(t)) &&
      texts.filter((t) => HEADER.test(t)).length >= 2
    ) {
      header = texts;
      continue;
    }
    const row: Row = {};
    cells.forEach((c, i) => {
      const name = c.label ?? header?.[i];
      if (name) row[name] = c.text;
    });
    if (Object.keys(row).length >= 2) out.push(row);
  }
  return out;
}

const pick = (row: Row, re: RegExp) => {
  const k = Object.keys(row).find((n) => re.test(n));
  return k ? row[k] : null;
};

export function parseJurisdictions(html: string): TaxOfficeJurisdiction[] {
  return tableRowsByHeader(html)
    .map((row) => {
      const rate = pick(row, /rate/i);
      return {
        year: Number(pick(row, /roll year|^year/i)) || null,
        name: pick(row, /jurisdiction|entity|taxing unit/i) ?? "",
        taxableValue: moneyValue(pick(row, /taxable/i)),
        rate: rate && /^[\d.]+$/.test(rate.trim()) ? Number(rate) : null,
        levy: moneyValue(pick(row, /levy/i)),
        totalDue: moneyValue(pick(row, /total due|amount due/i)),
      };
    })
    .filter(
      (j) =>
        j.name &&
        !/^total/i.test(j.name) &&
        (j.levy != null || j.taxableValue != null),
    );
}

export function parsePayments(html: string): TaxOfficePayment[] {
  return tableRowsByHeader(html)
    .map((row) => ({
      date: isoDate(pick(row, /date/i)),
      rollYear: Number(pick(row, /roll year|tax year|^year/i)) || null,
      amount: moneyValue(pick(row, /amount/i)),
      description: orNull(pick(row, /description/i)),
      payer: orNull(pick(row, /payer/i)),
    }))
    .filter((p) => p.date && p.amount != null);
}

// reports/taxbyyear.jsp — "Year | Base Tax Due | Penalty… | Total Due …":
// the base tax still due per year.
export function baseDueByYear(html: string): Map<number, number> {
  const out = new Map<number, number>();
  const page = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  for (const m of page.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((c) => strip(c[1]))
      .filter(Boolean);
    if (!/^\d{4}$/.test(cells[0] ?? "")) continue;
    const base = moneyValue(cells.find((c, i) => i > 0 && /\$/.test(c)));
    if (base != null && !out.has(Number(cells[0])))
      out.set(Number(cells[0]), base);
  }
  return out;
}

// ── Links on the account page ───────────────────────────────────────────────

export function accountLinks(
  base: string,
  taxAccount: string,
  detailHtml: string,
  detailPage = "showdetail2.jsp",
): TaxOfficeLinks {
  const hrefs = [...detailHtml.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(
    (m) => decode(m[1]),
  );
  const find = (re: RegExp) => {
    const h = hrefs.find((x) => re.test(x));
    if (!h) return null;
    try {
      if (/^javascript:/i.test(h)) return null;
      return new URL(h, `${base}/${detailPage}`).href;
    } catch {
      return null;
    }
  };
  return {
    account: `${base}/${detailPage}?can=${taxAccount}&ownerno=0`,
    pay: find(/webpay\/cart\.jsp\?/i),
    statement: find(/currentstatement|current-statement/i),
    delinquentStatement: find(
      /delinquentstatement|delinquent-statement|prepare-paybymail/i,
    ),
    paymentHistory: find(/payment-?info\.jsp/i),
    jurisdictions: find(/jurisdiction-?details?\.jsp/i),
    taxByYear: find(/taxbyyear\.jsp|tax-due-by-year\.jsp/i),
    paymentRecord: find(/receipt\/composite|composite-receipt/i),
    autoPay: /collectorsolutions/i.test(detailHtml)
      ? (detailHtml.match(
          /https:\/\/magic\.collectorsolutions\.com[^"]*/i,
        )?.[0] ?? null)
      : null,
    map: find(/mapSearch|maps?\b.*\bp=/i),
  };
}

// ── Fetching ────────────────────────────────────────────────────────────────

function cookieHeader(res: Response): string {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const all =
    h.getSetCookie?.() ??
    (res.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return all
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

// Accounts a search result list links to, the one naming this CAD ID first.
export function accountsInList(html: string, cadId: string): string[] {
  const rows = [
    ...html.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?)<\/tr>/gi),
  ].map((m) => m[1]);
  const hits: { can: string; exact: boolean }[] = [];
  for (const r of rows) {
    const can = r.match(/showdetail2\.jsp\?can=([\dA-Z]+)/i)?.[1];
    if (!can || hits.some((h) => h.can === can)) continue;
    hits.push({ can, exact: new RegExp(`\\b0*${cadId}\\b`).test(strip(r)) });
  }
  if (hits.length === 0) {
    for (const m of html.matchAll(/showdetail2\.jsp\?can=([\dA-Z]+)/gi)) {
      if (!hits.some((h) => h.can === m[1]))
        hits.push({ can: m[1], exact: false });
    }
  }
  return hits
    .sort((a, b) => Number(b.exact) - Number(a.exact))
    .map((h) => h.can);
}

// The newer design's result list: `var searchResults = {...}` in the page,
// each account with its appraisal district account (aprdistacc, e.g.
// "R109220"). Accounts matching the CAD ID (ignoring letters and leading
// zeros) first.
export function accountsInJsonList(html: string, cadId: string): string[] {
  // `var searchResults = …` on some sites, `const result = …` on others
  const m = html.match(
    /=\s*(\{"status"\s*:[\s\S]*?"accounts"\s*:\s*\[[\s\S]*?\]\s*\}\s*\})\s*;/,
  );
  if (!m) return [];
  let accounts: { can?: string; aprdistacc?: string }[] = [];
  try {
    accounts = JSON.parse(m[1])?.data?.accounts ?? [];
  } catch {
    return [];
  }
  const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  const want = digits(cadId);
  return accounts
    .filter((a) => a.can)
    .map((a) => ({
      can: a.can!,
      exact:
        !!want &&
        (digits(a.aprdistacc ?? "") === want ||
          (a.aprdistacc ?? "").toUpperCase() === cadId.toUpperCase()),
    }))
    .sort((a, b) => Number(b.exact) - Number(a.exact))
    .map((a) => a.can);
}

// The statement for a property, by the appraisal district's property ID.
// null when the county isn't an ACT county or the tax office has no account.
export async function fetchActStatement(
  countyName: string,
  cadPropertyId: string,
  timeoutMs: number,
): Promise<TaxOfficeStatement | null> {
  const county = ACT_COUNTIES[countyName.toLowerCase()];
  const id = cadPropertyId.replace(/[^\dA-Za-z]/g, "");
  if (!county || !id) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = { "User-Agent": "Mozilla/5.0 (CorvusPT property lookup)" };
  const home = await fetch(`${county.base}/index.jsp`, { headers, signal });
  await home.arrayBuffer();
  const cookie = cookieHeader(home);
  const withCookie = {
    ...headers,
    Cookie: cookie,
    Referer: `${county.base}/index.jsp`,
  };
  const post = (path: string, body: Record<string, string>) =>
    fetch(`${county.base}/${path}`, {
      method: "POST",
      signal,
      headers: {
        ...withCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });
  const detailPage =
    county.search === "modern" ? "account-details.jsp" : "showdetail2.jsp";
  let direct: string | null = null;
  let cans: string[] = [];
  if (county.search === "modern") {
    const list = await post("search-result.jsp", {
      criteria: id,
      "search-type": "cad",
      altCriteria: "",
    });
    cans = accountsInJsonList(await list.text(), id);
    // Montgomery-style real-property IDs carry an "R" the saved number may lack
    if (cans.length === 0 && /^\d+$/.test(id)) {
      const retry = await post("search-result.jsp", {
        criteria: `R${id}`,
        "search-type": "cad",
        altCriteria: "",
      });
      cans = accountsInJsonList(await retry.text(), `R${id}`);
    }
  } else if (county.search !== "direct") {
    const list =
      county.search === "propertyId"
        ? await fetch(
            // the page's own script sends searchby/criteria with every field
            `${county.base}/showlist.jsp?searchby=5&criteria=${encodeURIComponent(id)}&lastName=&firstName=&streetNumber=&streetName=&streetSuffix=&accountNumber=&propertyId=${encodeURIComponent(id)}&fiduciaryNumber=`,
            { headers: withCookie, signal },
          )
        : await post("showlist.jsp", { searchby: "5", criteria: id });
    const listHtml = await list.text();
    // A search that lands straight on the account page has no list.
    if (/showdetail2\.jsp/i.test(list.url)) direct = listHtml;
    else cans = accountsInList(listHtml, id);
  }
  const get = (url: string) =>
    fetch(url, { headers: withCookie, signal }).then((r) =>
      r.ok ? r.text() : "",
    );
  // nothing found: some counties' tax account IS the CAD ID (Galveston's
  // short account, Dallas)
  const candidates = cans.length ? cans.slice(0, 1) : [id.toUpperCase()];
  for (const can of candidates) {
    const detail =
      direct ??
      (await get(
        `${county.base}/${detailPage}?can=${encodeURIComponent(can)}&ownerno=0`,
      ));
    const page = parseAccountPage(detail);
    if (!page.taxAccount && page.levy == null && page.totalDue == null)
      continue;
    const taxAccount = page.taxAccount || can;
    const links = accountLinks(county.base, taxAccount, detail, detailPage);
    const noLevy = page.levy == null && !!links.taxByYear;
    const [jur, pay, byYear] = await Promise.all([
      links.jurisdictions ? get(links.jurisdictions).catch(() => "") : "",
      links.paymentHistory ? get(links.paymentHistory).catch(() => "") : "",
      noLevy ? get(links.taxByYear!).catch(() => "") : "",
    ]);
    const payments = parsePayments(pay);
    // No levy on the page (Fort Bend): what's still owed for the year comes
    // from "Taxes Due Detail by Year", and the levy is that plus the year's
    // payments.
    if (noLevy && page.taxYear != null) {
      const owed = baseDueByYear(byYear).get(page.taxYear);
      if (owed != null) {
        page.yearAmountDue ??= owed;
        const paid = payments
          .filter((p) => p.rollYear === page.taxYear)
          .reduce((s, p) => s + (p.amount ?? 0), 0);
        page.levy = Math.round((owed + paid) * 100) / 100;
      }
    }
    const label = countyName.replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      ...page,
      county: label,
      taxAccount,
      cadPropertyId: id,
      jurisdictions: parseJurisdictions(jur),
      payments,
      links,
    };
  }
  return null;
}
