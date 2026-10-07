// The ARB mock hearing: the model plays the appraisal district's appraiser
// and the Appraisal Review Board panel, the owner plays themselves. Pure
// pieces live here (shared by the edge function and the client's tests):
// the hearing's phase from the transcript, the case facts the simulator may
// use, and clamping whatever the model returns.
//
// A Texas ARB hearing runs: the panel chair opens and swears everyone in,
// the owner presents first, the district presents its evidence, each side
// may question the other, the panel asks its own questions, both close, and
// the panel deliberates. The simulator follows that order so practice
// matches the real room.

export type Speaker = "panel" | "appraiser" | "owner";
export type Turn = { speaker: Speaker; text: string };
export type Difficulty = "cooperative" | "typical" | "tough";
export type Phase =
  | "opening" // panel chair opens, invites the owner to present
  | "district_case" // appraiser presents the district's evidence
  | "cross" // appraiser and panel question the owner
  | "closing" // panel invites closing statements
  | "done"; // panel recesses to deliberate

export type SimContext = {
  address: string;
  cad: string | null;
  accountNumber: string | null;
  taxYear: number | null;
  propertyType: string | null;
  appraisedValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  ownerOpinion: number | null; // the value the owner is asking for, if set
  comps: { address: string; value: number | null; distanceMi: number | null }[];
  compsMedian: number | null;
  approaches: { name: string; value: number | null; status: string }[];
  districtEvidence: {
    indicatedValue: number | null;
    summary: string;
    weaknesses: string[];
  } | null;
  evidenceFiles: string[];
};

export const LIMITS = {
  turnChars: 900,
  ownerTurnChars: 2000,
  transcriptTurns: 40,
  listItems: 6,
  itemChars: 300,
} as const;

// Owner answers in the questioning phase before the panel moves to closing.
export const CROSS_ROUNDS = 4;

const ownerTurns = (t: Turn[]) => t.filter((x) => x.speaker === "owner").length;

// What the simulator should do next, from the transcript so far.
export function nextPhase(transcript: Turn[]): Phase {
  const owner = ownerTurns(transcript);
  const last = transcript[transcript.length - 1];
  if (transcript.length === 0) return "opening";
  if (last?.speaker !== "owner") return "done"; // waiting on the owner; caller shouldn't ask
  if (owner === 1) return "district_case";
  if (owner <= 1 + CROSS_ROUNDS) return "cross";
  if (owner === 2 + CROSS_ROUNDS) return "closing";
  return "done";
}

export const PHASE_INSTRUCTION: Record<Phase, string> = {
  opening:
    "Speak as the ARB panel chair. Open the hearing on the record: name the property and account, state the district's appraised value, note that testimony is under oath, and invite the owner to present their evidence and the value they are requesting. Two to four sentences.",
  district_case:
    "Speak as the district appraiser. Present the district's case for its value in response to what the owner just said: cite the district's evidence and the facts given, point to weaknesses in the owner's presentation, and end by asking the owner one pointed question.",
  cross:
    "Respond to the owner's last answer. Usually speak as the district appraiser pressing the weakest point in their case with one pointed question; sometimes (about one turn in three) speak as a panel member asking a neutral clarifying question. One question per turn.",
  closing:
    "Speak as the panel chair. Thank both sides, then invite the owner to give a brief closing statement summarizing the value they are requesting and why.",
  done: "Speak as the panel chair. Close the record and say the panel will deliberate and send its written order. Do not announce a decision.",
};

export const DIFFICULTY_INSTRUCTION: Record<Difficulty, string> = {
  cooperative:
    "The appraiser is courteous and open to a reasonable adjustment; questions are fair and give the owner room to explain.",
  typical:
    "The appraiser is professional and defends the district's value firmly, as most do: asks for support behind every number and points out gaps.",
  tough:
    "The appraiser is skeptical and persistent: challenges comparability, dates, adjustments and the credibility of owner-prepared numbers, and asks follow-ups when an answer is vague. Never rude.",
};

const usd = (n: number | null | undefined) =>
  n == null ? "unknown" : `$${Math.round(n).toLocaleString("en-US")}`;

// The only facts the simulator may cite — so the "district" never invents a
// sale or a number the real district couldn't have.
export function contextLines(c: SimContext): string {
  const lines = [
    `Property: ${c.address} (${c.propertyType ?? "type not on file"})`,
    `District: ${c.cad ?? "appraisal district"} · Account ${c.accountNumber ?? "unknown"} · Tax year ${c.taxYear ?? "unknown"}`,
    `District appraised value: ${usd(c.appraisedValue)} (land ${usd(c.landValue)}, improvements ${usd(c.improvementValue)})`,
    `Owner's requested value: ${c.ownerOpinion != null ? usd(c.ownerOpinion) : "not stated yet — the owner will state it"}`,
  ];
  if (c.comps.length)
    lines.push(
      `County comparables (appraised values)${c.compsMedian != null ? `, median ${usd(c.compsMedian)}` : ""}:`,
      ...c.comps
        .slice(0, 8)
        .map(
          (x) =>
            `- ${x.address}: ${usd(x.value)}${x.distanceMi != null ? `, ${x.distanceMi.toFixed(1)} mi` : ""}`,
        ),
    );
  if (c.approaches.length)
    lines.push(
      "Owner's valuation approaches:",
      ...c.approaches.map(
        (a) =>
          `- ${a.name}: ${a.status === "indicated" ? usd(a.value) : a.status === "supports_cad" ? `${usd(a.value)} (supports the district)` : "not run"}`,
      ),
    );
  if (c.districtEvidence)
    lines.push(
      `District's hearing evidence argues for ${usd(c.districtEvidence.indicatedValue)}. ${c.districtEvidence.summary}`.trim(),
      ...(c.districtEvidence.weaknesses.length
        ? [
            "Known weaknesses in the district's evidence (the owner may raise these; the appraiser should defend against them):",
            ...c.districtEvidence.weaknesses.slice(0, 6).map((w) => `- ${w}`),
          ]
        : []),
    );
  else
    lines.push(
      "The district's own hearing evidence isn't on file — the appraiser argues from the appraisal roll, mass-appraisal models and the comparables above.",
    );
  lines.push(
    c.evidenceFiles.length
      ? `Owner's evidence on file: ${c.evidenceFiles.slice(0, 10).join(", ")}`
      : "The owner has no evidence documents on file.",
  );
  return lines.join("\n");
}

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const list = (v: unknown) =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, LIMITS.itemChars))
        .filter(Boolean)
        .slice(0, LIMITS.listItems)
    : [];

export function sanitizeTurn(raw: unknown, phase: Phase): Turn {
  const r = (raw ?? {}) as Record<string, unknown>;
  const fallback: Speaker = phase === "district_case" ? "appraiser" : "panel";
  const speaker: Speaker =
    phase === "opening" || phase === "closing" || phase === "done"
      ? "panel"
      : r.speaker === "panel" || r.speaker === "appraiser"
        ? r.speaker
        : fallback;
  return {
    speaker,
    text:
      str(r.text, LIMITS.turnChars) ||
      (phase === "done"
        ? "The record is closed. The panel will deliberate and send its written order."
        : "Could you explain how you arrived at your requested value?"),
  };
}

// Only the most recent turns, each clamped — the client sends the transcript.
export function sanitizeTranscript(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      speaker: (t.speaker === "panel" || t.speaker === "appraiser"
        ? t.speaker
        : "owner") as Speaker,
      text: str(
        t.text,
        t.speaker === "owner" ? LIMITS.ownerTurnChars : LIMITS.turnChars,
      ),
    }))
    .filter((t) => t.text)
    .slice(-LIMITS.transcriptTurns);
}

export type Debrief = {
  readiness: number; // 0-100
  summary: string;
  strengths: string[];
  gaps: string[];
  answersToStrengthen: { question: string; strongerAnswer: string }[];
  evidenceToBring: string[];
};

export function sanitizeDebrief(raw: unknown): Debrief {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = Number(r.readiness);
  return {
    readiness: Number.isFinite(n)
      ? Math.max(0, Math.min(100, Math.round(n)))
      : 0,
    summary: str(r.summary, 400),
    strengths: list(r.strengths),
    gaps: list(r.gaps),
    answersToStrengthen: Array.isArray(r.answersToStrengthen)
      ? r.answersToStrengthen
          .map((a) => {
            const x = (a ?? {}) as Record<string, unknown>;
            return {
              question: str(x.question, LIMITS.itemChars),
              strongerAnswer: str(x.strongerAnswer, 600),
            };
          })
          .filter((a) => a.question && a.strongerAnswer)
          .slice(0, 4)
      : [],
    evidenceToBring: list(r.evidenceToBring),
  };
}

export const isDifficulty = (v: unknown): v is Difficulty =>
  v === "cooperative" || v === "typical" || v === "tough";
