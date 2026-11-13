// Shared formatting for the one-page escalation workflows (components/case/workflow-ui.tsx).
export const fieldClass = "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";

export function fmtDay(iso: string | null | undefined): string {
  return iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
}
