import { invokeEdgeFunction } from "./edge-functions";
import type { CadRecord } from "./cad-lookup";

export type OwnerSearchResult = {
  matches: CadRecord[];
  // Real owner names actually on file somewhere (never fabricated — see
  // cad-owner-search's own findSuggestions()), ranked by similarity to what
  // was typed. Only ever populated when matches is empty — a real match
  // never needs a "did you mean" alongside it.
  suggestions: string[];
};

export async function searchPropertiesByOwner(ownerName: string): Promise<OwnerSearchResult> {
  return invokeEdgeFunction<OwnerSearchResult>("cad-owner-search", { ownerName });
}
