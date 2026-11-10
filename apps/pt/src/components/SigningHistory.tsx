import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { listMySigningPackets, verifyUrl, type MySigningPacket } from "@/lib/signing-packets";

// Agreements → "Signing history": every document this account has signed,
// each with its own signing packet ID (lib/signing-packets.ts).
export function SigningHistory({ userId }: { userId: string }) {
  const [rows, setRows] = useState<MySigningPacket[] | null>(null);
  useEffect(() => {
    listMySigningPackets(userId)
      .then(setRows)
      .catch(() => setRows([]));
  }, [userId]);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="card-elev mt-4 p-6">
      <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
        <ShieldCheck className="h-5 w-5 text-success" aria-hidden /> Signing history
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every document you&apos;ve signed on CorvusPT has its own signing packet ID. Anyone you
        share a signed document with can check it on the verification page.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.trackingId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm"
          >
            <div className="min-w-0">
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(r.signedAt).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {r.signerName ? ` · ${r.signerName}` : ""}
              </div>
            </div>
            <a
              href={verifyUrl(r.trackingId)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs font-semibold tracking-wide underline underline-offset-2 hover:no-underline"
              title="Verify this signing packet"
            >
              {r.trackingId}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
