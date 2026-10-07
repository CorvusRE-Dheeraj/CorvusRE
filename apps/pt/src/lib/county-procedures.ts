import { useEffect, useState } from "react";
import { invokeEdgeFunction } from "./edge-functions";
import { lookupCadDirectory } from "./cad-directory";

// County protest procedures read by AI off the appraisal district's OWN website —
// the "AI web/PDF retrieval" step for the counties without a hand-researched
// county-protest-info.ts entry. The retrieve-county-procedures edge function does
// the reading (official sites from the Comptroller directory only) and caches the
// result for every user; this module holds what's been loaded in this session so
// the synchronous getCountyProtestInfo() can use it.

export type RetrievedProcedures = {
  onlinePortalUrl: string | null;
  onlineNotes: string | null;
  emailFilingAvailable: boolean | null;
  emailFilingAddress: string | null;
  emailNotes: string | null;
  informalReviewHowTo: string | null;
  informalReviewNotes: string | null;
  arbPhone: string | null;
  arbEmail: string | null;
  sourceUrls: string[];
  retrievedAt: string;
};

const cache = new Map<string, RetrievedProcedures | null>();

export function getRetrievedRaw(countyCode: string): RetrievedProcedures | null {
  return cache.get(countyCode) ?? null;
}

const inflight = new Map<string, Promise<RetrievedProcedures | null>>();

export async function loadCountyProcedures(
  cad: string | null | undefined,
): Promise<RetrievedProcedures | null> {
  const dir = lookupCadDirectory(cad);
  if (!dir) return null;
  if (cache.has(dir.countyCode)) return cache.get(dir.countyCode) ?? null;
  let p = inflight.get(dir.countyCode);
  if (!p) {
    p = invokeEdgeFunction<{ procedures: RetrievedProcedures | null }>(
      "retrieve-county-procedures",
      { countyCode: dir.countyCode },
    )
      .then((r) => r.procedures ?? null)
      .catch(() => null)
      .then((proc) => {
        cache.set(dir.countyCode, proc);
        inflight.delete(dir.countyCode);
        return proc;
      });
    inflight.set(dir.countyCode, p);
  }
  return p;
}

// Loads this county's retrieved procedures and re-renders once they arrive, so
// every getCountyProtestInfo() call below it picks them up. Returns a version
// number to key memos on.
export function useCountyProcedures(cad: string | null | undefined): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    loadCountyProcedures(cad).then((p) => {
      if (live && p) setVersion((v) => v + 1);
    });
    return () => {
      live = false;
    };
  }, [cad]);
  return version;
}
