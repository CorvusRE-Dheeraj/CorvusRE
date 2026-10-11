import { useEffect, useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import {
  inviteMember,
  listTeam,
  revokeMember,
  ROLE_LABEL,
  ROLE_SUMMARY,
  updateMember,
  type MemberRole,
  type TeamMember,
} from "@/lib/account-members";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function ScopePicker({
  properties,
  value,
  onChange,
}: {
  properties: PropertyRecord[];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="radio"
          checked={value == null}
          onChange={() => onChange(null)}
          className="h-4 w-4"
        />
        Every property, including ones added later
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          checked={value != null}
          onChange={() => onChange([])}
          className="h-4 w-4"
        />
        Only the properties I choose
      </label>
      {value != null && (
        <div className="ml-6 grid max-h-48 gap-1 overflow-y-auto rounded-md border border-border p-2">
          {properties.length === 0 && (
            <span className="text-xs text-muted-foreground">No properties yet.</span>
          )}
          {properties.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={value.includes(p.id)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))
                }
                className="h-3.5 w-3.5"
              />
              <span className="truncate">{p.address}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Settings → Team & access: invite a property manager or CPA / controller,
// choose which properties they reach, and remove access.
export function TeamAccess({ ownerId }: { ownerId: string }) {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("property_manager");
  const [scope, setScope] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const reload = () =>
    listTeam(ownerId)
      .then(setTeam)
      .catch(() => {});
  useEffect(() => {
    void reload();
    listProperties(ownerId)
      .then(setProperties)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  async function invite() {
    if (scope != null && scope.length === 0) {
      toast.error("Choose at least one property, or give access to every property.");
      return;
    }
    setBusy(true);
    try {
      const r = await inviteMember({ email: email.trim(), role, propertyIds: scope });
      toast.success(
        r.emailed
          ? `Invitation sent to ${email.trim()}.`
          : "Invitation created — copy the link below to send it.",
      );
      setEmail("");
      setScope(null);
      await reload();
    } catch (e) {
      toast.error(errMsg(e, "Could not send the invitation."));
    } finally {
      setBusy(false);
    }
  }

  async function resend(m: TeamMember) {
    try {
      const r = await inviteMember({ email: m.email, role: m.role, propertyIds: m.propertyIds });
      if (r.link) await navigator.clipboard?.writeText(r.link).catch(() => {});
      toast.success(r.emailed ? "Invitation sent again — link copied." : "Invitation link copied.");
      await reload();
    } catch (e) {
      toast.error(errMsg(e, "Could not resend the invitation."));
    }
  }

  async function remove(m: TeamMember) {
    if (!confirm(`Remove ${m.email}'s access to your account?`)) return;
    try {
      await revokeMember(m.id);
      await reload();
      toast.success("Access removed.");
    } catch (e) {
      toast.error(errMsg(e, "Could not remove access."));
    }
  }

  const addressOf = new Map(properties.map((p) => [p.id, p.address]));

  return (
    <div className="mt-8 card-elev p-6">
      <h2 className="font-semibold">Team &amp; Access</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Give a property manager or your CPA / controller their own sign-in to your account. They
        never see your billing or sign anything for you, and you can remove access any time.
      </p>

      {team.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {team.map((m) => (
            <li key={m.id} className="grid gap-2 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {ROLE_LABEL[m.role]} ·{" "}
                    {m.propertyIds == null
                      ? "every property"
                      : m.propertyIds.length === 1
                        ? (addressOf.get(m.propertyIds[0]) ?? "1 property")
                        : `${m.propertyIds.length} properties`}{" "}
                    ·{" "}
                    {m.status === "active" ? (
                      <span className="text-success">active</span>
                    ) : (
                      "invitation pending"
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {m.status === "invited" && (
                    <button
                      type="button"
                      onClick={() => resend(m)}
                      className="btn-outline inline-flex items-center gap-1 text-xs"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Resend
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(editing === m.id ? null : m.id)}
                    className="btn-outline text-xs"
                  >
                    {editing === m.id ? "Done" : "Change access"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m)}
                    className="btn-outline text-xs text-destructive"
                  >
                    Remove
                  </button>
                </div>
              </div>
              {editing === m.id && (
                <div className="grid gap-2 rounded-md bg-secondary/40 p-3">
                  <select
                    value={m.role}
                    onChange={async (e) => {
                      await updateMember(m.id, { role: e.target.value as MemberRole }).catch(
                        (err) => toast.error(errMsg(err, "Could not change the role.")),
                      );
                      await reload();
                    }}
                    aria-label="Role"
                    className="w-fit rounded-md border border-input bg-background px-2 py-1 text-sm"
                  >
                    {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <ScopePicker
                    properties={properties}
                    value={m.propertyIds}
                    onChange={async (v) => {
                      if (v != null && v.length === 0) {
                        setTeam((prev) =>
                          prev.map((x) => (x.id === m.id ? { ...x, propertyIds: [] } : x)),
                        );
                        return;
                      }
                      await updateMember(m.id, { propertyIds: v }).catch((err) =>
                        toast.error(errMsg(err, "Could not change access.")),
                      );
                      await reload();
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-3 rounded-md border border-border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="h-4 w-4 text-accent" aria-hidden="true" /> Invite someone
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="manager@company.com"
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="rounded-md border border-input bg-background px-3 py-2"
            >
              {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{ROLE_SUMMARY[role]}</p>
        <ScopePicker properties={properties} value={scope} onChange={setScope} />
        <div>
          <button
            type="button"
            onClick={invite}
            disabled={busy || !email.trim()}
            className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </div>
    </div>
  );
}
