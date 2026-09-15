import { supabase } from "./supabase";

// A user's confirmation that a specific AI-report data requirement is not
// applicable to their property — no document exists to upload, so the
// module/factor/component should be excluded from the analysis instead of
// sitting permanently on "Needs Data"/"Additional Data Needed" (Module 7 has
// no possible way to resolve without a P&L; most of Module 4's 14 site
// factors have no real data source this app can fetch at all — see
// enforceSiteFactorRealData in ai-report-modules/index.ts). itemKey is ''
// (WHOLE_MODULE_KEY) for a whole-module override; the exact site-factor or
// building-component name for a per-item override within Module 4/5.
export type ModuleOverride = {
  moduleId: string;
  itemKey: string;
};

export const WHOLE_MODULE_KEY = "";

type ModuleOverrideRow = {
  module_id: string;
  item_key: string;
};

// Every override for one property, regardless of which module/item — the
// caller filters (see isModuleNotApplicable/isItemNotApplicable/
// itemsNotApplicable below) rather than this fetching per-module, since the
// report page needs all of them at once anyway.
export async function listModuleOverrides(propertyId: string): Promise<ModuleOverride[]> {
  const { data, error } = await supabase
    .from("module_data_overrides")
    .select("module_id, item_key")
    .eq("property_id", propertyId);
  if (error) throw error;
  return (data ?? []).map((r: ModuleOverrideRow) => ({
    moduleId: r.module_id,
    itemKey: r.item_key,
  }));
}

export async function markNotApplicable(
  userId: string,
  propertyId: string,
  moduleId: string,
  itemKey: string = WHOLE_MODULE_KEY,
): Promise<void> {
  const { error } = await supabase
    .from("module_data_overrides")
    .upsert(
      { user_id: userId, property_id: propertyId, module_id: moduleId, item_key: itemKey },
      { onConflict: "property_id,module_id,item_key" },
    );
  if (error) throw error;
}

export async function clearNotApplicable(
  propertyId: string,
  moduleId: string,
  itemKey: string = WHOLE_MODULE_KEY,
): Promise<void> {
  const { error } = await supabase
    .from("module_data_overrides")
    .delete()
    .eq("property_id", propertyId)
    .eq("module_id", moduleId)
    .eq("item_key", itemKey);
  if (error) throw error;
}

export function isModuleNotApplicable(overrides: ModuleOverride[], moduleId: string): boolean {
  return overrides.some((o) => o.moduleId === moduleId && o.itemKey === WHOLE_MODULE_KEY);
}

export function isItemNotApplicable(
  overrides: ModuleOverride[],
  moduleId: string,
  itemKey: string,
): boolean {
  return overrides.some((o) => o.moduleId === moduleId && o.itemKey === itemKey);
}

// Every per-item override key (never the whole-module '' entry) for one
// module — the exact site-factor / building-component names the AI-report
// edge function should treat as excluded rather than missing.
export function itemsNotApplicable(overrides: ModuleOverride[], moduleId: string): string[] {
  return overrides
    .filter((o) => o.moduleId === moduleId && o.itemKey !== WHOLE_MODULE_KEY)
    .map((o) => o.itemKey);
}
