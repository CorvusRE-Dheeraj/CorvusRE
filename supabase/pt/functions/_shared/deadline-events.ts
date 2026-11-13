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
  /** Short form for an email subject / SMS: "Protest deadline — 1800 Market Place Blvd". */
  subject: string;
  /** A note on the user's calendar (their own or a system one), not a deadline. */
  isReminder?: boolean;
  amount: number | null;
  resolved: boolean;
  // Start time as written on the county notice ("9:00 AM") for hearings / informal
  // reviews that have one; drives the one-hour-before alert. Absent = date-only.
  time?: string | null;
};

// Keep in step with CURRENT_TAX_YEAR / standardTaxDueDate in src/lib/tax-calendar.ts.
const CURRENT_TAX_YEAR = 2026;
function standardTaxDueDate(taxYear: number): string {
  const d = new Date(Date.UTC(taxYear + 1, 0, 31));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
    d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// A property-tax payment deadline — a bill's due date, one installment of a
// payment plan, or a property's own due date when it has no bill on file. These
// get the payment reminder schedule (30/15/7/2/1/0 days, then past due) and the
// "Remind me later" / "Already paid" buttons; see send-deadline-reminders.
export function isPaymentEventKey(key: string): boolean {
  return key.startsWith("tax-due:") || key.startsWith("tax-installment:");
}

// "1800 MARKET PLACE BLVD, IRVING, TX 75063-3903" -> "1800 Market Place Blvd"
export function streetOnly(address: string): string {
  const street = address.split(",")[0].trim();
  return street === street.toUpperCase()
    ? street.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : street;
}

const short = (what: string, address: string) =>
  `${what} — ${streetOnly(address)}`;

// "Property base data updated for <address> — total assessed value …" ->
// "Property base data updated": the headline of a note, without its details.
function noteHeadline(note: string): string {
  let head = note
    .split(/ — |: /)[0]
    .replace(/ for .*\d.*$/, "")
    .trim();
  if (head.length > 60) head = head.slice(0, 57).replace(/\s+\S*$/, "") + "…";
  return head;
}

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
  const [
    { data: properties },
    { data: protests },
    { data: taxBills },
    { data: bppAccounts },
    { data: reminders },
  ] = await Promise.all([
    admin
      .from("properties")
      .select(
        "id, address, protest_deadline, payment_due_date, tax_amount_due, paid_at, tax_year",
      )
      .eq("user_id", userId),
    admin
      .from("protests")
      .select(
        "id, property_id, bpp_account_id, status, hearing_date, hearing_time, hearing_location, arb_decision_date, informal_status, informal_review_date, informal_review_time, tax_year, escalation_path, arbitration_filed_at, arbitration, court_appeal",
      )
      .eq("user_id", userId),
    admin
      .from("tax_bills")
      .select(
        "id, property_id, tax_year, amount_due, due_date, penalty_date, paid_at, status, installments, refund_amount, refund_expected_at, refund_received_at",
      )
      .eq("user_id", userId),
    admin
      .from("bpp_accounts")
      .select(
        "id, business_name, protest_deadline, rendered_value, notice_value, rendition_filed_at, rendition_deadline, extension_granted_until, tax_amount_due, payment_due_date, paid_at",
      )
      .eq("user_id", userId),
    admin
      .from("user_reminders")
      .select("id, property_id, remind_on, note, done")
      .eq("user_id", userId),
  ]);

  type Row = Record<string, unknown>;
  const propertyById = new Map(
    ((properties ?? []) as Row[]).map((p) => [p.id as string, p]),
  );
  const bppAccountById = new Map(
    ((bppAccounts ?? []) as Row[]).map((a) => [a.id as string, a]),
  );
  const taxBillPropertyIds = new Set(
    ((taxBills ?? []) as Row[]).map((b) => b.property_id as string),
  );
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
        subject: short("Protest deadline", address),
        amount: null,
        resolved: isPast(date, todayIso),
      });
    }
    // No bill and no due date of its own: the statutory one (standardTaxDueDate
    // in src/lib/tax-calendar.ts), so every property gets payment reminders.
    if (
      !taxBillPropertyIds.has(id) &&
      (p.payment_due_date ||
        ((p.tax_year as number | null) ?? CURRENT_TAX_YEAR) >= CURRENT_TAX_YEAR)
    ) {
      const standard = !p.payment_due_date;
      const date = standard
        ? standardTaxDueDate((p.tax_year as number | null) ?? CURRENT_TAX_YEAR)
        : toIsoDate(p.payment_due_date as string);
      const what = standard ? "Property tax due" : "Tax bill due";
      events.push({
        key: `tax-due:property:${id}`,
        date,
        title: `${what} — ${address}`,
        subject: short(what, address),
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
      ? ((propertyById.get(pr.property_id as string)?.address as string) ??
        "your property")
      : ((bppAccountById.get(pr.bpp_account_id as string)
          ?.business_name as string) ?? "your account");
    if (pr.informal_status === "scheduled" && pr.informal_review_date) {
      const date = toIsoDate(pr.informal_review_date as string);
      events.push({
        key: `informal-review:${id}`,
        date,
        title: `Informal review — ${address}`,
        subject: short("Informal review", address),
        time: (pr.informal_review_time as string | null) ?? null,
        amount: null,
        resolved: isPast(date, todayIso),
      });
    }
    // Post-ARB: arbitration and court-appeal dates (apps/pt/src/lib/arbitration-case.ts,
    // court-appeal.ts). Each 60-day filing deadline runs from the day the ARB
    // order was received, else the order date.
    const arb = (pr.arbitration ?? {}) as Row;
    const court = (pr.court_appeal ?? {}) as Row;
    const plus60 = (from: unknown) => {
      if (typeof from !== "string" || !/^d{4}-d{2}-d{2}/.test(from))
        return null;
      const d = new Date(`${from.slice(0, 10)}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 60);
      return d.toISOString().slice(0, 10);
    };
    const closed = pr.status === "resolved";
    if (pr.escalation_path === "arbitration" && !closed) {
      const due = plus60(arb.orderReceivedDate ?? pr.arb_decision_date);
      if (due)
        events.push({
          key: `arbitration-deadline:${id}`,
          date: due,
          title: `Binding arbitration request due — ${address}`,
          subject: short("Arbitration request due", address),
          amount: null,
          resolved:
            !!(arb.submittedAt || pr.arbitration_filed_at) ||
            isPast(due, todayIso),
        });
      const settlement = (arb.settlement ?? null) as Row | null;
      if (settlement?.endDate)
        events.push({
          key: `arbitration-settlement:${id}`,
          date: toIsoDate(settlement.endDate as string),
          title: `Arbitration settlement period ends — ${address}`,
          subject: short("Arbitration settlement period ends", address),
          amount: null,
          resolved:
            !!settlement.withdrawnAt ||
            settlement.status === "settled" ||
            isPast(settlement.endDate as string, todayIso),
        });
      const arbitrator = (arb.arbitrator ?? null) as Row | null;
      if (arbitrator?.hearingDate)
        events.push({
          key: `arbitration-hearing:${id}`,
          date: toIsoDate(arbitrator.hearingDate as string),
          time: (arbitrator.hearingTime as string | null) ?? null,
          title: `Arbitration hearing — ${address}`,
          subject: short("Arbitration hearing", address),
          amount: null,
          resolved:
            !!arb.award || isPast(arbitrator.hearingDate as string, todayIso),
        });
    }
    if (pr.escalation_path === "appeal" && !closed) {
      const due = plus60(court.orderReceivedDate ?? pr.arb_decision_date);
      if (due)
        events.push({
          key: `court-appeal-deadline:${id}`,
          date: due,
          title: `Court appeal petition due — ${address}`,
          subject: short("Court appeal petition due", address),
          amount: null,
          resolved: !!court.petitionFiledAt || isPast(due, todayIso),
        });
      const updates = Array.isArray(court.updates)
        ? (court.updates as Row[])
        : [];
      updates.forEach((u, i) => {
        const dls = Array.isArray(u.deadlines)
          ? (u.deadlines as { date: string; label: string }[])
          : [];
        dls.forEach((dl, j) => {
          if (!dl?.date) return;
          events.push({
            key: `court-deadline:${id}:${i}:${j}`,
            date: toIsoDate(dl.date),
            title: `${dl.label} — ${address}`,
            subject: short(dl.label.slice(0, 50), address),
            amount: null,
            resolved: isPast(dl.date, todayIso),
          });
        });
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
        time: (pr.hearing_time as string | null) ?? null,
        title: parts.join(" "),
        subject: short("ARB hearing", address),
        amount: null,
        resolved: isPast(date, todayIso),
      });
    }
  }

  for (const bill of (taxBills ?? []) as Row[]) {
    const id = bill.id as string;
    const address =
      (propertyById.get(bill.property_id as string)?.address as string) ??
      "your property";
    const yearLabel = bill.tax_year ? ` (${bill.tax_year})` : "";
    const billPaid = !!bill.paid_at || bill.status === "paid";
    // On an installment plan (Pay Taxes tab) each installment is its own
    // deadline, reminded separately; the single due date no longer applies.
    const installments = Array.isArray(bill.installments)
      ? (bill.installments as {
          label: string;
          dueDate: string;
          amount: number | null;
          paidAt?: string | null;
        }[])
      : [];
    for (const inst of installments) {
      if (!inst?.dueDate) continue;
      events.push({
        key: `tax-installment:${id}:${inst.label}`,
        date: toIsoDate(inst.dueDate),
        title: `${inst.label} of property tax due${yearLabel} — ${address}`,
        subject: short(`${inst.label} due${yearLabel}`, address),
        amount: inst.amount ?? null,
        resolved: billPaid || !!inst.paidAt,
      });
    }
    if (bill.due_date && installments.length === 0) {
      events.push({
        key: `tax-due:bill:${id}`,
        date: toIsoDate(bill.due_date as string),
        title: `Tax bill due${yearLabel} — ${address}`,
        subject: short(`Tax bill due${yearLabel}`, address),
        amount: bill.amount_due as number | null,
        resolved: billPaid,
      });
    }
    if (bill.penalty_date) {
      const date = toIsoDate(bill.penalty_date as string);
      events.push({
        key: `tax-penalty:${id}`,
        date,
        title: `Penalty date${yearLabel} — ${address}`,
        subject: short(`Penalty date${yearLabel}`, address),
        amount: null,
        resolved: billPaid || isPast(date, todayIso),
      });
    }
    if (bill.refund_expected_at) {
      events.push({
        key: `refund:${id}`,
        date: toIsoDate(bill.refund_expected_at as string),
        title: `Refund expected${yearLabel} — ${address}`,
        subject: short(`Refund expected${yearLabel}`, address),
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
        subject: `BPP protest deadline — ${businessName}`,
        amount: null,
        resolved: isPast(date, todayIso),
      });
    }
    // Rendition (Form 50-144): a GRANTED extension replaces April 15; done
    // once the owner records it submitted.
    const renditionDue =
      (account.extension_granted_until as string | null) ??
      (account.rendition_deadline as string | null);
    if (renditionDue) {
      const date = toIsoDate(renditionDue);
      events.push({
        key: `bpp-rendition-deadline:${id}:${date}`,
        date,
        title: `BPP rendition due — ${businessName}`,
        subject: `BPP rendition due — ${businessName}`,
        amount: null,
        resolved: !!account.rendition_filed_at,
      });
    }
    if (account.tax_amount_due != null && account.payment_due_date) {
      const date = toIsoDate(account.payment_due_date as string);
      events.push({
        key: `bpp-tax-due:${id}:${date}`,
        date,
        title: `BPP tax payment due — ${businessName}`,
        subject: `BPP tax payment due — ${businessName}`,
        amount: account.tax_amount_due as number | null,
        resolved: !!account.paid_at,
      });
    }
  }

  for (const r of (reminders ?? []) as Row[]) {
    const id = r.id as string;
    const propertyId = r.property_id as string | null;
    const label = propertyId
      ? (propertyById.get(propertyId)?.address as string)
      : null;
    const note = (r.note as string) ?? "";
    events.push({
      key: `reminder:${id}`,
      date: toIsoDate(r.remind_on as string),
      // a system note already names the property — don't repeat the address
      title:
        label && !note.toLowerCase().includes(label.toLowerCase())
          ? `${note} (${label})`
          : note,
      subject: label ? short(noteHeadline(note), label) : noteHeadline(note),
      isReminder: true,
      amount: null,
      resolved: !!r.done,
    });
  }

  return events;
}
