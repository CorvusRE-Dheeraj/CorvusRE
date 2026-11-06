// Deploy via CLI: `supabase functions deploy payment-reminder-action --no-verify-jwt`
//
// The "Already paid" / "Remind me later" buttons in a property-tax payment
// reminder (send-deadline-reminders). No sign-in: the link carries a random
// 64-hex token (payment_reminder_links, 60-day expiry) that names one user and
// one payment, and that is all it can touch. The app's /payment-reminder page
// calls this — it shows the payment and asks for a click before acting, since
// mail scanners open every link in an email.
//
// POST {t, action}:
//   "info"  → the payment, and whether it's already paid / snoozed
//   "later" → no reminders for this payment for 24 hours, then one more
//             (payment_reminder_snoozes; the hourly cron run follows it up)
//   "paid"  → marks it paid as owner-reported: the bill (status paid, paid_at,
//             amount_paid), one installment of a plan (its paidAt; the bill
//             becomes partial, or paid once every installment is), or a
//             property's own due date (properties.paid_at). That resolves the
//             event, so its reminders stop.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const SNOOZE_MS = 24 * 60 * 60 * 1000;

type Installment = {
  label: string;
  dueDate: string;
  amount: number | null;
  paidAt?: string | null;
  amountPaid?: number | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { t, action } = (await req.json()) as { t?: unknown; action?: unknown };
    if (typeof t !== "string" || !/^[0-9a-f]{64}$/.test(t)) return json({ error: "invalid_link" }, 400);
    if (action !== "info" && action !== "later" && action !== "paid") {
      return json({ error: "action must be info, later or paid" }, 400);
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: link } = await admin
      .from("payment_reminder_links")
      .select("user_id, event_key, event_date, title, amount, expires_at")
      .eq("token", t)
      .maybeSingle();
    if (!link) return json({ error: "invalid_link" }, 404);
    if (new Date(link.expires_at as string) < new Date()) return json({ error: "expired" }, 410);
    const userId = link.user_id as string;
    const key = link.event_key as string;

    // What the key points at — see deadline-events.ts.
    const [kind, ...rest] = key.split(":");
    let paid = false;
    let bill: { id: string; amount_due: number | null; installments: Installment[] } | null = null;
    let installmentLabel: string | null = null;
    let propertyId: string | null = null;
    if (kind === "tax-due" && rest[0] === "bill") {
      const { data } = await admin
        .from("tax_bills")
        .select("id, amount_due, installments, status, paid_at")
        .eq("id", rest[1])
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      bill = { id: data.id, amount_due: data.amount_due, installments: data.installments ?? [] };
      paid = !!data.paid_at || data.status === "paid";
    } else if (kind === "tax-installment") {
      installmentLabel = rest.slice(1).join(":");
      const { data } = await admin
        .from("tax_bills")
        .select("id, amount_due, installments, status, paid_at")
        .eq("id", rest[0])
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      bill = { id: data.id, amount_due: data.amount_due, installments: data.installments ?? [] };
      const inst = bill.installments.find((i) => i.label === installmentLabel);
      paid = !!data.paid_at || data.status === "paid" || !!inst?.paidAt;
    } else if (kind === "tax-due" && rest[0] === "property") {
      propertyId = rest[1];
      const { data } = await admin
        .from("properties")
        .select("id, paid_at")
        .eq("id", propertyId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      paid = !!data.paid_at;
    } else {
      return json({ error: "not_found" }, 404);
    }

    const { data: snooze } = await admin
      .from("payment_reminder_snoozes")
      .select("snoozed_until")
      .eq("user_id", userId)
      .eq("event_key", key)
      .maybeSingle();
    const snoozedUntil =
      snooze && new Date(snooze.snoozed_until as string) > new Date()
        ? (snooze.snoozed_until as string)
        : null;
    const info = {
      title: link.title,
      dueDate: link.event_date,
      amount: link.amount,
      paid,
      snoozedUntil,
    };

    if (action === "info") return json(info);

    if (action === "later") {
      if (paid) return json({ ...info, error: "already_paid" }, 409);
      const until = new Date(Date.now() + SNOOZE_MS).toISOString();
      const { error } = await admin.from("payment_reminder_snoozes").upsert(
        { user_id: userId, event_key: key, snoozed_until: until, reminded_at: null },
        { onConflict: "user_id,event_key" },
      );
      if (error) throw new Error(error.message);
      return json({ ...info, snoozedUntil: until });
    }

    // paid
    const nowIso = new Date().toISOString();
    if (!paid) {
      if (propertyId) {
        const { error } = await admin.from("properties").update({ paid_at: nowIso }).eq("id", propertyId).eq("user_id", userId);
        if (error) throw new Error(error.message);
      } else if (bill && installmentLabel) {
        const installments = bill.installments.map((i) =>
          i.label === installmentLabel ? { ...i, paidAt: nowIso, amountPaid: i.amountPaid ?? i.amount } : i,
        );
        const allPaid = installments.every((i) => !!i.paidAt);
        const amountPaid = installments.reduce((s, i) => s + (i.paidAt ? (i.amountPaid ?? i.amount ?? 0) : 0), 0);
        const { error } = await admin
          .from("tax_bills")
          .update({
            installments,
            status: allPaid ? "paid" : "partial",
            status_source: "user",
            amount_paid: amountPaid || null,
            ...(allPaid ? { paid_at: nowIso } : {}),
          })
          .eq("id", bill.id)
          .eq("user_id", userId);
        if (error) throw new Error(error.message);
      } else if (bill) {
        const { error } = await admin
          .from("tax_bills")
          .update({
            status: "paid",
            status_source: "user",
            paid_at: nowIso,
            ...(bill.amount_due != null ? { amount_paid: bill.amount_due } : {}),
          })
          .eq("id", bill.id)
          .eq("user_id", userId);
        if (error) throw new Error(error.message);
      }
    }
    // Paid ends any snooze on it.
    await admin.from("payment_reminder_snoozes").delete().eq("user_id", userId).eq("event_key", key);
    return json({ ...info, paid: true, snoozedUntil: null });
  } catch (err) {
    console.error("payment-reminder-action failed:", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
