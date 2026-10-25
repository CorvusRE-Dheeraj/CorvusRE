import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  getMyProfile,
  updateMyProfile,
  updateNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "@/lib/profile";
import {
  listProjects,
  listArchivedProjects,
  setActiveProject,
  deleteProject,
  markProjectCompleted,
  reopenProject,
  type ProjectRow,
} from "@/lib/projects";
import {
  listDesignRequests,
  listArchivedDesignRequests,
  setActiveDesignRequest,
  deleteDesignRequest,
  type DesignRequestRow,
} from "@/lib/design-requests";
import { scopeLabel } from "@/lib/design";
import { dateShort } from "@/lib/format";
import { Section, Field, inputCls, Loading, humanize, Pill } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/settings")({
  head: () => ({ meta: [{ title: "Settings — CorvusDP" }] }),
  component: Settings,
});

const PREF_LABELS: [keyof NotificationPrefs, string][] = [
  ["email", "Email"],
  ["sms", "SMS"],
  ["in_app", "In-app notifications"],
  ["weekly", "Weekly project updates"],
  ["permit_status", "Permit status updates"],
];

function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", companyName: "" });
  const [email, setEmail] = useState("");
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<"profile" | "prefs" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ["all-projects", user?.id],
    queryFn: () => listProjects(user!.id),
    enabled: !!user?.id,
  });
  const designRequests = useQuery({
    queryKey: ["all-design-requests", user?.id],
    queryFn: () => listDesignRequests(user!.id),
    enabled: !!user?.id,
  });
  const archivedProjects = useQuery({
    queryKey: ["archived-projects", user?.id],
    queryFn: () => listArchivedProjects(user!.id),
    enabled: !!user?.id,
  });
  const archivedDesign = useQuery({
    queryKey: ["archived-design-requests", user?.id],
    queryFn: () => listArchivedDesignRequests(user!.id),
    enabled: !!user?.id,
  });

  function refreshProjects() {
    for (const key of ["all-projects", "archived-projects", "active-project", "project-bundle"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }
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

  useEffect(() => {
    if (!user) return;
    getMyProfile(user.id)
      .then((p) => {
        setForm({
          firstName: p.firstName ?? "",
          lastName: p.lastName ?? "",
          phone: p.phone ?? "",
          companyName: p.companyName ?? "",
        });
        setEmail(p.email);
        setPrefs(p.notificationPrefs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load profile."))
      .finally(() => setLoading(false));
  }, [user]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSaved(null);
    try {
      await updateMyProfile(user.id, form);
      setSaved("profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function savePrefs(next: NotificationPrefs) {
    setPrefs(next);
    if (!user) return;
    try {
      await updateNotificationPrefs(user.id, next);
      setSaved("prefs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="grid gap-5">
      <Section title="Profile">
        <form onSubmit={saveProfile} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <input
                className={inputCls}
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </Field>
            <Field label="Last name">
              <input
                className={inputCls}
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputCls}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Company">
              <input
                className={inputCls}
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Email">
            <input className={inputCls} value={email} disabled />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved === "profile" && <p className="text-sm text-accent">Saved.</p>}
          <button className="btn-accent w-fit">Save changes</button>
        </form>
      </Section>

      <Section
        title="Notification preferences"
        subtitle="Email and in-app are both live; SMS is saved but not yet wired to a carrier."
      >
        <div className="grid gap-2 text-sm">
          {PREF_LABELS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={(e) => savePrefs({ ...prefs, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        {saved === "prefs" && <p className="mt-2 text-sm text-accent">Preferences saved.</p>}
      </Section>

      <Section
        title="Your permitting properties"
        subtitle="The dashboard always shows whichever one you switched to (or touched) most recently — switch back to an older one any time."
        right={
          <Link to="/permitting/analyze" className="btn-outline text-sm">
            + Add property
          </Link>
        }
      >
        {projects.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (projects.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved properties yet.</p>
        ) : (
          <ul className="grid gap-2">
            {(projects.data ?? []).map((p, i) => (
              <ProjectRowItem key={p.id} project={p} active={i === 0} onChanged={refreshProjects} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Your design requests"
        subtitle="Same idea as properties above — the design dashboard follows whichever request you switched to most recently."
        right={
          <Link to="/design/analyze" className="btn-outline text-sm">
            + Add design request
          </Link>
        }
      >
        {designRequests.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (designRequests.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved design requests yet.</p>
        ) : (
          <ul className="grid gap-2">
            {(designRequests.data ?? []).map((d, i) => (
              <DesignRequestRowItem
                key={d.id}
                request={d}
                active={i === 0}
                onChanged={() => {
                  queryClient.invalidateQueries({ queryKey: ["all-design-requests"] });
                  queryClient.invalidateQueries({ queryKey: ["design-request"] });
                }}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Archive"
        subtitle="Completed projects and design requests. Reopen a project to put it back on the dashboard."
      >
        {archivedProjects.isLoading || archivedDesign.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : archived.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing archived yet.</p>
        ) : (
          <ul className="grid gap-2">
            {archived.map((a) =>
              a.kind === "project" ? (
                <ArchivedProjectItem key={a.p.id} project={a.p} onChanged={refreshProjects} />
              ) : (
                <ArchivedDesignItem
                  key={a.d.id}
                  request={a.d}
                  onChanged={() =>
                    queryClient.invalidateQueries({ queryKey: ["archived-design-requests"] })
                  }
                />
              ),
            )}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ConfirmDelete({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <>
      <button
        className="text-xs font-semibold text-destructive underline underline-offset-2 disabled:opacity-50"
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? "Deleting…" : "Confirm delete"}
      </button>
      <button
        className="text-xs text-muted-foreground underline underline-offset-2"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
    </>
  ) : (
    <button
      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
      onClick={() => setConfirming(true)}
    >
      Delete
    </button>
  );
}

function ArchivedProjectItem({
  project: p,
  onChanged,
}: {
  project: ProjectRow;
  onChanged: () => void;
}) {
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
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
      <div>
        <div className="font-medium">{p.name ?? p.address ?? "Property"}</div>
        <div className="text-xs text-muted-foreground">
          Permitting · {p.jurisdiction ?? "—"} · Completed{" "}
          {p.completed_at ? dateShort(p.completed_at) : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Pill tone="green">Completed</Pill>
        <button
          className="text-xs font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
          disabled={busy}
          onClick={() => run(() => reopenProject(p.id))}
        >
          Reopen
        </button>
        <ConfirmDelete busy={busy} onConfirm={() => run(() => deleteProject(p.id))} />
      </div>
    </li>
  );
}

function ArchivedDesignItem({
  request: d,
  onChanged,
}: {
  request: DesignRequestRow;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await deleteDesignRequest(d.id);
    } finally {
      setBusy(false);
      onChanged();
    }
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
      <div>
        <div className="font-medium">{d.address ?? d.city ?? "Design request"}</div>
        <div className="text-xs text-muted-foreground">
          Design · {scopeLabel((d.scope ?? undefined) as never)} · Completed{" "}
          {d.completed_at ? dateShort(d.completed_at) : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Pill tone="green">Completed</Pill>
        <ConfirmDelete busy={busy} onConfirm={remove} />
      </div>
    </li>
  );
}

function DesignRequestRowItem({
  request: d,
  active,
  onChanged,
}: {
  request: DesignRequestRow;
  active: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function switchTo() {
    setBusy(true);
    await setActiveDesignRequest(d.id);
    setBusy(false);
    onChanged();
  }

  async function confirmDelete() {
    setBusy(true);
    await deleteDesignRequest(d.id);
    setBusy(false);
    setConfirmingDelete(false);
    onChanged();
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
      <div>
        <div className="flex items-center gap-2 font-medium">
          {d.address ?? d.city ?? "Design request"}
          {active && <Pill tone="green">Active on dashboard</Pill>}
        </div>
        <div className="text-xs text-muted-foreground">
          {scopeLabel((d.scope ?? undefined) as never)} · {d.sector ?? "—"} ·{" "}
          {dateShort(d.created_at)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Pill tone="gray">{humanize(d.stage)}</Pill>
        {!active && (
          <button
            className="text-xs font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={switchTo}
          >
            Switch to this
          </button>
        )}
        {confirmingDelete ? (
          <>
            <button
              className="text-xs font-semibold text-destructive underline underline-offset-2 disabled:opacity-50"
              disabled={busy}
              onClick={confirmDelete}
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

function ProjectRowItem({
  project: p,
  active,
  onChanged,
}: {
  project: ProjectRow;
  active: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function switchTo() {
    setBusy(true);
    await setActiveProject(p.id);
    setBusy(false);
    onChanged();
  }

  async function confirmDelete() {
    setBusy(true);
    await deleteProject(p.id);
    setBusy(false);
    setConfirmingDelete(false);
    onChanged();
  }

  const [confirmingComplete, setConfirmingComplete] = useState(false);
  async function complete() {
    setBusy(true);
    try {
      await markProjectCompleted(p.id);
    } finally {
      setBusy(false);
      setConfirmingComplete(false);
      onChanged();
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
      <div>
        <div className="flex items-center gap-2 font-medium">
          {p.name ?? p.address ?? "Property"}
          {active && <Pill tone="green">Active on dashboard</Pill>}
        </div>
        <div className="text-xs text-muted-foreground">
          {humanize(p.track)} · {p.jurisdiction ?? "—"} · {dateShort(p.created_at)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Pill tone="gray">{humanize(p.stage)}</Pill>
        {!active && (
          <button
            className="text-xs font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={switchTo}
          >
            Switch to this
          </button>
        )}
        {confirmingComplete ? (
          <>
            <button
              className="text-xs font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
              disabled={busy}
              onClick={complete}
            >
              {busy ? "Archiving…" : "Confirm — move to Archive"}
            </button>
            <button
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setConfirmingComplete(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="text-xs font-semibold text-accent underline underline-offset-2"
            onClick={() => setConfirmingComplete(true)}
          >
            Mark completed
          </button>
        )}
        {confirmingDelete ? (
          <>
            <button
              className="text-xs font-semibold text-destructive underline underline-offset-2 disabled:opacity-50"
              disabled={busy}
              onClick={confirmDelete}
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
