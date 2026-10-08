import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getMyLatestPacket,
  isPacketCurrent,
  OPEN_PACKET_EVENT,
  PACKET_SIGNED_EVENT,
  rememberPacketSkipped,
  wasPacketSkipped,
  type EngagementPacket,
} from "@/lib/engagement-packet";
import {
  getLatestTermsAcceptance,
  recordTermsAcceptance,
  termsAcceptanceNeeded,
} from "@/lib/legal-acceptance";
import { getMyProfile, updateMyProfile } from "@/lib/profile";
import { searchPropertiesByOwner } from "@/lib/cad-owner-search";
import type { CadRecord } from "@/lib/cad-lookup";
import { getErrorMessage } from "@/lib/error-message";
import { AddOwnershipsModal } from "@/components/AddOwnershipsModal";
import { EngagementPacketForm, type PacketPrefill } from "@/components/EngagementPacketForm";
import { WelcomeScreen, shouldShowWelcome, markWelcomeSeen } from "@/components/WelcomeScreen";

type Mode =
  { kind: "first-visit" } | { kind: "required"; resolve?: (p: EngagementPacket | null) => void };

// The one pop-up for every CorvusPT agreement (see EngagementPacketForm). Replaces
// the old LegalGate (Terms) and ProfileGate (name) pop-ups. Lives in __root.tsx.
//
//  - First visit (or after the packet changes): opens on its own, with "Skip for
//    now". Skipping still records the Terms & Privacy acceptance when that's
//    outstanding (they govern using the app at all) and saves a name when the
//    profile has none — it only defers signing the service documents.
//  - Filing: requirePacket() opens it as "Please complete the service agreement
//    form" with Cancel instead of Skip, and the filing continues once signed.
export function EngagementPacketHost() {
  const { user, loading, workspace, workspaces } = useAuth();
  // Team access: a property manager or CPA never signs the owner's agreements
  // (the Form 50-162 appointment, the service agreement), so the first-visit
  // prompt is skipped for anyone who's a member of an owner's account.
  const isMember = !!workspace || workspaces.length > 0;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mode, setMode] = useState<Mode | null>(null);
  const [packet, setPacket] = useState<EngagementPacket | null>(null);
  const [termsNeeded, setTermsNeeded] = useState(false);
  const [hasName, setHasName] = useState(true);
  const [termsChecked, setTermsChecked] = useState(false);
  const [skipping, setSkipping] = useState(false);
  // A brand-new account sees the welcome screen first; the agreements pop-up (if
  // due) follows once they continue.
  const [welcome, setWelcome] = useState(false);
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
    pathname === "/admin-login" ||
    // An invitee accepts before anything else; they never sign for the owner.
    pathname === "/accept-invite";

  useEffect(() => {
    if (loading || !user || isMember) {
      setMode(null);
      setWelcome(false);
      return;
    }
    setWelcome(shouldShowWelcome(user));
    let cancelled = false;
    Promise.all([
      getMyLatestPacket().catch(() => null),
      getLatestTermsAcceptance().catch(() => null),
      getMyProfile(user.id).catch(() => null),
    ]).then(([latest, terms, profile]) => {
      if (cancelled) return;
      // A read failure must never lock anyone out — treat unknowns as satisfied.
      const needTerms = terms === null ? false : termsAcceptanceNeeded(terms);
      const named = profile ? !!profile.firstName : true;
      setPacket(latest);
      setTermsNeeded(needTerms);
      setHasName(named);
      const packetDue = !isPacketCurrent(latest) && !wasPacketSkipped(user.id);
      if (needTerms || !named || packetDue) {
        setMode((m) => m ?? { kind: "first-visit" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, loading, isMember]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (
        e as CustomEvent<{ required: boolean; resolve?: (p: EngagementPacket | null) => void }>
      ).detail;
      // In an owner's account, filing needs the OWNER's signed agreements —
      // a member can't sign them.
      if (workspace) {
        detail?.resolve?.(null);
        toast.error(
          `Filing needs ${workspace.ownerName}'s own signature. Everything you've prepared is saved in their account — ask them to sign in and file it.`,
        );
        return;
      }
      setMode(
        detail?.required ? { kind: "required", resolve: detail.resolve } : { kind: "first-visit" },
      );
    };
    const onSigned = (e: Event) => setPacket((e as CustomEvent<EngagementPacket>).detail);
    window.addEventListener(OPEN_PACKET_EVENT, onOpen);
    window.addEventListener(PACKET_SIGNED_EVENT, onSigned);
    return () => {
      window.removeEventListener(OPEN_PACKET_EVENT, onOpen);
      window.removeEventListener(PACKET_SIGNED_EVENT, onSigned);
    };
  }, [workspace]);

  // ProfileGate's old one-time owner lookup: once a name is first saved, look for
  // properties already on file under it and offer to add them. Best-effort.
  function lookUpOwnerProperties(name: string) {
    if (!user || !name.trim()) return;
    searchPropertiesByOwner(name.trim())
      .then(({ matches }) => {
        if (matches.length > 0)
          setOwnerMatches({ userId: user.id, name: name.trim(), records: matches });
      })
      .catch((err) => console.error("Owner lookup after signup failed:", err));
  }

  function finish(signed: EngagementPacket | null) {
    if (mode?.kind === "required") mode.resolve?.(signed);
    setMode(null);
    setTermsChecked(false);
  }

  async function skip(details: PacketPrefill) {
    if (!user || skipping) return;
    if (termsNeeded && !termsChecked) {
      toast.error("Please agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }
    const first = details.firstName?.trim() ?? "";
    const last = details.lastName?.trim() ?? "";
    if (!hasName && (!first || !last)) {
      toast.error("Please enter your first and last name to continue.");
      return;
    }
    setSkipping(true);
    try {
      if (termsNeeded) {
        await recordTermsAcceptance();
        setTermsNeeded(false);
      }
      if (!hasName) {
        await updateMyProfile(user.id, {
          firstName: first,
          lastName: last,
          ...(details.phone?.trim() ? { phone: details.phone.trim() } : {}),
          ...(details.companyName?.trim() ? { companyName: details.companyName.trim() } : {}),
        });
        setHasName(true);
        lookUpOwnerProperties(details.companyName?.trim() || `${first} ${last}`);
      }
      rememberPacketSkipped(user.id);
      finish(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save. Please try again."));
    } finally {
      setSkipping(false);
    }
  }

  const ownerModal =
    ownerMatches && !onExemptRoute ? (
      <AddOwnershipsModal
        userId={ownerMatches.userId}
        initialMatch={{ name: ownerMatches.name, role: "owner", records: ownerMatches.records }}
        onImported={() => {}}
        onClose={() => setOwnerMatches(null)}
      />
    ) : null;

  // Welcome comes first — but never in front of a filing waiting on a signature.
  if (user && welcome && !onExemptRoute && mode?.kind !== "required") {
    return (
      <WelcomeScreen
        onContinue={() => {
          markWelcomeSeen(user.id);
          setWelcome(false);
        }}
      />
    );
  }

  if (!user || !mode || onExemptRoute) return ownerModal;

  const required = mode.kind === "required";
  const prefill: PacketPrefill | undefined = packet
    ? {
        firstName: packet.firstName,
        lastName: packet.lastName,
        title: packet.title,
        role: packet.role,
        companyName: packet.companyName ?? "",
        phone: packet.phone,
      }
    : undefined;

  return (
    <>
      <div
        data-blocking-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="engagement-packet-title"
        className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-3 sm:p-6"
      >
        <div className="bg-card flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl shadow-elev">
          <div className="border-border flex items-start justify-between gap-3 border-b px-5 py-4 sm:px-7">
            <div>
              <h2 id="engagement-packet-title" className="font-serif text-xl font-semibold">
                {required
                  ? "Please complete the service agreement form"
                  : packet
                    ? "We've updated our agreements"
                    : "Welcome to CorvusPT — review & sign your agreements"}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {required
                  ? "Before CorvusPT can file for you, review and sign the engagement packet below. You only sign once — it's applied to each property you ask us to protest."
                  : "Sign once here and you won't be asked again when you file. You can skip for now and sign any time from the Agreements tab — it's needed before your first protest."}
              </p>
            </div>
            {required && (
              <button
                type="button"
                onClick={() => finish(null)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground rounded-md p-1"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="grow overflow-y-auto px-5 py-5 sm:px-7">
            {!required && termsNeeded && (
              <label className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={termsChecked}
                  onChange={(e) => setTermsChecked(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I agree to the{" "}
                  <Link
                    to="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    to="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Privacy Policy
                  </Link>
                  . (Needed to use CorvusPT even if you skip signing the rest for now — submitting
                  the packet below accepts them too.)
                </span>
              </label>
            )}
            <EngagementPacketForm
              userId={user.id}
              prefill={prefill}
              secondaryAction={
                required
                  ? { label: "Cancel", onClick: () => finish(null) }
                  : { label: "Skip for now", onClick: skip, busy: skipping }
              }
              onSigned={(signed) => {
                setPacket(signed);
                setTermsNeeded(false);
                if (!hasName) {
                  setHasName(true);
                  lookUpOwnerProperties(
                    signed.companyName || `${signed.firstName} ${signed.lastName}`,
                  );
                }
                finish(signed);
              }}
            />
          </div>
        </div>
      </div>
      {ownerModal}
    </>
  );
}
