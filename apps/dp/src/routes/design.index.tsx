import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Ruler,
  TreePine,
  Waves,
  Building2,
  Frame,
  Wind,
  ClipboardList,
  Layers3,
  CalendarClock,
  Wallet,
} from "lucide-react";
import { ScrollReveal } from "@/components/ScrollReveal";
import { BlueprintScene } from "@/components/illustrations/BlueprintScene";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/design/")({
  head: () => ({
    meta: [
      { title: "Design — CorvusDP" },
      {
        name: "description",
        content:
          "What CorvusDP's design brief covers: the disciplines, the concept → development → permit-set process, a room-level space plan, a phased timeline, and a fee basis by discipline.",
      },
    ],
  }),
  component: DesignOverview,
});

const DISCIPLINES = [
  {
    icon: Ruler,
    title: "Survey & Platting",
    text: "Boundary and topographic survey, easement research, and platting support to establish legal lots and dedications.",
  },
  {
    icon: TreePine,
    title: "Site & Landscape",
    text: "Site layout, parking and access, grading concept, tree preservation, and a landscape plan that fits the ordinance.",
  },
  {
    icon: Waves,
    title: "Civil",
    text: "Drainage and detention design, water / wastewater / storm routing, and the studies the city will ask for.",
  },
  {
    icon: Frame,
    title: "Architectural",
    text: "Floor plans, elevations, sections, and a code analysis locking occupancy, construction type, and egress.",
  },
  {
    icon: Building2,
    title: "Structural",
    text: "Foundation and superstructure design, sealed — coordinated with the architectural set from concept on.",
  },
  {
    icon: Wind,
    title: "MEP",
    text: "Mechanical, electrical, and plumbing design, sealed, with energy-code compliance carried through.",
  },
];

const PHASES = [
  {
    n: "1",
    title: "Concept design",
    weeks: "2–3 weeks",
    text: "Initial layouts and planning options against your program and the site's constraints. Reviewed with you before anything is committed.",
  },
  {
    n: "2",
    title: "Design development",
    weeks: "3–5 weeks",
    text: "The chosen direction is refined and coordinated across every discipline — the point where the drawings become real.",
  },
  {
    n: "3",
    title: "Final / permit set",
    weeks: "3–6 weeks",
    text: "A coordinated, sealed package (Plat + Architectural + Structural + MEP + Civil) ready for the city.",
  },
];

const BRIEF_OUTPUTS = [
  { icon: ClipboardList, t: "What's included", d: "Every deliverable across survey, site, civil, architectural, structural, and MEP." },
  { icon: Layers3, t: "Space plan", d: "A room-level breakdown and functional zoning derived from your program." },
  { icon: CalendarClock, t: "Phased timeline", d: "Concept → development → permit set, with durations and who's involved in each." },
  { icon: Wallet, t: "Fee basis", d: "Design fee split by discipline, a separate rough build cost, and the cost drivers explained." },
];

const FAQ = [
  {
    q: "Is this a stamped, permit-ready drawing set?",
    a: "No — the brief is a scope, schedule, and fee basis so you can decide whether and how to proceed. Once you engage a design team, that team produces the sealed set (which CorvusDP's permitting workspace then tracks to approval).",
  },
  {
    q: "Can I bring my own architect or engineers?",
    a: "Yes. The brief and the design responsibility matrix are structured so any qualified team can pick them up. CorvusDP can also coordinate a team for you.",
  },
  {
    q: "How accurate is the budget?",
    a: "It's an order-of-magnitude estimate from building area, sector, and complexity — good for a go / no-go and for lining up financing. It tightens once a site survey and a real program are in hand.",
  },
  {
    q: "Do I need the permitting analysis first?",
    a: "It helps. Site constraints from the permitting side (zoning, easements, utilities, floodplain) feed straight into the design so the concept doesn't have to be reworked later.",
  },
];

function DesignOverview() {
  return (
    <div className="overflow-clip">
      {/* Hero */}
      <section className="gradient-mesh relative isolate">
        <div className="blueprint-grid pointer-events-none absolute inset-0" aria-hidden />
        <span className="grain absolute inset-0" aria-hidden />
        <span className="hero-blob right-[-7rem] top-[-3rem] h-80 w-80 bg-[oklch(0.7_0.16_58)]" aria-hidden />
        <span
          className="hero-blob left-[-8rem] top-28 h-96 w-96 bg-[oklch(0.55_0.16_255)]"
          style={{ animationDelay: "-7s" }}
          aria-hidden
        />
        <div className="container-page relative grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="badge-soft">Design</span>
            <h1 className="mt-4 max-w-3xl font-serif text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              Design, <span className="text-gradient">scoped and priced</span> before you commit.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              Give CorvusDP the property and your program. Get back what the design covers, a
              room-level space plan, a phased timeline from concept to permit set, and a fee basis by
              discipline — with the cost drivers explained. It's the decision document that comes
              before a design contract.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/design/analyze" className="btn-accent text-base">
                Start a Design Brief <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/permitting" className="btn-outline text-base">
                Permitting instead
              </Link>
            </div>
          </div>
          <div className="illo-float">
            <div className="glass p-4 sm:p-6">
              <BlueprintScene />
              <div className="mt-3 flex items-center justify-between">
                <span className="spec-label">Dwg. A-201 · Front elevation</span>
                <span className="spec-label">Permit set</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Disciplines */}
      <section className="container-page py-16 sm:py-20">
        <ScrollReveal>
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">What the design covers</h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            A full building project touches six disciplines. The brief scopes each one and says who
            owns it.
          </p>
        </ScrollReveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {DISCIPLINES.map((d, i) => {
            const Icon = d.icon;
            return (
              <ScrollReveal key={d.title} delay={i * 60}>
                <div className="glass hover-lift h-full p-6">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-serif text-lg font-semibold">{d.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{d.text}</p>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </section>

      {/* Process */}
      <section className="relative isolate border-y border-border/60 bg-secondary/30">
        <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="container-page relative py-16 sm:py-20">
          <ScrollReveal>
            <h2 className="font-serif text-2xl font-semibold sm:text-3xl">
              Concept → development → permit set
            </h2>
          </ScrollReveal>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {PHASES.map((p, i) => (
              <ScrollReveal key={p.n} delay={i * 90}>
                <div className="glass h-full p-6">
                  <div className="flex items-baseline justify-between">
                    <span className="font-serif text-3xl font-semibold text-accent">{p.n}</span>
                    <span className="badge-soft">{p.weeks}</span>
                  </div>
                  <h3 className="mt-3 font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{p.text}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Durations are typical ranges — they move with project size, feedback speed, and the
            number of revision cycles.
          </p>
        </div>
      </section>

      {/* What you get */}
      <section className="container-page py-16 sm:py-20">
        <ScrollReveal>
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">In your design brief</h2>
        </ScrollReveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {BRIEF_OUTPUTS.map((o, i) => {
            const Icon = o.icon;
            return (
              <ScrollReveal key={o.t} delay={i * 70}>
                <div className="flex gap-4 rounded-xl border border-border p-5">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="font-semibold">{o.t}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{o.d}</p>
                  </div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </section>

      {/* FAQ */}
      <section className="container-page py-16 sm:py-20">
        <ScrollReveal>
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">Questions</h2>
          <div className="mt-6 max-w-2xl">
            <Accordion type="single" collapsible>
              {FAQ.map((f, i) => (
                <AccordionItem key={i} value={`q${i}`}>
                  <AccordionTrigger className="text-left text-sm font-medium">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </ScrollReveal>
      </section>

      {/* CTA */}
      <section className="container-page pb-20">
        <ScrollReveal>
          <div className="brand-gradient relative overflow-hidden rounded-2xl p-8 text-accent-foreground sm:p-12">
            <span className="band-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-[linear-gradient(90deg,transparent,oklch(1_0_0/0.5),transparent)]" aria-hidden />
            <h2 className="relative font-serif text-2xl font-semibold sm:text-3xl">
              A brief in minutes, not weeks.
            </h2>
            <p className="relative mt-2 max-w-xl text-sm text-accent-foreground/85">
              Run it now — no account needed to see the result. Sign up to save it and open the
              design dashboard.
            </p>
            <Link
              to="/design/analyze"
              className="relative mt-6 inline-flex items-center gap-2 rounded-lg bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5"
            >
              Start a Design Brief <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </ScrollReveal>
      </section>
    </div>
  );
}
