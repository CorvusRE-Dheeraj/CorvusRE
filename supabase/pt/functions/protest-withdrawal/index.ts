// Deploy via CLI: `supabase functions deploy protest-withdrawal`.
// Requires GEMINI_API_KEY (shared with the other AI functions).
//
// Withdraw a protest, two steps:
//
// action "rules" — reads the appraisal district's OWN website (the official URL
// from the Texas Comptroller's directory, never one the caller supplies), follows
// its protest / withdrawal / forms pages and PDFs one level deeper than
// retrieve-county-procedures does, and extracts how that district says a protest
// is withdrawn: which ways it accepts (email, letter, phone, online), any form,
// the steps, the deadline and anything else it requires. Every URL, email and
// phone kept was checked to appear in what was fetched (../_shared/web-retrieval.ts).
// The district's contact details from the Comptroller directory ride along so the
// owner always has somewhere to send it. Cached per county in
// public.county_withdrawal_rules for 30 days.
//
// action "draft" — writes the withdrawal for one of the caller's own properties
// (read through RLS): a ready-to-send email, a letter, or a short phone script.
// Facts come only from the property, the protest and the cached county rules —
// the AI is told never to invent case numbers or dates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import directory from "../_shared/tx-cad-directory.json" with { type: "json" };
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { rateLimitUser } from "../_shared/rate-limit.ts";
import {
  corpus,
  followDeeper,
  groundedEmail,
  groundedPhone,
  groundedUrl,
  readOfficialSite,
} from "../_shared/web-retrieval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
// a county whose site said nothing is retried after a day, not held a month
const EMPTY_FRESH_MS = 24 * 60 * 60 * 1000;
// FAQs too: several districts answer "how do I withdraw my protest?" only in
// their FAQ pages (Collin: FAQ's → Notice of Appraised Value).
const FOLLOW =
  /withdraw|protest|appeal|review board|\barb\b|hearing|procedures|faq/i;
// Second hop: the withdrawal page itself, the ARB hearing procedures (where
// most districts state their withdrawal rules), or the notice / protest FAQ —
// read withdrawal links first.
const DEEPER =
  /withdraw|procedures|rules|protest|appraised[ -]value|appraisal[ -]notice|faq/i;

type Contact = {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  mailingAddress: string | null;
  streetAddress: string | null;
};
type DirEntry = { county: string; appraisalDistrict: Contact | null };
const counties = (
  directory as unknown as { counties: Record<string, DirEntry> }
).counties;

const RULES_SYSTEM = `You read a Texas appraisal district's own web pages (and any attached PDFs) and report how a property owner WITHDRAWS a property tax protest there (withdrawing a protest already filed with the appraisal review board, before or instead of the hearing). Use ONLY what the provided pages state. If the pages don't clearly say something, return null for it — never fill in what is "typical for Texas".

Return ONLY JSON with exactly this shape:
{"withdrawalDiscussed": <true if the pages say anything about withdrawing a protest, else false>,
 "summary": <one or two plain sentences on how this district says to withdraw, or null>,
 "email": {"accepted": <true only if the pages say a withdrawal may be emailed; false only if they say it may not; else null>, "address": <the email address withdrawals go to, or null>, "notes": <one short sentence, or null>},
 "letter": {"accepted": <true/false/null as above for a mailed or delivered written withdrawal>, "notes": <one short sentence, or null>},
 "phone": {"accepted": <true/false/null as above for withdrawing by phone>, "number": <the phone number for this, or null>, "notes": <one short sentence, or null>},
 "online": {"accepted": <true/false/null as above for withdrawing through an online portal>, "url": <portal URL copied exactly, or null>, "notes": <one short sentence, or null>},
 "form": {"name": <the name of a withdrawal form the pages mention, or null>, "url": <its URL copied exactly, or null>, "required": <true if the pages say the form must be used, false if optional, else null>},
 "steps": [<up to 5 short steps the pages give for submitting a withdrawal>],
 "deadline": <what the pages say about when a withdrawal must be received, or null>,
 "otherRequirements": [<up to 5 short items the pages require, e.g. signature, account number, agent authorization>],
 "sourceUrls": [<the page URLs you actually used, copied exactly>]}`;

type Method = "email" | "letter" | "phone";

type Rules = {
  withdrawalDiscussed: boolean;
  summary: string | null;
  email: {
    accepted: boolean | null;
    address: string | null;
    notes: string | null;
  };
  letter: { accepted: boolean | null; notes: string | null };
  phone: {
    accepted: boolean | null;
    number: string | null;
    notes: string | null;
  };
  online: {
    accepted: boolean | null;
    url: string | null;
    notes: string | null;
  };
  form: { name: string | null; url: string | null; required: boolean | null };
  steps: string[];
  deadline: string | null;
  otherRequirements: string[];
  sourceUrls: string[];
  retrievedAt: string;
};

const str = (v: unknown, max = 400): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const list = (v: unknown, n = 5): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, 300))
        .filter((x): x is string => !!x)
        .slice(0, n)
    : [];

function parseJson(raw: string): Record<string, unknown> {
  try {
    return obj(JSON.parse(raw));
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    try {
      return m ? obj(JSON.parse(m[0])) : {};
    } catch {
      return {};
    }
  }
}

type Part = {
  text?: string;
  inline_data?: { mime_type: string; data: string };
};

async function gemini(
  system: string,
  parts: Part[],
  timeoutMs = 55_000,
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
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
  return parseJson(out.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
}

async function readRules(name: string, website: string): Promise<Rules | null> {
  const { pages, pdfs } = await readOfficialSite(website, FOLLOW, {
    maxPages: 5,
    maxPdfs: 2,
  });
  if (pages.length === 0) return null;
  await followDeeper(website, pages, pdfs, DEEPER, {
    maxPages: 3,
    maxPdfs: 3,
    prefer: /withdraw|protest|appraised[ -]value/i,
  });
  const pageText = pages
    .map(
      (p) =>
        `=== PAGE ${p.url} ===\n${p.text}\n--- links on this page ---\n${p.links
          .filter((l) => l.label)
          .slice(0, 150)
          .map((l) => `${l.label} -> ${l.url}`)
          .join("\n")}`,
    )
    .join("\n\n");
  const parsed = await gemini(RULES_SYSTEM, [
    { text: `Appraisal district: ${name}\n\n${pageText}` },
    ...pdfs.map((p) => ({
      inline_data: { mime_type: "application/pdf", data: p.base64 },
    })),
  ]);

  // Keep only what's grounded in what was actually fetched.
  const c = corpus(pages);
  for (const p of pdfs) c.urls.add(p.url);
  const email = obj(parsed.email);
  const letter = obj(parsed.letter);
  const phone = obj(parsed.phone);
  const online = obj(parsed.online);
  const form = obj(parsed.form);
  const sourceUrls = Array.isArray(parsed.sourceUrls)
    ? parsed.sourceUrls
        .map((u) => groundedUrl(u, c))
        .filter((u): u is string => !!u)
    : [];
  return {
    withdrawalDiscussed: parsed.withdrawalDiscussed === true,
    summary: str(parsed.summary, 600),
    email: {
      accepted: bool(email.accepted),
      address: groundedEmail(email.address, c),
      notes: str(email.notes),
    },
    letter: { accepted: bool(letter.accepted), notes: str(letter.notes) },
    phone: {
      accepted: bool(phone.accepted),
      number: groundedPhone(phone.number, c),
      notes: str(phone.notes),
    },
    online: {
      accepted: bool(online.accepted),
      url: groundedUrl(online.url, c),
      notes: str(online.notes),
    },
    form: {
      name: str(form.name, 200),
      url: groundedUrl(form.url, c),
      required: bool(form.required),
    },
    steps: list(parsed.steps),
    deadline: str(parsed.deadline),
    otherRequirements: list(parsed.otherRequirements),
    sourceUrls: (sourceUrls.length > 0
      ? sourceUrls
      : pages.map((p) => p.url)
    ).slice(0, 5),
    retrievedAt: new Date().toISOString(),
  };
}

const DRAFT_SYSTEM = `You write a property owner's request to WITHDRAW their Texas property tax protest, addressed to the county appraisal review board (ARB) at the appraisal district. Write in plain, polite, professional English, in the owner's voice (first person).

Use ONLY the facts given. Never invent a case number, protest number, hearing date, address, name or any other detail that isn't given. If a detail isn't given, leave it out — don't add placeholders, except "[Your signature]" in a letter.

Always identify the property by its account number, property address and tax year, and say clearly that the owner withdraws the protest for that tax year. Mention a hearing date or filing confirmation number only if given. If the county rules list required items (e.g. a signature, the account number, a form), make sure the text covers them; if a form is required, add one sentence that the completed form is attached.

Return ONLY JSON, by method:
- email: {"subject": <short subject line>, "body": <the email body, greeting to sign-off, with the owner's name, phone and email under the sign-off when given>}
- letter: {"subject": <the RE: line, without "RE:">, "body": <the letter body from the salutation ("Dear Appraisal Review Board,") to the closing ("Sincerely,") — no date, no addresses, no signature block; those are added for you>}
- phone: {"opening": <what to say when the call is answered, 1-2 sentences>, "points": [<3-6 short lines to say or have ready, in order: who you are, the account number, address and tax year, that you are withdrawing, asking how to confirm it in writing>], "ask": [<2-4 short questions to ask, e.g. whether anything must also be sent in writing, and for a confirmation number>], "closing": <one sentence to end the call>}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });

  try {
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" },
        },
      },
    );
    const {
      data: { user },
    } = await callerClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const body = (await req.json()) as {
      action?: unknown;
      countyCode?: unknown;
      propertyId?: unknown;
      method?: unknown;
    };
    const countyCode =
      typeof body.countyCode === "string" ? body.countyCode : "";
    const entry = counties[countyCode];
    if (!entry?.appraisalDistrict)
      return json({ error: "Unknown county." }, 400);
    const district = entry.appraisalDistrict;
    const contact = {
      name: district.name,
      phone: district.phone,
      email: district.email,
      website: district.website,
      mailingAddress: district.mailingAddress,
      streetAddress: district.streetAddress,
    };

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    async function rulesFor(): Promise<{
      rules: Rules | null;
      cached: boolean;
    }> {
      const { data: cached } = await admin
        .from("county_withdrawal_rules")
        .select("rules, retrieved_at")
        .eq("county_code", countyCode)
        .maybeSingle();
      const r = cached?.rules as Rules | null | undefined;
      const maxAge = r?.withdrawalDiscussed ? FRESH_MS : EMPTY_FRESH_MS;
      if (
        cached &&
        Date.now() - new Date(cached.retrieved_at as string).getTime() < maxAge
      ) {
        return { rules: (cached.rules as Rules | null) ?? null, cached: true };
      }
      return { rules: null, cached: false };
    }

    if (body.action === "rules") {
      const hit = await rulesFor();
      if (hit.cached) return json({ rules: hit.rules, contact });
      const limited = await rateLimitUser(
        user.id,
        "protest-withdrawal-rules",
        20,
        corsHeaders,
      );
      if (limited) return limited;
      const rules = district.website
        ? await readRules(district.name, district.website)
        : null;
      // Cache either way — a site we couldn't read is retried after the window too.
      await admin.from("county_withdrawal_rules").upsert(
        {
          county_code: countyCode,
          cad_name: district.name,
          website: district.website ?? "",
          rules,
          retrieved_at: new Date().toISOString(),
        },
        { onConflict: "county_code" },
      );
      return json({ rules, contact });
    }

    if (body.action === "draft") {
      const method = body.method as Method;
      if (method !== "email" && method !== "letter" && method !== "phone") {
        return json({ error: "method must be email, letter or phone" }, 400);
      }
      if (typeof body.propertyId !== "string")
        return json({ error: "propertyId is required" }, 400);
      const limited = await rateLimitUser(
        user.id,
        "protest-withdrawal-draft",
        30,
        corsHeaders,
      );
      if (limited) return limited;

      // RLS: only the caller's own (or shared-account) property comes back.
      const { data: prop } = await callerClient
        .from("properties")
        .select("id, address, cad, account_number, owner_name, tax_year")
        .eq("id", body.propertyId)
        .maybeSingle();
      if (!prop) return json({ error: "Property not found." }, 404);
      const [{ data: protest }, { data: profile }, { rules }] =
        await Promise.all([
          callerClient
            .from("protests")
            .select("hearing_date, filing_confirmation_number")
            .eq("property_id", prop.id)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          callerClient
            .from("profiles")
            .select("first_name, last_name, phone, company_name")
            .eq("id", user.id)
            .maybeSingle(),
          rulesFor(),
        ]);
      const ownerName =
        [profile?.first_name, profile?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        prop.owner_name ||
        null;
      const facts = {
        method,
        appraisalDistrict: district.name,
        propertyAddress: prop.address,
        accountNumber: prop.account_number,
        taxYear: prop.tax_year,
        ownerOfRecord: prop.owner_name,
        writtenBy: ownerName,
        company: profile?.company_name ?? null,
        ownerPhone: profile?.phone ?? null,
        ownerEmail: user.email ?? null,
        hearingDate: protest?.hearing_date ?? null,
        filingConfirmationNumber: protest?.filing_confirmation_number ?? null,
        countyRules: rules
          ? {
              summary: rules.summary,
              form: rules.form,
              otherRequirements: rules.otherRequirements,
              deadline: rules.deadline,
            }
          : null,
      };
      const out = await gemini(
        DRAFT_SYSTEM,
        [{ text: JSON.stringify(facts, null, 2) }],
        40_000,
      );
      const draft =
        method === "phone"
          ? {
              opening: str(out.opening, 600) ?? "",
              points: list(out.points, 6),
              ask: list(out.ask, 4),
              closing: str(out.closing, 400) ?? "",
            }
          : {
              subject: str(out.subject, 200) ?? "",
              body: str(out.body, 6000) ?? "",
            };
      return json({
        draft,
        facts: {
          ownerName,
          ownerPhone: facts.ownerPhone,
          ownerEmail: facts.ownerEmail,
          accountNumber: prop.account_number,
          address: prop.address,
          taxYear: prop.tax_year,
        },
      });
    }

    return json({ error: "action must be rules or draft" }, 400);
  } catch (err) {
    console.error("protest-withdrawal failed:", err);
    return json(
      { error: err instanceof Error ? err.message : "unknown error" },
      500,
    );
  }
});
