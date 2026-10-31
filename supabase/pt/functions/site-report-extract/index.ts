// Deploy via CLI: `supabase functions deploy site-report-extract`.
// Requires the GEMINI_API_KEY secret (shared with the other AI functions).
//
// Land Condition (Module 4) "Upload Inspection Report": reads a whole uploaded
// report — inspection, survey / plat, FEMA flood determination, drainage,
// environmental, utility, traffic, geotechnical — text, tables, maps and
// figures, and maps what it says to the module's land factors, each finding
// with the page it came from. Findings are written as 'suggested'
// (public.site_report_findings, see site-reports.sql): the owner confirms,
// edits or rejects each one before it counts. Anything unclear or unreadable
// is flagged instead of guessed, and a finding that differs from a fetched
// record (FEMA flood zone, USGS elevation, CAD acreage) carries the
// difference rather than replacing it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_REASONING, geminiUrl } from "../_shared/gemini.ts";
import { requireUser } from "../_shared/require-user.ts";
import { rateLimitUser } from "../_shared/rate-limit.ts";
import { PROSE_STYLE } from "../_shared/prose-style.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// The module's own factors (MODULE_SPECS.site) plus the categories reports
// commonly cover that the factor list doesn't.
export const SITE_FACTORS = [
  "Floodplain",
  "Easements",
  "Drainage",
  "Sewer",
  "Water Availability",
  "Buildability",
  "Ponds",
  "Streams",
  "Road Frontage",
  "Visibility",
  "Traffic Counts / VPD",
  "Grade",
  "Topography",
  "Access Limitations",
  "Highway Proximity",
  "Railroad Proximity",
] as const;
export const EXTRA_CATEGORIES = [
  "Environmental",
  "Soil / Geotechnical",
  "Utilities (electric, gas, telecom)",
  "Parcel Size & Boundaries",
  "Other",
] as const;
const ALL = [...SITE_FACTORS, ...EXTRA_CATEGORIES] as readonly string[];

const MAX_BYTES = 18 * 1024 * 1024; // Gemini inline request limit, with headroom

const SYSTEM = `You read a property's site / land documentation for a Texas commercial property tax protest: inspection reports, land surveys and plats, FEMA flood maps and determinations, topographic surveys, drainage studies, environmental assessments (Phase I/II), utility reports, traffic studies, geotechnical / soil reports — often several of these inside one long PDF.

Read EVERY page: running text, tables, map legends and title blocks, survey notes, figure captions, embedded reports. Extract each concrete fact about the land and map it to exactly one category:
${ALL.map((c) => `- ${c}`).join("\n")}

Mapping guide (examples, not a fixed list): FEMA map / flood determination → Floodplain (zone, panel number, effective date, base flood elevation, % of parcel in the floodplain). Topographic survey → Topography / Grade (elevations, contours, slope). Survey / plat → Easements (type, width, location), Road Frontage (feet of frontage, which road), Access Limitations (access points, curb cuts, restrictions), Parcel Size & Boundaries (acreage, dimensions). Drainage report → Drainage (runoff, detention, limitations). Environmental → Environmental (wetlands, contamination, recognized environmental conditions, restrictions), Ponds / Streams where water features are named. Utility report → Sewer, Water Availability, Utilities (electric, gas, telecom). Traffic study → Traffic Counts / VPD (counts with year and road), Highway Proximity, Visibility. Geotechnical → Soil / Geotechnical (soil types, bearing capacity, expansive clay, fill), Buildability.

Rules:
- Only what the document actually states. Never infer, estimate or fill a value the document doesn't give. If a page, figure or table is illegible, cut off or ambiguous, say so in "unreadable" or set needsReview on the finding — never guess.
- finding: one plain sentence with the fact and its numbers, e.g. "Zone AE covers about 30% of the parcel along the east line (FIRM panel 48397C0045L, effective 9/26/2008)."
- details: the individual values as name/value pairs (e.g. {"name":"Flood zone","value":"AE"}). Copy numbers and units exactly.
- page: the PDF page number (1-based) where it appears, or null if not determinable. For images, null.
- sourceType: what kind of document section it came from (e.g. "FEMA flood map", "ALTA survey", "Phase I ESA", "Traffic study").
- confidence: High when clearly stated, Moderate when stated but partly qualified, Low when faint or indirect.
- needsReview: null, or a short reason the owner should check it (unclear scan, conflicting statements within the document, value read from a map).
- conflict: compare with the property's fetched records listed below. If the document states something different (another flood zone, different acreage, different elevation), describe the difference in one sentence; otherwise null. Never decide which is right.
- matchesRecord: true when the finding simply restates a fetched record (same flood zone, same acreage).
- Skip facts already listed under "Already recorded" unless the document adds something new.
- Don't repeat the same fact twice; combine.
- Also return the document's title, its type, its date (as written), the number of pages read, a 1-2 sentence summary, and "unreadable" (pages or parts that couldn't be read, or null).

Return ONLY JSON: {"title":"...","reportType":"...","reportDate":"...|null","pages":<number|null>,"summary":"...","unreadable":"...|null","findings":[{"category":"<one of the categories>","label":"<short label>","finding":"...","details":[{"name":"...","value":"..."}],"page":<number|null>,"sourceType":"...","confidence":"High|Moderate|Low","needsReview":"...|null","conflict":"...|null","matchesRecord":false}]}

${PROSE_STYLE}`;

function normalizeKey(category: string, finding: string): string {
  return `${category.toLowerCase()}|${finding.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 240)}`;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const who = await requireUser(req, corsHeaders);
  if (who instanceof Response) return who;
  const limited = await rateLimitUser(who.id, "site-report-extract", 15, corsHeaders);
  if (limited) return limited;

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  let reportId: string | null = null;
  const fail = async (message: string, status = 400) => {
    if (reportId) {
      await admin.from("site_reports").update({ status: "failed", error: message }).eq("id", reportId);
    }
    return json({ error: message }, status);
  };

  try {
    const body = await req.json();
    reportId = typeof body.reportId === "string" ? body.reportId : null;
    if (!reportId) return json({ error: "reportId is required." }, 400);

    // Read the report row AS THE CALLER — row-level security decides whether
    // they may see it (owner or a member of the owner's account).
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: report } = await userClient
      .from("site_reports")
      .select("id, property_id, document_id, file_name")
      .eq("id", reportId)
      .maybeSingle();
    if (!report?.document_id) {
      reportId = null;
      return json({ error: "Report not found." }, 404);
    }
    const { data: doc } = await admin
      .from("documents")
      .select("storage_path, file_name, property_id")
      .eq("id", report.document_id)
      .maybeSingle();
    if (!doc || doc.property_id !== report.property_id) return await fail("The uploaded file wasn't found.");

    const { data: file, error: dlErr } = await admin.storage.from("documents").download(doc.storage_path);
    if (dlErr || !file) return await fail("Couldn't open the uploaded file.");
    if (file.size > MAX_BYTES) {
      return await fail(
        "This file is larger than 18 MB — split the report into smaller PDFs (e.g. by section) and upload them separately.",
      );
    }
    const name = String(doc.file_name ?? "").toLowerCase();
    const mime =
      file.type && file.type !== "application/octet-stream"
        ? file.type
        : name.endsWith(".pdf")
          ? "application/pdf"
          : /\.(jpe?g)$/.test(name)
            ? "image/jpeg"
            : name.endsWith(".png")
              ? "image/png"
              : name.endsWith(".webp")
                ? "image/webp"
                : "";
    if (!/^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/.test(mime)) {
      return await fail("Only PDF reports and images (JPG, PNG, WebP, HEIC) can be read.");
    }

    const { data: existing } = await admin
      .from("site_report_findings")
      .select("factor, finding, status")
      .eq("property_id", report.property_id)
      .neq("status", "rejected")
      .limit(60);

    const facts = (body.facts ?? {}) as Record<string, unknown>;
    const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
    const factLines = [
      facts.address ? `Address: ${clip(facts.address, 200)}` : null,
      facts.cad ? `Appraisal district: ${clip(facts.cad, 120)}` : null,
      facts.floodZone ? `FEMA flood zone (fetched from FEMA NFHL): ${clip(facts.floodZone, 120)}` : null,
      typeof facts.elevationFt === "number" ? `USGS ground elevation at one point: ${Math.round(facts.elevationFt)} ft` : null,
      typeof facts.acres === "number" ? `County record acreage: ${facts.acres} acres` : null,
      typeof facts.nearestHighwayMi === "number" ? `Nearest highway (OpenStreetMap): ${facts.nearestHighwayMi} mi` : null,
      typeof facts.nearestRailMi === "number" ? `Nearest railroad (OpenStreetMap): ${facts.nearestRailMi} mi` : null,
    ].filter(Boolean);
    const already = (existing ?? []).map((f) => `- ${f.factor}: ${String(f.finding).slice(0, 200)}`);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await fetch(geminiUrl(GEMINI_MODEL_REASONING, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `Fetched records for this property:\n${factLines.join("\n") || "(none)"}\n\n` +
                  `Already recorded from earlier documents:\n${already.join("\n") || "(none)"}\n\n` +
                  `Document file name: ${doc.file_name}\nRead the whole document and produce the JSON.`,
              },
              { inline_data: { mime_type: mime, data: toBase64(bytes) } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
          thinkingConfig: { thinkingBudget: 2048 },
        },
      }),
      signal: AbortSignal.timeout(140_000),
    }).catch((e) => {
      if (e instanceof DOMException && e.name === "TimeoutError") return null;
      throw e;
    });
    if (!res) return await fail("Reading the report took too long — try a smaller section of it.", 504);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) return await fail("AI is busy right now. Please try again in a moment.", 429);
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const out = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };
    const raw =
      out.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
      .slice(0, 80)
      .map((f: Record<string, unknown>) => {
        const category = ALL.includes(String(f?.category)) ? String(f.category) : "Other";
        const finding = str(f?.finding, 600);
        if (!finding) return null;
        const details = (Array.isArray(f?.details) ? f.details : [])
          .slice(0, 12)
          .map((x: Record<string, unknown>) => ({ name: str(x?.name, 60), value: str(x?.value, 160) }))
          .filter((x: { name: string | null; value: string | null }) => x.name && x.value);
        const page = Number(f?.page);
        return {
          factor: category,
          label: str(f?.label, 80),
          finding,
          details,
          page: Number.isInteger(page) && page > 0 && page < 5000 ? page : null,
          source_type: str(f?.sourceType, 80),
          confidence: ["High", "Moderate", "Low"].includes(String(f?.confidence)) ? String(f.confidence) : "Moderate",
          needs_review: str(f?.needsReview, 300),
          conflict: str(f?.conflict, 400),
          matches_record: f?.matchesRecord === true,
        };
      })
      .filter((f): f is NonNullable<typeof f> => !!f);

    // one row per distinct fact for the property; a repeat from another
    // report is skipped by the unique content key
    const rows = await Promise.all(
      findings.map(async (f) => ({
        ...f,
        property_id: report.property_id,
        report_id: report.id,
        content_key: await sha256Hex(normalizeKey(f.factor, f.finding)),
      })),
    );
    const unique = [...new Map(rows.map((r) => [r.content_key, r])).values()];
    let inserted = 0;
    if (unique.length > 0) {
      const { data: ins, error: insErr } = await admin
        .from("site_report_findings")
        .upsert(unique, { onConflict: "property_id,content_key", ignoreDuplicates: true })
        .select("id");
      if (insErr) throw insErr;
      inserted = ins?.length ?? 0;
    }
    const pages = Number(parsed.pages);
    await admin
      .from("site_reports")
      .update({
        status: "read",
        error: null,
        title: str(parsed.title, 200),
        report_type: str(parsed.reportType, 120),
        report_date: str(parsed.reportDate, 60),
        pages: Number.isInteger(pages) && pages > 0 ? pages : null,
        summary: str(parsed.summary, 600),
        unreadable: str(parsed.unreadable, 600),
        read_at: new Date().toISOString(),
      })
      .eq("id", report.id);

    return json({ found: findings.length, added: inserted, duplicates: findings.length - inserted });
  } catch (err) {
    return await fail(err instanceof Error ? err.message : "Couldn't read this report.", 500);
  }
});
