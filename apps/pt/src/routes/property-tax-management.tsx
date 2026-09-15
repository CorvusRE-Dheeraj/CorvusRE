import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Scale,
  Briefcase,
  Receipt,
  CreditCard,
  RefreshCcw,
  FileText,
  CalendarClock,
  TrendingDown,
} from "lucide-react";
import { ScrollReveal } from "@/components/ScrollReveal";
import { ICON_COLORS } from "@/lib/icon-colors";

export const Route = createFileRoute("/property-tax-management")({
  head: () => ({
    meta: [
      { title: "Property Tax Management — CorvusPT" },
      {
        name: "description",
        content:
          "One AI-powered platform for Texas real property protest, BPP rendition, tax bill tracking, payments, refunds, evidence, and annual savings.",
      },
      { property: "og:title", content: "Property Tax Management" },
      {
        property: "og:description",
        content: "Everything for Texas property tax in one connected flow.",
      },
    ],
  }),
  component: Page,
});

const CAPS = [
  {
    title: "Real Property Protest",
    description: "AI comps, evidence, and CorvusPT-filed protest.",
    icon: Scale,
  },
  {
    title: "BPP Rendition & Protest",
    description: "Business-type templates, asset categories, and depreciation.",
    icon: Briefcase,
  },
  {
    title: "Tax Bill Tracking",
    description: "Every county bill, every account, one dashboard.",
    icon: Receipt,
  },
  {
    title: "Payment Tracking",
    description: "Never miss a payment or discount deadline.",
    icon: CreditCard,
  },
  {
    title: "Refund Tracking",
    description: "Follow refund status from settlement to check.",
    icon: RefreshCcw,
  },
  {
    title: "Evidence Library",
    description: "AI-extracted, tagged, and packaged for hearings.",
    icon: FileText,
  },
  {
    title: "Deadline Engine",
    description: "County-aware deadlines with reminders and escalations.",
    icon: CalendarClock,
  },
  {
    title: "Annual Savings Report",
    description: "Year‑over‑year savings, ROI, and next-year strategy.",
    icon: TrendingDown,
  },
];

function Page() {
  return (
    <div>
      <div className="container-page pt-16">
        <div className="max-w-3xl">
          <span className="badge-soft">Platform</span>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
            One platform. One property record. One savings journey.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Property protest, BPP rendition, tax bill tracking, payment tracking, and savings — all
            connected through one owner profile, one property record, one document library, one
            deadline engine, and one dashboard.
          </p>
        </div>
      </div>

      <div className="container-page pb-16">
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {CAPS.map((cap, i) => {
            const color = ICON_COLORS[i % ICON_COLORS.length];
            return (
              <ScrollReveal key={cap.title} delay={i * 60}>
                <div className="card-elev p-5 h-full transition-all hover:-translate-y-0.5 hover:shadow-elev">
                  <div
                    className={`h-9 w-9 rounded-md flex items-center justify-center ${color.bg} ${color.text}`}
                  >
                    <cap.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 font-semibold">{cap.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{cap.description}</p>
                </div>
              </ScrollReveal>
            );
          })}
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link to="/" className="btn-primary btn-primary-hover">
            Start Free AI Property Review
          </Link>
          <Link to="/how-it-works" className="btn-outline">
            How It Works
          </Link>
        </div>
      </div>
    </div>
  );
}
