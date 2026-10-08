import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({ meta: [{ title: "How it works — CorvusDP" }] }),
  component: HowItWorks,
});

type Phase = { n: string; title: string; body: string };

const PERMITTING_PHASES: Phase[] = [
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

// Mirrors the Design Brief wizard (design.analyze.tsx) and the design
// dashboard it saves into.
const DESIGN_PHASES: Phase[] = [
  {
    n: "1",
    title: "Enter the property",
    body: "An address — or just the city or region when there isn't one yet.",
  },
  {
    n: "2",
    title: "Choose the type of project",
    body: "New construction, addition, remodeling, or interior fit-out.",
  },
  {
    n: "3",
    title: "Describe your requirements",
    body: "Site and building area, floors, rooms, and the functional and special requirements the design has to meet.",
  },
  {
    n: "4",
    title: "Get your design brief",
    body: "What the design covers across survey, site, civil, architectural, structural, and MEP; a room-level space plan; a phased timeline from concept to permit set; and a budget estimate with the cost drivers explained.",
  },
  {
    n: "5",
    title: "Track the design",
    body: "Save the brief to your dashboard for the cost breakdown by discipline, a suggested delivery approach, phase-by-phase progress as your design team works, and recommended next steps.",
  },
];

function PhaseList({ phases }: { phases: Phase[] }) {
  return (
    <ol className="mt-6 grid gap-4">
      {phases.map((p) => (
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
  );
}

function HowItWorks() {
  return (
    <div className="container-page py-12 max-w-3xl">
      <span className="badge-soft">How it works</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">
        Permitting and design, made legible.
      </h1>
      <p className="mt-3 text-muted-foreground">
        CorvusDP mirrors how experienced developers, designers, and expeditors actually run a
        project — it just does the research, sequencing, and tracking for you. Start with either
        track.
      </p>
      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Tracks">
        <a href="#permitting" className="btn-outline text-sm">
          Permitting
        </a>
        <a href="#design" className="btn-outline text-sm">
          Design
        </a>
      </nav>

      <section id="permitting" className="mt-12 scroll-mt-24">
        <h2 className="font-serif text-2xl font-semibold">Permitting</h2>
        <p className="mt-2 text-muted-foreground">
          From an address to every permit you need, in order, with fees and a timeline.
        </p>
        <PhaseList phases={PERMITTING_PHASES} />
        <div className="mt-6">
          <Link to="/permitting/analyze" className="btn-accent">
            Start Permitting Analysis
          </Link>
        </div>
      </section>

      <section id="design" className="mt-14 scroll-mt-24">
        <h2 className="font-serif text-2xl font-semibold">Design</h2>
        <p className="mt-2 text-muted-foreground">
          From your program to a scoped, phased, and priced design brief — before you sign a design
          contract.
        </p>
        <PhaseList phases={DESIGN_PHASES} />
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/design/analyze" className="btn-accent">
            Start a Design Brief
          </Link>
          <Link to="/design" className="btn-outline">
            What the design covers
          </Link>
        </div>
      </section>
    </div>
  );
}
