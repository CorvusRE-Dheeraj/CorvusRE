import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// Deadlines and Calendar showed the same underlying dates (protest deadlines, hearings, tax
// bills) — folded into one page (Calendar, now with Month/Week/Day/List views) per explicit
// product direction. This route only exists so an old link (an emailed reminder, a bookmark,
// browser history) still lands somewhere real instead of a 404.
export const Route = createFileRoute("/dashboard/_layout/deadlines")({
  component: DeadlinesRedirect,
});

function DeadlinesRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    void nav({ to: "/dashboard/calendar", replace: true });
  }, [nav]);
  return <p className="mt-6 text-sm text-muted-foreground">Deadlines has moved to Calendar…</p>;
}
