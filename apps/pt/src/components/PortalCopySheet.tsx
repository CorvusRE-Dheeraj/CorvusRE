import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { copySheet, type FieldValues } from "@/lib/portal-copy-sheet";

// Every value the county's online portal asks for, from the signed Notice of
// Protest, one click to copy each (lib/portal-copy-sheet.ts).
export function PortalCopySheet({ values }: { values: FieldValues }) {
  const rows = copySheet(values);
  const [copied, setCopied] = useState<string | null>(null);
  const warnings = rows.filter((r) => r.warning).length;

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      // clipboard blocked — the value is still selectable on screen
    }
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-background p-3 text-xs text-foreground">
      <div className="font-semibold">What the portal will ask for</div>
      <p className="mt-0.5 text-muted-foreground">
        From your signed Notice of Protest. Most districts&apos; online systems also ask for the
        owner ID or PIN printed on your Notice of Appraised Value.
      </p>
      {warnings > 0 && (
        <p className="mt-1.5 flex items-center gap-1 text-warning-foreground">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {warnings} value{warnings === 1 ? "" : "s"} to check before you paste.
        </p>
      )}
      <dl className="mt-2 grid gap-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-1 gap-0.5 sm:grid-cols-[11rem_1fr_auto] sm:items-start sm:gap-2"
          >
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 break-words">
              {r.value || <span className="text-muted-foreground">—</span>}
              {r.warning && <div className="text-warning-foreground">{r.warning}</div>}
            </dd>
            {r.value ? (
              <button
                type="button"
                onClick={() => copy(r.label, r.value)}
                aria-label={`Copy ${r.label}`}
                className="inline-flex w-fit items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-secondary"
              >
                {copied === r.label ? (
                  <Check className="h-3 w-3 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3" aria-hidden="true" />
                )}
                {copied === r.label ? "Copied" : "Copy"}
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
