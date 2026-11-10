import { useState } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import { verifyUrl } from "@/lib/signing-packets";

// The signing packet's tracking ID (lib/signing-packets.ts) with copy and a
// link to the public verification page.
export function SigningIdBadge({
  trackingId,
  className = "",
}: {
  trackingId: string | null | undefined;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!trackingId) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(trackingId!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the ID is still on screen to select
    }
  }
  return (
    <div
      className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs ${className}`}
    >
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
      <span className="text-muted-foreground">Signing packet ID</span>
      <span className="font-mono font-semibold tracking-wide">{trackingId}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy signing packet ID"
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
      </button>
      <a
        href={verifyUrl(trackingId)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent underline underline-offset-2 hover:no-underline"
      >
        Verify
      </a>
    </div>
  );
}
