import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Linkedin,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { invokeEdgeFunction } from "@/lib/edge-functions";
import { getErrorMessage } from "@/lib/error-message";
import { useLiveRefresh } from "@/lib/staff-records";
import { useStaffContext } from "@/hooks/use-staff-context";
import { RequestApprovalButton } from "@/components/staff/StaffRecords";

// Marketing → LinkedIn: Corvus AI drafts a post for every posting day (from
// real data — Texas tax updates, deadlines, tips, CorvusPT features); the team
// edits and approves; approved posts publish at their time through LinkedIn's
// official Posts API (see supabase/pt/functions/_shared/handlers/linkedin.ts).

type Post = {
  id: string;
  scheduled_for: string;
  status: "draft" | "approved" | "posting" | "posted" | "failed" | "skipped";
  theme: string;
  topic: string | null;
  body: string;
  hashtags: string[];
  link_url: string | null;
  source_note: string | null;
  ai_generated: boolean;
  approved_at: string | null;
  posted_at: string | null;
  post_url: string | null;
  error: string | null;
};
type Settings = {
  post_days: string[];
  post_time: string;
  timezone: string;
  tone: string;
  cta_url: string;
  default_hashtags: string[];
};
type Status = {
  connected: boolean;
  account_type: string;
  display_name: string | null;
  expires_at: string | null;
  last_error: string | null;
};
type Auto = { key: string; label: string; enabled: boolean };

const THEMES: Record<string, string> = {
  tax_update: "Texas tax update",
  deadline: "Deadline reminder",
  tip: "Protest tip",
  feature: "CorvusPT feature",
  myth: "Myth vs fact",
  custom: "Custom",
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const STATUS_TONE: Record<Post["status"], string> = {
  draft: "bg-warning/15 text-warning-foreground",
  approved: "bg-accent/15 text-accent",
  posting: "bg-accent/15 text-accent",
  posted: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  skipped: "bg-secondary text-muted-foreground",
};
const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const CALLBACK_HINT =
  "https://iotzuhuajbsxxuccuihn.supabase.co/functions/v1/county-mail-inbound?action=linkedin-callback";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  });

const li = <T,>(op: string, extra: Record<string, unknown> = {}) =>
  invokeEdgeFunction<T>("admin-update-plan?action=linkedin", { op, ...extra });

export function LinkedIn() {
  const ctx = useStaffContext();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [autos, setAutos] = useState<Auto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [newDate, setNewDate] = useState(() =>
    new Date(Date.now() + 864e5).toISOString().slice(0, 10),
  );
  const [newTheme, setNewTheme] = useState("tip");
  const [newTopic, setNewTopic] = useState("");

  const load = useCallback(async () => {
    const [p, s, st, a] = await Promise.all([
      supabase
        .from("linkedin_posts")
        .select("*")
        .gte("scheduled_for", new Date(Date.now() - 60 * 864e5).toISOString())
        .order("scheduled_for"),
      supabase.from("linkedin_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.rpc("linkedin_status"),
      supabase
        .from("automation_permissions")
        .select("key, label, enabled")
        .like("key", "linkedin_%"),
    ]);
    setPosts((p.data ?? []) as Post[]);
    setSettings((s.data as Settings) ?? null);
    setStatus(((st.data ?? []) as Status[])[0] ?? null);
    setAutos((a.data ?? []) as Auto[]);
  }, []);
  useEffect(() => {
    void load();
    const q = new URLSearchParams(window.location.search).get("linkedin");
    if (q === "connected") toast.success("LinkedIn connected.");
    else if (q) toast.error(`LinkedIn didn't connect: ${q.replace(/-/g, " ")}`);
  }, [load]);
  useLiveRefresh(["linkedin_posts"], () => void load());

  const act = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, "That didn't work."));
    } finally {
      setBusy(null);
    }
  };
  const update = async (id: string, patch: Partial<Post>) => {
    const { error } = await supabase.from("linkedin_posts").update(patch).eq("id", id);
    if (error) throw error;
  };

  const upcoming = useMemo(
    () => (posts ?? []).filter((p) => !["posted"].includes(p.status) && p.status !== "posting"),
    [posts],
  );
  const history = useMemo(
    () =>
      (posts ?? [])
        .filter((p) => p.status === "posted")
        .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? "")),
    [posts],
  );
  const auto = (k: string) => autos.find((a) => a.key === k)?.enabled;
  const expiresIn = status?.expires_at
    ? Math.ceil((Date.parse(status.expires_at) - Date.now()) / 864e5)
    : null;

  if (!posts || !settings) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {/* Connection */}
      <section className="card-elev p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Linkedin className="h-4 w-4 text-[#0A66C2]" /> LinkedIn connection
            </h2>
            {status?.connected ? (
              <p className="mt-1 text-sm">
                Posting as <strong>{status.display_name}</strong> (
                {status.account_type === "organization" ? "company page" : "personal profile"})
                {expiresIn !== null && (
                  <span className={expiresIn <= 7 ? "text-destructive" : "text-muted-foreground"}>
                    {" "}
                    · {expiresIn > 0 ? `reconnect within ${expiresIn} days` : "expired — reconnect"}
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Not connected — drafts are still written and can be approved; they publish once
                LinkedIn is connected.
              </p>
            )}
            {status?.last_error && (
              <p className="mt-1 text-xs text-destructive">{status.last_error}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!busy}
              className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
              onClick={() =>
                void (async () => {
                  setBusy("connect");
                  try {
                    const r = await li<{ url: string }>("connect");
                    window.location.assign(r.url);
                  } catch (e) {
                    toast.error(getErrorMessage(e, "Couldn't start the LinkedIn connection."));
                    setBusy(null);
                  }
                })()
              }
            >
              {status?.connected ? "Reconnect" : "Connect LinkedIn"}
            </button>
            {status?.connected && (
              <button
                type="button"
                disabled={!!busy}
                className="btn-outline text-sm"
                onClick={() => void act("disc", () => li("disconnect"), "LinkedIn disconnected.")}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
        {!status?.connected && (
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer text-accent">One-time setup (LinkedIn app)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Create an app at linkedin.com/developers (associate it with the CorvusRE company
                page).
              </li>
              <li>
                Products tab: add <strong>Sign In with LinkedIn using OpenID Connect</strong> and{" "}
                <strong>Share on LinkedIn</strong> (both self-serve). For posting as the company
                page, also request the <strong>Community Management API</strong>.
              </li>
              <li>
                Auth tab: add this redirect URL —{" "}
                <code className="break-all rounded bg-secondary px-1">{CALLBACK_HINT}</code>
              </li>
              <li>
                Send the Client ID and Client Secret to your developer to store as the
                LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET secrets, then press Connect.
              </li>
            </ol>
          </details>
        )}
      </section>

      {/* Automations + schedule */}
      <section className="card-elev grid gap-3 p-4 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold">Automation</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {autos.map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-2">
                <span>{a.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${a.enabled ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}
                >
                  {a.enabled ? "On" : "Off"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {auto("linkedin_auto_approve")
              ? "AI drafts publish without review."
              : "Every post needs a person's approval before it publishes."}{" "}
            Changing these needs a Super Admin approval.
          </p>
          <RequestApprovalButton
            ctx={ctx}
            kind="automation_permission"
            label="Change an automation"
            className="btn-outline mt-2 inline-flex items-center gap-1 py-1 text-xs"
          />
        </div>
        <SettingsForm
          settings={settings}
          onSave={(s) =>
            act(
              "settings",
              async () => {
                const { error } = await supabase
                  .from("linkedin_settings")
                  .update({ ...s, updated_at: new Date().toISOString() })
                  .eq("id", 1);
                if (error) throw error;
              },
              "Schedule saved.",
            )
          }
        />
      </section>

      {/* New post */}
      <section className="card-elev p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-accent" /> New post
        </h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_12rem_minmax(0,1fr)_auto]">
          <input
            type="date"
            className={input}
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            aria-label="Post date"
          />
          <select
            className={input}
            value={newTheme}
            onChange={(e) => setNewTheme(e.target.value)}
            aria-label="Theme"
          >
            {Object.entries(THEMES)
              .filter(([k]) => k !== "custom")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
          <input
            className={input}
            placeholder="Optional topic (e.g. 'what to bring to an ARB hearing')"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
          />
          <button
            type="button"
            disabled={!!busy}
            className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
            onClick={() =>
              void act(
                "new",
                async () => {
                  const d = await li<Omit<Post, "id" | "scheduled_for" | "status">>("generate", {
                    date: newDate,
                    theme: newTheme,
                    topic: newTopic.trim() || undefined,
                  });
                  const [h, m] = settings.post_time.split(":").map(Number);
                  const at = new Date(`${newDate}T00:00:00`);
                  at.setHours(h, m || 0, 0, 0);
                  const { error } = await supabase.from("linkedin_posts").insert({
                    ...d,
                    scheduled_for: at.toISOString(),
                    status: "draft",
                    ai_generated: true,
                    created_by: ctx.me,
                  });
                  if (error) throw error;
                  setNewTopic("");
                },
                "Draft written — review it below.",
              )
            }
          >
            {busy === "new" ? "Writing…" : "Write with AI"}
          </button>
        </div>
      </section>

      {/* Queue */}
      <section className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" /> Upcoming & to review ({upcoming.length})
        </h2>
        {upcoming.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing queued. Corvus AI writes the next posting days&apos; drafts every hour (when
            “LinkedIn daily drafts” is on), or write one above.
          </p>
        )}
        {upcoming.map((p) => (
          <PostCard
            key={p.id}
            p={p}
            busy={busy}
            onSave={(patch) => act(`save-${p.id}`, () => update(p.id, patch), "Saved.")}
            onApprove={(on) =>
              act(
                `ap-${p.id}`,
                () => update(p.id, { status: on ? "approved" : "draft" }),
                on ? "Approved — it publishes at its time." : "Back to draft.",
              )
            }
            onSkip={() =>
              act(`skip-${p.id}`, () => update(p.id, { status: "skipped" }), "Skipped.")
            }
            onDelete={() =>
              act(
                `del-${p.id}`,
                async () => {
                  const { error } = await supabase.from("linkedin_posts").delete().eq("id", p.id);
                  if (error) throw error;
                },
                "Deleted.",
              )
            }
            onRegenerate={() =>
              act(
                `re-${p.id}`,
                async () => {
                  const d = await li<Pick<Post, "body" | "hashtags" | "topic" | "source_note">>(
                    "generate",
                    { date: p.scheduled_for.slice(0, 10), theme: p.theme },
                  );
                  await update(p.id, {
                    body: d.body,
                    hashtags: d.hashtags,
                    topic: d.topic,
                    source_note: d.source_note,
                    status: "draft",
                  });
                },
                "Rewritten — review it.",
              )
            }
            onPostNow={() =>
              act(`now-${p.id}`, () => li("publish", { postId: p.id }), "Posted to LinkedIn.")
            }
            connected={!!status?.connected}
          />
        ))}
      </section>

      {/* History */}
      {history.length > 0 && (
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">Posted ({history.length})</h2>
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1 text-sm">
            {history.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0"
              >
                <span className="min-w-0 truncate">
                  {p.topic ?? p.body.slice(0, 60)}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {p.posted_at ? when(p.posted_at) : ""}
                  </span>
                </span>
                {p.post_url && (
                  <a
                    href={p.post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    View on LinkedIn <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PostCard({
  p,
  busy,
  connected,
  onSave,
  onApprove,
  onSkip,
  onDelete,
  onRegenerate,
  onPostNow,
}: {
  p: Post;
  busy: string | null;
  connected: boolean;
  onSave: (patch: Partial<Post>) => void;
  onApprove: (on: boolean) => void;
  onSkip: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onPostNow: () => void;
}) {
  const [body, setBody] = useState(p.body);
  const [tags, setTags] = useState(p.hashtags.join(" "));
  useEffect(() => {
    setBody(p.body);
    setTags(p.hashtags.join(" "));
  }, [p.body, p.hashtags]);
  const dirty = body !== p.body || tags !== p.hashtags.join(" ");
  const length = body.length + (p.link_url?.length ?? 0) + tags.length + 4;
  const anyBusy = !!busy;
  return (
    <article className="card-elev grid gap-2 p-4 text-sm [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">{when(p.scheduled_for)}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5">{THEMES[p.theme] ?? p.theme}</span>
        <span className={`rounded-full px-2 py-0.5 ${STATUS_TONE[p.status]}`}>{p.status}</span>
        {p.ai_generated && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Corvus AI
          </span>
        )}
      </div>
      {p.topic && <div className="font-medium">{p.topic}</div>}
      <textarea
        className={`${input} min-h-[10rem]`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Post text"
      />
      <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <input
          className={input}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          aria-label="Hashtags"
          placeholder="Hashtags, space separated (no #)"
        />
        <span className={`text-xs ${length > 3000 ? "text-destructive" : "text-muted-foreground"}`}>
          {length}/3000
        </span>
      </div>
      {p.link_url && <p className="text-xs text-muted-foreground">Link added: {p.link_url}</p>}
      {p.source_note && <p className="text-xs text-muted-foreground">Based on: {p.source_note}</p>}
      {p.error && <p className="text-xs text-destructive">{p.error}</p>}
      <div className="flex flex-wrap gap-2">
        {dirty && (
          <button
            type="button"
            disabled={anyBusy || length > 3000}
            className="btn-primary btn-primary-hover py-1.5 text-xs disabled:opacity-60"
            onClick={() =>
              onSave({
                body,
                hashtags: tags
                  .split(/[\s,#]+/)
                  .map((t) => t.replace(/[^A-Za-z0-9]/g, ""))
                  .filter(Boolean)
                  .slice(0, 8),
              })
            }
          >
            Save changes
          </button>
        )}
        {p.status === "approved" ? (
          <button
            type="button"
            disabled={anyBusy}
            className="btn-outline py-1.5 text-xs"
            onClick={() => onApprove(false)}
          >
            Unapprove
          </button>
        ) : (
          <button
            type="button"
            disabled={anyBusy || dirty}
            title={dirty ? "Save your changes first" : undefined}
            className="btn-primary btn-primary-hover inline-flex items-center gap-1 py-1.5 text-xs disabled:opacity-60"
            onClick={() => onApprove(true)}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
          </button>
        )}
        <button
          type="button"
          disabled={anyBusy || dirty || !connected}
          title={
            !connected ? "Connect LinkedIn first" : dirty ? "Save your changes first" : undefined
          }
          className="btn-outline inline-flex items-center gap-1 py-1.5 text-xs disabled:opacity-60"
          onClick={onPostNow}
        >
          <Send className="h-3.5 w-3.5" /> Post now
        </button>
        <button
          type="button"
          disabled={anyBusy}
          className="btn-outline inline-flex items-center gap-1 py-1.5 text-xs"
          onClick={onRegenerate}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy === `re-${p.id}` ? "animate-spin" : ""}`} />{" "}
          Rewrite with AI
        </button>
        {p.status !== "skipped" && (
          <button
            type="button"
            disabled={anyBusy}
            className="btn-outline py-1.5 text-xs"
            onClick={onSkip}
          >
            Skip
          </button>
        )}
        {["draft", "skipped", "failed"].includes(p.status) && (
          <button
            type="button"
            disabled={anyBusy}
            className="btn-outline inline-flex items-center gap-1 py-1.5 text-xs text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        )}
      </div>
    </article>
  );
}

function SettingsForm({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (s: Partial<Settings>) => void;
}) {
  const [days, setDays] = useState(settings.post_days);
  const [time, setTime] = useState(settings.post_time);
  const [tone, setTone] = useState(settings.tone);
  const [cta, setCta] = useState(settings.cta_url);
  const [tags, setTags] = useState(settings.default_hashtags.join(" "));
  return (
    <div>
      <h2 className="text-sm font-semibold">Posting schedule</h2>
      <div className="mt-2 flex flex-wrap gap-1">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
            className={`rounded-full border px-2.5 py-1 text-xs capitalize ${days.includes(d) ? "border-accent bg-accent/10 text-accent" : "border-input text-muted-foreground"}`}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs">
          <span>Time (Central)</span>
          <input
            type="time"
            className={input}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span>Link in every post</span>
          <input className={input} value={cta} onChange={(e) => setCta(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs sm:col-span-2">
          <span>Voice</span>
          <input className={input} value={tone} onChange={(e) => setTone(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs sm:col-span-2">
          <span>Always-include hashtags (no #)</span>
          <input className={input} value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        className="btn-outline mt-2 text-xs"
        onClick={() =>
          onSave({
            post_days: days,
            post_time: time,
            tone: tone.trim(),
            cta_url: cta.trim(),
            default_hashtags: tags
              .split(/[\s,#]+/)
              .map((t) => t.replace(/[^A-Za-z0-9]/g, ""))
              .filter(Boolean)
              .slice(0, 5),
          })
        }
      >
        Save schedule
      </button>
    </div>
  );
}
