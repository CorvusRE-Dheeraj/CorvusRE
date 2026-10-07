import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { getDocumentUrl, type DocumentRecord } from "@/lib/documents";
import { searchServiceProviders, type ServiceProvider } from "@/lib/google-places";
import {
  ISSUE_CATEGORIES,
  HEADS_UP_DAYS,
  ISSUE_STATUSES,
  upcomingIssueDates,
  analyzeIssueNotice,
  attachIssueDocument,
  generateIssueAdvice,
  categoryLabel,
  createPropertyIssue,
  deletePropertyIssue,
  listIssueDocuments,
  listPropertyIssues,
  nextStatus,
  providerSearchTypes,
  statusLabel,
  updatePropertyIssue,
  type IssueCategory,
  type IssueGuidance,
  type IssueStatus,
  type PropertyIssue,
} from "@/lib/property-issues";
import { PageHero } from "@/components/PageHero";
import { PageSkeleton } from "@/components/PageSkeleton";
import { getErrorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/dashboard/_layout/issues")({
  component: PropertyIssues,
});

const STATUS_STYLE: Record<IssueStatus, string> = {
  new: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  action_required: "bg-destructive/10 text-destructive",
  service_scheduled: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
  inspection_pending: "bg-warning/15 text-warning-foreground",
  resolved: "bg-success/15 text-success",
};

const fmtDate = (d: string | null) =>
  d
    ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
const DATE_FIELDS = [
  { key: "deadline", label: "Deadline" },
  { key: "inspectionDate", label: "Inspection" },
  { key: "courtDate", label: "Court date" },
  { key: "fineDue", label: "Fine due" },
] as const;
type DateKey = (typeof DATE_FIELDS)[number]["key"];

const localTodayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysUntil = (iso: string, todayIso: string) =>
  Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${todayIso}T12:00:00Z`)) / 86_400_000);
const usd = (n: number | null) => (n == null ? null : `$${n.toLocaleString("en-US")}`);

// The dashboard's Property Issues tab: every city/county notice, violation or
// other property issue, with what it needs and where it stands.
function PropertyIssues() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [issues, setIssues] = useState<PropertyIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([listProperties(user.id), listPropertyIssues(user.id)])
      .then(([props, list]) => {
        setProperties(props);
        setIssues(list);
      })
      .catch((err) => toast.error(getErrorMessage(err, "Could not load property issues.")))
      .finally(() => setLoading(false));
  }, [user]);

  const propertyById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const open = issues.filter((i) => i.status !== "resolved");
  const resolved = issues.filter((i) => i.status === "resolved");
  const today = localTodayIso();
  const upcoming = upcomingIssueDates(issues, today);

  const replace = (next: PropertyIssue) =>
    setIssues((cur) => cur.map((i) => (i.id === next.id ? next : i)));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHero
        icon={ShieldAlert}
        title="Property Issues"
        tone="rose"
        stats={[
          { label: "Open", value: open.length },
          { label: "Resolved", value: resolved.length },
        ]}
        subtitle="City and county notices, violations and other property issues — what each one means, what to do, by when, and where it stands."
      >
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          disabled={properties.length === 0}
          className="btn-outline border-white/40 text-sm text-white hover:bg-white/10 disabled:opacity-60"
        >
          {adding ? "Cancel" : "Add an issue"}
        </button>
      </PageHero>

      {loading || !user ? (
        <PageSkeleton />
      ) : (
        <div className="mt-6 grid gap-4">
          {properties.length === 0 && (
            <div className="card-elev p-6 text-sm text-muted-foreground">
              Add a property first — issues are tracked per property.
            </div>
          )}

          {adding && (
            <AddIssueForm
              userId={user.id}
              properties={properties}
              onCreated={(issue) => {
                setIssues((cur) => [issue, ...cur]);
                setAdding(false);
              }}
              onUpdated={replace}
            />
          )}

          {upcoming.length > 0 && (
            <section className="card-elev p-5" aria-labelledby="issue-deadlines">
              <h2 id="issue-deadlines" className="flex items-center gap-2 font-semibold">
                <CalendarClock className="h-4 w-4 text-rose-700" aria-hidden="true" />
                Upcoming deadlines
              </h2>
              <ul className="mt-3 grid gap-2">
                {upcoming.slice(0, 6).map((d) => {
                  const days = daysUntil(d.date, today);
                  return (
                    <li
                      key={`${d.issue.id}-${d.kind}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{d.kind}</span> — {d.issue.title}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {propertyById.get(d.issue.propertyId)?.address ?? "Property"}
                        </span>
                      </span>
                      <span
                        className={`whitespace-nowrap text-xs font-semibold ${days <= HEADS_UP_DAYS ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {fmtDate(d.date)} ·{" "}
                        {days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Each date is on your Calendar, with an email reminder {HEADS_UP_DAYS} days before
                and on the day.
              </p>
            </section>
          )}

          {open.length === 0 && properties.length > 0 && !adding && (
            <div className="card-elev p-6 text-sm text-muted-foreground">
              No open issues. When you get a notice from the city or county, add it here and
              CorvusPT will track it until it&apos;s resolved.
            </div>
          )}

          {open.map((issue) => (
            <IssueCard
              key={issue.id}
              userId={user.id}
              issue={issue}
              property={propertyById.get(issue.propertyId)}
              onChange={replace}
              onDelete={() => setIssues((cur) => cur.filter((i) => i.id !== issue.id))}
            />
          ))}

          {resolved.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowResolved((v) => !v)}
                className="text-sm font-medium text-accent hover:underline"
              >
                {showResolved ? "Hide" : "Show"} resolved issues ({resolved.length})
              </button>
              {showResolved && (
                <div className="mt-3 grid gap-4">
                  {resolved.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      userId={user.id}
                      issue={issue}
                      property={propertyById.get(issue.propertyId)}
                      onChange={replace}
                      onDelete={() => setIssues((cur) => cur.filter((i) => i.id !== issue.id))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddIssueForm({
  userId,
  properties,
  onCreated,
  onUpdated,
}: {
  userId: string;
  properties: PropertyRecord[];
  onCreated: (issue: PropertyIssue) => void;
  onUpdated: (issue: PropertyIssue) => void;
}) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [category, setCategory] = useState<IssueCategory>("code_offense");
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [requiredAction, setRequiredAction] = useState("");
  const [fine, setFine] = useState("");
  const [authority, setAuthority] = useState("");
  const [saving, setSaving] = useState(false);

  const [reading, setReading] = useState(false);
  const property = properties.find((p) => p.id === propertyId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!property || !title.trim()) return;
    setSaving(true);
    try {
      const issue = await createPropertyIssue(userId, property.id, {
        title: title.trim(),
        category,
        deadline: deadline || null,
        requiredAction: requiredAction.trim() || null,
        fineAmount: fine ? Number(fine.replace(/[$,]/g, "")) || null : null,
        authority: authority.trim() || null,
        status: "action_required",
      });
      toast.success("Issue added.");
      onCreated(issue);
      // Guidance arrives a few seconds later; the card picks it up via onUpdated.
      generateIssueAdvice(property, issue)
        .then((advice) =>
          advice.guidance ? updatePropertyIssue(issue.id, advice).then(onUpdated) : undefined,
        )
        .catch(() => {});
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not add this issue."));
    } finally {
      setSaving(false);
    }
  }

  // Upload the notice: the AI reads it, the issue is created from what it
  // says, and the notice is filed under Documents linked to the issue.
  async function readNotice(file: File) {
    if (!property) return;
    setReading(true);
    try {
      const { fields, guidance, costEstimate, providerTypes } = await analyzeIssueNotice(
        property,
        file,
      );
      let issue = await createPropertyIssue(
        userId,
        property.id,
        {
          ...fields,
          guidance,
          costEstimate: costEstimate ?? null,
          providerTypes: providerTypes ?? [],
          status: "action_required",
        },
        "upload",
      );
      try {
        const doc = await attachIssueDocument(userId, issue, file, "notice");
        issue = await updatePropertyIssue(issue.id, { sourceDocumentId: doc.id });
      } catch {
        toast.error(
          "The issue was added, but the notice file couldn't be saved — attach it below.",
        );
      }
      toast.success("Notice read — review the details below.");
      onCreated(issue);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not read this notice. Add the issue by hand below."));
    } finally {
      setReading(false);
    }
  }

  const input = "rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <form onSubmit={save} className="card-elev grid gap-3 p-5">
      <h2 className="font-semibold">Add an issue</h2>
      <label className="grid gap-1 text-sm">
        Property
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className={input}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.address}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-lg border border-dashed border-accent/50 bg-accent/5 p-4">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
          Have the notice? Upload it
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A photo or PDF of the letter. CorvusPT reads the dates, fine, required action and who sent
          it, then explains what to do.
        </p>
        <label
          className={`btn-accent mt-3 inline-flex cursor-pointer items-center gap-1.5 text-sm ${reading ? "pointer-events-none opacity-60" : ""}`}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          {reading ? "Reading the notice…" : "Upload notice"}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readNotice(file);
            }}
          />
        </label>
      </div>

      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Or enter it yourself
      </div>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          Type
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as IssueCategory)}
            className={input}
          >
            {ISSUE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        What is it?
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. High weeds / tall grass violation"
          required
          className={input}
        />
      </label>
      <label className="grid gap-1 text-sm">
        What does it require?
        <input
          value={requiredAction}
          onChange={(e) => setRequiredAction(e.target.value)}
          placeholder="e.g. Cut grass below 12 inches"
          className={input}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Deadline
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={input}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Fine / amount due
          <input
            value={fine}
            onChange={(e) => setFine(e.target.value)}
            placeholder="$"
            inputMode="decimal"
            className={input}
          />
        </label>
        <label className="grid gap-1 text-sm">
          From (authority)
          <input
            value={authority}
            onChange={(e) => setAuthority(e.target.value)}
            placeholder="City of Dallas Code Compliance"
            className={input}
          />
        </label>
      </div>
      <button
        disabled={saving || !title.trim()}
        className="btn-primary btn-primary-hover w-fit disabled:opacity-60"
      >
        {saving ? "Saving…" : "Add issue"}
      </button>
    </form>
  );
}

function IssueCard({
  userId,
  issue,
  property,
  onChange,
  onDelete,
}: {
  userId: string;
  issue: PropertyIssue;
  property: PropertyRecord | undefined;
  onChange: (issue: PropertyIssue) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(issue.status !== "resolved");
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    listIssueDocuments(issue.id)
      .then(setDocs)
      .catch(() => {});
  }, [expanded, issue.id]);

  async function setDate(key: DateKey, value: string | null) {
    setBusy(key);
    try {
      onChange(await updatePropertyIssue(issue.id, { [key]: value }));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this date."));
    } finally {
      setBusy(null);
    }
  }

  async function getGuidance() {
    if (!property) return;
    setBusy("guidance");
    try {
      const advice = await generateIssueAdvice(property, issue);
      if (!advice.guidance) throw new Error("No guidance came back — try again.");
      onChange(await updatePropertyIssue(issue.id, advice));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not get guidance for this issue."));
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: IssueStatus) {
    setBusy("status");
    try {
      onChange(await updatePropertyIssue(issue.id, { status }));
      if (status === "resolved") toast.success("Marked resolved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update this issue."));
    } finally {
      setBusy(null);
    }
  }

  async function uploadProof(files: File[]) {
    setBusy("upload");
    try {
      const added: DocumentRecord[] = [];
      for (const f of files) added.push(await attachIssueDocument(userId, issue, f, "proof"));
      setDocs((cur) => [...cur, ...added]);
      toast.success(`${added.length} file${added.length === 1 ? "" : "s"} attached.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not upload this file."));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        "Delete this issue? Its reminders are removed too; attached files stay in Documents.",
      )
    )
      return;
    try {
      await deletePropertyIssue(issue.id);
      onDelete();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not delete this issue."));
    }
  }

  const facts: [string, string | null][] = [
    ["Issued", fmtDate(issue.issuedOn)],
    ["Fine / amount due", usd(issue.fineAmount)],
    ["From", issue.authority],
    ["Contact", issue.authorityContact],
  ];
  const next = nextStatus(issue.status);

  return (
    <article className="card-elev p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[issue.status]}`}
            >
              {statusLabel(issue.status)}
            </span>
            <span className="text-xs text-muted-foreground">{categoryLabel(issue.category)}</span>
          </div>
          <h3 className="mt-1 font-semibold">{issue.title}</h3>
          <div className="text-xs text-muted-foreground">{property?.address ?? "Property"}</div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-xs font-medium text-accent hover:underline"
        >
          {expanded ? "Hide details" : "Details"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 grid gap-3 text-sm">
          {issue.guidance ? (
            <GuidancePanel guidance={issue.guidance} />
          ) : (
            issue.status !== "resolved" && (
              <button
                type="button"
                onClick={getGuidance}
                disabled={!!busy || !property}
                className="btn-outline inline-flex w-fit items-center gap-1.5 text-xs disabled:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                {busy === "guidance" ? "Working it out…" : "What should I do?"}
              </button>
            )
          )}
          {issue.requiredAction && (
            <p>
              <span className="font-medium">Required action: </span>
              {issue.requiredAction}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
          </dl>
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              Key dates — reminders follow these
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DATE_FIELDS.map((f) => (
                <label key={f.key} className="grid gap-0.5 text-xs">
                  {f.label}
                  <input
                    type="date"
                    value={issue[f.key] ?? ""}
                    disabled={busy === f.key || issue.status === "resolved"}
                    onChange={(e) => void setDate(f.key, e.target.value || null)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-60"
                  />
                </label>
              ))}
            </div>
          </div>
          {issue.status !== "resolved" && property && (
            <ServiceHelp issue={issue} property={property} />
          )}
          {issue.consequences && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">If not resolved: </span>
              {issue.consequences}
            </p>
          )}

          <div>
            <div className="text-xs font-medium text-muted-foreground">
              Notice, proof &amp; photos
            </div>
            {docs.length > 0 ? (
              <ul className="mt-1 grid gap-1">
                {docs.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() =>
                        getDocumentUrl(d.storagePath)
                          .then((u) => window.open(u, "_blank", "noopener"))
                          .catch(() => toast.error("Could not open this file."))
                      }
                      className="text-xs text-accent underline"
                    >
                      {d.fileName}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Nothing attached yet.</p>
            )}
            <label
              className={`btn-outline mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs ${busy === "upload" ? "pointer-events-none opacity-60" : ""}`}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {busy === "upload" ? "Uploading…" : "Upload proof / photos"}
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  if (files.length) void uploadProof(files);
                }}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-xs">
              Status
              <select
                value={issue.status}
                onChange={(e) => setStatus(e.target.value as IssueStatus)}
                disabled={busy === "status"}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {ISSUE_STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {next && next !== "resolved" && (
              <button
                type="button"
                onClick={() => setStatus(next)}
                disabled={!!busy}
                className="btn-outline text-xs disabled:opacity-60"
              >
                Move to {statusLabel(next)}
              </button>
            )}
            {issue.status !== "resolved" && (
              <button
                type="button"
                onClick={() => setStatus("resolved")}
                disabled={!!busy}
                className="btn-accent inline-flex items-center gap-1.5 text-xs disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Mark resolved
              </button>
            )}
            <button
              type="button"
              onClick={remove}
              aria-label="Delete issue"
              className="ml-auto text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

// The AI's plain-language read of the issue (analyze-property-issue).
function GuidancePanel({ guidance }: { guidance: IssueGuidance }) {
  const rows: [string, string][] = [
    ["What happened", guidance.whatHappened],
    ["What to do", guidance.whatToDo],
    ["By when", guidance.byWhen],
    ["If it isn't resolved", guidance.ifNotResolved],
    ["Who can fix it", guidance.whoToHire],
  ];
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        What this means
      </div>
      <dl className="mt-2 grid gap-2">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {guidance.nextSteps.length > 0 && (
        <>
          <div className="mt-3 text-xs font-medium text-muted-foreground">Next steps</div>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {guidance.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        AI guidance, not legal advice — confirm requirements with the issuing office.
      </p>
    </div>
  );
}

// Cost guidance for the fix plus local providers who do this work
// (Google Places, searched near the property).
function ServiceHelp({ issue, property }: { issue: PropertyIssue; property: PropertyRecord }) {
  const types = providerSearchTypes(issue);
  const [type, setType] = useState(types[0]);
  const [providers, setProviders] = useState<ServiceProvider[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(t: string) {
    setType(t);
    setSearching(true);
    try {
      setProviders(await searchServiceProviders(`${t} near ${property.address}`));
    } catch {
      toast.error("Could not search for providers right now.");
    } finally {
      setSearching(false);
    }
  }

  const c = issue.costEstimate;
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
        Get it fixed
      </div>
      {c && (
        <div className="mt-2">
          <div className="text-xs text-muted-foreground">Typical cost — {c.service}</div>
          <div className="text-lg font-semibold">
            {usd(c.low)}–{usd(c.high)}
          </div>
          <p className="text-xs text-muted-foreground">{c.basis}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => void search(t)}
            disabled={searching}
            className={`btn-outline text-xs capitalize disabled:opacity-60 ${providers && t === type ? "border-accent text-accent" : ""}`}
          >
            Find {t} nearby
          </button>
        ))}
      </div>
      {searching && <p className="mt-2 text-xs text-muted-foreground">Searching…</p>}
      {!searching && providers && providers.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">No providers found nearby.</p>
      )}
      {!searching && providers && providers.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {providers.slice(0, 5).map((p) => (
            <li key={p.id} className="rounded-md bg-muted/40 p-2.5 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-sm">{p.name}</span>
                {p.rating != null && (
                  <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                    {p.rating.toFixed(1)}
                    {p.ratingCount != null && ` (${p.ratingCount})`}
                  </span>
                )}
              </div>
              {p.address && <div className="text-muted-foreground">{p.address}</div>}
              <div className="mt-1 flex flex-wrap gap-3">
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="text-accent underline">
                    {p.phone}
                  </a>
                )}
                {p.website && (
                  <a
                    href={p.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Website
                  </a>
                )}
                {p.mapsUrl && (
                  <a
                    href={p.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Map
                  </a>
                )}
              </div>
            </li>
          ))}
          <li className="text-[11px] text-muted-foreground">
            Listings from Google — CorvusPT doesn&apos;t endorse providers. Get at least two quotes,
            and keep the receipt as proof.
          </li>
        </ul>
      )}
    </div>
  );
}
