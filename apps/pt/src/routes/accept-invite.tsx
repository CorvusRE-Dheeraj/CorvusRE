import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { acceptInvite, listMyWorkspaces } from "@/lib/account-members";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : undefined,
  }),
  component: AcceptInvite,
});

// Kept across the sign-in round trip, which returns to this page without
// the query string.
const TOKEN_KEY = "corvuspt.inviteToken";

// Team access: accepting an owner's invitation (invite-account-member email).
// The invite only works for the email address it was sent to.
function AcceptInvite() {
  const { token: fromUrl } = Route.useSearch();
  const { realUser, loading, setWorkspace } = useAuth();
  const [state, setState] = useState<
    | { kind: "working" }
    | { kind: "accepted"; ownerId: string; ownerName: string }
    | { kind: "failed" }
    | { kind: "missing" }
  >({ kind: "working" });

  const token = (() => {
    if (fromUrl) {
      try {
        sessionStorage.setItem(TOKEN_KEY, fromUrl);
      } catch {
        // storage blocked
      }
      return fromUrl;
    }
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  })();

  useEffect(() => {
    if (loading || !realUser) return;
    if (!token) {
      setState({ kind: "missing" });
      return;
    }
    acceptInvite(token)
      .then(async (ok) => {
        if (!ok) return setState({ kind: "failed" });
        try {
          sessionStorage.removeItem(TOKEN_KEY);
        } catch {
          // storage blocked
        }
        const list = await listMyWorkspaces(realUser.id);
        const latest = list[list.length - 1];
        setState(
          latest
            ? { kind: "accepted", ownerId: latest.ownerId, ownerName: latest.ownerName }
            : { kind: "failed" },
        );
      })
      .catch(() => setState({ kind: "failed" }));
  }, [loading, realUser, token]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="card-elev p-6 text-center">
        <Users className="mx-auto h-8 w-8 text-accent" aria-hidden="true" />
        {!loading && !realUser ? (
          <>
            <h1 className="mt-3 font-serif text-2xl font-semibold">Accept your invitation</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in — or create a free account — with the email address the invitation was sent
              to. You&apos;ll come straight back here.
            </p>
            <Link
              to="/sign-in"
              search={{ redirect: "/accept-invite" }}
              className="btn-primary btn-primary-hover mt-4 inline-block text-sm"
            >
              Sign in to accept
            </Link>
          </>
        ) : state.kind === "accepted" ? (
          <>
            <h1 className="mt-3 font-serif text-2xl font-semibold">You&apos;re in</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You now have access to {state.ownerName}&apos;s CorvusPT account. Switch between their
              account and your own any time from the Account bar on your dashboard.
            </p>
            <button
              type="button"
              onClick={() => setWorkspace(state.ownerId)}
              className="btn-primary btn-primary-hover mt-4 text-sm"
            >
              Open {state.ownerName}&apos;s account
            </button>
          </>
        ) : state.kind === "failed" || state.kind === "missing" ? (
          <>
            <h1 className="mt-3 font-serif text-2xl font-semibold">
              This invitation can&apos;t be used
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It may have been accepted already, withdrawn, or sent to a different email than the
              one you&apos;re signed in with ({realUser?.email}). Ask the owner to send it again.
            </p>
            <Link to="/dashboard" className="btn-outline mt-4 inline-block text-sm">
              Go to my dashboard
            </Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Accepting your invitation…</p>
        )}
      </div>
    </div>
  );
}
