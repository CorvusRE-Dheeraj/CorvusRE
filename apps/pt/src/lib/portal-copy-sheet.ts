// County portal integration, the filing half: no Texas appraisal district
// offers a filing API, and automating a portal would mean holding owners'
// credentials — so instead, when an owner files online, CorvusPT lays out
// every value the district's portal asks for, read from the signed Notice of
// Protest (Form 50-132) itself, each with a copy button, and flags anything
// that looks wrong before it's pasted. Pure, so it's tested.

export type FieldValues = Record<string, string | boolean | null | undefined>;

// Form 50-132's protest reasons, worded as on the form (its field tooltips).
export const REASONS: Record<number, string> = {
  1: "Incorrect appraised (market) value and/or value is unequal compared with other properties",
  2: "Property should not be taxed in the named taxing unit",
  3: "Property is not located in this appraisal district or otherwise should not be on its record",
  4: "Failure to send required notice",
  5: "Exemption was denied, modified or cancelled",
  6: "Temporary disaster damage exemption was denied or modified",
  7: "Ag-use, open-space or other special appraisal was denied, modified or cancelled",
  8: "Change in use of land appraised as ag-use, open-space or timberland",
  9: "Incorrect appraised or market value of land under special appraisal",
  10: "Owner's name is incorrect",
  11: "Property description is incorrect",
  12: "Incorrect damage assessment rating for a temporary disaster exemption",
  13: "Circuit breaker limitation on appraised value was denied, modified or canceled",
  14: "Incorrect appraised value and allocation for a historic site exemption",
  15: "Other",
};

export type CopyRow = { label: string; value: string; warning: string | null };

// The form fields a portal asks for, in the order portals usually ask.
const FIELDS: { key: string; label: string; check?: (v: string) => string | null }[] = [
  { key: "Appraisal District Account Number", label: "Account number" },
  { key: "Tax Year", label: "Tax year" },
  {
    key: "Name of Property Owner or Lessee",
    label: "Owner name",
    check: (v) =>
      v.replace(/[\s,.]/g, "").length < 2 ? "Looks empty — check the owner name." : null,
  },
  { key: "Physical Address", label: "Property address" },
  { key: "Mailing Address City State ZIP Code", label: "Mailing address" },
  { key: "Email Address", label: "Email" },
  {
    key: "Phone Number area code and number",
    label: "Phone",
    check: (v) => {
      const d = v.replace(/\D/g, "");
      if (/^0+$/.test(d))
        return "This is a placeholder, not a real number — enter the owner's phone.";
      if (d.length !== 10 && !(d.length === 11 && d.startsWith("1")))
        return "Doesn't look like a 10-digit phone number.";
      return null;
    },
  },
  { key: "Appraisal districts value assigned to property", label: "District's value" },
  { key: "Opinion of property value", label: "Your opinion of value" },
  { key: "Facts to resolve protest", label: "Facts that may help resolve the protest" },
  {
    key: "Print Name of Property Owner or Authorized Representative",
    label: "Name of the person filing",
    check: (v) =>
      v.replace(/[\s,.]/g, "").length < 2 ? "Looks empty — check the printed name." : null,
  },
];

const str = (v: FieldValues[string]) => (typeof v === "string" ? v.trim() : "");

export function copySheet(values: FieldValues): CopyRow[] {
  const rows: CopyRow[] = [];
  for (const f of FIELDS) {
    const v = str(values[f.key]);
    if (!v && !f.check) continue;
    rows.push({
      label: f.label,
      value: v,
      warning: v ? (f.check?.(v) ?? null) : "Missing on the form.",
    });
  }
  const reasons = Object.entries(values)
    .map(([k, v]) => [/^Reason for protest (\d+)$/.exec(k)?.[1], v] as const)
    .filter(([n, v]) => n && (v === true || v === "true" || v === "Yes" || v === "On"))
    .map(([n]) => REASONS[Number(n)])
    .filter(Boolean);
  rows.splice(Math.min(rows.length, 7), 0, {
    label: "Reasons for protest",
    value: reasons.join("; "),
    warning: reasons.length ? null : "No reason is checked on the form.",
  });
  return rows;
}
