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

export type ActSearch = "searchby5" | "propertyId";
export type ActCounty = { base: string; search: ActSearch };

// County → its ACT site, checked 2026-11-11 (each one's search form). Dallas,
// Montgomery, Atascosa, Kleberg, Goliad and McMullen also use ACT but with a
// different search page — not connected yet.
export const ACT_COUNTIES: Record<string, ActCounty> = {
  angelina: {
    base: "https://actweb.acttax.com/angelina/angelina",
    search: "searchby5",
  },
  bexar: {
    base: "https://bexar.acttax.com/act_webdev/bexar",
    search: "searchby5",
  },
  brooks: {
    base: "https://actweb.acttax.com/act_webdev/brooks",
    search: "searchby5",
  },
  cass: { base: "https://actweb.acttax.com/cass/cass", search: "searchby5" },
  duval: {
    base: "https://actweb.acttax.com/act_webdev/duval",
    search: "searchby5",
  },
  "el paso": {
    base: "https://actweb.acttax.com/act_webdev/elpaso",
    search: "propertyId",
  },
  "fort bend": {
    base: "https://actweb.acttax.com/act_webdev/fbc",
    search: "searchby5",
  },
  galveston: {
    base: "https://actweb.acttax.com/act_webdev/galveston",
    search: "searchby5",
  },
  gregg: {
    base: "https://actweb.acttax.com/act_webdev/gregg",
    search: "searchby5",
  },
  hidalgo: {
    base: "https://actweb.acttax.com/act_webdev/hidalgo",
    search: "searchby5",
  },
  jackson: {
    base: "https://actweb.acttax.com/jackson/jackson",
    search: "searchby5",
  },
  jefferson: {
    base: "https://actweb.acttax.com/act_webdev/jefferson",
    search: "searchby5",
  },
  kaufman: {
    base: "https://actweb.acttax.com/kaufman/kaufman",
    search: "searchby5",
  },
  mclennan: {
    base: "https://actweb.acttax.com/act_webdev/mclennan",
    search: "searchby5",
  },
  navarro: {
    base: "https://actweb.acttax.com/act_webdev/navarro",
    search: "searchby5",
  },
  nueces: {
    base: "https://actweb.acttax.com/nueces/nueces",
    search: "searchby5",
  },
  refugio: {
    base: "https://actweb.acttax.com/act_webdev/refugio",
    search: "searchby5",
  },
  "san patricio": {
    base: "https://actweb.acttax.com/act_webdev/sanpatricio",
    search: "searchby5",
  },
  upshur: {
    base: "https://actweb.acttax.com/act_webdev/upshur",
    search: "searchby5",
  },
  "val verde": {
    base: "https://actweb.acttax.com/valverde/valverde",
    search: "searchby5",
  },
  victoria: {
    base: "https://actweb.acttax.com/victoria/victoria",
    search: "searchby5",
  },
  webb: {
    base: "https://actweb.acttax.com/act_webdev/webb",
    search: "searchby5",
  },
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
  const us = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
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

// The page as "Name: value" lines; a <br> inside a value becomes BR.
function labelLines(html: string): { label: string; value: string[] }[] {
  const flat = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // hidden blocks (lawsuits, deferral notices that don't apply)
    .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, "")
    // the source's own line breaks mean nothing; only tags break lines
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, BR)
    .replace(/<\/?(div|h\d|p|td|tr|li|table|form|button|a)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  const out: { label: string; value: string[] }[] = [];
  for (const raw of decode(flat).split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    const m = line.match(/^([^:⏎]{3,90}?):\s*(.*)$/);
    if (!m) continue;
    const value = m[2]
      .split("⏎")
      .map((v) => v.trim())
      .filter(Boolean);
    out.push({ label: m[1].replace(/\s+/g, " ").trim(), value });
  }
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
  const year = strip(html).match(/tax information for (\d{4})/i);
  if (year) out.taxYear = Number(year[1]);

  for (const { label, value } of labelLines(html)) {
    const v = value.join(" ");
    if (/^Account Number$/i.test(label))
      out.taxAccount ||= v.replace(/\D/g, "");
    else if (/^Long Account Number$/i.test(label))
      out.longAccount = v.replace(/\D/g, "") || null;
    else if (/^(Owner )?Address$/i.test(label)) {
      if (!out.ownerLines.length) out.ownerLines = value;
    } else if (/^Property Site Address$/i.test(label))
      out.siteAddress = orNull(value.join(" "));
    else if (/^Legal Description$/i.test(label))
      out.legal = orNull(value.join(" "));
    else if (/Tax Levy$/i.test(label) && !/half/i.test(label)) {
      out.levy = moneyValue(v);
      const y = label.match(/^(\d{4})/);
      if (y) out.taxYear ??= Number(y[1]);
    } else if (/^Prior Year/i.test(label)) out.priorYearsDue = moneyValue(v);
    else if (/^Total Amount Due$/i.test(label)) out.totalDue = moneyValue(v);
    else if (/^(\d{4} Year|Current) Amount Due$/i.test(label))
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
    else if (/^Pending (Credit Card|Internet|Online)/i.test(label))
      out.pendingPayments = orNull(v);
    else if (/^(Total )?Market Value$/i.test(label))
      out.marketValue = moneyValue(v);
    else if (/^Land Value$/i.test(label)) out.landValue = moneyValue(v);
    else if (/^Improvement Value$/i.test(label))
      out.improvementValue = moneyValue(v);
    else if (/^Capped Value$/i.test(label)) out.cappedValue = moneyValue(v);
    else if (/^Agricultural Value$/i.test(label)) out.agValue = moneyValue(v);
    else if (/^Exemptions/i.test(label))
      out.exemptions = orNull(value.join(", ") || v);
    else if (/^Jurisdictions/i.test(label))
      out.jurisdictionsNote = orNull(value.join(", "));
    else if (/^Active Lawsuits$/i.test(label)) out.lawsuits = orNull(v);
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

// ── Links on the account page ───────────────────────────────────────────────

export function accountLinks(
  base: string,
  taxAccount: string,
  detailHtml: string,
): TaxOfficeLinks {
  const hrefs = [...detailHtml.matchAll(/href\s*=\s*"([^"]+)"/gi)].map((m) =>
    decode(m[1]),
  );
  const find = (re: RegExp) => {
    const h = hrefs.find((x) => re.test(x));
    if (!h) return null;
    try {
      return new URL(h, `${base}/showdetail2.jsp`).href;
    } catch {
      return null;
    }
  };
  return {
    account: `${base}/showdetail2.jsp?can=${taxAccount}`,
    pay: find(/webpay\/cart\.jsp/i),
    statement: find(/currentstatement/i),
    delinquentStatement: find(/delinquentstatement|prepare-paybymail/i),
    paymentHistory: find(/paymentinfo\.jsp/i),
    jurisdictions: find(/jurisdictiondetail\.jsp/i),
    taxByYear: find(/taxbyyear\.jsp/i),
    paymentRecord: find(/receipt\/composite/i),
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
    const can = r.match(/showdetail2\.jsp\?can=(\d+)/i)?.[1];
    if (!can || hits.some((h) => h.can === can)) continue;
    hits.push({ can, exact: new RegExp(`\\b0*${cadId}\\b`).test(strip(r)) });
  }
  if (hits.length === 0) {
    for (const m of html.matchAll(/showdetail2\.jsp\?can=(\d+)/gi)) {
      if (!hits.some((h) => h.can === m[1]))
        hits.push({ can: m[1], exact: false });
    }
  }
  return hits
    .sort((a, b) => Number(b.exact) - Number(a.exact))
    .map((h) => h.can);
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
  const list =
    county.search === "propertyId"
      ? await fetch(
          `${county.base}/showlist.jsp?propertyId=${encodeURIComponent(id)}`,
          {
            headers: withCookie,
            signal,
          },
        )
      : await fetch(`${county.base}/showlist.jsp`, {
          method: "POST",
          signal,
          headers: {
            ...withCookie,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ searchby: "5", criteria: id }).toString(),
        });
  const listHtml = await list.text();
  // A search that lands straight on the account page has no list.
  const direct = /showdetail2\.jsp/i.test(list.url) ? listHtml : null;
  const cans = direct ? [] : accountsInList(listHtml, id);
  const get = (url: string) =>
    fetch(url, { headers: withCookie, signal }).then((r) =>
      r.ok ? r.text() : "",
    );
  const candidates = cans.length ? cans.slice(0, 1) : [id]; // some counties' account = CAD ID
  for (const can of candidates) {
    const detail =
      direct ?? (await get(`${county.base}/showdetail2.jsp?can=${can}`));
    const page = parseAccountPage(detail);
    if (!page.taxAccount && page.levy == null && page.totalDue == null)
      continue;
    const taxAccount = page.taxAccount || can;
    const links = accountLinks(county.base, taxAccount, detail);
    const [jur, pay] = await Promise.all([
      links.jurisdictions ? get(links.jurisdictions).catch(() => "") : "",
      links.paymentHistory ? get(links.paymentHistory).catch(() => "") : "",
    ]);
    const label = countyName.replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      ...page,
      county: label,
      taxAccount,
      cadPropertyId: id,
      jurisdictions: parseJurisdictions(jur),
      payments: parsePayments(pay),
      links,
    };
  }
  return null;
}
