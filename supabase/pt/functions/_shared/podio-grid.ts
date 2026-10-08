// Podio → spreadsheet grid. A Podio app's items arrive as a list of fields
// (label, type, values in a type-specific shape); the bulk property import
// works on a header row plus data rows, so each field label becomes a column
// and each item a row — then the same AI column mapping, county matching,
// flags and duplicate checks run as for an uploaded Excel or CSV file.
// Pure, so it's tested.

export type PodioField = {
  label?: string;
  external_id?: string;
  type?: string;
  values?: Array<Record<string, unknown>>;
};
export type PodioItem = {
  item_id?: number;
  title?: string | null;
  fields?: PodioField[];
};

const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const asText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return stripHtml(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["text", "title", "name", "formatted", "value"]) {
      if (typeof o[k] === "string" || typeof o[k] === "number")
        return asText(o[k]);
    }
  }
  return "";
};

// One field's values as a cell, by Podio field type.
export function fieldText(f: PodioField): string {
  const vals = f.values ?? [];
  if (vals.length === 0) return "";
  switch (f.type) {
    case "number":
    case "money":
    case "progress":
    case "calculation": {
      const raw = asText(vals[0].value);
      const n = Number(raw);
      return Number.isFinite(n) && raw !== ""
        ? String(Math.round(n * 100) / 100)
        : raw;
    }
    case "location":
      return asText(vals[0].formatted ?? vals[0].value);
    case "date":
      return asText(vals[0].start_date ?? vals[0].start ?? "");
    case "category":
      return vals
        .map((v) => asText(v.value))
        .filter(Boolean)
        .join(", ");
    case "contact":
    case "app":
    case "email":
    case "phone":
      return vals
        .map((v) => asText(v.value))
        .filter(Boolean)
        .join(", ");
    default:
      return vals
        .map((v) => asText(v.value ?? v))
        .filter(Boolean)
        .join(", ");
  }
}

export const TITLE_COLUMN = "Item title";

export function itemsToGrid(items: PodioItem[]): {
  headers: string[];
  rows: string[][];
} {
  const headers: string[] = [TITLE_COLUMN];
  const index = new Map<string, number>([[TITLE_COLUMN, 0]]);
  for (const it of items)
    for (const f of it.fields ?? []) {
      const label = (f.label ?? f.external_id ?? "").trim();
      if (label && !index.has(label)) {
        index.set(label, headers.length);
        headers.push(label);
      }
    }
  const rows = items.map((it) => {
    const row = new Array<string>(headers.length).fill("");
    row[0] = asText(it.title ?? "");
    for (const f of it.fields ?? []) {
      const i = index.get((f.label ?? f.external_id ?? "").trim());
      if (i != null) row[i] = fieldText(f);
    }
    return row;
  });
  return { headers, rows: rows.filter((r) => r.some((c) => c !== "")) };
}

// Signed OAuth state: user id, time and where to return, HMAC'd so the
// callback can trust all three.
const b64 = (s: string) =>
  btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64 = (s: string) =>
  decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export async function signState(
  userId: string,
  returnPath: string,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const payload = `${userId}.${now}.${b64(returnPath)}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyState(
  state: string,
  secret: string,
  now = Date.now(),
  maxAgeMs = 15 * 60_000,
): Promise<{ userId: string; returnPath: string } | null> {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, ts, ret, sig] = parts;
  if (!userId || !Number(ts) || now - Number(ts) > maxAgeMs) return null;
  if ((await hmac(`${userId}.${ts}.${ret}`, secret)) !== sig) return null;
  const returnPath = unb64(ret);
  // Only an app-relative path — never an open redirect.
  return returnPath.startsWith("/") && !returnPath.startsWith("//")
    ? { userId, returnPath }
    : null;
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
