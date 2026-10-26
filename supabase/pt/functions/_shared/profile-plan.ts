// profiles.plan is "the tier of the customer's most recent paid subscription",
// across properties AND business (BPP) accounts — or free_ai_review when there
// is none. Shared by stripe-webhook, sync-my-subscriptions and bulk-subscribe,
// which each used to keep their own copy: the two copies outside the webhook
// ignored BPP accounts (a BPP-only customer was reset to free), and all three
// counted only "active", dropping the plan while Stripe was still retrying a
// past_due payment or during a trial — unlike the app's PAID_STATUSES.
//
// Never touches a 'beta' account: that's an unconditional, non-Stripe grant
// (handle_new_user() in schema.sql). Throws on a database error.
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PAID_SUBSCRIPTION_STATUSES } from "./subscription-status.ts";

function ok<T extends { error: unknown }>(res: T): T {
  if (res.error) throw res.error;
  return res;
}

export async function syncProfilePlan(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  const { data: profile } = ok(
    await adminClient.from("profiles").select("plan").eq("id", userId).maybeSingle(),
  );
  if (profile?.plan === "beta") return;

  const [{ data: paidProps }, { data: paidBpp }] = (
    await Promise.all(
      (["properties", "bpp_accounts"] as const).map((table) =>
        adminClient
          .from(table)
          .select("plan_tier, created_at")
          .eq("user_id", userId)
          .in("subscription_status", PAID_SUBSCRIPTION_STATUSES)
          .order("created_at", { ascending: false })
          .limit(1),
      ),
    )
  ).map(ok);
  const newest = [...(paidProps ?? []), ...(paidBpp ?? [])].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  )[0];
  ok(
    await adminClient
      .from("profiles")
      .update({ plan: (newest?.plan_tier as string | undefined) ?? "free_ai_review" })
      .eq("id", userId),
  );
}
