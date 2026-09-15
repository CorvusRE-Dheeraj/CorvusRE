// Permit → reviewing agency mapping (PRD 1.1.9 / 2.1.8).
import type { PermitItem, PermitCategory } from "./permits";
import type { JurisdictionInfo } from "./jurisdiction";

export type AgencyAssignment = {
  permitId: string;
  permitName: string;
  agency: string;
  scope: string;
  website?: string;
};

const CATEGORY_TO_DEPT_SCOPE: Record<PermitCategory, RegExp> = {
  Building: /building|development services/i,
  "Site / Civil": /engineering|public works|civil/i,
  Fire: /fire/i,
  Utilities: /water|utilit/i,
  Plat: /planning|zoning|development services/i,
  Environmental: /environment|watershed|engineering|public works/i,
};

export function mapAgencies(permits: PermitItem[], jur: JurisdictionInfo): AgencyAssignment[] {
  return permits.map((permit) => {
    const matcher = CATEGORY_TO_DEPT_SCOPE[permit.category];
    const dept =
      jur.departments.find((d) => matcher.test(d.name) || matcher.test(d.scope)) ??
      jur.departments[0];
    return {
      permitId: permit.id,
      permitName: permit.name,
      agency: dept ? `${jur.authority} — ${dept.name}` : jur.authority,
      scope: dept?.scope ?? "Plan review",
      website: dept?.website ?? jur.portalUrl,
    };
  });
}
