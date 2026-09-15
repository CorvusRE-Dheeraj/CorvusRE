import { createFileRoute } from "@tanstack/react-router";
import { TERMS_VERSION } from "@/lib/legal";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service — CorvusDP" }] }),
  component: Terms,
});

function Terms() {
  return (
    <div className="container-page py-12 max-w-2xl">
      <h1 className="font-serif text-3xl font-semibold">Terms of Service</h1>
      <p className="mt-1 text-xs text-muted-foreground">Version {TERMS_VERSION}</p>
      <div className="mt-6 grid gap-4 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">Estimates, not determinations.</strong> CorvusDP
          produces AI-assisted estimates of permit requirements, fees, timelines, zoning outcomes,
          and design scope. These vary by jurisdiction and project specifics and are not a formal
          determination by any governing authority.
        </p>
        <p>
          <strong className="text-foreground">Not professional advice.</strong> Nothing provided by
          CorvusDP is legal, engineering, or architectural advice, and it does not replace a
          licensed design professional or an official jurisdiction review.
        </p>
        <p>
          <strong className="text-foreground">Your responsibility.</strong> You are responsible for
          confirming all requirements with the authority having jurisdiction before submitting
          applications or committing funds.
        </p>
        <p>
          <strong className="text-foreground">Acceptable use.</strong> Don't misuse the service,
          probe its security, or use it to violate the law. We may suspend accounts that do.
        </p>
        <p>
          <strong className="text-foreground">Availability & changes.</strong> CorvusDP is in early
          access and provided "as is." Features and these terms may change; continued use after a
          change constitutes acceptance.
        </p>
      </div>
    </div>
  );
}
