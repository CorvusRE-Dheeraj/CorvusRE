import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, SearchX, ShieldCheck } from "lucide-react";
import {
  normalizeTrackingId,
  verifySigningPacket,
  type VerifiedPacket,
} from "@/lib/signing-packets";

// Public check of a signing packet ID (printed on every signed CorvusPT PDF
// and shown in the app): confirms the packet is on record, what was signed,
// when, and by whom (first name + last initial). No sign-in needed. See
// supabase/pt/signing-packets.sql.
export const Route = createFileRoute("/verify")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => ({
    id: typeof s.id === "string" && s.id ? s.id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Verify a signed document — CorvusPT" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Verify,
});

type State =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "found"; packet: VerifiedPacket }
  | { status: "not-found"; id: string }
  | { status: "invalid" }
  | { status: "error" };

function Verify() {
  const { id } = Route.useSearch();
  const nav = useNavigate();
  const [input, setInput] = useState(id ?? "");
  const [state, setState] = useState<State>({ status: "idle" });

  useEffect(() => {
    if (!id) {
      setState({ status: "idle" });
      return;
    }
    setInput(id);
    const normalized = normalizeTrackingId(id);
    if (!normalized) {
      setState({ status: "invalid" });
      return;
    }
    let live = true;
    setState({ status: "checking" });
    verifySigningPacket(normalized)
      .then((packet) => {
        if (!live) return;
        setState(packet ? { status: "found", packet } : { status: "not-found", id: normalized });
      })
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
  }, [id]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeTrackingId(input);
    if (!normalized) {
      setState({ status: "invalid" });
      return;
    }
    nav({ to: "/verify", search: { id: normalized }, replace: true });
  }

  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-12">
      <div className="card-elev w-full max-w-lg p-6 sm:p-8">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent">
          <ShieldCheck className="h-5 w-5" aria-hidden /> Verify a signed document
        </div>
        <h1 className="mt-2 font-serif text-2xl font-semibold">Signing packet lookup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every document signed on CorvusPT has a signing packet ID, printed along the bottom of the
          signed PDF (for example CPT-7F3K-9Q2M). Enter it to confirm it&apos;s on record.
        </p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="tracking-id" className="sr-only">
            Signing packet ID
          </label>
          <input
            id="tracking-id"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="CPT-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="submit" className="btn-accent shrink-0 text-sm">
            Verify
          </button>
        </form>

        <div className="mt-5" aria-live="polite">
          {state.status === "checking" && (
            <p className="text-sm text-muted-foreground">Checking…</p>
          )}
          {state.status === "invalid" && (
            <p className="text-sm text-destructive">
              That isn&apos;t a signing packet ID — it looks like CPT- followed by 8 letters and
              numbers.
            </p>
          )}
          {state.status === "error" && (
            <p className="text-sm text-destructive">Couldn&apos;t check right now — try again.</p>
          )}
          {state.status === "not-found" && (
            <div className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm">
              <SearchX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <div className="font-semibold">No signing packet {state.id} on record.</div>
                <p className="text-muted-foreground">
                  Check the ID on the document. A document showing an ID that isn&apos;t on record
                  wasn&apos;t signed on CorvusPT.
                </p>
              </div>
            </div>
          )}
          {state.status === "found" && (
            <div className="rounded-lg bg-success/10 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 className="h-5 w-5" aria-hidden /> Verified — this signing is on
                record
              </div>
              <dl className="mt-3 grid gap-2">
                <Row label="Signing packet ID">
                  <span className="font-mono font-semibold">{state.packet.trackingId}</span>
                </Row>
                <Row label="Document">{state.packet.title}</Row>
                <Row label="Signed">
                  {new Date(state.packet.signedAt).toLocaleString("en-US", {
                    dateStyle: "long",
                    timeStyle: "short",
                  })}
                </Row>
                {state.packet.signer && <Row label="Signed by">{state.packet.signer}</Row>}
                <Row label="Record fingerprint (SHA-256)">
                  <span className="break-all font-mono text-[11px]">
                    {state.packet.fingerprint}
                  </span>
                </Row>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                The fingerprint was taken from the signed record at the moment of signing. CorvusPT
                keeps the full record — signer, time, IP address and browser — for this ID.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
