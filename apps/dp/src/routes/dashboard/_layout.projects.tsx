import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  listProjects,
  listArchivedProjects,
  setActiveProject,
  deleteProject,
  markProjectCompleted,
  reopenProject,
  renameProject,
  type ProjectRow,
} from "@/lib/projects";
import {
  listDesignRequests,
  listArchivedDesignRequests,
  setActiveDesignRequest,
  deleteDesignRequest,
  renameDesignRequest,
  designRequestName,
  type DesignRequestRow,
} from "@/lib/design-requests";
import { scopeLabel } from "@/lib/design";
import { dateShort } from "@/lib/format";
import { myUnreadCounts } from "@/lib/project-chat";
import { Section, inputCls, humanize, Pill } from "@/components/dp-ui";

// Everything the client owns in one place, reached from the account menu:
// open a project (it becomes the one the dashboard shows), rename it, mark a
// permitting project completed, delete, and the archive of completed work.
export const Route = createFileRoute("/dashboard/_layout/projects")({
  head: () => ({ meta: [{ title: "Projects — CorvusDP" }] }),
  component: Projects,
});

function Projects() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!user?.id;
  const projects = useQuery({
    queryKey: ["all-projects", user?.id],
    queryFn: () => listProjects(user!.id),
    enabled,
  });
  const designRequests = useQuery({
    queryKey: ["all-design-requests", user?.id],
    queryFn: () => listDesignRequests(user!.id),
    enabled,
  });
  const archivedProjects = useQuery({
    queryKey: ["archived-projects", user?.id],
    queryFn: () => listArchivedProjects(user!.id),
    enabled,
  });
  const archivedDesign = useQuery({
    queryKey: ["archived-design-requests", user?.id],
    queryFn: () => listArchivedDesignRequests(user!.id),
    enabled,
  });
  // A change here can move the dashboard to a different project, so every
  // cached project view is refreshed.
  const refresh = () => queryClient.invalidateQueries();

  const archived = [
    ...(archivedProjects.data ?? []).map((p) => ({
      kind: "project" as const,
      at: p.completed_at ?? "",
      p,
    })),
    ...(archivedDesign.data ?? []).map((d) => ({
      kind: "design" as const,
      at: d.completed_at ?? "",
      d,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="grid gap-5">
      <Section
        title="Permitting projects"
        subtitle="The dashboard shows the project you opened most recently."
        right={
          <Link to="/permitting/analyze" className="btn-outline text-sm">
            + New permitting project
          </Link>
        }
      >
        <List
          loading={projects.isLoading}
          empty="No permitting projects yet."
          items={(projects.data ?? []).map((p, i) => (
            <PermittingItem key={p.id} project={p} active={i === 0} onChanged={refresh} />
          ))}
        />
      </Section>

      <Section
        title="Design projects"
        subtitle="The design pages show the design project you opened most recently."
        right={
          <Link to="/design/analyze" className="btn-outline text-sm">
            + New design project
          </Link>
        }
      >
        <List
          loading={designRequests.isLoading}
          empty="No design projects yet."
          items={(designRequests.data ?? []).map((d, i) => (
            <DesignItem key={d.id} request={d} active={i === 0} onChanged={refresh} />
          ))}
        />
      </Section>

      <Section
        title="Completed"
        subtitle="Completed projects. Reopen a permitting project to put it back on the dashboard."
      >
        <List
          loading={archivedProjects.isLoading || archivedDesign.isLoading}
          empty="Nothing completed yet."
          items={archived.map((a) =>
            a.kind === "project" ? (
              <ArchivedProjectItem key={a.p.id} project={a.p} onChanged={refresh} />
            ) : (
              <ArchivedDesignItem key={a.d.id} request={a.d} onChanged={refresh} />
            ),
          )}
        />
      </Section>
    </div>
  );
}

function List({ loading, empty, items }: { loading: boolean; empty: string; items: ReactNode[] }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <ul className="grid gap-2">{items}</ul>;
}

/** Opens this project's Project Chat; shows unread replies from the team. */
function ChatLink({ kind, id }: { kind: "permitting" | "design"; id: string }) {
  const { user } = useAuth();
  const unread = useQuery({
    queryKey: ["project-chat-unread", user?.id],
    queryFn: myUnreadCounts,
    enabled: !!user?.id,
  });
  const n = unread.data?.[id] ?? 0;
  return (
    <Link to="/dashboard/chat" search={{ type: kind, id }} className={linkBtn}>
      Chat{n > 0 ? ` (${n} new)` : ""}
    </Link>
  );
}

const linkBtn =
  "inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50";
const quietBtn =
  "inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

/** A project row: name (renamable), one line of detail, then actions. */
function ProjectItem({
  name,
  detail,
  pills,
  onRename,
  children,
}: {
  name: string;
  detail: string;
  pills: ReactNode;
  onRename?: (name: string) => Promise<void>;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!onRename || !draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onRename(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl sm:flex-row sm:flex-wrap sm:items-center sm:justify-between border border-border bg-card p-4 text-sm shadow-[var(--shadow-card)]">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              className={`${inputCls} h-9 max-w-xs`}
              aria-label="Project name"
              maxLength={120}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className={linkBtn} disabled={saving || !draft.trim()}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={quietBtn}
              onClick={() => {
                setDraft(name);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            {name}
            {onRename && (
              <button
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Rename ${name}`}
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {pills}
          </div>
        )}
        <div className="text-xs text-muted-foreground">{detail}</div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}

function Confirm({
  label,
  confirmLabel,
  busyLabel,
  danger,
  busy,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  busyLabel: string;
  danger?: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button
        className={
          danger ? `${quietBtn} hover:!bg-destructive/10 hover:!text-destructive` : linkBtn
        }
        onClick={() => setConfirming(true)}
      >
        {label}
      </button>
    );
  return (
    <>
      <button
        className={
          danger
            ? "inline-flex items-center rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
            : linkBtn
        }
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? busyLabel : confirmLabel}
      </button>
      <button className={quietBtn} onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </>
  );
}

function useBusy(onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      onChanged();
    }
  }
  return { busy, run };
}

function PermittingItem({
  project: p,
  active,
  onChanged,
}: {
  project: ProjectRow;
  active: boolean;
  onChanged: () => void;
}) {
  const nav = useNavigate();
  const { busy, run } = useBusy(onChanged);
  return (
    <ProjectItem
      name={p.name ?? p.address ?? "Property"}
      detail={`Permitting · ${p.address ?? p.city ?? "—"} · ${p.jurisdiction ?? "—"} · ${dateShort(p.created_at)}`}
      pills={
        <>
          {active && <Pill tone="green">On dashboard</Pill>}
          <Pill tone="gray">{humanize(p.stage)}</Pill>
        </>
      }
      onRename={async (name) => {
        await renameProject(p.id, name);
        onChanged();
      }}
    >
      <button
        className={linkBtn}
        disabled={busy}
        onClick={() =>
          run(async () => {
            await setActiveProject(p.id);
            await nav({ to: "/dashboard" });
          })
        }
      >
        Open
      </button>
      <ChatLink kind="permitting" id={p.id} />
      <Confirm
        label="Mark completed"
        confirmLabel="Confirm — mark completed"
        busyLabel="Saving…"
        busy={busy}
        onConfirm={() => run(() => markProjectCompleted(p.id))}
      />
      <Confirm
        label="Delete"
        confirmLabel="Confirm delete"
        busyLabel="Deleting…"
        danger
        busy={busy}
        onConfirm={() => run(() => deleteProject(p.id))}
      />
    </ProjectItem>
  );
}

function DesignItem({
  request: d,
  active,
  onChanged,
}: {
  request: DesignRequestRow;
  active: boolean;
  onChanged: () => void;
}) {
  const nav = useNavigate();
  const { busy, run } = useBusy(onChanged);
  return (
    <ProjectItem
      name={designRequestName(d)}
      detail={`Design · ${d.project_name ? `${d.address ?? d.city ?? "—"} · ` : ""}${scopeLabel((d.scope ?? undefined) as never)} · ${dateShort(d.created_at)}`}
      pills={
        <>
          {active && <Pill tone="green">On design pages</Pill>}
          <Pill tone="gray">{humanize(d.stage)}</Pill>
        </>
      }
      onRename={async (name) => {
        await renameDesignRequest(d.id, name);
        onChanged();
      }}
    >
      <button
        className={linkBtn}
        disabled={busy}
        onClick={() =>
          run(async () => {
            await setActiveDesignRequest(d.id);
            await nav({ to: "/dashboard/design" });
          })
        }
      >
        Open
      </button>
      <ChatLink kind="design" id={d.id} />
      <Confirm
        label="Delete"
        confirmLabel="Confirm delete"
        busyLabel="Deleting…"
        danger
        busy={busy}
        onConfirm={() => run(() => deleteDesignRequest(d.id))}
      />
    </ProjectItem>
  );
}

function ArchivedProjectItem({
  project: p,
  onChanged,
}: {
  project: ProjectRow;
  onChanged: () => void;
}) {
  const { busy, run } = useBusy(onChanged);
  return (
    <ProjectItem
      name={p.name ?? p.address ?? "Property"}
      detail={`Permitting · ${p.jurisdiction ?? "—"} · Completed ${p.completed_at ? dateShort(p.completed_at) : ""}`}
      pills={<Pill tone="green">Completed</Pill>}
    >
      <button className={linkBtn} disabled={busy} onClick={() => run(() => reopenProject(p.id))}>
        Reopen
      </button>
      <ChatLink kind="permitting" id={p.id} />
      <Confirm
        label="Delete"
        confirmLabel="Confirm delete"
        busyLabel="Deleting…"
        danger
        busy={busy}
        onConfirm={() => run(() => deleteProject(p.id))}
      />
    </ProjectItem>
  );
}

function ArchivedDesignItem({
  request: d,
  onChanged,
}: {
  request: DesignRequestRow;
  onChanged: () => void;
}) {
  const { busy, run } = useBusy(onChanged);
  return (
    <ProjectItem
      name={designRequestName(d)}
      detail={`Design · ${scopeLabel((d.scope ?? undefined) as never)} · Completed ${d.completed_at ? dateShort(d.completed_at) : ""}`}
      pills={<Pill tone="green">Completed</Pill>}
    >
      <ChatLink kind="design" id={d.id} />
      <Confirm
        label="Delete"
        confirmLabel="Confirm delete"
        busyLabel="Deleting…"
        danger
        busy={busy}
        onConfirm={() => run(() => deleteDesignRequest(d.id))}
      />
    </ProjectItem>
  );
}
