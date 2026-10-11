import { createFileRoute, Link } from "@tanstack/react-router";
import { ScrollReveal } from "@/components/ScrollReveal";
import { ServiceLanes } from "@/components/ServiceLanes";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How It Works — CorvusPT" },
      {
        name: "description",
        content:
          "See how CorvusPT works: a free AI property review, then either protest it yourself with Owner-Managed CorvusPT or have our team file and represent you with Expert/Managed Help.",
      },
      { property: "og:title", content: "How CorvusPT works" },
      {
        property: "og:description",
        content: "One linear flow: property → AI review → protest, BPP, payments, and savings.",
      },
    ],
  }),
  component: HowItWorks,
});

const STEPS = [
  {
    n: 1,
    t: "Add Your Property",
    d: "Enter the property address or upload your Texas appraisal notice. We'll use it to create your property record and start the review.",
  },
  {
    n: 2,
    t: "Verify the Official CAD Record",
    d: "Corvus AI identifies the correct appraisal district, matches your property, and verifies the official assessment and property details.",
  },
  {
    n: 3,
    t: "Corvus AI Analyzes Your Property",
    d: "AI reviews comparable properties, land and improvement values, income, site factors, prior assessments, and other available evidence to identify potential protest opportunities.",
  },
  {
    n: 4,
    t: "Review Your Protest Strategy",
    d: "See whether a protest is recommended, why, the estimated savings, supporting evidence, and the next steps — all explained in plain English.",
  },
  {
    n: 5,
    t: "You File — or Our Team Does",
    d: "With Owner-Managed CorvusPT, you file, attend the hearing and talk to the county, using the evidence and step-by-step instructions the AI prepares. With Expert/Managed Help, CorvusPT's team files, talks to the county and represents you — and nothing is settled without your approval.",
  },
  {
    n: 6,
    t: "Track Results, Payments & Savings",
    d: "Follow your protest status, final value, tax bills, payments, refunds, and annual savings from one property dashboard.",
  },
];

function HowItWorks() {
  return (
    <div>
      <div className="container-page pt-16">
        <div className="max-w-3xl">
          <span className="badge-soft">How it works</span>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
            AI checks what humans usually miss.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            County records, comps, land value, improvement value, site issues, zoning, income,
            prior‑year values, BPP assets, depreciation, deadlines, hearings, tax bills, payments,
            refunds, and final savings — all connected through one property record.
          </p>
        </div>
      </div>

      <div className="container-page pb-16">
        <ol className="mt-12 grid gap-5 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.n}>
              <ScrollReveal delay={i * 80} className="h-full">
                <div className="card-elev p-6 h-full transition-all hover:-translate-y-0.5 hover:shadow-elev">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground font-serif text-lg">
                      {s.n}
                    </span>
                    <h2 className="text-xl font-semibold">{s.t}</h2>
                  </div>
                  <p className="mt-3 text-muted-foreground">{s.d}</p>
                </div>
              </ScrollReveal>
            </li>
          ))}
        </ol>

        {/* Step 5's choice, spelled out — see lib/service-lanes.ts. */}
        <div className="mt-14">
          <h2 className="font-serif text-3xl font-semibold">Three ways to work with CorvusPT</h2>
          <p className="mt-2 text-muted-foreground">
            Each lane is its own workflow. Pick one — you can always move up a lane later.
          </p>
          <div className="mt-6">
            <ServiceLanes />
          </div>
        </div>

        <ScrollReveal>
          <div className="mt-12 card-elev p-8 bg-primary text-primary-foreground">
            <h2 className="font-serif text-2xl">Start with just one thing</h2>
            <p className="mt-2 text-primary-foreground/80">
              Upload a notice. Check a deadline. Ask AI what to do. Enter a property. File a BPP.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/" className="btn-accent">
                Start Free AI Property Review
              </Link>
              <Link
                to="/pricing"
                className="btn-outline border-white/30 text-primary-foreground hover:bg-background/10"
              >
                See Pricing
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </div>
  );
}
