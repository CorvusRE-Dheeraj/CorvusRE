// Session-scoped store for the anonymous (pre-signup) permitting & design
// analysis flow. Everything the visitor enters and every AI/analysis result is
// held here in sessionStorage so a page refresh mid-wizard doesn't lose
// progress; on signup it is persisted to Supabase (see src/lib/projects.ts's
// claimIntakeProject) and this is cleared.

export type ProjectIntent = "new_construction" | "addition" | "remodeling" | "site_development";
export type DesignScope = "new_construction" | "addition" | "remodeling" | "interior_fit_out";
export type PropertySector = "commercial" | "residential";

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

function emptyState(): DpIntakeState {
  return {
    sessionId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    property: {},
    project: {},
    design: {},
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
      project: { ...(parsed.project ?? {}) },
      design: { ...(parsed.design ?? {}) },
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
