// The centralized county research engine's topics (retrieve-county-procedures
// with {"topic": …}). One engine for every module that needs county-specific
// procedure: each topic names the OFFICIAL statewide sources to read (Texas
// Comptroller, SOAH — fixed URLs, checked to load), which county sites to
// follow (the appraisal district's, and for court matters the county
// government's), and what to extract. Results are cached per county + topic
// in public.county_research. Adding a module = adding a topic here.

export type ResearchTopic = "arbitration" | "court_appeal" | "bpp_rendition";

export type TopicConfig = {
  title: string;
  // statewide sources, read every time the topic is researched
  statewide: { url: string; label: string; pdf?: boolean }[];
  // links on the appraisal district's site worth following for this topic
  cadFollow: RegExp | null;
  // links on the county government's site (from the Comptroller directory's
  // tax-office website) worth following — null to skip that site
  countyFollow: RegExp | null;
  // what the model should look for, in a sentence or two
  focus: string;
};

export const RESEARCH_TOPICS: Record<ResearchTopic, TopicConfig> = {
  arbitration: {
    title: "Binding arbitration of an ARB order (Tax Code ch. 41A)",
    statewide: [
      {
        url: "https://comptroller.texas.gov/taxes/property-tax/arbitration/",
        label: "Texas Comptroller — Regular Binding Arbitration",
      },
      {
        url: "https://comptroller.texas.gov/taxes/property-tax/arbitration/limited-binding.php",
        label: "Texas Comptroller — Limited Binding Arbitration",
      },
      {
        url: "https://comptroller.texas.gov/taxes/property-tax/docs/arb-schedule.pdf",
        label: "Arbitration Deposit and Arbitrator Fee Schedule",
        pdf: true,
      },
      {
        url: "https://comptroller.texas.gov/forms/ap-219.pdf",
        label: "Form AP-219, Request for Binding Arbitration",
        pdf: true,
      },
      {
        url: "https://www.texas.gov/living-in-texas/property-tax-arbitration/",
        label: "Texas.gov — Property Tax Arbitration System (PTAS)",
      },
    ],
    cadFollow: /arbitrat|appeal|after.*hearing|ptas/i,
    countyFollow: null,
    focus:
      "Regular binding arbitration (RBA, §41A) and limited binding arbitration (LBA, §41A.015): who is eligible (value caps, homestead, taxes paid), how and where to file (PTAS, Form AP-219 / AP-241), the deposit and arbitrator fee schedule, the refund rules, the filing deadline and what starts it, the settlement period, withdrawal (Form 50-830), the hearing, and any county-specific steps the appraisal district states.",
  },
  court_appeal: {
    title: "Appeal of an ARB order to district court (Tax Code ch. 42)",
    statewide: [
      {
        url: "https://comptroller.texas.gov/taxes/property-tax/protests/",
        label: "Texas Comptroller — Property tax protests and appeals",
      },
      {
        url: "https://comptroller.texas.gov/taxes/property-tax/docs/96-295.pdf",
        label: "Texas Comptroller — Property Taxpayer Remedies (96-295)",
        pdf: true,
      },
      {
        url: "https://www.soah.texas.gov/appraisal-review-board",
        label: "SOAH — appeals of appraisal review board orders",
      },
    ],
    cadFollow: /appeal|district court|litigation|lawsuit|after.*hearing/i,
    countyFollow: /district clerk|district court|civil|e-?fil|courts/i,
    focus:
      "Filing a petition for review in district court after an ARB order (§42.01, §42.21): the 60-day deadline and what starts it, where to file (the district court of the county; the district clerk's office, its e-filing system, address, phone), paying the undisputed tax before delinquency (§42.08), notice requirements, the SOAH alternative for property over $1 million, filing fees stated by the clerk, and anything the county or appraisal district states for these suits.",
  },
  bpp_rendition: {
    title: "Business personal property rendition (Form 50-144)",
    statewide: [
      {
        // the form carries the official instructions (deadline, extensions,
        // who must render, penalties)
        url: "https://comptroller.texas.gov/forms/50-144.pdf",
        label:
          "Form 50-144, Business Personal Property Rendition (with instructions)",
        pdf: true,
      },
    ],
    cadFollow: /rendition|business personal|bpp|personal property/i,
    countyFollow: null,
    focus:
      "Rendering business personal property: the deadline (April 15) and extensions (to May 15, more on request), who must render, Form 50-144 and any county version, the accepted ways to submit to THIS appraisal district (online portal, email address, mailing address, in person), penalties for late filing, and exemptions (e.g. under $2,500).",
  },
};

// The shape every topic's research is returned in — statewide rules kept
// apart from county procedures, each fact with the official page it came
// from, and what couldn't be confirmed.
export type ResearchItem = { text: string; sourceUrl: string | null };
export type CountyResearch = {
  topic: ResearchTopic;
  county: string;
  retrievedAt: string;
  statewide: ResearchItem[];
  countySpecific: ResearchItem[];
  forms: { name: string; url: string }[];
  fees: { item: string; amount: string; sourceUrl: string | null }[];
  deadlines: { event: string; rule: string; sourceUrl: string | null }[];
  submission: {
    method: "online" | "email" | "mail" | "in_person" | "other";
    detail: string;
    url: string | null;
    email: string | null;
    address: string | null;
  }[];
  contacts: {
    name: string;
    phone: string | null;
    email: string | null;
    url: string | null;
  }[];
  // facts the user (or an attorney) must confirm before relying on them
  verify: string[];
  // things looked for and not found on the official pages
  unavailable: string[];
  sources: { url: string; label: string; kind: "statewide" | "county" }[];
};
