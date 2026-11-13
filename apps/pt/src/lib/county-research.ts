import { useEffect, useState } from "react";
import { invokeEdgeFunction } from "./edge-functions";
import { lookupCadDirectory } from "./cad-directory";
import type {
  CountyResearch,
  ResearchTopic,
} from "../../../../supabase/pt/functions/_shared/county-research-topics";

export type {
  CountyResearch,
  ResearchTopic,
  ResearchItem,
} from "../../../../supabase/pt/functions/_shared/county-research-topics";

// The centralized county research engine, from the app: official rules,
// procedures, forms, fees, deadlines and submission methods for one county
// and topic (supabase/pt/functions/_shared/county-research.ts). Shared by every
// module (court appeal, arbitration, BPP renditions, …) — read once per
// county + topic for everyone and cached server-side for 30 days.

const memo = new Map<string, Promise<CountyResearch | null>>();

export function loadCountyResearch(
  cad: string | null | undefined,
  topic: ResearchTopic,
  refresh = false,
): Promise<CountyResearch | null> {
  const dir = lookupCadDirectory(cad);
  if (!dir) return Promise.resolve(null);
  const key = `${dir.countyCode}:${topic}`;
  if (!refresh && memo.has(key)) return memo.get(key)!;
  const p = invokeEdgeFunction<{ research: CountyResearch | null }>("retrieve-county-procedures", {
    countyCode: dir.countyCode,
    topic,
    refresh,
  })
    .then((r) => r.research ?? null)
    .catch(() => {
      memo.delete(key);
      return null;
    });
  memo.set(key, p);
  return p;
}

// For a component: the research for this county + topic, loading in the
// background. `reload(true)` asks the engine to read the sources again.
export function useCountyResearch(
  cad: string | null | undefined,
  topic: ResearchTopic,
): {
  research: CountyResearch | null;
  loading: boolean;
  reload: () => void;
} {
  const [research, setResearch] = useState<CountyResearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void loadCountyResearch(cad, topic, nonce > 0).then((r) => {
      if (!live) return;
      setResearch(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [cad, topic, nonce]);
  return { research, loading, reload: () => setNonce((n) => n + 1) };
}

// "Retrieved Nov 12, 2026" for a research result.
export function researchDate(r: CountyResearch | null): string | null {
  return r
    ? new Date(r.retrievedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
}
