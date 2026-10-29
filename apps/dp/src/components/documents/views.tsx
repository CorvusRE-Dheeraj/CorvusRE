// The Documents page's views (see routes/dashboard/_layout.documents.tsx):
// connected sources, imported files, permit overview, the working package to
// be submitted, submission history, comments, approved documents, shared
// files and sync activity — all from the project's real records.
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileText,
  FolderOpen,
  Inbox,
  Landmark,
  Mail,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/dp-ui";
import type { PermitRow } from "@/lib/projects";
import {
  IMPORT_LABEL,
  PREP_LABEL,
  RELEASE_LABEL,
  changeVsPrevious,
  formatBytes,
  groupOf,
  inboxAddress,
  isReady,
  nextRound,
  packageBlockers,
  permitRequirements,
  prepOf,
  type DocGroup,
  type ImportRow,
  type ImportStatus,
  type PackageRow,
  type PrepStatus,
  type SourceRow,
  type VersionRow,
  type Workspace,
} from "@/lib/doc-workspace";
import { destinationLabel, importTone, openRoundComments, prepTone, releaseTone } from "./helpers";
import {
  OUTCOME_LABEL,
  cityClock,
  engineerWindow,
  fmtDate,
  fmtDays,
  fmtStamp,
  permitRounds,
} from "@/lib/permit-history";

export type DocView =
  | "sources"
  | "imports"
  | "overview"
  | "package"
  | "history"
  | "comments"
  | "approved"
  | "files"
  | "activity";

export type DocDialog =
  | { type: "doc"; id: string }
  | { type: "req"; id: string }
  | {
      type: "upload";
      permitId?: string | null;
      requirementId?: string | null;
      docGroup?: string | null;
      submissionId?: string | null;
      files?: File[];
    }
  | { type: "import"; id: string }
  | { type: "source"; id: string }
  | { type: "connect" }
  | { type: "submission"; id: string }
  | { type: "release"; id: string };

export type DocCtx = {
  ws: Workspace;
  permit: PermitRow | null; // the permit filter
  roundId: string; // "all" | "working" | submission id
  q: string;
  versions: Map<string, VersionRow>;
  groups: DocGroup[];
  open: (d: DialogArg) => void;
  go: (view: DocView, permitId?: string | null) => void;
  freeze: (permit: PermitRow) => void;
  reopen: (pkg: PackageRow) => void;
  recordSubmission: (permit: PermitRow) => void;
  syncNow: (source: SourceRow) => void;
  syncing: Set<string>;
  projectId: string;
  userId: string;
};
type DialogArg = DocDialog;

// ── small pieces ────────────────────────────────────────────────────────────
export function ViewHead({
  title,
  text,
  actions,
}: {
  title: string;
  text: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 mt-1 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "ok";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "my-3 rounded-lg border px-4 py-3 text-sm",
        tone === "info" && "border-blue-200 bg-blue-50/70 text-slate-700",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-900",
      )}
    >
      {children}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

const SOURCE_ICON = { email: Mail, portal: Landmark, folder: FolderOpen };
export function SourceIcon({ type, className }: { type: SourceRow["type"]; className?: string }) {
  const I = SOURCE_ICON[type] ?? Inbox;
  return <I className={className ?? "h-4 w-4"} aria-hidden />;
}

export function VersionLink({ v, open }: { v: VersionRow | undefined; open: DocCtx["open"] }) {
  if (!v) return <span className="text-muted-foreground">No file received</span>;
  return (
    <button
      type="button"
      className="text-left font-medium text-accent underline-offset-2 hover:underline"
      onClick={() => open({ type: "doc", id: v.id })}
    >
      {v.name}
      {v.version_label ? ` · ${v.version_label}` : ""}
    </button>
  );
}

const matches = (q: string, ...parts: (string | null | undefined)[]) =>
  !q || parts.join(" ").toLowerCase().includes(q.toLowerCase());

const sourceScope = (c: DocCtx, s: SourceRow) =>
  !c.permit || s.permit_ids.length === 0 || s.permit_ids.includes(c.permit.id);
const importScope = (c: DocCtx, i: ImportRow) => !c.permit || i.permit_id === c.permit.id;
const waiting = (i: ImportRow) => i.status === "ready" || i.status === "needs_review";

export function CollectionSummary({ c }: { c: DocCtx }) {
  const sources = c.ws.sources.filter((s) => sourceScope(c, s));
  const pending = c.ws.imports.filter((i) => importScope(c, i) && waiting(i)).length;
  const attention = sources.filter((s) => s.status !== "connected").length;
  return (
    <section className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
      <Inbox className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
      <div className="min-w-[180px] flex-1 text-sm">
        <b>
          {sources.filter((s) => s.status === "connected").length} connected source
          {sources.length === 1 ? "" : "s"} · {pending} import{pending === 1 ? "" : "s"} to review
        </b>
        <div className="text-xs text-emerald-900/80">
          {attention
            ? `${attention} source${attention === 1 ? "" : "s"} need attention.`
            : "Collected files land in the same project, permit and version records."}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-outline px-2.5 py-1 text-xs"
          onClick={() => c.go("sources")}
        >
          Connected sources
        </button>
        <button
          type="button"
          className="btn-outline px-2.5 py-1 text-xs"
          onClick={() => c.go("imports")}
        >
          Review imports
        </button>
      </div>
    </section>
  );
}

// ── connected sources ───────────────────────────────────────────────────────
export function SourcesView({ c }: { c: DocCtx }) {
  const srcs = c.ws.sources.filter((s) => sourceScope(c, s));
  const shown = srcs.filter((s) => matches(c.q, s.name, s.provider, s.reference, s.status));
  const imports = c.ws.imports.filter((i) => importScope(c, i));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Connected collection
          </div>
          <h2 className="mt-1 text-xl font-semibold">
            Bring documents in. Keep every version connected.
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Collect files emailed to this project's own inbox — from consultants, the owner and city
            portal notifications. Corvus AI suggests where each belongs; you confirm uncertain
            matches before they enter the repository.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-accent" onClick={() => c.open({ type: "connect" })}>
            Connect a source
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={!srcs.some((s) => s.status === "connected")}
            onClick={() => srcs.filter((s) => s.status === "connected").forEach(c.syncNow)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Sync now
          </button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs font-semibold text-emerald-900">
        {[
          "Detect new files",
          "Check duplicates",
          "Suggest a match",
          "Review exceptions",
          "File exact versions",
        ].map((t, i) => (
          <span key={t} className="flex items-center gap-2">
            {i > 0 && <span className="text-emerald-600">→</span>}
            <span className="grid h-5 w-5 place-items-center rounded-full border border-emerald-300 bg-white text-[10px]">
              {i + 1}
            </span>
            {t}
          </span>
        ))}
        <span className="ml-auto font-normal text-emerald-800/80">
          Collection is not submission.
        </span>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Connected sources"
          value={
            <>
              {srcs.filter((s) => s.status === "connected").length}
              <span className="text-sm font-normal text-muted-foreground"> / {srcs.length}</span>
            </>
          }
          hint="Project inbox and city portal notifications"
        />
        <Kpi
          label="Awaiting filing / review"
          value={imports.filter(waiting).length}
          hint={`${imports.filter((i) => i.status === "needs_review").length} need a person to confirm the match`}
        />
        <Kpi
          label="Duplicates skipped"
          value={imports.filter((i) => i.status === "duplicate").length}
          hint="Checked by file content, not file name"
        />
        <Kpi
          label="Connection attention"
          value={srcs.filter((s) => s.status !== "connected").length}
          hint="Disconnected, setup or sync issues"
        />
      </div>
      <ViewHead
        title="Connected document sources"
        text="Each connection belongs to this project and the permits you link it to."
        actions={
          <button
            type="button"
            className="btn-outline px-2.5 py-1 text-xs"
            onClick={() => c.go("activity")}
          >
            View sync activity
          </button>
        }
      />
      {shown.length ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((s) => (
            <SourceCard key={s.id} s={s} c={c} />
          ))}
        </div>
      ) : (
        <Empty
          title="No sources connected yet"
          text="Start with the project inbox: forward or CC emails with drawings, letters and portal notifications to it, and they'll be collected here for review."
          action={
            <button
              type="button"
              className="btn-accent"
              onClick={() => c.open({ type: "connect" })}
            >
              Connect a source
            </button>
          }
        />
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">Review the uncertain matches</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm the permit, document revision and destination. A file without submission-round
            evidence stays unassigned.
          </p>
          <button
            type="button"
            className="btn-outline mt-3 px-2.5 py-1 text-xs"
            onClick={() => c.go("imports")}
          >
            Open imported files
          </button>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">Earlier submissions stay untouched</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            New drawings become working revisions. City letters and receipts are supporting records
            — never silent changes to what a round sent.
          </p>
          <button
            type="button"
            className="btn-outline mt-3 px-2.5 py-1 text-xs"
            onClick={() => c.go("history")}
          >
            View submission history
          </button>
        </section>
      </div>
    </>
  );
}

function SourceCard({ s, c }: { s: SourceRow; c: DocCtx }) {
  const pending = c.ws.imports.filter((i) => i.source_id === s.id && waiting(i)).length;
  const issue = s.status !== "connected";
  const address = s.type === "email" ? inboxAddress(s) : "";
  const inbox = c.ws.sources.find((x) => x.type === "email" && x.status === "connected");
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 shadow-sm",
        issue && "border-t-4 border-t-amber-400",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
            s.type === "email"
              ? "bg-violet-50 text-violet-700"
              : s.type === "portal"
                ? "bg-amber-50 text-amber-800"
                : "bg-emerald-50 text-emerald-700",
          )}
        >
          <SourceIcon type={s.type} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug">{s.name}</h3>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {s.provider}
            {s.reference ? ` · ${s.reference}` : ""}
          </p>
        </div>
        <Pill
          tone={s.status === "connected" ? "green" : s.status === "sync_failed" ? "red" : "amber"}
        >
          {s.status === "connected"
            ? "Connected"
            : s.status === "needs_setup"
              ? "Needs setup"
              : s.status === "sync_failed"
                ? "Sync failed"
                : "Disconnected"}
        </Pill>
      </div>
      {address && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]">{address}</span>
          <button
            type="button"
            className="btn-outline px-2 py-0.5 text-[11px]"
            onClick={() => {
              void navigator.clipboard?.writeText(address);
              toast.success("Project inbox address copied.");
            }}
          >
            <Copy className="h-3 w-3" aria-hidden /> Copy
          </button>
        </div>
      )}
      {s.type === "portal" && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
          Collects this portal's notification emails
          {s.match_domains.length ? ` from ${s.match_domains.join(", ")}` : ""} sent to{" "}
          {inbox ? (
            <span className="font-mono">{inboxAddress(inbox)}</span>
          ) : (
            "the project inbox (connect it first)"
          )}
          . Set the portal's notification email to that address.
        </p>
      )}
      <dl className="my-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Last successful check</dt>
          <dd>{s.last_success ? fmtStamp(s.last_success) : "Nothing collected yet"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last attempted check</dt>
          <dd>{s.last_attempt ? fmtStamp(s.last_attempt) : "Not attempted"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Collection</dt>
          <dd>{s.type === "folder" ? "Needs folder access" : "As each email arrives"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Filing policy</dt>
          <dd>{s.auto_file ? "Auto-file exact matches as Received" : "Review before filing"}</dd>
        </div>
      </dl>
      <div className="mb-3 flex flex-wrap gap-1">
        {(s.permit_ids.length ? s.permit_ids : c.ws.permits.map((p) => p.id)).map((id) => {
          const p = c.ws.permits.find((x) => x.id === id);
          return p ? (
            <span
              key={id}
              className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]"
            >
              {p.name}
              {p.permit_number ? ` / ${p.permit_number}` : ""}
            </span>
          ) : null;
        })}
      </div>
      {s.message && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{s.message}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {pending} import{pending === 1 ? "" : "s"} awaiting review
        </span>
        <div className="flex flex-wrap gap-2">
          {s.status === "connected" && (
            <button
              type="button"
              className="btn-outline px-2.5 py-1 text-xs"
              disabled={c.syncing.has(s.id)}
              onClick={() => c.syncNow(s)}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", c.syncing.has(s.id) && "animate-spin")}
                aria-hidden
              />
              {c.syncing.has(s.id) ? "Checking…" : "Sync"}
            </button>
          )}
          <button
            type="button"
            className="btn-outline px-2.5 py-1 text-xs"
            onClick={() => c.open({ type: "source", id: s.id })}
          >
            Manage
          </button>
        </div>
      </div>
    </article>
  );
}

// ── imported files ──────────────────────────────────────────────────────────
export function ImportsView({ c }: { c: DocCtx }) {
  const [tab, setTab] = useState<"pending" | ImportStatus | "all">("pending");
  const [source, setSource] = useState("all");
  const scoped = c.ws.imports.filter((i) => importScope(c, i));
  let items = scoped
    .filter((i) => source === "all" || i.source_id === source)
    .filter((i) => matches(c.q, i.filename, i.title, i.subject, i.from_address, i.status));
  items =
    tab === "pending"
      ? items.filter(waiting)
      : tab === "all"
        ? items
        : items.filter((i) => i.status === tab);
  const tabs: [typeof tab, string][] = [
    ["pending", `To review (${scoped.filter(waiting).length})`],
    ["filed", "Filed"],
    ["duplicate", "Duplicates"],
    ["link_only", "Link notifications"],
    ["all", "All imports"],
  ];
  return (
    <>
      <ViewHead
        title="Imported files"
        text="Review each collected file and its suggested match before it's used in a package."
        actions={
          <button
            type="button"
            className="btn-outline px-2.5 py-1 text-xs"
            onClick={() => c.open({ type: "upload" })}
          >
            Manual upload
          </button>
        }
      />
      <Notice>
        <b>Imported doesn't mean submitted or approved.</b> Filing adds a Received working draft.
        City letters and receipts can be linked to a round as supporting records; they never change
        what that round sent.
      </Notice>
      <div className="my-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Import status">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-semibold",
                tab === id
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-card hover:bg-muted/50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-xs text-muted-foreground">
          Source{" "}
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="all">All sources</option>
            {c.ws.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {items.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {[
                  "Collected file",
                  "Source / received",
                  "Suggested location",
                  "Import state",
                  "",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const s = c.ws.sources.find((x) => x.id === i.source_id);
                const p = c.ws.permits.find((x) => x.id === i.permit_id);
                return (
                  <tr key={i.id} className="border-t border-border align-top">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        className="text-left font-medium text-accent hover:underline [overflow-wrap:anywhere]"
                        onClick={() => c.open({ type: "import", id: i.id })}
                      >
                        {i.filename}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {i.revision ?? "No revision"} · {i.doc_kind ?? "—"} ·{" "}
                        {formatBytes(i.size_bytes)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        {s && (
                          <SourceIcon type={s.type} className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {s?.name ?? "Removed source"}
                      </div>
                      <div className="text-muted-foreground">{i.from_address}</div>
                      <div className="text-muted-foreground">
                        Collected {fmtStamp(i.collected_at)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {p
                        ? `${p.name}${p.permit_number ? ` / ${p.permit_number}` : ""}`
                        : "Shared project file"}
                      <div
                        className={cn(
                          i.destination === "library"
                            ? "font-semibold text-amber-800"
                            : "text-muted-foreground",
                        )}
                      >
                        {destinationLabel(c, i.destination, i.permit_id)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={importTone(i.status)}>{IMPORT_LABEL[i.status]}</Pill>
                      <div className="mt-1 text-xs text-muted-foreground">{i.match_summary}</div>
                      {i.confidence != null && waiting(i) && (
                        <div
                          className={cn(
                            "mt-1 inline-block rounded px-1.5 py-0.5 text-[10px]",
                            i.confidence >= 0.85
                              ? "bg-sky-50 text-sky-800"
                              : "bg-amber-50 text-amber-800",
                          )}
                        >
                          {Math.round(i.confidence * 100)}% match confidence
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        className="btn-outline px-2.5 py-1 text-xs"
                        onClick={() => c.open({ type: "import", id: i.id })}
                      >
                        {i.status === "filed"
                          ? "View record"
                          : i.status === "duplicate"
                            ? "View duplicate"
                            : i.status === "link_only"
                              ? "View notification"
                              : i.status === "ignored"
                                ? "View"
                                : "Review match"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No imports in this view"
          text={
            tab === "pending"
              ? "Nothing is waiting. Files emailed to the project inbox appear here as they arrive."
              : "Change the status or source filter."
          }
        />
      )}
    </>
  );
}

// ── permit overview ─────────────────────────────────────────────────────────
export function OverviewView({ c }: { c: DocCtx }) {
  const permits = c.permit ? [c.permit] : c.ws.permits;
  const shown = permits.filter((p) => matches(c.q, p.name, p.permit_number, p.status));
  const missing = permits
    .flatMap((p) => permitRequirements(c.ws, p))
    .filter((r) => r.required && !r.document_id).length;
  const openComments = c.ws.comments.filter(
    (cm) =>
      permits.some((p) => p.permit_key === cm.permit_key) &&
      !["addressed", "closed"].includes(cm.status),
  ).length;
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Permit applications"
          value={permits.length}
          hint="Each with its own requirements and review cycle"
        />
        <Kpi
          label="Confirmed submissions"
          value={c.ws.submissions.filter((s) => permits.some((p) => p.id === s.permit_id)).length}
          hint="The exact versions each round sent are kept"
        />
        <Kpi label="Missing documents" value={missing} hint="Required documents with no file yet" />
        <Kpi label="Open review comments" value={openComments} hint="Need a documented response" />
      </div>
      <ViewHead
        title="Every permit, its own document trail"
        text="Open a permit to prepare its next package, or see exactly what each round sent."
      />
      {shown.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <PermitCard key={p.id} p={p} c={c} />
          ))}
        </div>
      ) : (
        <Empty
          title="No permits yet"
          text="Permits appear here once the project's analysis identifies them."
        />
      )}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">The same file, different uses</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            A shared document — a survey, say — is stored once. Every submitted round points at the
            exact version it sent, even after newer revisions arrive.
          </p>
          <button
            type="button"
            className="btn-outline mt-3 px-2.5 py-1 text-xs"
            onClick={() => c.go("files")}
          >
            Shared &amp; design files
          </button>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">Three statuses, three meanings</h3>
          <ul className="mt-2 grid gap-1.5 text-sm">
            <li>
              <b>Document</b> — checked internally and released for permitting.
            </li>
            <li>
              <b>Package</b> — prepared, frozen, then submitted with the permit.
            </li>
            <li>
              <b>Permit</b> — under review, comments received, or approved by the city.
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}

function PermitCard({ p, c }: { p: PermitRow; c: DocCtx }) {
  const subs = c.ws.submissions.filter((s) => s.permit_id === p.id);
  const last = subs.at(-1);
  const reqs = permitRequirements(c.ws, p);
  const ready = reqs.filter((r) => isReady(r, c.versions)).length;
  const approved = p.status === "approved";
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-700">
          <FileText className="h-5 w-5" aria-hidden />
        </span>
        <Pill
          tone={
            approved
              ? "green"
              : p.status === "comments"
                ? "amber"
                : ["submitted", "under_review", "resubmitted"].includes(p.status)
                  ? "blue"
                  : "gray"
          }
        >
          {p.status.replace(/_/g, " ")}
        </Pill>
      </div>
      <h3 className="mt-3 font-semibold">{p.name}</h3>
      <div className="font-mono text-[11px] text-muted-foreground">
        {p.permit_number ?? "No permit number yet"}
      </div>
      <div className="my-3 h-px bg-border" />
      <Kv k="Latest confirmed round" v={last ? `Submission ${last.round}` : "Not submitted"} />
      <Kv k="Filed on" v={last ? fmtDate(last.submitted_at) : "Not recorded"} />
      {approved ? (
        <Kv k="City approval" v={fmtDate(p.approved_at)} />
      ) : (
        <>
          <Kv k="Next package" v={`Submission ${nextRound(c.ws.submissions, p.id)}`} />
          <Kv k="Required documents ready" v={`${ready} / ${reqs.length}`} />
          <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-muted">
            <i
              className="block h-full bg-emerald-600"
              style={{ width: `${reqs.length ? (ready / reqs.length) * 100 : 0}%` }}
            />
          </div>
        </>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {approved ? (
          <button
            type="button"
            className="btn-accent px-2.5 py-1 text-xs"
            onClick={() => c.go("approved", p.id)}
          >
            View approved files
          </button>
        ) : (
          <button
            type="button"
            className="btn-accent px-2.5 py-1 text-xs"
            onClick={() => c.go("package", p.id)}
          >
            Open working package
          </button>
        )}
        <button
          type="button"
          className="btn-outline px-2.5 py-1 text-xs"
          onClick={() => c.go("history", p.id)}
        >
          History
        </button>
      </div>
    </article>
  );
}

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="my-1 flex justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <strong className="text-right font-semibold">{v}</strong>
    </div>
  );
}

// ── to be submitted ─────────────────────────────────────────────────────────
export function PackageView({ c }: { c: DocCtx }) {
  const [prep, setPrep] = useState<"all" | PrepStatus>("all");
  if (!c.permit) {
    const open = c.ws.permits.filter(
      (p) => p.status !== "approved" && matches(c.q, p.name, p.permit_number),
    );
    return (
      <>
        <ViewHead
          title="To be submitted"
          text="Choose a permit. These are working packages — not submissions to the city."
        />
        {open.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {open.map((p) => {
              const reqs = permitRequirements(c.ws, p);
              const b = packageBlockers(reqs, c.versions, openRoundComments(c, p));
              return (
                <article key={p.id} className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {p.permit_number ?? "No permit number"}
                  </p>
                  <div className="my-3 h-px bg-border" />
                  <Kv k="Working round" v={`Submission ${nextRound(c.ws.submissions, p.id)}`} />
                  <Kv
                    k="Ready documents"
                    v={`${reqs.filter((r) => isReady(r, c.versions)).length} / ${reqs.length}`}
                  />
                  <Kv k="Blocking checks" v={b.length} />
                  <button
                    type="button"
                    className="btn-accent mt-3 px-2.5 py-1 text-xs"
                    onClick={() => c.go("package", p.id)}
                  >
                    Open requirements
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title="No working packages" text="Every permit in this project is approved." />
        )}
      </>
    );
  }
  const p = c.permit;
  if (p.status === "approved")
    return (
      <>
        <ViewHead
          title="To be submitted"
          text={`${p.name}${p.permit_number ? ` / ${p.permit_number}` : ""}`}
        />
        <Empty
          title="This permit is approved"
          text="There's no next package. Any change after approval follows a separate amendment process."
          action={
            <button type="button" className="btn-outline" onClick={() => c.go("approved", p.id)}>
              View approved documents
            </button>
          }
        />
      </>
    );
  const round = nextRound(c.ws.submissions, p.id);
  const pkg = c.ws.packages.find((x) => x.permit_id === p.id && x.round === round);
  const frozen = pkg?.status === "frozen";
  const reqs = permitRequirements(c.ws, p);
  const blockers = packageBlockers(reqs, c.versions, openRoundComments(c, p));
  const last = c.ws.submissions.filter((s) => s.permit_id === p.id).at(-1);
  const shown = reqs.filter(
    (r) =>
      matches(c.q, r.label, r.owner_party, c.versions.get(r.document_id ?? "")?.name) &&
      (prep === "all" || prepOf(r) === prep),
  );
  const ready = reqs.filter((r) => isReady(r, c.versions)).length;
  const selected = new Set(reqs.map((r) => r.document_id).filter(Boolean));
  const staged = c.ws.versions.filter(
    (v) =>
      v.permit_id === p.id &&
      !v.submission_id &&
      !selected.has(v.id) &&
      v.release_status !== "city_approved" &&
      (!last?.submitted_at || v.created_at > last.submitted_at),
  );
  return (
    <>
      <section className="mb-4 grid gap-4 rounded-xl border border-border bg-card p-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {p.name}
            {p.permit_number ? ` / ${p.permit_number}` : ""}
          </div>
          <h3 className="mt-1 text-lg font-semibold">
            Submission {round} · {frozen ? "Frozen working package" : "Next working package"}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <Pill tone={frozen ? "blue" : "gray"}>{frozen ? "Frozen" : "Draft"}</Pill>
            <span className="text-muted-foreground">Not yet submitted to the city</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-5 text-xs text-muted-foreground">
            <span>
              <b className="text-base text-foreground">
                {ready}/{reqs.length}
              </b>{" "}
              documents ready
            </span>
            <span>
              <b className="text-base text-foreground">
                {reqs.filter((r) => !r.document_id).length}
              </b>{" "}
              missing
            </span>
            <span>
              <b className="text-base text-foreground">{blockers.length}</b> blocking checks
            </span>
          </div>
        </div>
        <div className="flex flex-wrap content-start gap-2 lg:max-w-[380px] lg:justify-end">
          {!frozen && (
            <button
              type="button"
              className="btn-outline"
              onClick={() => c.open({ type: "upload", permitId: p.id })}
            >
              Upload documents
            </button>
          )}
          {frozen ? (
            <>
              <button type="button" className="btn-accent" onClick={() => c.recordSubmission(p)}>
                Record submission
              </button>
              <button type="button" className="btn-outline" onClick={() => pkg && c.reopen(pkg)}>
                Reopen draft
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-accent"
              disabled={blockers.length > 0}
              title={blockers.length ? "Resolve all blocking checks before freezing" : undefined}
              onClick={() => c.freeze(p)}
            >
              Freeze package
            </button>
          )}
        </div>
      </section>
      <Notice tone={blockers.length && !frozen ? "warn" : "info"}>
        {frozen ? (
          <>
            <b>Exact versions frozen.</b> New uploads won't change this list. Record the submission
            once it's filed with the city — the permit moves to Submitted and this list is kept as
            what Submission {round} sent.
          </>
        ) : blockers.length ? (
          <>
            <b>Package isn't ready.</b> Add the missing files, release and review the selected
            versions, and answer the open review comments before freezing.
          </>
        ) : (
          <>
            <b>All checks passed.</b> Freeze these exact versions when you're ready to file.
          </>
        )}
      </Notice>
      <div className="my-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {shown.length} of {reqs.length} requirements · from this permit's submission checklist
        </span>
        <label className="text-xs text-muted-foreground">
          Preparation state{" "}
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            value={prep}
            onChange={(e) => setPrep(e.target.value as typeof prep)}
          >
            <option value="all">All states</option>
            {(Object.keys(PREP_LABEL) as PrepStatus[]).map((s) => (
              <option key={s} value={s}>
                {PREP_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {reqs.length === 0 ? (
        <Empty
          title="No submission checklist for this permit yet"
          text="Requirements come from the permit's submission checklist. Add them on the Checklist page."
          action={
            <Link to="/dashboard/checklist" className="btn-outline">
              Open Checklist
            </Link>
          }
        />
      ) : shown.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {[
                  "Required document",
                  "Selected version",
                  "Preparation state",
                  "Vs. last round",
                  "Owner / due",
                  "",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const v = r.document_id ? c.versions.get(r.document_id) : undefined;
                const change = v
                  ? changeVsPrevious(
                      { requirement_id: r.id, doc_group: groupOf(v), document_id: v.id },
                      last?.manifest,
                    )
                  : null;
                const st = prepOf(r);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        className="text-left font-medium text-accent hover:underline"
                        onClick={() => c.open({ type: "req", id: r.id })}
                      >
                        {r.label}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {r.required ? "Required" : "Optional"} · {r.grp}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {v ? (
                        <>
                          <VersionLink v={v} open={c.open} />
                          <div className="text-muted-foreground">
                            {RELEASE_LABEL[v.release_status]}
                          </div>
                        </>
                      ) : (
                        <Pill tone="red">No file received</Pill>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={prepTone(st)}>{PREP_LABEL[st]}</Pill>
                    </td>
                    <td className="px-3 py-2.5">
                      {change ? (
                        <Pill
                          tone={
                            change === "Revised" ? "amber" : change === "Reused" ? "blue" : "gray"
                          }
                        >
                          {change}
                        </Pill>
                      ) : (
                        <Pill tone="red">Missing</Pill>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.owner_party ?? "Unassigned"}
                      <div className="text-muted-foreground">
                        Due {fmtDate(r.due_date, "not set")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        className="btn-outline px-2.5 py-1 text-xs"
                        onClick={() => c.open({ type: "req", id: r.id })}
                      >
                        {frozen ? "View" : "Manage"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No requirements match" text="Change the preparation filter or search." />
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">Open package checks</h3>
          {blockers.length ? (
            <ul className="mt-2 grid gap-1.5 text-sm">
              {blockers.map((b) => (
                <li key={b.kind + b.id} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
                  {b.kind === "requirement" ? (
                    <button
                      type="button"
                      className="text-left text-accent hover:underline"
                      onClick={() => c.open({ type: "req", id: b.id })}
                    >
                      {b.text}
                    </button>
                  ) : (
                    <Link to="/dashboard/reviews" className="text-accent hover:underline">
                      {b.text}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> No outstanding
              blockers. Freezing is still a separate step.
            </p>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">Previous transmission is preserved</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The next package never changes what an earlier round sent. Check that list before
            choosing replacements.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {last ? (
              <button
                type="button"
                className="btn-outline px-2.5 py-1 text-xs"
                onClick={() => c.open({ type: "submission", id: last.id })}
              >
                Open Submission {last.round}
              </button>
            ) : (
              <Pill tone="gray">First submission</Pill>
            )}
            <button
              type="button"
              className="btn-outline px-2.5 py-1 text-xs"
              onClick={() => c.go("comments", p.id)}
            >
              Comments &amp; revisions
            </button>
          </div>
        </section>
      </div>
      <section className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold">Uploaded for this permit, not yet selected</h3>
            <p className="text-xs text-muted-foreground">
              Received files waiting to be chosen for a requirement. They aren't part of the package
              until selected.
            </p>
          </div>
          {!frozen && (
            <button
              type="button"
              className="btn-outline px-2.5 py-1 text-xs"
              onClick={() => c.open({ type: "upload", permitId: p.id })}
            >
              Upload to this round
            </button>
          )}
        </div>
        {staged.length ? (
          <ul className="mt-3 grid gap-1.5 text-sm">
            {staged.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <VersionLink v={v} open={c.open} />
                <Pill tone={releaseTone(v.release_status)}>{RELEASE_LABEL[v.release_status]}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Nothing waiting.</p>
        )}
      </section>
    </>
  );
}

// ── submission history ──────────────────────────────────────────────────────
export function HistoryView({ c }: { c: DocCtx }) {
  const now = new Date();
  const permits = c.permit ? [c.permit] : c.ws.permits;
  const rows = permits
    .flatMap((p) => permitRounds(p, c.ws.submissions, c.ws.comments).map((r) => ({ p, r })))
    .filter(({ r }) => c.roundId === "all" || c.roundId === "working" || r.id === c.roundId)
    .filter(({ p, r }) => matches(c.q, p.name, p.permit_number, `Submission ${r.round}`, r.outcome))
    .sort((a, b) => (b.r.submitted_at ?? "").localeCompare(a.r.submitted_at ?? ""));
  return (
    <>
      <ViewHead
        title="Submission history"
        text="Every round keeps the exact versions it sent. Working drafts aren't included."
        actions={
          <Link to="/dashboard/track-map" className="btn-outline px-2.5 py-1 text-xs">
            Resubmission Manager
          </Link>
        }
      />
      <Notice>
        <b>Read-only history.</b> City time runs from filing to the city's response. Engineer time
        is one response window — first assignment to last response — not the sum of every
        discipline.
      </Notice>
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {[
                  "Permit / round",
                  "Filed",
                  "City response",
                  "City time",
                  "Engineer window",
                  "Outcome",
                  "Files sent",
                  "",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, r }) => {
                const city = cityClock(r, now);
                const eng = engineerWindow(r, now);
                const sub = c.ws.submissions.find((s) => s.id === r.id);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2.5">
                      <b>{p.name}</b>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {p.permit_number ?? "—"}
                      </div>
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => c.open({ type: "submission", id: r.id })}
                      >
                        Submission {r.round}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{fmtDate(r.submitted_at)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.city_returned_at ? fmtDate(r.city_returned_at) : "Awaiting response"}
                      <div className="text-muted-foreground">
                        Expected {fmtDate(r.expected_at, "not estimated")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {city.value == null ? city.state : fmtDays(city.value)}
                      {city.state === "Ongoing" && (
                        <div className="text-muted-foreground">Ongoing</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {eng.value == null ? eng.state : fmtDays(eng.value)}
                      {eng.state === "Ongoing" && (
                        <div className="text-muted-foreground">Ongoing</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill
                        tone={
                          r.outcome === "approved"
                            ? "green"
                            : r.outcome === "comments"
                              ? "amber"
                              : "blue"
                        }
                      >
                        {OUTCOME_LABEL[r.outcome]}
                      </Pill>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {sub?.manifest
                        ? `${sub.manifest.length} file${sub.manifest.length === 1 ? "" : "s"}`
                        : "Not recorded"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        className="btn-outline px-2.5 py-1 text-xs"
                        onClick={() => c.open({ type: "submission", id: r.id })}
                      >
                        View package
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No confirmed submissions"
          text="Nothing has been filed with the city in this selection. Requirements for the next package are under To be submitted."
        />
      )}
    </>
  );
}

// ── comments ────────────────────────────────────────────────────────────────
export function CommentsView({ c }: { c: DocCtx }) {
  const permits = c.permit ? [c.permit] : c.ws.permits;
  const keys = new Set(permits.map((p) => p.permit_key));
  const round = c.ws.submissions.find((s) => s.id === c.roundId);
  const list = c.ws.comments
    .filter((cm) => cm.permit_key && keys.has(cm.permit_key))
    .filter((cm) => !round || cm.round === round.round)
    .filter((cm) => matches(c.q, cm.original, cm.plain_language, cm.responsible, cm.status));
  return (
    <>
      <ViewHead
        title="Comments & revisions"
        text="City comment → responsible person → revised document → verified response."
        actions={
          <Link to="/dashboard/reviews" className="btn-outline px-2.5 py-1 text-xs">
            Open Reviews
          </Link>
        }
      />
      <Notice tone="warn">
        <b>Addressed isn't city-accepted.</b> An internal check lets a response go into the next
        package; the city's acceptance is a separate event.
      </Notice>
      {list.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {[
                  "City comment",
                  "Permit / round",
                  "Assigned to",
                  "Response state",
                  "Responded / verified",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((cm) => {
                const p = c.ws.permits.find((x) => x.permit_key === cm.permit_key);
                return (
                  <tr key={cm.id} className="border-t border-border align-top">
                    <td className="max-w-md px-3 py-2.5">
                      <Link to="/dashboard/reviews" className="text-accent hover:underline">
                        {(cm.plain_language || cm.original).slice(0, 140)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {p?.name}
                      <div className="text-muted-foreground">
                        {cm.round ? `Submission ${cm.round}` : "Round not recorded"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {cm.responsible ?? "Unassigned"}
                      <div className="text-muted-foreground">
                        Due {fmtDate(cm.due_at, "not set")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill
                        tone={
                          cm.status === "closed"
                            ? "green"
                            : cm.status === "addressed"
                              ? "blue"
                              : "amber"
                        }
                      >
                        {cm.status.replace(/_/g, " ")}
                      </Pill>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        City acceptance: not recorded
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {fmtDate(cm.responded_at, "Not responded")}
                      <div className="text-muted-foreground">
                        {cm.verified_at ? `Verified ${fmtDate(cm.verified_at)}` : "Not verified"}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No review comments in this selection"
          text="A permit under review may not have comments yet — that doesn't mean the city approved its documents."
        />
      )}
    </>
  );
}

// ── approved documents ──────────────────────────────────────────────────────
export function ApprovedView({ c }: { c: DocCtx }) {
  const permits = (c.permit ? [c.permit] : c.ws.permits).filter((p) => p.status === "approved");
  return (
    <>
      <ViewHead
        title="Approved documents"
        text="Issued permits and city-approved plan copies — not internal or owner approvals."
      />
      {permits.length ? (
        permits.map((p) => {
          const files = c.ws.versions.filter(
            (v) => v.permit_id === p.id && v.release_status === "city_approved",
          );
          const lastSub = c.ws.submissions.filter((s) => s.permit_id === p.id).at(-1);
          return (
            <section key={p.id} className="mb-4 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {p.permit_number ?? "No permit number recorded"}
                  </p>
                </div>
                <Pill tone="green">City approved</Pill>
              </div>
              <div className="my-3 grid gap-3 text-xs sm:grid-cols-3">
                <Kv k="Approved on" v={fmtDate(p.approved_at)} />
                <Kv k="Expires on" v={fmtDate(p.expiry_date, "Not recorded")} />
                <Kv
                  k="Approval document"
                  v={
                    p.approval_doc_url ? (
                      <a
                        className="text-accent underline"
                        href={p.approval_doc_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open link
                      </a>
                    ) : (
                      "Not linked"
                    )
                  }
                />
              </div>
              {files.length ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Approved artifact</th>
                        <th className="px-3 py-2">Record type</th>
                        <th className="px-3 py-2">Linked submission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((v) => (
                        <tr key={v.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            <VersionLink v={v} open={c.open} />
                          </td>
                          <td className="px-3 py-2 text-xs">{v.doc_kind ?? "—"}</td>
                          <td className="px-3 py-2 text-xs">
                            {lastSub ? (
                              <button
                                type="button"
                                className="text-accent hover:underline"
                                onClick={() => c.open({ type: "submission", id: lastSub.id })}
                              >
                                Submission {lastSub.round}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No city-approved files uploaded yet.
                </p>
              )}
              <button
                type="button"
                className="btn-outline mt-3 px-2.5 py-1 text-xs"
                onClick={() => c.open({ type: "upload", permitId: p.id })}
              >
                Upload issued permit / approved plans
              </button>
            </section>
          );
        })
      ) : (
        <Empty
          title="No city approvals recorded"
          text="Approved permits appear here with their issued permit and city-approved plans. Mark a permit approved on the Track Map or the Permits page."
        />
      )}
    </>
  );
}

// ── shared & design files ───────────────────────────────────────────────────
export function FilesView({ c }: { c: DocCtx }) {
  const groups = c.groups.filter(
    (g) =>
      (!c.permit || g.versions.some((v) => v.permit_id === c.permit!.id)) &&
      matches(c.q, g.title, g.latest.category, ...g.versions.map((v) => v.name)),
  );
  const uses = (g: DocGroup) =>
    c.ws.submissions.filter((s) => s.manifest?.some((m) => m.doc_group === g.id)).length;
  return (
    <>
      <ViewHead
        title="Shared project & design files"
        text="Manual uploads and collected files, with every version and where each was used."
        actions={
          <>
            <button
              type="button"
              className="btn-outline px-2.5 py-1 text-xs"
              onClick={() => c.go("imports")}
            >
              Review imports
            </button>
            <button
              type="button"
              className="btn-accent px-2.5 py-1 text-xs"
              onClick={() => c.open({ type: "upload" })}
            >
              Upload documents
            </button>
          </>
        }
      />
      <Notice>
        <b>Store once, link by version.</b> A new revision never replaces the version a submitted
        round sent.
      </Notice>
      {groups.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {["Document", "Latest version", "Source", "Release", "Submitted uses", ""].map(
                  (h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const v = g.latest;
                const imp = c.ws.imports.find((i) => i.filed_document_id === v.id);
                const src = imp ? c.ws.sources.find((s) => s.id === imp.source_id) : undefined;
                const n = uses(g);
                return (
                  <tr key={g.id} className="border-t border-border align-top">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        className="text-left font-medium text-accent hover:underline"
                        onClick={() => c.open({ type: "doc", id: v.id })}
                      >
                        {g.title}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {v.category} · {v.doc_kind ?? "Document"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {v.version_label ?? "—"}
                      <div className="text-muted-foreground">
                        {fmtDate(v.created_at)} · {g.versions.length} version
                        {g.versions.length === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        {src && (
                          <SourceIcon
                            type={src.type}
                            className="h-3.5 w-3.5 text-muted-foreground"
                          />
                        )}
                        {src ? src.name : "Manual upload"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={releaseTone(v.release_status)}>
                        {RELEASE_LABEL[v.release_status]}
                      </Pill>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {n} submission{n === 1 ? "" : "s"}
                      <div className="text-muted-foreground">Exact versions kept</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        className="btn-outline px-2.5 py-1 text-xs"
                        onClick={() => c.open({ type: "doc", id: v.id })}
                      >
                        Version history
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No documents yet"
          text="Upload drawings, studies and forms, or connect the project inbox to collect them."
          action={
            <button type="button" className="btn-accent" onClick={() => c.open({ type: "upload" })}>
              Upload documents
            </button>
          }
        />
      )}
    </>
  );
}

// ── sync activity ───────────────────────────────────────────────────────────
export function ActivityView({ c }: { c: DocCtx }) {
  const rows = c.ws.log.filter((l) => matches(c.q, l.result, l.detail));
  return (
    <>
      <ViewHead
        title="Sync activity"
        text="Every collection attempt and decision, kept with its source."
      />
      <div className="rounded-xl border border-border bg-card px-4">
        {rows.length ? (
          rows.map((l) => {
            const s = c.ws.sources.find((x) => x.id === l.source_id);
            const warn = /fail|required|disconnect|ignored|setup/i.test(l.result);
            return (
              <div
                key={l.id}
                className="flex flex-wrap gap-3 border-b border-border py-3 last:border-0"
              >
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                    warn ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700",
                  )}
                >
                  {warn ? "!" : "✓"}
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold">
                    {l.result}
                    {s ? ` · ${s.name}` : ""}
                  </h4>
                  {l.detail && (
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {l.detail}
                    </p>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground">{fmtStamp(l.at)}</div>
              </div>
            );
          })
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
        )}
      </div>
    </>
  );
}
