import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// One-click unsubscribe from CorvusPT marketing email (the link in every
// campaign and follow-up email). No sign-in: the token in the link is the key.
export const Route = createFileRoute("/unsubscribe")({
  head: () => ({
    meta: [{ title: "Unsubscribe — CorvusPT" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (s: Record<string, unknown>): { t?: string } => ({
    t: typeof s.t === "string" ? s.t : undefined,
  }),
  component: Unsubscribe,
});

function Unsubscribe() {
  const { t } = Route.useSearch();
  const [state, setState] = useState<"working" | "done" | "invalid">("working");
  useEffect(() => {
    if (!t || !/^[0-9a-f-]{36}$/i.test(t)) {
      setState("invalid");
      return;
    }
    supabase
      .rpc("marketing_unsubscribe", { p_token: t })
      .then(({ data, error }) => setState(!error && data ? "done" : "invalid"));
  }, [t]);
  return (
    <div className="container-page grid min-h-[50vh] place-items-center py-16">
      <div className="card-elev max-w-md p-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">
          {state === "done"
            ? "You're unsubscribed"
            : state === "invalid"
              ? "This link didn't work"
              : "Unsubscribing…"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {state === "done"
            ? "You won't get CorvusPT marketing emails any more. Account emails about your own properties and deadlines still arrive."
            : state === "invalid"
              ? "The link may be incomplete. Reply to any of our emails and we'll remove you by hand."
              : "One moment."}
        </p>
        <Link to="/" className="btn-outline mt-5 inline-block text-sm">
          CorvusPT home
        </Link>
      </div>
    </div>
  );
}
