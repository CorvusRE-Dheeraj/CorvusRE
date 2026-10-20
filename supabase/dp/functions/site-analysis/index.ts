// Deploy: verify_jwt on. No keys needed — public federal data only.
//
// POST { projectId } or { designRequestId } → the raw site data behind the
// Site Data page's grading, floodplain and access analyses, for the owner's
// project address:
//   • US Census geocoder → the point
//   • FEMA National Flood Hazard Layer → flood zone at the point and within
//     150 m, and the FIRM panel
//   • USGS 3DEP elevation (EPQS) → a 3×3 grid of ground elevations across a
//     square the size of the lot
//   • Census TIGERweb → roads within ~120 m with their class (interstate /
//     US & state highway / local) and distance + direction from the point
// Saved on the row (site_analysis) so the page doesn't refetch on every
// visit; the app interprets it (apps/dp/src/lib/site-analysis.ts). Each source
// fails on its own — the others still come back.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { rateLimit } from "../_shared/rate-limit.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// public servers occasionally drop a connection — one retry
async function getJson<T>(url: string, ms = 12_000): Promise<T> {
  try {
    return await getJsonOnce<T>(url, ms);
  } catch {
    await new Promise((r) => setTimeout(r, 600));
    return getJsonOnce<T>(url, ms);
  }
}
async function getJsonOnce<T>(url: string, ms: number): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { "User-Agent": "CorvusDP site analysis (corvusre.com)" } });
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    throw new Error((e as Error).name === "AbortError" ? `${new URL(url).host} timed out` : (e as Error).message);
  } finally {
    clearTimeout(t);
  }
}

/** "2 acres", "12,000 sf" → square feet (same rules as the app's parseArea). */
function lotSqft(s: string | null): number | null {
  if (!s) return null;
  const m = s.toLowerCase().replace(/,/g, "").match(/([\d.]+)\s*(ac|acre|acres|sf|sq\s?ft|sqft|square feet)?/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  return /ac/.test(m[2] ?? "") ? v * 43560 : v;
}

const FEET_PER_DEG_LAT = 364_000;
const toRad = (d: number) => (d * Math.PI) / 180;

type Pt = { x: number; y: number };
/** distance in metres from p to segment ab (lon/lat, small-area equirectangular) */
function segDist(p: Pt, a: Pt, b: Pt): { m: number; at: Pt } {
  const k = Math.cos(toRad(p.y));
  const ax = (a.x - p.x) * k, ay = a.y - p.y, bx = (b.x - p.x) * k, by = b.y - p.y;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const cx = ax + t * dx, cy = ay + t * dy;
  return { m: Math.hypot(cx, cy) * 111_320, at: { x: p.x + cx / k, y: p.y + cy } };
}

const ROAD_LAYERS = [
  { id: 2, kind: "primary" }, // interstates & primary highways
  { id: 6, kind: "secondary" }, // US / state highways, main arterials
  { id: 8, kind: "local" },
] as const;

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  const limited = await rateLimit(req, "site-analysis", 30, corsHeaders);
  if (limited) return limited;
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: "Sign in first." }, 401);
    const body = (await req.json().catch(() => ({}))) as { projectId?: string; designRequestId?: string };
    const table = body.projectId ? "projects" : body.designRequestId ? "design_requests" : null;
    const id = body.projectId ?? body.designRequestId;
    if (!table || !id) return json({ error: "projectId or designRequestId is required" }, 400);
    const { data: row } = await admin
      .from(table)
      .select(table === "projects" ? "id, user_id, address, city, state, lot_size" : "id, user_id, address, city, site_area")
      .eq("id", id)
      .maybeSingle();
    const r = row as Record<string, string | null> | null;
    if (!r || r.user_id !== who.user.id) return json({ error: "Not found." }, 404);
    const address = [r.address, r.address?.match(/\d{5}/) ? null : r.city, r.address?.match(/\bTX\b/i) ? null : (r.state ?? "TX")]
      .filter(Boolean)
      .join(", ");
    if (!r.address) return json({ error: "Add the property address first." }, 400);

    // 1 — the point
    type Geo = { result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number } }[] } };
    const g = await getJson<Geo>(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`,
    );
    const m = g.result?.addressMatches?.[0];
    if (!m) return json({ error: "Couldn't find that address on the map — check the street address." }, 422);
    const p = { x: m.coordinates.x, y: m.coordinates.y };
    const errors: Record<string, string> = {};

    // 2 — floodplain
    const nfhl = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
    const at = `geometry=${p.x},${p.y}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&f=json`;
    type Feats = { features?: { attributes: Record<string, unknown> }[]; error?: { message?: string } };
    const zone = (f: { attributes: Record<string, unknown> }) => ({
      zone: String(f.attributes.FLD_ZONE ?? ""),
      subtype: (f.attributes.ZONE_SUBTY as string) ?? null,
      sfha: f.attributes.SFHA_TF === "T",
      bfe: typeof f.attributes.STATIC_BFE === "number" && (f.attributes.STATIC_BFE as number) > -9000 ? (f.attributes.STATIC_BFE as number) : null,
    });
    // FEMA resets parallel requests from one host — ask one at a time; "nearby" and the
    // panel are extras, so their failure never loses the zone at the site itself
    const floodP = (async () => {
      const a = await getJson<Feats>(`${nfhl}/28/query?${at}&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE`);
      const n = await getJson<Feats>(
        `${nfhl}/28/query?${at}&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE&distance=150&units=esriSRUnit_Meter`,
      ).catch(() => ({ features: undefined }) as Feats);
      const pan = await getJson<Feats>(`${nfhl}/3/query?${at}&outFields=FIRM_PAN,EFF_DATE`).catch(() => ({}) as Feats);
      return [a, n, pan] as const;
    })().then(([a, n, pan]) => {
      if (a.error) throw new Error(a.error.message ?? "FEMA error");
      const panels = (pan.features ?? []).map((f) => ({
        number: String(f.attributes.FIRM_PAN ?? ""),
        effective: typeof f.attributes.EFF_DATE === "number" ? new Date(f.attributes.EFF_DATE as number).toISOString().slice(0, 10) : null,
      }));
      return {
        atPoint: (a.features ?? []).map(zone),
        nearby: n.features ? n.features.map(zone) : null,
        panel: panels.sort((x, y) => (y.effective ?? "").localeCompare(x.effective ?? ""))[0] ?? null,
      };
    });

    // 3 — ground elevations: a 3×3 grid across a square the size of the lot
    const area = lotSqft(r.lot_size ?? r.site_area) ?? 43_560;
    const sideFt = Math.min(2_000, Math.max(80, Math.sqrt(area)));
    const step = sideFt / 2;
    const offsets = [-1, 0, 1].flatMap((j) => [-1, 0, 1].map((i) => ({ dx: i * step, dy: j * step })));
    type Epqs = { value?: number | string };
    // USGS slows right down under parallel load: 3 at a time, and a few missing points are fine
    const elevP = (async () => {
      const pts: { dx: number; dy: number; ft: number }[] = [];
      for (let i = 0; i < offsets.length; i += 3) {
        const batch = await Promise.allSettled(
          offsets.slice(i, i + 3).map((o) =>
            getJson<Epqs>(
              `https://epqs.nationalmap.gov/v1/json?x=${p.x + o.dx / (FEET_PER_DEG_LAT * Math.cos(toRad(p.y)))}&y=${p.y + o.dy / FEET_PER_DEG_LAT}&units=Feet&wkid=4326&includeDate=false`,
              20_000,
            ).then((e) => ({ ...o, ft: Number(e.value) })),
          ),
        );
        for (const b of batch) if (b.status === "fulfilled") pts.push(b.value);
      }
      return pts;
    })().then((pts) => {
      const ok = pts.filter((q) => Number.isFinite(q.ft) && q.ft > -1000);
      if (ok.length < 5) throw new Error("USGS elevation service returned too few points");
      return { sideFt: Math.round(sideFt), assumedLot: !lotSqft(r.lot_size ?? r.site_area), points: ok.map((q) => ({ ...q, ft: Math.round(q.ft * 10) / 10 })) };
    });

    // 4 — roads near the site
    type Lines = { features?: { attributes: Record<string, unknown>; geometry?: { paths?: number[][][] } }[] };
    const tiger = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer";
    const roadsP = Promise.all(
      ROAD_LAYERS.map((l) =>
        getJson<Lines>(
          `${tiger}/${l.id}/query?geometry=${p.x},${p.y}&geometryType=esriGeometryPoint&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&distance=120&units=esriSRUnit_Meter&outFields=NAME,MTFCC&returnGeometry=true&f=json`,
        ).then((res) => ({ l, res })),
      ),
    ).then((sets) => {
      const best = new Map<string, { name: string; mtfcc: string; layer: string; distanceM: number; bearingDeg: number }>();
      for (const { l, res } of sets)
        for (const f of res.features ?? []) {
          // walkways, stairs, private service drives, parking-lot aisles, bike/bridle paths aren't access roads
          if (["S1710", "S1720", "S1740", "S1750", "S1780", "S1820", "S1830"].includes(String(f.attributes.MTFCC)))
            continue;
          const name = String(f.attributes.NAME ?? "").trim() || "Unnamed road";
          let d = { m: Infinity, at: p };
          for (const path of f.geometry?.paths ?? [])
            for (let i = 1; i < path.length; i++) {
              const s = segDist(p, { x: path[i - 1][0], y: path[i - 1][1] }, { x: path[i][0], y: path[i][1] });
              if (s.m < d.m) d = s;
            }
          if (!Number.isFinite(d.m)) continue;
          const bearing = (Math.atan2((d.at.x - p.x) * Math.cos(toRad(p.y)), d.at.y - p.y) * 180) / Math.PI;
          const key = name.toLowerCase();
          const cur = best.get(key);
          if (!cur || d.m < cur.distanceM)
            best.set(key, {
              name,
              mtfcc: String(f.attributes.MTFCC ?? ""),
              layer: l.kind,
              distanceM: Math.round(d.m * 10) / 10,
              bearingDeg: Math.round((bearing + 360) % 360),
            });
        }
      // the same pavement often carries two names (Preston Rd = State Hwy 289): one entry, with aliases
      const street = (r.address ?? "").toLowerCase();
      const all = [...best.values()].sort((a, b) => a.distanceM - b.distanceM);
      const merged: (typeof all[number] & { aliases: string[] })[] = [];
      const rank = (x: { mtfcc: string }) => (x.mtfcc === "S1100" ? 0 : x.mtfcc === "S1200" ? 1 : 2);
      for (const x of all) {
        const same = merged.find(
          (m) => Math.abs(m.distanceM - x.distanceM) < 1.5 && Math.abs(((m.bearingDeg - x.bearingDeg + 540) % 360) - 180) < 12,
        );
        if (!same) {
          merged.push({ ...x, aliases: [] });
          continue;
        }
        same.aliases.push(x.name);
        // the highest road class wins; the name in the address is the main name
        if (rank(x) < rank(same)) Object.assign(same, { mtfcc: x.mtfcc, layer: x.layer });
        const base = (n: string) => n.toLowerCase().replace(/\b(n|s|e|w|north|south|east|west)\b\.?/g, "").trim();
        if (!street.includes(base(same.name)) && street.includes(base(x.name))) {
          same.aliases = [same.name, ...same.aliases.filter((a) => a !== x.name)];
          same.name = x.name;
        }
      }
      return merged.slice(0, 8);
    });

    const [flood, elevation, roads] = await Promise.all([
      floodP.catch((e) => ((errors.flood = String(e.message ?? e)), null)),
      elevP.catch((e) => ((errors.elevation = String(e.message ?? e)), null)),
      roadsP.catch((e) => ((errors.roads = String(e.message ?? e)), null)),
    ]);
    const analysis = {
      fetchedAt: new Date().toISOString(),
      address,
      geocode: { x: p.x, y: p.y, matched: m.matchedAddress },
      flood,
      elevation,
      roads,
      errors,
    };
    await admin.from(table).update({ site_analysis: analysis }).eq("id", id);
    return json({ analysis });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Site analysis failed." }, 502);
  }
});
