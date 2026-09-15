import { Check } from "lucide-react";

export type StepStatus = "done" | "active" | "pending";

// A vertical stepper for "AI is working" screens — numbered circles connected by
// a line, each animating in place as its status changes: the active circle gets
// a pulsing ring (visibly "in progress"), and done gets a checkmark that pops in
// (tw-animate-css's zoom-in/fade-in) instead of a plain checkmark + strikethrough.
export function AnimatedSteps({ steps }: { steps: { label: string; status: StepStatus }[] }) {
  return (
    <ol className="mt-4">
      {steps.map((step, i) => (
        <li key={step.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="relative grid h-7 w-7 shrink-0 place-items-center">
              {step.status === "active" && (
                <span className="absolute inset-0 rounded-full bg-accent opacity-60 animate-ping" />
              )}
              <span
                className={`relative grid h-7 w-7 place-items-center rounded-full text-xs font-semibold transition-colors duration-300 ${
                  step.status === "done"
                    ? "bg-success text-success-foreground"
                    : step.status === "active"
                      ? "bg-accent text-accent-foreground"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {step.status === "done" ? (
                  <Check className="h-3.5 w-3.5 animate-in zoom-in-50 fade-in duration-300" />
                ) : (
                  i + 1
                )}
              </span>
            </span>
            {i < steps.length - 1 && (
              <span
                className={`w-0.5 flex-1 min-h-[1.5rem] transition-colors duration-500 ${
                  step.status === "done" ? "bg-success" : "bg-border"
                }`}
              />
            )}
          </div>
          <div
            className={`pb-6 text-sm transition-colors duration-300 ${
              step.status === "pending"
                ? "text-muted-foreground"
                : step.status === "active"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
            }`}
          >
            {step.label}
          </div>
        </li>
      ))}
    </ol>
  );
}
