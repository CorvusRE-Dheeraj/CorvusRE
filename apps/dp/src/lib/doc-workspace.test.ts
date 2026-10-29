import { describe, expect, it } from "vitest";
import {
  changeVsPrevious,
  fileProblem,
  groupDocuments,
  inboxAddress,
  isReady,
  nextRound,
  packageBlockers,
  prepOf,
  suggestRevision,
  type CommentRow,
  type RequirementRow,
  type SubmittedRound,
  type VersionRow,
} from "./doc-workspace";
import {
  domainMatches,
  extractLinks,
  inboxToken,
  permitNumberHit,
  sanitizeSuggestion,
  senderDomain,
  type MatchContext,
} from "../../../../supabase/dp/functions/_shared/document-match";

const ver = (id: string, extra: Partial<VersionRow> = {}): VersionRow => ({
  id,
  project_id: "p1",
  name: "Architectural set",
  category: "Architectural",
  storage_path: `u/p1/${id}.pdf`,
  note: null,
  created_at: "2026-10-01T00:00:00Z",
  doc_group: null,
  version_label: "R1",
  release_status: "released",
  doc_kind: "Design drawings",
  owner_party: null,
  permit_id: "b1",
  submission_id: null,
  content_hash: null,
  mime_type: "application/pdf",
  size_bytes: 1000,
  released_at: null,
  release_note: null,
  source_id: null,
  source_record: null,
  source_at: null,
  ...extra,
});
const req = (id: string, extra: Partial<RequirementRow> = {}): RequirementRow => ({
  id,
  project_id: "p1",
  permit_key: "building",
  label: id,
  grp: "Drawings",
  required: true,
  done: false,
  kind: "submission",
  document_id: null,
  prep_status: null,
  owner_party: null,
  due_date: null,
  review_note: null,
  ...extra,
});

describe("versions", () => {
  it("groups revisions of one logical document, latest last", () => {
    const groups = groupDocuments([
      ver("a1", { created_at: "2026-09-01T00:00:00Z" }),
      ver("a2", { doc_group: "a1", version_label: "R2", created_at: "2026-10-01T00:00:00Z" }),
      ver("s1", { name: "Survey" }),
    ]);
    expect(groups).toHaveLength(2);
    const a = groups.find((g) => g.id === "a1")!;
    expect(a.versions.map((v) => v.id)).toEqual(["a1", "a2"]);
    expect(a.latest.id).toBe("a2");
    expect(suggestRevision(a)).toBe("R3");
    expect(suggestRevision(undefined)).toBe("R1");
  });
});

describe("requirements and readiness", () => {
  const versions = new Map([
    ["rel", ver("rel")],
    ["draft", ver("draft", { release_status: "working_draft" })],
  ]);
  it("shows missing / requested / received from the selection", () => {
    expect(prepOf(req("x"))).toBe("missing");
    expect(prepOf(req("x", { prep_status: "requested" }))).toBe("requested");
    expect(prepOf(req("x", { document_id: "rel" }))).toBe("received");
    expect(prepOf(req("x", { document_id: "rel", prep_status: "internal_review" }))).toBe(
      "internal_review",
    );
  });
  it("is ready only with a released version marked ready", () => {
    expect(isReady(req("x", { document_id: "rel", prep_status: "ready" }), versions)).toBe(true);
    expect(isReady(req("x", { document_id: "draft", prep_status: "ready" }), versions)).toBe(false);
    expect(isReady(req("x", { document_id: "rel", prep_status: "received" }), versions)).toBe(
      false,
    );
  });
  it("blocks the package on missing, unreleased, unreviewed documents and open comments", () => {
    const comment = {
      id: "c1",
      status: "open",
      original: "Show the egress path.",
      plain_language: null,
    } as CommentRow;
    const b = packageBlockers(
      [
        req("Survey", { document_id: "rel", prep_status: "ready" }),
        req("Arch", { document_id: "draft", prep_status: "ready" }),
        req("Owner authorization"),
        req("Optional study", { required: false }),
      ],
      versions,
      [comment, { ...comment, id: "c2", status: "closed" }],
    );
    expect(b.map((x) => x.text)).toEqual([
      "Arch: selected version isn't released for permitting",
      "Owner authorization: no document received",
      "Review comment: Show the egress path. — not answered yet",
    ]);
  });
});

describe("rounds", () => {
  const sub = (round: number, permit_id = "b1") =>
    ({ id: `s${round}`, permit_id, round }) as SubmittedRound;
  it("the next round follows the permit's last filed round", () => {
    expect(nextRound([], "b1")).toBe(1);
    expect(nextRound([sub(1), sub(2), sub(5, "other")], "b1")).toBe(3);
  });
  it("compares a selection with the previous round's list", () => {
    const prev = [
      {
        requirement_id: "r1",
        requirement: "Arch",
        document_id: "a1",
        doc_group: "a1",
        name: "Arch",
        version_label: "R1",
      },
    ];
    expect(
      changeVsPrevious({ requirement_id: "r1", doc_group: "a1", document_id: "a1" }, prev),
    ).toBe("Reused");
    expect(
      changeVsPrevious({ requirement_id: "r1", doc_group: "a1", document_id: "a2" }, prev),
    ).toBe("Revised");
    expect(changeVsPrevious({ requirement_id: "r9", doc_group: "z", document_id: "z" }, prev)).toBe(
      "New",
    );
    expect(changeVsPrevious({ requirement_id: "r9", doc_group: "z", document_id: "z" }, null)).toBe(
      "New",
    );
  });
});

describe("uploads", () => {
  it("refuses unsupported, empty and oversized files", () => {
    expect(fileProblem({ name: "plan.pdf", size: 10 })).toBeNull();
    expect(fileProblem({ name: "virus.exe", size: 10 })).toMatch(/unsupported/);
    expect(fileProblem({ name: "plan.pdf", size: 0 })).toMatch(/empty/);
    expect(fileProblem({ name: "plan.pdf", size: 26 * 1024 * 1024 })).toMatch(/25 MB/);
  });
});

describe("project inbox matching", () => {
  it("reads the project inbox token and sender domain", () => {
    expect(inboxAddress({ inbox_token: "a1b2c3d4e5" })).toBe("dp-a1b2c3d4e5@inbox.corvusre.com");
    expect(inboxToken("Cedar Grove <DP-A1B2C3D4E5@inbox.corvusre.com>")).toBe("a1b2c3d4e5");
    expect(inboxToken("county@inbox.corvusre.com")).toBeNull();
    expect(senderDomain("City of Round Rock <noreply@www.Accela.com>")).toBe("accela.com");
    expect(domainMatches("mail.roundrocktexas.gov", ["roundrocktexas.gov"])).toBe(true);
    expect(domainMatches("evilroundrocktexas.gov", ["roundrocktexas.gov"])).toBe(false);
  });
  it("finds links in a notification", () => {
    expect(extractLinks("Review complete: https://aca.example.gov/cap/123. Thanks.")).toEqual([
      "https://aca.example.gov/cap/123",
    ]);
  });

  const ctx: MatchContext = {
    permits: [
      { id: "b1", name: "Building Permit", permit_number: "BP-2026-0101", permit_key: "building" },
      { id: "s1", name: "Site Development", permit_number: "SD-2026-0007", permit_key: "site" },
    ],
    requirements: [{ id: "rq1", permit_id: "b1", label: "Architectural drawing set" }],
    groups: [{ id: "g1", title: "Architectural drawing set" }],
    submissions: [{ id: "sub1", permit_id: "b1", round: 1 }],
  };
  it("a permit number in the email is exact evidence", () => {
    expect(permitNumberHit(ctx.permits, "RE: bp-2026-0101 comments attached")).toBe("b1");
    expect(permitNumberHit(ctx.permits, "No number here")).toBeNull();
  });
  it("keeps only the project's own ids and never trusts a guessed match", () => {
    const guessed = sanitizeSuggestion(
      {
        permit_id: "b1",
        requirement_id: "rq1",
        doc_group: "g1",
        destination: "draft",
        confidence: 0.99,
        doc_kind: "Design drawings",
      },
      ctx,
      { exactPermitId: null, filename: "Arch_R4.pdf" },
    );
    expect(guessed).toMatchObject({
      permit_id: "b1",
      requirement_id: "rq1",
      doc_group: "g1",
      destination: "draft",
      status: "needs_review",
    });
    expect(guessed.confidence).toBeLessThanOrEqual(0.8);

    const exact = sanitizeSuggestion(
      { permit_id: "s1", requirement_id: "rq1", destination: "draft", confidence: 0.5 },
      ctx,
      { exactPermitId: "b1", filename: "Arch_R4.pdf" },
    );
    expect(exact).toMatchObject({ permit_id: "b1", requirement_id: "rq1", status: "ready" });

    const bogus = sanitizeSuggestion(
      {
        permit_id: "elsewhere",
        requirement_id: "nope",
        doc_group: "x",
        doc_kind: "Weird",
        destination: "support",
        submission_round: 7,
      },
      ctx,
      { exactPermitId: null, filename: "letter.pdf" },
    );
    expect(bogus).toMatchObject({
      permit_id: null,
      requirement_id: null,
      doc_group: null,
      doc_kind: "Other",
      destination: "library",
      status: "needs_review",
      title: "letter",
    });
  });
  it("links a city letter to a round only when that round exists", () => {
    const s = sanitizeSuggestion(
      { destination: "support", submission_round: 1, confidence: 0.95 },
      ctx,
      { exactPermitId: "b1", filename: "Review_Letter.pdf" },
    );
    expect(s.destination).toBe("support:sub1");
    expect(s.status).toBe("ready");
  });
});
