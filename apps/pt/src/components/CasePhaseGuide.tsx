import { ListChecks } from "lucide-react";

const GUIDES: Record<string, { title: string; steps: string[] }> = {
  informal: {
    title: "How this step works",
    steps: [
      "Talk to the county's appraiser about your value. Many counties call you, or you can ask for an informal meeting.",
      "Once a date is set, save it below. It goes on your calendar.",
      'After you talk, click "Informal review completed".',
      'Agreed on a value? Upload the signed settlement. Not agreed? Click "Unsatisfied" to go to a formal hearing.',
    ],
  },
  hearing: {
    title: "How this step works",
    steps: [
      "Upload the hearing notice you got from the county. We read the date and add it to your calendar.",
      "Get ready with the hearing guide: your evidence and what to say.",
      'After the hearing, click "Formal hearing completed" and upload the decision (the ARB order).',
    ],
  },
  decision: {
    title: "How this step works",
    steps: [
      "Upload the ARB order to record the decision.",
      "Happy with the result? You're done. Not happy? Compare binding arbitration and a court appeal, then pick one.",
    ],
  },
};

// A short numbered "what happens here" list for the busiest case phases, so a first-time
// user can see the whole path without reading every section.
export function CasePhaseGuide({ tab, informalStatus }: { tab: string; informalStatus?: string }) {
  const g = GUIDES[tab];
  if (!g) return null;
  // Once the informal review is marked completed, the result callout takes over.
  if (tab === "informal" && informalStatus === "completed") return null;
  return (
    <section
      aria-label={g.title}
      className="mt-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm"
    >
      <div className="flex items-center gap-2 font-semibold">
        <ListChecks className="h-4 w-4 text-accent" /> {g.title}
      </div>
      <ol className="mt-1.5 list-decimal space-y-0.5 pl-6 text-muted-foreground">
        {g.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </section>
  );
}
