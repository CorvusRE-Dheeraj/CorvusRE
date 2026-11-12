import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The building blocks of the one-page escalation workflows (Court Appeal,
// Arbitration): compact status cards on the page, everything detailed in a
// popup that closes back to the same place.

export function StatusCard({
  icon,
  title,
  children,
  action,
  secondary,
  done,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void; disabled?: boolean }[];
  done?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-md border border-border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="text-accent">{icon}</span>
          {title}
        </span>
        {done && <Check className="h-3.5 w-3.5 text-success" aria-label="Done" />}
      </div>
      <div className="mt-1.5 grid flex-1 gap-0.5 text-sm">{children}</div>
      {(action || secondary?.length) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="btn-outline py-1 text-xs disabled:opacity-60"
            >
              {action.label}
            </button>
          )}
          {secondary?.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={s.onClick}
              disabled={s.disabled}
              className="text-xs text-accent hover:underline disabled:opacity-60"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkflowPopup({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={`max-h-[90vh] overflow-y-auto ${wide ? "sm:max-w-3xl" : "sm:max-w-2xl"}`}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function StageTrack({
  stages,
  label,
}: {
  stages: { id: string; label: string; state: "done" | "current" | "upcoming" }[];
  label: string;
}) {
  return (
    <ol className="flex flex-wrap gap-1 text-[11px]" aria-label={label}>
      {stages.map((s, i) => (
        <li
          key={s.id}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
            s.state === "done"
              ? "bg-success/15 text-success"
              : s.state === "current"
                ? "bg-accent font-semibold text-accent-foreground"
                : "bg-secondary text-muted-foreground"
          }`}
          aria-current={s.state === "current" ? "step" : undefined}
        >
          {s.state === "done" ? <Check className="h-3 w-3" aria-hidden /> : <span>{i + 1}</span>}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function FileButton({
  label,
  onFile,
  disabled,
  accept = "image/*,.pdf",
}: {
  label: string;
  onFile: (f: File) => void;
  disabled?: boolean;
  accept?: string;
}) {
  return (
    <label
      className={`btn-outline inline-flex w-fit cursor-pointer py-1.5 text-xs ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      {label}
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </label>
  );
}
