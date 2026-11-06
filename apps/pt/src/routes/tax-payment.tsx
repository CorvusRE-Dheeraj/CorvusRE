import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  Bell,
  CalendarClock,
  ExternalLink,
  FileCheck2,
  Layers,
  SplitSquareHorizontal,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/tax-payment")({
  head: () => ({
    meta: [
      { title: "Tax Payment Tracking — CorvusPT" },
      {
        name: "description",
        content:
          "Track Texas property tax bills, payment plans, deadlines and receipts across every county and every property in one dashboard.",
      },
      { property: "og:title", content: "Tax Payment Tracking" },
      { property: "og:description", content: "One dashboard for bills, payments, and refunds." },
    ],
  }),
  component: Page,
});

// What Pay Taxes does today (apps/pt/src/routes/dashboard/_layout.pay-taxes.tsx).
const FEATURES = [
  {
    icon: Layers,
    title: "Every bill, by property",
    body: "Each property's tax bill, amount due and due date in one table, with a status you can trust at a glance — unpaid, partially paid, paid or overdue.",
  },
  {
    icon: SplitSquareHorizontal,
    title: "Payment plans that apply to you",
    body: "Half-payment (pay half by November 30, the rest by June 30) where your county offers it, and the quarter-payment plan for over-65 and disability homesteads — with each installment tracked.",
  },
  {
    icon: CalendarClock,
    title: "November 30 half-pay total",
    body: "For portfolios: which properties can split their bill, how much each owes by November 30, and the combined total.",
  },
  {
    icon: Bell,
    title: "Reminders before every deadline",
    body: "Email reminders 30, 15, 7, 3 and 2 days before each due date and installment, and on the day itself.",
  },
  {
    icon: ExternalLink,
    title: "Straight to the county's payment page",
    body: "Pay Taxes opens your county tax office's own payment page — your account page where the county supports it. CorvusPT never handles your tax payment.",
  },
  {
    icon: FileCheck2,
    title: "Receipts and history",
    body: "Upload the payment receipt to the property's documents and see every past year's bill and payment in one place.",
  },
];

function Page() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  // Signed in: this page only describes the feature — open the feature itself.
  useEffect(() => {
    if (!loading && user) nav({ to: "/dashboard/pay-taxes", replace: true });
  }, [loading, user, nav]);

  return (
    <div className="container-page py-16">
      <div className="max-w-3xl">
        <span className="badge-soft">Tax Payment</span>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
          Never miss a tax bill, payment, or refund.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Every county bill, every account, every payment, and every refund — all tracked in one
          place with deadline reminders and status intelligence.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/" className="btn-primary btn-primary-hover">
            Start Free Review
          </Link>
          <Link to="/pricing" className="btn-outline">
            See pricing
          </Link>
        </div>
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="card-elev p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>

      <p className="mt-8 max-w-3xl text-xs text-muted-foreground">
        Payment plan rules are set by each county and taxing unit. Where a county's own website
        doesn't state its rules, CorvusPT shows them as "to confirm with the county tax office".
      </p>
    </div>
  );
}
