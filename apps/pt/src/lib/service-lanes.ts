import { TIER_BRACKET_PRICES, VALUE_BRACKETS } from "./billing";

// The three ways to work with CorvusPT, kept as three separate lanes so the
// website never mixes the workflows (Oct 2026: the homepage said "CorvusPT
// staff handle filing" while Pricing said Owner-Managed customers file
// themselves). Every public page that describes the service reads from here,
// and each lane answers the same four questions — what am I buying, who
// files, who appears at the hearing, who communicates with the county.

export type LaneId = "free_review" | "owner_managed" | "expert_managed";

export type ServiceLane = {
  id: LaneId;
  name: string;
  tagline: string;
  price: string;
  priceNote: string;
  buying: string;
  whoFiles: string;
  whoAppears: string;
  whoCommunicates: string;
  cta: { label: string; to: "/" | "/dashboard/properties" | "/contact" };
};

const MONTHLY = TIER_BRACKET_PRICES.owner_managed[VALUE_BRACKETS[0].value];
const MANAGED_MONTHLY = TIER_BRACKET_PRICES.corvusrf_managed[VALUE_BRACKETS[0].value];
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export const SERVICE_LANES: ServiceLane[] = [
  {
    id: "free_review",
    name: "Free Property Review",
    tagline: "Find out if you're overpaying.",
    price: "Free",
    priceNote: "No card required · screen your whole portfolio",
    buying:
      "An AI review of each property's assessed value against your county's official record and comparable properties, with an estimate of what a protest could save. Add your whole portfolio and Corvus AI screens it into high-priority, moderate and probably-not-worth-it cases — you pay only to activate the ones you choose.",
    whoFiles: "Nothing is filed — this is a review only.",
    whoAppears: "No hearing.",
    whoCommunicates: "No one contacts the county.",
    cta: { label: "Start Free Review", to: "/" },
  },
  {
    id: "owner_managed",
    name: "Owner-Managed CorvusPT",
    tagline: "You protest. Corvus AI prepares everything.",
    price: `${usd(MONTHLY)}/mo`,
    priceNote: `per property, billed annually (${usd(MONTHLY * 12)}/yr)`,
    buying:
      "All 10 AI modules, the AI Executive Protest Report and an evidence packet, filing instructions for your county, deadline tracking and hearing prep — for you to use yourself.",
    whoFiles:
      "You do. CorvusPT prepares the evidence and tells you exactly what to file, where and by when.",
    whoAppears: "You do, with Corvus AI's hearing-prep guide.",
    whoCommunicates:
      "You do. Your deadlines and the county's notices are tracked in your dashboard.",
    cta: { label: "Add a Property to Subscribe", to: "/dashboard/properties" },
  },
  {
    id: "expert_managed",
    name: "Expert/Managed Help",
    tagline: "CorvusPT's team handles the protest for you.",
    price: `${usd(MANAGED_MONTHLY)}/mo or % of savings`,
    priceNote: "fixed annual price, or pay only from savings · $5M+ custom",
    buying:
      "Everything in Owner-Managed, plus CorvusPT's team as your property tax agent: they file, deal with the county and represent you at the hearing.",
    whoFiles: "CorvusPT files for you, once you sign the Appointment of Agent (Form 50-162).",
    whoAppears: "CorvusPT represents you at the hearing.",
    whoCommunicates: "CorvusPT does — and nothing is settled without your approval.",
    cta: { label: "Talk to Our Team", to: "/contact" },
  },
];

export const QUESTIONS: {
  key: "buying" | "whoFiles" | "whoAppears" | "whoCommunicates";
  label: string;
}[] = [
  { key: "buying", label: "What am I buying?" },
  { key: "whoFiles", label: "Who files?" },
  { key: "whoAppears", label: "Who appears at the hearing?" },
  { key: "whoCommunicates", label: "Who communicates with the county?" },
];
