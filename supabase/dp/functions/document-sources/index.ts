// Connected document collection for the Documents page.
//
//   POST (x-relay-secret)      action "inbound": an email sent to a project's
//                              inbox (dp-<token>@inbox.corvusre.com), relayed
//                              by PT's county-mail-inbound (which owns the
//                              Resend inbound webhook). Each attachment is
//                              stored, checked for duplicates (content hash),
//                              matched by Corvus AI to a permit / requirement /
//                              document, and queued in document_imports — or
//                              filed as a Received working draft when the
//                              source auto-files exact matches. A message with
//                              only a link (a portal notification) is recorded
//                              as "link only": no file was collected.
//   POST (user JWT)            action "sync": re-check a source — re-run the
//                              matching on files still waiting for review.
//
// Deploy: verify_jwt OFF (the relay has no user token); user calls are checked
// here. Requires GEMINI_API_KEY and DP_RELAY_SECRET.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callGemini, parseJsonLoose } from "../_shared/gemini.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { logAiCall } from "../_shared/ai-log.ts";
import {
  DISCIPLINES,
  DOC_KINDS,
  domainMatches,
  extractLinks,
  inboxToken,
  permitNumberHit,
  sanitizeSuggestion,
  senderDomain,
  type MatchContext,
  type Suggestion,
} from "../_shared/document-match.ts";

const MAX_BYTES = 25 * 1024 * 1024;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

type Attachment = {
  filename: string;
  content_type?: string;
  size?: number;
  download_url?: string;
  content_base64?: string;
};
type InboundEmail = {
  message_id: string;
  to: string[];
  from: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  created_at?: string | null;
  attachments?: Attachment[];
};
type Source = {
  id: string;
  project_id: string;
  type: string;
  name: string;
  match_domains: string[];
  permit_ids: string[];
  auto_file: boolean;
  status: string;
};

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
const htmlToText = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function context(admin: SupabaseClient, projectId: string): Promise<MatchContext> {
  const [permits, reqs, docs, subs] = await Promise.all([
    admin.from("project_permits").select("id, name, permit_number, permit_key").eq("project_id", projectId),
    admin.from("project_checklist_items").select("id, permit_key, label").eq("project_id", projectId)
      .eq("kind", "submission"),
    admin.from("project_documents").select("id, doc_group, name").eq("project_id", projectId),
    admin.from("permit_submissions").select("id, permit_id, round").eq("project_id", projectId),
  ]);
  const ps = (permits.data ?? []) as MatchContext["permits"];
  const byKey = new Map(ps.map((p) => [p.permit_key, p.id]));
  const groups = new Map<string, string>();
  for (const d of docs.data ?? []) groups.set((d.doc_group as string) ?? (d.id as string), d.name as string);
  return {
    permits: ps,
    requirements: (reqs.data ?? [])
      .filter((r) => byKey.has(r.permit_key as string))
      .map((r) => ({ id: r.id as string, permit_id: byKey.get(r.permit_key as string)!, label: r.label as string })),
    groups: [...groups].map(([id, title]) => ({ id, title })),
    submissions: (subs.data ?? []) as MatchContext["submissions"],
  };
}

const SYSTEM = `You file documents for a commercial construction permitting project. For each file received by email, suggest where it belongs.
Return ONLY JSON: {"files":[{"index":0,"permit_id":"<id or null>","requirement_id":"<id or null>","doc_group":"<existing document id when this is a new revision of it, else null>","title":"...","doc_kind":"one of ${DOC_KINDS.join(" | ")}","discipline":"one of ${DISCIPLINES.join(" | ")}","revision":"e.g. R3, or null","destination":"draft|library|support","submission_round":<number or null>,"confidence":0-1,"match_summary":"short","reason":"one or two sentences","round_evidence":"what in the email ties it to a round, or 'none'"}]}
Rules:
- Use only ids from the lists given. If the permit isn't clear from the email, use null and a low confidence — never guess.
- "draft" = a new drawing/document for the permit's next package; "support" = a city letter, receipt or record about an EXISTING submission round (give submission_round only when the email states it); "library" = anything else or unclear.
- Never treat a file as submitted or approved. Never infer a round from dates or file names alone.`;

async function match(
  admin: SupabaseClient,
  projectId: string,
  ctx: MatchContext,
  email: { subject: string; from: string; text: string },
  files: { filename: string; size: number }[],
): Promise<Suggestion[]> {
  const exact = permitNumberHit(
    ctx.permits,
    `${email.subject} ${email.text} ${files.map((f) => f.filename).join(" ")}`,
  );
  let raw: Record<string, unknown> = {};
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (apiKey && files.length) {
    const prompt = [
      `Permits: ${JSON.stringify(ctx.permits.map((p) => ({ id: p.id, name: p.name, number: p.permit_number })))}`,
      `Open requirements: ${JSON.stringify(ctx.requirements.map((r) => ({ id: r.id, permit_id: r.permit_id, label: r.label })))}`,
      `Existing documents: ${JSON.stringify(ctx.groups.slice(0, 80))}`,
      `Submission rounds: ${JSON.stringify(ctx.submissions.map((s) => ({ permit_id: s.permit_id, round: s.round })))}`,
      `Email from: ${email.from}`,
      `Subject: ${email.subject}`,
      `Body: ${email.text.slice(0, 4000)}`,
      `Files: ${JSON.stringify(files.map((f, i) => ({ index: i, filename: f.filename, size: f.size })))}`,
    ].join("\n");
    try {
      raw = parseJsonLoose(await callGemini(apiKey, SYSTEM, prompt));
      await logAiCall("document_matching", { projectId, subject: email.subject, files: files.map((f) => f.filename) }, raw);
    } catch (e) {
      console.error("document matching AI failed:", e);
    }
  }
  const list = Array.isArray(raw.files) ? (raw.files as Record<string, unknown>[]) : [];
  return files.map((f, i) =>
    sanitizeSuggestion(list.find((x) => Number(x.index) === i) ?? list[i], ctx, {
      exactPermitId: exact,
      filename: f.filename,
    }),
  );
}

async function log(admin: SupabaseClient, projectId: string, sourceId: string | null, result: string, detail: string) {
  await admin.from("document_source_log").insert({ project_id: projectId, source_id: sourceId, result, detail });
}

// File an import as a Received working-draft version (auto-file only — a
// person decides requirement selections).
async function autoFile(admin: SupabaseClient, imp: Record<string, unknown>) {
  const { data: doc, error } = await admin.from("project_documents").insert({
    project_id: imp.project_id,
    name: imp.title,
    category: imp.discipline,
    discipline: null,
    storage_path: imp.storage_path,
    mime_type: imp.mime_type,
    size_bytes: imp.size_bytes,
    doc_group: imp.doc_group,
    version_label: imp.revision,
    release_status: "working_draft",
    doc_kind: imp.doc_kind,
    owner_party: null,
    permit_id: imp.permit_id,
    submission_id: String(imp.destination).startsWith("support:") ? String(imp.destination).slice(8) : null,
    content_hash: imp.content_hash,
    source_id: imp.source_id,
    source_record: imp.source_record,
    source_at: imp.source_at,
    note: "Filed automatically from an exact match (Received). Review and release are still required.",
  }).select("id").single();
  if (error) throw error;
  await admin.from("document_imports").update({ status: "filed", filed_document_id: doc.id, decided_at: new Date().toISOString(), decision_note: "Auto-filed: exact match" }).eq("id", imp.id);
}

async function inbound(admin: SupabaseClient, email: InboundEmail): Promise<Record<string, unknown>> {
  const tokens = [...new Set(email.to.map(inboxToken).filter((t): t is string => !!t))];
  if (!tokens.length) return { ignored: "no project inbox address" };
  const results: Record<string, unknown>[] = [];
  for (const token of tokens) {
    const { data: inbox } = await admin.from("document_sources").select("*").eq("inbox_token", token).eq("type", "email").maybeSingle();
    if (!inbox) { results.push({ token, ignored: "unknown inbox" }); continue; }
    const projectId = inbox.project_id as string;
    const { data: project } = await admin.from("projects").select("id, user_id").eq("id", projectId).maybeSingle();
    if (!project) continue;
    // A city portal's notification emails are credited to that portal source.
    const { data: portals } = await admin.from("document_sources").select("*").eq("project_id", projectId).eq("type", "portal");
    const domain = senderDomain(email.from);
    const portal = ((portals ?? []) as Source[]).find((p) => p.status === "connected" && domainMatches(domain, p.match_domains));
    const source = (portal ?? inbox) as Source;
    const now = new Date().toISOString();
    if (source.status === "disconnected") {
      await log(admin, projectId, source.id, "Ignored — source disconnected", `Email "${email.subject ?? ""}" was not collected.`);
      results.push({ token, ignored: "disconnected" });
      continue;
    }
    const text = (email.text ?? (email.html ? htmlToText(email.html) : "")).slice(0, 20000);
    const subject = (email.subject ?? "").slice(0, 300);
    const ctx = await context(admin, projectId);
    const attachments = (email.attachments ?? []).filter((a) => a.filename);
    let collected = 0, duplicates = 0, filed = 0, linkOnly = 0;

    if (!attachments.length) {
      const links = extractLinks(text);
      if (links.length) {
        const { error } = await admin.from("document_imports").insert({
          project_id: projectId, source_id: source.id, source_record: `${email.message_id}:link`,
          from_address: email.from, subject, filename: subject || "Notification", status: "link_only",
          title: subject || "Link received", doc_kind: "City correspondence", discipline: "City / Agency",
          link_url: links[0], source_at: email.created_at ?? now,
          match_summary: "Notification only — no file collected",
          reason: "This email has a link, not an attached file. If the link needs a sign-in, open it in the portal and upload the document — a link alone is not a collected document.",
          round_evidence: "No document retrieved",
        });
        if (!error) linkOnly++;
      }
    } else {
      const loaded: { a: Attachment; bytes: Uint8Array }[] = [];
      for (const a of attachments.slice(0, 15)) {
        let bytes: Uint8Array | null = null;
        if (a.content_base64) bytes = Uint8Array.from(atob(a.content_base64), (c) => c.charCodeAt(0));
        else if (a.download_url) {
          const r = await fetch(a.download_url);
          if (r.ok) bytes = new Uint8Array(await r.arrayBuffer());
        }
        if (!bytes || !bytes.length || bytes.length > MAX_BYTES) continue;
        loaded.push({ a, bytes });
      }
      const suggestions = await match(admin, projectId, ctx, { subject, from: email.from, text }, loaded.map(({ a, bytes }) => ({ filename: a.filename, size: bytes.length })));
      for (const [i, { a, bytes }] of loaded.entries()) {
        const sourceRecord = `${email.message_id}:${i}:${a.filename}`.slice(0, 300);
        const { data: seen } = await admin.from("document_imports").select("id").eq("project_id", projectId).eq("source_record", sourceRecord).maybeSingle();
        if (seen) { duplicates++; continue; }
        const hash = await sha256(bytes);
        const { data: dupDoc } = await admin.from("project_documents").select("id").eq("project_id", projectId).eq("content_hash", hash).limit(1).maybeSingle();
        const { data: dupImp } = await admin.from("document_imports").select("id, filed_document_id, existing_document_id").eq("project_id", projectId).eq("content_hash", hash).neq("status", "ignored").limit(1).maybeSingle();
        const sg = suggestions[i];
        const base = {
          project_id: projectId, source_id: source.id, source_record: sourceRecord, from_address: email.from,
          subject, filename: a.filename.slice(0, 200), mime_type: a.content_type ?? null, size_bytes: bytes.length,
          content_hash: hash, source_at: email.created_at ?? now,
          permit_id: sg.permit_id, requirement_id: sg.requirement_id, doc_group: sg.doc_group, title: sg.title,
          doc_kind: sg.doc_kind, discipline: sg.discipline, revision: sg.revision, destination: sg.destination,
          confidence: sg.confidence, match_summary: sg.match_summary, reason: sg.reason, round_evidence: sg.round_evidence,
        };
        if (dupDoc || dupImp) {
          await admin.from("document_imports").insert({
            ...base, status: "duplicate",
            existing_document_id: dupDoc?.id ?? dupImp?.filed_document_id ?? dupImp?.existing_document_id ?? null,
            match_summary: "Same file content already on record",
            reason: "This file's content matches a document already in the project (checked by content, not file name). No new version was added.",
          });
          duplicates++;
          continue;
        }
        const path = `${project.user_id}/${projectId}/imports/${crypto.randomUUID()}-${safeName(a.filename)}`;
        const up = await admin.storage.from("project-docs").upload(path, bytes, { contentType: a.content_type || "application/octet-stream" });
        if (up.error) throw up.error;
        await admin.rpc("set_project_doc_owner", { p_name: path, p_owner: project.user_id });
        const { data: imp, error } = await admin.from("document_imports").insert({ ...base, storage_path: path, status: sg.status }).select("*").single();
        if (error) throw error;
        collected++;
        if (source.auto_file && sg.status === "ready") {
          await autoFile(admin, imp);
          filed++;
        }
      }
    }
    await admin.from("document_sources").update({ last_success: now, last_attempt: now, status: source.status === "sync_failed" ? "connected" : source.status }).eq("id", source.id);
    await log(admin, projectId, source.id, "Email collected",
      `"${subject || "(no subject)"}" from ${email.from}: ${collected} file(s) collected, ${filed} auto-filed as Received, ${duplicates} duplicate(s) skipped${linkOnly ? ", 1 link-only notification" : ""}. Nothing was submitted or approved.`);
    results.push({ token, projectId, collected, duplicates, filed, linkOnly });
  }
  return { ok: true, results };
}

async function sync(admin: SupabaseClient, userId: string, sourceId: string) {
  const { data: src } = await admin.from("document_sources").select("*").eq("id", sourceId).maybeSingle();
  if (!src) throw new Error("Source not found.");
  const { data: project } = await admin.from("projects").select("id, user_id").eq("id", src.project_id).maybeSingle();
  if (!project || project.user_id !== userId) throw new Error("Not your project.");
  const now = new Date().toISOString();
  if (src.status === "disconnected" || src.status === "needs_setup") {
    await admin.from("document_sources").update({ last_attempt: now }).eq("id", sourceId);
    await log(admin, src.project_id, sourceId, src.status === "needs_setup" ? "Setup required" : "Source disconnected", "No documents were collected; the last successful check is unchanged.");
    return { checked: 0, status: src.status };
  }
  // Email arrives the moment it's sent; a re-check re-runs the matching on
  // files still waiting for a person.
  const { data: waiting } = await admin.from("document_imports").select("*").eq("source_id", sourceId).eq("status", "needs_review");
  const ctx = await context(admin, src.project_id);
  let improved = 0;
  for (const w of waiting ?? []) {
    const [sg] = await match(admin, src.project_id, ctx, { subject: w.subject ?? "", from: w.from_address ?? "", text: "" }, [{ filename: w.filename, size: w.size_bytes ?? 0 }]);
    if (sg.status === "ready" || (sg.permit_id && !w.permit_id)) {
      await admin.from("document_imports").update({ permit_id: sg.permit_id, requirement_id: sg.requirement_id, doc_group: sg.doc_group, title: sg.title, doc_kind: sg.doc_kind, discipline: sg.discipline, revision: sg.revision, destination: sg.destination, confidence: sg.confidence, match_summary: sg.match_summary, reason: sg.reason, round_evidence: sg.round_evidence, status: sg.status }).eq("id", w.id);
      improved++;
    }
  }
  await admin.from("document_sources").update({ last_success: now, last_attempt: now }).eq("id", sourceId);
  await log(admin, src.project_id, sourceId, "Checked now", `${(waiting ?? []).length} file(s) waiting for review re-matched; ${improved} updated. New email is collected as it arrives.`);
  return { checked: (waiting ?? []).length, improved };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const relay = req.headers.get("x-relay-secret");
    if (relay) {
      const secret = Deno.env.get("DP_RELAY_SECRET");
      if (!secret || relay !== secret) return json({ error: "forbidden" }, 403);
      const body = (await req.json()) as { action?: string; email?: InboundEmail };
      if (body.action !== "inbound" || !body.email?.message_id) return json({ error: "bad request" }, 400);
      return json(await inbound(admin, body.email));
    }
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "sign in required" }, 401);
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: "sign in required" }, 401);
    const body = (await req.json()) as { action?: string; sourceId?: string };
    if (body.action === "sync" && body.sourceId) return json(await sync(admin, who.user.id, body.sourceId));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("document-sources failed:", e);
    return json({ error: e instanceof Error ? e.message : "failed" }, 500);
  }
});
