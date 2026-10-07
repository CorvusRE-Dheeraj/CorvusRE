import { describe, expect, it } from "vitest";
import directory from "../data/tx-cad-directory.json";
import {
  countyDomains,
  countyForDomain,
  matchCountyMail,
  parseGmailMessage,
  safeFileName,
  senderDomain,
  type GmailPart,
  type MailboxProperty,
} from "../../../../supabase/pt/functions/_shared/county-mail";

const b64url = (s: string) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("parseGmailMessage", () => {
  it("reads headers, the text body and attachments from a multipart message", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "Tarrant Appraisal District <noreply@tad.org>" },
        { name: "Subject", value: "Protest received — Account 00000123456" },
        { name: "Date", value: "Tue, 6 Oct 2026 10:00:00 -0500" },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: b64url("Your protest was received. Hearing: 6/2.") },
            },
            { mimeType: "text/html", body: { data: b64url("<p>Your protest was received.</p>") } },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "Hearing Notice.pdf",
          body: { attachmentId: "att-1", size: 52_000 },
        },
      ],
    };
    const m = parseGmailMessage(payload);
    expect(m.from).toBe("Tarrant Appraisal District <noreply@tad.org>");
    expect(m.subject).toMatch(/Protest received/);
    expect(m.text).toBe("Your protest was received. Hearing: 6/2.");
    expect(m.html).toMatch(/<p>/);
    expect(m.attachments).toEqual([
      {
        filename: "Hearing Notice.pdf",
        mimeType: "application/pdf",
        attachmentId: "att-1",
        size: 52_000,
      },
    ]);
  });

  it("falls back to the HTML body's text when there's no plain-text part", () => {
    const m = parseGmailMessage({
      mimeType: "text/html",
      headers: [],
      body: { data: b64url("<div>Additional information <b>requested</b></div>") },
    });
    expect(m.text).toBe("Additional information requested");
  });
});

describe("which county sent it", () => {
  const domains = countyDomains(directory as Parameters<typeof countyDomains>[0]);

  it("recognizes an appraisal district's own domain and subdomains, from the Comptroller directory", () => {
    expect(countyForDomain(senderDomain("TAD <noreply@tad.org>"), domains)).toBe("Tarrant");
    expect(countyForDomain("notices.tad.org", domains)).toBe("Tarrant");
    expect(countyForDomain(senderDomain("info@fbcad.org"), domains)).toBe("Fort Bend");
  });

  it("never treats a public mail provider as a county", () => {
    expect(countyForDomain("gmail.com", domains)).toBeNull();
    expect(countyForDomain(senderDomain("someone@example.com"), domains)).toBeNull();
  });
});

describe("matchCountyMail — one shared mailbox, every customer", () => {
  const props: MailboxProperty[] = [
    {
      id: "p1",
      user_id: "u1",
      address: "500 Elm St, Fort Worth, TX",
      account_number: "00000123456",
      county: "tarrant",
    },
    {
      id: "p2",
      user_id: "u2",
      address: "500 Elm St, Dallas, TX",
      account_number: "99887766",
      county: "dallas",
    },
    {
      id: "p3",
      user_id: "u3",
      address: "12 Oak Ave, Fort Worth, TX",
      account_number: "55443322",
      county: "tarrant",
    },
  ];

  it("files by account number from any sender", () => {
    expect(matchCountyMail({ subject: "Re: acct 00000123456", text: "" }, null, props)).toEqual({
      kind: "matched",
      propertyId: "p1",
      userId: "u1",
      reason: "account number",
    });
  });

  it("uses a street address only when the email comes from that county's district", () => {
    // "500 Elm St" exists in two counties — the Tarrant sender disambiguates.
    expect(
      matchCountyMail({ subject: "Hearing for 500 Elm St", text: "" }, "Tarrant", props),
    ).toMatchObject({
      kind: "matched",
      propertyId: "p1",
    });
    // The same text from a non-county sender isn't enough.
    expect(matchCountyMail({ subject: "Hearing for 500 Elm St", text: "" }, null, props)).toEqual({
      kind: "not_county",
    });
  });

  it("queues county mail it can't place, and ignores everything else", () => {
    expect(
      matchCountyMail({ subject: "Office closed Monday", text: "" }, "Tarrant", props),
    ).toEqual({
      kind: "county_unmatched",
      county: "Tarrant",
    });
    expect(matchCountyMail({ subject: "Lunch on Friday?", text: "" }, null, props)).toEqual({
      kind: "not_county",
    });
  });
});

describe("safeFileName", () => {
  it("strips characters that would break a storage path", () => {
    expect(safeFileName("Notice: 2026/Protest?.pdf")).toBe("Notice_ 2026_Protest_.pdf");
    expect(safeFileName("   ")).toBe("attachment");
  });
});
