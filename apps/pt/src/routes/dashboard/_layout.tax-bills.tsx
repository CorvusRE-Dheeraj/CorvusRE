import { createFileRoute, redirect } from "@tanstack/react-router";

// Tax Bills became the Pay Taxes tab (2026-11-05) — old links land there.
export const Route = createFileRoute("/dashboard/_layout/tax-bills")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/pay-taxes", replace: true });
  },
});
