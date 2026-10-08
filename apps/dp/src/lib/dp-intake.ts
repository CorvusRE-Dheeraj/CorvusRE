// Session-scoped store for the anonymous (pre-signup) permitting & design
// analysis flow. Everything the visitor enters and every AI/analysis result is
// held here in sessionStorage so a page refresh mid-wizard doesn't lose
// progress; on signup it is persisted to Supabase (see src/lib/projects.ts's
// claimIntakeProject) and this is cleared.

export type ProjectIntent = "new_construction" | "addition" | "remodeling" | "site_development";
export type DesignScope = "new_construction" | "addition" | "remodeling" | "interior_fit_out";
export type PropertySector = "commercial" | "residential";

// Optional finer grain for a commercial project — shown once Commercial is
// the sector.
export const COMMERCIAL_SUBCATEGORIES = [
  { value: "retail", label: "Retail" },
  { value: "office", label: "Office & Professional Services" },
  { value: "restaurant", label: "Restaurant & Food Service" },
  { value: "hospitality", label: "Hospitality & Lodging" },
  { value: "healthcare", label: "Healthcare & Medical" },
  { value: "education_childcare", label: "Education & Childcare" },
  { value: "personal_services_fitness", label: "Personal Services & Fitness" },
  { value: "entertainment_recreation", label: "Entertainment & Recreation" },
  { value: "automotive_fuel", label: "Automotive & Fuel" },
  { value: "storage_warehousing", label: "Storage & Warehousing" },
  { value: "data_center", label: "Data Center" },
  { value: "mixed_use", label: "Mixed-Use Commercial" },
  { value: "other", label: "Other" },
] as const;

export type CommercialSubcategory = (typeof COMMERCIAL_SUBCATEGORIES)[number]["value"];

export function commercialSubcategoryLabel(v: string | null | undefined): string | null {
  return COMMERCIAL_SUBCATEGORIES.find((c) => c.value === v)?.label ?? null;
}

export type PropertyInfo = {
  address?: string;
  city?: string;
  county?: string;
  state?: string;
  /** entered manually when no exact address is available */
  manualEntry?: boolean;
  approxSiteArea?: string;
  parcelId?: string;
  jurisdiction?: string;
  zoning?: string;
  zoningDescription?: string;
};

export type ProjectDefinition = {
  intent?: ProjectIntent;
  sector?: PropertySector;
  subcategory?: CommercialSubcategory;
  lotSize?: string;
  buildingArea?: string;
  floors?: string;
  existingUse?: string;
  proposedUse?: string;
};

export type DesignRequirements = {
  scope?: DesignScope;
  sector?: PropertySector;
  approxSiteArea?: string;
  buildingArea?: string;
  floors?: string;
  rooms?: string;
  functionalRequirements?: string;
  specialRequirements?: string;
};

export type DpIntakeState = {
  /** stable id generated on first touch — links the anonymous session to the
   *  project row created at signup */
  sessionId: string;
  track?: "permitting" | "design";
  property: PropertyInfo;
  project: ProjectDefinition;
  design: DesignRequirements;
  /** furthest wizard step reached, for the progress rail */
  step: number;
  analyzedAt?: number;
  /** lightweight contact captured if the visitor drops off before signup */
  leadEmail?: string;
  leadName?: string;
};

const KEY = "corvusdp_intake";

/** A blank intake. Exported so the prerendered/first (pre-hydration) render of
 *  the wizards can use it without touching sessionStorage — see the mount
 *  effect in permitting.analyze.tsx / design.analyze.tsx. */
export function emptyIntake(): DpIntakeState {
  return emptyState();
}

function emptyState(): DpIntakeState {
  return {
    sessionId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    property: {},
    // CorvusDP is commercial-only — sector used to be a user-picked toggle
    // (commercial/residential) on both wizards' first project step; that
    // choice was removed per direct product decision, but sector is still a
    // real field downstream (analysis.ts, fees.ts, reports, dashboard
    // subtitles), so it defaults to "commercial" here rather than being left
    // unset.
    project: { sector: "commercial" },
    design: { sector: "commercial" },
    step: 0,
  };
}

export function readDpIntake(): DpIntakeState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) {
      const fresh = emptyState();
      sessionStorage.setItem(KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<DpIntakeState>;
    return {
      ...emptyState(),
      ...parsed,
      property: { ...(parsed.property ?? {}) },
      // sector defaults to "commercial" (see emptyState) for a session saved
      // before that default existed and never set one — an already-saved
      // value (including a pre-existing "residential" one) still wins.
      project: { sector: "commercial", ...(parsed.project ?? {}) },
      design: { sector: "commercial", ...(parsed.design ?? {}) },
    };
  } catch {
    return emptyState();
  }
}

export function writeDpIntake(state: DpIntakeState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage blocked — the wizard still works within a single page load
  }
}

export function updateDpIntake(patch: Partial<DpIntakeState>): DpIntakeState {
  const current = readDpIntake();
  const next: DpIntakeState = {
    ...current,
    ...patch,
    property: { ...current.property, ...(patch.property ?? {}) },
    project: { ...current.project, ...(patch.project ?? {}) },
    design: { ...current.design, ...(patch.design ?? {}) },
  };
  writeDpIntake(next);
  return next;
}

export function resetDpIntake() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
