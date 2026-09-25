import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getMyProfile, updateMyProfile } from "@/lib/profile";
import { getErrorMessage } from "@/lib/error-message";
import { searchPropertiesByOwner } from "@/lib/cad-owner-search";
import type { CadRecord } from "@/lib/cad-lookup";
import { AddOwnershipsModal } from "@/components/AddOwnershipsModal";

// Shown once to a signed-in user with no name on file — the case for anyone
// who arrived via the shared cross-door identity sign-in (/auth/) rather than
// CorvusPT's own sign-up form, which is the only place that ever asks for a
// name. Sits below LegalGate in the stacking order (z-[99] vs its z-[100]):
// if both are needed, Terms comes first and this follows right after, rather
// than showing two blocking dialogs on top of each other.
//
// Also where the old sign-up form's one-time owner lookup lives now: right after
// the details are saved, search the supported county sources for properties
// already on file under the company name (or the person's own full name when
// no company was given, so individual owners get portfolio discovery too) and,
// if there are any, open Add Ownerships pre-filled with the matches instead of
// making the person type every address. Runs at most once per account — this
// gate itself only ever shows while the profile still has no first name.
export function ProfileGate() {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [needed, setNeeded] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ownerMatches, setOwnerMatches] = useState<{
    userId: string;
    name: string;
    records: CadRecord[];
  } | null>(null);

  const onExemptRoute =
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname === "/sign-in" ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/forgot-password") ||
    pathname === "/admin-login";

  useEffect(() => {
    if (loading || !user) {
      setNeeded(false);
      return;
    }
    let cancelled = false;
    getMyProfile(user.id)
      .then((profile) => {
        if (cancelled) return;
        setNeeded(!profile.firstName);
      })
      .catch(() => {
        // A read failure shouldn't lock anyone out — worst case, they're
        // never prompted and their name just stays blank.
        if (!cancelled) setNeeded(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const ownerModal =
    ownerMatches && !onExemptRoute ? (
      <AddOwnershipsModal
        userId={ownerMatches.userId}
        initialMatch={{ name: ownerMatches.name, role: "owner", records: ownerMatches.records }}
        onImported={() => {}}
        onClose={() => setOwnerMatches(null)}
      />
    ) : null;

  if (!needed || onExemptRoute) return ownerModal;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || submitting) return;
    if (!firstName.trim() || !lastName.trim()) return;
    setSubmitting(true);
    try {
      await updateMyProfile(user.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName.trim() || null,
      });
      const ownerName = companyName.trim() || `${firstName.trim()} ${lastName.trim()}`;
      setNeeded(false);
      // Best-effort and after the gate closes: a slow or failed county search
      // must never keep someone stuck on the details form.
      searchPropertiesByOwner(ownerName)
        .then(({ matches }) => {
          if (matches.length > 0) {
            setOwnerMatches({ userId: user.id, name: ownerName, records: matches });
          }
        })
        .catch((err) => console.error("Owner lookup after signup failed:", err));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save your details. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-blocking-dialog
      className="fixed inset-0 z-[99] grid place-items-center bg-black/60 p-4 sm:p-6"
    >
      <div className="bg-card w-full max-w-md rounded-2xl p-6 shadow-elev sm:p-8">
        <h2 className="font-serif text-xl font-semibold">A couple of details</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Before you continue, tell us who's using CorvusPT.
        </p>
        <form onSubmit={submit} className="mt-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">
                First Name<span className="text-destructive"> *</span>
              </span>
              <input
                required
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">
                Last Name<span className="text-destructive"> *</span>
              </span>
              <input
                required
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Business / LLC Name (optional)</span>
            <input
              type="text"
              autoComplete="organization"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <button
            disabled={submitting}
            className="btn-primary btn-primary-hover disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
