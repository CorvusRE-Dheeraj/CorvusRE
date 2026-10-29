// The Documents workspace: every file version of a project linked to its
// permit and submission round, the working package each permit is preparing,
// what each round actually sent, and documents collected from connected
// sources (the project's email inbox, city portal notifications).
//
// Statuses never blur: Uploaded ≠ Ready ≠ Submitted ≠ City approved. A
// document version is a working draft until released for permitting; a
// requirement is ready only with a released version; a package is frozen by
// a person; a round's manifest is written by the database when the permit is
// filed and can't be edited; filing an imported file creates a Received
// working draft — never a submitted or approved one.
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { storageSafeName } from "./storage-key";
import type { PermitRow } from "./projects";
import type { RoundComment, SubmissionRow } from "./permit-history";

export const DOC_WORKSPACE_KEY = "doc-workspace";

// ── rows ────────────────────────────────────────────────────────────────────
export type VersionRow = {
  id: string;
  project_id: string;
  name: string;
  category: string;
  storage_path: string | null;
  note: string | null;
  created_at: string;
  doc_group: string | null;
  version_label: string | null;
  release_status: "working_draft" | "released" | "city_approved";
  doc_kind: string | null;
  owner_party: string | null;
  permit_id: string | null;
  submission_id: string | null;
  content_hash: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  released_at: string | null;
  release_note: string | null;
  source_id: string | null;
  source_record: string | null;
  source_at: string | null;
};

export type PrepStatus =
  "missing" | "requested" | "received" | "internal_review" | "revision_required" | "ready";

export type RequirementRow = {
  id: string;
  project_id: string;
  permit_key: string | null;
  label: string;
  grp: string;
  required: boolean;
  done: boolean;
  kind: string;
  document_id: string | null;
  prep_status: PrepStatus | null;
  owner_party: string | null;
  due_date: string | null;
  review_note: string | null;
};

// one file a round sent (see permit_submissions.manifest)
export type ManifestItem = NonNullable<SubmissionRow["manifest"]>[number];

export type SubmittedRound = SubmissionRow & {
  manifest: ManifestItem[] | null;
  manifest_basis: string | null;
};

export type PackageRow = {
  id: string;
  project_id: string;
  permit_id: string;
  round: number;
  status: "draft" | "frozen" | "submitted";
  frozen_at: string | null;
  frozen_manifest: ManifestItem[] | null;
  reopen_log: { at: string; frozen_at: string | null }[];
};

// the same fields the Track Map's round timing reads (see permit-history)
export type CommentRow = RoundComment & { created_at: string };

export type SourceRow = {
  id: string;
  project_id: string;
  type: "email" | "portal" | "folder";
  name: string;
  provider: string | null;
  reference: string | null;
  inbox_token: string | null;
  match_domains: string[];
  permit_ids: string[];
  status: "connected" | "needs_setup" | "disconnected" | "sync_failed";
  last_success: string | null;
  last_attempt: string | null;
  auto_file: boolean;
  owner_party: string | null;
  message: string | null;
  created_at: string;
};

export type ImportStatus =
  "ready" | "needs_review" | "filed" | "duplicate" | "link_only" | "ignored";
export type ImportRow = {
  id: string;
  project_id: string;
  source_id: string | null;
  source_record: string;
  from_address: string | null;
  subject: string | null;
  filename: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  content_hash: string | null;
  source_at: string | null;
  collected_at: string;
  status: ImportStatus;
  permit_id: string | null;
  requirement_id: string | null;
  doc_group: string | null;
  title: string | null;
  doc_kind: string | null;
  discipline: string | null;
  revision: string | null;
  destination: string;
  confidence: number | null;
  match_summary: string | null;
  reason: string | null;
  round_evidence: string | null;
  link_url: string | null;
  existing_document_id: string | null;
  filed_document_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

export type LogRow = {
  id: string;
  project_id: string;
  source_id: string | null;
  at: string;
  result: string;
  detail: string | null;
};

export type Workspace = {
  permits: PermitRow[];
  requirements: RequirementRow[];
  versions: VersionRow[];
  submissions: SubmittedRound[];
  packages: PackageRow[];
  comments: CommentRow[];
  sources: SourceRow[];
  imports: ImportRow[];
  log: LogRow[];
};

export const INBOX_DOMAIN = "inbox.corvusre.com";
export const inboxAddress = (s: Pick<SourceRow, "inbox_token">) =>
  s.inbox_token ? `dp-${s.inbox_token}@${INBOX_DOMAIN}` : "";

export const DOC_KINDS = [
  "Design drawings",
  "Survey",
  "Supporting study",
  "Application form",
  "Owner authorization",
  "Comment response",
  "City correspondence",
  "Submission receipt",
  "Approved plans",
  "Issued permit",
  "Shared reference",
  "Other",
];
export const DISCIPLINES = [
  "General / Administration",
  "Architectural",
  "Civil",
  "Structural",
  "MEP",
  "Fire Protection",
  "Survey",
  "Landscape",
  "Owner",
  "City / Agency",
];
export const ACCEPTED_EXTS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "dwg",
  "dxf",
  "csv",
  "txt",
];
export const UPLOAD_LIMIT = 25 * 1024 * 1024;
export const MAX_FILES = 10;

export const PREP_LABEL: Record<PrepStatus, string> = {
  missing: "Missing",
  requested: "Requested",
  received: "Received",
  internal_review: "Internal review",
  revision_required: "Revision required",
  ready: "Ready for package",
};
export const RELEASE_LABEL: Record<VersionRow["release_status"], string> = {
  working_draft: "Working draft",
  released: "Released for permitting",
  city_approved: "City-approved copy",
};
export const IMPORT_LABEL: Record<ImportStatus, string> = {
  ready: "Ready to file",
  needs_review: "Needs review",
  filed: "Filed",
  duplicate: "Duplicate skipped",
  link_only: "Link only",
  ignored: "Ignored",
};

// ── loading ─────────────────────────────────────────────────────────────────
export async function loadWorkspace(projectId: string): Promise<Workspace> {
  const q = <T>(p: PromiseLike<{ data: unknown; error: unknown }>) =>
    Promise.resolve(p).then(({ data, error }) => {
      if (error) throw error;
      return (data ?? []) as T;
    });
  const [permits, requirements, versions, submissions, packages, comments, sources, imports, log] =
    await Promise.all([
      q<PermitRow[]>(
        supabase.from("project_permits").select("*").eq("project_id", projectId).order("sort"),
      ),
      q<RequirementRow[]>(
        supabase
          .from("project_checklist_items")
          .select("*")
          .eq("project_id", projectId)
          .eq("kind", "submission")
          .order("created_at"),
      ),
      q<VersionRow[]>(
        supabase
          .from("project_documents")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at"),
      ),
      q<SubmittedRound[]>(
        supabase.from("permit_submissions").select("*").eq("project_id", projectId).order("round"),
      ),
      q<PackageRow[]>(supabase.from("permit_packages").select("*").eq("project_id", projectId)),
      q<CommentRow[]>(
        supabase
          .from("review_comments")
          .select(
            "id, project_id, permit_key, original, plain_language, responsible, status, priority, round, discipline, assigned_at, due_at, responded_at, verified_at, created_at",
          )
          .eq("project_id", projectId)
          .order("created_at"),
      ),
      q<SourceRow[]>(
        supabase
          .from("document_sources")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at"),
      ),
      q<ImportRow[]>(
        supabase
          .from("document_imports")
          .select("*")
          .eq("project_id", projectId)
          .order("collected_at", { ascending: false }),
      ),
      q<LogRow[]>(
        supabase
          .from("document_source_log")
          .select("*")
          .eq("project_id", projectId)
          .order("at", { ascending: false })
          .limit(200),
      ),
    ]);
  return {
    permits,
    requirements,
    versions,
    submissions,
    packages,
    comments,
    sources,
    imports,
    log,
  };
}

// ── derived (pure) ──────────────────────────────────────────────────────────
export type DocGroup = { id: string; versions: VersionRow[]; latest: VersionRow; title: string };

// Versions of one logical document share doc_group (or are their own group).
export function groupDocuments(versions: VersionRow[]): DocGroup[] {
  const by = new Map<string, VersionRow[]>();
  for (const v of versions) {
    const g = v.doc_group ?? v.id;
    by.set(g, [...(by.get(g) ?? []), v]);
  }
  return [...by].map(([id, vs]) => {
    const sorted = [...vs].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const latest = sorted[sorted.length - 1];
    return { id, versions: sorted, latest, title: sorted[0].name };
  });
}

export const groupOf = (v: VersionRow) => v.doc_group ?? v.id;

export function permitRequirements(ws: Pick<Workspace, "requirements">, permit: PermitRow) {
  return ws.requirements.filter((r) => r.permit_key === permit.permit_key);
}

// The status a requirement shows: a selected version or not, then its prep state.
export function prepOf(r: RequirementRow): PrepStatus {
  if (!r.document_id) return r.prep_status === "requested" ? "requested" : "missing";
  return r.prep_status && r.prep_status !== "missing" ? r.prep_status : "received";
}

export function isReady(r: RequirementRow, versions: Map<string, VersionRow>): boolean {
  const v = r.document_id ? versions.get(r.document_id) : undefined;
  return !!v && prepOf(r) === "ready" && v.release_status === "released";
}

const OPEN_COMMENT = (c: CommentRow) => !["addressed", "closed"].includes(c.status);

// What still stops a permit's next package from being frozen.
export function packageBlockers(
  reqs: RequirementRow[],
  versions: Map<string, VersionRow>,
  comments: CommentRow[],
): { kind: "requirement" | "comment"; id: string; text: string }[] {
  const out: { kind: "requirement" | "comment"; id: string; text: string }[] = [];
  for (const r of reqs.filter((x) => x.required)) {
    if (isReady(r, versions)) continue;
    const v = r.document_id ? versions.get(r.document_id) : undefined;
    out.push({
      kind: "requirement",
      id: r.id,
      text: !v
        ? `${r.label}: no document received`
        : v.release_status !== "released"
          ? `${r.label}: selected version isn't released for permitting`
          : `${r.label}: ${PREP_LABEL[prepOf(r)].toLowerCase()}`,
    });
  }
  for (const c of comments.filter(OPEN_COMMENT))
    out.push({
      kind: "comment",
      id: c.id,
      text: `Review comment: ${(c.plain_language || c.original).slice(0, 90)} — not answered yet`,
    });
  return out;
}

export function nextRound(submissions: SubmittedRound[], permitId: string): number {
  return (
    Math.max(0, ...submissions.filter((s) => s.permit_id === permitId).map((s) => s.round)) + 1
  );
}

// New / Reused / Revised against the previous round's manifest.
export function changeVsPrevious(
  item: { requirement_id: string; doc_group: string; document_id: string },
  previous: ManifestItem[] | null | undefined,
): "New" | "Reused" | "Revised" {
  const old = previous?.find(
    (m) => m.requirement_id === item.requirement_id || m.doc_group === item.doc_group,
  );
  if (!old) return "New";
  return old.document_id === item.document_id ? "Reused" : "Revised";
}

export const fileExt = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

// Problems with a file before it's uploaded.
export function fileProblem(f: { name: string; size: number }): string | null {
  if (!ACCEPTED_EXTS.includes(fileExt(f.name)))
    return `${f.name}: unsupported file type. Use PDF, images, Word, Excel, DWG, DXF, CSV or TXT.`;
  if (!f.size) return `${f.name}: this file is empty.`;
  if (f.size > UPLOAD_LIMIT) return `${f.name}: over the 25 MB limit.`;
  return null;
}

// The next unused revision label for a document: R1, R2, …
export function suggestRevision(group: DocGroup | undefined): string {
  if (!group) return "R1";
  let n = group.versions.length + 1;
  const used = new Set(group.versions.map((v) => (v.version_label ?? "").toLowerCase()));
  while (used.has(`r${n}`)) n++;
  return `R${n}`;
}

export const formatBytes = (b: number | null | undefined) =>
  !b
    ? "—"
    : b >= 1048576
      ? `${(b / 1048576).toFixed(1)} MB`
      : b >= 1024
        ? `${(b / 1024).toFixed(1)} KB`
        : `${b} bytes`;

export async function sha256Hex(file: Blob): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── actions ─────────────────────────────────────────────────────────────────
export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("project-docs").createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

export type UploadItem = { file: File; title: string; kind: string; revision: string };
export type UploadInput = {
  userId: string;
  projectId: string;
  permitId: string | null;
  destination: string; // "library" | "draft" | "support:<submission id>"
  requirementId: string | null;
  docGroup: string | null; // a new revision of this document
  discipline: string;
  owner: string;
  notes: string;
  items: UploadItem[];
};

// Uploads each file as a new working-draft version. Files whose content is
// already in the project are skipped (reported back), never duplicated.
export async function uploadVersions(
  ws: Workspace,
  input: UploadInput,
): Promise<{ created: string[]; duplicates: string[] }> {
  const created: string[] = [];
  const duplicates: string[] = [];
  for (const item of input.items) {
    const hash = await sha256Hex(item.file);
    if (ws.versions.some((v) => v.content_hash === hash)) {
      duplicates.push(item.file.name);
      continue;
    }
    const path = `${input.userId}/${input.projectId}/${Date.now()}-${storageSafeName(item.file.name)}`;
    const up = await supabase.storage.from("project-docs").upload(path, item.file);
    if (up.error) throw up.error;
    const { data, error } = await supabase
      .from("project_documents")
      .insert({
        project_id: input.projectId,
        name: item.title.trim(),
        category: input.discipline,
        storage_path: path,
        note: input.notes.trim() || null,
        mime_type: item.file.type || null,
        size_bytes: item.file.size,
        doc_group: input.docGroup,
        version_label: item.revision.trim(),
        release_status: "working_draft",
        doc_kind: item.kind,
        owner_party: input.owner.trim() || null,
        permit_id: input.permitId,
        submission_id: input.destination.startsWith("support:") ? input.destination.slice(8) : null,
        content_hash: hash,
      })
      .select("id")
      .single();
    if (error) throw error;
    created.push(data.id as string);
    if (input.requirementId)
      await selectForRequirement(input.requirementId, data.id as string, "received");
  }
  return { created, duplicates };
}

export async function selectForRequirement(
  requirementId: string,
  documentId: string | null,
  status: PrepStatus,
  note?: string,
): Promise<void> {
  const { error } = await supabase
    .from("project_checklist_items")
    .update({
      document_id: documentId,
      prep_status: status,
      ...(note !== undefined ? { review_note: note } : {}),
    })
    .eq("id", requirementId);
  if (error) throw error;
}

export async function updateRequirement(
  requirementId: string,
  patch: Partial<Pick<RequirementRow, "prep_status" | "review_note" | "owner_party" | "due_date">>,
): Promise<void> {
  const { error } = await supabase
    .from("project_checklist_items")
    .update(patch)
    .eq("id", requirementId);
  if (error) throw error;
}

export async function releaseVersion(versionId: string, note: string): Promise<void> {
  const { error } = await supabase
    .from("project_documents")
    .update({
      release_status: "released",
      released_at: new Date().toISOString(),
      release_note: note,
    })
    .eq("id", versionId);
  if (error) throw error;
}

export async function ensurePackage(
  projectId: string,
  permitId: string,
  round: number,
): Promise<PackageRow> {
  const { data: found } = await supabase
    .from("permit_packages")
    .select("*")
    .eq("permit_id", permitId)
    .eq("round", round)
    .maybeSingle();
  if (found) return found as PackageRow;
  const { data, error } = await supabase
    .from("permit_packages")
    .insert({ project_id: projectId, permit_id: permitId, round })
    .select("*")
    .single();
  if (error) throw error;
  return data as PackageRow;
}

export async function setPackageStatus(id: string, status: "frozen" | "draft"): Promise<void> {
  const { error } = await supabase
    .from("permit_packages")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function createSource(input: {
  projectId: string;
  type: SourceRow["type"];
  name: string;
  provider: string;
  reference: string;
  matchDomains: string[];
  permitIds: string[];
  owner: string;
  autoFile: boolean;
}): Promise<SourceRow> {
  const { data, error } = await supabase
    .from("document_sources")
    .insert({
      project_id: input.projectId,
      type: input.type,
      name: input.name,
      provider: input.provider,
      reference: input.reference || null,
      match_domains: input.matchDomains,
      permit_ids: input.permitIds,
      owner_party: input.owner || null,
      auto_file: input.autoFile,
      status: "connected",
    })
    .select("*")
    .single();
  if (error) throw error;
  await addLog(
    input.projectId,
    (data as SourceRow).id,
    "Source connected",
    `${input.name} connected.`,
  );
  return data as SourceRow;
}

export async function updateSource(
  id: string,
  patch: Partial<
    Pick<
      SourceRow,
      "name" | "auto_file" | "status" | "permit_ids" | "match_domains" | "reference" | "message"
    >
  >,
): Promise<void> {
  const { error } = await supabase
    .from("document_sources")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function addLog(
  projectId: string,
  sourceId: string | null,
  result: string,
  detail: string,
) {
  await supabase
    .from("document_source_log")
    .insert({ project_id: projectId, source_id: sourceId, result, detail });
}

export async function syncSource(sourceId: string) {
  return invokeEdgeFunction<{ checked: number; improved?: number; status?: string }>(
    "document-sources",
    {
      action: "sync",
      sourceId,
    },
  );
}

export type ImportDecision = {
  permitId: string | null;
  destination: string;
  docGroup: string | null;
  title: string;
  revision: string;
  kind: string;
  owner: string;
  requirementId: string | null;
  useForRequirement: boolean;
  note: string;
};

// Files an imported file as a Received working-draft version (same storage
// object), optionally selecting it for a working requirement.
export async function fileImport(
  ws: Workspace,
  imp: ImportRow,
  d: ImportDecision,
): Promise<string> {
  if (!imp.storage_path) throw new Error("This import has no file to file.");
  const dup = imp.content_hash
    ? ws.versions.find((v) => v.content_hash === imp.content_hash)
    : undefined;
  if (dup) {
    const { error } = await supabase
      .from("document_imports")
      .update({ status: "duplicate", existing_document_id: dup.id, decision_note: d.note || null })
      .eq("id", imp.id);
    if (error) throw error;
    return dup.id;
  }
  const { data, error } = await supabase
    .from("project_documents")
    .insert({
      project_id: imp.project_id,
      name: d.title.trim(),
      category: imp.discipline ?? "General / Administration",
      storage_path: imp.storage_path,
      mime_type: imp.mime_type,
      size_bytes: imp.size_bytes,
      doc_group: d.docGroup,
      version_label: d.revision.trim(),
      release_status: "working_draft",
      doc_kind: d.kind,
      owner_party: d.owner.trim() || null,
      permit_id: d.permitId,
      submission_id: d.destination.startsWith("support:") ? d.destination.slice(8) : null,
      content_hash: imp.content_hash,
      note: d.note.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const docId = data.id as string;
  // provenance columns are written by the server only; record the trail on the import
  const upd = await supabase
    .from("document_imports")
    .update({
      status: "filed",
      filed_document_id: docId,
      permit_id: d.permitId,
      destination: d.destination,
      doc_group: d.docGroup,
      title: d.title.trim(),
      revision: d.revision.trim(),
      doc_kind: d.kind,
      requirement_id: d.useForRequirement ? d.requirementId : null,
      decision_note: d.note.trim() || null,
    })
    .eq("id", imp.id);
  if (upd.error) throw upd.error;
  if (d.useForRequirement && d.requirementId)
    await selectForRequirement(d.requirementId, docId, "received");
  await addLog(
    imp.project_id,
    imp.source_id,
    "Match confirmed & filed",
    `${imp.filename} filed as a Received working draft.`,
  );
  return docId;
}

export async function ignoreImport(imp: ImportRow, reason: string): Promise<void> {
  const { error } = await supabase
    .from("document_imports")
    .update({ status: "ignored", decision_note: reason })
    .eq("id", imp.id);
  if (error) throw error;
  await addLog(imp.project_id, imp.source_id, "Record ignored", `${imp.filename}: ${reason}`);
}
