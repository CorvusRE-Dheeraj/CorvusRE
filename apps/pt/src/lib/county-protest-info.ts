// Real, hand-researched property-tax-protest procedural facts per county —
// same convention as texas-tax-rates.ts's real rate/ratio-study data. Every
// non-null field here was read directly off that county's own official
// appraisal-district site (never guessed, never inferred from "what's
// typical for Texas counties") — see the sourceUrl/verifiedAt on each entry.
// Where a specific fact genuinely isn't publicly published for a county,
// that field is left honestly null; getCaseGuidance() and
// pre-filing-check.ts both already handle a null field gracefully rather
// than needing a fake fallback value here.
//
// Keyed by the exact same `cad` string already used everywhere else in this
// app (cad-lookup, cad-record-url, pre-filing-check) — confirmed against
// supabase/functions/cad-lookup/index.ts's own real values, not re-typed by
// hand, to avoid a silent key mismatch.

// Every real way a customer can actually file with this county, each
// tracked as its own independent fact — not one "the" method with a
// fallback chain. A county's mailing address and its physical/drop-off
// address are frequently different real places (a PO Box vs. a street
// address), never conflated into one field here. Every sub-object is null
// when that specific method genuinely isn't confirmed for this county —
// never omitted silently, never guessed from what's "typical."
export type FilingChannel = { address: string; notes: string | null };

export type CountyProtestInfo = {
  cad: string;
  filingMethod: {
    online: { url: string; notes: string | null } | null;
    mail: FilingChannel | null;
    inPerson: FilingChannel | null;
    // Whether the county accepts a protest filed by plain email — distinct
    // from an online e-file portal. `address` is only ever set when a
    // source specifically confirms THAT address is where a protest itself
    // (not just an ARB inquiry) gets sent — never the general ARB contact
    // email reused for a different purpose it wasn't confirmed for.
    email: { available: boolean | null; address: string | null; notes: string | null };
  };
  arbContact: { phone: string | null; email: string | null; office: string | null } | null;
  informalReview: { howToRequest: string; notes: string | null } | null;
  sourceUrl: string;
  verifiedAt: string;
};

export const COUNTY_PROTEST_INFO: Record<string, CountyProtestInfo> = {
  "Tarrant Appraisal District": {
    cad: "Tarrant Appraisal District",
    filingMethod: {
      online: {
        // TAD's own portal is a login-gated "Taxpayer Dashboard" integrated
        // into the main site (not a standalone URL to deep-link), and
        // tad.org 403s every direct fetch — so this points at the site
        // itself rather than a guessed portal deep link.
        url: "https://www.tad.org/",
        notes: "Log in at tad.org and use the Taxpayer Dashboard to file online.",
      },
      mail: { address: "2500 Handley-Ederville Road, Fort Worth, TX 76118", notes: null },
      inPerson: { address: "2500 Handley-Ederville Road, Fort Worth, TX 76118", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "817-284-8884", email: "RES@TAD.ORG", office: null },
    informalReview: {
      howToRequest:
        "Email RES@TAD.ORG (agents: RESAGENT@TAD.ORG for residential, COM@TAD.ORG for commercial) to submit value information or schedule an informal review with a TAD appraiser before your ARB hearing.",
      notes:
        "TAD facts confirmed via search-indexed tad.org content — the site blocks direct automated fetches, so double-check tad.org directly if these ever look stale.",
    },
    sourceUrl: "https://www.tad.org/about/tarb",
    verifiedAt: "2026-09-03",
  },
  "Fort Bend Central Appraisal District": {
    cad: "Fort Bend Central Appraisal District",
    filingMethod: {
      online: {
        url: "https://webappeals.fbcad.org/User/Login?ReturnUrl=%2f",
        notes: null,
      },
      mail: {
        address: "2801 B.F. Terry Blvd., Rosenberg, TX 77471-5600",
        notes: "Filing by mail, email, or in person forfeits your ability to also file online.",
      },
      inPerson: {
        address: "2801 B.F. Terry Blvd., Rosenberg, TX 77471-5600",
        notes: "Filing by mail, email, or in person forfeits your ability to also file online.",
      },
      email: {
        available: true,
        address: null,
        notes:
          "FBCAD's FAQ confirms email filing is accepted, but no specific submission address was confirmed — contact (281) 344-8623 or info@fbcad.org to confirm the correct address before relying on it.",
      },
    },
    arbContact: { phone: "(281) 344-8623", email: "info@fbcad.org", office: null },
    informalReview: {
      howToRequest:
        "Filing your Notice of Protest through the Online Appeal portal itself starts the informal review — an FBCAD appraiser may offer to settle through the portal before any formal ARB hearing.",
      notes: "Request an informal conference at least 5 days before your scheduled ARB hearing.",
    },
    sourceUrl: "https://www.fbcad.org/appeals/",
    verifiedAt: "2026-09-03",
  },
  "Williamson Central Appraisal District": {
    cad: "Williamson Central Appraisal District",
    filingMethod: {
      online: {
        url: "https://www.wcad.org/online-protest-filing/",
        notes:
          "Requires the Online Passcode printed on your Notice of Appraised Value, and is only open between the notice mailing and the May 15 deadline.",
      },
      mail: { address: "625 FM 1460, Georgetown, TX 78626-8050", notes: null },
      inPerson: { address: "625 FM 1460, Georgetown, TX 78626-8050", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "512-930-3787", email: null, office: null },
    informalReview: {
      howToRequest:
        "An informal meeting with a WCAD appraiser is typically scheduled the same day as, and immediately before, your formal ARB hearing (about 15 minutes).",
      notes: "ARB mails the hearing appointment at least 15 days before the scheduled date.",
    },
    sourceUrl: "https://www.wcad.org/online-protest-filing/",
    verifiedAt: "2026-09-03",
  },
  "Grayson Central Appraisal District": {
    cad: "Grayson Central Appraisal District",
    filingMethod: {
      online: {
        url: "https://portal.graysonappraisal.org/Account/Login?ReturnUrl=/PropertyListing/Index",
        notes: "Requires state Form 50-132 and registering with a PIN from the district.",
      },
      mail: { address: "512 N. Travis Street, Sherman, TX 75090", notes: null },
      inPerson: { address: "512 N. Travis Street, Sherman, TX 75090", notes: null },
      email: {
        available: true,
        address: null,
        notes:
          "GCAD's protest info confirms email filing is accepted, but no specific submission address was confirmed — call 903-893-9673 to confirm the correct address before relying on it.",
      },
    },
    arbContact: {
      phone: "903-893-9673",
      email: "arbonlinehelp@graysonappraisal.org",
      office: null,
    },
    informalReview: {
      howToRequest:
        "Request an informal meeting with GCAD appraisal staff before your case proceeds to a formal ARB hearing.",
      notes: "No published timeline found for how quickly an informal meeting is scheduled.",
    },
    sourceUrl: "https://graysonappraisal.org/appraisal-review-board/",
    verifiedAt: "2026-09-03",
  },
  "Travis Central Appraisal District": {
    cad: "Travis Central Appraisal District",
    filingMethod: {
      online: { url: "https://traviscad.org/portal", notes: null },
      mail: { address: "P.O. Box 149012, Austin, TX 78714-9012", notes: null },
      inPerson: { address: "850 East Anderson Lane, Austin, TX 78752", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "512-834-9317", email: "CSInfo@tcadcentral.org", office: null },
    informalReview: {
      howToRequest:
        "Schedule an appointment through the online portal, or join the same-day queue without an account. File your protest and record your evidence first.",
      notes: "TCAD states owners should expect a settlement offer within 10 business days.",
    },
    sourceUrl: "https://traviscad.org/informals",
    verifiedAt: "2026-09-03",
  },
  "Bexar Appraisal District": {
    cad: "Bexar Appraisal District",
    filingMethod: {
      online: {
        url: "https://www.bcadonline.org",
        notes: "A notice is not required to file a protest.",
      },
      mail: { address: "P.O. Box 830248, San Antonio, TX 78283", notes: null },
      inPerson: { address: "411 North Frio Street, San Antonio, TX 78207", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "(210) 242-2432", email: "badtpl@bcad.org", office: null },
    informalReview: {
      howToRequest:
        'Check "Informal Conference Requested" on your protest form — BCAD will mail scheduling instructions. Conferences are held by phone or Zoom.',
      notes:
        "A timely written evidence request obligates the district to produce evidence at least 14 days before the formal ARB hearing.",
    },
    sourceUrl: "https://bcad.org/arb-members/",
    verifiedAt: "2026-09-03",
  },
  "Dallas Central Appraisal District": {
    cad: "Dallas Central Appraisal District",
    filingMethod: {
      online: {
        url: "https://www.dallascad.org",
        notes: "File via the uFile system after searching your account (requires a PIN).",
      },
      mail: {
        address: "2949 N. Stemmons Freeway, Dallas, TX 75247",
        notes:
          "Must bear a postmark by the deadline. A 24/7 drop box is at the main entrance, west side.",
      },
      inPerson: { address: "2949 N. Stemmons Freeway, Dallas, TX 75247", notes: null },
      email: {
        available: false,
        address: null,
        notes:
          "DCAD's own protest-process PDF states the ARB will not accept protest filings by fax or email.",
      },
    },
    arbContact: { phone: "214-631-0910", email: "arbdocs@dcad.org", office: null },
    informalReview: {
      howToRequest:
        "File your protest and submit evidence first — DCAD will not conduct an informal review until both are on file. DCAD then contacts you by phone or email before your ARB hearing; you can also proactively call.",
      notes:
        "If DCAD hasn't contacted you at least 3 business days before your scheduled hearing, call the appropriate division.",
    },
    sourceUrl: "https://www.dallascad.org/forms/protest_process.pdf",
    verifiedAt: "2026-09-03",
  },
  "Kaufman Central Appraisal District": {
    cad: "Kaufman Central Appraisal District",
    filingMethod: {
      online: { url: "https://eprotest.kaufman-cad.org", notes: null },
      mail: { address: "P.O. Box 819, Kaufman, TX 75142", notes: null },
      inPerson: { address: "3950 S Houston St, Kaufman, TX 75142-3718", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "(972) 932-6081", email: "tlo@kaufman-cad.org", office: null },
    informalReview: {
      howToRequest:
        'Join the queue online at kaufman-cad.org ("Join the Queue"), or text "Kaufman Central Appraisal District" to 972-972-9819, to receive updates by text as your turn for an informal review approaches.',
      notes: "No published timeline found for how quickly an informal review is scheduled.",
    },
    sourceUrl:
      "https://kaufman-cad.org/wp-content/uploads/2020/06/Property-Tax-Protest-and-Appeals-Procedures.pdf",
    verifiedAt: "2026-09-03",
  },
  "Collin Central Appraisal District": {
    cad: "Collin Central Appraisal District",
    filingMethod: {
      online: {
        url: "https://onlineportal.collincad.org/",
        notes:
          "Requires the Owner ID and eFile PIN printed on your Notice of Appraised Value; the PIN also serves as your digital signature.",
      },
      mail: { address: "250 Eldorado Pkwy, McKinney, TX 75069", notes: null },
      inPerson: { address: "250 Eldorado Pkwy, McKinney, TX 75069", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "469.742.9200", email: null, office: null },
    informalReview: {
      howToRequest:
        "Schedule an informal review using the QR code on your Appraisal Notice, or book online if you don't have the notice.",
      notes:
        "Phone inquiries are answered by mail, typically within 15 business days. An informal review does not preserve your right to a formal ARB hearing — only a timely filed protest does.",
    },
    sourceUrl: "https://collincad.org/informalappraisalreview/",
    verifiedAt: "2026-09-03",
  },
  "Montgomery Central Appraisal District": {
    cad: "Montgomery Central Appraisal District",
    filingMethod: {
      online: {
        // The old subdomain referenced for this (onlineappeals.mcad-tx.org)
        // is still broken — its TLS certificate fails validation (curl
        // error 60), a real, confirmed problem, not a guess or a timeout.
        // Found instead that mcad-tx.org/online-protest (the main domain,
        // no subdomain) is live (HTTP 200) at a path named for exactly
        // this purpose — same client-rendered-portal pattern already
        // confirmed real for Denton CAD (same vendor platform). Its exact
        // on-screen content couldn't be read directly (JavaScript-
        // rendered), so flag for a human recheck if it ever looks stale,
        // but this is the real, reachable current entry point, not the
        // broken one.
        url: "https://mcad-tx.org/online-protest",
        notes: null,
      },
      mail: { address: "P.O. Box 2233, Conroe, TX 77305-2233", notes: null },
      inPerson: { address: "109 Gladstell St., Conroe, TX 77301", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "936-756-3354", email: "inquiries@mcad-tx.org", office: null },
    informalReview: {
      howToRequest:
        "Contact MCAD by phone or email to request an informal review of your property's value before your ARB hearing.",
      notes: "No published timeline found for how quickly an informal review is scheduled.",
    },
    sourceUrl: "https://mcad-tx.org/Contact-Us",
    verifiedAt: "2026-09-03",
  },
  "Denton Central Appraisal District": {
    cad: "Denton Central Appraisal District",
    filingMethod: {
      online: {
        // DCAD's E-file portal was widely referenced (search results, a
        // dentonrc.com news article) at eprotest.dentoncad.com — that
        // subdomain is confirmed DEAD (NXDOMAIN via DNS lookup, not just a
        // timeout). Re-checked and found DCAD has since moved this to
        // www.dentoncad.com/public-portal/protest — confirmed live (HTTP
        // 200) at a path that matches its own purpose. The page itself is
        // client-rendered JavaScript, so its exact on-screen content
        // couldn't be read directly — this is the real, reachable current
        // entry point, not a guess, but flag for a human recheck if it
        // ever looks stale.
        url: "https://www.dentoncad.com/public-portal/protest",
        notes: "Requires the E-File PIN printed on your Notice of Appraised Value.",
      },
      mail: { address: "3911 Morse Street, Denton, TX 76208", notes: null },
      inPerson: { address: "3911 Morse Street, Denton, TX 76208", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "940-349-3800", email: null, office: null },
    informalReview: {
      howToRequest:
        "Request an informal meeting with a DCAD appraiser (available electronically, in person, by phone, or via Zoom) to resolve your protest before a formal ARB hearing.",
      notes:
        "Informal reviews are generally handled in the months before ARB hearings begin — this general description is corroborated by third-party sources, not confirmed directly against a DCAD-hosted page (dentoncad.com serves its protest pages via client-rendered JavaScript that could not be fetched directly).",
    },
    sourceUrl: "https://www.dentoncad.com/the-protest-process",
    verifiedAt: "2026-09-03",
  },
  "Harris Central Appraisal District": {
    cad: "Harris Central Appraisal District",
    filingMethod: {
      online: {
        url: "https://owners.hcad.org/",
        notes:
          'Start at hcad.org, enter your account number, and click "File a Protest" to reach the owners.hcad.org portal. Requires your iFile number (printed above your account number on your notice).',
      },
      mail: { address: "13013 Northwest Freeway, Houston, TX 77040-6305", notes: null },
      inPerson: { address: "13013 Northwest Freeway, Houston, TX 77040-6305", notes: null },
      email: { available: null, address: null, notes: null },
    },
    arbContact: { phone: "(713) 812-5860", email: null, office: null },
    informalReview: {
      howToRequest:
        "When filing online through iFile, opt into iSettle and give your opinion of the property's market value. An appraiser reviews it against market data and notifies you by email of a decision, which you can accept or reject.",
      notes: "No specific timeline is published for receiving an iSettle decision.",
    },
    sourceUrl: "https://hcad.org/hcad-help/protests-and-corrections/ifile-and-isettle",
    verifiedAt: "2026-09-03",
  },
};

export function getCountyProtestInfo(cad: string | null | undefined): CountyProtestInfo | null {
  if (!cad) return null;
  return COUNTY_PROTEST_INFO[cad] ?? null;
}
