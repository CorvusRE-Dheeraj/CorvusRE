import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FileInput,
  ScanSearch,
  FileCheck2,
  Send,
  BadgeCheck,
  ArrowRight,
  Building2,
  Route as RouteIcon,
  Receipt,
  MessagesSquare,
} from "lucide-react";
import { ScrollReveal } from "@/components/ScrollReveal";
import { SitePlanScene } from "@/components/illustrations/SitePlanScene";

export const Route = createFileRoute("/permitting/")({
  head: () => ({
    meta: [
      { title: "Permitting & Entitlement — CorvusDP" },
      {
        name: "description",
        content:
          "What CorvusDP's permitting analysis produces: zoning & jurisdiction, feasibility, required permits, reviewing agencies, city checklists, a dependency-ordered roadmap, fees, and a timeline.",
      },
    ],
  }),
  component: PermittingOverview,
});

const STEPS = [
  { icon: FileInput, label: "Input", text: "Address or manual site details, plus your project intent." },
  { icon: ScanSearch, label: "Analysis", text: "Zoning, jurisdiction, feasibility, and site constraints — in plain language." },
  { icon: FileCheck2, label: "Permits", text: "Every required permit, its reviewing agency, and a submission checklist." },
  { icon: Send, label: "Submission", text: "A dependency-ordered roadmap, fee estimate, and a multi-cycle timeline." },
  { icon: BadgeCheck, label: "Approval", text: "Track review cycles, comments, approvals, clearance, and expiry." },
];

const OUTPUTS = [
  { icon: Building2, t: "Zoning & jurisdiction", d: "Classification, the governing authority (city / county / ETJ), and which department reviews what." },
  { icon: ScanSearch, t: "Feasibility", d: "Allowed / conditional / not allowed, with each risk explained and its added time and cost." },
  { icon: FileCheck2, t: "Permits & checklists", d: "Grouped by category, mapped to agencies, each with a jurisdiction-specific submittal checklist." },
  { icon: RouteIcon, t: "Roadmap", d: "What must clear before what, and what can run in parallel — as a phased timeline." },
  { icon: Receipt, t: "Fees & timeline", d: "Per-permit fees, impact fees, and a realistic review schedule, with assumptions stated." },
  { icon: MessagesSquare, t: "Review tracking", d: "Once engaged: submissions, comment translation and assignment, approvals, and expiry." },
];

function PermittingOverview() {
  return (
    <div className="overflow-clip">
      <section className="gradient-mesh relative isolate">
        <div className="blueprint-grid pointer-events-none absolute inset-0" aria-hidden />
        <span className="grain absolute inset-0" aria-hidden />
        <span className="hero-blob left-[-7rem] top-[-3rem] h-80 w-80 bg-[oklch(0.7_0.16_58)]" aria-hidden />
        <span
          className="hero-blob right-[-8rem] top-24 h-96 w-96 bg-[oklch(0.55_0.16_255)]"
          style={{ animationDelay: "-6s" }}
          aria-hidden
        />
        <div className="container-page relative grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="badge-soft">Permitting &amp; Entitlement</span>
            <h1 className="mt-4 max-w-3xl font-serif text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              From one address to a <span className="text-gradient">complete permitting roadmap.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              Enter the property and your project scope. CorvusDP retrieves jurisdiction and zoning
              context, checks feasibility, then lays out every permit you'll need, who reviews it,
              what to submit, the order to submit in, the fees, and how long it should take.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/permitting/analyze" className="btn-accent text-base">
                Start Permitting Analysis <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/design" className="btn-outline text-base">
                Need design first?
              </Link>
            </div>
          </div>
          <div className="illo-float">
            <div className="glass p-4 sm:p-6">
              <SitePlanScene />
              <div className="mt-3 flex items-center justify-between">
                <span className="spec-label">Dwg. C-101 · Site plan</span>
                <span className="spec-label">Zone C-2</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page py-16 sm:py-20">
        <ScrollReveal>
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">
            Input → Analysis → Permits → Submission → Approval
          </h2>
        </ScrollReveal>
        <div className="mt-8 grid gap-4 sm:grid-cols-5">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <ScrollReveal key={s.label} delay={i * 70}>
                <div className="glass hover-lift h-full p-5">
                  <Icon className="h-5 w-5 text-accent" />
                  <div className="mt-3 font-semibold">{s.label}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.text}</p>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </section>

      <section className="relative isolate border-y border-border/60 bg-secondary/30">
        <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="container-page relative py-16 sm:py-20">
          <ScrollReveal>
            <h2 className="font-serif text-2xl font-semibold sm:text-3xl">In your report</h2>
          </ScrollReveal>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {OUTPUTS.map((o, i) => {
              const Icon = o.icon;
              return (
                <ScrollReveal key={o.t} delay={i * 60}>
                  <div className="glass hover-lift h-full p-6">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-4 font-serif text-lg font-semibold">{o.t}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{o.d}</p>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="container-page py-16 sm:py-20">
        <ScrollReveal>
          <div className="rounded-2xl border border-border p-6 sm:p-8">
            <h2 className="font-serif text-lg font-semibold">Where the AI helps</h2>
            <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <li>• Maps your scope to the right permits across any US jurisdiction</li>
              <li>• Translates plan-review comments into plain language and assigns owners</li>
              <li>• Sequences permits by dependency so nothing stalls on a prerequisite</li>
              <li>• Estimates fees and a realistic multi-cycle review timeline</li>
            </ul>
          </div>
        </ScrollReveal>
      </section>

      <section className="container-page pb-20">
        <ScrollReveal>
          <div className="brand-gradient relative overflow-hidden rounded-2xl p-8 text-accent-foreground sm:p-12">
            <span className="band-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-[linear-gradient(90deg,transparent,oklch(1_0_0/0.5),transparent)]" aria-hidden />
            <h2 className="relative font-serif text-2xl font-semibold sm:text-3xl">
              Start with one address.
            </h2>
            <p className="relative mt-2 max-w-xl text-sm text-accent-foreground/85">
              No account needed to run the analysis. Outputs are estimates — confirm with the
              authority having jurisdiction before submitting or committing funds.
            </p>
            <Link
              to="/permitting/analyze"
              className="relative mt-6 inline-flex items-center gap-2 rounded-lg bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5"
            >
              Start Permitting Analysis <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </ScrollReveal>
      </section>
    </div>
  );
}
