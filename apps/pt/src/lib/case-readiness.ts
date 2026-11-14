import { invokeEdgeFunction } from "./edge-functions";
import { getCountyProtestInfo } from "./county-protest-info";
import { getPreFilingCheck } from "./pre-filing-check";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";

// A light AI review of an assembled protest case against the county's real
// filing requirements — shown in the "AI Guidance & Filing Notice" step.
// Advisory: the deterministic getPreFilingCheck() is what actually blocks
// filing. The AI only surfaces "this doesn't line up, confirm it" concerns.

export type CaseReadinessConcern = {
  field: string;
  concern: string;
  severity: "high" | "medium";
};

export async function verifyCaseReadiness(
  property: PropertyRecord,
  protest: ProtestRecord,
  evidenceCount: number,
): Promise<CaseReadinessConcern[]> {
  const countyInfo = getCountyProtestInfo(property.cad);
  // Reuse the deterministic check's own resolved "Filing Method" string so
  // the AI sees exactly what the app will do, not a re-derived guess.
  const filingMethod =
    getPreFilingCheck(property, protest).find((i) => i.label === "Filing Method")?.value ?? null;

  const payload = {
    caseFacts: {
      cad: property.cad,
      address: property.address,
      accountNumber: property.accountNumber,
      protestTaxYear: protest.taxYear ?? null,
      propertyTaxYear: property.taxYear ?? null,
      ownerName: property.ownerName,
      propertyType: property.propertyType ?? null,
      protestDeadline: property.protestDeadline ?? null,
      applicableForm: "Comptroller Form 50-132 — Notice of Protest",
      filingMethod,
      evidenceCount,
    },
    countyReference: countyInfo
      ? {
          verifiedAt: countyInfo.verifiedAt,
          sourceUrl: countyInfo.sourceUrl,
          filingMethod: countyInfo.filingMethod,
          arbContact: countyInfo.arbContact,
        }
      : null,
  };
  // Speed: this AI review took 5-7 s on every visit to the case page. The
  // same facts get the same review, so it's kept in this browser per exact
  // payload for a week; any changed fact (new evidence, a corrected owner,
  // a new county rule date) changes the key and asks the AI again.
  const key = `corvuspt.caseReadiness.v1.${hashText(JSON.stringify(payload))}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { at, concerns } = JSON.parse(raw) as { at: number; concerns: CaseReadinessConcern[] };
      if (Date.now() - at < WEEK_MS) return concerns;
    }
  } catch {
    // storage blocked — just ask the AI
  }
  const { concerns } = await invokeEdgeFunction<{ concerns: CaseReadinessConcern[] }>(
    "verify-case-readiness",
    payload,
  );
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), concerns: concerns ?? [] }));
  } catch {
    // storage full or blocked — fine, it's only a speed-up
  }
  return concerns ?? [];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// djb2 — a short, stable storage key for the payload, not a security hash.
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
