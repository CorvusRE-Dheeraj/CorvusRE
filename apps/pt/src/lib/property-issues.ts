import { supabase } from "./supabase";
import { uploadDocument, notifyDocumentsChanged, type DocumentRecord } from "./documents";
import { invokeEdgeFunction } from "./edge-functions";
import { bytesToBase64 } from "./pdf-utils";
import type { PropertyRecord } from "./properties";

// Property Issues: city/county notices, violations and other property-related
// issues an owner has to resolve (public.property_issues). Each issue carries
// the notice's facts, a status, AI guidance, cost guidance, proof documents and
// reminders for its dates.

export const ISSUE_CATEGORIES = [
  { id: "dumping", label: "Dumping / illegal dumping" },
  { id: "grass", label: "Grass / landscaping" },
  { id: "maintenance", label: "Property maintenance" },
  { id: "court_order", label: "Court order" },
  { id: "code_offense", label: "Code / offense notice" },
  { id: "inspection", label: "Inspection notice" },
  { id: "fine", label: "Fine / penalty" },
  { id: "compliance_deadline", label: "Compliance deadline" },
  { id: "other", label: "Other notice" },
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]["id"];

// The status flow, in order.
export const ISSUE_STATUSES = [
  { id: "new", label: "New" },
  { id: "action_required", label: "Action Required" },
  { id: "service_scheduled", label: "Service Scheduled" },
  { id: "inspection_pending", label: "Inspection Pending" },
  { id: "resolved", label: "Resolved" },
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number]["id"];

export const categoryLabel = (c: IssueCategory) =>
  ISSUE_CATEGORIES.find((x) => x.id === c)?.label ?? "Other notice";
export const statusLabel = (s: IssueStatus) => ISSUE_STATUSES.find((x) => x.id === s)?.label ?? s;

// Plain-language guidance — written by analyze-property-issue.
export type IssueGuidance = {
  whatHappened: string;
  whatToDo: string;
  byWhen: string;
  ifNotResolved: string;
  nextSteps: string[];
  whoToHire: string;
};

// Rough cost guidance for the service the issue needs.
export type CostEstimate = {
  service: string;
  low: number;
  high: number;
  basis: string;
};

export type PropertyIssue = {
  id: string;
  userId: string;
  propertyId: string;
  source: "manual" | "upload" | "city_data";
  externalRef: string | null;
  category: IssueCategory;
  title: string;
  description: string | null;
  issuedOn: string | null;
  deadline: string | null;
  inspectionDate: string | null;
  courtDate: string | null;
  fineAmount: number | null;
  fineDue: string | null;
  requiredAction: string | null;
  authority: string | null;
  authorityContact: string | null;
  consequences: string | null;
  guidance: IssueGuidance | null;
  costEstimate: CostEstimate | null;
  providerTypes: string[];
  status: IssueStatus;
  sourceDocumentId: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  user_id: string;
  property_id: string;
  source: PropertyIssue["source"];
  external_ref: string | null;
  category: IssueCategory;
  title: string;
  description: string | null;
  issued_on: string | null;
  deadline: string | null;
  inspection_date: string | null;
  court_date: string | null;
  fine_amount: number | null;
  fine_due: string | null;
  required_action: string | null;
  authority: string | null;
  authority_contact: string | null;
  consequences: string | null;
  guidance: IssueGuidance | null;
  cost_estimate: CostEstimate | null;
  provider_types: string[] | null;
  status: IssueStatus;
  source_document_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

const COLUMNS =
  "id, user_id, property_id, source, external_ref, category, title, description, issued_on, deadline, inspection_date, court_date, fine_amount, fine_due, required_action, authority, authority_contact, consequences, guidance, cost_estimate, provider_types, status, source_document_id, resolved_at, created_at";

function fromRow(r: Row): PropertyIssue {
  return {
    id: r.id,
    userId: r.user_id,
    propertyId: r.property_id,
    source: r.source,
    externalRef: r.external_ref,
    category: r.category,
    title: r.title,
    description: r.description,
    issuedOn: r.issued_on,
    deadline: r.deadline,
    inspectionDate: r.inspection_date,
    courtDate: r.court_date,
    fineAmount: r.fine_amount == null ? null : Number(r.fine_amount),
    fineDue: r.fine_due,
    requiredAction: r.required_action,
    authority: r.authority,
    authorityContact: r.authority_contact,
    consequences: r.consequences,
    guidance: r.guidance,
    costEstimate: r.cost_estimate,
    providerTypes: r.provider_types ?? [],
    status: r.status,
    sourceDocumentId: r.source_document_id,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  };
}

export type IssueFields = Partial<{
  category: IssueCategory;
  title: string;
  description: string | null;
  issuedOn: string | null;
  deadline: string | null;
  inspectionDate: string | null;
  courtDate: string | null;
  fineAmount: number | null;
  fineDue: string | null;
  requiredAction: string | null;
  authority: string | null;
  authorityContact: string | null;
  consequences: string | null;
  guidance: IssueGuidance | null;
  costEstimate: CostEstimate | null;
  providerTypes: string[];
  status: IssueStatus;
  sourceDocumentId: string | null;
}>;

const COLUMN: Record<keyof IssueFields, string> = {
  category: "category",
  title: "title",
  description: "description",
  issuedOn: "issued_on",
  deadline: "deadline",
  inspectionDate: "inspection_date",
  courtDate: "court_date",
  fineAmount: "fine_amount",
  fineDue: "fine_due",
  requiredAction: "required_action",
  authority: "authority",
  authorityContact: "authority_contact",
  consequences: "consequences",
  guidance: "guidance",
  costEstimate: "cost_estimate",
  providerTypes: "provider_types",
  status: "status",
  sourceDocumentId: "source_document_id",
};

function toRow(f: IssueFields): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const k of Object.keys(f) as (keyof IssueFields)[]) row[COLUMN[k]] = f[k];
  return row;
}

export async function listPropertyIssues(userId: string): Promise<PropertyIssue[]> {
  const { data, error } = await supabase
    .from("property_issues")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Row[]).map(fromRow);
}

export async function createPropertyIssue(
  userId: string,
  propertyId: string,
  fields: IssueFields & { title: string },
  source: PropertyIssue["source"] = "manual",
): Promise<PropertyIssue> {
  const { data, error } = await supabase
    .from("property_issues")
    .insert({ user_id: userId, property_id: propertyId, source, ...toRow(fields) })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const issue = fromRow(data as Row);
  await syncIssueReminders(issue).catch(() => {});
  return issue;
}

const REMINDER_FIELDS: (keyof IssueFields)[] = [
  "deadline",
  "inspectionDate",
  "courtDate",
  "fineDue",
  "status",
  "title",
];

export async function updatePropertyIssue(id: string, fields: IssueFields): Promise<PropertyIssue> {
  const row = toRow(fields);
  row.updated_at = new Date().toISOString();
  if (fields.status === "resolved") row.resolved_at = new Date().toISOString();
  else if (fields.status) row.resolved_at = null;
  const { data, error } = await supabase
    .from("property_issues")
    .update(row)
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const issue = fromRow(data as Row);
  if (REMINDER_FIELDS.some((k) => k in fields)) await syncIssueReminders(issue).catch(() => {});
  return issue;
}

// The dates on an issue that need a reminder, with how to word them.
const ISSUE_DATES = [
  { key: "deadline", label: "Deadline" },
  { key: "inspectionDate", label: "Inspection" },
  { key: "courtDate", label: "Court date" },
  { key: "fineDue", label: "Fine due" },
] as const;

export const HEADS_UP_DAYS = 3;

export type IssueDate = { kind: string; date: string; issue: PropertyIssue };

// Every upcoming date across open issues, soonest first — the tab's
// "Upcoming deadlines" strip.
export function upcomingIssueDates(issues: PropertyIssue[], todayIso: string): IssueDate[] {
  const out: IssueDate[] = [];
  for (const issue of issues) {
    if (issue.status === "resolved") continue;
    for (const d of ISSUE_DATES) {
      const date = issue[d.key];
      if (date && date >= todayIso) out.push({ kind: d.label, date, issue });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The reminders an issue should have: a heads-up a few days before each
// date and one on the day. None once it's resolved, none for past dates.
export function planIssueReminders(
  issue: PropertyIssue,
  todayIso: string,
): { remindOn: string; note: string }[] {
  if (issue.status === "resolved") return [];
  const plan: { remindOn: string; note: string }[] = [];
  for (const d of ISSUE_DATES) {
    const date = issue[d.key];
    if (!date || date < todayIso) continue;
    const headsUp = addDays(date, -HEADS_UP_DAYS);
    if (headsUp > todayIso) {
      plan.push({
        remindOn: headsUp,
        note: `Property issue: ${d.label.toLowerCase()} in ${HEADS_UP_DAYS} days — ${issue.title}`,
      });
    }
    plan.push({
      remindOn: date,
      note: `Property issue: ${d.label.toLowerCase()} today — ${issue.title}`,
    });
  }
  return plan;
}

// Replaces the issue's pending reminders (done/missed ones are history and
// stay). They appear on the Calendar and in the emailed deadline reminders.
export async function syncIssueReminders(issue: PropertyIssue): Promise<void> {
  const { error: delError } = await supabase
    .from("user_reminders")
    .delete()
    .eq("property_issue_id", issue.id)
    .eq("done", false)
    .is("missed_at", null);
  if (delError) throw delError;
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const plan = planIssueReminders(issue, todayIso);
  if (plan.length === 0) return;
  const { error } = await supabase.from("user_reminders").insert(
    plan.map((p) => ({
      user_id: issue.userId,
      property_id: issue.propertyId,
      property_issue_id: issue.id,
      remind_on: p.remindOn,
      note: p.note,
      source: "system",
    })),
  );
  if (error) throw error;
}

export async function deletePropertyIssue(id: string): Promise<void> {
  const { error } = await supabase.from("property_issues").delete().eq("id", id);
  if (error) throw error;
}

export const ISSUE_PROOF_DOCUMENT_TYPE = "Property Issue Proof";
export const ISSUE_NOTICE_DOCUMENT_TYPE = "Property Issue Notice";

// Uploads a file (proof photo, receipt, the notice itself) and links it to the issue.
export async function attachIssueDocument(
  userId: string,
  issue: Pick<PropertyIssue, "id" | "propertyId">,
  file: File,
  kind: "proof" | "notice",
): Promise<DocumentRecord> {
  const doc = await uploadDocument(
    userId,
    issue.propertyId,
    file,
    kind === "proof" ? ISSUE_PROOF_DOCUMENT_TYPE : ISSUE_NOTICE_DOCUMENT_TYPE,
  );
  const { error } = await supabase
    .from("documents")
    .update({ property_issue_id: issue.id })
    .eq("id", doc.id);
  if (error) throw error;
  notifyDocumentsChanged();
  return doc;
}

export async function listIssueDocuments(issueId: string): Promise<DocumentRecord[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, property_id, file_name, storage_path, document_type, uploaded_at")
    .eq("property_issue_id", issueId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id as string,
    propertyId: d.property_id as string,
    fileName: d.file_name as string,
    storagePath: d.storage_path as string,
    documentType: d.document_type as string | null,
    uploadedAt: d.uploaded_at as string,
  }));
}

type Analysis = { fields: IssueFields & { title: string }; guidance: IssueGuidance | null };

const propertyContext = (p: Pick<PropertyRecord, "address" | "cad">) => ({
  address: p.address,
  county: p.cad,
});

// Reads an uploaded notice: its real facts plus plain-language guidance
// (analyze-property-issue).
export async function analyzeIssueNotice(
  property: Pick<PropertyRecord, "address" | "cad">,
  file: File,
): Promise<Analysis> {
  const mimeType = file.type || "application/octet-stream";
  const dataUrl = `data:${mimeType};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`;
  return invokeEdgeFunction<Analysis>("analyze-property-issue", {
    property: propertyContext(property),
    documents: [{ fileName: file.name, mimeType, dataUrl }],
  });
}

// Guidance for an issue with no notice attached (typed in, or from city data).
export async function generateIssueGuidance(
  property: Pick<PropertyRecord, "address" | "cad">,
  issue: PropertyIssue,
): Promise<IssueGuidance | null> {
  const facts = {
    category: issue.category,
    title: issue.title,
    description: issue.description,
    issuedOn: issue.issuedOn,
    deadline: issue.deadline,
    inspectionDate: issue.inspectionDate,
    courtDate: issue.courtDate,
    fineAmount: issue.fineAmount,
    requiredAction: issue.requiredAction,
    authority: issue.authority,
  };
  const res = await invokeEdgeFunction<Analysis>("analyze-property-issue", {
    property: propertyContext(property),
    issue: facts,
  });
  return res.guidance;
}

// The next step in the flow (for a one-click "Move to …" button).
export function nextStatus(s: IssueStatus): IssueStatus | null {
  const i = ISSUE_STATUSES.findIndex((x) => x.id === s);
  return i >= 0 && i < ISSUE_STATUSES.length - 1 ? ISSUE_STATUSES[i + 1].id : null;
}
