// Rebuilds src/data/tx-payment-plans.json: for every Texas county, what its
// tax assessor-collector's OWN website says about payment options — the
// half-payment (split) plan (Tax Code §31.03: half by Nov 30, half by June 30),
// quarter/installment plans, partial payments and early-payment discounts.
//
//   node scripts/build-tx-payment-plans.mjs            (all 254 counties)
//   node scripts/build-tx-payment-plans.mjs Bexar Rusk (just these)
//
// Starts from each county's tax office website in the Comptroller's directory
// (src/data/tx-cad-directory.json) and follows same-site links about taxes /
// payments (two levels deep, PDFs included). A finding is recorded only with
// the exact sentence and the page it came from — nothing is inferred. A county
// whose site says nothing either way stays "unknown" (shown to owners as "to
// be confirmed with the county tax office"). Rerun yearly, before tax bills.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dirFile = path.join(here, "../src/data/tx-cad-directory.json");
const outFile = path.join(here, "../src/data/tx-payment-plans.json");
const directory = JSON.parse(fs.readFileSync(dirFile, "utf8"));

const only = new Set(process.argv.slice(2).map((s) => s.toLowerCase()));
const MAX_PAGES = 25;
const CONCURRENCY = 8;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 CorvusPT-research";

// links worth following from a county site toward the tax office's payment info
const FOLLOW =
  /tax|assessor|collector|payment|pay\b|pay-|property|installment|split|half|calendar|deadline|faq|due/i;
const SKIP =
  /vehicle|motor|registration|title|boat|voter|elections?|jobs|careers|court|jail|sheriff|facebook|twitter|instagram|youtube|linkedin|mailto:|tel:|\.(jpg|png|gif|zip|docx?|xlsx?)$/i;

const MONTH_END =
  "(november\\s*30|nov\\.?\\s*30|11\\/30|december\\s*1\\b|june\\s*30|jun\\.?\\s*30|6\\/30|july\\s*1\\b)";
const PATTERNS = {
  // half by Nov 30 + rest by June 30 (either order, within one passage)
  half: [
    new RegExp(
      `(half[- ]?pay(ment)?s?|split[- ]?pay(ment)?s?|one[- ]half|1\\/2 payment|first half|second half)[^]{0,160}?${MONTH_END}`,
      "i",
    ),
    new RegExp(
      `${MONTH_END}[^]{0,160}?(half[- ]?pay(ment)?s?|split[- ]?pay(ment)?s?|one[- ]half|first half|second half|remaining half)`,
      "i",
    ),
  ],
  // an explicit statement that the split / half option isn't offered
  noHalf: [
    /(does|do|will)\s+not\s+(offer|have|participate in|accept)[^.]{0,80}(split|half)[- ]?pay/i,
    /(split|half)[- ]?pay(ment)?s?[^.]{0,60}(is|are)\s+not\s+(offered|available)/i,
    /no\s+(split|half)[- ]?pay(ment)?\s+(option|plan)/i,
  ],
  quarter: [
    /(quarter(ly)?[- ]?pay(ment)?s?|four\s+(equal\s+)?installments|installment\s+(payment\s+)?(plan|agreement|option)s?)/i,
  ],
  partial: [
    /partial\s+payments?\s+(are|is|will be)?\s*(accepted|welcome|allowed)|accepts?\s+partial\s+payments?/i,
  ],
  discount: [/(\b3\s?%[^.]{0,80}october|discount[^.]{0,120}(october|november|december))/i],
  prepay: [
    /(pre-?pay(ment)?\s+(plan|program|option)|escrow\s+(plan|account|program)\s+with\s+the\s+tax|monthly\s+pre-?pay)/i,
  ],
};

const decode = (s) =>
  s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&bull;|&#8226;/g, "•");
const htmlText = (html) =>
  decode(
    html
      .replace(
        /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi,
        " ",
      )
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td)>/gi, ". ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

// PDF text via pdfjs (already an app dependency)
let pdfjs = null;
async function pdfText(buf) {
  try {
    pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
    let out = "";
    for (let i = 1; i <= Math.min(doc.numPages, 12); i++) {
      const page = await doc.getPage(i);
      out += " " + (await page.getTextContent()).items.map((it) => it.str).join(" ");
    }
    return out.replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

async function fetchPage(url, retry = true) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (r.status === 429 && retry) {
      clearTimeout(t);
      await new Promise((ok) => setTimeout(ok, 8000));
      return fetchPage(url, false);
    }
    if (!r.ok) return { url, status: r.status, html: "", text: "" };
    const type = r.headers.get("content-type") ?? "";
    if (type.includes("pdf") || /\.pdf($|\?)/i.test(url)) {
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 8_000_000) return { url: r.url, status: r.status, html: "", text: "" };
      return { url: r.url, status: r.status, html: "", text: await pdfText(buf) };
    }
    if (!type.includes("html")) return { url: r.url, status: r.status, html: "", text: "" };
    const html = await r.text();
    return { url: r.url, status: r.status, html, text: htmlText(html) };
  } catch (e) {
    return { url, status: 0, html: "", text: "", error: String(e?.cause?.code ?? e?.name ?? e) };
  } finally {
    clearTimeout(t);
  }
}

function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = htmlText(m[2]);
    let u;
    try {
      u = new URL(decode(m[1]), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol)) continue;
    out.push({ url: u.href.replace(/#.*$/, ""), label });
  }
  return out;
}

const sameSite = (a, b) => {
  const h = (u) =>
    new URL(u).hostname
      .replace(/^www\./, "")
      .split(".")
      .slice(-2)
      .join(".");
  try {
    return h(a) === h(b);
  } catch {
    return false;
  }
};

// the sentence(s) around a match, trimmed to something quotable
function quote(text, idx, len) {
  const start = Math.max(0, text.lastIndexOf(". ", Math.max(0, idx - 1)) + 2);
  let end = text.indexOf(". ", idx + len);
  end = end === -1 ? Math.min(text.length, idx + len + 200) : end + 1;
  return text.slice(start, Math.min(end, start + 420)).trim();
}

// Text that mentions the split payment without saying THIS county offers it:
// the statewide statutory calendar many appraisal districts copy ("Last day
// to pay second half of split payment for taxes imposed last year (Sec.
// 31.03)") and the Comptroller's own explanation of the law.
const GENERIC = [
  /for taxes imposed last year\s*\(sec/i,
  /\(sec\.?\s*31\.03/i,
  /tax code section 31\.03 allows the governing body/i,
  /allows? (the )?(governing body|taxing units?) .{0,60}(to )?(allow|adopt|provide)/i,
];
const NOT_COUNTY_SOURCE = /comptroller\.texas\.gov|capitol\.texas\.gov|statutes\./i;

function findAll(text, url, found) {
  for (const [kind, res] of Object.entries(PATTERNS)) {
    if (found[kind]) continue;
    for (const re of res) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      for (const m of text.matchAll(g)) {
        const qt = quote(text, m.index, m[0].length);
        if (
          (kind === "half" || kind === "noHalf") &&
          (NOT_COUNTY_SOURCE.test(url) || GENERIC.some((x) => x.test(qt)))
        )
          continue;
        found[kind] = { url, quote: qt };
        break;
      }
      if (found[kind]) break;
    }
  }
}

async function research(county, website) {
  const start = website.startsWith("http") ? website : `https://${website}`;
  const seen = new Set();
  const found = {};
  const errors = [];
  let queue = [{ url: start, depth: 0, score: 0 }];
  let pages = 0;
  while (queue.length && pages < MAX_PAGES) {
    queue.sort((a, b) => b.score - a.score || a.depth - b.depth);
    const { url, depth } = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await fetchPage(url);
    pages++;
    if (!page.text) {
      if (page.error || page.status >= 400) errors.push(`${page.status || page.error} ${url}`);
      continue;
    }
    findAll(page.text, page.url, found);
    if (found.half && (found.quarter || found.partial)) break;
    if (depth >= 2 || !page.html) continue;
    for (const l of links(page.html, page.url)) {
      if (seen.has(l.url) || SKIP.test(l.url) || SKIP.test(l.label)) continue;
      if (!sameSite(l.url, start) && !/acttax|tax|pay/i.test(l.url)) continue;
      const hay = `${l.label} ${l.url}`;
      if (!FOLLOW.test(hay)) continue;
      const score =
        (/split|half|installment|payment\s*(plan|option)/i.test(hay) ? 6 : 0) +
        (/tax/i.test(l.label) ? 3 : 0) +
        (/pay/i.test(hay) ? 2 : 0) +
        (/\.pdf/i.test(l.url) && /calendar|split|half|deadline/i.test(hay) ? 3 : 0);
      queue.push({ url: l.url, depth: depth + 1, score });
    }
  }
  const half = found.half ? "offered" : found.noHalf ? "not_offered" : "unknown";
  return {
    county,
    website: start,
    halfPayment: half,
    evidence: found,
    pagesChecked: pages,
    errors: errors.slice(0, 5),
  };
}

const counties = Object.values(directory.counties)
  .filter((c) => !only.size || only.has(c.county.toLowerCase()))
  .sort((a, b) => a.county.localeCompare(b.county));

// Findings verified by hand (2026-11-05) for counties whose sites block or
// elude the crawler — always kept, so a rerun can't lose them.
const VERIFIED = {
  Bexar: {
    url: "https://www.bexar.org/DocumentCenter/View/25922/Payment-Plans",
    quote:
      "THIS PAYMENT PLAN IS AVAILABLE TO EVERY BEXAR COUNTY TAX PAYER! The Half-Payment Plan is available to all Taxpayers and Business Owners for both real estate and business personal property accounts.",
  },
  Wilson: {
    url: "https://www.wilsoncountytx.gov/page/wilson.TaxPaymentPlans",
    quote:
      "The half-payment plan is available to ALL taxpayers and business owners for both real property and business personal property accounts. 1st half due by November 30th; 2nd half due by June 30th.",
  },
  Brazos: {
    url: "https://wtaw.com/deadline-reminders-for-brazos-county-property-owners-planning-to-make-split-payments/",
    quote:
      "Brazos County taxing jurisdictions offer the two part payment plan to their taxpayers allowing a payment of ½ of the property tax bill on or before November 30 of the year the taxes are billed, and the second half payment on or before June 30 of the following year. (Local news report; the tax office's own site, brazostax.org, didn't state it.)",
  },
};

const prev = fs.existsSync(outFile)
  ? JSON.parse(fs.readFileSync(outFile, "utf8"))
  : { counties: {} };
const results = { ...prev.counties };
let done = 0;
async function worker(list) {
  while (list.length) {
    const c = list.shift();
    const site = c.taxOffice?.website;
    const cad = c.appraisalDistrict?.website;
    let r = site
      ? await research(c.county, site)
      : {
          county: c.county,
          website: null,
          halfPayment: "unknown",
          evidence: {},
          pagesChecked: 0,
          errors: ["no website in the Comptroller directory"],
        };
    // some counties have the appraisal district collect taxes — check its
    // site too when the tax office site says nothing about split payments
    if (r.halfPayment === "unknown" && cad && cad !== site) {
      const viaCad = await research(c.county, cad);
      if (viaCad.halfPayment !== "unknown")
        r = {
          ...viaCad,
          evidence: { ...r.evidence, ...viaCad.evidence },
          pagesChecked: r.pagesChecked + viaCad.pagesChecked,
          viaAppraisalDistrict: true,
        };
      else
        r = {
          ...r,
          evidence: { ...viaCad.evidence, ...r.evidence },
          pagesChecked: r.pagesChecked + viaCad.pagesChecked,
        };
    }
    results[c.county] = r;
    done++;
    r = results[c.county];
    console.log(
      `${String(done).padStart(3)}/${counties.length} ${c.county.padEnd(14)} half=${r.halfPayment.padEnd(11)} pages=${r.pagesChecked}${Object.keys(r.evidence).length ? " " + Object.keys(r.evidence).join(",") : ""}`,
    );
  }
}
const list = [...counties];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(list)));
for (const [county, ev] of Object.entries(VERIFIED)) {
  const r = results[county] ?? { county, website: null, evidence: {}, pagesChecked: 0, errors: [] };
  results[county] = {
    ...r,
    halfPayment: "offered",
    evidence: { ...r.evidence, half: ev },
    verifiedByHand: true,
  };
}

fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      source:
        "Each county tax assessor-collector's own website (via the Texas Comptroller's county directory)",
      builtAt: new Date().toISOString().slice(0, 10),
      counties: Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    1,
  ) + "\n",
);
const all = Object.values(results);
console.log(
  `\noffered ${all.filter((r) => r.halfPayment === "offered").length}, not offered ${all.filter((r) => r.halfPayment === "not_offered").length}, unknown ${all.filter((r) => r.halfPayment === "unknown").length} → ${path.relative(process.cwd(), outFile)}`,
);
