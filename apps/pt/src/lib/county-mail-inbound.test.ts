import { describe, expect, it } from "vitest";
import { svixSignature, verifySvix } from "../../../../supabase/pt/functions/_shared/svix-verify";
import {
  countyForDomain,
  gmailConfirmationCode,
  isGmailForwardingConfirmation,
  withKnownDistricts,
} from "../../../../supabase/pt/functions/_shared/county-mail";

// A throwaway test secret, same shape as Resend's.
const SECRET = "whsec_" + btoa("test-secret-key-0123456789abcdef");

describe("verifySvix", () => {
  const body = '{"type":"email.received","data":{"email_id":"abc"}}';
  const now = 1_790_000_000;

  it("accepts a correctly signed request", async () => {
    const sig = await svixSignature(SECRET, "msg_1", String(now), body);
    const ok = await verifySvix(
      SECRET,
      { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` },
      body,
      now,
    );
    expect(ok).toBe(true);
  });

  it("accepts when one of several signatures matches", async () => {
    const sig = await svixSignature(SECRET, "msg_1", String(now), body);
    expect(
      await verifySvix(
        SECRET,
        { id: "msg_1", timestamp: String(now), signature: `v1,bogus v1,${sig}` },
        body,
        now,
      ),
    ).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, a stale timestamp and missing headers", async () => {
    const sig = await svixSignature(SECRET, "msg_1", String(now), body);
    const h = { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` };
    expect(await verifySvix(SECRET, h, body + " ", now)).toBe(false);
    expect(await verifySvix("whsec_" + btoa("other"), h, body, now)).toBe(false);
    expect(await verifySvix(SECRET, h, body, now + 600)).toBe(false);
    expect(await verifySvix(SECRET, { ...h, signature: null }, body, now)).toBe(false);
  });
});

describe("Gmail forwarding confirmation", () => {
  it("is recognised and its code read", () => {
    expect(isGmailForwardingConfirmation("Gmail Team <forwarding-noreply@google.com>")).toBe(true);
    expect(
      gmailConfirmationCode(
        "(#123456789) Gmail Forwarding Confirmation - Receive Mail from properties@srclandbuilding.com",
        "",
      ),
    ).toBe("123456789");
    expect(
      gmailConfirmationCode("Gmail Forwarding Confirmation", "Confirmation code: 987654321"),
    ).toBe("987654321");
  });
});

describe("withKnownDistricts", () => {
  it("adds district domains the directory lacks", () => {
    const domains = withKnownDistricts(new Map([["dallascounty.org", "Dallas"]]));
    expect(countyForDomain("dallascad.org", domains)).toBe("Dallas");
    expect(countyForDomain("notices.wcad.org", domains)).toBe("Williamson");
    expect(countyForDomain("example.com", domains)).toBeNull();
  });
});
