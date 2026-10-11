import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { openFeedbackWidget } from "@/lib/feedback-widget-events";

// The feedback form is now the floating chat-style widget (FeedbackWidget). This
// route only exists so old links — emailed reminders in particular — still work:
// it opens the widget and drops the person on the dashboard.
export const Route = createFileRoute("/dashboard/_layout/feedback")({
  head: () => ({
    meta: [{ title: "Beta Feedback — CorvusPT" }],
  }),
  component: FeedbackRedirect,
});

function FeedbackRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    void nav({ to: "/dashboard", replace: true }).then(() => {
      // Give the widget a beat to finish loading its data before asking it to open.
      setTimeout(openFeedbackWidget, 800);
    });
  }, [nav]);
  return <p className="mt-6 text-sm text-muted-foreground">Opening feedback…</p>;
}
