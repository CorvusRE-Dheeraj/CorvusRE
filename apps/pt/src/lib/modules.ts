import {
  Activity,
  Target,
  BarChart3,
  MapPin,
  Wrench,
  Building2,
  DollarSign,
  FileText,
  TrendingDown,
  Award,
  type LucideIcon,
} from "lucide-react";
import { ICON_COLORS, type IconColor } from "./icon-colors";

export type Module = {
  id: string;
  n: number;
  title: string;
  // Short journey-stage name (e.g. "Protest Opportunity") — the label used
  // for this module in the 10-module chain (Opportunity → Strategy →
  // Investigation → Evidence → Value → Savings → Recommendation), distinct
  // from `title`'s longer, more descriptive product name.
  shortName: string;
  question: string;
  status: "Analyzing" | "Completed" | "Additional Data Needed";
  teaser: string;
  requiresUserData?: boolean;
  icon: LucideIcon;
  color: IconColor;
};

export const MODULES: Module[] = [
  {
    id: "health",
    n: 1,
    title: "AI Property Health Score",
    shortName: "Protest Opportunity",
    question: "Should I protest my property?",
    status: "Completed",
    teaser:
      "AI-generated protest opportunity score based on your property's official CAD valuation record.",
    icon: Activity,
    color: ICON_COLORS[0],
  },
  {
    id: "strategy",
    n: 2,
    title: "AI Recommended Protest Strategy",
    shortName: "Protest Strategy",
    question: "What is the best strategy to reduce my property taxes?",
    status: "Completed",
    teaser:
      "AI-recommended approach — market value, unequal appraisal, or condition-based reduction — for your CAD record.",
    icon: Target,
    color: ICON_COLORS[1],
  },
  {
    id: "comps",
    n: 3,
    title: "Comparable Sales & Market Analysis",
    shortName: "Market Value",
    question: "How does my property compare with similar nearby commercial properties?",
    status: "Completed",
    teaser:
      "AI guidance on what comparable-sale and equity evidence to gather for this property type and county.",
    icon: BarChart3,
    color: ICON_COLORS[2],
  },
  {
    id: "site",
    n: 4,
    title: "Site Condition Analysis",
    shortName: "Site Condition",
    question: "Are there land or site-related issues that could support a lower valuation?",
    status: "Completed",
    teaser:
      "Real FEMA flood-zone and elevation data where available, plus a 14-factor checklist of what to document otherwise.",
    icon: MapPin,
    color: ICON_COLORS[3],
  },
  {
    id: "improvement",
    n: 5,
    title: "Improvement Condition Analysis",
    shortName: "Improvement Condition",
    question: "Is the building being valued fairly based on its age and condition?",
    status: "Completed",
    teaser:
      "Real age-life depreciation math from your uploaded photos, plus a checklist of what else to document.",
    icon: Wrench,
    color: ICON_COLORS[4],
  },
  {
    id: "zoning",
    n: 6,
    title: "Zoning & Property Classification Review",
    shortName: "Zoning & Classification",
    question: "Is the property being assessed under the correct zoning and classification?",
    status: "Completed",
    teaser:
      "AI assessment of whether your CAD classification appears consistent with the stated property type.",
    icon: Building2,
    color: ICON_COLORS[5],
  },
  {
    id: "income",
    n: 7,
    title: "Income Approach & P&L Analysis",
    shortName: "Income Value",
    question: "Does the property's income support its current assessed value?",
    status: "Additional Data Needed",
    teaser: "Requires P&L, rent roll, or operating statement to complete.",
    requiresUserData: true,
    icon: DollarSign,
    color: ICON_COLORS[6],
  },
  {
    id: "evidence",
    n: 8,
    title: "AI Evidence Builder",
    shortName: "Evidence Building",
    question: "What evidence may provide the strongest support for a protest?",
    status: "Completed",
    teaser: "AI-prioritized evidence checklist for your protest packet.",
    icon: FileText,
    color: ICON_COLORS[7],
  },
  {
    id: "savings",
    n: 9,
    title: "Estimated Tax Savings & ROI",
    shortName: "Estimated Savings",
    question: "How much could I potentially save, and is filing a protest worthwhile?",
    status: "Completed",
    teaser:
      "Modeled from real comparable properties or published Texas protest-outcome data, at your county's real effective tax rate — not an AI guess.",
    icon: TrendingDown,
    color: ICON_COLORS[8],
  },
  {
    id: "executive",
    n: 10,
    title: "AI Executive Protest Report",
    shortName: "Executive Protest Report",
    question: "What is the final AI recommendation and what should I do next?",
    status: "Completed",
    teaser:
      "AI executive summary with a recommended next step, synthesized from the other modules.",
    icon: Award,
    color: ICON_COLORS[9],
  },
];
