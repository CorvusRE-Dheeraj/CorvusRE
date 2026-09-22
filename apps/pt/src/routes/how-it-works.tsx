import { createFileRoute, Link } from "@tanstack/react-router";
import { ScrollReveal } from "@/components/ScrollReveal";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How It Works — CorvusPT" },
      {
        name: "description",
        content:
          "See how CorvusPT combines AI analysis with CorvusPT staff review to protest values, file BPP, track deadlines, and manage Texas property tax savings.",
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
    t: "Corvus AI or Our Team Handles the Protest",
    d: "Depending on your subscription, Corvus AI or our team handles the filing, county communication, hearing support, and settlement coordination.",
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
                    <h3 className="text-xl font-semibold">{s.t}</h3>
                  </div>
                  <p className="mt-3 text-muted-foreground">{s.d}</p>
                </div>
              </ScrollReveal>
            </li>
          ))}
        </ol>

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
