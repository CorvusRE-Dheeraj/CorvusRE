import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, FileSignature } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getMyLatestPacket,
  isPacketCurrent,
  PACKET_DOCUMENTS,
  PACKET_SIGNED_EVENT,
  SIGNEE_ROLE_LABEL,
  type EngagementPacket,
} from "@/lib/engagement-packet";
import { EngagementPacketForm } from "@/components/EngagementPacketForm";
import { SignaturePreview } from "@/components/SignaturePad";
import { PageHero } from "@/components/PageHero";
import { PageSkeleton } from "@/components/PageSkeleton";

export const Route = createFileRoute("/dashboard/_layout/agreements")({
  component: Agreements,
});

// Every CorvusPT agreement in one place: what's signed (and when, and as whom),
// or the packet to sign. The same form the first-visit / filing pop-up shows.
function Agreements() {
  const { user } = useAuth();
  const [packet, setPacket] = useState<EngagementPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [resigning, setResigning] = useState(false);

  useEffect(() => {
    getMyLatestPacket()
      .then(setPacket)
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
    const onSigned = (e: Event) => {
      setPacket((e as CustomEvent<EngagementPacket>).detail);
      setResigning(false);
    };
    window.addEventListener(PACKET_SIGNED_EVENT, onSigned);
    return () => window.removeEventListener(PACKET_SIGNED_EVENT, onSigned);
  }, []);

  const current = isPacketCurrent(packet);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHero
        icon={FileSignature}
        title="Agreements"
        tone="indigo"
        subtitle="Every CorvusPT agreement in one place — sign once, and it's applied to each property you ask us to protest."
      />

      {loading || !user ? (
        <PageSkeleton />
      ) : packet && current && !resigning ? (
        <div className="mt-6 grid gap-4">
          <div className="card-elev p-6">
            <div className="flex items-center gap-2 text-accent">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              <span className="font-semibold">Engagement packet signed</span>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Field label="Signed by" value={`${packet.firstName} ${packet.lastName}`} />
              <Field label="Title" value={packet.title} />
              <Field label="Signing as" value={SIGNEE_ROLE_LABEL[packet.role]} />
              {packet.companyName && <Field label="Company / entity" value={packet.companyName} />}
              <Field label="Signed on" value={new Date(packet.signedAt).toLocaleString()} />
              <Field label="Phone" value={packet.phone} />
            </dl>
            <div className="mt-4 border-t border-border pt-4">
              <div className="text-xs font-medium text-muted-foreground">Signature</div>
              <SignaturePreview value={packet.signature} className="mt-1" />
            </div>
          </div>

          <div className="card-elev p-6">
            <h2 className="font-serif text-lg font-semibold">What you signed</h2>
            <ul className="mt-3 grid gap-3">
              {PACKET_DOCUMENTS.map((d) => (
                <li key={d.doc}>
                  <div className="text-sm font-semibold">{d.title}</div>
                  <p className="text-xs text-muted-foreground">{d.summary}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              Each property&apos;s own Service Agreement copy is saved to that property&apos;s
              Documents when its protest starts.
            </p>
            <button
              type="button"
              onClick={() => setResigning(true)}
              className="btn-outline mt-4 text-sm"
            >
              Update details or signature
            </button>
          </div>
        </div>
      ) : (
        <div className="card-elev mt-6 p-4 sm:p-6">
          {packet && !current && !resigning && (
            <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              Our agreements have changed since you signed on{" "}
              {new Date(packet.signedAt).toLocaleDateString()}. Please review and sign the updated
              packet before your next protest.
            </p>
          )}
          <EngagementPacketForm
            userId={user.id}
            prefill={
              packet
                ? {
                    firstName: packet.firstName,
                    lastName: packet.lastName,
                    title: packet.title,
                    role: packet.role,
                    companyName: packet.companyName ?? "",
                    phone: packet.phone,
                  }
                : undefined
            }
            secondaryAction={
              resigning ? { label: "Cancel", onClick: () => setResigning(false) } : undefined
            }
            onSigned={(p) => {
              setPacket(p);
              setResigning(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
