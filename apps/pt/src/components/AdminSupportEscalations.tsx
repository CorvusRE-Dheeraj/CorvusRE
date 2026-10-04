import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, Mail, ChevronDown } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import { listAllUsers, type AdminUserRecord } from "@/lib/admin";
import {
  listSupportEscalations,
  setSupportEscalationStatus,
  type SupportEscalation,
  type SupportEscalationStatus,
} from "@/lib/support-escalations";
import { PageSkeleton } from "@/components/PageSkeleton";

const STATUS_TONE: Record<SupportEscalationStatus, string> = {
  open: "bg-warning/15 text-warning-foreground",
  contacted: "bg-accent/15 text-accent",
  resolved: "bg-success/15 text-success",
};

// Admin -> Support: every "Talk to someone" / "Email us" a user has filed
// from the Ask AI widget, newest first, with the chat transcript that led to
// it. This is the real backstop behind the bot's "I've reported this to our
// support team" line — if nothing shows up here, that line was a lie.
export function AdminSupportEscalations() {
  const [rows, setRows] = useState<SupportEscalation[]>([]);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    return Promise.all([listSupportEscalations(), listAllUsers()])
      .then(([r, u]) => {
        setRows(r);
        setUsers(u);
      })
      .catch((err) => toast.error(getErrorMessage(err, "Could not load support escalations.")));
  }

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function setStatus(id: string, status: SupportEscalationStatus) {
    setBusyId(id);
    try {
      await setSupportEscalationStatus(id, status);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update that."));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <PageSkeleton />;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No one has asked to escalate from the Ask AI widget yet.
      </p>
    );
  }

  return (
    <ul className="grid gap-2">
      {rows.map((r) => {
        const u = r.userId ? userById.get(r.userId) : undefined;
        const open = expandedId === r.id;
        return (
          <li key={r.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  {r.contactMethod === "call" ? (
                    <Phone className="h-4 w-4 text-accent" />
                  ) : (
                    <Mail className="h-4 w-4 text-accent" />
                  )}
                  {r.contactMethod === "call" ? "Wants a call back" : "Wants email support"}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {u ? (
                    <a href={`mailto:${u.email}`} className="text-accent hover:underline">
                      {u.email}
                    </a>
                  ) : (
                    "Unknown user"
                  )}
                  {" · "}
                  {new Date(r.createdAt).toLocaleString()}
                </div>
                {r.summary && <p className="mt-1 truncate">{r.summary}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <select
                  value={r.status}
                  disabled={busyId === r.id}
                  onChange={(e) => void setStatus(r.id, e.target.value as SupportEscalationStatus)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-60"
                >
                  <option value="open">Open</option>
                  <option value="contacted">Contacted</option>
                  <option value="resolved">Resolved</option>
                </select>
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : r.id)}
                  aria-expanded={open}
                  className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
              </div>
            </div>
            {open && (
              <div className="mt-2 grid gap-1.5 rounded-md bg-secondary/40 p-2.5 text-xs">
                {r.transcript.length === 0 ? (
                  <p className="text-muted-foreground">No transcript was captured.</p>
                ) : (
                  r.transcript.map((t, i) => (
                    <p key={i}>
                      <span className="font-semibold">{t.role === "user" ? "User: " : "Bot: "}</span>
                      {t.text}
                    </p>
                  ))
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
