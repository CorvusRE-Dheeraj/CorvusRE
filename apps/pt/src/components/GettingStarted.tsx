import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const KEY = "corvuspt.gettingStartedDismissed";

type Step = { label: string; hint: string; done: boolean; to: string; cta: string };

// A short "getting started" checklist for new accounts: what to do first, what's already
// done, and one button for the next step. Hides itself once everything is ticked, and can be
// dismissed (remembered in this browser).
export function GettingStarted({
  properties,
  documents,
  protests,
  resolved,
}: {
  properties: number;
  documents: number;
  protests: number;
  resolved: number;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  const steps: Step[] = [
    {
      label: "Add your property",
      hint: "Type an address or upload an appraisal notice.",
      done: properties > 0,
      to: "/intake",
      cta: "Add property",
    },
    {
      label: "Upload your appraisal notice",
      hint: "So the AI can read your values and deadlines.",
      done: documents > 0,
      to: "/dashboard/documents",
      cta: "Upload a document",
    },
    {
      label: "Review your AI report and start a protest",
      hint: "See your protest opportunity, then file when you're ready.",
      done: protests > 0,
      to: "/dashboard/properties",
      cta: "Open my properties",
    },
    {
      label: "Follow your case to the outcome",
      hint: "We track each step — informal review, hearing, decision.",
      done: resolved > 0,
      to: "/dashboard/properties",
      cta: "View my case",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (dismissed || doneCount === steps.length) return null;
  const next = steps.find((s) => !s.done)!;

  return (
    <section className="card-elev tu-rise p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-bold">Getting started</h2>
          <p className="text-sm text-muted-foreground">
            {doneCount} of {steps.length} done — next up: {next.label.toLowerCase()}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(KEY, "1");
            } catch {
              // storage blocked — it will reappear next visit, harmless
            }
          }}
          aria-label="Hide getting started"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <Progress
        aria-label="Getting started progress"
        value={(doneCount / steps.length) * 100}
        className="mt-3 h-2"
      />
      <ul className="mt-4 grid gap-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-3 text-sm">
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
                s.done ? "bg-emerald-600 text-white" : "border-2 border-border text-transparent"
              }`}
            >
              <Check className="h-3 w-3" />
            </span>
            <div className="min-w-0">
              <div className={s.done ? "text-muted-foreground line-through" : "font-medium"}>
                {s.label}
              </div>
              {!s.done && <div className="text-xs text-muted-foreground">{s.hint}</div>}
            </div>
          </li>
        ))}
      </ul>
      <Link to={next.to} className="btn-primary btn-primary-hover mt-4 inline-flex text-sm">
        {next.cta} →
      </Link>
    </section>
  );
}
