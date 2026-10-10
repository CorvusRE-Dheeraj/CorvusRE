import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useActiveProjectBundle } from "@/hooks/use-project";
import {
  addPortalLogin,
  deletePortalLogin,
  listPortalLogins,
  revealPortalPassword,
  setPortalPassword,
  updatePortalLogin,
  type PortalLogin,
  type PortalLoginInput,
} from "@/lib/portal-logins";
import { Section, EmptyProject, Loading, Field, inputCls } from "@/components/dp-ui";
import { dateShort } from "@/lib/format";

export const Route = createFileRoute("/dashboard/_layout/portal")({
  head: () => ({ meta: [{ title: "City Portal Login — CorvusDP" }] }),
  component: CityPortal,
});

const REVEAL_MS = 20_000;

type FormState = PortalLoginInput & { password: string };
const EMPTY: FormState = {
  portalName: "",
  portalUrl: "",
  username: "",
  accountRef: "",
  notes: "",
  password: "",
};

function CityPortal() {
  const { user } = useAuth();
  const { loading, hasProject, project } = useActiveProjectBundle();
  const projectId = project?.id;
  const logins = useQuery({
    queryKey: ["portal-logins", projectId],
    queryFn: () => listPortalLogins(projectId!),
    enabled: !!projectId,
  });
  // null = closed; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  function startAdd() {
    setForm({
      ...EMPTY,
      portalName: project?.jurisdiction ? `${project.jurisdiction} portal` : "",
    });
    setEditing("new");
    setError(null);
  }

  function startEdit(l: PortalLogin) {
    setForm({
      portalName: l.portalName,
      portalUrl: l.portalUrl ?? "",
      username: l.username ?? "",
      accountRef: l.accountRef ?? "",
      notes: l.notes ?? "",
      password: "",
    });
    setEditing(l.id);
    setError(null);
  }

  async function save() {
    if (!user || !projectId) return;
    if (!form.portalName.trim()) {
      setError("Give the portal a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { password, ...input } = form;
      if (editing === "new") {
        await addPortalLogin(projectId, user.id, input, password);
      } else if (editing) {
        await updatePortalLogin(editing, user.id, input);
        if (password) await setPortalPassword(editing, password);
      }
      setEditing(null);
      await logins.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this portal login and its saved password?")) return;
    await deletePortalLogin(id);
    await logins.refetch();
  }

  const rows = logins.data ?? [];

  return (
    <div className="grid gap-5">
      <Section
        title="City Portal Login"
        subtitle={`Where this project's permits are submitted and tracked${project.jurisdiction ? ` — ${project.jurisdiction}` : ""}.`}
        right={
          editing === null ? (
            <button type="button" className="btn-accent text-sm" onClick={startAdd}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add portal
            </button>
          ) : null
        }
      >
        {editing !== null && (
          <PortalForm
            form={form}
            setForm={setForm}
            isNew={editing === "new"}
            hasPassword={rows.find((r) => r.id === editing)?.hasPassword ?? false}
            saving={saving}
            error={error}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        )}

        {logins.isLoading ? (
          <Loading />
        ) : rows.length === 0 && editing === null ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <KeyRound className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
            No portal saved for this project yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {rows.map((l) => (
              <PortalCard
                key={l.id}
                login={l}
                onEdit={() => startEdit(l)}
                onDelete={() => remove(l.id)}
              />
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          * Passwords are stored encrypted and shown only to this project's team.
        </p>
      </Section>
    </div>
  );
}

function PortalForm({
  form,
  setForm,
  isNew,
  hasPassword,
  saving,
  error,
  onSave,
  onCancel,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  isNew: boolean;
  hasPassword: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border border-border bg-secondary/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Portal name" required>
          <input
            className={inputCls}
            value={form.portalName}
            onChange={set("portalName")}
            placeholder="e.g. City of Frisco eTRAKiT"
            required
          />
        </Field>
        <Field label="Portal website">
          <input
            className={inputCls}
            value={form.portalUrl}
            onChange={set("portalUrl")}
            placeholder="https://"
            inputMode="url"
          />
        </Field>
        <Field label="Username / email">
          <input
            className={inputCls}
            value={form.username}
            onChange={set("username")}
            autoComplete="off"
          />
        </Field>
        <Field
          label="Password"
          hint={!isNew && hasPassword ? "Leave blank to keep the saved password" : undefined}
        >
          <input
            type="password"
            className={inputCls}
            value={form.password}
            onChange={set("password")}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Account / project number">
          <input className={inputCls} value={form.accountRef} onChange={set("accountRef")} />
        </Field>
        <Field label="Notes">
          <input
            className={inputCls}
            value={form.notes}
            onChange={set("notes")}
            placeholder="e.g. Building + fire permits; 2FA goes to the PM's phone"
          />
        </Field>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-outline text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-accent text-sm disabled:opacity-60" disabled={saving}>
          {saving ? "Saving…" : isNew ? "Save portal" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function CopyButton({
  getValue,
  label,
}: {
  getValue: () => Promise<string | null> | string | null;
  label: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
      onClick={async () => {
        const v = await getValue();
        if (!v) return;
        await navigator.clipboard.writeText(v);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? (
        <span className="text-xs text-success">Copied</span>
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function PortalCard({
  login: l,
  onEdit,
  onDelete,
}: {
  login: PortalLogin;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  // Hide again after a short while.
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  async function reveal() {
    setRevealError(null);
    try {
      setRevealed((await revealPortalPassword(l.id)) ?? "");
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : "Couldn't show the password.");
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{l.portalName}</div>
          {l.portalUrl && (
            <div className="truncate text-xs text-muted-foreground">{l.portalUrl}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {l.portalUrl && (
            <a
              href={l.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline inline-flex items-center gap-1 px-3 py-1 text-xs"
            >
              Open portal <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            aria-label="Edit"
            onClick={onEdit}
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Delete"
            onClick={onDelete}
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Username</dt>
          <dd className="flex items-center gap-1 font-medium">
            <span className="truncate">{l.username || "—"}</span>
            {l.username && <CopyButton label="Copy username" getValue={() => l.username} />}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Password</dt>
          <dd className="flex items-center gap-1 font-medium">
            {!l.hasPassword ? (
              <span className="text-muted-foreground">Not saved</span>
            ) : (
              <>
                <span className="truncate font-mono">{revealed ?? "••••••••"}</span>
                <button
                  type="button"
                  aria-label={revealed ? "Hide password" : "Show password"}
                  onClick={() => (revealed ? setRevealed(null) : void reveal())}
                  className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <CopyButton label="Copy password" getValue={() => revealPortalPassword(l.id)} />
              </>
            )}
          </dd>
          {revealError && <p className="text-xs text-destructive">{revealError}</p>}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Account / project #</dt>
          <dd className="flex items-center gap-1 font-medium">
            <span className="truncate">{l.accountRef || "—"}</span>
            {l.accountRef && (
              <CopyButton label="Copy account number" getValue={() => l.accountRef} />
            )}
          </dd>
        </div>
      </dl>
      {l.notes && <p className="mt-2 text-xs text-muted-foreground">{l.notes}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">Updated {dateShort(l.updatedAt)}</p>
    </div>
  );
}
