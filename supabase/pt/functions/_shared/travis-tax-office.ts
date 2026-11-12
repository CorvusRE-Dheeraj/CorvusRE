// Travis County Tax Office account statements — its account search runs on
// travis.go2gov.net (Easy Access Inc.), linked from tax-office.traviscountytx.gov.
// Same TaxOfficeStatement shape as act-tax-office.ts.
//
// The tax account is TCAD's Geo ID + "0000" (0150030316 → 01500303160000).
// Properties are saved with TCAD's property ID (PID), so the Geo ID comes
// from TCAD's public TrueProdigy API first (the same API tax-history.ts
// reads values from). Then on go2gov: quickSearch.do (session cookie from
// search.do) finds the account; showPropertyInfo.do has owner, mailing
// address, legal description and the current year's base / penalty / fees /
// total due; showPropertyEntityDetail.do the same per taxing unit with
// assessed and net taxable values; showPaymentReceipts.do every payment.
// Plain public pages, no CAPTCHA. Parsers are pure (tested by vitest).

import {
  moneyValue,
  isoDate,
  type TaxOfficeJurisdiction,
  type TaxOfficePayment,
  type TaxOfficeStatement,
} from "./act-tax-office.ts";

const GO2GOV = "https://travis.go2gov.net";
const PRODIGY = "https://prod-container.trueprodigyapi.com";

const decode = (s: string) =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'");
const text = (html: string) =>
  decode(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const plain = (s: string | null | undefined) => {
  const m = (s ?? "").replace(/[$,\s]/g, "").match(/^-?\d+(\.\d+)?$/);
  return m ? Number(m[0]) : null;
};

// Every innermost row's cell texts (th or td).
function rows(html: string): string[][] {
  const page = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  return [...page.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?)<\/tr>/gi)]
    .map((m) =>
      [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        text(c[1]),
      ),
    )
    .filter((r) => r.some(Boolean));
}

// The label/value block at the top of every go2gov account page.
function header(html: string): {
  account: string | null;
  ownerLines: string[];
  legal: string | null;
} {
  const t = text(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, " | ")
      .replace(/<\/(td|div|p|span|li|tr)>/gi, " | "),
  ).replace(/(\s*\|\s*)+/g, " | ");
  const grab = (label: string, next: string) =>
    t.match(
      new RegExp(`${label}\\s*\\|?\\s*(.*?)\\s*\\|?\\s*${next}`, "i"),
    )?.[1] ?? null;
  const account = t.match(/Account#\s*\|?\s*(\d{6,})/i)?.[1] ?? null;
  const owner = grab("Owner Name", "Mailing Address");
  const mailing = grab("Mailing Address", "Legal Description");
  // the first non-empty value (an empty template copy can come first)
  const legal =
    t.match(/Legal Description\s*\|?\s*([^|]+?)\s*\|/i)?.[1] ?? null;
  const ownerLines = [owner, ...(mailing ?? "").split("|")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return { account, ownerLines, legal: legal?.trim() || null };
}

// showPropertyInfo.do — "Tax Year | Base Due | Penalty/Interest | Fees | Total"
export function parseTravisDue(html: string): {
  year: number;
  baseDue: number | null;
  total: number | null;
}[] {
  return rows(html)
    .filter((r) => /^\d{4}$/.test(r[0] ?? ""))
    .map((r) => {
      const money = r.slice(1).filter((c) => /^\$?-?[\d,]+(\.\d+)?$/.test(c));
      return {
        year: Number(r[0]),
        baseDue: plain(money[0]),
        total: plain(money[money.length - 1]),
      };
    });
}

// showPropertyEntityDetail.do — per taxing unit.
export function parseTravisUnits(html: string): {
  name: string;
  assessed: number | null;
  taxable: number | null;
  baseDue: number | null;
  total: number | null;
}[] {
  return rows(html)
    .filter(
      (r) => r.length >= 6 && /\$/.test(r[1] ?? "") && !/^Total$/i.test(r[0]),
    )
    .map((r) => ({
      name: r[0],
      assessed: moneyValue(r[1]),
      taxable: moneyValue(r[2]),
      baseDue: moneyValue(r[3]),
      total: moneyValue(r[r.length - 1]),
    }));
}

// showPaymentReceipts.do — "Receipt | Tax Year | Payment Date | Payment Amount"
export function parseTravisReceipts(html: string): TaxOfficePayment[] {
  return rows(html)
    .filter(
      (r) =>
        r.length >= 4 &&
        /^\d{4}$/.test(r[1]) &&
        /\d{2}\/\d{2}\/\d{4}/.test(r[2]),
    )
    .map((r) => ({
      date: isoDate(r[2]),
      rollYear: Number(r[1]),
      amount: plain(r[3]),
      description: `Receipt ${r[0]}`,
      payer: null,
    }));
}

type Prodigy = {
  geoID: string | null;
  situs: string | null;
  market: number | null;
  land: number | null;
  improvement: number | null;
};

// TCAD PID → Geo ID (and the latest year's situs and values).
async function prodigyLookup(
  pid: string,
  signal: AbortSignal,
): Promise<Prodigy | null> {
  const auth = await fetch(`${PRODIGY}/trueprodigy/cadpublic/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ office: "Travis" }),
    signal,
  });
  if (!auth.ok) return null;
  const token = ((await auth.json()) as { user?: { token?: string } }).user
    ?.token;
  if (!token) return null;
  const res = await fetch(`${PRODIGY}/public/property/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({
      pid: { operator: "=", value: String(parseInt(pid, 10)) },
    }),
    signal,
  });
  if (!res.ok) return null;
  const all =
    ((await res.json()) as { results?: Record<string, unknown>[] }).results ??
    [];
  const latest = [...all].sort((a, b) => Number(b.pYear) - Number(a.pYear))[0];
  if (!latest) return null;
  const n = (v: unknown) => {
    const x = v == null || v === "" ? NaN : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    geoID: (latest.geoID as string | null) ?? null,
    situs: (latest.fullSitus as string | null) ?? null,
    market: n(latest.marketValue),
    land: n(latest.landMarketValue ?? latest.landValue),
    improvement: n(latest.improvementMarketValue ?? latest.improvementValue),
  };
}

export async function fetchTravisStatement(
  cadId: string,
  timeoutMs: number,
): Promise<TaxOfficeStatement | null> {
  const id = cadId.replace(/\D/g, "");
  if (!id) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  // a 10-digit Geo ID or 14-digit tax account works as is; anything shorter
  // is a TCAD property ID
  const prodigy =
    id.length < 10 ? await prodigyLookup(id, signal).catch(() => null) : null;
  const geo =
    id.length >= 10 ? id.slice(0, 10) : prodigy?.geoID?.replace(/\D/g, "");
  if (!geo) return null;
  const headers = { "User-Agent": "Mozilla/5.0 (CorvusPT property lookup)" };
  const start = await fetch(`${GO2GOV}/cart/responsive/search.do`, {
    headers,
    signal,
  });
  await start.arrayBuffer();
  const h = start.headers as Headers & { getSetCookie?: () => string[] };
  const cookie = (h.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  const withCookie = {
    ...headers,
    Cookie: cookie,
    Referer: `${GO2GOV}/cart/responsive/search.do`,
  };
  const list = await fetch(`${GO2GOV}/cart/responsive/quickSearch.do`, {
    method: "POST",
    signal,
    headers: {
      ...withCookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      formViewMode: "responsive",
      "criteria.searchStatus": "1",
      "pager.pageSize": "10",
      "pager.pageNumber": "1",
      "criteria.heuristicSearch": geo,
    }).toString(),
  });
  const accounts = [
    ...new Set(
      [
        ...(await list.text()).matchAll(/showPropertyInfo\.do\?account=(\d+)/g),
      ].map((m) => m[1]),
    ),
  ];
  const account = accounts.find((a) => a.startsWith(geo)) ?? null;
  if (!account) return null;
  const get = (path: string) =>
    fetch(`${GO2GOV}/${path}`, { headers: withCookie, signal })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
  const info = await get(`showPropertyInfo.do?account=${account}`);
  const due = parseTravisDue(info);
  const year = due.map((d) => d.year).sort((a, b) => b - a)[0] ?? null;
  const [unitsHtml, receiptsHtml] = await Promise.all([
    year
      ? get(`showPropertyEntityDetail.do?account=${account}&year=${year}`)
      : "",
    get(`showPaymentReceipts.do?account=${account}`),
  ]);
  const head = header(info);
  const payments = parseTravisReceipts(receiptsHtml);
  const current = due.find((d) => d.year === year) ?? null;
  const paidThisYear = payments
    .filter((p) => p.rollYear === year)
    .reduce((s, p) => s + (p.amount ?? 0), 0);
  const units = parseTravisUnits(unitsHtml);
  const jurisdictions: TaxOfficeJurisdiction[] = units.map((u) => ({
    year,
    name: u.name,
    taxableValue: u.taxable,
    rate: null,
    // the unit's base due is its levy until something is paid on it
    levy: paidThisYear === 0 ? u.baseDue : null,
    totalDue: u.total,
  }));
  const last = [...payments].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  )[0];
  return {
    source: "travis",
    county: "Travis",
    taxAccount: head.account ?? account,
    longAccount: null,
    cadPropertyId: id,
    taxYear: year,
    ownerLines: head.ownerLines,
    siteAddress: prodigy?.situs ?? null,
    legal: head.legal,
    levy:
      current?.baseDue != null
        ? Math.round((current.baseDue + paidThisYear) * 100) / 100
        : null,
    yearAmountDue: current?.baseDue ?? null,
    delinquentAfter: year ? `${year + 1}-02-01` : null,
    halfPaymentAmount: null,
    halfPaymentDeadline: null,
    priorYearsDue: due
      .filter((d) => year != null && d.year < year)
      .reduce((s, d) => s + (d.total ?? 0), 0),
    totalDue: due.reduce((s, d) => s + (d.total ?? 0), 0),
    lastPaymentAmount: last?.amount ?? null,
    lastPayer: null,
    lastPaymentDate: last?.date ?? null,
    pendingPayments: null,
    marketValue: prodigy?.market ?? units[0]?.assessed ?? null,
    landValue: prodigy?.land ?? null,
    improvementValue: prodigy?.improvement ?? null,
    cappedValue: null,
    agValue: null,
    exemptions: null,
    jurisdictionsNote: units.map((u) => u.name).join(", ") || null,
    lawsuits: null,
    jurisdictions,
    payments,
    links: {
      account: `${GO2GOV}/showPropertyInfo.do?account=${account}`,
      pay: `${GO2GOV}/showPropertyInfo.do?account=${account}`,
      statement: `${GO2GOV}/export?type=cur&account=${account}`,
      delinquentStatement: null,
      paymentHistory: `${GO2GOV}/showPaymentReceipts.do?account=${account}`,
      jurisdictions: year
        ? `${GO2GOV}/showPropertyEntityDetail.do?account=${account}&year=${year}`
        : null,
      taxByYear: null,
      paymentRecord: `${GO2GOV}/showPaymentReceipts.do?account=${account}`,
      autoPay: null,
      map: null,
    },
  };
}
