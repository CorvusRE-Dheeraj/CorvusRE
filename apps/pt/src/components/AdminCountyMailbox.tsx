import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  assignCountyEmail,
  checkCountyMailboxNow,
  disconnectCountyMailbox,
  getCountyMailboxStatus,
  listQueuedCountyEmails,
  startCountyMailboxConnect,
  type CountyMailboxStatus,
  type QueuedCountyEmail,
} from "@/lib/county-email";
import { getErrorMessage } from "@/lib/error-message";

type PropertyHit = {
  id: string;
  address: string;
  account_number: string | null;
  cad: string | null;
};

// Admin → County Mail: CorvusPT's agent mailbox (properties@srclandbuilding.com),
// connected read-only, and the county emails it couldn't match to a property.
export function AdminCountyMailbox() {
  const [status, setStatus] = useState<CountyMailboxStatus | null>(null);
  const [queue, setQueue] = useState<QueuedCountyEmail[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    try {
      const s = await getCountyMailboxStatus();
      setStatus(s);
      setQueue(s.connected ? await listQueuedCountyEmails() : []);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not load the county mailbox."));
    }
  }

  useEffect(() => {
    void refresh();
    // Coming back from Google's consent screen.
    const q = new URLSearchParams(window.location.search);
    if (q.get("mailbox_connected")) toast.success(`Connected ${q.get("mailbox_connected")}.`);
    if (q.get("mailbox_error"))
      toast.error(`Couldn't connect the mailbox (${q.get("mailbox_error")}).`);
  }, []);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await fn();
      if (done) toast.success(done);
      await refresh();
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't work."));
    } finally {
      setBusy(null);
    }
  }

  if (!status) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;

  const wrongMailbox =
    status.connected && status.email?.toLowerCase() !== status.expectedEmail.toLowerCase();

  return (
    <div className="mt-6 grid gap-6">
      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold">County mailbox</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Counties email CorvusPT at {status.expectedEmail}. Connected read-only, CorvusPT checks it
          every 15 minutes, keeps only county mail (from an appraisal district, or quoting a
          customer&apos;s account number) and files each email with its attachments under the
          customer&apos;s property. Other mail in that inbox is never stored.
        </p>

        {status.connected ? (
          <div className="mt-3 grid gap-2 text-sm">
            <div>
              Connected: <strong>{status.email}</strong>
              {status.lastCheckedAt
                ? ` · last checked ${new Date(status.lastCheckedAt).toLocaleString()}`
                : " · not checked yet"}
            </div>
            {wrongMailbox && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                This isn&apos;t {status.expectedEmail} — county mail goes to that address.
                Disconnect and connect again signed in as {status.expectedEmail}.
              </p>
            )}
            {status.lastError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                Last check failed: {status.lastError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  run("sync", async () => {
                    const r = await checkCountyMailboxNow();
                    toast.success(
                      `Checked ${r.checked} new email${r.checked === 1 ? "" : "s"}: ${r.filed} filed, ${r.queued} waiting, ${r.ignored} not county mail.`,
                    );
                  })
                }
                className="btn-primary text-xs disabled:opacity-60"
              >
                {busy === "sync" ? "Checking…" : "Check now"}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Disconnect the county mailbox? New county mail won't be filed until it's connected again.",
                    )
                  ) {
                    void run("disconnect", disconnectCountyMailbox, "Mailbox disconnected.");
                  }
                }}
                className="btn-outline text-xs text-destructive disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run("connect", startCountyMailboxConnect)}
            className="btn-primary mt-3 text-xs disabled:opacity-60"
          >
            Connect mailbox (sign in as {status.expectedEmail})
          </button>
        )}
      </section>

      {status.connected && (
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm font-semibold">
            County emails waiting for a property ({queue.length})
          </h2>
          {queue.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing waiting — every county email was matched.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {queue.map((e) => (
                <QueuedEmail
                  key={e.id}
                  email={e}
                  busy={busy === e.id}
                  onAssign={(propertyId) =>
                    run(
                      e.id,
                      () => assignCountyEmail(e.id, propertyId),
                      "Filed under that property.",
                    )
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function QueuedEmail({
  email,
  busy,
  onAssign,
}: {
  email: QueuedCountyEmail;
  busy: boolean;
  onAssign: (propertyId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PropertyHit[]>([]);

  // Admins can read every property (RLS) — search by address or account number.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      const like = `%${q.replace(/[%_]/g, "")}%`;
      supabase
        .from("properties")
        .select("id, address, account_number, cad")
        .or(`address.ilike.${like},account_number.ilike.${like}`)
        .limit(8)
        .then(({ data }) => setHits((data as PropertyHit[] | null) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <li className="rounded-md border border-border p-3 text-sm">
      <div className="font-medium">{email.subject ?? "(no subject)"}</div>
      <div className="text-xs text-muted-foreground">
        {email.from_address} · {new Date(email.received_at).toLocaleString()}
        {email.county ? ` · ${email.county} County` : ""} · {email.file_names.length} file
        {email.file_names.length === 1 ? "" : "s"}
      </div>
      {email.text_excerpt && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{email.text_excerpt}</p>
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find the property — address or account number"
        aria-label="Find the property for this email"
        disabled={busy}
        className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
      />
      {hits.length > 0 && (
        <ul className="mt-1 grid gap-1">
          {hits.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAssign(p.id)}
                className="w-full rounded px-2 py-1 text-left text-xs hover:bg-secondary disabled:opacity-60"
              >
                {p.address}
                {p.account_number ? ` · ${p.account_number}` : ""}
                {p.cad ? ` · ${p.cad}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
