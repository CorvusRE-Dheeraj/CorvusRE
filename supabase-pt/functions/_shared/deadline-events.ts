// Shared by send-deadline-reminders. Deno-side reimplementation of
// getCalendarEvents() in src/lib/tax-calendar.ts — same duplication tradeoff
// already accepted by _shared/google-calendar-sync.ts and calendar-feed's
// ICS builder (their own comments explain why: the browser supabase-js
// client isn't usable here). This is the 4th copy; keep it in sync by hand
// with tax-calendar.ts if the underlying event logic ever changes.
//
// Deliberately NOT a reuse of google-calendar-sync.ts's buildUserEvents():
// that function has no "resolved" concept (e.g. it still emits a
// tax_penalty event for a bill that's already been paid), which is fine for
// a Google Calendar entry nobody's forced to look at, but wrong for an
// unprompted SMS/email telling someone about a deadline they've already
// handled. This mirrors tax-calendar.ts's real resolved semantics instead —
// each event is only reminder-eligible while resolved is false.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type DeadlineEvent = {
  // Stable across runs and across a date changing on the same underlying
  // row — this is what dedup keys off in send-deadline-reminders, NOT the
  // date, so "3 properties, same key, different dates over time" all reuse
  // one lineage of sent-reminder rows.
  key: string;
  date: string; // ISO date (YYYY-MM-DD)
  title: string;
  amount: number | null;
  resolved: boolean;
};

function toIsoDate(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

// Calendar-date comparison, not an instant comparison — these are all
// all-day events, so "past" must mean "before today's date," not "before
// this exact moment." A plain `new Date(date) < new Date()` is true from
// midnight UTC on, which for anyone west of UTC (and for a cron run any
// time after 00:00 UTC) would mark TODAY's own date as already past —
// silently killing the "on the day of" (offset 0) reminder for every event,
// which is the whole point of this function existing.
function isPast(date: string, todayIso: string): boolean {
  return toIsoDate(date) < todayIso;
}

export async function buildDeadlineEvents(
  admin: SupabaseClient,
  userId: string,
): Promise<DeadlineEvent[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [{ data: properties }, { data: protests }, { data: taxBills }, { data: bppAccounts }, { data: reminders }] =
    await Promise.all([
      admin
        .from("properties")
        .select("id, address, protest_deadline, payment_due_date, tax_amount_due, paid_at")
        .eq("user_id", userId),
      admin
        .from("protests")
        .select(
          "id, property_id, bpp_account_id, status, hearing_date, hearing_time, hearing_location, arb_decision_date, informal_status, informal_review_date, tax_year",
        )
        .eq("user_id", userId),
      admin
        .from("tax_bills")
        .select(
          "id, property_id, tax_year, amount_due, due_date, penalty_date, paid_at, refund_amount, refund_expected_at, refund_received_at",
        )
        .eq("user_id", userId),
      admin
        .from("bpp_accounts")
        .select(
          "id, business_name, protest_deadline, rendered_value, notice_value, rendition_filed_at",
        )
        .eq("user_id", userId),
      admin
        .from("user_reminders")
        .select("id, property_id, remind_on, note, done")
        .eq("user_id", userId),
    ]);

  type Row = Record<string, unknown>;
  const propertyById = new Map(((properties ?? []) as Row[]).map((p) => [p.id as string, p]));
  const bppAccountById = new Map(((bppAccounts ?? []) as Row[]).map((a) => [a.id as string, a]));
  const taxBillPropertyIds = new Set(((taxBills ?? []) as Row[]).map((b) => b.property_id as string));
  const events: DeadlineEvent[] = [];

  for (const p of (properties ?? []) as Row[]) {
    const id = p.id as string;
    const address = p.address as string;
    if (p.protest_deadline) {
      const date = toIsoDate(p.protest_deadline as string);
      events.push({
        key: `protest-deadline:${id}`,
        date,
        title: `Protest deadline — ${address}`,
        amount: null,
        resolved: isPast(date, todayIso),
      });
    }
    if (p.payment_due_date && !taxBillPropertyIds.has(id)) {
      const date = toIsoDate(p.payment_due_date as string);
      events.push({
        key: `tax-due:property:${id}`,
        date,
        title: `Tax bill due — ${address}`,
        amount: p.tax_amount_due as number | null,
        resolved: !!p.paid_at,
      });
    }
  }

  for (const pr of (protests ?? []) as Row[]) {
    const id = pr.id as string;
    // A protest is either property- or BPP-subject (protests_subject_check
    // in schema.sql), never both — label whichever one this is instead of
    // falling back to a generic "your property" for a BPP case.
    const address = pr.property_id
      ? ((propertyById.get(pr.property_id as string)?.address as string) ?? "your property")
      : ((bppAccountById.get(pr.bpp_account_id as string)?.business_name as string) ?? "your account");
    if (pr.informal_status === "scheduled" && pr.informal_review_date) {
      const date = toIsoDate(pr.informal_review_date as string);
      events.push({
        key: `informal-review:${id}`,
        date,
        title: `Informal review — ${address}`,
        amount: null,
        resolved: isPast(date, todayIso),
      });
    }
    if (pr.status === "hearing_scheduled" && pr.hearing_date) {
      const date = toIsoDate(pr.hearing_date as string);
      const parts = [`ARB hearing — ${address}`];
      if (pr.hearing_time) parts.push(`at ${pr.hearing_time as string}`);
      if (pr.hearing_location) parts.push(`(${pr.hearing_location as string})`);
      events.push({
        key: `hearing:${id}`,
        date,
        title: parts.join(" "),
        amount: null,
        resolved: isPast(date, todayIso),
      });
    }
  }

  for (const bill of (taxBills ?? []) as Row[]) {
    const id = bill.id as string;
    const address =
      (propertyById.get(bill.property_id as string)?.address as string) ?? "your property";
    const yearLabel = bill.tax_year ? ` (${bill.tax_year})` : "";
    if (bill.due_date) {
      events.push({
        key: `tax-due:bill:${id}`,
        date: toIsoDate(bill.due_date as string),
        title: `Tax bill due${yearLabel} — ${address}`,
        amount: bill.amount_due as number | null,
        resolved: !!bill.paid_at,
      });
    }
    if (bill.penalty_date) {
      const date = toIsoDate(bill.penalty_date as string);
      events.push({
        key: `tax-penalty:${id}`,
        date,
        title: `Penalty date${yearLabel} — ${address}`,
        amount: null,
        resolved: !!bill.paid_at || isPast(date, todayIso),
      });
    }
    if (bill.refund_expected_at) {
      events.push({
        key: `refund:${id}`,
        date: toIsoDate(bill.refund_expected_at as string),
        title: `Refund expected${yearLabel} — ${address}`,
        amount: bill.refund_amount as number | null,
        resolved: !!bill.refund_received_at,
      });
    }
  }

  for (const account of (bppAccounts ?? []) as Row[]) {
    const id = account.id as string;
    const businessName = account.business_name as string;
    const needsProtest =
      account.notice_value != null &&
      account.rendered_value != null &&
      account.notice_value !== account.rendered_value;
    if (account.protest_deadline && needsProtest) {
      const date = toIsoDate(account.protest_deadline as string);
      events.push({
        key: `bpp-protest-deadline:${id}`,
        date,
        title: `BPP protest deadline — ${businessName}`,
        amount: null,
        resolved: isPast(date, todayIso),
      });
    }
  }

  for (const r of (reminders ?? []) as Row[]) {
    const id = r.id as string;
    const propertyId = r.property_id as string | null;
    const label = propertyId ? (propertyById.get(propertyId)?.address as string) : null;
    events.push({
      key: `reminder:${id}`,
      date: toIsoDate(r.remind_on as string),
      title: label ? `Reminder — ${r.note as string} (${label})` : `Reminder — ${r.note as string}`,
      amount: null,
      resolved: !!r.done,
    });
  }

  return events;
}
