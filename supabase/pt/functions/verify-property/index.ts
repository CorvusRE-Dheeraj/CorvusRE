// Deploy via CLI: `supabase functions deploy verify-property`.
// Requires GEMINI_API_KEY (shared with the other AI functions).
//
// Checks a property — and, when given, a document uploaded for it — against
// the county (CAD) record, and inspects the document for AI-generation or
// editing. The ONLY writer of properties.verification_* and
// documents.verification_* (see supabase/pt/property-verification.sql): the
// database resets a property to 'pending' on insert and on any client edit
// of what was checked, and holds filing until this marks it verified (or
// staff approve it). Logic and wording: _shared/property-verification.ts.
//
//   POST { propertyId, documentId? }  the owner, staff, or the service role
//   POST { sweep: true }              service role: check every pending property
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { requireUser } from "../_shared/require-user.ts";
import { rateLimitUser } from "../_shared/rate-limit.ts";
import { isServiceRoleRequest } from "../_shared/service-role-only.ts";
import {
  compareToCounty,
  decide,
  fileSignals,
  GENERATED_DOCUMENT_TYPES,
  type CadFacts,
  type VerificationFlag,
} from "../_shared/property-verification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

type Admin = SupabaseClient;
type PropertyRow = {
  id: string;
  user_id: string;
  address: string | null;
  cad: string | null;
  account_number: string | null;
  owner_name: string | null;
  land_value: number | null;
  improvement_value: number | null;
  total_value: number | null;
  tax_year: number | null;
  verification_status: string;
  verification_reviewed_at: string | null;
};

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
};

const EXAMINER = `You examine documents uploaded to a Texas property tax service. People may upload AI-generated or edited documents to pass as real county documents. Read the document and return ONLY JSON:
{"documentKind":"appraisal_notice"|"tax_bill"|"bpp_notice"|"hearing_notice"|"arb_order"|"settlement"|"other_county"|"not_county",
 "county":string|null,"ownerName":string|null,"propertyAddress":string|null,"accountNumber":string|null,"taxYear":number|null,
 "landValue":number|null,"improvementValue":number|null,"marketValue":number|null,"appraisedValue":number|null,
 "aiGeneratedLikely":boolean,"concerns":string[]}
Fields: copy exactly what is printed (numbers without $ or commas); null when not shown. Never invent a value.
concerns: only concrete things you can see, each one short plain sentence — fonts or sizes that differ inside the value fields, numbers that look pasted in or misaligned, blurred or patched areas, garbled AI-style text or logos, generic placeholder wording, missing elements every real Texas appraisal district notice has (the district's name and address, the account number, the protest deadline, how to protest to the ARB), dates that contradict each other. A normal genuine document has an empty list. Do not guess or speculate.
aiGeneratedLikely: true only when the page itself strongly looks AI-generated or fabricated.`;

async function countyRecord(supabaseUrl: string, serviceKey: string, p: PropertyRow) {
  const body =
    p.cad && p.account_number ? { cad: p.cad, accountNumber: p.account_number } : { address: p.address };
  const res = await fetch(`${supabaseUrl}/functions/v1/cad-lookup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return (j?.record ?? null) as CadFacts | null;
}

async function examine(bytes: Uint8Array, mimeType: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXAMINER }] },
      contents: [{ role: "user", parts: [{ text: "Examine this document." }, { inline_data: { mime_type: mimeType, data: btoa(bin) } }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const out = await res.json();
  const raw = out?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

// deno-lint-ignore no-explicit-any
const num = (v: any): number | null => (typeof v === "number" && isFinite(v) ? v : null);

async function checkDocument(
  admin: Admin,
  doc: { id: string; file_name: string; storage_path: string; document_type: string | null; edited_from: string | null },
  cad: CadFacts | null,
): Promise<{ status: "not_required" | "checked"; flags: VerificationFlag[] }> {
  if ((doc.document_type && GENERATED_DOCUMENT_TYPES.has(doc.document_type)) || doc.edited_from) {
    return { status: "not_required", flags: [] };
  }
  const flags: VerificationFlag[] = [];
  const { data: blob, error } = await admin.storage.from("documents").download(doc.storage_path);
  if (error || !blob) {
    return {
      status: "checked",
      flags: [{ code: "file_unreadable", source: "file", severity: "medium", message: "The file couldn't be opened to check it." }],
    };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = doc.file_name.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext] ?? blob.type ?? "application/octet-stream";
  flags.push(...fileSignals(bytes, mime));

  if (!Object.values(MIME_BY_EXT).includes(mime) || bytes.length > 15_000_000) return { status: "checked", flags };
  let read;
  try {
    read = await examine(bytes, mime);
  } catch (err) {
    console.error("verify-property: AI read failed", err);
    flags.push({ code: "ai_unavailable", source: "ai", severity: "medium", message: "Corvus AI couldn't read the document — it needs a person to check it." });
    return { status: "checked", flags };
  }
  if (read.aiGeneratedLikely === true) {
    flags.push({ code: "ai_looks_generated", source: "ai", severity: "high", message: "Corvus AI thinks this document looks AI-generated or fabricated." });
  }
  for (const c of Array.isArray(read.concerns) ? read.concerns.slice(0, 6) : []) {
    if (typeof c === "string" && c.trim()) flags.push({ code: "ai_concern", source: "ai", severity: "medium", message: c.trim() });
  }

  const kind = String(read.documentKind ?? "not_county");
  if (kind !== "not_county") {
    if (!cad) {
      flags.push({ code: "county_unavailable", source: "county", severity: "medium", message: "The county record couldn't be reached to compare this document with." });
    } else {
      const identity = {
        ownerName: read.ownerName ?? null,
        address: read.propertyAddress ?? null,
        accountNumber: read.accountNumber != null ? String(read.accountNumber) : null,
      };
      const isNotice = kind === "appraisal_notice";
      flags.push(
        ...compareToCounty(
          "The document",
          isNotice
            ? {
                ...identity,
                taxYear: num(read.taxYear),
                landValue: num(read.landValue),
                improvementValue: num(read.improvementValue),
                totalValue: num(read.marketValue) ?? num(read.appraisedValue),
                appraisedValue: num(read.appraisedValue),
              }
            : identity,
          cad,
          { requireAll: isNotice, checkSums: isNotice },
        ),
      );
    }
  }
  return { status: "checked", flags };
}

async function verifyOne(admin: Admin, propertyId: string, documentId: string | null) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const { data: prop, error } = await admin
    .from("properties")
    .select("id, user_id, address, cad, account_number, owner_name, land_value, improvement_value, total_value, tax_year, verification_status, verification_reviewed_at")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw error;
  if (!prop) return null;
  const p = prop as PropertyRow;

  const { data: owner } = await admin.from("profiles").select("is_admin").eq("id", p.user_id).maybeSingle();
  const ownerIsAdmin = owner?.is_admin === true;

  // A staff decision stands until the property changes (the database clears
  // it on any edit) — unless a new document arrives.
  const staffDecided = p.verification_reviewed_at && ["verified", "rejected"].includes(p.verification_status);
  if (staffDecided && !documentId) return { status: p.verification_status, flags: [] };

  const cad = await countyRecord(supabaseUrl, serviceKey, p);
  const flags: VerificationFlag[] = [];
  if (!cad) {
    flags.push({ code: "county_unavailable", source: "county", severity: "medium", message: "The county record couldn't be found to check this property against." });
  } else if (!staffDecided) {
    flags.push(
      ...compareToCounty(
        "The saved property",
        {
          ownerName: p.owner_name,
          address: p.address,
          accountNumber: p.account_number,
          taxYear: p.tax_year,
          landValue: p.land_value,
          improvementValue: p.improvement_value,
          totalValue: p.total_value,
        },
        cad,
        { yearFallback: true },
      ),
    );
  }

  let document: { id: string; status: string; flags: VerificationFlag[] } | null = null;
  if (documentId) {
    const { data: doc } = await admin
      .from("documents")
      .select("id, property_id, file_name, storage_path, document_type, edited_from")
      .eq("id", documentId)
      .maybeSingle();
    if (doc && doc.property_id === p.id) {
      const res = await checkDocument(admin, doc, cad);
      const status = res.status === "not_required" ? "not_required" : decide(res.flags, ownerIsAdmin);
      await admin
        .from("documents")
        .update({ verification_status: status, verification_flags: res.flags, verification_checked_at: new Date().toISOString() })
        .eq("id", doc.id);
      document = { id: doc.id, status, flags: res.flags };
      if (status !== "not_required") flags.push(...res.flags);
    }
  }

  // Another of the property's documents still under review keeps it held.
  const { data: held } = await admin
    .from("documents")
    .select("id")
    .eq("property_id", p.id)
    .is("deleted_at", null)
    .in("verification_status", ["needs_review", "rejected"])
    .neq("id", documentId ?? "00000000-0000-0000-0000-000000000000")
    .limit(1);
  if (held?.length) {
    flags.push({ code: "document_under_review", source: "file", severity: "medium", message: "Another document for this property is waiting for review." });
  }

  const status = staffDecided && flags.length === 0 ? p.verification_status : decide(flags, ownerIsAdmin);
  const { error: upErr } = await admin
    .from("properties")
    .update({
      verification_status: status,
      verification_flags: flags,
      verification_checked_at: new Date().toISOString(),
      ...(status === "needs_review" ? { verification_reviewed_by: null, verification_reviewed_at: null } : {}),
    })
    .eq("id", p.id);
  if (upErr) throw upErr;
  return { status, flags, document };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "A JSON body is required." }, 400);

    if (isServiceRoleRequest(req)) {
      if (body.sweep === true) {
        const { data: pending } = await admin
          .from("properties")
          .select("id")
          .eq("verification_status", "pending")
          .order("created_at", { ascending: true })
          .limit(25);
        const results: Record<string, string> = {};
        for (const row of pending ?? []) {
          try {
            results[row.id] = (await verifyOne(admin, row.id, null))?.status ?? "missing";
          } catch (err) {
            results[row.id] = `error: ${err instanceof Error ? err.message : err}`;
          }
        }
        return json({ checked: Object.keys(results).length, results });
      }
    } else {
      const who = await requireUser(req, corsHeaders);
      if (who instanceof Response) return who;
      const limited = await rateLimitUser(who.id, "verify-property", 60, corsHeaders);
      if (limited) return limited;
      const { data: prop } = await admin.from("properties").select("user_id").eq("id", body.propertyId ?? "").maybeSingle();
      if (!prop) return json({ error: "Property not found." }, 404);
      if (prop.user_id !== who.id) {
        const { data: me } = await admin.from("profiles").select("is_admin, operations_admin").eq("id", who.id).maybeSingle();
        if (!me?.is_admin && !me?.operations_admin) return json({ error: "not authorized" }, 403);
      }
    }

    if (typeof body.propertyId !== "string") return json({ error: "propertyId is required." }, 400);
    const result = await verifyOne(admin, body.propertyId, typeof body.documentId === "string" ? body.documentId : null);
    if (!result) return json({ error: "Property not found." }, 404);
    return json(result);
  } catch (err) {
    console.error("verify-property failed", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
