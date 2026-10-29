import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { EmptyProject, Loading } from "@/components/dp-ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { listProjects, setActiveProject, updatePermit, type PermitRow } from "@/lib/projects";
import {
  DOC_WORKSPACE_KEY,
  ensurePackage,
  groupDocuments,
  loadWorkspace,
  nextRound,
  setPackageStatus,
  syncSource,
  type PackageRow,
  type SourceRow,
} from "@/lib/doc-workspace";
import {
  ActivityView,
  ApprovedView,
  CollectionSummary,
  CommentsView,
  FilesView,
  HistoryView,
  ImportsView,
  OverviewView,
  PackageView,
  SourcesView,
  type DocCtx,
  type DocDialog,
  type DocView,
} from "@/components/documents/views";
import { DialogBody } from "@/components/documents/dialogs";
import { TRACK_PORTFOLIO_KEY } from "@/lib/track-portfolio";

export const Route = createFileRoute("/dashboard/_layout/documents")({
  head: () => ({ meta: [{ title: "Documents — CorvusDP" }] }),
  component: Documents,
});

const VIEWS: [DocView, string][] = [
  ["sources", "Connected sources"],
  ["imports", "Imported files"],
  ["overview", "Permit overview"],
  ["package", "To be submitted"],
  ["history", "Submission history"],
  ["comments", "Comments & revisions"],
  ["approved", "Approved documents"],
  ["files", "Shared & design files"],
  ["activity", "Sync activity"],
];

// the permitting train-track stations each view belongs to
const RIBBON: [DocView, string][] = [
  ["package", "09 Requirements"],
  ["package", "16 Package readiness"],
  ["history", "18 Submitted"],
  ["history", "19 City review"],
  ["comments", "20 Comments"],
  ["history", "24 Resubmissions"],
  ["approved", "27 Approvals"],
];

function Documents() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { loading, hasProject, project } = useActiveProjectBundle();
  const projectId = project?.id;
  const projects = useQuery({
    queryKey: ["projects", user?.id],
    queryFn: () => listProjects(user!.id),
    enabled: !!user,
  });
  const ws = useQuery({
    queryKey: [DOC_WORKSPACE_KEY, projectId],
    queryFn: () => loadWorkspace(projectId!),
    enabled: !!projectId,
  });
  const [view, setView] = useState<DocView>("sources");
  const [permitId, setPermitId] = useState<string>("all");
  const [roundId, setRoundId] = useState<string>("all");
  const [q, setQ] = useState("");
  const [stack, setStack] = useState<DocDialog[]>([]);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);

  const data = ws.data;
  const versions = useMemo(
    () => new Map((data?.versions ?? []).map((v) => [v.id, v])),
    [data?.versions],
  );
  const groups = useMemo(() => groupDocuments(data?.versions ?? []), [data?.versions]);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;
  if (ws.isLoading || !data) return <Loading />;

  const permit = data.permits.find((p) => p.id === permitId) ?? null;
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: [DOC_WORKSPACE_KEY] }),
      qc.invalidateQueries({ queryKey: [TRACK_PORTFOLIO_KEY] }),
      qc.invalidateQueries({ queryKey: ["documents"] }),
    ]);
  const open = (d: DocDialog) => setStack((s) => [...s, d]);
  const go = (v: DocView, pid?: string | null) => {
    setView(v);
    if (pid !== undefined) setPermitId(pid ?? "all");
    setRoundId(v === "package" ? "working" : "all");
    setStack([]);
  };

  async function freeze(p: PermitRow) {
    try {
      const pkg = await ensurePackage(project!.id, p.id, nextRound(data!.submissions, p.id));
      await setPackageStatus(pkg.id, "frozen");
      await refresh();
      toast.success("Package frozen. It isn't submitted until you record the filing.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't freeze the package.");
    }
  }
  async function reopen(pkg: PackageRow) {
    try {
      await setPackageStatus(pkg.id, "draft");
      await refresh();
      toast.success("Draft reopened. The frozen list is kept in the package's history.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reopen.");
    }
  }
  async function recordSubmission(p: PermitRow) {
    const first = !data!.submissions.some((s) => s.permit_id === p.id);
    try {
      await updatePermit(
        p.id,
        first
          ? { status: "submitted", submitted_at: new Date().toISOString() }
          : { status: "resubmitted" },
      );
      await refresh();
      toast.success(
        `Submission ${nextRound(data!.submissions, p.id)} recorded — the frozen file list is kept as what it sent.`,
      );
      go("history", p.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't record the submission.");
    }
  }
  async function syncNow(s: SourceRow) {
    setSyncing((x) => new Set(x).add(s.id));
    try {
      const r = await syncSource(s.id);
      await refresh();
      toast.success(
        r.checked
          ? `Checked ${s.name}: ${r.checked} waiting file(s) re-matched, ${r.improved ?? 0} updated.`
          : `Checked ${s.name}: nothing waiting. New email is collected as it arrives.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't check this source.");
    } finally {
      setSyncing((x) => {
        const n = new Set(x);
        n.delete(s.id);
        return n;
      });
    }
  }

  const c: DocCtx = {
    ws: data,
    permit,
    roundId,
    q,
    versions,
    groups,
    open,
    go,
    freeze,
    reopen,
    recordSubmission,
    syncNow,
    syncing,
    projectId: project.id,
    userId: user!.id,
  };
  const pending = data.imports.filter(
    (i) =>
      (i.status === "ready" || i.status === "needs_review") &&
      (!permit || i.permit_id === permit.id),
  ).length;
  const rounds = permit ? data.submissions.filter((s) => s.permit_id === permit.id) : [];
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length)
      open({ type: "upload", files: Array.from(e.dataTransfer.files) });
  };
  const body =
    view === "sources" ? (
      <SourcesView c={c} />
    ) : view === "imports" ? (
      <ImportsView c={c} />
    ) : view === "overview" ? (
      <OverviewView c={c} />
    ) : view === "package" ? (
      <PackageView c={c} />
    ) : view === "history" ? (
      <HistoryView c={c} />
    ) : view === "comments" ? (
      <CommentsView c={c} />
    ) : view === "approved" ? (
      <ApprovedView c={c} />
    ) : view === "files" ? (
      <FilesView c={c} />
    ) : (
      <ActivityView c={c} />
    );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Project / Permit / Submission
          </div>
          <h1 className="font-serif text-2xl font-semibold leading-tight">
            Documents &amp; connected sources
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Collect from the project inbox and city portal emails. Keep every file linked to its
            project, permit and exact submission version.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-accent" onClick={() => open({ type: "connect" })}>
            Connect a source
          </button>
          <button type="button" className="btn-outline" onClick={() => open({ type: "upload" })}>
            Upload documents
          </button>
        </div>
      </header>

      <section
        aria-label="Document filters"
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Project
          <select
            className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm font-normal normal-case text-foreground"
            value={project.id}
            onChange={async (e) => {
              await setActiveProject(e.target.value);
              setPermitId("all");
              setRoundId("all");
              await Promise.all([
                qc.invalidateQueries({ queryKey: ["active-project"] }),
                qc.invalidateQueries({ queryKey: ["projects"] }),
              ]);
            }}
          >
            {(projects.data ?? [project]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.address}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Permit application
          <select
            className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm font-normal normal-case text-foreground"
            value={permitId}
            onChange={(e) => {
              setPermitId(e.target.value);
              setRoundId(view === "package" ? "working" : "all");
            }}
          >
            <option value="all">All permit applications</option>
            {data.permits.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.permit_number ? ` / ${p.permit_number}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Submission
          <select
            className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm font-normal normal-case text-foreground disabled:opacity-60"
            value={roundId}
            disabled={!permit || ["sources", "imports", "activity"].includes(view)}
            onChange={(e) => {
              setRoundId(e.target.value);
              setView(e.target.value === "working" ? "package" : "history");
            }}
          >
            <option value="all">All submitted rounds</option>
            {permit && permit.status !== "approved" && (
              <option value="working">
                Working package / next {nextRound(data.submissions, permit.id)}
              </option>
            )}
            {rounds.map((s) => (
              <option key={s.id} value={s.id}>
                Submission {s.round}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Search this view
          <input
            type="search"
            className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm font-normal normal-case text-foreground"
            placeholder="Document, requirement, comment…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </section>

      <section
        aria-label="Document upload area"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-dashed px-4 py-3",
          dragging ? "border-emerald-600 bg-emerald-50" : "border-border bg-card",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Upload className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Need to add a document manually?</h2>
            <p className="text-xs text-muted-foreground">
              Drag files here or browse. Manual uploads use the same project, permit and version
              records.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-outline px-2.5 py-1 text-xs"
          onClick={() => open({ type: "upload" })}
        >
          Browse files
        </button>
      </section>

      <nav
        aria-label="Train-track links"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]"
      >
        {RIBBON.map(([v, label], i) => (
          <span key={label} className="flex shrink-0 items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <button
              type="button"
              onClick={() => go(v)}
              className={cn(
                "rounded-md px-2 py-1 font-bold",
                view === v
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          </span>
        ))}
        <Link
          to="/dashboard/track-map"
          className="ml-2 shrink-0 font-semibold text-accent hover:underline"
        >
          Open Track Map
        </Link>
      </nav>

      <nav
        aria-label="Document views"
        className="flex flex-wrap gap-1.5 border-b border-border pb-2"
      >
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-current={view === v ? "page" : undefined}
            onClick={() => go(v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold",
              view === v
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
            {v === "imports" && pending > 0 && (
              <span
                className={cn(
                  "rounded px-1.5 text-[10px]",
                  view === v ? "bg-white/25" : "bg-amber-100 text-amber-900",
                )}
              >
                {pending}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div aria-live="polite" className="min-w-0">
        {view !== "sources" && <CollectionSummary c={c} />}
        {body}
      </div>

      <footer className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Times shown in US Central time.</span>
        <span>Uploaded ≠ Ready ≠ Submitted ≠ City approved.</span>
      </footer>

      <Dialog open={stack.length > 0} onOpenChange={(o) => !o && setStack([])}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
          <DialogTitle className="sr-only">Document details</DialogTitle>
          {stack.length > 1 && (
            <button
              type="button"
              className="btn-outline w-fit px-2.5 py-1 text-xs"
              onClick={() => setStack((s) => s.slice(0, -1))}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
            </button>
          )}
          {stack.length > 0 && (
            <DialogBody
              key={JSON.stringify(stack[stack.length - 1], (_k, v) =>
                v instanceof File ? v.name : v,
              )}
              d={stack[stack.length - 1]}
              c={c}
              refresh={refresh}
              close={() => setStack([])}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
