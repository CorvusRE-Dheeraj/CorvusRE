import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  subtitle,
  right,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("card-elev p-5 sm:p-6", className)}>
      {(title || right) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-serif text-lg font-semibold">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

const TONE: Record<string, string> = {
  green: "bg-[oklch(0.93_0.06_150)] text-[oklch(0.32_0.12_150)]",
  amber: "bg-[oklch(0.93_0.06_78)] text-[oklch(0.38_0.11_55)]",
  red: "bg-[oklch(0.93_0.06_25)] text-[oklch(0.4_0.16_25)]",
  blue: "bg-[oklch(0.92_0.05_255)] text-[oklch(0.35_0.12_255)]",
  gray: "bg-secondary text-secondary-foreground",
};

export function Pill({
  tone = "gray",
  children,
}: {
  tone?: keyof typeof TONE;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

export function feasibilityTone(status: string | null | undefined): keyof typeof TONE {
  return status === "allowed" ? "green" : status === "not_allowed" ? "red" : "amber";
}

export function permitStatusTone(status: string): keyof typeof TONE {
  switch (status) {
    case "approved":
      return "green";
    case "under_review":
    case "resubmitted":
      return "blue";
    case "comments":
      return "amber";
    case "submitted":
      return "blue";
    default:
      return "gray";
  }
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StepRail({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-2 text-xs">
      {steps.map((label, i) => (
        <li
          key={label}
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5",
            i < current
              ? "border-accent/40 bg-accent/10 text-foreground"
              : i === current
                ? "border-accent bg-accent text-accent-foreground font-semibold"
                : "border-border text-muted-foreground",
          )}
        >
          <span className="tabular-nums">{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";

export function EmptyProject() {
  return (
    <div className="card-elev p-8 text-center">
      <h2 className="font-serif text-lg font-semibold">No project yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Run a permitting analysis and save it to populate your dashboard.
      </p>
      <Link to="/permitting/analyze" className="btn-accent mt-4 inline-flex">
        Start Permitting Analysis
      </Link>
    </div>
  );
}

export function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Loading…
    </div>
  );
}
