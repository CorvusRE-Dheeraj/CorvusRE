import { ArrowRight, CheckCircle2 } from "lucide-react";

export type NextStepTab =
  "overview" | "file" | "informal" | "hearing" | "decision" | "arbitration" | "court" | "outcome";

export type NextStep = {
  title: string;
  body: string;
  tab: NextStepTab;
  cta: string;
  done?: boolean;
};

// One plain answer to "what do I do now?" for a case, derived only from its real status.
export function nextStepFor(
  status: string,
  opts: { needsGuidanceAck: boolean; noticeSigned: boolean; informalStatus?: string },
): NextStep {
  switch (status) {
    case "requested":
      if (opts.needsGuidanceAck)
        return {
          title: "Read the filing notice",
          body: "Take a minute to read how filing works and accept it. Then you can prepare your protest.",
          tab: "overview",
          cta: "Read it below",
        };
      return opts.noticeSigned
        ? {
            title: "File your protest with the county",
            body: "Your Notice of Protest is signed. Submit it to the county before your deadline.",
            tab: "file",
            cta: "Go to Prepare & File",
          }
        : {
            title: "Prepare and sign your Notice of Protest",
            body: "Fill in the form, gather your evidence, and sign. We'll walk you through it.",
            tab: "file",
            cta: "Go to Prepare & File",
          };
    case "filed":
    case "under_review":
      if (opts.informalStatus === "completed")
        return {
          title: "Your informal review is done. How did it end?",
          body: "Agreed on a value? Upload the signed settlement. Not happy with the offer? Choose Unsatisfied to move on to a formal hearing.",
          tab: "informal",
          cta: "Choose the result",
        };
      return {
        title: "Talk to the county's appraiser",
        body: "Try to settle your value informally first. It is faster than a hearing.",
        tab: "informal",
        cta: "Open Informal Review",
      };
    case "offer_received":
      return {
        title: "Decide on the county's offer",
        body: "Accept it, or keep going to a formal hearing if the value is still too high.",
        tab: "informal",
        cta: "Review the offer",
      };
    case "hearing_scheduled":
      return {
        title: "Get ready for your hearing",
        body: "Add your hearing notice, then prepare your evidence and talking points.",
        tab: "hearing",
        cta: "Open Formal Hearing",
      };
    case "decision_received":
      return {
        title: "Record the decision and choose what's next",
        body: "Enter what the ARB decided. If you're not happy with it, you can compare arbitration and a court appeal.",
        tab: "decision",
        cta: "Open Decision",
      };
    case "appealing":
      return {
        title: "Keep your court appeal up to date",
        body: "Log each court update so your case record stays complete.",
        tab: "court",
        cta: "Open Court Appeal",
      };
    case "arbitrating":
      return {
        title: "Keep your arbitration up to date",
        body: "Log the arbitration steps and result as they happen.",
        tab: "arbitration",
        cta: "Open Arbitration",
      };
    case "resolved":
      return {
        title: "Your case is closed",
        body: "See what you saved and download the full case report.",
        tab: "outcome",
        cta: "See final outcome",
        done: true,
      };
    default:
      return {
        title: "Review your case",
        body: "See where things stand below.",
        tab: "overview",
        cta: "Open Overview",
      };
  }
}

export function CaseNextStepCard({
  step,
  activeTab,
  onGo,
}: {
  step: NextStep;
  activeTab: NextStepTab;
  onGo: (tab: NextStepTab) => void;
}) {
  const here = step.tab === activeTab;
  return (
    <section
      aria-label="Your next step"
      className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${
        step.done ? "border-emerald-500/30 bg-emerald-500/10" : "border-sky-500/30 bg-sky-500/10"
      }`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-white ${
          step.done ? "bg-emerald-600" : "bg-sky-700"
        }`}
      >
        {step.done ? <CheckCircle2 className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1 basis-52">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {step.done ? "All done" : "Your next step"}
        </div>
        <div className="font-serif text-base font-semibold">{step.title}</div>
        <p className="text-sm text-muted-foreground">{step.body}</p>
      </div>
      {!here && (
        <button type="button" onClick={() => onGo(step.tab)} className="btn-primary text-sm">
          {step.cta} →
        </button>
      )}
    </section>
  );
}
