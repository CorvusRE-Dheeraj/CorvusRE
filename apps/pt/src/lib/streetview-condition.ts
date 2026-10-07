import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { getComps } from "./cad-comps";
import { computeComparableStats } from "./comps-analysis";
import {
  compareConditions,
  type ConditionComparison,
  type ConditionRating,
  type RatedImage,
} from "../../../../supabase/pt/functions/_shared/streetview-condition";

export type { ConditionComparison, RatedImage };

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const SIZE = "640x400";
// Subject plus the nearest, most similar comparables.
export const COMP_IMAGES = 5;

type Location = { key: string; address: string; location: string; value: number | null };

async function meta(
  location: string,
): Promise<{ ok: boolean; date: string | null; denied: boolean }> {
  if (!KEY) return { ok: false, date: null, denied: true };
  const params = new URLSearchParams({ location, source: "outdoor", key: KEY });
  const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params}`);
  const j = (await res.json()) as { status?: string; date?: string };
  return { ok: j.status === "OK", date: j.date ?? null, denied: j.status === "REQUEST_DENIED" };
}

export function streetViewUrl(location: string): string | null {
  if (!KEY) return null;
  const params = new URLSearchParams({
    size: SIZE,
    location,
    fov: "75",
    source: "outdoor",
    return_error_code: "true",
    key: KEY,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params}`;
}

async function asDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export type StreetViewRun =
  | { status: "ok"; comparison: ConditionComparison; locations: Record<string, string> }
  | { status: "not_enabled" | "unavailable" | "no_comps"; message: string };

// Fetches Street View for the subject and its nearest comparables, has the
// images rated, and compares them (lib in _shared/streetview-condition.ts).
export async function runStreetViewComparison(subject: {
  address: string;
  cad?: string;
  accountNumber?: string;
  totalValue?: number;
}): Promise<StreetViewRun> {
  const comps = await getComps({
    cad: subject.cad,
    accountNumber: subject.accountNumber,
    address: subject.address,
    totalValue: subject.totalValue,
  }).catch(() => null);
  const ranked =
    comps?.subject && comps.comps.length
      ? computeComparableStats(comps.subject, comps.comps, subject.totalValue).ranked
      : [];
  if (ranked.length < 2)
    return {
      status: "no_comps",
      message: "Street View comparison needs at least two county comparables, and none were found.",
    };

  const locations: Location[] = [
    { key: "subject", address: subject.address, location: subject.address, value: null },
    ...[...ranked]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, COMP_IMAGES)
      .map((c) => ({
        key: `comp-${c.pid}`,
        address: c.address,
        location: `${c.latitude},${c.longitude}`,
        value: c.marketValue ?? null,
      })),
  ];

  const metas = await Promise.all(locations.map((l) => meta(l.location).catch(() => null)));
  if (metas.some((m) => m?.denied))
    return {
      status: "not_enabled",
      message: "Street View imagery isn't available in CorvusPT right now. We're working on it.",
    };
  const available = locations
    .map((l, i) => ({ ...l, date: metas[i]?.ok ? metas[i]!.date : null, ok: !!metas[i]?.ok }))
    .filter((l) => l.ok);
  if (!available.some((l) => l.key === "subject"))
    return {
      status: "unavailable",
      message: "Google has no outdoor Street View imagery at this property's address.",
    };

  const images = await Promise.all(
    available.map(async (l) => ({
      key: l.key,
      address: l.address,
      dataUrl: await asDataUrl(streetViewUrl(l.location)!),
    })),
  );
  const { ratings } = await invokeEdgeFunction<{ ratings: Record<string, ConditionRating> }>(
    "streetview-condition",
    { images },
  );
  const rated: RatedImage[] = available.map((l) => ({
    key: l.key,
    address: l.address,
    imageDate: l.date,
    value: l.value,
    rating: ratings[l.key] ?? {
      usable: false,
      overall: null,
      facade: null,
      roof: null,
      paving: null,
      site: null,
      defects: [],
    },
  }));
  return {
    status: "ok",
    comparison: compareConditions(rated, new Date().toISOString().slice(0, 7)),
    locations: Object.fromEntries(available.map((l) => [l.key, l.location])),
  };
}

export type SavedComparison = {
  comparison: ConditionComparison;
  locations: Record<string, string>;
  createdAt: string;
};

export async function getSavedComparison(
  cad: string,
  accountNumber: string,
): Promise<SavedComparison | null> {
  const { data } = await supabase
    .from("streetview_conditions")
    .select("comparison, created_at")
    .eq("cad", cad)
    .eq("account_number", accountNumber)
    .maybeSingle();
  if (!data) return null;
  const c = data.comparison as {
    comparison: ConditionComparison;
    locations: Record<string, string>;
  };
  return { comparison: c.comparison, locations: c.locations ?? {}, createdAt: data.created_at };
}

export async function saveComparison(
  userId: string,
  cad: string,
  accountNumber: string,
  run: { comparison: ConditionComparison; locations: Record<string, string> },
): Promise<void> {
  await supabase.from("streetview_conditions").upsert(
    {
      user_id: userId,
      cad,
      account_number: accountNumber,
      comparison: run,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,cad,account_number" },
  );
}
