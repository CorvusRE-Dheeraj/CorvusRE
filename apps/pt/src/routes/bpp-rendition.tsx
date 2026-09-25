import { createFileRoute, Link } from "@tanstack/react-router";
import { ScrollReveal } from "@/components/ScrollReveal";

export const Route = createFileRoute("/bpp-rendition")({
  head: () => ({
    meta: [
      { title: "BPP Rendition — CorvusPT" },
      {
        name: "description",
        content:
          "AI-powered Business Personal Property rendition and protest: templates, asset categories, depreciation logic, and county-specific rules.",
      },
      { property: "og:title", content: "BPP Rendition & Protest" },
      {
        property: "og:description",
        content: "AI templates, asset extraction, and CorvusPT-filed BPP.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  const items = [
    [
      "AI-read intake",
      "Upload a prior rendition or the county's BPP notice and AI extracts your real rendered value, account number, and deadlines.",
    ],
    [
      "Real Form 50-144",
      "The actual Texas Comptroller rendition form, prefilled from what you entered, e-signed in-app.",
    ],
    [
      "Real deadline tracking",
      "The statutory April 15 rendition deadline, and a protest deadline once the county responds.",
    ],
    [
      "CorvusPT protests it",
      "If the county's assessed value disagrees with what you rendered, CorvusPT can file and manage the protest.",
    ],
  ];
  return (
    <div>
      <div className="container-page pt-16">
        <div className="max-w-3xl">
          <span className="badge-soft">BPP Rendition</span>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
            BPP rendition without the paperwork.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Upload a prior rendition or the county's BPP notice. AI reads your real value, prepares
            the filing, and CorvusPT protests it if the county disagrees.
          </p>
        </div>
      </div>

      <div className="container-page pb-16">
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {items.map(([t, d], i) => (
            <ScrollReveal key={t} delay={i * 80}>
              <div className="card-elev p-6 transition-all hover:-translate-y-0.5 hover:shadow-elev">
                <h2 className="font-semibold text-lg">{t}</h2>
                <p className="mt-2 text-muted-foreground">{d}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
        <div className="mt-8">
          <Link to="/dashboard/bpp-intake" className="btn-primary btn-primary-hover">
            Start Free Review
          </Link>
        </div>
      </div>
    </div>
  );
}
