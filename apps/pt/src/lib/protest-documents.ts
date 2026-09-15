import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PropertyRecord } from "./properties";
import type { AuthorizationRecord } from "./protest-authorizations";
import type { CadRecord } from "./cad-lookup";
import type { SignatureValue } from "@/components/SignaturePad";
import { AGREEMENT } from "@/components/ProtestAuthorizationFlow";

// Drives every field on the two REAL, official Texas Comptroller PDF forms
// (committed verbatim in public/forms/ — not recreated). Field names/labels/
// radio options below were read directly off each PDF's AcroForm via pdf-lib
// (getForm().getFields()) cross-referenced with pdftotext's layout extraction
// — none are guessed. Neither form's signature line is exposed here (Form
// 50-132's is a true /Sig field pdf-lib can't plain-fill anyway; Form 50-162's
// needs a real signature at filing time, not a copy of an e-signature given
// for a different document).

export type FieldValues = Record<string, string | boolean>;

// Clicking a suggestion fills the field with `value`; the user can still
// freely edit or clear it afterward — never a hard constraint on the input,
// just a shortcut to a real, computed answer (today's date, a phone number
// already on file elsewhere in this same form) instead of a blank box that
// invites something the field can't actually use, like a duration typed into
// a date field. `values` is the form's current state, so a suggestion can
// reference another field the user (or an earlier autofill) already filled.
export type FieldSuggestion = { label: string; value: string };

export type FieldDef =
  | {
      type: "text";
      name: string;
      label: string;
      suggestions?: (values: FieldValues) => FieldSuggestion[];
      // MM/DD/YYYY, enforced on blur (and again right before signing — see
      // signPdf's caller) via resolveDateInput() below, not by restricting
      // keystrokes — typing "30 years" is exactly what this exists to catch
      // and convert, so the field can't simply reject non-digit input.
      dateFormat?: boolean;
      // Marked with a required-field asterisk and enforced by
      // isFormComplete() below — only ever set where the real form itself,
      // or the statute it implements (Tax Code §41.44(b) for 50-132), makes
      // the field mandatory; see the comment above each schema export.
      required?: boolean;
      // Shows PdfFormEditor's "Generate Suggested Reason" button next to
      // this field — only ever set on the one real free-text field this
      // app can meaningfully draft from uploaded evidence (see
      // protest-reason.ts). Never marks a field the AI would just be
      // guessing at.
      aiSuggestable?: boolean;
      // Renders a <textarea> instead of a single-line <input> — set only
      // on genuinely paragraph-length real fields (today: the one
      // aiSuggestable field above), not a general styling knob.
      multiline?: boolean;
    }
  | { type: "checkbox"; name: string; label: string }
  | { type: "radio"; name: string; label: string; options: string[]; required?: boolean };

export type FieldSection = {
  title: string;
  fields: FieldDef[];
  // Set when the real form requires choosing at least one checkbox within
  // this section (e.g. 50-132's Reasons for Protest, or either form's own
  // "(check one)" groups) — a single checkbox can't be individually
  // "required" since checking it isn't the only way to satisfy the group.
  requireAtLeastOne?: boolean;
};

// Real-fields-only completeness check — same discipline as
// pre-filing-check.ts: a field only counts as satisfied when it actually
// has a real, non-blank value the user entered, never assumed. Drives both
// the required-field asterisks and the Download/Sign gating in
// PdfFormEditor.tsx.
export function isFormComplete(sections: FieldSection[], values: FieldValues): boolean {
  return getIncompleteRequiredLabels(sections, values).length === 0;
}

export function getIncompleteRequiredLabels(
  sections: FieldSection[],
  values: FieldValues,
): string[] {
  const labels: string[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.type === "checkbox" || !field.required) continue;
      const v = values[field.name];
      if (!(typeof v === "string" && v.trim().length > 0)) labels.push(field.label);
    }
    if (section.requireAtLeastOne) {
      const anyChecked = section.fields.some((f) => f.type === "checkbox" && !!values[f.name]);
      if (!anyChecked) labels.push(`${section.title} — select at least one`);
    }
  }
  return labels;
}

// The real field `name` of the first incomplete required field/group, in
// schema order — drives PdfFormEditor's "Jump to next required field"
// button. Shares the exact same completeness rules as
// getIncompleteRequiredLabels() above (same discipline, one source of
// truth) rather than a second, possibly-drifting implementation.
export function getFirstIncompleteFieldName(
  sections: FieldSection[],
  values: FieldValues,
): string | null {
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.type === "checkbox" || !field.required) continue;
      const v = values[field.name];
      if (!(typeof v === "string" && v.trim().length > 0)) return field.name;
    }
    if (section.requireAtLeastOne) {
      const anyChecked = section.fields.some((f) => f.type === "checkbox" && !!values[f.name]);
      if (!anyChecked) {
        const firstCheckbox = section.fields.find((f) => f.type === "checkbox");
        if (firstCheckbox) return firstCheckbox.name;
      }
    }
  }
  return null;
}

// MM/DD/YYYY — matches how these forms' own PDF text fields render a typed
// date, and how the app already formats the real signed-at date in signPdf().
function formatDateSuggestion(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function todaySuggestion(): FieldSuggestion[] {
  return [{ label: "Today", value: formatDateSuggestion(new Date()) }];
}

// Real, computed dates (today + N years) — not guesses about what this
// specific case's authority-end date should be, just the common real
// durations an owner is actually choosing between. "No end date" is a
// legitimate real answer too (this form's own instructions treat a blank
// date here as "until revoked"), so it clears the field rather than filling
// placeholder text into a date box — the exact problem this was added for.
function agentAuthorityEndSuggestions(): FieldSuggestion[] {
  const today = new Date();
  const plusYears = (years: number) => {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() + years);
    return formatDateSuggestion(d);
  };
  return [
    { label: "No end date", value: "" },
    { label: "1 year from today", value: plusYears(1) },
    { label: "3 years from today", value: plusYears(3) },
    { label: "5 years from today", value: plusYears(5) },
  ];
}

// Form 50-283's Section 7 signature date is split across 3 real fields
// ("day of" / "Sig Month" / "Sig Year" — see the printed line "Signed on
// this ___ day of ___ , 20 ___") rather than the one combined MM/DD/YYYY
// field the other two forms use, so this needs its own 3 real, computed
// suggestions instead of reusing todaySuggestion(). Sig Year is only the
// last 2 digits — the "20" is already printed on the real form.
function signatureDaySuggestion(): FieldSuggestion[] {
  return [{ label: "Today", value: String(new Date().getDate()) }];
}

function signatureMonthSuggestion(): FieldSuggestion[] {
  const monthName = new Date().toLocaleDateString("en-US", { month: "long" });
  return [{ label: "Today", value: monthName }];
}

function signatureYearSuggestion(): FieldSuggestion[] {
  return [{ label: "Today", value: String(new Date().getFullYear()).slice(-2) }];
}

// The mobile-reminder field is genuinely separate from Section 1's own phone
// field (different purpose — text reminders, not general contact), but in
// practice it's very often the same number, which this form has often
// already filled in by the time the user reaches Section 6 — reused as a
// real suggestion rather than making the user retype it.
function phoneOnFileSuggestion(values: FieldValues): FieldSuggestion[] {
  const phone = values["Phone Number area code and number"];
  return typeof phone === "string" && phone ? [{ label: `Use ${phone}`, value: phone }] : [];
}

function formatMMDDYYYY(month: number, day: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// "August 24" / "24 August" / "24th Aug, 2026" — with or without a year. Not
// used via the plain `new Date(string)` constructor: confirmed it silently
// defaults a year-less date like "August 24" to 2001 (not the current year),
// so this parses the month/day/year components explicitly instead.
function tryParseMonthDay(
  trimmed: string,
): { month: number; day: number; year: number | null } | null {
  const lower = trimmed.toLowerCase();
  let m = lower.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/);
  if (m) {
    const monthIdx = MONTH_NAMES.findIndex((n) => n.startsWith(m![1]));
    if (monthIdx >= 0)
      return {
        month: monthIdx + 1,
        day: parseInt(m[2], 10),
        year: m[3] ? parseInt(m[3], 10) : null,
      };
  }
  m = lower.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:,?\s+(\d{4}))?$/);
  if (m) {
    const monthIdx = MONTH_NAMES.findIndex((n) => n.startsWith(m![2]));
    if (monthIdx >= 0)
      return {
        month: monthIdx + 1,
        day: parseInt(m[1], 10),
        year: m[3] ? parseInt(m[3], 10) : null,
      };
  }
  return null;
}

// Normalizes whatever was typed into a date field to real MM/DD/YYYY — called
// on blur (PdfFormEditor's TextRow) and once more, over every date-marked
// field, right before a document is actually signed (CaseDetailModal's
// handleConfirmSign), so a value that slipped through un-normalized (e.g. the
// user never blurred the field) still gets corrected at the moment that
// matters most. Three real, computable cases, tried in order:
//  1. A duration ("30 years", "6 months", "2 weeks") — computed from TODAY,
//     the actual bug this was built for (typing a duration into a date box).
//  2. An explicit date in a common format (MM/DD/YYYY, M-D-YY, ISO
//     YYYY-MM-DD) — reformatted, not reinterpreted.
//  3. A month-and-day written out ("August 24"), year assumed to be the
//     current year if omitted.
// Anything else is left exactly as typed — this never invents a date it
// can't actually compute from what's there.
export function resolveDateInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const durationMatch = trimmed.match(/^(\d+)\s*(day|week|month|year)s?\b/i);
  if (durationMatch) {
    const amount = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2].toLowerCase();
    const d = new Date();
    if (unit === "day") d.setDate(d.getDate() + amount);
    else if (unit === "week") d.setDate(d.getDate() + amount * 7);
    else if (unit === "month") d.setMonth(d.getMonth() + amount);
    else if (unit === "year") d.setFullYear(d.getFullYear() + amount);
    return formatDateSuggestion(d);
  }

  let m = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (m[3].length === 2) year += year < 50 ? 2000 : 1900;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return formatMMDDYYYY(month, day, year);
  }

  m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return formatMMDDYYYY(month, day, year);
  }

  const md = tryParseMonthDay(trimmed);
  if (md) return formatMMDDYYYY(md.month, md.day, md.year ?? new Date().getFullYear());

  return trimmed;
}

// The reverse of resolveDateInput's ISO branch — a native <input type="date">
// (the calendar picker in PdfFormEditor.tsx) requires its `value` in ISO
// (YYYY-MM-DD), while every date this app stores/fills into the real PDF is
// MM/DD/YYYY. Returns "" for anything that isn't a real MM/DD/YYYY date
// (an empty native date input, never a guess).
export function mmddyyyyToIso(value: string): string {
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// Runs resolveDateInput() over every date-marked field in `values` — the
// "one final pass at signing time" half of the fix, in case the user never
// blurred a field after typing into it.
export function resolveDateFields(schema: FieldSection[], values: FieldValues): FieldValues {
  const next = { ...values };
  for (const section of schema) {
    for (const field of section.fields) {
      if (field.type === "text" && field.dateFormat && typeof next[field.name] === "string") {
        next[field.name] = resolveDateInput(next[field.name] as string);
      }
    }
  }
  return next;
}

// Required markers below are grounded in what actually makes a protest
// legally sufficient under Tax Code §41.44(b) — the property owner's name,
// identification of the property, and an indicated reason for protest —
// plus the form's own signature block, which the app's signing flow itself
// depends on (see expectedSignerName in CaseDetailModal.tsx). Account
// Number is explicitly "(if known)" on the form and Legal description is
// only the documented fallback when there's no street address, so neither
// is marked required.
export const NOTICE_OF_PROTEST_SCHEMA: FieldSection[] = [
  {
    title: "Appraisal District & Tax Year",
    fields: [
      {
        type: "text",
        name: "Appraisal Districts Name",
        label: "Appraisal District's County",
        required: true,
      },
      {
        type: "text",
        name: "Appraisal District Account Number",
        label: "Appraisal District Account Number (if known)",
      },
      { type: "text", name: "Tax Year", label: "Tax Year", required: true },
    ],
  },
  {
    title: "Section 1: Property Owner or Lessee",
    fields: [
      {
        type: "radio",
        name: "Property owner type",
        label: "Property owner type (if applicable)",
        options: [
          "Person Age 65 or Older",
          "Disabled Person",
          "Military Service Member",
          "Military Veteran",
          "Spouse of a Military Service Member or Veteran",
        ],
      },
      {
        type: "text",
        name: "Name of Property Owner or Lessee",
        label: "Name of Property Owner or Lessee",
        required: true,
      },
      {
        type: "text",
        name: "Mailing Address City State ZIP Code",
        label: "Mailing Address, City, State, ZIP Code",
      },
      {
        type: "text",
        name: "Phone Number area code and number",
        label: "Phone Number (area code and number)",
      },
    ],
  },
  {
    title: "Section 2: Property Description",
    fields: [
      {
        type: "text",
        name: "Physical Address",
        label: "Physical Address, City, State, ZIP Code",
        required: true,
      },
      {
        type: "text",
        name: "Legal description",
        label: "Legal description (if no street address)",
      },
      {
        type: "text",
        name: "Mobile Home",
        label: "Mobile Home Make, Model and Identification (if applicable)",
      },
    ],
  },
  {
    title: "Section 3: Reasons for Protest",
    // At least one reason must be checked to preserve the right to raise it
    // — the form's own text: "Failure to select the box that corresponds to
    // each reason for your protest may result in your inability to protest
    // an issue that you want to pursue."
    requireAtLeastOne: true,
    fields: [
      {
        type: "checkbox",
        name: "Reason for protest 1",
        label:
          "Incorrect appraised (market) value and/or value is unequal compared with other properties.",
      },
      {
        type: "text",
        name: "Taxing Unit",
        label: "Taxing unit (for “should not be taxed in …”, if that reason applies)",
      },
      {
        type: "checkbox",
        name: "Reason for protest 2",
        label: "Property should not be taxed in the taxing unit named above.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 3",
        label:
          "Property is not located in this appraisal district or otherwise should not be included on the appraisal district's record.",
      },
      {
        type: "text",
        name: "Type of notice",
        label:
          "Type of notice not received (for “failure to send required notice”, if that reason applies)",
      },
      { type: "checkbox", name: "Reason for protest 4", label: "Failure to send required notice." },
      {
        type: "checkbox",
        name: "Reason for protest 5",
        label: "Exemption was denied, modified or canceled.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 6",
        label: "Temporary disaster damage exemption was denied or modified.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 7",
        label: "Ag-use, open-space or other special appraisal was denied, modified or canceled.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 8",
        label: "Change in use of land appraised as ag-use, open-space or timberland.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 9",
        label:
          "Incorrect appraised or market value of land under special appraisal for ag-use, open-space or other special appraisal.",
      },
      { type: "checkbox", name: "Reason for protest 10", label: "Owner's name is incorrect." },
      {
        type: "checkbox",
        name: "Reason for protest 11",
        label: "Property description is incorrect.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 12",
        label:
          "Incorrect damage assessment rating for a property qualified for a temporary disaster exemption.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 13",
        label:
          "Circuit breaker limitation on appraised value for all other real property was denied, modified or canceled.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 14",
        label:
          "Incorrect appraised value and allocation of value of a structure, archaeological site and land necessary for access under a historic site exemption.",
      },
      {
        type: "text",
        name: "Other disaster exemption",
        label: "Other (describe, if applicable to a reason above)",
      },
      {
        type: "text",
        name: "Other description",
        label: "Other reason (for the “Other” box, if that reason applies)",
      },
      { type: "checkbox", name: "Reason for protest 15", label: "Other." },
    ],
  },
  {
    title: "Section 4: Additional Facts",
    fields: [
      {
        type: "text",
        name: "Opinion of property value",
        label: "What is your opinion of your property's value? (optional) $",
      },
      {
        type: "text",
        name: "Facts to resolve protest",
        label: "Facts that may help resolve this protest",
        aiSuggestable: true,
        multiline: true,
      },
    ],
  },
  {
    title: "Section 5: Hearing Type",
    fields: [
      {
        type: "radio",
        name: "Do you request an informal conference",
        label: "Request an informal conference before the hearing?",
        options: ["Yes", "No"],
      },
      {
        type: "radio",
        name: "ARB panel",
        label: "Single-member ARB panel or a regular panel of at least three members?",
        options: ["a single-member ARB panel", "a regular ARB panel of at least three members"],
      },
      {
        type: "radio",
        name: "ARB hearing",
        label: "How do you intend to appear at the ARB hearing?",
        options: [
          "In person",
          " By telephone conference call and will submit evidence with a written affidavit delivered to the ARB before the hearing begins.** (may use Comptroller Form 50-283, Property Owner Affidavit of Evidence)",
          " By videoconference and will submit evidence with a written affidavit delivered to the ARB before the hearing begins.** (may use Comptroller Form 50-283, Property Owner Affidavit of Evidence)",
          " On written affidavit submitted with evidence and delivered to the ARB before the hearing begins",
        ],
      },
    ],
  },
  {
    title: "Section 6: ARB Hearing Notice and Procedures",
    fields: [
      {
        type: "radio",
        name: "Notice of hearing",
        label: "Deliver my notice of hearing by",
        options: [
          "Regular first-class mail",
          "Certified mail and agree to pay the cost (if applicable)",
        ],
      },
      {
        type: "radio",
        name: "Hearing Procedures",
        label: "Send me a copy of the ARB's hearing procedures?",
        options: ["Yes", "No"],
      },
      {
        type: "radio",
        name: "Electronic reminder",
        label: "Electronic reminder of the hearing date/time?",
        options: ["Yes, by text", "Yes, by email", "No"],
      },
      {
        type: "text",
        name: "Mobile Number",
        label: "Mobile phone number (if reminder by text)",
        suggestions: phoneOnFileSuggestion,
      },
      { type: "text", name: "Email Address", label: "Email address (if reminder by email)" },
    ],
  },
  {
    title: "Section 7: Special Panel Request ($62.9 Million or More)",
    fields: [
      {
        type: "radio",
        name: "Request for special panel",
        label: "Request a special panel to hear my protest?",
        options: ["Yes", "No"],
      },
      {
        type: "radio",
        name: "Property is appraised at $57 million or greater",
        label: "Property is appraised at $57 million or greater",
        options: ["No"],
      },
      {
        type: "radio",
        name: "Property is appraised at $62.9 million or greater",
        label: "Property is appraised at $62.9 million or greater",
        options: ["Yes"],
      },
      {
        type: "text",
        name: "Appraisal districts value assigned to property",
        label: "Appraisal district's value assigned to your property $",
      },
      {
        type: "radio",
        name: "Classification of your property",
        label: "Property classification",
        options: [
          "Commercial real and personal property ",
          "Industrial and manufacturing real and personal property",
          "Real and personal property of utilities",
          "Multifamily residential real property",
        ],
      },
    ],
  },
  {
    title: "Section 8: Certification",
    fields: [
      {
        type: "radio",
        name: "Certification and Signature",
        label: "Signing as",
        options: ["Property Owner", "Property Owner's agent", "Other (please specify)"],
        required: true,
      },
      {
        type: "text",
        name: "Print Name of Property Owner or Authorized Representative",
        label: "Print Name of Property Owner or Authorized Representative",
        required: true,
      },
      {
        type: "text",
        name: "Date of Signature",
        label: "Date",
        suggestions: todaySuggestion,
        dateFormat: true,
        required: true,
      },
    ],
  },
];

// Real field names/labels read directly off public/forms/50-283.pdf's own
// AcroForm (getForm().getFields()) plus its widget rects (page/x/y — see
// SIGNATURE_FIELD_RECT below), cross-referenced with pdftotext's layout —
// same discipline as the two schemas above. Fetched live from
// comptroller.texas.gov/forms/50-283.pdf; its own footer reads
// "50-283 • 07-26/12" — flag for a human recheck if that ever looks stale.
//
// This is a SWORN AFFIDAVIT (Tax Code §41.45) that must be signed in the
// physical presence of a notary public — the app can prepare and let the
// owner draw a signature here, same as the other two forms, but that
// signature alone does NOT execute the affidavit; see the notarization
// notice PdfFormEditor shows for formKind "evidence-declaration". The 4
// notary-only fields on the real PDF (Notary Public/Commission Expires/
// Printed Name, and the "Sworn" date trio) are deliberately NOT in this
// schema — nothing this app fills in should stand in for a notary's own
// completion of that section.
//
// Required markers: owner name, property description, and the signature
// block are required for the same reason as the Notice of Protest's own
// required fields — a blank affidavit isn't a real one. Section 3 (Reasons)
// requires at least one, matching the real form's own warning text; Section
// 6 (Hearing Type) is required since it's explicitly "select only one box"
// and determines whether this affidavit is even usable at the hearing.
export const EVIDENCE_DECLARATION_SCHEMA: FieldSection[] = [
  {
    title: "Appraisal District & Tax Year",
    fields: [
      {
        type: "text",
        name: "Appraisal Districts County Name",
        label: "Appraisal District's County",
        required: true,
      },
      { type: "text", name: "ADAN", label: "Appraisal District Account Number (if known)" },
      { type: "text", name: "Tax Year", label: "Tax Year", required: true },
    ],
  },
  {
    title: "Section 1: Property Owner or Lessee",
    fields: [
      {
        type: "text",
        name: "Name of Property Owner or Lessee",
        label: "Name of Property Owner or Lessee",
        required: true,
      },
      {
        type: "text",
        name: "Mailing Address City State ZIP Code",
        label: "Mailing Address, City, State, ZIP Code",
      },
      {
        type: "text",
        name: "Phone Number area code and number",
        label: "Phone Number (area code and number)",
      },
      { type: "text", name: "Email Address", label: "Email Address" },
    ],
  },
  {
    title: "Section 2: Property Description",
    fields: [
      {
        type: "text",
        name: "Sect2-1",
        label: "Physical Address, City, State, ZIP Code (if different than above)",
        required: true,
      },
      { type: "text", name: "Sect2-2", label: "Legal description (if no street address)" },
      {
        type: "text",
        name: "Sect2-3",
        label: "Mobile Home Make, Model and Identification (if applicable)",
      },
    ],
  },
  {
    title: "Section 3: Reasons for Protest",
    // Same real warning as the Notice of Protest's own Section 3: "Failure
    // to select the box that corresponds to each reason for your protest
    // may result in your inability to protest an issue that you want to
    // pursue."
    requireAtLeastOne: true,
    fields: [
      {
        type: "checkbox",
        name: "Reason for protest 1",
        label:
          "Incorrect appraised (market) value and/or value is unequal compared with other properties.",
      },
      {
        type: "text",
        name: "name of taxing unit",
        label: "Taxing unit (for “should not be taxed in …”, if that reason applies)",
      },
      {
        type: "checkbox",
        name: "Reason for protest 2",
        label: "Property should not be taxed in the taxing unit named above.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 3",
        label:
          "Property is not located in this appraisal district or otherwise should not be included on the appraisal district's record.",
      },
      {
        type: "text",
        name: "type",
        label: "Type of notice not received (if that reason applies)",
      },
      { type: "checkbox", name: "Reason for protest 4", label: "Failure to send required notice." },
      {
        type: "checkbox",
        name: "Reason for protest 5",
        label: "Exemption was denied, modified or canceled.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 6",
        label: "Temporary disaster damage exemption was denied or modified.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 7",
        label: "Ag-use, open-space or other special appraisal was denied, modified or canceled.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 8",
        label: "Change in use of land appraised as ag-use, open-space or timberland.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 9",
        label:
          "Incorrect appraised or market value of land under special appraisal for ag-use, open-space or other special appraisal.",
      },
      { type: "checkbox", name: "Reason for protest 10", label: "Owner's name is incorrect." },
      {
        type: "checkbox",
        name: "Reason for protest 11",
        label: "Property description is incorrect.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 12",
        label:
          "Incorrect damage assessment rating for a property qualified for a temporary disaster exemption.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 13",
        label:
          "Circuit breaker limitation on appraised value for non-homestead real property was denied, modified or canceled.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 14",
        label:
          "Incorrect appraised value and allocation of value of a structure, archaeological site and land necessary for access under a historic site exemption.",
      },
      { type: "text", name: "Sect3-15other", label: "Other reason (if the “Other” box applies)" },
      { type: "checkbox", name: "Reason for protest 15", label: "Other." },
    ],
  },
  {
    title: "Section 4: Evidence",
    fields: [
      {
        type: "text",
        name: "Sect4-1",
        label: "Total number of pages or images submitted as evidence with this affidavit",
      },
    ],
  },
  {
    title: "Section 5: Statement of Facts or Arguments",
    fields: [
      {
        type: "text",
        name: "Sect5-1",
        label: "State all facts or arguments that may help resolve your case",
        aiSuggestable: true,
        multiline: true,
      },
    ],
  },
  {
    title: "Section 6: Hearing Type",
    fields: [
      {
        type: "radio",
        name: "ARB hearing",
        label: "How do you intend to participate in the ARB hearing? (select only one)",
        required: true,
        options: [
          "I do not intend to appear at the hearing in person, by telephone conference call or by videoconference. \nThis affidavit and the evidence and/or argument submitted with it may be used at the hearing if I do not appear in person at the hearing.",
          "I intend to appear in person at the hearing.  \nThis affidavit may not be used for the hearing if I do appear in person at the hearing. This affidavit may not be used for the hearing if I do appear in person at the hearing.",
          "I intend to appear by telephone conference call for the hearing.  This affidavit and the evidence submitted with it may be used for the hearing if I do not appear in person at the hearing.",
          "I intend to appear by videoconference for the hearing. This affidavit and the evidence submitted with it may be used for the hearing if I do not appear in person at the hearing.*",
        ],
      },
    ],
  },
  {
    title: "Section 7: Name and Signature",
    fields: [
      {
        type: "text",
        name: "Texas County name",
        label: "County where this affidavit is sworn (“County of ___”)",
        required: true,
      },
      {
        type: "text",
        name: "Affiant Name",
        label:
          "Affiant name (“personally appeared ___, who, being duly sworn, deposed as follows”)",
        required: true,
      },
      {
        type: "text",
        name: "Affiant Name_2",
        label: "Affiant name again (“My name is ___”)",
        required: true,
      },
      {
        type: "text",
        name: "sect7_4",
        label: "Total pages/images being submitted as evidence (repeats Section 4's count)",
      },
      {
        type: "text",
        name: "day of",
        label: "Signed on this day (number)",
        required: true,
        suggestions: signatureDaySuggestion,
      },
      {
        type: "text",
        name: "Sig Month",
        label: "Signed this month",
        required: true,
        suggestions: signatureMonthSuggestion,
      },
      {
        type: "text",
        name: "Sig Year",
        label: "Signed year (last 2 digits, printed form already shows “20__”)",
        required: true,
        suggestions: signatureYearSuggestion,
      },
    ],
  },
];

// Required markers below are grounded in the form's own text (see the
// pdftotext extraction this was checked against): STEP 2 and STEP 4 are
// each explicitly "(check one)" groups, STEP 6's signing-capacity boxes are
// the same, and the signature block (Date/Printed Name) is required to
// execute the form at all. Per-property account number/address/legal
// description are each only "at least one of" and only when NOT granting
// authority for all property — genuinely conditional, so left unmarked
// rather than approximated.
export const APPOINTMENT_OF_AGENT_SCHEMA: FieldSection[] = [
  {
    title: "Appraisal District",
    fields: [
      {
        type: "text",
        name: "Appraisal District Name",
        label: "Appraisal District Name",
        required: true,
      },
      {
        type: "text",
        name: "Date Received appraisal district use only",
        label: "Date Received (appraisal district use only)",
        dateFormat: true,
      },
    ],
  },
  {
    title: "STEP 1: Owner's Name and Address",
    fields: [
      { type: "text", name: "Name", label: "Name", required: true },
      {
        type: "text",
        name: "Telephone Number include area code",
        label: "Telephone Number (include area code)",
      },
      { type: "text", name: "Address", label: "Address" },
      { type: "text", name: "City State Zip Code", label: "City, State, Zip Code" },
    ],
  },
  {
    title: "STEP 2: Identify the Property",
    requireAtLeastOne: true,
    fields: [
      {
        type: "checkbox",
        name: "all property listed for me at the above address",
        label: "All property listed for me at the above address",
      },
      {
        type: "checkbox",
        name: "the property(ies) listed below:",
        label: "The property(ies) listed below",
      },
      {
        type: "text",
        name: "Appraisal District Account Number_2",
        label: "Property 1 — Appraisal District Account Number",
      },
      {
        type: "text",
        name: "Physical or Situs Address of Property_2",
        label: "Property 1 — Physical or Situs Address",
      },
      { type: "text", name: "Legal Description_2", label: "Property 1 — Legal Description" },
      {
        type: "text",
        name: "Appraisal District Account Number_3",
        label: "Property 2 — Appraisal District Account Number",
      },
      {
        type: "text",
        name: "Physical or Situs Address of Property_3",
        label: "Property 2 — Physical or Situs Address",
      },
      { type: "text", name: "Legal Description_3", label: "Property 2 — Legal Description" },
      {
        type: "text",
        name: "Appraisal District Account Number_4",
        label: "Property 3 — Appraisal District Account Number",
      },
      {
        type: "text",
        name: "Physical or Situs Address of Property_4",
        label: "Property 3 — Physical or Situs Address",
      },
      { type: "text", name: "Legal Description_4", label: "Property 3 — Legal Description" },
      {
        type: "text",
        name: "Appraisal District Account Number_5",
        label: "Property 4 — Appraisal District Account Number",
      },
      {
        type: "text",
        name: "Physical or Situs Address of Property_5",
        label: "Property 4 — Physical or Situs Address",
      },
      { type: "text", name: "Legal Description_5", label: "Property 4 — Legal Description" },
      {
        type: "text",
        name: "Number of additional sheets attatched",
        label: "Number of additional sheets attached",
      },
    ],
  },
  {
    title: "STEP 3: Identify the Agent",
    fields: [
      { type: "text", name: "Name_2", label: "Name", required: true },
      {
        type: "text",
        name: "Telephone Number include area code_2",
        label: "Telephone Number (include area code)",
      },
      { type: "text", name: "Address_2", label: "Address" },
      { type: "text", name: "City State Zip Code_2", label: "City, State, Zip Code" },
    ],
  },
  {
    title: "STEP 4: Specify the Agent's Authority",
    requireAtLeastOne: true,
    fields: [
      {
        type: "checkbox",
        name: "all property tax matters concerning the property identified",
        label: "All property tax matters concerning the property identified",
      },
      {
        type: "checkbox",
        name: "the following specific property tax matters:",
        label: "The following specific property tax matters",
      },
      {
        type: "text",
        name: "specific property tax matters",
        label: "Specific property tax matters (if the box above is checked)",
      },
      {
        type: "radio",
        name: "The agent identified above is authorized to receive confidential information pursuant to Tax Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):",
        label: "Agent authorized to receive confidential information?",
        options: ["Yes", "No"],
        required: true,
      },
      {
        type: "checkbox",
        name: "all communications from the chief appraiser",
        label: "Deliver all communications from the chief appraiser to the agent",
      },
      {
        type: "checkbox",
        name: "all communications from the appraisal review board",
        label: "Deliver all communications from the appraisal review board to the agent",
      },
      {
        type: "checkbox",
        name: "all communications from all taxing units participating in the appraisal district",
        label:
          "Deliver all communications from all taxing units participating in the appraisal district to the agent",
      },
    ],
  },
  {
    title: "STEP 5: Date the Agent's Authority Ends",
    fields: [
      {
        type: "text",
        name: "Date Agents Authority Ends",
        label: "Date Agent's Authority Ends",
        suggestions: agentAuthorityEndSuggestions,
        dateFormat: true,
      },
    ],
  },
  {
    title: "STEP 6: Identification, Signature, and Date",
    requireAtLeastOne: true,
    fields: [
      {
        type: "text",
        name: "Date",
        label: "Date",
        suggestions: todaySuggestion,
        dateFormat: true,
        required: true,
      },
      {
        type: "text",
        name: "Name of Property Owner",
        label: "Printed Name of Property Owner, Property Manager or Other Authorized Person",
        required: true,
      },
      { type: "text", name: "Title", label: "Title" },
      {
        type: "checkbox",
        name: "the property owner",
        label: "The individual signing this form is the property owner",
      },
      {
        type: "checkbox",
        name: "a property manager authorized to designate agents for the owner",
        label:
          "The individual signing this form is a property manager authorized to designate agents for the owner",
      },
      {
        type: "checkbox",
        name: "other person authorized to act on behalf of the owner other than the person being designated as agent",
        label:
          "The individual signing this form is another person authorized to act on behalf of the owner (other than the agent)",
      },
    ],
  },
];

// Texas Comptroller Form 50-144, "Business Personal Property Rendition of
// Taxable Property" — filed BEFORE any protest exists (see requiredFilingSteps'
// BPP variant in filing-workflow.ts), so unlike the three schemas above this
// one is keyed to a BppAccountRecord, not a PropertyRecord.
//
// Real field names/labels/radio options read directly off the actual PDF's
// AcroForm (public/forms/50-144.pdf, fetched from comptroller.texas.gov/
// forms/50-144.pdf and inspected via pdf-lib getForm().getFields()), same
// discipline as the other three forms — none are guessed. The full form has
// 306 fields across 4 pages, most of them repeated itemized-schedule grid
// rows (Schedules A/B/C/D, up to 45 line items across the four). This schema
// covers page 1 (general business info + the required "Total market value of
// your property" threshold + affirmation/signature) and one row of Schedule
// A — the lump-sum "good faith estimate of market value" alternative to full
// itemization Tax Code §22.01(l) explicitly allows, which is also the
// only reasonable AI-extraction-driven path (this app has no per-asset
// inventory data to itemize from). Schedules B (vehicles other than
// inventory), C (leased/borrowed property), and D (motor vehicles) are left
// for a future pass if a customer's real filing needs them — nothing here
// prevents opening the downloaded PDF directly in another editor to add them.
export const BPP_RENDITION_SCHEMA: FieldSection[] = [
  {
    title: "General Information",
    fields: [
      { type: "text", name: "Tax Year", label: "Tax Year", required: true },
      {
        type: "text",
        name: "Appraisal District Account Number",
        label: "Appraisal District Account Number",
      },
      { type: "text", name: "Business Name", label: "Business Name", required: true },
      { type: "text", name: "Business Owner", label: "Business Owner" },
      {
        type: "text",
        name: "Property Location Address, City, State, ZIP Code",
        label: "Property Location Address, City, State, ZIP Code",
        required: true,
      },
      { type: "text", name: "Email", label: "Email" },
      {
        type: "text",
        name: "Phone (area code and number)",
        label: "Phone (area code and number)",
      },
    ],
  },
  {
    title: "Ownership & Representation",
    fields: [
      {
        type: "radio",
        name: "Ownership type",
        label: "Ownership Type",
        options: ["Individual", "Corporation", "Partnership", "Other (Please specify)"],
      },
      {
        type: "text",
        name: "Ownership Type (optional) is Other",
        label: "If Other, specify",
      },
      {
        type: "radio",
        name: "Representation",
        label: "This rendition is being filed by",
        options: [
          "Owner, employee or employee of an affiliated entity of the owner",
          "Authorized Agent",
          " Fiduciary",
          "Secured Party",
        ],
      },
      {
        type: "text",
        name: "Name of Owner, Authorized Agent, Fiduciary or Secured Party",
        label: "Name of Owner, Authorized Agent, Fiduciary or Secured Party",
      },
    ],
  },
  {
    title: "Business Description",
    fields: [
      {
        type: "text",
        name: "Business Description",
        label: "Describe the type of business conducted at this location",
        multiline: true,
      },
      {
        type: "checkbox",
        name: "Business Type: Manufacturing",
        label: "Manufacturing",
      },
      { type: "checkbox", name: "Business Type: Wholesale", label: "Wholesale" },
      { type: "checkbox", name: "Business Type: Retail", label: "Retail" },
      { type: "checkbox", name: "Business Type: Service", label: "Service" },
      { type: "checkbox", name: "Business Type: New Business", label: "New Business" },
      {
        type: "text",
        name: "Business Start Date at Location",
        label: "Business Start Date at Location",
        dateFormat: true,
      },
    ],
  },
  {
    title: "Schedule A — General Personal Property (Good Faith Estimate)",
    fields: [
      {
        type: "radio",
        name: "Total market value of your property",
        label: "Total market value of your business personal property",
        options: ["under $20,000", "$20,000 or more"],
        required: true,
      },
      {
        type: "text",
        name: "ScA:General Property Description by TypeCategoryRow1",
        label: "General description of property/category",
        required: true,
      },
      {
        type: "text",
        name: "ScA:Estimate of Quantity of Each TypeRow1",
        label: "Estimate of quantity",
      },
      {
        type: "text",
        name: "ScA:Good Faith Estimate of Market ValueRow1",
        label: "Good faith estimate of market value",
        required: true,
      },
      {
        type: "text",
        name: "ScA:Historical Cost When NewRow1",
        label: "Historical cost when new (optional)",
      },
      {
        type: "text",
        name: "ScA:Year AcquiredRow1",
        label: "Year acquired (optional)",
      },
    ],
  },
  {
    title: "Affirmation & Signature",
    fields: [
      {
        type: "text",
        name: "Printed Name of Authorized Individual",
        label: "Printed Name of Authorized Individual",
        required: true,
        suggestions: (values) => {
          const owner = values["Name of Owner, Authorized Agent, Fiduciary or Secured Party"];
          return typeof owner === "string" && owner
            ? [{ label: "Same as representation name above", value: owner }]
            : [];
        },
      },
    ],
  },
];

// This app has no per-asset inventory data to itemize from (see the schema
// comment above), so the good-faith estimate defaults to the BPP account's
// own rendered_value — the same real number driving its subscription
// bracket and displayed everywhere else in the app — rather than left blank
// for the user to re-type a figure they already entered at intake.
export function getBppRenditionDefaults(
  account: Pick<
    import("./bpp-accounts").BppAccountRecord,
    "businessName" | "accountNumber" | "locationAddress" | "taxYear" | "renderedValue"
  >,
): FieldValues {
  const values: FieldValues = {
    "Tax Year": account.taxYear != null ? String(account.taxYear) : "",
    "Appraisal District Account Number": account.accountNumber ?? "",
    "Business Name": account.businessName ?? "",
    "Property Location Address, City, State, ZIP Code": account.locationAddress ?? "",
    Representation: "Owner, employee or employee of an affiliated entity of the owner",
    "ScA:General Property Description by TypeCategoryRow1":
      "All furniture, fixtures, equipment, and inventory used in business operations at this location",
  };
  if (account.renderedValue != null) {
    values["ScA:Good Faith Estimate of Market ValueRow1"] =
      account.renderedValue.toLocaleString("en-US");
    values["Total market value of your property"] =
      account.renderedValue < 20_000 ? "under $20,000" : "$20,000 or more";
  }
  return values;
}

// The one grounds-for-protest checkbox our data can actually back — every
// strategy our AI case prep can recommend (Market Value, Unequal Appraisal,
// Condition-Based Reduction, Combined Approach) reduces to Form 50-132's
// "Reason for protest 1" ("Incorrect appraised (market) value and/or value is
// unequal compared with other properties") — the form has no separate box per
// strategy. Left unchecked with no guess if no strategy has been generated yet.
// $57M/$62.9M "or greater" fields each expose only ONE real option on the
// actual PDF (see NOTICE_OF_PROTEST_SCHEMA above) — "No" for the lower
// threshold, "Yes" for the higher one. A value strictly between the two has
// no matching checkbox on the real form, so it's left unanswered rather than
// guessed.
const SPECIAL_PANEL_LOWER_THRESHOLD = 57_000_000;
const SPECIAL_PANEL_UPPER_THRESHOLD = 62_900_000;

export function getNoticeOfProtestDefaults(
  property: PropertyRecord,
  taxYear: number | null,
  strategyRecommendation: string | null,
  authorization?: AuthorizationRecord | null,
): FieldValues {
  const values: FieldValues = {
    "Appraisal Districts Name": property.cad ?? "",
    "Appraisal District Account Number": property.accountNumber ?? "",
    "Tax Year": taxYear != null ? String(taxYear) : "",
    "Name of Property Owner or Lessee": property.ownerName ?? "",
    // This app has never collected a mailing address separate from the
    // property's physical address — the property address is the best real
    // data available, and stays fully editable if the owner's actual mailing
    // address differs.
    "Mailing Address City State ZIP Code": property.address ?? "",
    "Physical Address": property.address ?? "",
    "Phone Number area code and number": authorization?.phone ?? "",
    "Reason for protest 1": !!strategyRecommendation,
    "Appraisal districts value assigned to property":
      property.totalValue != null ? property.totalValue.toLocaleString("en-US") : "",
    // The person operating this in-app signing flow is always the account's
    // own signed-in user — i.e. the property owner — regardless of whether
    // CorvusPT is separately authorized as agent for case management.
    "Certification and Signature": "Property Owner",
    "Print Name of Property Owner or Authorized Representative":
      authorization?.isEntity && authorization.entityName
        ? authorization.entityName
        : authorization
          ? `${authorization.firstName} ${authorization.lastName}`
          : (property.ownerName ?? ""),
    // Same real value the "Today" suggestion chip computes (todaySuggestion())
    // — signing a Notice of Protest today is the overwhelmingly common case,
    // and leaving this blank by default meant every single filer had to
    // manually click the chip or type today's own date before this required
    // field would stop blocking Download/Continue. Still fully editable if
    // the actual signing date differs.
    "Date of Signature": formatDateSuggestion(new Date()),
  };

  if (property.totalValue != null) {
    if (property.totalValue < SPECIAL_PANEL_LOWER_THRESHOLD) {
      values["Property is appraised at $57 million or greater"] = "No";
    } else if (property.totalValue >= SPECIAL_PANEL_UPPER_THRESHOLD) {
      values["Property is appraised at $62.9 million or greater"] = "Yes";
    }
  }

  return values;
}

// evidenceDocCount is the customer's REAL uploaded-evidence count (see
// evidenceDocuments in ai-report.tsx/CaseDetailModal.tsx) — filled directly
// into both of the form's "total pages or images" fields rather than left
// for the user to count by hand, same "autofill what's actually known"
// principle as every other field here. Still fully editable afterward: the
// real number of PAGES/IMAGES can differ from the number of uploaded FILES
// (e.g. a single multi-page PDF), so this is a starting point, not a claim
// of certainty.
export function getEvidenceDeclarationDefaults(
  property: PropertyRecord,
  taxYear: number | null,
  evidenceDocCount: number,
): FieldValues {
  const evidenceCount = evidenceDocCount > 0 ? String(evidenceDocCount) : "";
  return {
    "Appraisal Districts County Name": property.cad ?? "",
    ADAN: property.accountNumber ?? "",
    "Tax Year": taxYear != null ? String(taxYear) : "",
    "Name of Property Owner or Lessee": property.ownerName ?? "",
    "Mailing Address City State ZIP Code": property.address ?? "",
    "Sect2-1": property.address ?? "",
    "Sect4-1": evidenceCount,
    sect7_4: evidenceCount,
    "Affiant Name": property.ownerName ?? "",
    "Affiant Name_2": property.ownerName ?? "",
  };
}

function splitAgentAddress(): { street: string; cityStateZip: string } {
  const [street, ...rest] = AGREEMENT.address.split(",");
  return { street: street.trim(), cityStateZip: rest.join(",").trim() };
}

export function getAppointmentOfAgentDefaults(
  authorization: AuthorizationRecord,
  property: PropertyRecord,
): FieldValues {
  const ownerName =
    authorization.isEntity && authorization.entityName
      ? authorization.entityName
      : `${authorization.firstName} ${authorization.lastName}`;
  const { street, cityStateZip } = splitAgentAddress();
  const confidentialFieldName =
    "The agent identified above is authorized to receive confidential information pursuant to Tax Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):";

  return {
    "Appraisal District Name": property.cad ?? "",
    Name: ownerName,
    "Telephone Number include area code": authorization.phone ?? "",
    "the property(ies) listed below:": true,
    "Appraisal District Account Number_2": property.accountNumber ?? "",
    "Physical or Situs Address of Property_2": property.address ?? "",
    Name_2: "CorvusPT.ai",
    "Telephone Number include area code_2": AGREEMENT.phone,
    Address_2: street,
    "City State Zip Code_2": cityStateZip,
    "all property tax matters concerning the property identified": true,
    [confidentialFieldName]: "Yes",
    "all communications from the chief appraiser": true,
    "all communications from the appraisal review board": true,
    "all communications from all taxing units participating in the appraisal district": true,
    "Name of Property Owner": ownerName,
    Title: authorization.isEntity ? (authorization.entityRelationship ?? "") : "",
    "the property owner": !authorization.isEntity,
    // Same reasoning as getNoticeOfProtestDefaults' own "Date of Signature"
    // — defaults to today (matching this field's own "Today" suggestion
    // chip) instead of leaving a required field blank for every filer to
    // fill in by hand. Still fully editable.
    Date: formatDateSuggestion(new Date()),
  };
}

// Form 50-162's Step 2 has room for 4 properties total — the case's own
// property already fills the first slot (see "..._2" fields above); this
// fills the next 3 ("Property 2/3/4" per the form's own labels, "..._3"/"_4"/
// "_5" per its real field names) from other REAL CAD records found under the
// same ownership in the same appraisal district (an agent authorization is
// filed per-district, so a sibling property in a different county has no
// business on this specific form). Caller is responsible for finding those
// records (searchPropertiesByOwner) and filtering to the right county/
// excluding the case's own property — this just does the field mapping.
export function getAdditionalOwnerPropertyFields(matches: CadRecord[]): FieldValues {
  const values: FieldValues = {};
  const suffixes = ["_3", "_4", "_5"];
  matches.slice(0, suffixes.length).forEach((m, i) => {
    const suffix = suffixes[i];
    values[`Appraisal District Account Number${suffix}`] = m.accountNumber ?? "";
    values[`Physical or Situs Address of Property${suffix}`] = m.propertyAddress ?? "";
    values[`Legal Description${suffix}`] = m.legalDescription ?? "";
  });
  return values;
}

async function loadTemplate(path: string): Promise<PDFDocument> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  const bytes = await res.arrayBuffer();
  return PDFDocument.load(bytes);
}

function setText(doc: PDFDocument, field: string, value: string | null | undefined) {
  if (!value) return;
  try {
    doc.getForm().getTextField(field).setText(value);
  } catch {
    // Field renamed/removed upstream by the Comptroller — fail soft rather than
    // block the whole document over one cosmetic field.
  }
}

function check(doc: PDFDocument, field: string) {
  try {
    doc.getForm().getCheckBox(field).check();
  } catch {
    // see setText()
  }
}

function selectRadio(doc: PDFDocument, field: string, option: string) {
  try {
    doc.getForm().getRadioGroup(field).select(option);
  } catch {
    // see setText()
  }
}

// Generic — every field on either form is one of text/checkbox/radio, so one
// fill loop over the schema (rather than a bespoke function per form) covers
// both, driven entirely by the (possibly user-edited) values passed in.
function fillFields(doc: PDFDocument, schema: FieldSection[], values: FieldValues) {
  for (const section of schema) {
    for (const field of section.fields) {
      const value = values[field.name];
      if (field.type === "text") {
        setText(doc, field.name, typeof value === "string" ? value : undefined);
      } else if (field.type === "checkbox") {
        if (value) check(doc, field.name);
      } else if (field.type === "radio") {
        if (typeof value === "string" && value) selectRadio(doc, field.name, value);
      }
    }
  }
}

export async function buildPdf(
  templatePath: string,
  schema: FieldSection[],
  values: FieldValues,
): Promise<Uint8Array> {
  const doc = await loadTemplate(templatePath);
  fillFields(doc, schema, values);
  return doc.save();
}

// Neither form's signature line is a normal fillable text field (see the file
// header comment) — Form 50-132's is a true /Sig field, Form 50-162's has no
// AcroForm field at all over the signature line, just "Signature1" as a bare
// /Sig placeholder. Both are drawn onto directly, positioned at the real
// widget rectangle each field reports (read via pdf-lib against the actual
// PDFs — see the comment on SIGNATURE_FIELD_RECT — not guessed). The Date
// field next to each signature IS a normal text field, so it goes through
// the regular fillFields() pass like everything else.
// maxDrawHeight is NOT the widget's own height above (that's just the box
// around the printed line itself, a couple points tall) — it's real
// clearance measured against the actual PDF's neighboring field widgets, so
// a drawn signature can rise above the line the way ink actually does on a
// paper form, without overlapping the field above it:
//   50-132: "Print Name..." widget sits right above, its bottom edge at
//     y=148.606 vs. this signature line at y=117.289 — 28pt stays clear.
//   50-162: "Date Agent's Authority Ends" sits above, its bottom edge at
//     y=293.74 vs. this signature line at y=242.502 — 38pt stays clear.
const SIGNATURE_FIELD_RECT: Record<
  string,
  { page: number; x: number; y: number; width: number; height: number; maxDrawHeight: number }
> = {
  "forms/50-132.pdf": {
    page: 1,
    x: 63.8907,
    y: 117.289,
    width: 299.7253,
    height: 12.96,
    maxDrawHeight: 28,
  },
  "forms/50-162.pdf": {
    page: 1,
    x: 68.1542,
    y: 242.502,
    width: 295.5988,
    height: 32.001,
    maxDrawHeight: 38,
  },
  // 50-283's "Affiant Signature" is a true /Sig field, same as 50-132's —
  // drawn directly rather than plain-filled. Clearance here is genuinely
  // tight: the "Signed on this ___ day of ___, 20 ___" row sits right above
  // at y=386 (height 13), only 8pt above this line's own top edge (365+13)
  // — real measured numbers, not guessed, hence the smaller maxDrawHeight
  // than the other two forms.
  "forms/50-283.pdf": {
    page: 1,
    x: 29,
    y: 365,
    width: 305,
    height: 13,
    maxDrawHeight: 10,
  },
  // 50-144's "Signature of Authorized Individual" is a true /Sig field on
  // page 1 (index 0), same as 50-132's — drawn directly. "Printed Name of
  // Authorized Individual" sits right above at y=140.704 (height 12.96,
  // bottom edge ~140.7), vs. this line's own top edge at ~98.65 — about 42pt
  // clearance measured against the actual PDF; kept a few points short of
  // that, same margin-of-safety convention as the other three forms above.
  "forms/50-144.pdf": {
    page: 0,
    x: 54.9064,
    y: 85.689,
    width: 314.6396,
    height: 12.9597,
    maxDrawHeight: 32,
  },
};
const DATE_FIELD_NAME: Record<string, string> = {
  "forms/50-132.pdf": "Date of Signature",
  "forms/50-162.pdf": "Date",
  // No entry for 50-283 — its signature date is 3 separate real fields
  // ("day of"/"Sig Month"/"Sig Year", see EVIDENCE_DECLARATION_SCHEMA)
  // filled by the user/suggestion-chips like any other field, not
  // auto-injected at sign time the way the other two forms' single Date
  // field is.
  "forms/50-144.pdf": "Date of Signature",
};

export async function signPdf(
  templatePath: string,
  schema: FieldSection[],
  values: FieldValues,
  signature: SignatureValue,
  signedAt: Date,
): Promise<Uint8Array> {
  const doc = await loadTemplate(templatePath);
  const dateField = DATE_FIELD_NAME[templatePath];
  const formattedDate = signedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  fillFields(doc, schema, dateField ? { ...values, [dateField]: formattedDate } : values);

  const rect = SIGNATURE_FIELD_RECT[templatePath];
  if (rect) {
    const page = doc.getPages()[rect.page];
    if (signature.type === "draw") {
      const png = await doc.embedPng(signature.data);
      // Scaled against the real clearance above the line (maxDrawHeight),
      // not the printed line's own sliver of a widget box — that box is
      // just where the line sits, not how much room a real signature needs
      // to rise above it. Width is still capped to the line's real length.
      const scale = Math.min(rect.width / png.width, rect.maxDrawHeight / png.height, 1);
      const w = png.width * scale;
      const h = png.height * scale;
      page.drawImage(png, {
        x: rect.x + (rect.width - w) / 2,
        // Bottom of the signature sits right at the line, rising upward —
        // how a real signature actually sits on a printed line, rather
        // than centered inside the line's own tiny widget box.
        y: rect.y,
        width: w,
        height: h,
      });
    } else {
      const font = await doc.embedFont(StandardFonts.HelveticaOblique);
      const fontSize = Math.min(16, rect.height * 0.85);
      page.drawText(signature.data, {
        x: rect.x + 4,
        y: rect.y + (rect.height - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0.04, 0.17, 0.32),
      });
    }
  }

  return doc.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  // pdf-lib's .save() types its result as Uint8Array<ArrayBufferLike>, which TS's
  // DOM lib doesn't accept as a BlobPart (it wants a concrete ArrayBuffer) — the
  // bytes themselves are a plain Uint8Array at runtime, so this cast is safe.
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
