// Pure helpers for collecting documents from a project's inbox
// (document-sources): which project inbox an email was sent to, where it came
// from, and turning the AI's suggested match into one the page can show —
// every id checked against the project, every uncertain match left for a
// person to confirm. No Deno APIs: apps/dp's vitest tests them.

export type MatchContext = {
  permits: { id: string; name: string; permit_number: string | null; permit_key: string }[];
  requirements: { id: string; permit_id: string; label: string }[];
  groups: { id: string; title: string }[];
  submissions: { id: string; permit_id: string; round: number }[];
};

export type Suggestion = {
  permit_id: string | null;
  requirement_id: string | null;
  doc_group: string | null;
  title: string;
  doc_kind: string;
  discipline: string;
  revision: string | null;
  destination: string; // "library" | "draft" | "support:<submission id>"
  confidence: number;
  match_summary: string;
  reason: string;
  round_evidence: string;
  status: "ready" | "needs_review";
};

export const DOC_KINDS = [
  "Design drawings",
  "Survey",
  "Supporting study",
  "Application form",
  "Owner authorization",
  "Comment response",
  "City correspondence",
  "Submission receipt",
  "Approved plans",
  "Issued permit",
  "Shared reference",
  "Other",
];

export const DISCIPLINES = [
  "General / Administration",
  "Architectural",
  "Civil",
  "Structural",
  "MEP",
  "Fire Protection",
  "Survey",
  "Landscape",
  "Owner",
  "City / Agency",
];

// "dp-a1b2c3d4e5@inbox.corvusre.com" (or "Name <…>") → "a1b2c3d4e5"
export function inboxToken(address: string): string | null {
  const m = /dp-([a-z0-9]{6,32})@/i.exec(address);
  return m ? m[1].toLowerCase() : null;
}

// "City of Round Rock <noreply@accela.com>" → "accela.com"
export function senderDomain(from: string): string | null {
  const addr = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  const d = addr.split("@")[1];
  return d ? d.replace(/^www\./, "") : null;
}

export function domainMatches(domain: string | null, patterns: string[]): boolean {
  if (!domain) return false;
  return patterns.some((p) => {
    const q = p.trim().toLowerCase().replace(/^@/, "").replace(/^www\./, "");
    return !!q && (domain === q || domain.endsWith("." + q));
  });
}

// First few http(s) links in an email — a portal notification often carries
// only a sign-in-protected link, not a file.
export function extractLinks(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>()]+/gi)) {
    const u = m[0].replace(/[.,;:!?\]]+$/, "");
    if (!out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

// A permit number printed in the subject, body or file name is exact evidence.
export function permitNumberHit(
  permits: MatchContext["permits"],
  haystack: string,
): string | null {
  const text = haystack.toLowerCase().replace(/\s+/g, " ");
  const hits = permits.filter(
    (p) => p.permit_number && p.permit_number.trim().length >= 4 &&
      text.includes(p.permit_number.trim().toLowerCase()),
  );
  return hits.length === 1 ? hits[0].id : null;
}

const s = (v: unknown, len = 400) => (typeof v === "string" ? v.trim().slice(0, len) : "");

// The AI's raw suggestion for one file → a checked suggestion. Ids that don't
// belong to the project are dropped; a submission round is only used when
// the AI states it AND it exists; anything short of a confident, specific
// match is "needs_review".
export function sanitizeSuggestion(
  raw: unknown,
  ctx: MatchContext,
  evidence: { exactPermitId: string | null; filename: string },
): Suggestion {
  const r = (raw ?? {}) as Record<string, unknown>;
  const permitIds = new Set(ctx.permits.map((p) => p.id));
  let permit_id = permitIds.has(String(r.permit_id)) ? String(r.permit_id) : null;
  if (evidence.exactPermitId) permit_id = evidence.exactPermitId;
  const req = ctx.requirements.find((q) => q.id === r.requirement_id);
  const requirement_id = req && req.permit_id === permit_id ? req.id : null;
  const doc_group = ctx.groups.some((g) => g.id === r.doc_group) ? String(r.doc_group) : null;
  const round = Number(r.submission_round);
  const sub =
    permit_id && Number.isInteger(round)
      ? ctx.submissions.find((x) => x.permit_id === permit_id && x.round === round)
      : undefined;
  let destination = "library";
  if (r.destination === "support" && sub) destination = `support:${sub.id}`;
  else if (r.destination === "draft" && permit_id) destination = "draft";
  const conf = Math.max(0, Math.min(1, Number(r.confidence) || 0));
  // exact permit evidence counts; a guessed permit can't make a match certain
  const confidence = evidence.exactPermitId ? Math.max(conf, 0.9) : Math.min(conf, permit_id ? 0.8 : 0.5);
  const kind = DOC_KINDS.includes(String(r.doc_kind)) ? String(r.doc_kind) : "Other";
  const discipline = DISCIPLINES.includes(String(r.discipline))
    ? String(r.discipline)
    : "General / Administration";
  const title =
    s(r.title, 160) ||
    evidence.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ||
    "Untitled document";
  const status: Suggestion["status"] =
    confidence >= 0.85 && permit_id && (!destination.startsWith("support:") || !!sub)
      ? "ready"
      : "needs_review";
  return {
    permit_id,
    requirement_id,
    doc_group,
    title,
    doc_kind: kind,
    discipline,
    revision: s(r.revision, 30) || null,
    destination,
    confidence: Math.round(confidence * 100) / 100,
    match_summary:
      s(r.match_summary, 160) ||
      (evidence.exactPermitId ? "Permit number found in the email" : "Suggested match"),
    reason: s(r.reason, 600) || "Corvus AI suggested this match; confirm it before filing.",
    round_evidence:
      s(r.round_evidence, 240) ||
      (sub ? `Submission ${sub.round}` : "No submission round evidence — not assigned to a round"),
    status,
  };
}
