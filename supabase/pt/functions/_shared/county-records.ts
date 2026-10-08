// County portal integration — reading the appraisal district's own protest
// records back into each case. No district offers a filing API, but Harris
// CAD publishes, and refreshes weekly, every protest it received (with the
// date), each ARB hearing's scheduled and actual dates, and each final value
// and its release date (download.hcad.org/data/CAMA/<year>/Hearing_files.zip).
// The sync-county-records job matches those rows to open cases by account
// and tax year; this module parses them and decides — conservatively — what
// to fill in: only empty fields, only forward in the case's life, never over
// anything the owner entered. Pure, so it's tested.

export type CountyRecord = {
  account: string;
  taxYear: number;
  protestedAt: string | null; // YYYY-MM-DD
  protestedBy: "owner" | "agent" | null;
  scheduledHearing: string | null;
  actualHearing: string | null;
  releaseDate: string | null;
  stage: "informal" | "formal" | null;
  initialValue: number | null; // market
  finalValue: number | null;
  withdrawn: boolean;
};

export const isoDate = (mdy: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

const num = (s: string | undefined) => {
  const n = Number((s ?? "").trim());
  return s && s.trim() !== "" && Number.isFinite(n) ? n : null;
};

// arb_protest_real.txt: acct, protested_by, protested_dt
export function parseHarrisProtest(
  line: string,
): Pick<CountyRecord, "account" | "protestedAt" | "protestedBy"> | null {
  const [acct, by, dt] = line.split("\t");
  if (!acct || !/^\d+$/.test(acct.trim())) return null;
  return {
    account: acct.trim(),
    protestedBy:
      by?.trim().toLowerCase() === "agent" ? "agent" : by ? "owner" : null,
    protestedAt: dt ? isoDate(dt) : null,
  };
}

// arb_hearings_real.txt (header row gives the column order).
export function parseHarrisHearing(
  header: string[],
  line: string,
): Omit<CountyRecord, "protestedAt" | "protestedBy"> | null {
  const f = line.split("\t");
  const col = (name: string) => f[header.indexOf(name)]?.trim() ?? "";
  const account = col("acct");
  const taxYear = Number(col("Tax_Year"));
  if (!account || !taxYear) return null;
  return {
    account,
    taxYear,
    scheduledHearing: isoDate(col("Scheduled_for_Date")),
    actualHearing: isoDate(col("Actual_Hearing_Date")),
    releaseDate: isoDate(col("Release_Date")),
    stage:
      col("Hearing_Type") === "I"
        ? "informal"
        : col("Hearing_Type") === "F"
          ? "formal"
          : null,
    initialValue: num(col("Initial_Market_Value")),
    finalValue: num(col("Final_Market_Value")),
    withdrawn: col("Letter_Type") === "WD",
  };
}

export type CaseFields = {
  status: string;
  hearing_date: string | null;
  hearing_completed_at: string | null;
  final_value: number | null;
  arb_decision_date: string | null;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const STATUS_ORDER = [
  "requested",
  "filed",
  "under_review",
  "offer_received",
  "hearing_scheduled",
  "decision_received",
  "appealing",
  "arbitrating",
  "resolved",
];
const before = (status: string, target: string) =>
  STATUS_ORDER.indexOf(status) >= 0 &&
  STATUS_ORDER.indexOf(status) < STATUS_ORDER.indexOf(target);

// What the county's record adds to the case. Each event becomes an audit-log
// entry and the owner's notification.
export function planCaseUpdate(
  current: CaseFields,
  r: CountyRecord,
  cad: string,
): { patch: Partial<CaseFields>; events: string[] } {
  const patch: Partial<CaseFields> = {};
  const events: string[] = [];
  let status = current.status;
  const advance = (to: string) => {
    if (before(status, to)) {
      status = to;
      patch.status = to;
    }
  };

  if (r.withdrawn) {
    events.push(`${cad}'s records show this protest as withdrawn.`);
    return { patch, events };
  }
  if (r.protestedAt) {
    if (before(status, "filed")) {
      advance("filed");
      events.push(
        `${cad}'s records show your protest received on ${longDate(r.protestedAt)}.`,
      );
    }
  }
  if (
    r.scheduledHearing &&
    !current.hearing_date &&
    !r.actualHearing &&
    !r.releaseDate
  ) {
    patch.hearing_date = r.scheduledHearing;
    advance("hearing_scheduled");
    events.push(
      `${cad} has scheduled the ${r.stage === "informal" ? "informal" : "ARB"} hearing for ${longDate(r.scheduledHearing)}.`,
    );
  }
  if (r.actualHearing && !current.hearing_completed_at) {
    patch.hearing_completed_at = `${r.actualHearing}T12:00:00Z`;
    if (!current.hearing_date) patch.hearing_date = r.actualHearing;
    events.push(
      `${cad}'s records show the hearing held on ${longDate(r.actualHearing)}.`,
    );
  }
  if (r.releaseDate && r.finalValue != null && current.final_value == null) {
    patch.final_value = r.finalValue;
    if (!current.arb_decision_date) patch.arb_decision_date = r.releaseDate;
    advance("decision_received");
    const change =
      r.initialValue != null && r.initialValue !== r.finalValue
        ? ` (from ${usd(r.initialValue)})`
        : " (unchanged)";
    events.push(
      `${cad} released the final value of ${usd(r.finalValue)}${change} on ${longDate(r.releaseDate)}. The 60-day appeal window runs from when you receive the order.`,
    );
  }
  return { patch, events };
}
