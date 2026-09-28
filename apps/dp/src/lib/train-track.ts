// The Permitting Train-Track Map: every step of the permitting lifecycle as a
// "station" on a line, with a train parked where THIS project actually is.
//
// Station content follows the PRD's train-track reference map (29 stations,
// 6 routes). Two things are added on top of it:
//   - `page`: the dashboard page where that station's work lives, so a
//     station is a way in, not just a description.
//   - `availability`: how much of the station is actually built in CorvusDP
//     today. The reference map labels every station an "AI module"; several
//     of those (meeting transcription, drawing compliance checks, …) don't
//     exist yet, and the map must not imply they do.
//
// The train's position (`locateTrain`) is derived only from real project
// data — permit statuses, checklist completion, logged review comments and
// expiry dates — never guessed.

import type { ChecklistRow, PermitRow } from "./projects";
import type { ReviewCommentRow } from "./project-activity";

export type RouteColor = "blue" | "purple" | "orange" | "teal" | "green" | "red" | "gray";

export type Availability = "live" | "partial" | "planned" | "staff";

export type Station = {
  n: number;
  group: string;
  color: RouteColor;
  title: string;
  module: string;
  purpose: string;
  inputs: string[];
  actions: string[];
  outputs: string[];
  next: string;
  page: string;
  availability: Availability;
  /** What's built vs. not, when availability isn't simply "live". */
  availabilityNote?: string;
};

/** Route (line) colours — red is only ever a station colour, inside the review loop. */
export type LineColor = Exclude<RouteColor, "red">;

export type TrackRoute = { name: string; color: LineColor; stations: number[] };

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  live: "Live in CorvusDP",
  partial: "Partly built",
  planned: "Planned",
  staff: "CorvusDP staff tool",
};

export const STATIONS: Station[] = [
  {
    n: 1,
    group: "Intake + Strategy",
    color: "blue",
    title: "Project Intake + Validation",
    module: "AI Intake Validator",
    purpose:
      "Creates the core project record and validates the first property/project inputs before any permit recommendations are made.",
    inputs: ["Property address or manual site details", "City / lot size", "User session ID", "Project scope"],
    actions: [
      "Creates unique Project ID",
      "Fetches parcel data when address is available",
      "Validates property details, lot size, city, county, zoning, and project scope",
      "Flags missing or inconsistent information",
      "Marks AI-generated site data as preliminary when only manual input is available",
    ],
    outputs: [
      "Project ID",
      "Property address",
      "Parcel ID / APN",
      "Jurisdiction",
      "Zoning",
      "Lot size",
      "Validation score",
      "Missing data alerts",
    ],
    next: "Client / Request Monitoring",
    page: "/dashboard",
    availability: "live",
  },
  {
    n: 2,
    group: "Intake + Strategy",
    color: "blue",
    title: "Client / Request Monitoring",
    module: "AI Client Profile + Request Monitor",
    purpose:
      "Tracks new searches, partial sessions, signups, and user engagement so high-intent permitting requests are not missed.",
    inputs: ["Property searches", "Partial forms", "Signup events", "Abandonment events", "Last activity"],
    actions: ["Calculates intent score", "Prioritizes users by activity level", "Classifies engagement stage"],
    outputs: [
      "User/session record",
      "Property address",
      "Intent score",
      "Signup status",
      "Priority level",
      "Follow-up tasks",
    ],
    next: "Jurisdiction + Zoning Check",
    page: "/dashboard",
    availability: "staff",
    availabilityNote: "Runs behind the scenes in the CorvusDP team's admin Leads view.",
  },
  {
    n: 3,
    group: "Intake + Strategy",
    color: "blue",
    title: "Jurisdiction + Zoning Check",
    module: "AI Jurisdiction + Zoning Analyzer",
    purpose:
      "Identifies the governing authority and early zoning context so the correct rules, agencies, and review path are used.",
    inputs: [
      "Address",
      "Parcel / APN",
      "Public records",
      "City / county / ETJ indicators",
      "Manual assumptions if address is incomplete",
    ],
    actions: [
      "Fetches parcel ID / APN",
      "Identifies city, county, ETJ",
      "Pulls public record site data",
      "Fetches zoning classification where available",
      "Flags preliminary assumptions",
    ],
    outputs: ["Jurisdiction map", "Governing agencies", "Parcel information", "Zoning classification"],
    next: "Permit Identification",
    page: "/dashboard",
    availability: "live",
  },
  {
    n: 4,
    group: "Intake + Strategy",
    color: "blue",
    title: "Permit Identification",
    module: "AI Permit Finder",
    purpose: "Generates and verifies the list of permits likely required for the project scope and jurisdiction.",
    inputs: ["Project scope", "Jurisdiction", "Zoning result", "Project type", "Site constraints"],
    actions: [
      "Generates required permit list",
      "Identifies optional or conditional permits",
      "Allows employee add/remove review",
      "Tracks permit completeness",
    ],
    outputs: ["Required permits", "Optional permits", "Missing permit alerts"],
    next: "Permit Sequence + Dependencies",
    page: "/dashboard/permits",
    availability: "live",
  },
  {
    n: 5,
    group: "Intake + Strategy",
    color: "blue",
    title: "Permit Sequence + Dependencies",
    module: "AI Dependency Mapper",
    purpose: "Maps which permits can proceed in parallel and which depend on earlier approvals.",
    inputs: ["Permit list", "Jurisdiction rules", "Agency dependencies", "Submission prerequisites"],
    actions: [
      "Identifies prerequisite permits",
      "Creates dependency map",
      "Generates recommended submission order",
      "Marks critical path",
    ],
    outputs: [
      "Permit dependency diagram",
      "Critical path",
      "Recommended order",
      "Parallel permit opportunities",
    ],
    next: "Agencies + Document Database",
    page: "/dashboard/roadmap",
    availability: "live",
  },
  {
    n: 6,
    group: "Intake + Strategy",
    color: "blue",
    title: "Agencies + Document Database",
    module: "AI Agency Mapper + Document Database",
    purpose:
      "Maps permits to responsible agencies and creates the document structure used throughout the permit lifecycle.",
    inputs: ["Permit list", "Agency rules", "Project ID", "Document categories"],
    actions: [
      "Assigns each permit to the responsible department",
      "Creates folders by permit and stage",
      "Enables version control",
      "Tracks uploads and approvals",
    ],
    outputs: [
      "Building Department",
      "Fire Department",
      "Utilities",
      "Engineering",
      "Document tree",
      "Latest versions",
      "Approval status",
    ],
    next: "City Contacts Auto-Fetch",
    page: "/dashboard/documents",
    availability: "partial",
    availabilityNote:
      "Agency mapping and the document repository are live; per-stage folders and version control are not built yet.",
  },
  {
    n: 7,
    group: "Requirements + Agency Data",
    color: "purple",
    title: "City Contacts Auto-Fetch",
    module: "AI City Contact Auto-Fetch",
    purpose: "Builds the city contact directory for reviewers, departments, and agency coordination.",
    inputs: ["Jurisdiction", "Agency list", "City department information"],
    actions: [
      "Auto-fetches city contacts where available",
      "Lets employees verify and edit",
      "Links contacts to project, permit, and task",
    ],
    outputs: ["Name", "Department", "Email", "Phone", "Role"],
    next: "City Requirement Extraction",
    page: "/dashboard/city",
    availability: "partial",
    availabilityNote: "City contacts are logged by hand on the City page; auto-fetching them isn't built yet.",
  },
  {
    n: 8,
    group: "Requirements + Agency Data",
    color: "purple",
    title: "City Requirement Extraction",
    module: "AI Requirement Extraction Tool",
    purpose:
      "Extracts applicable permitting rules from city codes, guidelines, forms, and submission instructions.",
    inputs: [
      "City codes",
      "Guidelines",
      "Application forms",
      "Permit submittal pages",
      "Agency requirements",
    ],
    actions: [
      "Scans city codes and guidelines",
      "Extracts relevant rules",
      "Tags requirements by permit type",
      "Assigns confidence score",
    ],
    outputs: ["Extracted requirements", "Code references", "Confidence score"],
    next: "Permit Checklist Creation",
    page: "/dashboard/checklist",
    availability: "partial",
    availabilityNote:
      "Requirements come from CorvusDP's built-in Texas reference rules; live scanning of each city's code isn't built yet.",
  },
  {
    n: 9,
    group: "Requirements + Agency Data",
    color: "purple",
    title: "Permit Checklist Creation",
    module: "AI Checklist Generator per Permit",
    purpose:
      "Creates a city-specific checklist for each permit so the team knows what must be prepared before submission.",
    inputs: ["Permit type", "Jurisdiction", "Extracted requirements", "Forms", "Drawing requirements"],
    actions: [
      "Creates checklist per permit and jurisdiction",
      "Includes forms, drawings, fees, and studies",
      "Tracks completion percentage and missing items",
    ],
    outputs: ["Submission checklist", "Completion percentage", "Missing items"],
    next: "Utilities / Capacity / Easements",
    page: "/dashboard/checklist",
    availability: "live",
  },
  {
    n: 10,
    group: "Requirements + Agency Data",
    color: "purple",
    title: "Utilities / Capacity / Easements",
    module: "AI Utilities + Easements Analyzer",
    purpose:
      "Checks whether offsite utilities, system capacity, and easements create feasibility or approval risks.",
    inputs: [
      "Water, sewer, power availability",
      "Transformer capacity",
      "Sewer capacity",
      "Water pressure/demand",
      "Utility/access/drainage easements",
    ],
    actions: [
      "Checks utility availability",
      "Flags offsite approval requirements",
      "Checks capacity limits",
      "Flags upgrades",
      "Identifies restricted easement areas",
    ],
    outputs: [
      "Utility availability map",
      "Capacity status",
      "Upgrade needed",
      "Easement map",
      "Restricted areas",
      "Risk level",
    ],
    next: "Overall Site Data for Design",
    page: "/dashboard/constraints",
    availability: "live",
  },
  {
    n: 11,
    group: "Requirements + Agency Data",
    color: "purple",
    title: "Overall Site Data for Design",
    module: "AI Site Constraint Summary",
    purpose: "Compiles the permitting/site constraints that must feed into design and application preparation.",
    inputs: ["Zoning", "Utilities", "Easements", "Floodplain", "Setbacks", "Access constraints"],
    actions: ["Compiles all constraints", "Generates design-ready report", "Flags permitting/design risks"],
    outputs: ["Site constraints summary", "Risk flags", "Design recommendations"],
    next: "Pre-Application Checklist + Meeting",
    page: "/dashboard/constraints",
    availability: "live",
  },
  {
    n: 12,
    group: "Pre-App + Package",
    color: "orange",
    title: "Pre-Application Checklist + Meeting",
    module: "AI Pre-App Meeting Assistant",
    purpose:
      "Prepares for pre-application coordination and captures agency feedback into the permitting record.",
    inputs: [
      "Required meetings",
      "Studies",
      "Reports",
      "Forms",
      "Fees",
      "Agency coordination steps",
      "Meeting notes/minutes/audio/email",
    ],
    actions: [
      "Generates pre-application checklist",
      "Extracts meeting comments, requirements, conditions, and action items",
      "Links items to permit, discipline, and phase",
      "Flags new requirements",
    ],
    outputs: [
      "Pre-application checklist",
      "Meeting summary",
      "New requirements",
      "Action items",
      "Responsible parties",
      "Updated project constraints",
    ],
    next: "Meeting Capture + Data Sync",
    page: "/dashboard/checklist",
    availability: "partial",
    availabilityNote:
      "The pre-application checklist and meeting agenda are live; extracting items from meeting notes isn't built yet.",
  },
  {
    n: 13,
    group: "Pre-App + Package",
    color: "orange",
    title: "Meeting Capture + Data Sync",
    module: "AI Meeting Capture + System Sync",
    purpose: "Turns meetings, calls, and voice notes into structured project data.",
    inputs: ["Zoom/Google Meet/Teams", "Manual voice upload", "Mobile voice notes", "Meeting notes"],
    actions: [
      "Creates full transcript",
      "Identifies speakers",
      "Extracts design changes, scope updates, timeline changes, and budget notes",
      "Updates project fields, permitting stage, and constraints",
      "Flags uncertain data for manual review",
    ],
    outputs: ["Transcript", "Speaker identification", "Updated project fields", "Flagged uncertain items"],
    next: "Communication Control Tower",
    page: "/dashboard/city",
    availability: "planned",
    availabilityNote: "Meeting transcription isn't built yet — log meetings by hand on the City page for now.",
  },
  {
    n: 14,
    group: "Pre-App + Package",
    color: "orange",
    title: "Communication Control Tower",
    module: "AI Action Items, Emails, Calls, Reminders",
    purpose: "Centralizes action items, drafts, call prep, communication logs, and reminders.",
    inputs: ["Meeting transcripts", "Pending tasks", "Project status", "Contacts", "Deadlines"],
    actions: [
      "Extracts tasks and responsibilities",
      "Generates email drafts for clients, engineers, city officials, and internal team",
      "Creates daily task queue",
      "Prepares call cards",
      "Tracks emails, calls, and meetings",
      "Generates reminders",
    ],
    outputs: [
      "Action item list",
      "Draft email queue",
      "Daily task list",
      "Call prep card",
      "Communication timeline",
      "Follow-up alerts",
    ],
    next: "Decision + Fee Support",
    page: "/dashboard/notifications",
    availability: "partial",
    availabilityNote:
      "The communication log and alerts are live; drafting emails and call cards isn't built yet.",
  },
  {
    n: 15,
    group: "Pre-App + Package",
    color: "orange",
    title: "Decision + Fee Support",
    module: "AI Decision Support + Fee Calculator",
    purpose: "Provides next-step guidance and calculates individual and total permit-related fees.",
    inputs: [
      "Project status",
      "Risks",
      "Dependencies",
      "Permit type",
      "City fee schedule",
      "Impact fees",
      "Utility fees",
      "Consultant fees",
    ],
    actions: [
      "Suggests whether to submit, wait, or change sequence",
      "Calculates permit fees",
      "Aggregates total fee estimate",
      "Allows manual adjustments",
    ],
    outputs: [
      "Decision suggestions",
      "Permit fee",
      "Utility fees",
      "Impact fees",
      "Consultant fees",
      "Grand total",
    ],
    next: "Documents + Application Package",
    page: "/dashboard/fees",
    availability: "live",
  },
  {
    n: 16,
    group: "Pre-App + Package",
    color: "orange",
    title: "Documents + Application Package",
    module: "AI Document Collection + QA + Application Builder",
    purpose:
      "Collects design documents, checks them against permit requirements, and prepares the final application package.",
    inputs: [
      "Architect/consultant documents",
      "Permit checklist",
      "Application forms",
      "Project data",
      "Latest revisions",
    ],
    actions: [
      "Generates required document list",
      "Tracks requested/received/missing documents",
      "Verifies latest revision and file naming",
      "Compares drawings against checklist",
      "Populates application forms",
      "Validates required fields",
      "Locks submission package",
    ],
    outputs: [
      "Requested/received/missing documents",
      "Revision status",
      "Checklist completion",
      "Compliance issues",
      "Design readiness score",
      "Submission index",
      "Validation errors",
    ],
    next: "City Relationship + Submission Ready",
    page: "/dashboard/prepare",
    availability: "partial",
    availabilityNote:
      "Package readiness against the checklist is live; comparing drawings and auto-filling forms isn't built yet.",
  },
  {
    n: 17,
    group: "Pre-App + Package",
    color: "orange",
    title: "City Relationship + Submission Ready",
    module: "AI City Relationship + Submission Assistant",
    purpose: "Maintains city communication history and ensures the package is ready for actual filing.",
    inputs: [
      "City interactions",
      "Contact directory",
      "Package status",
      "Pending follow-ups",
      "Submission requirements",
    ],
    actions: [
      "Logs meetings, calls, and emails",
      "Tracks city staff",
      "Tracks communication history",
      "Checks readiness for submission",
    ],
    outputs: ["Communication timeline", "Contact directory", "Pending follow-ups", "Ready for submission status"],
    next: "Submission Management",
    page: "/dashboard/city",
    availability: "live",
  },
  {
    n: 18,
    group: "Submission",
    color: "teal",
    title: "Submission Management",
    module: "AI Submission Management Assistant",
    purpose: "Files applications through the required method and records submission evidence.",
    inputs: ["Final package", "Portal/forms", "Required documents", "Submission method", "Payment details"],
    actions: [
      "Identifies submission method, online portal, forms, supporting documents, and submission sequence",
      "Stores portal links and instructions",
      "Records submission date and method",
      "Stores receipt and confirmation number",
      "Updates permit status",
    ],
    outputs: [
      "Submission portal",
      "Required forms/documents",
      "Submission instructions",
      "Submission date",
      "Confirmation number",
      "Current status",
    ],
    next: "City Review Tracking Dashboard",
    page: "/dashboard/permits",
    availability: "partial",
    availabilityNote:
      "Submission dates and permit status are tracked; storing portal links and receipts isn't built yet.",
  },
  {
    n: 19,
    group: "Current Review",
    color: "green",
    title: "City Review Tracking Dashboard",
    module: "AI Review Dashboard",
    purpose: "Provides the central visibility point for all submitted permits under review.",
    inputs: [
      "Submitted permit records",
      "Assigned reviewer",
      "Review duration",
      "Comment status",
      "City/portal updates",
    ],
    actions: [
      "Tracks review stage",
      "Tracks assigned reviewer",
      "Tracks review duration",
      "Tracks outstanding comments",
      "Calculates average review time",
    ],
    outputs: ["Under Review", "Awaiting Comments", "Approved", "Rejected", "Average review time"],
    next: "Plan Review Comment Analyzer",
    page: "/dashboard/reviews",
    availability: "live",
  },
  {
    n: 20,
    group: "Comment Loop",
    color: "red",
    title: "Plan Review Comment Analyzer",
    module: "AI Comment Analyzer",
    purpose: "Reads review letters and converts comments into categorized, actionable items.",
    inputs: ["Review letter", "Portal comments", "Reviewer notes", "Discipline context"],
    actions: [
      "Categorizes comments",
      "Identifies discipline",
      "Determines severity",
      "Recommends responsible consultant",
    ],
    outputs: ["Critical comments", "Minor comments", "Discipline breakdown", "AI recommendations"],
    next: "Responsibility Assignment",
    page: "/dashboard/reviews",
    availability: "live",
    availabilityNote: "Uses a real AI call to turn each reviewer comment into plain English and a required action.",
  },
  {
    n: 21,
    group: "Comment Loop",
    color: "red",
    title: "Responsibility Assignment",
    module: "AI Comment Responsibility Assignment",
    purpose: "Assigns each review comment to the correct owner and tracks accountability.",
    inputs: ["Categorized comments", "Discipline owner", "Consultant list", "Internal team roles"],
    actions: ["Assigns owner", "Assigns due date", "Notifies responsible party", "Tracks completion"],
    outputs: ["Assigned person", "Due date", "Status"],
    next: "Comment Tracker + Timeline",
    page: "/dashboard/reviews",
    availability: "partial",
    availabilityNote: "Each comment gets an owner and status; due dates and notifying the owner aren't built yet.",
  },
  {
    n: 22,
    group: "Comment Loop",
    color: "red",
    title: "Comment Tracker + Timeline",
    module: "AI Comment Timeline Tracker",
    purpose: "Tracks comment resolution timing so deadlines are not missed.",
    inputs: ["Open comments", "Due dates", "Owner status", "Revision progress"],
    actions: ["Monitors progress", "Monitors due dates", "Generates reminders", "Calculates resolution time"],
    outputs: ["Open comments", "Closed comments", "Timeline", "Average resolution time"],
    next: "Compliance Check from Design Team",
    page: "/dashboard/reviews",
    availability: "partial",
    availabilityNote: "Open vs. closed comments are tracked; reminders and resolution-time stats aren't built yet.",
  },
  {
    n: 23,
    group: "Comment Loop",
    color: "red",
    title: "Compliance Check from Design Team",
    module: "AI Compliance Checker",
    purpose: "Verifies that revised documents actually address every review comment before resubmission.",
    inputs: ["Revised drawings", "Original comments", "Design team responses"],
    actions: [
      "Compares revisions against review comments",
      "Verifies every comment addressed",
      "Flags unresolved items",
    ],
    outputs: ["Addressed comments", "Outstanding comments", "Compliance score"],
    next: "Resubmission Manager",
    page: "/dashboard/reviews",
    availability: "planned",
    availabilityNote:
      "Checking revised drawings against comments isn't built yet — mark comments addressed by hand on Reviews.",
  },
  {
    n: 24,
    group: "Comment Loop",
    color: "red",
    title: "Resubmission Manager",
    module: "AI Resubmission Cycle Assistant",
    purpose: "Packages revisions and loops the permit back to the city until approval.",
    inputs: ["Revised documents", "Previous submission", "Updated package", "Resubmission notes"],
    actions: [
      "Includes revised documents",
      "Archives previous submission",
      "Generates new submission package",
      "Updates submission history",
    ],
    outputs: ["Submission version", "Resubmission date", "Updated documents"],
    next: "Submission Count + Aging Risk",
    page: "/dashboard/permits",
    availability: "partial",
    availabilityNote: "Resubmitted status and review round are tracked; building the resubmission package isn't.",
  },
  {
    n: 25,
    group: "Approval / Expiry",
    color: "gray",
    title: "Submission Count + Aging Risk",
    module: "AI Submission Counter + Risk Monitor",
    purpose: "Tracks submission cycles and aging risk to identify delayed or problematic permits.",
    inputs: ["Submission history", "Review cycles", "Days since submission", "Average city review times"],
    actions: [
      "Counts submissions",
      "Counts review cycles",
      "Calculates average approval cycles",
      "Calculates days since submission",
      "Flags overdue permits",
      "Calculates risk score",
    ],
    outputs: [
      "Submission number",
      "Review cycle",
      "Approval trend",
      "Permit age",
      "Risk level",
      "Overdue alerts",
      "Recommended actions",
    ],
    next: "City Permit Expeditor",
    page: "/dashboard/timeline",
    availability: "staff",
    availabilityNote: "Aging risk is monitored by the CorvusDP team in the admin Permits view.",
  },
  {
    n: 26,
    group: "Approval / Expiry",
    color: "gray",
    title: "City Permit Expeditor",
    module: "AI Permit Expeditor",
    purpose: "Helps speed up approvals by coordinating follow-ups and escalation.",
    inputs: ["Aging permits", "Review status", "City contacts", "Commitments", "Escalation history"],
    actions: ["Schedules follow-ups", "Tracks escalations", "Logs responses", "Records commitments from city"],
    outputs: ["Follow-up timeline", "Escalation history", "Next action"],
    next: "Approval + Clearance Tracker",
    page: "/dashboard/city",
    availability: "partial",
    availabilityNote: "Follow-ups with the city are logged by hand; scheduling and escalation aren't automated yet.",
  },
  {
    n: 27,
    group: "Approval / Expiry",
    color: "gray",
    title: "Approval + Clearance Tracker",
    module: "AI Approval Tracker + Clearance Gate",
    purpose:
      "Records approved permits and checks whether pre-construction clearance conditions are satisfied.",
    inputs: [
      "Approval documents",
      "Conditions of approval",
      "Utility clearances",
      "Required agreements",
      "Inspection/clearance status",
    ],
    actions: [
      "Stores approval documents",
      "Records approval date and permit number",
      "Updates project status",
      "Verifies approvals, inspections, utility clearances, conditions, and agreements",
    ],
    outputs: [
      "Approved permits",
      "Approval dates",
      "Approval documents",
      "Clearance checklist",
      "Outstanding requirements",
      "Ready for construction status",
    ],
    next: "Permit Expiry Tracker",
    page: "/dashboard/approvals",
    availability: "live",
  },
  {
    n: 28,
    group: "Approval / Expiry",
    color: "gray",
    title: "Permit Expiry Tracker",
    module: "AI Expiry Monitor",
    purpose: "Tracks permit validity and renewal needs after approval.",
    inputs: ["Permit approval date", "Expiration date", "Validity period", "Assigned project manager"],
    actions: [
      "Tracks expiration dates",
      "Generates renewal reminders",
      "Calculates remaining validity",
      "Notifies assigned project manager before expiration",
    ],
    outputs: ["Expiration date", "Days remaining", "Renewal required", "Alert status"],
    next: "Central Visibility Outcome",
    page: "/dashboard/approvals",
    availability: "live",
  },
  {
    n: 29,
    group: "Approval / Expiry",
    color: "gray",
    title: "Central Visibility Outcome",
    module: "AI Dashboard Reporting Layer",
    purpose: "Shows the executive-level outcome of the permitting train-track system.",
    inputs: [
      "All station statuses",
      "Permit review data",
      "Comments/resubmission data",
      "Aging/risk data",
      "Approval/expiry data",
    ],
    actions: [
      "Aggregates permit visibility",
      "Highlights current status and bottlenecks",
      "Summarizes risks and next actions",
    ],
    outputs: [
      "Faster submissions",
      "Clearer accountability",
      "Central permit review visibility",
      "Reduced permit aging risk",
    ],
    next: "End of the line",
    page: "/dashboard",
    availability: "live",
  },
];

export const ROUTES: TrackRoute[] = [
  { name: "Intake + Strategy Route", color: "blue", stations: [1, 2, 3, 4, 5, 6] },
  { name: "Requirements + Agency Data", color: "purple", stations: [7, 8, 9, 10, 11] },
  { name: "Pre-App + Package Preparation", color: "orange", stations: [12, 13, 14, 15, 16, 17] },
  { name: "Submission + Parallel Permit Tracks", color: "teal", stations: [18] },
  { name: "Review + Comment / Resubmission Loop", color: "green", stations: [19, 20, 21, 22, 23, 24] },
  { name: "Approval / Clearance / Expiry", color: "gray", stations: [25, 26, 27, 28, 29] },
];

const BY_N = new Map(STATIONS.map((s) => [s.n, s]));

export function getStation(n: number): Station | undefined {
  return BY_N.get(n);
}

// ---------------------------------------------------------------------------
// Where is the train?

export type TrainLocation = {
  station: number;
  /** One plain sentence: why the train is parked here, from the real data. */
  reason: string;
};

// Same order as projects.ts PERMIT_FLOW — how far along a permit is.
const PERMIT_PROGRESS: Record<string, number> = {
  identified: 0,
  preparing: 1,
  submitted: 2,
  under_review: 3,
  comments: 4,
  resubmitted: 5,
  approved: 6,
};

const OPEN_COMMENT = (c: Pick<ReviewCommentRow, "status">) =>
  c.status !== "addressed" && c.status !== "closed";

// How many days out an expiry date counts as "watch this" on the map.
export const EXPIRY_WATCH_DAYS = 90;

/**
 * Parks the train at the project's real position. With several permits in
 * flight the train sits with the LEAST advanced one — that permit is what's
 * holding the project up, so it's where attention belongs.
 */
export function locateTrain(input: {
  hasAnalysis: boolean;
  permits: Pick<PermitRow, "name" | "status" | "expiry_date" | "review_round">[];
  checklist: Pick<ChecklistRow, "kind" | "required" | "done">[];
  comments: Pick<ReviewCommentRow, "status" | "responsible">[];
  today?: Date;
}): TrainLocation {
  const { hasAnalysis, permits, checklist, comments } = input;
  const today = input.today ?? new Date();

  if (!hasAnalysis) {
    return { station: 1, reason: "No permitting analysis has been saved for this property yet." };
  }
  if (permits.length === 0) {
    return {
      station: 4,
      reason: "The analysis didn't identify any permits for this project yet.",
    };
  }

  const pending = permits.filter((p) => p.status !== "approved");

  if (pending.length === 0) {
    const soonest = permits
      .filter((p) => p.expiry_date)
      .map((p) => ({ p, days: daysBetween(today, new Date(p.expiry_date!)) }))
      .sort((a, b) => a.days - b.days)[0];
    if (soonest && soonest.days <= EXPIRY_WATCH_DAYS) {
      return {
        station: 28,
        reason:
          soonest.days < 0
            ? `All permits are approved, but ${soonest.p.name} expired ${-soonest.days} day${-soonest.days === 1 ? "" : "s"} ago.`
            : `All permits are approved; ${soonest.p.name} expires in ${soonest.days} day${soonest.days === 1 ? "" : "s"}.`,
      };
    }
    return {
      station: 27,
      reason: `All ${permits.length} permit${permits.length === 1 ? " is" : "s are"} approved — next is pre-construction clearance.`,
    };
  }

  const behind = [...pending].sort(
    (a, b) => (PERMIT_PROGRESS[a.status] ?? 0) - (PERMIT_PROGRESS[b.status] ?? 0),
  )[0];
  const who = behind.name;

  switch (behind.status) {
    case "submitted":
      return { station: 18, reason: `${who} has been submitted and is waiting to enter city review.` };
    case "under_review":
      return { station: 19, reason: `${who} is under city review.` };
    case "resubmitted":
      return {
        station: 19,
        reason: `${who} was resubmitted${behind.review_round > 1 ? ` (review round ${behind.review_round})` : ""} and is back under city review.`,
      };
    case "comments": {
      const open = comments.filter(OPEN_COMMENT);
      if (comments.length === 0) {
        return {
          station: 20,
          reason: `The city returned comments on ${who} — log them on Reviews to break them down.`,
        };
      }
      const unowned = open.filter((c) => !c.responsible?.trim());
      if (unowned.length > 0) {
        return {
          station: 21,
          reason: `${unowned.length} review comment${unowned.length === 1 ? " has" : "s have"} no owner yet.`,
        };
      }
      if (open.length > 0) {
        return {
          station: 22,
          reason: `${open.length} review comment${open.length === 1 ? " is" : "s are"} still being worked on.`,
        };
      }
      return {
        station: 24,
        reason: `Every review comment on ${who} is addressed — ready to resubmit.`,
      };
    }
    default: {
      // identified / preparing: still getting ready to file.
      const preApp = checklist.filter((c) => c.kind === "pre_app" && c.required);
      const preAppDone = preApp.filter((c) => c.done).length;
      if (preAppDone < preApp.length) {
        return {
          station: 12,
          reason: `${preAppDone} of ${preApp.length} required pre-application items are done.`,
        };
      }
      const pkg = checklist.filter((c) => c.kind === "submission" && c.required);
      const pkgDone = pkg.filter((c) => c.done).length;
      if (pkgDone < pkg.length) {
        return {
          station: 16,
          reason: `The application package is ${pkgDone} of ${pkg.length} required items complete.`,
        };
      }
      return {
        station: 17,
        reason: `The package is complete — ${who} is ready to submit.`,
      };
    }
  }
}

function daysBetween(from: Date, to: Date): number {
  const day = 24 * 60 * 60 * 1000;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / day);
}

/** Where a permit sits on its own 4-stop parallel track (0-3), or -1 before filing. */
export function parallelTrackStop(status: string): number {
  switch (status) {
    case "submitted":
      return 0;
    case "under_review":
    case "resubmitted":
      return 1;
    case "comments":
      return 2;
    case "approved":
      return 3;
    default:
      return -1;
  }
}

export const PARALLEL_STOPS = ["Submitted", "Under review", "Comments / response", "Approved"];

// ---------------------------------------------------------------------------
// Bogies: the data the train has collected so far.
//
// One wagon per route the train has reached. Each carries "crates" — short
// labels of real data that route produced for this project (the analysis,
// the checklist, permit rows, review comments). Routes ahead of the train
// have no wagon yet: the train grows as the project moves down the line.

export type Wagon = {
  route: string;
  color: LineColor;
  crates: string[];
  /** The train is still on this route — its wagon is mid-load. */
  loading: boolean;
};

type CargoAnalysis = {
  jurisdiction: { authority: string };
  zoning: { code: string; label: string };
  permits: unknown[];
  fees: { totalLow: number; totalHigh: number };
  constraints: { utilities: unknown[]; criticalWarnings: string[] };
};

function compactUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function wagonCargo(input: {
  trainAt: number;
  analysis: CargoAnalysis | null;
  permits: Pick<PermitRow, "status">[];
  checklist: Pick<ChecklistRow, "kind" | "required" | "done">[];
  comments: Pick<ReviewCommentRow, "status">[];
}): Wagon[] {
  const { trainAt, analysis, permits, checklist, comments } = input;
  if (!analysis) return [];

  const count = (kind: string) => {
    const req = checklist.filter((c) => c.kind === kind && c.required);
    return `${req.filter((c) => c.done).length}/${req.length}`;
  };
  const progress = (s: string) => PERMIT_PROGRESS[s] ?? 0;
  const filed = permits.filter((p) => progress(p.status) >= PERMIT_PROGRESS.submitted).length;
  const inReview = permits.filter((p) =>
    ["under_review", "comments", "resubmitted"].includes(p.status),
  ).length;
  const approved = permits.filter((p) => p.status === "approved").length;
  const openComments = comments.filter(OPEN_COMMENT).length;

  const cargo: Record<LineColor, string[]> = {
    blue: [
      analysis.jurisdiction.authority,
      analysis.zoning.code
        ? `Zoning ${analysis.zoning.code}`
        : `Zoning: ${(analysis.zoning.label || "checked").toLowerCase()}`,
      plural(analysis.permits.length, "permit") + " found",
    ],
    purple: [
      plural(checklist.filter((c) => c.kind === "submission").length, "checklist item"),
      plural(analysis.constraints.utilities.length, "utility", "utilities") + " checked",
      plural(analysis.constraints.criticalWarnings.length, "site warning"),
    ],
    orange: [
      `Pre-app ${count("pre_app")}`,
      `Fees ${compactUsd(analysis.fees.totalLow)}–${compactUsd(analysis.fees.totalHigh)}`,
      `Package ${count("submission")}`,
    ],
    teal: [`${filed} of ${plural(permits.length, "permit")} filed`],
    green: [`${inReview} in review`, plural(comments.length, "comment"), `${openComments} open`],
    gray: [`${approved} of ${permits.length} approved`],
  };

  return ROUTES.filter((r) => r.stations[0] <= trainAt).map((r) => ({
    route: r.name,
    color: r.color,
    crates: cargo[r.color],
    loading: trainAt <= r.stations[r.stations.length - 1],
  }));
}

/** 0-100: how far down the whole line the train is (station 1 = 0). */
export function lineProgress(station: number): number {
  return Math.round(((station - 1) / (STATIONS.length - 1)) * 100);
}
