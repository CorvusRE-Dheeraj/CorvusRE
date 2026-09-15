import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  ClipboardCheck,
  Boxes,
  CalendarCheck2,
  Users,
  FileStack,
} from "lucide-react";
import { Field, inputCls, Section } from "@/components/dp-ui";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ScrollReveal } from "@/components/ScrollReveal";
import { ConstructionScene } from "@/components/illustrations/ConstructionScene";
import { supabase } from "@/lib/supabase";
import { readDpIntake } from "@/lib/dp-intake";
import { notifyInquiry } from "@/lib/inquiries";

export const Route = createFileRoute("/construction")({
  head: () => ({
    meta: [
      { title: "Construction — CorvusDP" },
      {
        name: "description",
        content:
          "The build phase, organized: pre-construction clearance, daily logs, inspections, submittals, materials and subcontractor tracking. Share your project to get early access.",
      },
    ],
  }),
  component: Construction,
});

const COVERS = [
  {
    icon: ShieldCheck,
    t: "Pre-construction clearance",
    d: "Confirm every approval, inspection, utility clearance, and condition of approval is satisfied before the first shovel.",
  },
  {
    icon: ClipboardCheck,
    t: "Daily construction log",
    d: "Weather, crews on site, work performed, deliveries, and issues — captured day by day, searchable later.",
  },
  {
    icon: CalendarCheck2,
    t: "Inspections",
    d: "Schedule and track city inspections against the build schedule, with pass / fail and re-inspection follow-up.",
  },
  {
    icon: FileStack,
    t: "Submittals & RFIs",
    d: "Route shop drawings and RFIs to the right consultant, with status and turnaround visible to everyone.",
  },
  {
    icon: Boxes,
    t: "Materials & equipment",
    d: "Track long-lead purchases, rentals, and deliveries so procurement never becomes the critical path.",
  },
  {
    icon: Users,
    t: "Subcontractor updates",
    d: "Weekly progress from each trade rolled into one schedule view, with blockers flagged early.",
  },
];

const READINESS = [
  "Building permit approved",
  "Site / civil permit approved",
  "Utility service clearances",
  "Impact / capital-recovery fees paid",
  "Contractor registration on file",
  "Pre-construction meeting held",
];

function Construction() {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({
    address: "",
    build: "New Construction",
    sector: "",
    size: "",
    floors: "",
    structure: "Not sure",
    hasDrawings: "In progress",
    hasPermits: "Not started",
    budget: "",
    completion: "",
    email: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const intake = readDpIntake();
    try {
      await supabase.from("leads").insert({
        session_id: intake.sessionId,
        track: "construction",
        email: form.email || null,
        property: { address: form.address },
        project: form,
        intent_score: 3,
      });
    } catch {
      /* non-blocking */
    }
    void notifyInquiry({
      kind: "construction_lead",
      email: form.email || undefined,
      meta: {
        Property: form.address,
        "Build type": form.build,
        "Property type": form.sector || undefined,
        "Structure type": form.structure,
        "Building size (sf)": form.size || undefined,
        Floors: form.floors || undefined,
        "Design drawings": form.hasDrawings,
        Permits: form.hasPermits,
        Budget: form.budget || undefined,
        "Target completion": form.completion || undefined,
      },
    });
    setSent(true);
  }

  if (sent) {
    return (
      <div className="container-page max-w-2xl py-20">
        <ScrollReveal>
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent/12 text-accent">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <h1 className="mt-4 font-serif text-3xl font-semibold">Thanks — we have your project.</h1>
          <p className="mt-2 text-muted-foreground">
            The CorvusDP construction workspace is in active build. We'll reach out with next steps
            and a pre-construction readiness plan for your project.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/permitting/analyze" className="btn-accent">
              Run a permitting analysis
            </Link>
            <Link to="/" className="btn-outline">
              Back to CorvusDP
            </Link>
          </div>
        </ScrollReveal>
      </div>
    );
  }

  return (
    <div className="overflow-clip">
      {/* Hero */}
      <section className="gradient-mesh relative isolate">
        <div className="blueprint-grid pointer-events-none absolute inset-0" aria-hidden />
        <span className="grain absolute inset-0" aria-hidden />
        <span className="hero-blob left-[-7rem] top-[-3rem] h-80 w-80 bg-[oklch(0.7_0.16_58)]" aria-hidden />
        <span
          className="hero-blob right-[-8rem] top-24 h-96 w-96 bg-[oklch(0.55_0.16_255)]"
          style={{ animationDelay: "-5s" }}
          aria-hidden
        />
        <div className="container-page relative grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="badge-soft-warning">Early access</span>
            <h1 className="mt-4 max-w-3xl font-serif text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              The build phase, <span className="text-gradient">organized.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              Once permits are in hand, the risk moves to coordination — inspections, submittals,
              deliveries, and a dozen subcontractors on one schedule. The CorvusDP construction
              workspace keeps all of it in one place, carrying the pre-construction clearance
              straight from the permitting side.
            </p>
            <a href="#tell-us" className="btn-accent mt-8 inline-flex text-base">
              Tell us about your build <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="illo-float">
            <div className="glass p-4 sm:p-6">
              <ConstructionScene />
              <div className="mt-3 flex items-center justify-between">
                <span className="spec-label">Site log · Live</span>
                <span className="spec-label">Phase 3 · Structure</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What it covers */}
      <section className="container-page py-16 sm:py-20">
        <ScrollReveal>
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">
            What the construction workspace covers
          </h2>
        </ScrollReveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {COVERS.map((c, i) => {
            const Icon = c.icon;
            return (
              <ScrollReveal key={c.t} delay={i * 60}>
                <div className="glass hover-lift h-full p-6">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-serif text-lg font-semibold">{c.t}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{c.d}</p>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </section>

      {/* Pre-construction readiness */}
      <section className="relative isolate border-y border-border/60 bg-secondary/30">
        <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="container-page relative py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-2">
            <ScrollReveal>
              <h2 className="font-serif text-2xl font-semibold sm:text-3xl">
                It starts from a clean pre-construction clearance
              </h2>
              <p className="mt-3 text-muted-foreground">
                The permitting workspace already tracks these to done. The construction workspace
                picks them up as the gate to breaking ground — no re-entering anything.
              </p>
              <Link to="/permitting" className="btn-outline mt-6 inline-flex">
                See the permitting side
              </Link>
            </ScrollReveal>
            <ScrollReveal delay={100}>
              <ul className="glass grid gap-3 p-6">
                {READINESS.map((r) => (
                  <li key={r} className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                    {r}
                  </li>
                ))}
              </ul>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Intake form */}
      <section id="tell-us" className="container-page max-w-2xl py-16 sm:py-20">
        <ScrollReveal>
          <span className="badge-soft">Get early access</span>
          <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
            Tell us about the build.
          </h2>
          <p className="mt-2 text-muted-foreground">
            Share the basics — we'll follow up with next steps and a readiness plan for your project.
          </p>
        </ScrollReveal>
        <form onSubmit={submit} className="mt-6">
          <Section title="Project basics">
            <div className="grid gap-4">
              <Field label="Property address">
                <AddressAutocomplete
                  ariaLabel="Property address"
                  value={form.address}
                  onChange={(v) => setForm({ ...form, address: v })}
                  onSelect={(pick) => setForm({ ...form, address: pick.formatted })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="What are you building?">
                  <select
                    className={inputCls}
                    value={form.build}
                    onChange={(e) => setForm({ ...form, build: e.target.value })}
                  >
                    {["New Construction", "Addition", "Renovation / Remodeling"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Property type" hint="Optional">
                  <select
                    className={inputCls}
                    value={form.sector}
                    onChange={(e) => setForm({ ...form, sector: e.target.value })}
                  >
                    {[
                      "",
                      "Office",
                      "Retail",
                      "Restaurant / Cafe",
                      "School / Institutional",
                      "Warehouse / Industrial",
                      "Mixed-Use",
                    ].map((o) => (
                      <option key={o} value={o}>
                        {o || "Select…"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Structure type">
                  <select
                    className={inputCls}
                    value={form.structure}
                    onChange={(e) => setForm({ ...form, structure: e.target.value })}
                  >
                    {["Concrete", "Steel", "Wood", "Not sure"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Approx. building size (sf)">
                  <input
                    className={inputCls}
                    value={form.size}
                    onChange={(e) => setForm({ ...form, size: e.target.value })}
                  />
                </Field>
                <Field label="Number of floors">
                  <input
                    className={inputCls}
                    value={form.floors}
                    onChange={(e) => setForm({ ...form, floors: e.target.value })}
                  />
                </Field>
                <Field label="Design drawings?">
                  <select
                    className={inputCls}
                    value={form.hasDrawings}
                    onChange={(e) => setForm({ ...form, hasDrawings: e.target.value })}
                  >
                    {["Yes", "No", "In progress"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Permits?">
                  <select
                    className={inputCls}
                    value={form.hasPermits}
                    onChange={(e) => setForm({ ...form, hasPermits: e.target.value })}
                  >
                    {["Yes", "No", "Not started"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Budget range">
                  <input
                    className={inputCls}
                    value={form.budget}
                    onChange={(e) => setForm({ ...form, budget: e.target.value })}
                  />
                </Field>
                <Field label="Target completion">
                  <input
                    className={inputCls}
                    placeholder="e.g. 8–12 months"
                    value={form.completion}
                    onChange={(e) => setForm({ ...form, completion: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Email" required>
                <input
                  type="email"
                  required
                  className={inputCls}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            </div>
            <button className="btn-accent mt-5">Send project details</button>
          </Section>
        </form>
      </section>
    </div>
  );
}
