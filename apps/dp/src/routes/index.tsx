import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FileCheck2,
  DraftingCompass,
  HardHat,
  Banknote,
  ArrowRight,
  Sparkles,
  MapPinned,
  ScanSearch,
  ListChecks,
  BadgeCheck,
} from "lucide-react";
import { ScrollReveal } from "@/components/ScrollReveal";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { BlueprintScene } from "@/components/illustrations/BlueprintScene";
import { SitePlanScene } from "@/components/illustrations/SitePlanScene";
import { ConstructionScene } from "@/components/illustrations/ConstructionScene";
import type { ComponentType } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CorvusDP — AI-assisted permitting & design" },
      {
        name: "description",
        content:
          "Turn an address and a project scope into a permitting roadmap and a design brief. AI-assisted, jurisdiction-aware, across US states.",
      },
    ],
  }),
  component: Landing,
});

const DOORS = [
  {
    to: "/permitting",
    icon: FileCheck2,
    title: "Permitting & Entitlement",
    blurb:
      "Every permit, the reviewing agencies, the dependency sequence, city checklists, fees, and a realistic timeline — from one address.",
    cta: "Start Permitting Analysis",
    live: true,
  },
  {
    to: "/design",
    icon: DraftingCompass,
    title: "Design",
    blurb:
      "A program becomes an AI design brief: scope & deliverables, a room-level space plan, a phased timeline, and a fee basis by discipline.",
    cta: "Start a Design Brief",
    live: true,
  },
  {
    to: "/construction",
    icon: HardHat,
    title: "Construction",
    blurb:
      "Pre-construction clearance, daily logs, inspections, submittals, and subcontractor tracking for the build phase.",
    cta: "Tell us about the build",
    live: true,
  },
  {
    to: "/finance",
    icon: Banknote,
    title: "Financing",
    blurb: "Development and construction finance — on the CorvusRE roadmap.",
    cta: "Preview",
    live: false,
  },
] as const;

const STEPS = [
  { icon: MapPinned, label: "Input", text: "An address (or manual site details) and what you intend to build." },
  { icon: ScanSearch, label: "Analysis", text: "Zoning, jurisdiction, feasibility, and site constraints — in plain language." },
  { icon: ListChecks, label: "Plan", text: "Permits, agencies, checklists, a dependency-ordered roadmap, fees, and a timeline." },
  { icon: BadgeCheck, label: "Approval", text: "Track submissions, review cycles, comments, approvals, clearance, and expiry." },
];

function Landing() {
  return (
    <div className="overflow-clip">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="gradient-mesh relative isolate">
        <div className="blueprint-grid pointer-events-none absolute inset-0" aria-hidden />
        <span className="grain absolute inset-0" aria-hidden />
        <span className="hero-blob left-[-6rem] top-[-4rem] h-72 w-72 bg-[oklch(0.7_0.16_58)]" aria-hidden />
        <span
          className="hero-blob right-[-8rem] top-24 h-96 w-96 bg-[oklch(0.55_0.16_255)]"
          style={{ animationDelay: "-6s" }}
          aria-hidden
        />
        <div className="container-page relative grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="badge-soft">
              <Sparkles className="h-3.5 w-3.5" /> One of the five CorvusRE doors
            </span>
            <h1 className="mt-5 max-w-4xl font-serif text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Permitting and design for real estate development,
              <span className="text-gradient"> done with AI.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground sm:text-xl">
              Every jurisdiction has its own requirements, timelines, and reviewers. CorvusDP turns an
              address and a project scope into a clear permitting roadmap and a design brief —
              following local best practice, whatever the project size.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/permitting" className="btn-accent text-base">
                Start Permitting Analysis <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/design" className="btn-outline text-base">
                Start a Design Brief
              </Link>
            </div>

            <dl className="mt-14 grid max-w-2xl grid-cols-3 gap-6">
              {[
                { n: 50, suffix: "", label: "US states in scope" },
                { n: 20, suffix: "+", label: "permit types mapped" },
                { n: 10, suffix: " min", label: "to a first roadmap" },
              ].map((s) => (
                <div key={s.label}>
                  <dd className="font-serif text-3xl font-semibold sm:text-4xl">
                    <AnimatedNumber value={s.n} />
                    {s.suffix}
                  </dd>
                  <dt className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>
          </div>

          <div className="illo-float relative">
            <div className="glass p-4 sm:p-6">
              <BlueprintScene />
              <div className="mt-3 flex items-center justify-between">
                <span className="spec-label">Dwg. A-201 · Elevation</span>
                <span className="spec-label">Scale 1:96</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Doors ────────────────────────────────────────────────────── */}
      <section className="container-page py-16 sm:py-20">
        <ScrollReveal>
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">Choose where to start</h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Run the analysis without an account — sign up to save it and unlock the full report.
          </p>
        </ScrollReveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {DOORS.map((d, i) => {
            const Icon = d.icon;
            const card = (
              <Link
                to={d.to}
                className="glass hover-lift group flex h-full flex-col gap-3 p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="font-serif text-lg font-semibold">{d.title}</h3>
                  {!d.live && <span className="badge-soft-warning">Soon</span>}
                </div>
                <p className="text-sm text-muted-foreground">{d.blurb}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold text-accent">
                  {d.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            );
            return (
              <ScrollReveal key={d.to} delay={i * 80}>
                {card}
              </ScrollReveal>
            );
          })}
        </div>
      </section>

      {/* ── Drawing gallery ──────────────────────────────────────────── */}
      <section className="relative isolate border-y border-border/60 bg-secondary/20">
        <div className="topo-lines pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="container-page relative py-16 sm:py-20">
          <ScrollReveal>
            <h2 className="font-serif text-2xl font-semibold sm:text-3xl">
              One project, drawn end to end
            </h2>
            <p className="mt-2 max-w-xl text-muted-foreground">
              The same site moves from a permitting layout to an elevation to a structure on site —
              CorvusDP carries the context across each door.
            </p>
          </ScrollReveal>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {(
              [
                { to: "/permitting", Scene: SitePlanScene, label: "Site plan", tag: "C-2 · setbacks" },
                { to: "/design", Scene: BlueprintScene, label: "Elevation", tag: "Permit set" },
                {
                  to: "/construction",
                  Scene: ConstructionScene,
                  label: "On site",
                  tag: "Phase 3 · structure",
                },
              ] as { to: string; Scene: ComponentType<{ className?: string }>; label: string; tag: string }[]
            ).map(({ to, Scene, label, tag }, i) => (
              <ScrollReveal key={to} delay={i * 90}>
                <Link to={to} className="glass hover-lift group block p-5">
                  <Scene />
                  <div className="mt-3 flex items-center justify-between">
                    <span className="spec-label">{label}</span>
                    <span className="spec-label group-hover:text-accent">{tag}</span>
                  </div>
                </Link>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Process ──────────────────────────────────────────────────── */}
      <section className="relative isolate border-b border-border/60 bg-secondary/30">
        <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="container-page relative py-16 sm:py-20">
          <ScrollReveal>
            <h2 className="font-serif text-2xl font-semibold sm:text-3xl">
              Input → Analysis → Plan → Approval
            </h2>
          </ScrollReveal>
          <div className="relative mt-10 grid gap-8 sm:grid-cols-4">
            <div className="rule-gradient absolute left-0 right-0 top-6 hidden h-px sm:block" aria-hidden />
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <ScrollReveal key={s.label} delay={i * 90}>
                  <div className="relative">
                    <span className="relative z-10 inline-flex h-12 w-12 items-center justify-center rounded-full border border-accent/30 bg-background text-accent">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-accent">
                      Step {i + 1}
                    </div>
                    <div className="mt-1 font-semibold">{s.label}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Value ────────────────────────────────────────────────────── */}
      <section className="container-page py-16 sm:py-20">
        <div className="grid gap-8 sm:grid-cols-3">
          {[
            [
              "Jurisdiction-aware",
              "Maps your scope to the right permits and the right reviewing departments — city, county, or ETJ — not a generic checklist.",
            ],
            [
              "Sequenced, not just listed",
              "Knows what must clear before what, and what can run in parallel, so nothing stalls waiting on a prerequisite.",
            ],
            [
              "Estimates you can act on",
              "Fees, a multi-cycle review timeline, and a design fee basis by discipline — every figure labelled and explained.",
            ],
          ].map(([title, text], i) => (
            <ScrollReveal key={title} delay={i * 80}>
              <div>
                <div className="h-1 w-10 rounded-full bg-accent" />
                <h3 className="mt-4 font-serif text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{text}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── CTA band ─────────────────────────────────────────────────── */}
      <section className="container-page pb-20">
        <ScrollReveal>
          <div className="brand-gradient relative overflow-hidden rounded-2xl p-8 text-accent-foreground sm:p-12">
            <span className="band-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-[linear-gradient(90deg,transparent,oklch(1_0_0/0.5),transparent)]" aria-hidden />
            <h2 className="relative font-serif text-2xl font-semibold sm:text-3xl">
              Start with one address.
            </h2>
            <p className="relative mt-2 max-w-xl text-sm text-accent-foreground/85">
              No account needed to run the analysis. Outputs are estimates — confirm with the
              authority having jurisdiction before you submit or commit funds.
            </p>
            <div className="relative mt-6 flex flex-wrap gap-3">
              <Link
                to="/permitting/analyze"
                className="inline-flex items-center gap-2 rounded-lg bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5"
              >
                Run a permitting analysis <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/how-it-works"
                className="inline-flex items-center gap-2 rounded-lg border border-accent-foreground/30 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent-foreground/10"
              >
                How it works
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </section>
    </div>
  );
}
