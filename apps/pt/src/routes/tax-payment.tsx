import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/tax-payment")({
  head: () => ({
    meta: [
      { title: "Tax Payment Tracking — CorvusPT" },
      {
        name: "description",
        content:
          "Track Texas property tax bills, payments, and refunds across every county and every account in one dashboard.",
      },
      { property: "og:title", content: "Tax Payment Tracking" },
      { property: "og:description", content: "One dashboard for bills, payments, and refunds." },
    ],
  }),
  component: Page,
});

function Page() {
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
        <div className="mt-8">
          <Link to="/" className="btn-primary btn-primary-hover">
            Start Free Review
          </Link>
        </div>
      </div>
    </div>
  );
}
