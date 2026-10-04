// A one-line, plain-English answer to "can I protest this property, and is it worth it?".
// Display only: it reads numbers the app already computes (the deterministic Module 1 score,
// the protest deadline, the estimated savings, the case status) and never changes them.
// Score bands match the AI report's own: 70+ Strong, 40-69 Moderate, below 40 Limited.

export type VerdictTone = "good" | "maybe" | "no" | "info" | "warn" | "done";

export type ProtestVerdict = {
  tone: VerdictTone;
  headline: string;
  detail: string;
  // What the button should do: open the case, the AI report, or upload documents.
  action: "case" | "report" | "upload" | "none";
  actionLabel: string;
};

export type VerdictInput = {
  score: number | null;
  daysLeft: number | null; // days until the protest deadline; null when unknown
  estimatedSavings: number | null;
  // No deadline is on file and the usual Texas May 15 date has already gone by this year.
  usualDeadlinePassed?: boolean;
  hasProtest: boolean;
  protestResolved: boolean;
  protestStageLabel: string | null;
};

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

function deadlineText(daysLeft: number | null): string {
  if (daysLeft == null) return "";
  if (daysLeft === 0) return "Deadline is today.";
  return `Deadline in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;
}

export function protestVerdict(i: VerdictInput): ProtestVerdict {
  if (i.hasProtest) {
    return i.protestResolved
      ? {
          tone: "done",
          headline: "Case closed",
          detail: "See the final result and what you saved.",
          action: "case",
          actionLabel: "See result",
        }
      : {
          tone: "info",
          headline: "Protest in progress",
          detail: i.protestStageLabel
            ? `Current step: ${i.protestStageLabel}.`
            : "Your case is open.",
          action: "case",
          actionLabel: "Open case",
        };
  }

  if (i.daysLeft != null && i.daysLeft < 0) {
    return {
      tone: "warn",
      headline: "The protest deadline has passed",
      detail: "You can still review your report and plan for next year.",
      action: "report",
      actionLabel: "View report",
    };
  }

  if (i.daysLeft == null && i.usualDeadlinePassed) {
    return {
      tone: "warn",
      headline: "The usual May 15 deadline has passed",
      detail:
        "We have no deadline on file. If your notice arrived late you may still have 30 days from the date it was mailed. Check the date on your notice before you start.",
      action: "upload",
      actionLabel: "Add appraisal notice",
    };
  }

  if (i.score == null) {
    return {
      tone: "info",
      headline: "We're checking this property",
      detail:
        "Your answer will show here in a moment. Adding your appraisal notice makes it more accurate.",
      action: "upload",
      actionLabel: "Add appraisal notice",
    };
  }

  const dl = deadlineText(i.daysLeft);
  const save =
    i.estimatedSavings && i.estimatedSavings > 0
      ? `Possible saving about ${money(i.estimatedSavings)} a year.`
      : "";
  const tail = [save, dl].filter(Boolean).join(" ");

  if (i.score >= 70)
    return {
      tone: "good",
      headline: "Yes, this looks worth protesting",
      detail: tail || "Your value looks high compared with similar properties.",
      action: "report",
      actionLabel: "See why & start",
    };
  if (i.score >= 40)
    return {
      tone: "maybe",
      headline: "Maybe. Worth a closer look",
      detail: tail || "Some signs your value is high, but it is not clear-cut.",
      action: "report",
      actionLabel: "Review report",
    };
  return {
    tone: "no",
    headline: "Probably not worth protesting",
    detail: "Your value looks in line with similar properties.",
    action: "report",
    actionLabel: "View report",
  };
}

// Texas protests are normally due May 15 (or 30 days after the notice was mailed, if later).
// True when there is no deadline on file and it is now past May 15 of the current year.
export function usualDeadlinePassed(now: Date = new Date()): boolean {
  return now.getTime() > new Date(now.getFullYear(), 4, 15, 23, 59, 59).getTime();
}
