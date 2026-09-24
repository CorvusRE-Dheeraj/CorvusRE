import { useEffect, useState } from "react";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import { getSubmission } from "@/lib/protest-form-submissions";
import { getLatestHearingNotice } from "@/lib/hearing-notice";
import { getLatestDecisionNotice } from "@/lib/decision-notice";
import { getCachedModuleResult } from "@/lib/module-results-cache";
import { MODULES } from "@/lib/modules";
import { parseMoney } from "@/lib/arbitration";
import type { CaseFacts } from "@/lib/case-context";

// What's already on file for a case — the owner's opinion of value (from their
// Notice of Protest), the hearing notice, the ARB order as read, and each AI
// module's key finding. Loaded once per case; nothing here is ever re-asked.
export function useCaseFacts(
  protest: ProtestRecord,
  property: PropertyRecord,
): CaseFacts & { requestedRaw: string } {
  const [requestedRaw, setRequestedRaw] = useState("");
  const [facts, setFacts] = useState<Omit<CaseFacts, "requestedValue">>({
    moduleFindings: [],
    hearingNotice: null,
    decisionNotice: null,
  });

  useEffect(() => {
    let live = true;
    getSubmission(protest.id, "notice_of_protest")
      .then((s) => {
        const v = s?.fieldValues?.["Opinion of property value"];
        if (live && typeof v === "string" && parseMoney(v)) setRequestedRaw(v);
      })
      .catch(() => {});
    getLatestHearingNotice(protest.id)
      .then((n) => live && setFacts((f) => ({ ...f, hearingNotice: n })))
      .catch(() => {});
    getLatestDecisionNotice(protest.id)
      .then((n) => live && setFacts((f) => ({ ...f, decisionNotice: n })))
      .catch(() => {});
    Promise.all(
      MODULES.map(async (m) => {
        const cached = await getCachedModuleResult(property.id, m.id).catch(() => null);
        const finding = (cached?.result as { keyFinding?: string } | undefined)?.keyFinding;
        return finding ? { title: m.shortName, finding } : null;
      }),
    ).then((rows) => {
      if (live) {
        setFacts((f) => ({
          ...f,
          moduleFindings: rows.filter((r): r is { title: string; finding: string } => !!r),
        }));
      }
    });
    return () => {
      live = false;
    };
  }, [protest.id, property.id]);

  return { ...facts, requestedRaw, requestedValue: parseMoney(requestedRaw) };
}
