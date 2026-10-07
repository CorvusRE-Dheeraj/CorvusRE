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
import { requestBppProtest, saveBppAuthorization, type ProtestRecord } from "@/lib/protests";
import { requirePacket, type EngagementPacket } from "@/lib/engagement-packet";
import type { BppAccountRecord } from "@/lib/bpp-accounts";
import { getErrorMessage } from "@/lib/error-message";

// BPP's protest-start flow. Like ProtestAuthorizationFlow, every agreement is
// signed once in the Engagement Packet — this asks for it first if it isn't on
// file, then needs one confirm. Writes protests' own bpp_* columns via
// saveBppAuthorization() (see that function's comment for why BPP keeps its own
// columns), now filled from the packet's signer and signature.
export function BppProtestFlow({
  userId,
  account,
  userEmail,
  open,
  isPaid,
  onOpenChange,
  onDone,
}: {
  userId: string;
  account: BppAccountRecord;
  userEmail?: string | null;
  open: boolean;
  isPaid: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (protest: ProtestRecord) => void;
}) {
  const [packet, setPacket] = useState<EngagementPacket | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous double-submit guard — see ProtestAuthorizationFlow.
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPacket(null);
    requirePacket().then((p) => {
      if (cancelled) return;
      if (!p) onOpenChange(false);
      else setPacket(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account.id]);

  function close() {
    onOpenChange(false);
    setError(null);
  }

  async function handleSubmit() {
    if (!packet) return;
    if (!isPaid) {
      setError(
        "This BPP account isn't covered by an active subscription — subscribe before filing.",
      );
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const email = packet.email ?? userEmail ?? "";
      const protest = await requestBppProtest(userId, account.id, {
        businessName: account.businessName,
        userEmail: email,
        originalValue: account.noticeValue ?? account.renderedValue,
        taxYear: account.taxYear,
      });
      await saveBppAuthorization(protest.id, {
        ownerFirstName: packet.firstName,
        ownerLastName: packet.lastName,
        ownerEmail: email,
        ownerPhone: packet.phone,
        signatureType: packet.signature.type,
        signatureData: packet.signature.data,
      });
      toast.success("Protest started. CorvusPT staff will follow up.");
      onDone(protest);
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

  // While the packet is missing, its own pop-up is what's on screen.
  if (open && !packet) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start Protest</DialogTitle>
          <DialogDescription>{account.businessName}</DialogDescription>
        </DialogHeader>

        {packet && (
          <div className="grid gap-4">
            {!isPaid && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                This BPP account isn't covered by an active subscription yet — subscribe before
                starting its protest.
              </div>
            )}

            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg bg-secondary/40 p-4 text-sm sm:grid-cols-2">
              {[
                ["Business", account.businessName],
                ["Account / PID", account.accountNumber ?? "—"],
                ["County", account.cad ?? "—"],
                ["Tax Year", account.taxYear != null ? String(account.taxYear) : "—"],
                [
                  "Rendered Value",
                  account.renderedValue != null
                    ? `$${account.renderedValue.toLocaleString("en-US")}`
                    : "—",
                ],
                [
                  "County's Notice Value",
                  account.noticeValue != null
                    ? `$${account.noticeValue.toLocaleString("en-US")}`
                    : "—",
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 sm:block">
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 truncate text-right sm:text-left">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="grid gap-2 rounded-lg border border-border p-4 text-sm">
              <p className="text-muted-foreground">
                Your signature on file, from the engagement packet you signed on{" "}
                {new Date(packet.signedAt).toLocaleDateString()}, authorizes CorvusPT to file and
                manage a protest of the county&apos;s assessed value for this account.
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
                disabled={submitting || !isPaid}
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
