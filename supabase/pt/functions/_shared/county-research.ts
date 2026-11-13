// The centralized county research engine: for one county and one topic
// (county-research-topics.ts), read the official statewide sources and the
// county's own sites, and have AI extract the rules, procedures, forms, fees,
// deadlines and submission methods — keeping statewide statute apart from
// county-specific procedure, and every URL, email and phone checked to
// appear in what was actually fetched (web-retrieval.ts). What can't be found
// is listed as unavailable, never filled in.
import { GEMINI_MODEL_FAST, geminiUrl } from "./gemini.ts";
import {
  corpus,
  groundedEmail,
  groundedPhone,
  groundedUrl,
  readOfficialSite,
  readPage,
  readPdf,
  type FetchedPage,
  type FetchedPdf,
} from "./web-retrieval.ts";
import {
  RESEARCH_TOPICS,
  type CountyResearch,
  type ResearchTopic,
} from "./county-research-topics.ts";

const SYSTEM = (
  topic: ResearchTopic,
  county: string,
) => `You research Texas property tax procedure for ${county} County from OFFICIAL pages only (Texas Comptroller, SOAH, the county's appraisal district and county government) — the pages and PDFs given. Topic: ${RESEARCH_TOPICS[topic].title}. Focus: ${RESEARCH_TOPICS[topic].focus}

Rules:
- Use ONLY what the provided pages state. Never fill in what is "typical" or what you remember. If something isn't on the pages, put it in "unavailable".
- "statewide": rules from statute or the Comptroller/SOAH that apply in every county. "countySpecific": procedures stated by THIS county's appraisal district or county government only.
- Every URL must be copied exactly from the pages. Cite the page each item came from in sourceUrl.
- Put anything that turns on facts only the owner or an attorney can confirm, or that the pages state ambiguously, in "verify".

Return ONLY JSON:
{"statewide":[{"text":"...","sourceUrl":"..."}],
 "countySpecific":[{"text":"...","sourceUrl":"..."}],
 "forms":[{"name":"...","url":"..."}],
 "fees":[{"item":"...","amount":"...","sourceUrl":"..."}],
 "deadlines":[{"event":"...","rule":"... (what starts the clock and how long)","sourceUrl":"..."}],
 "submission":[{"method":"online|email|mail|in_person|other","detail":"...","url":null,"email":null,"address":null}],
 "contacts":[{"name":"...","phone":null,"email":null,"url":null}],
 "verify":["..."],
 "unavailable":["..."]}`;

type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === "object") as Raw[])
    : [];
const str = (v: unknown, max = 600) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

export async function researchCounty(input: {
  topic: ResearchTopic;
  county: string; // "Bexar"
  cadWebsite: string | null;
  countyWebsite: string | null;
  apiKey: string;
}): Promise<CountyResearch> {
  const cfg = RESEARCH_TOPICS[input.topic];
  const pages: FetchedPage[] = [];
  const pdfs: FetchedPdf[] = [];
  const kind = new Map<string, "statewide" | "county">();
  const labels = new Map<string, string>();

  // statewide sources
  await Promise.all(
    cfg.statewide.map(async (s) => {
      const got = s.pdf ? await readPdf(s.url) : await readPage(s.url);
      if (!got) return;
      if (s.pdf) pdfs.push(got as FetchedPdf);
      else pages.push(got as FetchedPage);
      kind.set(s.url, "statewide");
      labels.set(s.url, s.label);
    }),
  );
  // the county's own sites
  const county = async (
    site: string | null,
    follow: RegExp | null,
    label: string,
  ) => {
    if (!site || !follow) return;
    const origin = (() => {
      try {
        return new URL(site.startsWith("http") ? site : `https://${site}`)
          .origin;
      } catch {
        return null;
      }
    })();
    if (!origin) return;
    const r = await readOfficialSite(origin, follow, {
      maxPages: 4,
      maxPdfs: 2,
    }).catch(() => null);
    for (const p of r?.pages ?? []) {
      pages.push(p);
      kind.set(p.url, "county");
      labels.set(p.url, label);
    }
    for (const p of r?.pdfs ?? []) {
      pdfs.push(p);
      kind.set(p.url, "county");
      labels.set(p.url, `${label} (PDF)`);
    }
  };
  await Promise.all([
    county(
      input.cadWebsite,
      cfg.cadFollow,
      `${input.county} appraisal district`,
    ),
    county(input.countyWebsite, cfg.countyFollow, `${input.county} County`),
  ]);

  const retrievedAt = new Date().toISOString();
  const empty: CountyResearch = {
    topic: input.topic,
    county: input.county,
    retrievedAt,
    statewide: [],
    countySpecific: [],
    forms: [],
    fees: [],
    deadlines: [],
    submission: [],
    contacts: [],
    verify: [],
    unavailable: ["The official pages couldn't be read just now."],
    sources: [],
  };
  if (pages.length === 0 && pdfs.length === 0) return empty;

  const pageText = pages
    .map(
      (p) =>
        `=== PAGE ${p.url} (${kind.get(p.url) === "county" ? "COUNTY" : "STATEWIDE"}) ===\n${p.text}\n--- links ---\n${p.links
          .filter((l) => l.label)
          .slice(0, 120)
          .map((l) => `${l.label} -> ${l.url}`)
          .join("\n")}`,
    )
    .join("\n\n");
  const pdfNote = pdfs
    .map(
      (p) =>
        `PDF attached: ${p.url} (${kind.get(p.url) === "county" ? "COUNTY" : "STATEWIDE"})`,
    )
    .join("\n");
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, input.apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM(input.topic, input.county) }],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: `${pdfNote}\n\n${pageText}` },
            ...pdfs.map((p) => ({
              inline_data: { mime_type: "application/pdf", data: p.base64 },
            })),
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    }),
  });
  if (!res.ok)
    throw new Error(
      `Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const out = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = out.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  let j: Raw = {};
  try {
    j = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    j = m ? JSON.parse(m[0]) : {};
  }

  // keep only what's grounded in what was fetched
  const c = corpus(pages);
  for (const p of pdfs) c.urls.add(p.url);
  const src = (v: unknown) => groundedUrl(v, c);
  const items = (v: unknown) =>
    arr(v)
      .map((x) => ({ text: str(x.text) ?? "", sourceUrl: src(x.sourceUrl) }))
      .filter((x) => x.text);
  const methods = ["online", "email", "mail", "in_person", "other"] as const;
  return {
    topic: input.topic,
    county: input.county,
    retrievedAt,
    statewide: items(j.statewide),
    countySpecific: items(j.countySpecific),
    forms: arr(j.forms)
      .map((x) => ({ name: str(x.name, 200) ?? "", url: src(x.url) ?? "" }))
      .filter((x) => x.name && x.url),
    fees: arr(j.fees)
      .map((x) => ({
        item: str(x.item, 200) ?? "",
        amount: str(x.amount, 120) ?? "",
        sourceUrl: src(x.sourceUrl),
      }))
      .filter((x) => x.item && x.amount),
    deadlines: arr(j.deadlines)
      .map((x) => ({
        event: str(x.event, 200) ?? "",
        rule: str(x.rule) ?? "",
        sourceUrl: src(x.sourceUrl),
      }))
      .filter((x) => x.event && x.rule),
    submission: arr(j.submission)
      .map((x) => ({
        method: (methods as readonly string[]).includes(String(x.method))
          ? (x.method as (typeof methods)[number])
          : "other",
        detail: str(x.detail) ?? "",
        url: src(x.url),
        email: groundedEmail(x.email, c),
        address: str(x.address, 300),
      }))
      .filter((x) => x.detail || x.url || x.email || x.address),
    contacts: arr(j.contacts)
      .map((x) => ({
        name: str(x.name, 200) ?? "",
        phone: groundedPhone(x.phone, c),
        email: groundedEmail(x.email, c),
        url: src(x.url),
      }))
      .filter((x) => x.name && (x.phone || x.email || x.url)),
    verify: (Array.isArray(j.verify) ? j.verify : [])
      .map((v) => str(v))
      .filter((v): v is string => !!v)
      .slice(0, 12),
    unavailable: (Array.isArray(j.unavailable) ? j.unavailable : [])
      .map((v) => str(v))
      .filter((v): v is string => !!v)
      .slice(0, 12),
    sources: [...kind.entries()].map(([url, k]) => ({
      url,
      label: labels.get(url) ?? url,
      kind: k,
    })),
  };
}
