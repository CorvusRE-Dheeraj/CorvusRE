import { describe, expect, it } from "vitest";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import {
  countyNameFromCad,
  courtNextAction,
  courtStages,
  courtTimeline,
  reviewCourtAppeal,
  type CourtAppealData,
} from "./court-appeal";

const property = (over: Partial<PropertyRecord> = {}): PropertyRecord =>
  ({
    id: "p",
    cad: "Collin Central Appraisal District",
    totalValue: 3_000_000,
    ...over,
  }) as PropertyRecord;

const protest = (over: Partial<ProtestRecord> = {}): ProtestRecord =>
  ({
    id: "x",
    status: "appealing",
    escalationPath: "appeal",
    arbDecision: "denied",
    arbDecisionDate: "2026-09-10",
    finalValue: 3_000_000,
    ...over,
  }) as ProtestRecord;

const NOW = new Date("2026-09-24T12:00:00");

describe("countyNameFromCad", () => {
  it("turns an appraisal district name into the county", () => {
    expect(countyNameFromCad("Collin Central Appraisal District")).toBe("Collin County");
    expect(countyNameFromCad("Dallas Central Appraisal District")).toBe("Dallas County");
    expect(countyNameFromCad("Tarrant Appraisal District")).toBe("Tarrant County");
    expect(countyNameFromCad(null)).toBeNull();
  });
});

describe("reviewCourtAppeal", () => {
  it("counts 60 days from the order date when the received date isn't known", () => {
    const r = reviewCourtAppeal(property(), protest(), null, NOW);
    expect(r.ready).toBe(true);
    expect(r.basis).toBe("order");
    expect(r.deadline).toBe("2026-11-09");
    expect(r.daysRemaining).toBe(46);
    expect(r.courtName).toBe("District court of Collin County");
  });

  it("counts from the date the owner received the order when given", () => {
    const r = reviewCourtAppeal(property(), protest(), { orderReceivedDate: "2026-09-20" }, NOW);
    expect(r.basis).toBe("received");
    expect(r.deadline).toBe("2026-11-19");
  });

  it("flags an expired deadline and the SOAH alternative over $1M", () => {
    const r = reviewCourtAppeal(property(), protest({ arbDecisionDate: "2026-06-01" }), null, NOW);
    expect(r.expired).toBe(true);
    expect(r.overSoahFloor).toBe(true);
    expect(r.requirements.join(" ")).toMatch(/SOAH/);
  });

  it("is not ready until the ARB has decided", () => {
    expect(
      reviewCourtAppeal(
        property(),
        protest({ arbDecision: null, arbDecisionDate: null }),
        null,
        NOW,
      ).ready,
    ).toBe(false);
  });
});

describe("stages and next action", () => {
  const current = (p: ProtestRecord, d: CourtAppealData | null) =>
    courtStages(p, d)
      .filter((s) => s.state === "current")
      .map((s) => s.id);

  it("moves through the stages one at a time", () => {
    expect(current(protest(), null)).toEqual(["legal_review"]);
    expect(current(protest(), { attorney: { name: "A", firm: "", email: "", phone: "" } })).toEqual(
      ["petition_filed"],
    );
    expect(current(protest(), { petitionFiledAt: "2026-10-01T00:00:00Z" })).toEqual(["court_case"]);
    expect(
      courtStages(protest({ status: "resolved" }), null).every((s) => s.state === "done"),
    ).toBe(true);
  });

  it("names what is actually needed next, in order", () => {
    const p = protest();
    expect(courtNextAction(p, null).label).toBe("Review Court Appeal Deadline");
    expect(courtNextAction(p, { deadlineAckAt: "x" }).label).toBe("Prepare Case for Attorney");
    expect(courtNextAction(p, { deadlineAckAt: "x", packageAt: "x" }).label).toBe("Add Attorney");
    expect(
      courtNextAction(p, {
        deadlineAckAt: "x",
        packageAt: "x",
        attorney: { name: "A", firm: "", email: "", phone: "" },
      }).label,
    ).toBe("Confirm Petition Filed");
    expect(courtNextAction(p, { petitionFiledAt: "x" }).label).toBe("Add Court Update");
    expect(courtNextAction(protest({ status: "resolved" }), null).target).toBe("monitoring");
  });
});

describe("courtTimeline", () => {
  it("lists the petition and updates in date order", () => {
    const t = courtTimeline({
      petitionFiledAt: "2026-10-01T00:00:00Z",
      court: "Collin County",
      updates: [
        {
          id: "2",
          date: "2026-11-01",
          type: "order",
          title: "Scheduling order",
          summary: "s",
          documentId: null,
        },
        {
          id: "1",
          date: "2026-10-05",
          type: "notice",
          title: "Citation",
          summary: "c",
          documentId: null,
        },
      ],
    });
    expect(t.map((x) => x.title)).toEqual([
      "Petition filed",
      "Court notice: Citation",
      "Court order: Scheduling order",
    ]);
  });
});

describe("reviewCourtAppeal with malformed dates", () => {
  // Production crash E-SK9HQQ: a timestamp in arbDecisionDate made an Invalid
  // Date and toISOString() threw, blanking the case page.
  it("reads a full timestamp as its day", () => {
    const r = reviewCourtAppeal(
      property(),
      protest({ arbDecisionDate: "2026-09-10T00:00:00+00:00" }),
      null,
      NOW,
    );
    expect(r.deadline).toBe("2026-11-09");
  });
  it("returns no deadline instead of throwing for garbage", () => {
    expect(() =>
      reviewCourtAppeal(property(), protest({ arbDecisionDate: "not a date" }), null, NOW),
    ).not.toThrow();
    const r = reviewCourtAppeal(property(), protest({ arbDecisionDate: "not a date" }), null, NOW);
    expect(r.deadline).toBeNull();
    expect(r.daysRemaining).toBeNull();
  });
  it("ignores an empty received date", () => {
    const r = reviewCourtAppeal(
      property(),
      protest(),
      { orderReceivedDate: "" } as CourtAppealData,
      NOW,
    );
    expect(r.deadline).toBe("2026-11-09");
  });
});

describe("court appeal — missing facts and upcoming deadlines", () => {
  it("flags what isn't on file instead of assuming it", async () => {
    const { courtMissing } = await import("./court-appeal");
    const flags = courtMissing(
      { arbDecision: "denied", arbDecisionDate: "2026-10-01" } as never,
      {},
      { arbOrderDocument: false, requestedValue: false },
    );
    expect(flags.join(" ")).toMatch(/received the ARB order/);
    expect(flags.join(" ")).toMatch(/isn't uploaded/);
    expect(flags.join(" ")).toMatch(/requested/);
  });

  it("lists the appeal deadline until filed, then dates read from court documents", async () => {
    const { courtUpcoming } = await import("./court-appeal");
    const review = { deadline: "2026-12-30" } as never;
    const now = new Date("2026-11-12T12:00:00");
    expect(courtUpcoming(review, {}, now)[0].label).toMatch(/court appeal/);
    const after = courtUpcoming(
      review,
      {
        petitionFiledAt: "2026-11-20T12:00:00Z",
        updates: [
          {
            id: "u1",
            date: "2026-11-25",
            type: "hearing",
            title: "Docket control order",
            summary: "",
            documentId: null,
            deadlines: [
              { date: "2027-02-01", label: "Expert designation" },
              { date: "2026-01-01", label: "Already past" },
            ],
          },
        ],
      },
      now,
    );
    expect(after.map((a) => a.date)).toEqual(["2027-02-01"]);
  });
});
