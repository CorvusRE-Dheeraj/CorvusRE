// Served by the bd-console function as ?module=support (Supabase allows 100
// functions per project — this one shares bd-console's slot; bd-console is
// --no-verify-jwt, which the signed-out ticket-feedback action needs; every
// other action checks the caller itself). Cron: POST …/bd-console?module=support
// with {"mode":"overdue"} / {"mode":"weekly"}.
//
// The Customer Support Admin console's server side (see supabase/pt/
// support-console.sql for roles, tables and the Super Admin switches).
//
//   AI (Gemini) — answers only from the approved knowledge base
//   (support_knowledge) and the customer data the CALLER can see (read with
//   the caller's own token through the support RPCs, never the service role):
//     ai_ticket       categorize + prioritize + summarize a ticket
//     ai_draft        draft a customer reply (staff review it before sending)
//     ai_customer     summarize a customer, the onboarding gaps, follow-ups
//     ai_insights     recurring problems, overloaded staff, customers needing attention
//     ai_ask          the AI workspace: a question, optionally about one customer
//   Communications — every message lands in the customer's timeline:
//     send_reply      email a reviewed reply on a ticket
//     send_template   email an approved template (onboarding reminder, upload
//                     request, correction request …)
//   Billing (Stripe; card brand + last 4 only, never a full card number):
//     billing         plan, subscriptions, invoices, payments
//     resend_invoice  (support_permissions.resend_invoices)
//     payment_link    (support_permissions.send_payment_links)
//     apply_discount  an approved discount policy (support_permissions.policy_discounts)
//     cancel_by_policy  the plan's own cancellation rules (policy_cancellations)
//   Documents:
//     doc_url         open a customer's file (support_permissions.view_documents)
//   Public (no sign-in):
//     ticket_feedback  a customer's 1–5 rating from the resolved-ticket email
//   Cron (service role, {"mode":"overdue"} hourly / {"mode":"weekly"}):
//     overdue alerts to the assignee (or supervisors), weekly team summary
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { GEMINI_MODEL_FAST, geminiUrl } from "../gemini.ts";
import { appBaseUrl } from "../app-url.ts";
import { emailShell, escapeHtml } from "../email-shell.ts";
import { getStripeMode, stripeSecretKey } from "../stripe-mode.ts";
import { cancelDecision } from "../commitment.ts";
import { PRICING_VERSION } from "../pricing.ts";
import { portalConfiguration } from "../billing-portal.ts";
import { isServiceRoleRequest } from "../service-role-only.ts";
import { rateLimitUser } from "../rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: corsHeaders });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Staff = {
  id: string;
  email: string;
  name: string;
  isSuper: boolean;
  isSupport: boolean;
  isSupervisor: boolean;
};

const CATEGORIES = ["onboarding", "billing", "documents", "protest", "deadlines", "pay_taxes", "account", "technical", "other"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── AI ─────────────────────────────────────────────────────────────────────

async function gemini(system: string, user: string, timeoutMs = 45_000): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    if (res.status === 429) throw new HttpError(429, "AI is busy — please try again in a moment.");
    throw new Error(`Gemini API error ${res.status}`);
  }
  const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = out.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

const RULES = `You assist CorvusPT's Customer Support team (a Texas property-tax protest platform).
Hard rules:
- Use ONLY the knowledge base and the customer data provided. If they don't answer the question, say so and recommend escalating — never guess at policies, prices, dates or legal outcomes.
- Support explains platform steps and asks for information. Support must never change a property's value, accept or reject a settlement offer, or decide whether or what to file; anything needing that judgment is escalated to Operations. Refunds, pricing exceptions and plan-term changes need Super Admin approval — say a request will be reviewed, never promise one.
- Never include card numbers, passwords or internal notes in anything addressed to the customer.
- Plain, warm, short sentences.`;

async function knowledge(db: SupabaseClient): Promise<string> {
  const { data } = await db.from("support_knowledge").select("kind, title, body").eq("active", true).order("kind");
  return (data ?? []).map((k) => `[${k.kind}] ${k.title}\n${k.body}`).join("\n\n");
}

// The customer as the CALLER is allowed to see them, trimmed for a prompt.
async function customerContext(caller: SupabaseClient, profileId: string): Promise<string> {
  const { data, error } = await caller.rpc("support_customer_detail", { p_profile: profileId });
  if (error) throw new HttpError(403, error.message);
  const d = (data ?? {}) as Record<string, unknown>;
  const props = ((d.properties as Record<string, unknown>[]) ?? []).map((p) => ({
    id: p.id,
    address: p.address,
    cad: p.cad,
    taxYear: p.tax_year,
    owner: p.owner_name,
    account: p.account_number,
    value: p.total_value,
    protestDeadline: p.protest_deadline,
    subscription: p.subscription_status,
    plan: p.plan_tier,
    verification: p.verification_status,
    verificationFlags: p.verification_flags,
  }));
  const protests = ((d.protests as Record<string, unknown>[]) ?? []).map((p) => ({
    propertyId: p.property_id,
    status: p.status,
    hearingDate: p.hearing_date,
    informal: p.informal_status,
    decision: p.arb_decision,
  }));
  const docs = ((d.documents as Record<string, unknown>[]) ?? [])
    .filter((x) => !x.deletedAt)
    .slice(0, 25)
    .map((x) => ({ file: x.fileName, type: x.type, ai: x.aiVerdict, notes: x.aiNotes, verification: x.verificationStatus, flags: x.verificationFlags }));
  return JSON.stringify(
    {
      profile: d.profile,
      onboarding: (d.onboarding as Record<string, unknown>)?.steps,
      packetSigned: d.packetSigned,
      properties: props,
      protests,
      bills: d.bills,
      documents: docs,
      tickets: d.tickets,
      recentHistory: ((d.events as unknown[]) ?? []).slice(0, 25),
      subscriptionEvents: ((d.subscriptionEvents as unknown[]) ?? []).slice(0, 10),
    },
    null,
    1,
  ).slice(0, 60_000);
}

async function ticketContext(caller: SupabaseClient, ticketId: string) {
  const { data: t, error } = await caller.from("support_tickets").select("*").eq("id", ticketId).maybeSingle();
  if (error || !t) throw new HttpError(404, "Ticket not found");
  const { data: msgs } = await caller
    .from("support_ticket_messages")
    .select("kind, body, created_at, ai_drafted")
    .eq("ticket_id", ticketId)
    .order("created_at");
  return { ticket: t as Record<string, unknown>, messages: msgs ?? [] };
}

// ── email ──────────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, text: string, opts: { cta?: { label: string; href: string } } = {}) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  const html = emailShell({
    eyebrow: "CorvusPT Support",
    heading: subject,
    intro: escapeHtml(text).replace(/\n/g, "<br/>"),
    ...(opts.cta ? { ctaLabel: opts.cta.label, ctaHref: opts.cta.href } : {}),
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "CorvusPT Support <info@corvusre.com>",
      reply_to: "info@corvusre.com",
      to: [to],
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

function fill(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v == null || v === "" ? "" : String(v);
  });
}

async function customerContact(admin: SupabaseClient, profileId: string) {
  const { data } = await admin.from("profiles").select("id, email, first_name, last_name").eq("id", profileId).maybeSingle();
  if (!data?.email) throw new HttpError(400, "This customer has no email address on file.");
  return { email: data.email as string, firstName: (data.first_name as string | null) ?? "there" };
}

async function logEvent(
  admin: SupabaseClient,
  me: Staff,
  e: { entity: string; entityId?: string | null; action: string; summary: string; profile?: string | null; property?: string | null; after?: unknown },
) {
  await admin.rpc("log_record_event", {
    p_department: "support",
    p_entity_type: e.entity,
    p_entity_id: e.entityId ?? null,
    p_action: e.action,
    p_summary: e.summary,
    p_profile: e.profile ?? null,
    p_property: e.property ?? null,
    p_after: e.after ?? null,
    p_actor: me.id,
  });
}

async function can(admin: SupabaseClient, me: Staff, key: string): Promise<boolean> {
  if (me.isSuper) return true;
  const { data } = await admin.from("support_permissions").select("enabled").eq("key", key).maybeSingle();
  return !!data?.enabled;
}
async function requirePermission(admin: SupabaseClient, me: Staff, key: string, what: string) {
  if (!(await can(admin, me, key))) {
    throw new HttpError(403, `${what} isn't switched on for Support — a Super Admin can allow it in Support → Settings.`);
  }
}

// ── Stripe ─────────────────────────────────────────────────────────────────

async function stripeFor(admin: SupabaseClient, profileId: string) {
  const { data: p } = await admin.from("profiles").select("stripe_customer_id").eq("id", profileId).maybeSingle();
  const mode = await getStripeMode(profileId);
  const stripe = new Stripe(stripeSecretKey(mode), { apiVersion: "2025-02-24.acacia" });
  return { stripe, mode, customer: (p?.stripe_customer_id as string | null) ?? null };
}

async function billingOverview(admin: SupabaseClient, profileId: string) {
  const { data: props } = await admin
    .from("properties")
    .select("id, address, stripe_subscription_id, subscription_status, plan_tier, cancel_at, cancel_at_period_end")
    .eq("user_id", profileId);
  const { data: bpps } = await admin
    .from("bpp_accounts")
    .select("id, business_name, stripe_subscription_id, subscription_status, plan_tier")
    .eq("user_id", profileId);
  const { stripe, mode, customer } = await stripeFor(admin, profileId);
  const covered = [
    ...(props ?? []).map((p) => ({ kind: "property", id: p.id, label: p.address, subscriptionId: p.stripe_subscription_id, status: p.subscription_status, plan: p.plan_tier })),
    ...(bpps ?? []).map((b) => ({ kind: "bpp", id: b.id, label: b.business_name, subscriptionId: b.stripe_subscription_id, status: b.subscription_status, plan: b.plan_tier })),
  ];
  if (!customer) return { mode, customer: null, covered, subscriptions: [], invoices: [], payments: [] };
  const [subs, invoices, charges] = await Promise.all([
    stripe.subscriptions.list({ customer, status: "all", limit: 50 }),
    stripe.invoices.list({ customer, limit: 30 }),
    stripe.charges.list({ customer, limit: 30 }),
  ]);
  const labelFor = (subId: string) => covered.find((c) => c.subscriptionId === subId)?.label ?? null;
  return {
    mode,
    customer,
    covered,
    subscriptions: subs.data.map((s) => {
      const price = s.items.data[0]?.price;
      return {
        id: s.id,
        covers: labelFor(s.id),
        status: s.status,
        interval: price?.recurring?.interval ?? null,
        amountCents: price?.unit_amount ?? null,
        startedAt: new Date(s.start_date * 1000).toISOString(),
        currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
        cancelAt: s.cancel_at ? new Date(s.cancel_at * 1000).toISOString() : null,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        committed: s.metadata?.pricing === PRICING_VERSION && price?.recurring?.interval === "month",
        discount: s.discount?.coupon ? (s.discount.coupon.name ?? s.discount.coupon.id) : null,
      };
    }),
    invoices: invoices.data.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      amountDueCents: i.amount_due,
      amountPaidCents: i.amount_paid,
      createdAt: new Date(i.created * 1000).toISOString(),
      dueAt: i.due_date ? new Date(i.due_date * 1000).toISOString() : null,
      covers: typeof i.subscription === "string" ? labelFor(i.subscription) : null,
      url: i.hosted_invoice_url,
      attempts: i.attempt_count,
    })),
    // brand + last 4 only — full card numbers are never available here
    payments: charges.data.map((c) => ({
      id: c.id,
      amountCents: c.amount,
      refundedCents: c.amount_refunded,
      status: c.status,
      createdAt: new Date(c.created * 1000).toISOString(),
      card: c.payment_method_details?.card
        ? `${c.payment_method_details.card.brand} •••• ${c.payment_method_details.card.last4}`
        : (c.payment_method_details?.type ?? null),
      failure: c.failure_message,
      receiptUrl: c.receipt_url,
    })),
  };
}

// ── handlers ───────────────────────────────────────────────────────────────

async function staffFrom(req: Request, admin: SupabaseClient): Promise<{ me: Staff; caller: SupabaseClient }> {
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) throw new HttpError(401, "unauthenticated");
  const { data: p } = await admin
    .from("profiles")
    .select("id, email, first_name, last_name, is_admin, support_admin, support_supervisor")
    .eq("id", user.id)
    .maybeSingle();
  if (!p || !(p.is_admin || p.support_admin)) throw new HttpError(403, "Customer Support access only.");
  return {
    caller,
    me: {
      id: p.id,
      email: p.email,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email,
      isSuper: !!p.is_admin,
      isSupport: !!(p.support_admin || p.is_admin),
      isSupervisor: !!(p.is_admin || (p.support_admin && p.support_supervisor)),
    },
  };
}

async function handleStaff(action: string, body: Record<string, unknown>, me: Staff, caller: SupabaseClient, admin: SupabaseClient) {
  const appUrl = appBaseUrl();
  switch (action) {
    case "ai_ticket": {
      const { ticket, messages } = await ticketContext(caller, String(body.ticketId));
      const out = await gemini(
        `${RULES}\nClassify a support ticket. Return ONLY JSON: {"category": one of ${JSON.stringify(CATEGORIES)}, "priority": one of ${JSON.stringify(PRIORITIES)} (urgent = a deadline within days or the customer can't use the product; high = money or a deadline at risk), "summary": <2-3 sentence summary of the conversation so far>, "needsSpecialist": <true if this needs Operations / a Super Admin rather than Support>, "specialistReason": <short reason or null>}`,
        JSON.stringify({ subject: ticket.subject, messages: messages.filter((m) => m.kind !== "internal_note") }),
      );
      const category = CATEGORIES.includes(String(out.category)) ? String(out.category) : "other";
      const priority = PRIORITIES.includes(String(out.priority)) ? String(out.priority) : "normal";
      const summary = typeof out.summary === "string" ? out.summary.slice(0, 1200) : null;
      const patch: Record<string, unknown> = { ai_summary: summary, ai_summary_at: new Date().toISOString() };
      if (!ticket.category) patch.category = category;
      await caller.from("support_tickets").update(patch).eq("id", ticket.id);
      return { category, priority, summary, needsSpecialist: out.needsSpecialist === true, specialistReason: out.specialistReason ?? null };
    }
    case "ai_draft": {
      const { ticket, messages } = await ticketContext(caller, String(body.ticketId));
      const kb = await knowledge(caller);
      const cust = ticket.profile_id ? await customerContext(caller, ticket.profile_id as string) : "(no customer linked)";
      const out = await gemini(
        `${RULES}\nDraft the next reply to the customer on this ticket. Return ONLY JSON: {"reply": <the email body, greeting to sign-off, signed "The CorvusPT Support team">, "followUps": [<up to 3 short follow-up actions for the staff member>], "needsSpecialist": <true if the honest answer needs Operations or a Super Admin>, "specialist": <"operations" | "super_admin" | null>, "reason": <why, or null>, "sources": [<titles of the knowledge-base entries used>]}`,
        `KNOWLEDGE BASE:\n${kb}\n\nCUSTOMER:\n${cust}\n\nTICKET: #${ticket.number} ${ticket.subject} (category ${ticket.category ?? "?"})\nCONVERSATION (internal notes are for context only — never quote them):\n${messages
          .map((m) => `[${m.kind}] ${m.body}`)
          .join("\n---\n")}\n\nSTAFF INSTRUCTION: ${String(body.instruction ?? "") || "(none)"}`,
      );
      return {
        reply: String(out.reply ?? ""),
        followUps: Array.isArray(out.followUps) ? out.followUps.slice(0, 3) : [],
        needsSpecialist: out.needsSpecialist === true,
        specialist: out.specialist ?? null,
        reason: out.reason ?? null,
        sources: Array.isArray(out.sources) ? out.sources : [],
      };
    }
    case "ai_customer": {
      const profileId = String(body.profileId);
      const [kb, cust] = await Promise.all([knowledge(caller), customerContext(caller, profileId)]);
      const out = await gemini(
        `${RULES}\nSummarize this customer for a Support staff member. Return ONLY JSON: {"summary": <3-4 sentences: who they are, where each property is in its journey, anything wrong>, "incompleteSteps": [{"step": <the onboarding step not done>, "recommendation": <how Support can help, one sentence>}], "followUps": [<up to 4 concrete next actions for Support>], "risks": [{"property": <address or null>, "risk": <a blocked step or a deadline at risk, one sentence>, "severity": "high" | "medium" | "low"}], "conflicts": [{"property": <address or null>, "field": <address | account number | value | date | owner>, "detail": <what disagrees between a document and the record — flag it, never pick a value>}]}`,
        `KNOWLEDGE BASE:\n${kb}\n\nCUSTOMER:\n${cust}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`,
      );
      return {
        summary: String(out.summary ?? ""),
        incompleteSteps: Array.isArray(out.incompleteSteps) ? out.incompleteSteps : [],
        followUps: Array.isArray(out.followUps) ? out.followUps : [],
        risks: Array.isArray(out.risks) ? out.risks : [],
        conflicts: Array.isArray(out.conflicts) ? out.conflicts : [],
      };
    }
    case "ai_insights": {
      const from = String(body.from ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
      const to = String(body.to ?? new Date().toISOString().slice(0, 10));
      const { data: stats, error } = await caller.rpc("support_analytics", { p_from: from, p_to: to, p_staff: null });
      if (error) throw new HttpError(403, error.message);
      const { data: recent } = await caller
        .from("support_tickets")
        .select("number, subject, category, priority, status, created_at, due_at, first_response_at, assigned_to, profile_id")
        .gte("created_at", from)
        .order("created_at", { ascending: false })
        .limit(200);
      const { data: dash } = await caller.rpc("support_dashboard");
      const out = await gemini(
        `${RULES}\nYou analyse the Support team's work for a supervisor. Return ONLY JSON: {"recurring": [{"problem": <a recurring customer problem>, "count": <tickets>, "suggestion": <product or process fix>}], "overloaded": [{"staff": <name>, "why": <evidence from the numbers>}], "attention": [{"customer": <name or ticket number>, "why": <one sentence>}], "headline": <one-sentence summary of the period>}`,
        JSON.stringify({ period: { from, to }, stats, tickets: recent, dashboard: dash }).slice(0, 80_000),
      );
      return out;
    }
    case "ai_ask": {
      const kb = await knowledge(caller);
      const cust = body.profileId ? await customerContext(caller, String(body.profileId)) : null;
      const out = await gemini(
        `${RULES}\nAnswer a Support staff member's question. Return ONLY JSON: {"answer": <the answer, for the staff member>, "customerDraft": <if useful, a short message they could send the customer, else null>, "sources": [<knowledge-base titles used>], "escalate": <true if this needs a specialist>, "escalateTo": <"operations" | "super_admin" | null>}`,
        `KNOWLEDGE BASE:\n${kb}\n\n${cust ? `CUSTOMER:\n${cust}\n\n` : ""}QUESTION: ${String(body.question ?? "").slice(0, 2000)}`,
      );
      return out;
    }

    case "send_reply": {
      const { ticket } = await ticketContext(caller, String(body.ticketId));
      const text = String(body.body ?? "").trim();
      if (text.length < 2) throw new HttpError(400, "Write the reply first.");
      if (!ticket.profile_id) throw new HttpError(400, "Link this ticket to a customer before replying.");
      const c = await customerContact(admin, ticket.profile_id as string);
      const subject = `Re: ${ticket.subject} (#${ticket.number})`;
      let sendError: string | null = null;
      try {
        await sendEmail(c.email, subject, text);
      } catch (e) {
        sendError = e instanceof Error ? e.message : "send failed";
      }
      await admin.from("support_ticket_messages").insert({
        ticket_id: ticket.id,
        author_id: me.id,
        kind: "customer_reply",
        body: text,
        ai_drafted: body.aiDrafted === true,
        sent_at: sendError ? null : new Date().toISOString(),
        send_error: sendError,
      });
      if (sendError) throw new HttpError(502, `The reply was saved but the email didn't send: ${sendError}`);
      if (body.status && ["waiting_on_customer", "resolved", "in_progress"].includes(String(body.status))) {
        await caller.from("support_tickets").update({ status: body.status }).eq("id", ticket.id);
      }
      return { ok: true };
    }
    case "send_template": {
      const profileId = String(body.profileId ?? "");
      const { data: tpl } = await admin
        .from("support_templates")
        .select("*")
        .or(`key.eq.${String(body.template ?? "")},id.eq.${/^[0-9a-f-]{36}$/.test(String(body.template)) ? body.template : "00000000-0000-0000-0000-000000000000"}`)
        .maybeSingle();
      if (!tpl) throw new HttpError(400, "Pick a template.");
      if (!tpl.approved) throw new HttpError(403, "That template isn't approved yet.");
      const c = await customerContact(admin, profileId);
      let address: string | null = null;
      if (body.propertyId) {
        const { data: prop } = await admin.from("properties").select("address, user_id").eq("id", String(body.propertyId)).maybeSingle();
        if (!prop || prop.user_id !== profileId) throw new HttpError(400, "That property isn't on this customer's account.");
        address = prop.address as string;
      }
      const link =
        tpl.purpose === "documents" || tpl.purpose === "correction"
          ? `${appUrl}/dashboard/documents`
          : tpl.purpose === "onboarding"
            ? `${appUrl}/dashboard`
            : `${appUrl}/dashboard`;
      const vars = {
        first_name: c.firstName,
        next_step: String(body.nextStep ?? ""),
        issue: String(body.issue ?? ""),
        property_address: address ?? "your property",
        link: String(body.link ?? link),
        ticket: body.ticketNumber ? String(body.ticketNumber) : "",
      };
      const subject = fill(tpl.subject, vars);
      const text = fill(tpl.body, vars);
      await sendEmail(c.email, subject, text, { cta: { label: "Open CorvusPT", href: vars.link } });
      if (tpl.purpose === "onboarding") {
        const { data: o } = await admin.from("support_onboarding").select("reminders_sent").eq("profile_id", profileId).maybeSingle();
        await admin.from("support_onboarding").upsert(
          { profile_id: profileId, last_reminder_at: new Date().toISOString(), reminders_sent: ((o?.reminders_sent as number) ?? 0) + 1, updated_at: new Date().toISOString() },
          { onConflict: "profile_id" },
        );
      }
      if (body.ticketId) {
        await admin.from("support_ticket_messages").insert({
          ticket_id: String(body.ticketId), author_id: me.id, kind: "customer_reply", body: text, sent_at: new Date().toISOString(), automated: false,
        });
      }
      await logEvent(admin, me, {
        entity: tpl.purpose === "onboarding" ? "onboarding" : "communication",
        action: `template_${tpl.key ?? "custom"}`,
        summary: `${me.name} emailed "${tpl.name}"${address ? ` — ${address}` : ""}`,
        profile: profileId,
        property: (body.propertyId as string) ?? null,
        after: { subject, issue: vars.issue || null, next_step: vars.next_step || null },
      });
      return { ok: true, subject };
    }

    case "billing": {
      const profileId = String(body.profileId ?? "");
      // only for someone this caller can see as a customer
      const { error } = await caller.rpc("support_customer_detail", { p_profile: profileId });
      if (error) throw new HttpError(403, error.message);
      const overview = await billingOverview(admin, profileId);
      const { data: policies } = await admin.from("support_discount_policies").select("id, label, description").eq("active", true);
      return {
        ...overview,
        permissions: {
          resendInvoices: await can(admin, me, "resend_invoices"),
          paymentLinks: await can(admin, me, "send_payment_links"),
          discounts: await can(admin, me, "policy_discounts"),
          cancellations: await can(admin, me, "policy_cancellations"),
        },
        discountPolicies: policies ?? [],
      };
    }
    case "resend_invoice": {
      await requirePermission(admin, me, "resend_invoices", "Resending invoices");
      const profileId = String(body.profileId ?? "");
      const { stripe, customer } = await stripeFor(admin, profileId);
      const inv = await stripe.invoices.retrieve(String(body.invoiceId ?? ""));
      if (!customer || inv.customer !== customer) throw new HttpError(400, "That invoice isn't this customer's.");
      if (inv.status === "open") {
        await stripe.invoices.sendInvoice(inv.id);
      } else {
        const c = await customerContact(admin, profileId);
        await sendEmail(
          c.email,
          `Your CorvusPT invoice ${inv.number ?? ""}`.trim(),
          `Hi ${c.firstName},\n\nHere is your invoice ${inv.number ?? ""} for ${usd(inv.amount_due)} (${inv.status}).\n\nThe CorvusPT Support team`,
          inv.hosted_invoice_url ? { cta: { label: "View invoice", href: inv.hosted_invoice_url } } : {},
        );
      }
      await logEvent(admin, me, { entity: "billing", action: "invoice_resent", summary: `${me.name} re-sent invoice ${inv.number ?? inv.id}`, profile: profileId });
      return { ok: true };
    }
    case "payment_link": {
      await requirePermission(admin, me, "send_payment_links", "Sending payment links");
      const profileId = String(body.profileId ?? "");
      const { stripe, customer } = await stripeFor(admin, profileId);
      if (!customer) throw new HttpError(400, "This customer has no billing account yet.");
      let url: string | null = null;
      if (body.invoiceId) {
        const inv = await stripe.invoices.retrieve(String(body.invoiceId));
        if (inv.customer !== customer) throw new HttpError(400, "That invoice isn't this customer's.");
        if (inv.status === "open") url = inv.hosted_invoice_url ?? null;
      }
      if (!url) {
        const session = await stripe.billingPortal.sessions.create({
          customer,
          return_url: `${appUrl}/dashboard/billing`,
          configuration: await portalConfiguration(stripe),
        });
        url = session.url;
      }
      const { data: tpl } = await admin.from("support_templates").select("subject, body").eq("key", "payment_link").maybeSingle();
      const c = await customerContact(admin, profileId);
      const vars = { first_name: c.firstName, link: url };
      await sendEmail(c.email, fill(tpl?.subject ?? "Update your CorvusPT payment", vars), fill(tpl?.body ?? "Update your payment: {{link}}", vars), {
        cta: { label: "Update payment", href: url },
      });
      await logEvent(admin, me, { entity: "billing", action: "payment_link_sent", summary: `${me.name} emailed a secure payment link`, profile: profileId });
      return { ok: true };
    }
    case "apply_discount": {
      await requirePermission(admin, me, "policy_discounts", "Applying discounts");
      const profileId = String(body.profileId ?? "");
      const { data: policy } = await admin.from("support_discount_policies").select("*").eq("id", String(body.policyId ?? "")).eq("active", true).maybeSingle();
      if (!policy) throw new HttpError(400, "Pick an approved discount policy. Anything else needs a pricing-exception approval.");
      const { data: prop } = await admin.from("properties").select("id, address, user_id, stripe_subscription_id").eq("id", String(body.propertyId ?? "")).maybeSingle();
      if (!prop || prop.user_id !== profileId || !prop.stripe_subscription_id) throw new HttpError(400, "Pick one of this customer's subscribed properties.");
      const { stripe } = await stripeFor(admin, profileId);
      await stripe.subscriptions.update(prop.stripe_subscription_id, { discounts: [{ coupon: policy.stripe_coupon_id }] });
      await logEvent(admin, me, {
        entity: "billing", action: "policy_discount_applied", summary: `${me.name} applied "${policy.label}" — ${prop.address}`,
        profile: profileId, property: prop.id, after: { policy: policy.label, coupon: policy.stripe_coupon_id },
      });
      return { ok: true };
    }
    case "cancel_by_policy": {
      await requirePermission(admin, me, "policy_cancellations", "Cancelling by policy");
      const profileId = String(body.profileId ?? "");
      const { data: prop } = await admin.from("properties").select("id, address, user_id, stripe_subscription_id").eq("id", String(body.propertyId ?? "")).maybeSingle();
      if (!prop || prop.user_id !== profileId || !prop.stripe_subscription_id) throw new HttpError(400, "Pick one of this customer's subscribed properties.");
      if (String(body.reason ?? "").trim().length < 5) throw new HttpError(400, "Say why the customer is cancelling.");
      const { stripe } = await stripeFor(admin, profileId);
      const sub = await stripe.subscriptions.retrieve(prop.stripe_subscription_id);
      const interval = sub.items.data[0]?.price.recurring?.interval === "month" ? "month" : "year";
      const committed = sub.metadata?.pricing === PRICING_VERSION && interval === "month";
      const decision = committed ? cancelDecision("month", new Date(sub.start_date * 1000)) : ({ allowed: true, endsAt: null, atPeriodEnd: true } as const);
      if (!decision.allowed) {
        return {
          ok: false,
          blocked: true,
          windowOpens: decision.windowOpens.toISOString(),
          windowCloses: decision.windowCloses.toISOString(),
          message: "The plan's 12-month commitment doesn't allow cancelling yet. A subscription-term override needs Super Admin approval.",
        };
      }
      const updated = decision.atPeriodEnd
        ? await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true })
        : await stripe.subscriptions.update(sub.id, { cancel_at: Math.floor(decision.endsAt!.getTime() / 1000) });
      const endsAt = updated.cancel_at ?? (updated.cancel_at_period_end ? updated.current_period_end : null);
      await logEvent(admin, me, {
        entity: "billing", action: "cancel_by_policy",
        summary: `${me.name} scheduled cancellation by policy — ${prop.address}${endsAt ? `; ends ${new Date(endsAt * 1000).toISOString().slice(0, 10)}` : ""}. Reason: ${String(body.reason).slice(0, 200)}`,
        profile: profileId, property: prop.id,
      });
      return { ok: true, endsAt: endsAt ? new Date(endsAt * 1000).toISOString() : null };
    }

    case "doc_url": {
      await requirePermission(admin, me, "view_documents", "Opening customer documents");
      const { data: d } = await admin.from("documents").select("id, user_id, storage_path, file_name, property_id").eq("id", String(body.documentId ?? "")).maybeSingle();
      if (!d) throw new HttpError(404, "Document not found.");
      const { data: signed, error } = await admin.storage.from("documents").createSignedUrl(d.storage_path, 300);
      if (error || !signed) throw new Error(error?.message ?? "Couldn't open the file");
      await logEvent(admin, me, { entity: "document", entityId: d.id, action: "document_opened", summary: `${me.name} opened ${d.file_name}`, profile: d.user_id, property: d.property_id });
      return { url: signed.signedUrl };
    }
  }
  throw new HttpError(400, "Unknown action");
}

// ── cron ───────────────────────────────────────────────────────────────────

async function runCron(mode: string, admin: SupabaseClient) {
  const appUrl = appBaseUrl();
  const nameOf = async (id: string | null) => {
    if (!id) return null;
    const { data } = await admin.from("profiles").select("email, first_name").eq("id", id).maybeSingle();
    return data as { email: string; first_name: string | null } | null;
  };
  const supervisors = async () => {
    const { data } = await admin.from("profiles").select("email, first_name, is_admin, support_admin, support_supervisor").or("is_admin.eq.true,support_supervisor.eq.true");
    return (data ?? []).filter((p) => p.is_admin || (p.support_admin && p.support_supervisor)) as { email: string; first_name: string | null }[];
  };
  if (mode === "overdue") {
    const { data: late } = await admin
      .from("support_tickets")
      .select("id, number, subject, priority, due_at, assigned_to")
      .not("status", "in", "(resolved,closed)")
      .is("first_response_at", null)
      .is("overdue_alerted_at", null)
      .lt("due_at", new Date().toISOString())
      .limit(100);
    let sent = 0;
    const sups = await supervisors();
    for (const t of late ?? []) {
      const assignee = await nameOf(t.assigned_to as string | null);
      const to = assignee ? [assignee] : sups;
      for (const p of to) {
        try {
          await sendEmail(
            p.email,
            `Overdue: ticket #${t.number} — ${t.subject}`.slice(0, 150),
            `Hi ${p.first_name ?? "there"},\n\nTicket #${t.number} (${t.priority}) passed its response deadline (${new Date(t.due_at as string).toUTCString()}) without a reply${assignee ? "" : " and has nobody assigned"}.\n\n${t.subject}`,
            { cta: { label: "Open the ticket", href: `${appUrl}/support?tab=tickets&ticket=${t.id}` } },
          );
          sent++;
        } catch (e) {
          console.error("overdue alert failed", e);
        }
      }
      await admin.from("support_tickets").update({ overdue_alerted_at: new Date().toISOString() }).eq("id", t.id);
    }
    return { mode, overdue: late?.length ?? 0, sent };
  }
  if (mode === "weekly") {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 864e5);
    const { data: t } = await admin.from("support_tickets").select("status, created_at, resolved_at, first_response_at, due_at, rating").gte("created_at", from.toISOString());
    const rows = t ?? [];
    const { count: openNow } = await admin.from("support_tickets").select("id", { count: "exact", head: true }).not("status", "in", "(resolved,closed)");
    const { count: overdueNow } = await admin.from("support_tickets").select("id", { count: "exact", head: true }).not("status", "in", "(resolved,closed)").is("first_response_at", null).lt("due_at", to.toISOString());
    const { data: subEv } = await admin.from("subscription_events").select("kind").gte("created_at", from.toISOString());
    const k = (x: string) => (subEv ?? []).filter((e) => e.kind === x).length;
    const responded = rows.filter((r) => r.first_response_at);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const lines = [
      `Tickets opened: ${rows.length}`,
      `Resolved: ${rows.filter((r) => r.resolved_at).length}`,
      `Open now: ${openNow ?? 0} (overdue: ${overdueNow ?? 0})`,
      `Average first response: ${avg(responded.map((r) => (Date.parse(r.first_response_at as string) - Date.parse(r.created_at as string)) / 36e5)) ?? "—"} hours`,
      `Within the response deadline: ${responded.length ? Math.round((100 * responded.filter((r) => (r.first_response_at as string) <= (r.due_at as string)).length) / responded.length) : "—"}%`,
      `Average rating: ${avg(rows.filter((r) => r.rating).map((r) => r.rating as number)) ?? "—"}`,
      `Renewals: ${k("renewed")} · cancellations: ${k("canceled")} · failed payments: ${k("payment_failed")}`,
    ];
    let sent = 0;
    for (const p of await supervisors()) {
      try {
        await sendEmail(p.email, "CorvusPT Support — weekly summary", `Hi ${p.first_name ?? "there"},\n\nThe last 7 days in Customer Support:\n\n${lines.join("\n")}`, {
          cta: { label: "Open Support analytics", href: `${appUrl}/support?tab=analytics` },
        });
        sent++;
      } catch (e) {
        console.error("weekly summary failed", e);
      }
    }
    return { mode, sent };
  }
  throw new HttpError(400, "Unknown mode");
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (typeof body.mode === "string") {
      if (!isServiceRoleRequest(req)) return json({ error: "forbidden" }, 403);
      return json(await runCron(body.mode, admin));
    }

    const action = String(body.action ?? "");
    if (action === "ticket_feedback") {
      const token = String(body.token ?? "");
      const rating = Number(body.rating);
      if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: "invalid_link" }, 400);
      const { data: t } = await admin.from("support_tickets").select("id, number, subject, rating").eq("feedback_token", token).maybeSingle();
      if (!t) return json({ error: "invalid_link" }, 404);
      if (body.rating == null) return json({ number: t.number, subject: t.subject, rating: t.rating });
      if (!(rating >= 1 && rating <= 5)) return json({ error: "rating must be 1-5" }, 400);
      await admin
        .from("support_tickets")
        .update({ rating, rating_comment: String(body.comment ?? "").slice(0, 1000) || null, rated_at: new Date().toISOString() })
        .eq("id", t.id);
      return json({ ok: true, number: t.number });
    }

    const { me, caller } = await staffFrom(req, admin);
    if (action.startsWith("ai_")) {
      const limited = await rateLimitUser(me.id, "support-ai", 120, corsHeaders);
      if (limited) return limited;
    }
    return json(await handleStaff(action, body, me, caller, admin));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("support-console failed:", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
}
