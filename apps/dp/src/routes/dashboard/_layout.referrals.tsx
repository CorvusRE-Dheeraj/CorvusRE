import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  getMyReferralCode,
  getMyReferrals,
  getMyReferralInvites,
  dismissReferralInvite,
  sendReferralInvite,
  buildReferralLink,
} from "@/lib/referrals";
import { dateShort } from "@/lib/format";
import { Section, Field, inputCls, Loading, Pill } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/referrals")({
  head: () => ({ meta: [{ title: "Referrals — CorvusDP" }] }),
  component: Referrals,
});

function Referrals() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const code = useQuery({
    queryKey: ["referral-code", user?.id],
    queryFn: () => getMyReferralCode(user!.id),
    enabled: !!user?.id,
  });
  const referrals = useQuery({
    queryKey: ["my-referrals", user?.id],
    queryFn: getMyReferrals,
    enabled: !!user?.id,
  });
  const invites = useQuery({
    queryKey: ["my-referral-invites", user?.id],
    queryFn: getMyReferralInvites,
    enabled: !!user?.id,
  });

  if (code.isLoading) return <Loading />;

  const link = code.data ? buildReferralLink(code.data) : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the link is still selectable text below */
    }
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    setSending(true);
    try {
      await sendReferralInvite(email);
      setSent(email);
      setEmail("");
      invites.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that invite.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Your referral link"
        subtitle="Share it — when someone signs up through it, it shows up below."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={link} className={`${inputCls} flex-1`} onFocus={(e) => e.target.select()} />
          <button className="btn-accent" onClick={copyLink}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </Section>

      <Section title="Invite by email">
        <form onSubmit={submitInvite} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <Field label="Friend's email">
              <input
                type="email"
                required
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@example.com"
              />
            </Field>
          </div>
          <button className="btn-accent disabled:opacity-60" disabled={sending}>
            {sending ? "Sending…" : "Send invite"}
          </button>
        </form>
        {sent && <p className="mt-2 text-sm text-accent">Invite sent to {sent}.</p>}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        {(invites.data ?? []).length > 0 && (
          <ul className="mt-4 grid gap-2 text-sm">
            {(invites.data ?? []).map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-lg border border-border p-2.5"
              >
                <span>
                  {i.email}{" "}
                  <span className="text-xs text-muted-foreground">
                    · sent {dateShort(i.sentAt)}
                  </span>
                </span>
                <button
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                  onClick={async () => {
                    await dismissReferralInvite(i.id);
                    invites.refetch();
                  }}
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Your referrals"
        subtitle="Reward status updates automatically once billing is live."
      >
        {referrals.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (referrals.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one has signed up through your link yet.
          </p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {(referrals.data ?? []).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-border p-2.5"
              >
                <span>
                  {r.firstName ?? "Someone"}{" "}
                  <span className="text-xs text-muted-foreground">
                    · joined {dateShort(r.signedUpAt)}
                  </span>
                </span>
                <div className="flex gap-2">
                  <Pill tone={r.converted ? "green" : "gray"}>
                    {r.converted ? "Converted" : "Signed up"}
                  </Pill>
                  {r.rewarded && <Pill tone="blue">Reward granted</Pill>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
