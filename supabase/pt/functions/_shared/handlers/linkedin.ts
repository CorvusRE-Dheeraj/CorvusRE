// LinkedIn daily posting — see supabase/pt/linkedin.sql.
//
//   Admin router  POST ?action=linkedin { op: "connect" | "generate" | "publish" | "disconnect" }
//   Webhook router GET county-mail-inbound?action=linkedin-callback   (OAuth return, no JWT)
//   Hourly job    runLinkedInDaily(db) from marketing-send "due"
//
// Uses LinkedIn's official Posts API only (POST /rest/posts, "Share on
// LinkedIn" w_member_social for a person; w_organization_social for a company
// page once LinkedIn approves the Community Management API). Needs project
// secrets LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET; optional
// LINKEDIN_ORG_URN (urn:li:organization:…) to post as the company page,
// LINKEDIN_VERSION (default 202610 — LinkedIn supports each monthly version
// for at least a year).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl } from "../gemini.ts";
import { appBaseUrl } from "../app-url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: corsHeaders });

const LI_VERSION = () => Deno.env.get("LINKEDIN_VERSION") ?? "202610";
const CALLBACK = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/county-mail-inbound?action=linkedin-callback`;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DRAFT_AHEAD_DAYS = 7;
const MAX_DRAFTS_PER_RUN = 2;

type Settings = {
  post_days: string[];
  post_time: string;
  timezone: string;
  tone: string;
  cta_url: string;
  default_hashtags: string[];
};
type Post = {
  id: string;
  scheduled_for: string;
  status: string;
  theme: string;
  topic: string | null;
  body: string;
  hashtags: string[];
  link_url: string | null;
  attempts: number;
};
type Connection = { id: string; account_type: string; author_urn: string; access_token: string; expires_at: string | null };

// ── Content themes (weekday rotation) ─────────────────────────────────────
export const THEMES: Record<string, { label: string; brief: string }> = {
  tax_update: { label: "Texas tax update", brief: "A recent official Texas property-tax change and what it means for commercial owners." },
  deadline: { label: "Deadline reminder", brief: "An upcoming Texas property-tax date and what owners should do before it." },
  tip: { label: "Protest tip", brief: "One practical, specific tip for protesting a commercial property's appraisal in Texas." },
  feature: { label: "CorvusPT feature", brief: "One CorvusPT capability and the owner problem it solves (no hype, no savings promises)." },
  myth: { label: "Myth vs fact", brief: "A common misconception about Texas commercial property taxes, corrected." },
};
const ROTATION: Record<string, string> = { mon: "tax_update", tue: "deadline", wed: "tip", thu: "feature", fri: "myth", sat: "tip", sun: "tip" };

const KEY_DATES = [
  { m: 1, d: 1, label: "Appraisal date — values are set as of January 1" },
  { m: 1, d: 31, label: "Property taxes due — delinquent after January 31" },
  { m: 4, d: 15, label: "Business personal property renditions due April 15" },
  { m: 4, d: 30, label: "Most exemption applications due April 30" },
  { m: 5, d: 15, label: "Protest deadline: May 15, or 30 days after the appraisal notice" },
  { m: 10, d: 1, label: "Tax bills start arriving around October 1" },
];
const TIPS = [
  "Check the property description on your appraisal notice — wrong square footage or building class is the easiest win.",
  "Compare your value to similar nearby properties (equal and uniform), not only to recent sales.",
  "Ask the appraisal district for its evidence before the hearing — you're entitled to see what they'll use.",
  "Vacancy, deferred maintenance and below-market leases belong in your evidence for income properties.",
  "File the protest even if you're unsure — you can settle at the informal meeting.",
  "Keep the 30-day clock in mind: the deadline can be 30 days after your notice, not just May 15.",
  "Bring photos of condition issues and repair bids to the hearing.",
  "An income approach often fits commercial property better than raw sales comparisons.",
];
const FEATURES = [
  "CorvusPT computes each property's protest deadline automatically and reminds you before it.",
  "Corvus AI drafts an evidence packet from county comparables and your documents.",
  "One dashboard for every commercial property, its value history and its case status.",
  "Hearing preparation: practise with a mock ARB hearing before the real one.",
  "Texas Tax Updates: official rule changes, explained in plain language, checked daily.",
];
const MYTHS = [
  "Myth: protesting can raise your value. Fact: the appraisal review board can't raise it above the notice value in a protest.",
  "Myth: you need a lawyer to protest. Fact: owners can protest their own property.",
  "Myth: a high value is fine if taxes didn't go up. Fact: next year's increase starts from this year's value.",
  "Myth: only residential owners protest. Fact: commercial owners have the most at stake and the most evidence options.",
];

const pick = <T,>(list: T[], seed: number) => list[Math.abs(seed) % list.length];

/** Facts the AI may write about for this theme — real data, never invented. */
async function themeFacts(db: SupabaseClient, theme: string, date: Date): Promise<string> {
  const seed = Math.floor(date.getTime() / 864e5);
  if (theme === "tax_update") {
    const { data: alerts } = await db
      .from("tax_update_alerts")
      .select("title, what_changed, effective_date, marketing_sentence, source_name")
      .order("created_at", { ascending: false })
      .limit(3);
    const { data: rep } = await db.from("tax_update_reports").select("updates").order("week_start", { ascending: false }).limit(1).maybeSingle();
    const updates = ((rep?.updates ?? []) as { title: string; whatChanged: string; effectiveDate: string | null; sourceName: string; isNew: boolean }[])
      .filter((u) => u.isNew)
      .slice(0, 3);
    const facts = [
      ...(alerts ?? []).map((a) => `- ${a.title}: ${a.what_changed} (effective ${a.effective_date ?? "not stated"}; source ${a.source_name})`),
      ...updates.map((u) => `- ${u.title}: ${u.whatChanged} (effective ${u.effectiveDate ?? "not stated"}; source ${u.sourceName})`),
    ];
    if (facts.length) return `Recent official Texas changes (use ONE):\n${facts.join("\n")}`;
    return `No new official change this week — write a ${THEMES.tip.label.toLowerCase()} instead: ${pick(TIPS, seed)}`;
  }
  if (theme === "deadline") {
    const y = date.getUTCFullYear();
    const upcoming = [y, y + 1]
      .flatMap((yy) => KEY_DATES.map((k) => ({ ...k, at: Date.UTC(yy, k.m - 1, k.d) })))
      .filter((k) => k.at >= date.getTime())
      .sort((a, b) => a.at - b.at)
      .slice(0, 2)
      .map((k) => `- ${k.label} (${Math.round((k.at - date.getTime()) / 864e5)} days away)`);
    return `Upcoming Texas property-tax dates:\n${upcoming.join("\n")}`;
  }
  if (theme === "feature") return `Feature to explain: ${pick(FEATURES, seed)}`;
  if (theme === "myth") return `Myth to correct: ${pick(MYTHS, seed)}`;
  return `Tip to expand on: ${pick(TIPS, seed)}`;
}

async function gemini(prompt: string, system: string): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
    }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
  } catch {
    return null;
  }
}

/** Corvus AI writes one post (not saved). */
export async function draftPost(db: SupabaseClient, opts: { date: Date; theme?: string; topic?: string }) {
  const { data: s } = await db.from("linkedin_settings").select("*").eq("id", 1).single();
  const settings = s as Settings;
  const day = DAYS[opts.date.getUTCDay()];
  const theme = opts.theme && THEMES[opts.theme] ? opts.theme : (ROTATION[day] ?? "tip");
  const facts = opts.topic ? `Topic chosen by the marketing team: ${opts.topic}` : await themeFacts(db, theme, opts.date);
  const { data: recent } = await db.from("linkedin_posts").select("topic").order("scheduled_for", { ascending: false }).limit(12);
  const out = await gemini(
    `THEME: ${THEMES[theme].label} — ${THEMES[theme].brief}\n${facts}\n\nRecent topics to NOT repeat:\n${(recent ?? []).map((r) => `- ${r.topic}`).join("\n") || "(none)"}`,
    "You write LinkedIn posts for CorvusPT, a Texas commercial property-tax protest platform for owner-managed protests.\n" +
      `Voice: ${settings.tone}\n` +
      "Rules:\n" +
      "- Plain text only (no markdown, no asterisks for bold). First line is a short hook. Then 3-6 short lines or paragraphs. Max 1100 characters. At most 2 emojis.\n" +
      "- Use only the facts given; never invent numbers, laws, dates or results. Never promise savings or outcomes; no legal advice.\n" +
      "- End with a one-line call to action (no URL — it is added automatically).\n" +
      "- Write \"Section\", never the § sign.\n" +
      '- hashtags: 3-5 CamelCase words without the # sign, relevant to Texas commercial property tax.\n' +
      'Return ONLY JSON: {"topic": "<5-8 word summary>", "body": "...", "hashtags": ["..."]}',
  );
  if (!out || typeof out.body !== "string" || !out.body.trim()) throw new Error("Corvus AI couldn't write a post — try again.");
  const hashtags = [
    ...new Set(
      [...(Array.isArray(out.hashtags) ? (out.hashtags as unknown[]) : []), ...settings.default_hashtags]
        .filter((h): h is string => typeof h === "string")
        .map((h) => h.replace(/[^A-Za-z0-9]/g, ""))
        .filter(Boolean),
    ),
  ].slice(0, 5);
  return {
    theme,
    topic: String(out.topic ?? THEMES[theme].label).slice(0, 120),
    body: out.body.trim().replace(/§§\s*/g, "Sections ").replace(/§\s*/g, "Section ").replace(/\*\*/g, "").slice(0, 2500),
    hashtags,
    link_url: `${settings.cta_url}${settings.cta_url.includes("?") ? "&" : "?"}from=linkedin`,
    source_note: facts.split("\n").slice(0, 3).join(" ").slice(0, 400),
  };
}

// ── LinkedIn "little" text format ─────────────────────────────────────────
/** Escapes LinkedIn's reserved characters and turns hashtags into templates. */
export function toLittleText(body: string, hashtags: string[], link: string | null): string {
  const esc = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  const tags = hashtags.map((h) => `{hashtag|\\#|${h.replace(/[^A-Za-z0-9]/g, "")}}`).join(" ");
  // the URL isn't escaped (it would break link detection) — ours has no reserved characters
  const safeLink = link && !/[\\|{}@[\]()<>#*_~]/.test(link) ? link : null;
  return [esc(body.trim()), safeLink, tags].filter(Boolean).join("\n\n");
}

/** When a posting day's slot happens, in the configured time zone. */
export function slotFor(dateISO: string, time: string, tz: string): Date {
  const [h, m] = time.split(":").map(Number);
  const guess = new Date(`${dateISO}T${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(guess)
    .reduce<Record<string, string>>((o, p) => ((o[p.type] = p.value), o), {});
  const asZoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(guess.getTime() - (asZoned - guess.getTime()));
}

async function activeConnection(db: SupabaseClient): Promise<Connection | null> {
  const { data } = await db.from("linkedin_connections").select("id, account_type, author_urn, access_token, expires_at").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as Connection | null) ?? null;
}

/** Publishes one post through the official Posts API. */
export async function publishPost(db: SupabaseClient, post: Post) {
  const conn = await activeConnection(db);
  if (!conn) throw new Error("LinkedIn isn't connected — connect it in Marketing → LinkedIn.");
  if (conn.expires_at && Date.parse(conn.expires_at) < Date.now()) throw new Error("The LinkedIn connection expired — reconnect it in Marketing → LinkedIn.");
  await db.from("linkedin_posts").update({ status: "posting", attempts: post.attempts + 1, error: null }).eq("id", post.id);
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "LinkedIn-Version": LI_VERSION(),
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      author: conn.author_urn,
      commentary: toLittleText(post.body, post.hashtags, post.link_url),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (res.status === 201) {
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    const url = urn ? `https://www.linkedin.com/feed/update/${urn}/` : null;
    await db.from("linkedin_posts").update({ status: "posted", posted_at: new Date().toISOString(), linkedin_urn: urn, post_url: url, error: null }).eq("id", post.id);
    await db.from("linkedin_connections").update({ last_error: null }).eq("id", conn.id);
    return { urn, url };
  }
  const text = (await res.text()).slice(0, 400);
  const msg =
    res.status === 401
      ? "LinkedIn rejected the connection (expired or revoked) — reconnect it in Marketing → LinkedIn."
      : res.status === 403
        ? "LinkedIn refused the post (missing posting permission for this account/page)."
        : `LinkedIn error ${res.status}: ${text}`;
  await db.from("linkedin_posts").update({ status: "failed", error: msg }).eq("id", post.id);
  if (res.status === 401 || res.status === 403) await db.from("linkedin_connections").update({ last_error: msg }).eq("id", conn.id);
  throw new Error(msg);
}

async function allowed(db: SupabaseClient, key: string): Promise<boolean> {
  const { data } = await db.from("automation_permissions").select("enabled").eq("key", key).maybeSingle();
  return data?.enabled === true;
}

async function notifyMarketing(db: SupabaseClient, kind: string, title: string, detail: string) {
  await db.rpc("notify_department", {
    p_department: "marketing", p_owner: null, p_kind: kind, p_title: title, p_detail: detail,
    p_entity_type: "linkedin", p_entity_id: null, p_lead: null,
  });
}

/** Hourly: draft the upcoming posting days, publish what's due, watch the token. */
export async function runLinkedInDaily(db: SupabaseClient) {
  const out: Record<string, unknown> = {};
  const { data: s } = await db.from("linkedin_settings").select("*").eq("id", 1).single();
  const settings = s as Settings;
  const now = new Date();

  if (await allowed(db, "linkedin_daily_drafts")) {
    const autoApprove = await allowed(db, "linkedin_auto_approve");
    const { data: upcoming } = await db.from("linkedin_posts").select("scheduled_for").gte("scheduled_for", new Date(now.getTime() - 864e5).toISOString());
    const taken = new Set((upcoming ?? []).map((p) => slotDay(p.scheduled_for, settings.timezone)));
    let made = 0;
    for (let i = 1; i <= DRAFT_AHEAD_DAYS && made < MAX_DRAFTS_PER_RUN; i++) {
      const day = new Date(now.getTime() + i * 864e5);
      const iso = slotDay(day.toISOString(), settings.timezone);
      const dow = DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
      if (!settings.post_days.includes(dow) || taken.has(iso)) continue;
      try {
        const d = await draftPost(db, { date: new Date(`${iso}T12:00:00Z`) });
        await db.from("linkedin_posts").insert({
          ...d, scheduled_for: slotFor(iso, settings.post_time, settings.timezone).toISOString(),
          status: autoApprove ? "approved" : "draft", ai_generated: true,
        });
        made++;
      } catch (e) {
        out.draftError = String(e);
        break;
      }
    }
    out.drafted = made;
    if (made > 0 && !autoApprove) {
      await notifyMarketing(db, "linkedin_drafts", `${made} new LinkedIn draft${made === 1 ? "" : "s"} to review`, "Approve them in Marketing → LinkedIn — only approved posts are published.");
    }
  }

  // not connected yet → approved posts simply wait (and go stale after 12h) — no hourly error spam
  const live = await activeConnection(db);
  if (!live) out.publishing = "LinkedIn not connected";
  if (live && (await allowed(db, "linkedin_auto_publish"))) {
    const { data: due } = await db.from("linkedin_posts").select("*").eq("status", "approved").lte("scheduled_for", now.toISOString()).order("scheduled_for").limit(3);
    const published: string[] = [];
    for (const p of (due ?? []) as Post[]) {
      // a post more than 12 hours late is stale (e.g. LinkedIn was disconnected) — don't post it out of the blue
      if (now.getTime() - Date.parse(p.scheduled_for) > 12 * 3600e3) {
        await db.from("linkedin_posts").update({ status: "skipped", error: "Missed its posting time — reschedule it to post." }).eq("id", p.id);
        continue;
      }
      try {
        await publishPost(db, p);
        published.push(p.id);
      } catch (e) {
        out.publishError = String(e);
        await notifyMarketing(db, "linkedin_failed", "A LinkedIn post didn't publish", String(e).slice(0, 300));
        break;
      }
    }
    out.published = published.length;
  }

  const conn = await activeConnection(db);
  if (conn?.expires_at) {
    const daysLeft = (Date.parse(conn.expires_at) - now.getTime()) / 864e5;
    // once a day, at the posting hour: LinkedIn tokens last 60 days and can't be refreshed silently
    if (daysLeft < 7 && now.getUTCHours() === 15) {
      await notifyMarketing(db, "linkedin_expiring", daysLeft <= 0 ? "LinkedIn connection expired" : `LinkedIn connection expires in ${Math.ceil(daysLeft)} day(s)`, "Reconnect in Marketing → LinkedIn so scheduled posts keep going out.");
    }
  }
  return out;
}

/** "YYYY-MM-DD" of an instant in the posting time zone. */
function slotDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// ── Staff actions (admin router) ──────────────────────────────────────────
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await db.from("profiles").select("is_admin, marketing_admin").eq("id", user.id).single();
    if (!me?.is_admin && !me?.marketing_admin) return json({ error: "not authorized" }, 403);
    const body = (await req.json().catch(() => ({}))) as { op?: string; postId?: string; date?: string; theme?: string; topic?: string };

    if (body.op === "connect") {
      const clientId = Deno.env.get("LINKEDIN_CLIENT_ID");
      if (!clientId || !Deno.env.get("LINKEDIN_CLIENT_SECRET")) {
        return json({ error: "LinkedIn isn't set up yet: add the LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET secrets (see the setup steps on this page)." }, 400);
      }
      const state = crypto.randomUUID();
      await db.from("linkedin_oauth_states").insert({ state, staff_id: user.id });
      const scopes = ["openid", "profile", "w_member_social", ...(Deno.env.get("LINKEDIN_ORG_URN") ? ["w_organization_social"] : [])];
      const auth = new URL("https://www.linkedin.com/oauth/v2/authorization");
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("client_id", clientId);
      auth.searchParams.set("redirect_uri", CALLBACK());
      auth.searchParams.set("state", state);
      auth.searchParams.set("scope", scopes.join(" "));
      return json({ url: auth.toString(), redirectUri: CALLBACK() });
    }
    if (body.op === "disconnect") {
      await db.from("linkedin_connections").update({ active: false }).eq("active", true);
      return json({ ok: true });
    }
    if (body.op === "generate") {
      const date = body.date ? new Date(`${body.date}T12:00:00Z`) : new Date();
      return json(await draftPost(db, { date, theme: body.theme, topic: body.topic }));
    }
    if (body.op === "publish") {
      const { data: p } = await db.from("linkedin_posts").select("*").eq("id", String(body.postId)).single();
      if (!p) return json({ error: "Post not found" }, 404);
      if (!["draft", "approved", "failed", "skipped"].includes(p.status)) return json({ error: `This post is already ${p.status}` }, 400);
      // "Post now" is itself the approval
      await db.from("linkedin_posts").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", p.id);
      return json(await publishPost(db, { ...(p as Post), status: "approved" }));
    }
    return json({ error: "Unknown op" }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 400);
  }
}

// ── OAuth return (webhook router, no JWT) ─────────────────────────────────
export async function handleCallback(req: Request): Promise<Response> {
  const back = (q: string) => Response.redirect(`${appBaseUrl()}/marketing?tab=linkedin&linkedin=${q}`, 302);
  try {
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    if (u.searchParams.get("error")) return back(encodeURIComponent(u.searchParams.get("error_description") ?? "cancelled"));
    if (!code || !state) return back("missing-code");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: st } = await db.from("linkedin_oauth_states").select("staff_id, created_at").eq("state", state).maybeSingle();
    await db.from("linkedin_oauth_states").delete().eq("state", state);
    if (!st || Date.now() - Date.parse(st.created_at) > 30 * 60e3) return back("expired-try-again");

    const tok = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: CALLBACK(),
        client_id: Deno.env.get("LINKEDIN_CLIENT_ID")!, client_secret: Deno.env.get("LINKEDIN_CLIENT_SECRET")!,
      }),
    });
    const t = (await tok.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string };
    if (!t.access_token) return back("token-failed");
    const me = (await (await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } })).json()) as { sub?: string; name?: string };
    if (!me.sub) return back("profile-failed");
    const org = Deno.env.get("LINKEDIN_ORG_URN");
    await db.from("linkedin_connections").update({ active: false }).eq("active", true);
    await db.from("linkedin_connections").insert({
      connected_by: st.staff_id,
      account_type: org ? "organization" : "person",
      author_urn: org ?? `urn:li:person:${me.sub}`,
      display_name: org ? `Company page (connected by ${me.name ?? "staff"})` : (me.name ?? "LinkedIn member"),
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      expires_at: new Date(Date.now() + (t.expires_in ?? 5184000) * 1000).toISOString(),
      scopes: t.scope ?? null,
    });
    return back("connected");
  } catch {
    return back("error");
  }
}
