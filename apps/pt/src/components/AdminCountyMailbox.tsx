import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  assignCountyEmail,
  CORVUSPT_COUNTY_EMAIL,
  listQueuedCountyEmails,
  type QueuedCountyEmail,
} from "@/lib/county-email";
import { getErrorMessage } from "@/lib/error-message";

type PropertyHit = {
  id: string;
  address: string;
  account_number: string | null;
  cad: string | null;
};

// Admin → County Mail: county mail arrives at CorvusPT's own county address
// (county@inbox.corvusre.com, Resend inbound — see county-mail-inbound), is
// filed under the matching property automatically, and lands here when it
// can't be matched. (The older Gmail read-only connection is paused.)
export function AdminCountyMailbox() {
  const [loaded, setLoaded] = useState(false);
  const [queue, setQueue] = useState<QueuedCountyEmail[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    try {
      setQueue(await listQueuedCountyEmails());
      setLoaded(true);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not load the county mailbox."));
    }
  }

  useEffect(() => {
    void refresh();
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

  if (!loaded) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="mt-6 grid gap-6">
      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold">County mail</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Appraisal districts email CorvusPT at <strong>{CORVUSPT_COUNTY_EMAIL}</strong> — give them
          this address as the agent&apos;s email, and it&apos;s copied on every email CorvusPT
          drafts to a county. Each email is filed with its attachments under the customer&apos;s
          property (matched by account number, or by address when it&apos;s from that county&apos;s
          district), and a notice goes to properties@srclandbuilding.com. Anything it can&apos;t
          match waits below.
        </p>
      </section>

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
                  run(e.id, () => assignCountyEmail(e.id, propertyId), "Filed under that property.")
                }
              />
            ))}
          </ul>
        )}
      </section>
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
