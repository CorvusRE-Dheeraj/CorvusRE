import { describe, expect, it } from "vitest";
import { meetingDetailsFromEmail } from "../../../../supabase/pt/functions/_shared/county-mail";
import {
  getCountyProtestInfo,
  informalReviewContact,
  mapsHref,
  telHref,
} from "./county-protest-info";

describe("meetingDetailsFromEmail", () => {
  it("reads the video link and dial-in from a district's informal-review email", () => {
    const m = meetingDetailsFromEmail({
      subject: "Informal Review Appointment - Account R-1234",
      text: "Your informal review is Oct 30 at 10:20 AM.\nJoin Zoom Meeting https://us06web.zoom.us/j/81234567890?pwd=abc.\nDial in: +1 346 248 7799 Meeting ID 812 3456 7890",
      html: null,
    });
    expect(m).toEqual({
      link: "https://us06web.zoom.us/j/81234567890?pwd=abc",
      dialIn: "+1 346 248 7799",
      about: "informal",
    });
  });

  it("takes a Teams link from the HTML href and ignores other URLs", () => {
    const m = meetingDetailsFromEmail({
      subject: "ARB hearing",
      text: "See https://collincad.org for details",
      html: '<a href="https://collincad.org">site</a> <a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_x?context=a&amp;b=1">Join</a>',
    });
    expect(m.link).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x?context=a&b=1");
    expect(m.about).toBe("hearing");
  });

  it("never takes a look-alike host", () => {
    const m = meetingDetailsFromEmail({
      subject: "Informal review",
      text: "https://zoom.us.evil.example/j/1 and https://notzoom.us/j/2",
      html: null,
    });
    expect(m.link).toBeNull();
  });
});

describe("informal review contact", () => {
  it("Collin CAD: booking page, both phone numbers, office address, no email", () => {
    const c = informalReviewContact(getCountyProtestInfo("Collin Central Appraisal District"))!;
    expect(c.bookingUrl).toBe("https://waitwhile.com/book/ccad-appraisal");
    expect(c.phones).toEqual(["469.742.9200", "866.467.1110"]);
    expect(c.email).toBeNull();
    expect(c.inPersonAddress).toBe("250 Eldorado Pkwy, McKinney, TX 75069");
  });

  it("falls back to the district's ARB contact", () => {
    const c = informalReviewContact(getCountyProtestInfo("Tarrant Appraisal District"))!;
    expect(c.phones).toEqual(["817-284-8884"]);
    expect(c.email).toBe("RES@TAD.ORG");
  });

  it("builds tap-to-call and map links", () => {
    expect(telHref("469.742.9200")).toBe("tel:+14697429200");
    expect(telHref("+1 (866) 467-1110")).toBe("tel:+18664671110");
    expect(telHref("ext 12")).toBeNull();
    expect(mapsHref("250 Eldorado Pkwy, McKinney")).toContain("250%20Eldorado%20Pkwy");
  });
});
