// Deploy via CLI: `supabase functions deploy property-sources`.
// Optional secrets — each source is skipped (status "not_configured") until its
// key is set, so this is safe to deploy before either account exists:
//   ATTOM_API_KEY      ATTOM Property API key (header `apikey`)
//   REGRID_API_TOKEN   Regrid Parcel API token (query `token`)
//
// The paid property-data sources in the base-data pipeline (see
// apps/pt/src/lib/property-base-data.ts): Address → Geocode → Regrid parcel →
// CAD/county → ATTOM → … → reconcile. Proxied server-side so the keys never reach
// the browser. Both lookups run in parallel with their own timeout; one failing
// never fails the other. Signed-in callers only — these calls cost money per
// request, so they're not open to anonymous traffic.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeAttom,
  normalizeAttomComps,
  normalizeRegrid,
  splitAddressForAttom,
  type AttomComp,
  type AttomProperty,
  type RegridParcel,
  type SourceStatus,
} from "../_shared/property-sources.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const TIMEOUT_MS = 12_000;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: controller.signal });
    const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function lookupAttom(address: string): Promise<{ status: SourceStatus; data: AttomProperty | null; detail?: string }> {
  const key = Deno.env.get("ATTOM_API_KEY");
  if (!key) return { status: "not_configured", data: null };
  const parts = splitAddressForAttom(address);
  if (!parts) return { status: "no_match", data: null, detail: "address needs a street and a city line" };
  try {
    const qs = new URLSearchParams(parts).toString();
    const { status, body } = await getJson(
      `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/expandedprofile?${qs}`,
      { apikey: key },
    );
    // ATTOM answers "no results" with a non-200 status and a status.msg body.
    if (status === 400 || status === 404) return { status: "no_match", data: null };
    if (status !== 200) return { status: "error", data: null, detail: `HTTP ${status}` };
    const data = normalizeAttom(body);
    return data ? { status: "ok", data } : { status: "no_match", data: null };
  } catch (e) {
    return { status: "error", data: null, detail: e instanceof Error ? e.message : "unknown" };
  }
}

// Recent comparable sales around the property (Comparable Sales module). Separate
// call from the property lookup — an empty Texas result is normal (see
// normalizeAttomComps), so "no_match" here isn't an error.
async function lookupAttomComps(address: string): Promise<{ status: SourceStatus; data: AttomComp[] }> {
  const key = Deno.env.get("ATTOM_API_KEY");
  if (!key) return { status: "not_configured", data: [] };
  const parts = splitAddressForAttom(address);
  if (!parts) return { status: "no_match", data: [] };
  try {
    const { status, body } = await getJson(
      `https://api.gateway.attomdata.com/propertyapi/v1.0.0/salescomparables/address/${encodeURIComponent(parts.address1)}/${encodeURIComponent(parts.address2)}`,
      { apikey: key },
    );
    if (status === 400 || status === 404) return { status: "no_match", data: [] };
    if (status !== 200) return { status: "error", data: [] };
    const data = normalizeAttomComps(body);
    return { status: data.length > 0 ? "ok" : "no_match", data };
  } catch {
    return { status: "error", data: [] };
  }
}

async function lookupRegrid(
  address: string,
  lat: number | null,
  lng: number | null,
): Promise<{ status: SourceStatus; data: RegridParcel | null; detail?: string }> {
  const token = Deno.env.get("REGRID_API_TOKEN");
  if (!token) return { status: "not_configured", data: null };
  // A geocoded point is the most reliable way to land on the right parcel;
  // the address search is the fallback when there's no point.
  const url =
    lat != null && lng != null
      ? `https://app.regrid.com/api/v2/parcels/point?${new URLSearchParams({ lat: String(lat), lon: String(lng), token, limit: "1" })}`
      : `https://app.regrid.com/api/v2/parcels/address?${new URLSearchParams({ query: address, token, limit: "1" })}`;
  try {
    const { status, body } = await getJson(url);
    if (status === 404) return { status: "no_match", data: null };
    if (status !== 200) return { status: "error", data: null, detail: `HTTP ${status}` };
    const data = normalizeRegrid(body);
    return data ? { status: "ok", data } : { status: "no_match", data: null };
  } catch (e) {
    return { status: "error", data: null, detail: e instanceof Error ? e.message : "unknown" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
    } = await callerClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: corsHeaders });
    }

    const body = (await req.json()) as { address?: unknown; lat?: unknown; lng?: unknown };
    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (!address) {
      return new Response(JSON.stringify({ error: "address is required" }), { status: 400, headers: corsHeaders });
    }
    const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
    const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;

    const [attom, regrid, comps] = await Promise.all([
      lookupAttom(address),
      lookupRegrid(address, lat, lng),
      lookupAttomComps(address),
    ]);
    for (const [name, r] of [["ATTOM", attom], ["Regrid", regrid]] as const) {
      if (r.status === "error") console.error(`${name} lookup failed for ${address}: ${r.detail}`);
    }

    return new Response(
      JSON.stringify({
        attom: attom.data,
        regrid: regrid.data,
        attomComps: comps.data,
        status: { attom: attom.status, regrid: regrid.status, attomComps: comps.status },
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
