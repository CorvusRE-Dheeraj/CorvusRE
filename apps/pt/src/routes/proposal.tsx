import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MarkdownLite } from "@/components/MarkdownLite";
import { invokeEdgeFunction } from "@/lib/edge-functions";

// A CorvusPT proposal sent to a prospect (Business Development). No sign-in —
// the link's token names one proposal version. The prospect reads it, signs
// it with their typed name, or declines; a signature is what verifies the
// agreement milestone on the opportunity.
export const Route = createFileRoute("/proposal")({
  validateSearch: (s: Record<string, unknown>): { t?: string } => ({
    t: typeof s.t === "string" ? s.t : undefined,
  }),
  head: () => ({
    meta: [{ title: "Proposal — CorvusPT" }, { name: "robots", content: "noindex" }],
  }),
  component: ProposalPage,
});

type View = {
  title: string;
  body: string;
  status: string;
  version: number;
  organization: string | null;
  signedAt: string | null;
  signerName: string | null;
};

function ProposalPage() {
  const { t } = Route.useSearch();
  const [p, setP] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    invokeEdgeFunction<View>("bd-console", { action: "proposal", token: t, op: "view" })
      .then(setP)
      .catch(() => setError("This link isn't valid or the proposal has been replaced."));
  useEffect(() => {
    if (!t) return setError("This link isn't valid.");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  async function act(op: "accept" | "decline") {
    setBusy(true);
    try {
      await invokeEdgeFunction("bd-console", {
        action: "proposal",
        token: t,
        op,
        signerName: name,
        signerTitle: title,
        agree,
        reason,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container-page max-w-3xl py-10">
      {error ? (
        <p className="card-elev p-6 text-sm">{error}</p>
      ) : !p ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <article className="card-elev p-6 sm:p-8">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            CorvusPT proposal{p.organization ? ` for ${p.organization}` : ""} · version {p.version}
          </p>
          <h1 className="mt-1 font-serif text-2xl font-semibold">{p.title}</h1>
          <div className="prose prose-sm mt-4 max-w-none">
            <MarkdownLite text={p.body} />
          </div>
          <div className="mt-8 border-t border-border pt-6">
            {p.status === "signed" ? (
              <p className="text-sm text-success">
                Signed by {p.signerName} on{" "}
                {p.signedAt
                  ? new Date(p.signedAt).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })
                  : ""}
                . Thank you — we&apos;ll be in touch about next steps.
              </p>
            ) : p.status === "declined" ? (
              <p className="text-sm">
                You declined this proposal. Reply to our email any time if you&apos;d like to talk
                again.
              </p>
            ) : p.status === "superseded" ? (
              <p className="text-sm">
                A newer version of this proposal was sent to you — please use that link.
              </p>
            ) : declining ? (
              <div className="grid gap-2 text-sm">
                <textarea
                  className="min-h-[80px] rounded-md border border-input bg-background px-3 py-2"
                  placeholder="Anything you'd like us to know (optional)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label="Reason"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-outline text-sm"
                    disabled={busy}
                    onClick={() => void act("decline")}
                  >
                    Decline the proposal
                  </button>
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => setDeclining(false)}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 text-sm">
                <h2 className="font-semibold">Accept and sign</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="rounded-md border border-input bg-background px-3 py-2"
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="Your full name"
                  />
                  <input
                    className="rounded-md border border-input bg-background px-3 py-2"
                    placeholder="Your title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-label="Your title"
                  />
                </div>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                  />
                  <span>
                    I am authorized to accept this proposal on behalf of{" "}
                    {p.organization ?? "my organization"}, and typing my name above is my electronic
                    signature.
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-accent"
                    disabled={busy || name.trim().length < 3 || !agree}
                    onClick={() => void act("accept")}
                  >
                    {busy ? "Signing…" : "Accept & sign"}
                  </button>
                  <button type="button" className="btn-outline" onClick={() => setDeclining(true)}>
                    Decline
                  </button>
                </div>
              </div>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
