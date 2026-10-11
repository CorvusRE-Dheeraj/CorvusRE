// Bexar County Tax Office public account search (bexar.acttax.com) — a second
// source for Bexar addresses. BCAD's parcel map (cad-lookup's queryBexar) only
// holds land parcels with a drawn boundary, so it misses accounts that other
// firms show at the same address — most often the business personal property
// account (furniture, fixtures, equipment, inventory). Found Oct 2026 on
// 19730 Bulverde Rd: the map has 1149803 (land + building); the tax office also
// lists 1151895 (BPP, $6,940) and 1131253 (a retired parcel, $0, last billed
// 2012). O'Connor shows the first two; so do we — accounts with no current
// value are left out.
//
// Plain public HTML form (no CAPTCHA, no robots.txt), so this parses HTML —
// it fails quietly (returns []) on any change, leaving the map results as-is.
// Parsers are pure (no Deno APIs) so the app's vitest suite tests them.

const BASE = "https://bexar.acttax.com/act_webdev/bexar";

// propertyType on a CadRecord for a business personal property account.
export const BPP_PROPERTY_TYPE = "Business Personal Property";

export type TaxOfficeAccount = {
  taxAccount: string; // 12 digits, e.g. 177280090010 or 000001151895
  cadPropertyId: string; // BCAD Property ID ("CAD Reference No."), e.g. 1151895
  owner: string | null;
  situs: string;
  legal: string;
};

export type TaxOfficeDetail = {
  // The roll year the page's values belong to ("ALL DATA REFERS TO TAX
  // INFORMATION FOR 2025") — the tax office trails the appraisal district,
  // which may already have moved on to a year it hasn't valued yet.
  taxYear: number | null;
  marketValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
};

const text = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function cell(row: string, label: string): string | null {
  const m = row.match(
    new RegExp(`data-label="${label}"[^>]*>([\\s\\S]*?)</td>`, "i"),
  );
  return m ? text(m[1]) : null;
}

// The result list of an address search (showlist.jsp).
export function parseTaxOfficeList(html: string): TaxOfficeAccount[] {
  const out: TaxOfficeAccount[] = [];
  for (const m of html.matchAll(
    /<tr[^>]*id="account-container"[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const row = m[1];
    const taxAccount = (cell(row, "Account") ?? "").replace(/\D/g, "");
    const cadPropertyId = (cell(row, "CAD Reference No.") ?? "").replace(
      /\D/g,
      "",
    );
    if (taxAccount.length !== 12 || !cadPropertyId) continue;
    const ownerLines = (
      row.match(/data-label="Owner"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? ""
    )
      .split(/<br\s*\/?>/i)
      .map(text);
    out.push({
      taxAccount,
      cadPropertyId,
      owner: ownerLines[0] || null,
      situs: cell(row, "Address") ?? "",
      legal: cell(row, "Legal Description") ?? "",
    });
  }
  return out;
}

const money = (t: string, label: string): number | null => {
  const m = t.match(new RegExp(`${label}:\\s*\\$([\\d,]+(?:\\.\\d+)?)`, "i"));
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

// An account's detail page (showdetail2.jsp) — its current values.
export function parseTaxOfficeDetail(html: string): TaxOfficeDetail {
  const t = text(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, ""),
  );
  const year = t.match(/TAX INFORMATION FOR (\d{4})/i);
  return {
    taxYear: year ? Number(year[1]) : null,
    marketValue: money(t, "Total Market Value"),
    landValue: money(t, "Land Value"),
    improvementValue: money(t, "Improvement Value"),
  };
}

// Business personal property: BPP accounts are numbered 00000 + the Property
// ID, and their legal description lists what's taxed.
export function isBusinessPersonalProperty(
  a: Pick<TaxOfficeAccount, "taxAccount" | "legal">,
): boolean {
  return (
    a.taxAccount.startsWith("00000") ||
    /\b(FURN|FIXT|EQPT|EQUIP|INVENTORY|INV|SUPPLIES|SUP|MACH|VEHICLES?|BPP)\b/i.test(
      a.legal,
    )
  );
}

// "177280090010" → "17728-009-0010", the Geographic ID as BCAD prints it.
// BPP accounts have no Geographic ID.
export function geoIdFromTaxAccount(taxAccount: string): string | null {
  if (!/^\d{12}$/.test(taxAccount) || taxAccount.startsWith("00000"))
    return null;
  return `${taxAccount.slice(0, 5)}-${taxAccount.slice(5, 8)}-${taxAccount.slice(8)}`;
}

// The search text the form expects: house number + first street word
// ("19730 BULVERDE"), from a situs like "19730 BULVERDE RD SAN ANTONIO, TX 78259".
export function taxOfficeQuery(situs: string): string | null {
  const tokens = situs
    .toUpperCase()
    .split(",")[0]
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!/^\d+$/.test(tokens[0] ?? "")) return null;
  const street = ["N", "S", "E", "W"].includes(tokens[1])
    ? tokens[2]
    : tokens[1];
  return street ? `${tokens[0]} ${street}` : null;
}

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

// Every account the tax office lists at this address, with current values.
// The form needs a session cookie from its own page first.
export async function fetchTaxOfficeAccounts(
  situs: string,
  timeoutMs: number,
): Promise<Array<TaxOfficeAccount & TaxOfficeDetail>> {
  const query = taxOfficeQuery(situs);
  if (!query) return [];
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = { "User-Agent": "Mozilla/5.0 (CorvusPT property lookup)" };
  const home = await fetch(`${BASE}/index.jsp`, { headers, signal });
  await home.arrayBuffer();
  const cookie = cookieHeader(home);
  const list = await fetch(`${BASE}/showlist.jsp`, {
    method: "POST",
    signal,
    headers: {
      ...headers,
      Cookie: cookie,
      Referer: `${BASE}/index.jsp`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ searchby: "6", criteria: query }).toString(),
  });
  const house = query.split(" ")[0];
  const accounts = parseTaxOfficeList(await list.text()).filter((a) =>
    a.situs.toUpperCase().startsWith(`${house} `),
  );
  return Promise.all(
    accounts.slice(0, 8).map(async (a) => {
      try {
        const res = await fetch(`${BASE}/showdetail2.jsp?can=${a.taxAccount}`, {
          headers: { ...headers, Cookie: cookie },
          signal,
        });
        return { ...a, ...parseTaxOfficeDetail(await res.text()) };
      } catch {
        return {
          ...a,
          taxYear: null,
          marketValue: null,
          landValue: null,
          improvementValue: null,
        };
      }
    }),
  );
}
