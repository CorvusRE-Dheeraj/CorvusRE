import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ScrollReveal } from "@/components/ScrollReveal";
import { useAuth } from "@/lib/auth";
import { listProperties, buildAiReportIntakePatch, type PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { getPropertyProtestStatus, type ActionStatus } from "@/lib/portfolio-status";
import { currency, updateIntake } from "@/lib/intake-store";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/property-protest")({
  head: () => ({
    meta: [
      { title: "Property Protest — CorvusPT" },
      {
        name: "description",
        content:
          "AI-driven Texas real property protest: comp analysis, evidence packet, deadline tracking, and CorvusPT-managed filing and hearings.",
      },
      { property: "og:title", content: "AI-driven Texas Property Protest" },
      { property: "og:description", content: "AI evidence + human-managed filing and hearings." },
    ],
  }),
  component: Page,
});

function Page() {
  const { user, loading: authLoading } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setDataLoading(false);
      return;
    }
    Promise.all([listProperties(user.id), listProtests(user.id)])
      .then(([p, pr]) => {
        setProperties(p);
        setProtests(pr);
      })
      .catch((err) => console.error(err))
      .finally(() => setDataLoading(false));
  }, [user]);

  // Only properties with a real protest request on file — "have been
  // protested and currently are under protest," not every saved property
  // (an address someone's just tracking, with no protest yet, belongs on
  // the full Properties dashboard, not this list).
  const protestedProperties = properties
    .filter((p) => protests.some((pr) => pr.propertyId === p.id))
    .sort((a, b) => {
      const ta = protests.find((pr) => pr.propertyId === a.id)?.updatedAt ?? "";
      const tb = protests.find((pr) => pr.propertyId === b.id)?.updatedAt ?? "";
      return tb.localeCompare(ta);
    });

  // Signed-in visitors with at least one protest on file get their real
  // status list instead of the marketing pitch they don't need anymore —
  // everyone else (signed out, or signed in with nothing protested yet)
  // sees the same page this always was.
  if (!authLoading && user && !dataLoading && protestedProperties.length > 0) {
    return (
      <div className="container-page py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="badge-soft">Real Property Protest</span>
            <h1 className="mt-3 font-serif text-3xl font-semibold">Your Protests</h1>
            <p className="mt-1 text-muted-foreground">
              {protestedProperties.length} propert{protestedProperties.length === 1 ? "y" : "ies"}{" "}
              with a protest on file.
            </p>
          </div>
          <Link to="/dashboard/properties" className="btn-outline">
            Manage All Properties
          </Link>
        </div>

        <div className="mt-6 grid gap-4">
          {protestedProperties.map((p, i) => (
            <ProtestedPropertyCard
              key={p.id}
              property={p}
              protest={protests.find((pr) => pr.propertyId === p.id)!}
              delay={Math.min(i, 8) * 60}
            />
          ))}
        </div>
      </div>
    );
  }

  // Signed in but the property/protest fetch hasn't resolved yet — avoid a
  // flash of the marketing pitch for someone who's about to see their real
  // list a moment later.
  if (!authLoading && user && dataLoading) {
    return (
      <div className="container-page py-16">
        <div className="max-w-3xl">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-9 w-64" />
        </div>
        <div className="mt-6 grid gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  const bullets = [
    "AI reviews CAD value against comparable sales and equity comps.",
    "AI Evidence Builder assembles a hearing-ready packet.",
    "CorvusPT staff files, communicates with county, and represents at hearings.",
    "Deadline engine tracks your protest window automatically.",
  ];
  return (
    <div className="container-page py-16">
      <div className="max-w-3xl">
        <span className="badge-soft">Real Property Protest</span>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
          Protest with AI evidence. Filed and defended by humans.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          AI handles research, comps, and evidence. CorvusPT handles filing, county communication,
          hearings, and settlement.
        </p>
        <ul className="mt-6 grid gap-3">
          {bullets.map((b, i) => (
            <li key={b}>
              <ScrollReveal delay={i * 80} className="flex gap-2 text-foreground/90">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent" /> {b}
              </ScrollReveal>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex gap-3">
          <Link to="/" className="btn-primary btn-primary-hover">
            Start Free Review
          </Link>
          <Link to="/pricing" className="btn-outline">
            Pricing
          </Link>
        </div>
      </div>
    </div>
  );
}

// Same needs_action/in_progress/resolved/on_track tone the dashboard's own
// Properties page and home nudge banner use — see portfolio-status.ts.
const STATUS_TONE: Record<ActionStatus, string> = {
  needs_action: "text-destructive",
  in_progress: "text-accent",
  resolved: "text-success",
  on_track: "text-muted-foreground",
};

function ProtestedPropertyCard({
  property,
  protest,
  delay,
}: {
  property: PropertyRecord;
  protest: ProtestRecord;
  delay: number;
}) {
  const nav = useNavigate();
  const { status, label } = getPropertyProtestStatus(property, [protest]);

  // Same deep-link pattern the Properties dashboard's own "Open AI Report"
  // uses (see openAiReport in dashboard/_layout.properties.tsx) — sets the
  // shared intake state to THIS property, then the AI Report page picks it
  // up on load. Manage previously just linked to the generic Properties
  // list with no property context at all.
  function goToModules() {
    updateIntake(buildAiReportIntakePatch(property));
    nav({ to: "/ai-report" });
  }

  return (
    <div className="card-elev p-6" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{property.cad}</span>
            <span className={`badge-soft ${STATUS_TONE[status]}`}>{label}</span>
          </div>
          <h3 className="font-serif text-xl font-semibold">{property.address}</h3>
          <p className="text-sm text-muted-foreground">
            {property.propertyType} • Acct {property.accountNumber} • Tax year {property.taxYear}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted-foreground">Assessed value</div>
          <div className="text-2xl font-semibold">{currency(property.totalValue ?? undefined)}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/dashboard/case"
          search={{ propertyId: property.id }}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline"
        >
          View Case
        </Link>
        <button type="button" onClick={goToModules} className="btn-outline">
          Manage
        </button>
      </div>
    </div>
  );
}
