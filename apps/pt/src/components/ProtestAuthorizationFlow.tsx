// Business-style owner names (LP, LLC, INC, TRUST...) as the county records them.
const ENTITY_WORDS =
  /\b(LP|LLC|LLP|INC|CORP|CORPORATION|CO|LTD|TRUST|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|ASSOCIATES|FUND|OWNER|COMPANY)\b/i;
function looksLikeEntity(name: string | null | undefined): boolean {
  return !!name && ENTITY_WORDS.test(name);
}

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SignaturePreview } from "@/components/SignaturePad";
import { requestProtest, type ProtestRecord } from "@/lib/protests";
import { createAuthorization } from "@/lib/protest-authorizations";
import { recordServiceAgreement } from "@/lib/service-agreement";
import { requirePacket, type EngagementPacket } from "@/lib/engagement-packet";
import type { PropertyRecord } from "@/lib/properties";
import { getErrorMessage } from "@/lib/error-message";

// The TDLR regulatory line is intentionally omitted until registration is
// confirmed. Fee (25%) and service scope were explicitly confirmed as
// CorvusPT's real terms.
export const AGREEMENT = {
  address: "18740 Wainsborough Ln, Dallas, TX",
  phone: "(469) 501-9362",
  email: "properties@srclandbuilding.com",
  venue: "Dallas County, Texas",
};

const ENTITY_TYPES = ["LLC", "Corporation", "Partnership", "Estate", "Trust", "Other"] as const;

// The per-property answers carried from one property to the next when this flow
// is driven in sequence by BulkProtestAuthorizationFlow. Everything else (who's
// signing, the signature) comes from the signed Engagement Packet.
export type CarriedOwnerInfo = {
  isEntity: boolean;
  entityName: string;
  entityRelationship: string;
  entityType: (typeof ENTITY_TYPES)[number] | "";
};

// Starting a protest for one property. Every agreement is signed once, in the
// Engagement Packet (see EngagementPacketForm / the Agreements tab) — this flow
// asks for it first if it isn't on file yet ("Please complete the service
// agreement form"), then needs just one confirm. On confirm it still writes the
// same per-property records as before — this property's Service Agreement (with
// a copy in its Documents) and its Appointment of Agent authorization, which the
// Form 50-162 filler reads — executed with the packet's signature, as the packet
// authorizes.
export function ProtestAuthorizationFlow({
  userId,
  property,
  userEmail,
  open,
  initialOwnerInfo,
  batchProgress,
  isPaid,
  onOpenChange,
  onDone,
}: {
  userId: string;
  property: PropertyRecord;
  userEmail?: string | null;
  open: boolean;
  initialOwnerInfo?: CarriedOwnerInfo;
  // "Property 2 of 5" — purely a progress label for the batch orchestrator.
  batchProgress?: { index: number; total: number };
  // Real payment gate, enforced here rather than trusted to whichever caller
  // renders the button that opens this modal. Callers compute this themselves
  // (beta bypasses unconditionally; every other plan reads the property's own
  // subscriptionStatus).
  isPaid: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (protest: ProtestRecord, ownerInfo: CarriedOwnerInfo) => void;
}) {
  const [packet, setPacket] = useState<EngagementPacket | null>(null);
  const [loadingPacket, setLoadingPacket] = useState(false);
  const ownerLooksLikeEntity = looksLikeEntity(property.ownerName);
  const [isEntity, setIsEntity] = useState(initialOwnerInfo?.isEntity ?? ownerLooksLikeEntity);
  const [entityName, setEntityName] = useState(initialOwnerInfo?.entityName ?? "");
  const [entityRelationship, setEntityRelationship] = useState(
    initialOwnerInfo?.entityRelationship ?? "",
  );
  const [entityType, setEntityType] = useState<(typeof ENTITY_TYPES)[number] | "">(
    initialOwnerInfo?.entityType ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  // Synchronous double-submit guard — `submitting` only disables the button on
  // the NEXT render, and a real double-click once filed the same protest twice.
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // On open: the signed packet, or prompt for it. Closing the packet pop-up
  // without signing closes this too — there's nothing to confirm without it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingPacket(true);
    requirePacket()
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          onOpenChange(false);
          return;
        }
        setPacket(p);
        // Prefill the entity answers from who signed, unless a prior property in
        // this batch already answered them.
        if (!initialOwnerInfo) {
          if (p.role === "representative") setIsEntity(true);
          setEntityName(
            (v) => v || p.companyName || (ownerLooksLikeEntity ? (property.ownerName ?? "") : ""),
          );
          setEntityRelationship((v) => v || p.title);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPacket(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, property.id]);

  function close() {
    onOpenChange(false);
    setError(null);
  }

  const entityValid = !isEntity || (entityName.trim() && entityRelationship.trim() && entityType);

  async function handleSubmit() {
    if (!packet || !entityValid) return;
    if (!isPaid) {
      setError("This property isn't covered by an active subscription — subscribe before filing.");
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Recorded first — a failure aborts before any protest row exists.
      await recordServiceAgreement({ propertyId: property.id, engagementPacketId: packet.id });
      const protest = await requestProtest(userId, property.id, {
        address: property.address,
        userEmail: packet.email ?? userEmail ?? "",
        originalValue: property.totalValue,
        taxYear: property.taxYear,
      });
      await createAuthorization(userId, {
        protestId: protest.id,
        propertyId: property.id,
        engagementPacketId: packet.id,
        firstName: packet.firstName,
        lastName: packet.lastName,
        email: packet.email ?? userEmail ?? "",
        phone: packet.phone,
        isEntity,
        entityName: entityName.trim(),
        entityRelationship: entityRelationship.trim(),
        entityType,
        signature: packet.signature,
      });
      toast.success("Protest started. CorvusPT staff will follow up.");
      onDone(protest, {
        isEntity,
        entityName: entityName.trim(),
        entityRelationship: entityRelationship.trim(),
        entityType,
      });
      close();
    } catch (err) {
      const message = getErrorMessage(err, "Could not start this protest.");
      setError(message);
      toast.error(message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // Nothing to show until the packet's in hand — while it's missing, the packet
  // pop-up itself is what's on screen.
  if (open && (!packet || loadingPacket)) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start Protest</DialogTitle>
          <DialogDescription>
            {property.address}
            {batchProgress && ` — Property ${batchProgress.index} of ${batchProgress.total}`}
          </DialogDescription>
        </DialogHeader>

        {packet && (
          <div className="grid gap-4">
            {!isPaid && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                This property isn't covered by an active subscription yet — subscribe before
                starting its protest.
              </div>
            )}

            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg bg-secondary/40 p-4 text-sm sm:grid-cols-2">
              {[
                ["Property", property.address],
                ["Account / PID", property.accountNumber ?? "—"],
                ["County", property.cad ?? "—"],
                ["Tax Year", property.taxYear != null ? String(property.taxYear) : "—"],
                ["Owner of Record", property.ownerName ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 sm:block">
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 truncate text-right sm:text-left">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  {property.ownerName ? (
                    <>
                      Is this property owned by{" "}
                      <span className="font-medium">{property.ownerName}</span> (a company, trust or
                      other entity)?
                    </>
                  ) : (
                    "Is this property owned by a trust, LLC, or other entity?"
                  )}
                </span>
                <div className="flex gap-3 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={isEntity}
                      onChange={() => {
                        setIsEntity(true);
                        if (!entityName.trim() && property.ownerName)
                          setEntityName(property.ownerName);
                      }}
                    />
                    Yes
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={!isEntity} onChange={() => setIsEntity(false)} />
                    No
                  </label>
                </div>
              </div>
              {!isEntity && ownerLooksLikeEntity && (
                <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  The county lists the owner as{" "}
                  <span className="font-medium">{property.ownerName}</span>, which looks like a
                  business. If you are not that owner yourself, choose Yes and tell us how you are
                  connected to it. We may ask for proof before we file.
                </p>
              )}
            </div>

            {isEntity && (
              <div className="grid gap-4 rounded-lg bg-secondary/40 p-4">
                <p className="text-xs text-muted-foreground">
                  If you're not an authorized representative of the entity, CorvusPT may be unable
                  to proceed with this protest.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Entity Name</span>
                    <input
                      value={entityName}
                      onChange={(e) => setEntityName(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      Your Relationship to Entity
                    </span>
                    <input
                      value={entityRelationship}
                      onChange={(e) => setEntityRelationship(e.target.value)}
                      placeholder="Owner, Manager, Trustee…"
                      className="rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-sm sm:max-w-xs">
                  <span className="text-xs font-medium text-muted-foreground">Type of Entity</span>
                  <select
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value as (typeof ENTITY_TYPES)[number])}
                    className="rounded-md border border-input bg-background px-3 py-2"
                  >
                    <option value="">Choose…</option>
                    {ENTITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="grid gap-2 rounded-lg border border-border p-4 text-sm">
              <p className="text-muted-foreground">
                Your signature on file will be applied to this property&apos;s CorvusPT Service
                Agreement and Appointment of Agent (Form 50-162), as authorized in the engagement
                packet you signed on {new Date(packet.signedAt).toLocaleDateString()}. CorvusPT
                files the appointment with {property.cad ?? "the appraisal district"}.
              </p>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <SignaturePreview value={packet.signature} />
                  <div className="text-xs text-muted-foreground">
                    {packet.firstName} {packet.lastName}, {packet.title}
                  </div>
                </div>
                <Link to="/dashboard/agreements" className="text-xs text-accent underline">
                  View or update in Agreements
                </Link>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button onClick={close} className="btn-outline">
                Cancel
              </button>
              <button
                disabled={!entityValid || submitting || !isPaid}
                onClick={handleSubmit}
                className="btn-primary btn-primary-hover disabled:opacity-50"
              >
                {submitting ? "Starting…" : "Start Protest"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
