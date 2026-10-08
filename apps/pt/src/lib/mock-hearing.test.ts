import { describe, expect, it } from "vitest";
import {
  contextLines,
  CROSS_ROUNDS,
  LIMITS,
  nextPhase,
  sanitizeDebrief,
  sanitizeTranscript,
  sanitizeTurn,
  type SimContext,
  type Turn,
} from "../../../../supabase/pt/functions/_shared/hearing-simulator";

const ctx: SimContext = {
  address: "100 Main St, Austin",
  cad: "Travis CAD",
  accountNumber: "123456",
  taxYear: 2026,
  propertyType: "Office",
  appraisedValue: 2_500_000,
  landValue: 600_000,
  improvementValue: 1_900_000,
  ownerOpinion: 2_150_000,
  comps: [{ address: "102 Main St", value: 2_100_000, distanceMi: 0.3 }],
  compsMedian: 2_200_000,
  approaches: [
    { name: "Income Approach", value: 2_150_000, status: "indicated" },
    { name: "Cost Approach", value: null, status: "needs_data" },
  ],
  districtEvidence: null,
  evidenceFiles: ["Rent Roll 2026.pdf"],
};

const owner = (text = "answer"): Turn => ({ speaker: "owner", text });
const panel = (text = "q"): Turn => ({ speaker: "panel", text });

describe("nextPhase", () => {
  it("follows the order of a Texas ARB hearing", () => {
    expect(nextPhase([])).toBe("opening");
    const t: Turn[] = [panel(), owner()];
    expect(nextPhase(t)).toBe("district_case");
    for (let i = 0; i < CROSS_ROUNDS; i++) {
      t.push(panel(), owner());
      expect(nextPhase(t)).toBe("cross");
    }
    t.push(panel(), owner());
    expect(nextPhase(t)).toBe("closing");
    t.push(panel(), owner("closing statement"));
    expect(nextPhase(t)).toBe("done");
  });
});

describe("contextLines", () => {
  it("gives the simulator only the case's own facts", () => {
    const text = contextLines(ctx);
    expect(text).toContain("District appraised value: $2,500,000");
    expect(text).toContain("Owner's requested value: $2,150,000");
    expect(text).toContain("102 Main St: $2,100,000, 0.3 mi");
    expect(text).toContain("Cost Approach: not run");
    expect(text).toContain("district's own hearing evidence isn't on file");
    expect(text).toContain("Rent Roll 2026.pdf");
  });

  it("includes the district's evidence and its known weaknesses once reviewed", () => {
    const text = contextLines({
      ...ctx,
      districtEvidence: {
        indicatedValue: 2_600_000,
        summary: "Five sales comps.",
        weaknesses: ["Comp 3 is 42% smaller"],
      },
    });
    expect(text).toContain("argues for $2,600,000");
    expect(text).toContain("- Comp 3 is 42% smaller");
  });
});

describe("sanitizers", () => {
  it("keeps the panel in charge of opening and closing", () => {
    expect(sanitizeTurn({ speaker: "appraiser", text: "Hi" }, "opening").speaker).toBe("panel");
    expect(sanitizeTurn({ speaker: "appraiser", text: "Hi" }, "cross").speaker).toBe("appraiser");
    expect(sanitizeTurn({}, "district_case")).toEqual({
      speaker: "appraiser",
      text: expect.any(String),
    });
  });

  it("clamps the transcript the client sends", () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ speaker: "owner", text: `t${i}` }));
    const t = sanitizeTranscript([...long, { speaker: "x", text: "" }, null]);
    expect(t).toHaveLength(LIMITS.transcriptTurns);
    expect(t[t.length - 1].text).toBe("t59");
    expect(sanitizeTranscript("nope")).toEqual([]);
  });

  it("bounds the debrief", () => {
    const d = sanitizeDebrief({
      readiness: 140,
      summary: "Solid.",
      strengths: ["a", "", 3],
      answersToStrengthen: [{ question: "Why?", strongerAnswer: "Because." }, { question: "x" }],
    });
    expect(d.readiness).toBe(100);
    expect(d.strengths).toEqual(["a"]);
    expect(d.answersToStrengthen).toEqual([{ question: "Why?", strongerAnswer: "Because." }]);
    expect(sanitizeDebrief(null).readiness).toBe(0);
  });
});
