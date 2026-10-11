import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROOF_KINDS,
  PROOF_KINDS_BY_METHOD,
  isProofKind,
  proofKindLabel,
  uspsTrackingUrl,
} from "./proof-kinds";

const repo = resolve(__dirname, "../../../..");
const ids = PROOF_KINDS.map((k) => k.id).sort();

// The same list lives in three places — this keeps them from drifting.
function quotedIdsIn(text: string): string[] {
  return [...text.matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)].map((m) => m[1] ?? m[2]).sort();
}

describe("proof kinds stay in step everywhere", () => {
  it("matches the documents.proof_kind check constraint", () => {
    const schema = readFileSync(resolve(repo, "supabase/pt/schema.sql"), "utf8");
    const block = /documents_proof_kind_check check \(([\s\S]*?)\)\s*\);/.exec(schema)?.[1] ?? "";
    expect(quotedIdsIn(block)).toEqual(ids);
  });

  it("matches the AI proof check's allowed kinds", () => {
    const fn = readFileSync(
      resolve(repo, "supabase/pt/functions/verify-filing-proof/index.ts"),
      "utf8",
    );
    const block = /const PROOF_KINDS = new Set\(\[([\s\S]*?)\]\)/.exec(fn)?.[1] ?? "";
    expect(quotedIdsIn(block)).toEqual(ids);
  });
});

describe("proof kind helpers", () => {
  it("only offers real kinds for each filing method", () => {
    for (const kinds of Object.values(PROOF_KINDS_BY_METHOD)) {
      for (const k of kinds) expect(isProofKind(k)).toBe(true);
    }
  });

  it("labels known kinds and falls back for unlabeled proof", () => {
    expect(proofKindLabel("certified_mail_receipt")).toBe("Certified-mail receipt");
    expect(proofKindLabel(null)).toBe("Unlabeled proof");
    expect(isProofKind("selfie")).toBe(false);
  });

  it("builds a USPS tracking link without spaces", () => {
    expect(uspsTrackingUrl("9400 1000 0000 0000 0000 00")).toBe(
      "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000",
    );
  });
});
