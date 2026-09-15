import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/finance")({
  head: () => ({ meta: [{ title: "Financing — CorvusDP" }] }),
  component: Finance,
});

function Finance() {
  return (
    <div className="container-page py-20 max-w-2xl text-center">
      <span className="badge-soft-warning">Coming soon</span>
      <h1 className="mt-4 font-serif text-3xl font-semibold">
        Development &amp; construction financing
      </h1>
      <p className="mt-3 text-muted-foreground">
        Financing tooling is on the CorvusRE roadmap and covered by a separate product spec. For
        now, start with a permitting analysis or a design brief.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/permitting" className="btn-accent">
          Permitting
        </Link>
        <Link to="/design" className="btn-outline">
          Design
        </Link>
      </div>
    </div>
  );
}
