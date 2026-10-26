// The county-record check's state, as the customer sees it (see
// lib/property-verification.ts). Shows nothing for a verified property.
import { ShieldAlert, ShieldCheck, FlaskConical, Loader2 } from "lucide-react";
import {
  VERIFICATION_CUSTOMER_TEXT,
  VERIFICATION_LABEL,
  type PropertyVerificationStatus,
} from "@/lib/property-verification";

const TONE: Record<PropertyVerificationStatus, string> = {
  pending: "border-border bg-secondary/50 text-muted-foreground",
  verified: "border-accent/40 bg-accent/10 text-accent",
  needs_review: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  test: "border-border bg-secondary/50 text-muted-foreground",
};

function Icon({ status }: { status: PropertyVerificationStatus }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (status === "pending") return <Loader2 className={`${cls} animate-spin`} aria-hidden />;
  if (status === "verified") return <ShieldCheck className={cls} aria-hidden />;
  if (status === "test") return <FlaskConical className={cls} aria-hidden />;
  return <ShieldAlert className={cls} aria-hidden />;
}

/** A small pill — shown next to a property's address (not for verified ones). */
export function VerificationBadge({ status }: { status?: PropertyVerificationStatus }) {
  if (!status || status === "verified") return null;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[status]}`}
      title={VERIFICATION_CUSTOMER_TEXT[status] ?? undefined}
    >
      <Icon status={status} />
      {VERIFICATION_LABEL[status]}
    </span>
  );
}

/** The explanation, e.g. at the top of the filing steps. */
export function VerificationNotice({
  status,
  note,
}: {
  status?: PropertyVerificationStatus;
  note?: string | null;
}) {
  if (!status || status === "verified") return null;
  const text = VERIFICATION_CUSTOMER_TEXT[status];
  return (
    <div
      role="status"
      className={`mt-3 flex items-start gap-2 rounded-md border p-3 text-sm ${TONE[status]}`}
    >
      <span className="mt-0.5">
        <Icon status={status} />
      </span>
      <span>
        {text}
        {status === "rejected" && note ? ` Reason: ${note}` : null}
      </span>
    </div>
  );
}
