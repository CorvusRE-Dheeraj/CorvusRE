import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({ meta: [{ title: "How it works — CorvusDP" }] }),
  component: HowItWorks,
});

const PHASES = [
  {
    n: "1",
    title: "Enter the property & project",
    body: "An address (or manual site details) plus what you're planning — new construction, addition, remodel, or site development.",
  },
  {
    n: "2",
    title: "Zoning, jurisdiction & feasibility",
    body: "CorvusDP classifies the zoning, identifies the governing authority and reviewing departments, and flags feasibility risks in plain language.",
  },
  {
    n: "3",
    title: "Permits, agencies & checklists",
    body: "Every required permit grouped by category, mapped to its reviewing agency, each with a jurisdiction-specific submission checklist.",
  },
  {
    n: "4",
    title: "Roadmap, fees & timeline",
    body: "A dependency-ordered roadmap (what must clear before what, what can run in parallel), a fee estimate, and a multi-cycle review timeline.",
  },
  {
    n: "5",
    title: "Track to approval",
    body: "Once you're engaged, the dashboard tracks submissions, review comments (translated + assigned), approvals, pre-construction clearance, and permit expiry.",
  },
];

function HowItWorks() {
  return (
    <div className="container-page py-12 max-w-3xl">
      <span className="badge-soft">How it works</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">
        The permitting process, made legible.
      </h1>
      <p className="mt-3 text-muted-foreground">
        CorvusDP mirrors how experienced developers and expeditors actually run permitting — it just
        does the research, sequencing, and tracking for you.
      </p>
      <ol className="mt-8 grid gap-4">
        {PHASES.map((p) => (
          <li key={p.n} className="card-elev flex gap-4 p-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground font-semibold">
              {p.n}
            </span>
            <div>
              <div className="font-semibold">{p.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8">
        <Link to="/permitting/analyze" className="btn-accent">
          Try it now
        </Link>
      </div>
    </div>
  );
}
