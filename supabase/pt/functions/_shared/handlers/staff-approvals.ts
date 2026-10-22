// Approvals for sensitive actions (see supabase/pt/shared-admin.sql).
// Any staff member — or the AI on their behalf (source "ai") — may REQUEST:
//   access_change          give / remove a staff role
//   pricing_exception      a discount for one customer (optionally one property)
//   refund                 refund a property's latest subscription payment
//   agreement_change       void a signed agreement so the customer signs again
//   automation_permission  turn a marketing automation on / off
// Only a Super Admin DECIDES; an approval is then executed here (Stripe for
// refunds and discounts, apply_approved_change() for the rest) and recorded in
// the shared history with the approval it used.
//
//   POST ?action=staff-approvals { op: "request", kind, payload, reason, source?, aiRationale?, decideNow? }
//   POST ?action=staff-approvals { op: "decide", id, approve, note? }
//   POST ?action=staff-approvals { op: "cancel", id }
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { getStripeMode, stripeSecretKey } from "../stripe-mode.ts";
import { ensureCoupon, exceptionCouponDef, type PricingException } from "../discounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: corsHeaders });

type Kind = "access_change" | "pricing_exception" | "refund" | "agreement_change" | "automation_permission";
const KINDS: Kind[] = ["access_change", "pricing_exception", "refund", "agreement_change", "automation_permission"];
const ROLE_LABEL: Record<string, string> = {
  marketing_admin: "Marketing Admin",
  marketing_supervisor: "Marketing Supervisor",
  support_admin: "Customer Support Admin",
  operations_admin: "Operations Admin",
  is_admin: "Super Admin",
};
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

type Staff = { id: string; email: string; is_admin: boolean; marketing_admin: boolean; support_admin: boolean; operations_admin: boolean };
type Approval = {
  id: string;
  kind: Kind;
  status: string;
  requested_by: string;
  target_profile: string | null;
  target_property: string | null;
  title: string;
  payload: Record<string, unknown>;
  reason: string;
};

function departmentOf(s: Staff): string {
  return s.is_admin ? "super_admin" : s.operations_admin ? "operations" : s.support_admin ? "support" : "marketing";
}

async function findCustomer(db: SupabaseClient, email: unknown) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) throw new Error("Enter the customer's email");
  const { data } = await db.from("profiles").select("id, email").ilike("email", e).maybeSingle();
  if (!data) throw new Error(`No account with the email ${e}`);
  return data as { id: string; email: string };
}

/** Validates a request and works out its target + a readable title. */
async function shape(db: SupabaseClient, kind: Kind, p: Record<string, unknown>) {
  if (kind === "automation_permission") {
    const { data } = await db.from("automation_permissions").select("key, label, enabled").eq("key", String(p.key ?? "")).maybeSingle();
    if (!data) throw new Error("Pick an automation");
    const enabled = p.enabled === true;
    if (data.enabled === enabled) throw new Error(`${data.label} is already ${enabled ? "on" : "off"}`);
    return { profile: null, property: null, payload: { key: data.key, enabled }, title: `Turn ${enabled ? "on" : "off"}: ${data.label}` };
  }
  const who = await findCustomer(db, p.email);
  if (kind === "access_change") {
    const role = String(p.role ?? "");
    if (!ROLE_LABEL[role]) throw new Error("Pick a role");
    const enabled = p.enabled === true;
    return { profile: who.id, property: null, payload: { role, enabled, email: who.email }, title: `${enabled ? "Give" : "Remove"} ${ROLE_LABEL[role]} — ${who.email}` };
  }
  if (kind === "pricing_exception") {
    const pct = Number(p.percent_off);
    if (!(pct > 0 && pct <= 100)) throw new Error("Discount must be between 1% and 100%");
    const duration = ["once", "forever", "repeating"].includes(String(p.duration)) ? String(p.duration) : "once";
    const months = duration === "repeating" ? Math.max(1, Math.min(36, Number(p.duration_in_months) || 12)) : null;
    let property: { id: string; address: string } | null = null;
    if (p.property_id) {
      const { data } = await db.from("properties").select("id, address, user_id").eq("id", String(p.property_id)).maybeSingle();
      if (!data || data.user_id !== who.id) throw new Error("That property isn't on this customer's account");
      property = data;
    }
    const dur = duration === "once" ? "first year" : duration === "forever" ? "every year" : `${months} months`;
    return {
      profile: who.id,
      property: property?.id ?? null,
      payload: { email: who.email, percent_off: pct, duration, duration_in_months: months, property_address: property?.address ?? null },
      title: `${pct}% off (${dur}) — ${who.email}${property ? ` · ${property.address}` : ""}`,
    };
  }
  if (kind === "refund") {
    const { data: prop } = await db
      .from("properties")
      .select("id, address, user_id, stripe_subscription_id")
      .eq("id", String(p.property_id ?? ""))
      .maybeSingle();
    if (!prop || prop.user_id !== who.id) throw new Error("Pick one of this customer's properties");
    if (!prop.stripe_subscription_id) throw new Error("That property has no paid subscription to refund");
    const cents = p.amount != null && String(p.amount).trim() !== "" ? Math.round(Number(p.amount) * 100) : null;
    if (cents != null && !(cents > 0)) throw new Error("Refund amount must be more than $0");
    return {
      profile: who.id,
      property: prop.id,
      payload: { email: who.email, amount_cents: cents, property_address: prop.address },
      title: `Refund ${cents ? usd(cents) : "the latest payment in full"} — ${who.email} · ${prop.address}`,
    };
  }
  // agreement_change: void the customer's current signed copy
  const agreement = String(p.agreement ?? "");
  let recordId = p.record_id ? String(p.record_id) : null;
  if (agreement === "engagement_packet") {
    if (!recordId) {
      const { data } = await db.from("engagement_packets").select("id").eq("user_id", who.id).is("voided_at", null).order("signed_at", { ascending: false }).limit(1).maybeSingle();
      recordId = data?.id ?? null;
    }
  } else if (agreement === "service_agreement") {
    if (!recordId) {
      let q = db.from("service_agreement_acceptances").select("id").eq("user_id", who.id).is("voided_at", null);
      if (p.property_id) q = q.eq("property_id", String(p.property_id));
      const { data } = await q.order("accepted_at", { ascending: false }).limit(1).maybeSingle();
      recordId = data?.id ?? null;
    }
  } else throw new Error("Pick the agreement");
  if (!recordId) throw new Error("This customer has no signed copy of that agreement");
  const label = agreement === "engagement_packet" ? "engagement packet" : "service agreement";
  return {
    profile: who.id,
    property: p.property_id ? String(p.property_id) : null,
    payload: { email: who.email, agreement, record_id: recordId },
    title: `Void the signed ${label} so it's signed again — ${who.email}`,
  };
}

async function stripeFor(userId: string) {
  const mode = await getStripeMode(userId);
  return { mode, stripe: new Stripe(stripeSecretKey(mode), { apiVersion: "2025-02-24.acacia" }) };
}

/** Carries out an approved request. Returns the result stored on the approval. */
async function execute(db: SupabaseClient, a: Approval, decidedBy: string) {
  if (a.kind === "access_change" || a.kind === "automation_permission" || a.kind === "agreement_change") {
    const { data, error } = await db.rpc("apply_approved_change", { p_approval: a.id });
    if (error) throw new Error(error.message);
    return data;
  }
  if (a.kind === "pricing_exception") {
    const p = a.payload as { percent_off: number; duration: PricingException["duration"]; duration_in_months: number | null };
    const { data: ex, error } = await db
      .from("pricing_exceptions")
      .insert({ profile_id: a.target_profile, property_id: a.target_property, percent_off: p.percent_off, duration: p.duration, duration_in_months: p.duration_in_months, note: a.reason, approval_id: a.id })
      .select("id, percent_off, duration, duration_in_months")
      .single();
    if (error) throw new Error(error.message);
    // already subscribed? apply it to that subscription now
    let appliedTo: string | null = null;
    if (a.target_property) {
      const { data: prop } = await db.from("properties").select("stripe_subscription_id").eq("id", a.target_property).maybeSingle();
      if (prop?.stripe_subscription_id) {
        const { stripe } = await stripeFor(a.target_profile!);
        const coupon = await ensureCoupon(stripe, exceptionCouponDef(ex as PricingException));
        await stripe.subscriptions.update(prop.stripe_subscription_id, { discounts: [{ coupon }] });
        appliedTo = prop.stripe_subscription_id;
      }
    }
    const result = { pricing_exception_id: ex.id, applied_to_subscription: appliedTo, applies_at_checkout: !appliedTo };
    await db.from("approval_requests").update({ status: "executed", executed_at: new Date().toISOString(), result }).eq("id", a.id);
    await db.rpc("log_record_event", {
      p_department: "shared", p_entity_type: "pricing", p_entity_id: ex.id, p_action: "pricing_exception_applied",
      p_summary: `Pricing exception: ${a.title}${appliedTo ? " — applied to the current subscription" : " — applies at checkout"}`,
      p_profile: a.target_profile, p_property: a.target_property, p_after: result, p_approval: a.id, p_actor: decidedBy,
    });
    return result;
  }
  // refund: the latest paid invoice of the property's subscription
  const { data: prop } = await db.from("properties").select("stripe_subscription_id, address").eq("id", a.target_property!).single();
  if (!prop?.stripe_subscription_id) throw new Error("The property no longer has a subscription");
  const { stripe, mode } = await stripeFor(a.target_profile!);
  const invoices = await stripe.invoices.list({ subscription: prop.stripe_subscription_id, status: "paid", limit: 1 });
  const inv = invoices.data[0];
  if (!inv) throw new Error("No paid invoice on that subscription");
  const piId = typeof inv.payment_intent === "string" ? inv.payment_intent : inv.payment_intent?.id;
  const chargeId = typeof inv.charge === "string" ? inv.charge : inv.charge?.id;
  if (!piId && !chargeId) throw new Error("That invoice has no card payment to refund (it may have been $0)");
  const amount = (a.payload as { amount_cents?: number | null }).amount_cents ?? undefined;
  if (amount && amount > inv.amount_paid) throw new Error(`Refund can't exceed the ${usd(inv.amount_paid)} paid`);
  const refund = await stripe.refunds.create({
    ...(piId ? { payment_intent: piId } : { charge: chargeId! }),
    ...(amount ? { amount } : {}),
    reason: "requested_by_customer",
    metadata: { approval_id: a.id, property: prop.address ?? "" },
  });
  const result = { refund_id: refund.id, amount_cents: refund.amount, status: refund.status, invoice: inv.id, stripe_mode: mode };
  await db.from("approval_requests").update({ status: "executed", executed_at: new Date().toISOString(), result }).eq("id", a.id);
  await db.rpc("log_record_event", {
    p_department: "shared", p_entity_type: "refund", p_entity_id: null, p_action: "refund_issued",
    p_summary: `Refund of ${usd(refund.amount)} issued (${refund.status}) — ${prop.address}`,
    p_profile: a.target_profile, p_property: a.target_property, p_after: result, p_approval: a.id, p_actor: decidedBy,
  });
  return result;
}

async function decide(db: SupabaseClient, me: Staff, id: string, approve: boolean, note: string | null) {
  const { data: a } = await db.from("approval_requests").select("*").eq("id", id).maybeSingle();
  if (!a) throw new Error("Request not found");
  if (a.status !== "pending") throw new Error(`This request is already ${a.status}`);
  const now = new Date().toISOString();
  const { error } = await db
    .from("approval_requests")
    .update({ status: approve ? "approved" : "rejected", decided_by: me.id, decided_at: now, decision_note: note })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  await db.rpc("log_record_event", {
    p_department: "super_admin", p_entity_type: "approval", p_entity_id: id,
    p_action: approve ? "approval_granted" : "approval_rejected",
    p_summary: `${approve ? "Approved" : "Rejected"}: ${a.title}${note ? ` — ${note}` : ""}`,
    p_profile: a.target_profile, p_property: a.target_property, p_approval: id, p_actor: me.id,
  });
  let result: unknown = null;
  let failure: string | null = null;
  if (approve) {
    try {
      result = await execute(db, { ...a, status: "approved" } as Approval, me.id);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      await db.from("approval_requests").update({ status: "failed", error: failure }).eq("id", id);
    }
  }
  await db.rpc("notify_department", {
    p_department: "super_admin", p_owner: a.requested_by,
    p_kind: "approval_" + (approve ? (failure ? "failed" : "done") : "rejected"),
    p_title: `${approve ? (failure ? "Approved but failed" : "Approved") : "Not approved"}: ${a.title}`,
    p_detail: failure ?? note ?? "", p_entity_type: "approval", p_entity_id: id, p_lead: null,
  });
  return { status: approve ? (failure ? "failed" : "executed") : "rejected", result, error: failure };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await db
      .from("profiles")
      .select("id, email, is_admin, marketing_admin, support_admin, operations_admin")
      .eq("id", user.id)
      .single();
    const staff = me as Staff | null;
    if (!staff || !(staff.is_admin || staff.marketing_admin || staff.support_admin || staff.operations_admin)) {
      return json({ error: "not authorized" }, 403);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // what the request form needs about a customer: their properties (for a
    // refund / discount) and which signed agreements are on file — no more
    if (body.op === "lookup") {
      const who = await findCustomer(db, body.email);
      const [{ data: props }, { data: packet }, { data: sas }] = await Promise.all([
        db.from("properties").select("id, address, stripe_subscription_id, subscription_status").eq("user_id", who.id).order("created_at"),
        db.from("engagement_packets").select("id, signed_at").eq("user_id", who.id).is("voided_at", null).order("signed_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("service_agreement_acceptances").select("id, property_address, accepted_at").eq("user_id", who.id).is("voided_at", null).order("accepted_at", { ascending: false }).limit(20),
      ]);
      return json({
        email: who.email,
        properties: (props ?? []).map((p) => ({ id: p.id, address: p.address, subscribed: !!p.stripe_subscription_id, status: p.subscription_status })),
        engagementPacket: packet ? { id: packet.id, signedAt: packet.signed_at } : null,
        serviceAgreements: (sas ?? []).map((s) => ({ id: s.id, address: s.property_address, acceptedAt: s.accepted_at })),
      });
    }

    if (body.op === "request") {
      const kind = body.kind as Kind;
      if (!KINDS.includes(kind)) return json({ error: "Unknown request type" }, 400);
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 5) return json({ error: "Give a reason (a sentence is enough)" }, 400);
      const s = await shape(db, kind, (body.payload ?? {}) as Record<string, unknown>);
      const source = body.source === "ai" ? "ai" : "staff";
      const { data: created, error } = await db
        .from("approval_requests")
        .insert({
          kind, source, department: departmentOf(staff), requested_by: staff.id,
          target_profile: s.profile, target_property: s.property, title: s.title, payload: s.payload, reason,
          ai_rationale: source === "ai" ? String(body.aiRationale ?? "").slice(0, 2000) || null : null,
        })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 400);
      await db.rpc("log_record_event", {
        p_department: "super_admin", p_entity_type: "approval", p_entity_id: created.id, p_action: "approval_requested",
        p_summary: `${source === "ai" ? "AI suggested" : "Requested"}: ${s.title} — ${reason}`,
        p_profile: s.profile, p_property: s.property, p_approval: created.id, p_actor: staff.id,
      });
      // a Super Admin acting directly approves their own request in one step
      if (staff.is_admin && body.decideNow === true) {
        return json({ id: created.id, ...(await decide(db, staff, created.id, true, "Super Admin action")) });
      }
      await db.rpc("notify_department", {
        p_department: "super_admin", p_owner: null, p_kind: "approval_requested",
        p_title: `Approval needed: ${s.title}`, p_detail: `From ${staff.email} — ${reason}`,
        p_entity_type: "approval", p_entity_id: created.id, p_lead: null,
      });
      return json({ id: created.id, status: "pending" });
    }

    if (body.op === "decide") {
      if (!staff.is_admin) return json({ error: "Only a Super Admin can approve" }, 403);
      return json(await decide(db, staff, String(body.id), body.approve === true, body.note ? String(body.note).slice(0, 1000) : null));
    }

    if (body.op === "cancel") {
      const { data: a } = await db.from("approval_requests").select("requested_by, status, title").eq("id", String(body.id)).maybeSingle();
      if (!a || a.status !== "pending") return json({ error: "Nothing to cancel" }, 400);
      if (a.requested_by !== staff.id && !staff.is_admin) return json({ error: "not authorized" }, 403);
      await db.from("approval_requests").update({ status: "cancelled", decided_by: staff.id, decided_at: new Date().toISOString() }).eq("id", String(body.id));
      return json({ status: "cancelled" });
    }
    return json({ error: "Unknown op" }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 400);
  }
}
