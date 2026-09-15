import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  head: () => ({ meta: [{ title: "Pricing — CorvusDP" }] }),
  component: Pricing,
});

const TIERS = [
  {
    name: "Explore",
    price: "Free",
    blurb: "Run the analysis, see the report, save one project.",
    features: [
      "Permitting analysis & feasibility",
      "Required permits, agencies & roadmap",
      "Fee & timeline estimates",
      "1 saved project",
    ],
    cta: "Start free",
    to: "/permitting/analyze",
    highlight: false,
  },
  {
    name: "Project",
    price: "Contact us",
    blurb: "Full dashboard for an active project through approval.",
    features: [
      "Everything in Explore",
      "City-specific submission checklists",
      "Submission & review-cycle tracking",
      "Review-comment translation & assignment",
      "Approvals, clearance & expiry tracking",
      "Document repository",
    ],
    cta: "Talk to us",
    to: "/contact",
    highlight: true,
  },
  {
    name: "Managed",
    price: "Contact us",
    blurb: "CorvusDP runs permitting & design coordination for you.",
    features: [
      "Everything in Project",
      "Dedicated permit expeditor",
      "City relationship management",
      "Design team & sub-consultant coordination",
      "Multi-project portfolio view",
    ],
    cta: "Talk to us",
    to: "/contact",
    highlight: false,
  },
];

function Pricing() {
  return (
    <div className="container-page py-12">
      <span className="badge-soft">Pricing</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">
        Start free. Scale into a managed engagement.
      </h1>
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`card-elev flex flex-col p-6 ${t.highlight ? "ring-2 ring-accent" : ""}`}
          >
            {t.highlight && <span className="badge-soft self-start">Most popular</span>}
            <h2 className="mt-2 font-serif text-xl font-semibold">{t.name}</h2>
            <div className="mt-1 text-2xl font-bold">{t.price}</div>
            <p className="mt-1 text-sm text-muted-foreground">{t.blurb}</p>
            <ul className="mt-4 grid gap-2 text-sm">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {f}
                </li>
              ))}
            </ul>
            <Link to={t.to} className={`mt-6 ${t.highlight ? "btn-accent" : "btn-outline"} w-full`}>
              {t.cta}
            </Link>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        CorvusDP is in early access — pricing is finalized per engagement based on project count,
        jurisdictions, and scope.
      </p>
    </div>
  );
}
