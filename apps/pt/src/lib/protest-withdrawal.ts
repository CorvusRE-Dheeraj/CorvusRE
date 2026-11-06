import { invokeEdgeFunction } from "./edge-functions";
import { lookupCadDirectory } from "./cad-directory";

// Withdraw a protest: the county's own withdrawal rules (read by AI off the
// appraisal district's website — see supabase/pt/functions/protest-withdrawal),
// then a ready-to-send email, a letter to download, or a phone script.

export type WithdrawalMethod = "email" | "letter" | "phone";

export type WithdrawalRules = {
  withdrawalDiscussed: boolean;
  summary: string | null;
  email: { accepted: boolean | null; address: string | null; notes: string | null };
  letter: { accepted: boolean | null; notes: string | null };
  phone: { accepted: boolean | null; number: string | null; notes: string | null };
  online: { accepted: boolean | null; url: string | null; notes: string | null };
  form: { name: string | null; url: string | null; required: boolean | null };
  steps: string[];
  deadline: string | null;
  otherRequirements: string[];
  sourceUrls: string[];
  retrievedAt: string;
};

export type DistrictContact = {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  mailingAddress: string | null;
  streetAddress: string | null;
};

export type WrittenDraft = { subject: string; body: string };
export type PhoneDraft = { opening: string; points: string[]; ask: string[]; closing: string };
export type DraftFacts = {
  ownerName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  accountNumber: string | null;
  address: string;
  taxYear: number | null;
};

export function countyCodeFor(cad: string | null | undefined): string | null {
  return lookupCadDirectory(cad)?.countyCode ?? null;
}

export async function loadWithdrawalRules(
  countyCode: string,
): Promise<{ rules: WithdrawalRules | null; contact: DistrictContact }> {
  return invokeEdgeFunction("protest-withdrawal", { action: "rules", countyCode });
}

export async function draftWithdrawal(
  countyCode: string,
  propertyId: string,
  method: WithdrawalMethod,
): Promise<{ draft: WrittenDraft | PhoneDraft; facts: DraftFacts }> {
  return invokeEdgeFunction("protest-withdrawal", {
    action: "draft",
    countyCode,
    propertyId,
    method,
  });
}

// What each way of withdrawing looks like for this county: whether the district's
// pages say it's accepted, where it goes, and the note to show. "unstated" means
// the pages didn't say either way — still possible, but confirm with the district.
export type MethodStatus = "accepted" | "not_accepted" | "unstated";
export type MethodOption = {
  method: WithdrawalMethod;
  status: MethodStatus;
  // Email address, mailing address or phone number to use.
  target: string | null;
  note: string | null;
};

const status = (v: boolean | null | undefined): MethodStatus =>
  v === true ? "accepted" : v === false ? "not_accepted" : "unstated";

export function methodOptions(
  rules: WithdrawalRules | null,
  contact: DistrictContact,
): MethodOption[] {
  return [
    {
      method: "email",
      status: status(rules?.email.accepted),
      target: rules?.email.address ?? contact.email,
      note: rules?.email.notes ?? null,
    },
    {
      method: "letter",
      status: status(rules?.letter.accepted),
      target: contact.mailingAddress ?? contact.streetAddress,
      note: rules?.letter.notes ?? null,
    },
    {
      method: "phone",
      status: status(rules?.phone.accepted),
      target: rules?.phone.number ?? contact.phone,
      note: rules?.phone.notes ?? null,
    },
  ];
}

// The method to suggest first: one the county says it accepts, preferring a
// written record (email, then letter) over a call.
export function suggestedMethod(options: MethodOption[]): WithdrawalMethod {
  const ok = (m: WithdrawalMethod) => options.find((o) => o.method === m);
  for (const m of ["email", "letter", "phone"] as const) {
    const o = ok(m);
    if (o?.status === "accepted" && o.target) return m;
  }
  for (const m of ["email", "letter"] as const) {
    const o = ok(m);
    if (o && o.status !== "not_accepted" && o.target) return m;
  }
  return "letter";
}

export function mailtoHref(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

export function phoneScriptText(d: PhoneDraft): string {
  return [
    "When they answer:",
    d.opening,
    "",
    "Say / have ready:",
    ...d.points.map((p) => `• ${p}`),
    "",
    "Ask:",
    ...d.ask.map((p) => `• ${p}`),
    "",
    "To finish:",
    d.closing,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

export function letterDate(now = new Date()): string {
  return now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// "P.O. Box 670, Kountze, TX 77625-0670" → ["P.O. Box 670", "Kountze, TX 77625-0670"].
export function addressLines(addr: string | null | undefined): string[] {
  if (!addr) return [];
  const parts = addr.split(/,\s*/).filter(Boolean);
  if (parts.length < 3) return [addr];
  return [parts.slice(0, -2).join(", "), parts.slice(-2).join(", ")];
}

// The full letter as plain text — date, to, RE line, the AI's body, then a
// signature block from the owner's own details.
export function letterText(opts: {
  contact: DistrictContact;
  subject: string;
  body: string;
  facts: DraftFacts;
  date?: string;
}): string {
  const { contact, subject, body, facts } = opts;
  const to = [
    "Appraisal Review Board",
    contact.name,
    ...addressLines(contact.mailingAddress ?? contact.streetAddress),
  ].filter(Boolean);
  const sig = [
    "",
    "",
    "______________________________",
    facts.ownerName ?? "Property owner",
    facts.ownerPhone,
    facts.ownerEmail,
  ].filter((l): l is string => l !== null && l !== undefined);
  return [opts.date ?? letterDate(), "", ...to, "", `RE: ${subject}`, "", body.trim(), ...sig].join(
    "\n",
  );
}

// A one-page (or more) letter PDF built in the browser with pdf-lib — loaded
// only when someone downloads.
export async function letterPdf(text: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const size = 11.5;
  const lineH = 16;
  const margin = 72;
  const pageW = 612;
  const pageH = 792;
  const maxW = pageW - margin * 2;
  // pdf-lib's standard fonts are WinAnsi only — swap the characters an AI draft
  // commonly uses that it can't encode.
  const clean = (s: string) =>
    s
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/•/g, "-")
      .replace(/…/g, "...")
      .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, "");
  const lines: string[] = [];
  for (const para of clean(text).split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxW && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;
  for (const l of lines) {
    if (y < margin) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    if (l) page.drawText(l, { x: margin, y, size, font, color: rgb(0, 0, 0) });
    y -= lineH;
  }
  return doc.save();
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
