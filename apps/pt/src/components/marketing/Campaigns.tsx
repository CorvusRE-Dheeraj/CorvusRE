import { useEffect, useMemo, useState } from "react";
import { Plus, Settings2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { confirmDialog } from "@/components/ConfirmHost";
import { MarkdownLite } from "@/components/MarkdownLite";
import { getErrorMessage } from "@/lib/error-message";
import {
  STAGES,
  STAGE_LABEL,
  audienceLeads,
  audienceMatch,
  deleteCampaign,
  funnel,
  pct,
  relDays,
  runAi,
  saveCampaign,
  sendCampaign,
  setCampaignStatus,
  splitDraft,
  type Audience,
  type Campaign,
  type MarketingData,
  type Stage,
  type TemplateObjective,
  OBJECTIVE_LABEL,
  TEMPLATE_OBJECTIVES,
  markTemplateUsed,
  FREQUENCY_LABEL,
  channelStatus,
  loadMessages,
  saveSettings,
  type CampaignFrequency,
  type CampaignRule,
  type Message,
} from "@/lib/marketing";
import { TEMPLATE_TOKENS, applyFilters, pickObjective } from "@/lib/marketing-crm";
import {
  audienceEligibility,
  campaignRates,
  cleanCampaignIdeas,
  cleanRules,
  RULE_TRIGGER_LABEL,
  type CampaignIdea,
} from "@/lib/marketing-analytics";
import { Templates } from "./Templates";
import { CampaignBadge, Field, inputCls, type Focus } from "./shared";

// Create → approve → send now / schedule → (pause/resume) → sent, with
// results. Audience is a filter over the same leads the CRM holds, so the
// recipient count is always live. Email only for now; SMS needs a provider.
export function Campaigns({
  data,
  focus,
  reload,
}: {
  data: MarketingData;
  focus: Focus;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [preset, setPreset] = useState<{
    name: string;
    audience: Audience;
    idea?: CampaignIdea;
  } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  useEffect(() => {
    if (focus.campaignId) {
      const c = data.campaigns.find((x) => x.id === focus.campaignId);
      if (c) setEditing(c);
    }
    if (focus.newCampaign) {
      const seg = data.segments.find((x) => x.id === focus.newCampaign!.segmentId);
      setPreset({
        name: focus.newCampaign.name,
        audience: {
          leadIds: focus.newCampaign.leadIds,
          ...(seg ? { segmentId: seg.id, segmentName: seg.name } : {}),
        },
      });
      setEditing("new");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const [tab, setTab] = useState<"all" | "live" | "draft" | "paused" | "sent">("all");
  const [ideas, setIdeas] = useState<CampaignIdea[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<{
    smsConfigured: boolean;
    resend: { ok: boolean; note?: string };
  } | null>(null);
  useEffect(() => {
    channelStatus()
      .then(setStatus)
      .catch(() => setStatus({ smsConfigured: false, resend: { ok: false } }));
  }, []);
  const staffName = (id: string | null) => data.staff.find((s) => s.id === id)?.name ?? "—";
  const list = data.campaigns.filter((c) =>
    tab === "all"
      ? true
      : tab === "live"
        ? ["approved", "scheduled", "sending"].includes(c.status)
        : c.status === tab,
  );
  const audienceText = (c: Campaign) =>
    c.audience.segmentName ??
    (c.audience.leadIds?.length
      ? `${c.audience.leadIds.length} chosen leads`
      : [
          c.audience.stages?.map((s) => STAGE_LABEL[s]).join(", ") || "Everyone",
          c.audience.counties?.join(", "),
          c.audience.propertyTypes?.join(", "),
        ]
          .filter(Boolean)
          .join(" · "));

  async function suggest() {
    setThinking(true);
    try {
      const f = funnel(data.leads);
      const byStage = Object.entries(
        data.leads.reduce<Record<string, number>>(
          (m, l) => ((m[l.stage] = (m[l.stage] ?? 0) + 1), m),
          {},
        ),
      );
      const counties = Object.entries(
        data.leads
          .flatMap((l) => l.counties)
          .reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      const r = await runAi({
        scope: "campaign-ideas",
        instruction:
          "Recommend up to 4 campaigns for CorvusPT right now. For each: who to target, channel, message, schedule and owner. Reply with JSON only: " +
          '[{"name": "...", "why": "one line", "objective": "initial_outreach|assessment_increase|deadline|registration_reminder|subscription_promo|follow_up|add_property|finish_checkout", ' +
          '"channel": "email|sms", "audience": {"stages": [...], "counties": [...], "propertyTypes": [...]}, "frequency": "once|weekly|twice_monthly|monthly", "sendOn": "yyyy-mm-dd", ' +
          '"owner": "<staff name>", "subject": "...", "body": "plain text under 120 words with {{first_name}} and links where useful"}]. ' +
          `SMS only for leads with SMS consent (${data.leads.filter((l) => l.smsConsent === "granted").length} have it${status?.smsConfigured ? "" : "; SMS isn't connected yet, so prefer email"}). Today is ${new Date().toISOString().slice(0, 10)}. Never promise savings.`,
        context: JSON.stringify({
          funnel: f,
          byStage,
          counties,
          staff: data.staff.map((s) => s.name),
          recentCampaigns: data.campaigns.slice(0, 8).map((c) => ({
            name: c.name,
            status: c.status,
            metrics: data.campaignMetrics.get(c.id) ?? null,
          })),
        }),
      });
      const parsed = cleanCampaignIdeas(
        JSON.parse((r.result ?? "").match(/\[[\s\S]*\]/)?.[0] ?? "[]"),
        data,
      );
      if (!parsed.length) throw new Error("Corvus AI didn't return usable ideas — try again.");
      setIdeas(parsed);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't get campaign ideas."));
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {!data.settings.postalAddress && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Add the company&apos;s postal address before sending email campaigns — US law (CAN-SPAM)
          requires it in every marketing email.{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => setShowSettings(true)}
          >
            Add it
          </button>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-md border border-border p-0.5 text-sm"
          role="tablist"
          aria-label="Campaign status"
        >
          {(
            [
              ["all", "All"],
              ["live", "Live"],
              ["draft", "Drafts"],
              ["paused", "Paused"],
              ["sent", "Sent"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded px-3 py-1 ${tab === k ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={thinking}
          onClick={() => void suggest()}
          className="btn-outline ml-auto inline-flex items-center gap-1.5 text-sm"
        >
          <Sparkles className="h-4 w-4" aria-hidden />{" "}
          {thinking ? "Thinking…" : "Suggest campaigns"}
        </button>
        <button
          type="button"
          onClick={() => setShowTemplates(true)}
          className="btn-outline text-sm"
        >
          Templates ({data.templates.filter((t) => t.active).length})
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          aria-label="Campaign settings"
          title="Campaign settings"
          className="btn-outline px-2.5 text-sm"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setPreset(null);
            setEditing("new");
          }}
          className="btn-primary btn-primary-hover inline-flex items-center gap-1.5 text-sm"
        >
          <Plus className="h-4 w-4" aria-hidden /> New campaign
        </button>
      </div>

      {ideas && (
        <section className="card-elev p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Corvus AI recommends
            </h2>
            <button
              type="button"
              onClick={() => setIdeas(null)}
              className="text-xs text-muted-foreground"
            >
              Hide
            </button>
          </div>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {ideas.map((i) => {
              const reach = audienceLeads(
                {
                  stages: i.audience.stages,
                  counties: i.audience.counties,
                  propertyTypes: i.audience.propertyTypes,
                },
                data.leads,
                i.channel,
              ).length;
              return (
                <li key={i.name} className="grid gap-1 rounded-md border border-border p-3 text-sm">
                  <b>{i.name}</b>
                  <span className="text-xs text-muted-foreground">{i.why}</span>
                  <span className="text-xs">
                    {i.channel === "sms" ? "Text" : "Email"} · {FREQUENCY_LABEL[i.frequency]}
                    {i.sendOn && ` · from ${i.sendOn}`} · {reach} recipient{reach === 1 ? "" : "s"}
                    {i.ownerId && ` · ${staffName(i.ownerId)}`}
                  </span>
                  <button
                    type="button"
                    className="btn-primary btn-primary-hover mt-1 justify-self-start py-1 text-xs"
                    onClick={() => {
                      setPreset({
                        name: i.name,
                        audience: i.audience,
                        idea: i,
                      });
                      setEditing("new");
                    }}
                  >
                    Create draft
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="card-elev overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Campaign</th>
              <th className="px-3 py-2 font-medium">Audience</th>
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Schedule</th>
              <th className="px-3 py-2 font-medium">Performance</th>
              <th className="px-3 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No campaigns here. Create one, or ask Corvus AI for suggestions.
                </td>
              </tr>
            )}
            {list.map((c) => {
              const m = data.campaignMetrics.get(c.id);
              const r = campaignRates(m);
              return (
                <tr
                  key={c.id}
                  onClick={() => setEditing(c)}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary/40"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Updated {relDays(c.updatedAt)}
                    </div>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2 text-xs">
                    <div className="truncate">{audienceText(c)}</div>
                    <div className="text-muted-foreground">
                      {audienceLeads(c.audience, data.leads, c.channel).length} eligible now
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{c.channel === "sms" ? "Text" : "Email"}</td>
                  <td className="px-3 py-2">
                    <CampaignBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>{FREQUENCY_LABEL[c.frequency]}</div>
                    <div className="text-muted-foreground">
                      {c.status === "scheduled" && c.scheduledAt
                        ? `Next ${new Date(c.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                        : c.lastSentAt
                          ? `Last sent ${relDays(c.lastSentAt)}`
                          : "Not sent"}
                      {c.runCount > 1 && ` · ${c.runCount} runs`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.sent ? (
                      <>
                        <div>
                          <b>{r.sent}</b> sent · {r.delivered == null ? "—" : pct(r.delivered)}{" "}
                          delivered
                        </div>
                        <div className="text-muted-foreground">
                          {c.channel === "sms"
                            ? `${r.replied == null ? "—" : pct(r.replied)} replied`
                            : `${pct(r.opened ?? 0)} opened · ${pct(r.clicked ?? 0)} clicked`}
                          {m && m.bounced > 0 && ` · ${m.bounced} bounced`}
                          {m && m.unsubscribed > 0 && ` · ${m.unsubscribed} unsub`}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{staffName(c.ownerId)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        * Opens are estimates (some mail apps block or pre-load images). Delivered, bounced and
        unsubscribed come from the email service; texts need SMS consent.
      </p>

      {showSettings && (
        <CampaignSettings
          data={data}
          status={status}
          reload={reload}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showTemplates && (
        <Templates data={data} reload={reload} onClose={() => setShowTemplates(false)} />
      )}
      {editing && (
        <CampaignEditor
          campaign={editing === "new" ? null : editing}
          preset={editing === "new" ? preset : null}
          smsReady={!!status?.smsConfigured}
          data={data}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CampaignSettings({
  data,
  status,
  reload,
  onClose,
}: {
  data: MarketingData;
  status: { smsConfigured: boolean; resend: { ok: boolean; note?: string } } | null;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [postal, setPostal] = useState(data.settings.postalAddress ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} wide>
      <div className="grid gap-4 p-6">
        <h2 className="font-serif text-xl font-semibold">Campaign settings</h2>
        <Field label="Company postal address (shown in every marketing email — required by CAN-SPAM)">
          <input
            className={inputCls}
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            placeholder="Street, City, TX ZIP"
          />
        </Field>
        <ul className="grid gap-1.5 text-sm">
          <li>
            <b>Email:</b> sending through Resend · delivery, bounce and spam-complaint tracking{" "}
            {status?.resend.ok ? (
              <span className="text-emerald-700">on</span>
            ) : (
              <span className="text-amber-800">
                not confirmed{status?.resend.note ? ` — ${status.resend.note}` : ""}
              </span>
            )}{" "}
            · opens and clicks tracked on marketing email only.
          </li>
          <li>
            <b>Text messages:</b>{" "}
            {status?.smsConfigured ? (
              <span className="text-emerald-700">connected (Telnyx)</span>
            ) : (
              <span className="text-amber-800">
                not connected — add TELNYX_API_KEY, TELNYX_FROM and TELNYX_PUBLIC_KEY to switch
                texts on.
              </span>
            )}{" "}
            Only leads with recorded SMS consent can be texted; STOP/START replies are handled
            automatically.
          </li>
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline text-sm">
            Close
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await saveSettings({ postalAddress: postal });
                await reload();
                toast.success("Saved.");
                onClose();
              } catch (err) {
                toast.error(getErrorMessage(err, "Couldn't save."));
              } finally {
                setBusy(false);
              }
            }}
            className="btn-primary btn-primary-hover text-sm"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CampaignEditor({
  campaign,
  preset,
  smsReady,
  data,
  reload,
  onClose,
}: {
  campaign: Campaign | null;
  preset: { name: string; audience: Audience; idea?: CampaignIdea } | null;
  smsReady: boolean;
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(campaign?.name ?? preset?.name ?? "");
  const [channel, setChannel] = useState<"email" | "sms">(
    campaign?.channel ?? preset?.idea?.channel ?? "email",
  );
  const [frequency, setFrequency] = useState<CampaignFrequency>(
    campaign?.frequency ?? preset?.idea?.frequency ?? "once",
  );
  const [customDays, setCustomDays] = useState<string>(
    campaign?.customDays ? String(campaign.customDays) : "14",
  );
  const [endsAt, setEndsAt] = useState(campaign?.endsAt ? campaign.endsAt.slice(0, 10) : "");
  const [rules, setRules] = useState<CampaignRule[]>(campaign?.followupRules ?? []);
  const [audience, setAudience] = useState<Audience>(
    campaign?.audience ?? preset?.audience ?? { stages: ["ready", "contacted", "interested"] },
  );
  const [subject, setSubject] = useState(campaign?.subject ?? preset?.idea?.subject ?? "");
  const [body, setBody] = useState(campaign?.body ?? preset?.idea?.body ?? "");
  const [templateId, setTemplateId] = useState<string | null>(campaign?.templateId ?? null);
  const [goal, setGoal] = useState("");
  const [when, setWhen] = useState(
    campaign?.scheduledAt
      ? campaign.scheduledAt.slice(0, 16)
      : preset?.idea?.sendOn
        ? `${preset.idea.sendOn}T10:00`
        : "",
  );
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const status = campaign?.status ?? "draft";
  const locked = status === "sent" || status === "sending";
  const recipients = useMemo(
    () => audienceLeads(audience, data.leads, channel),
    [audience, data.leads, channel],
  );
  const [ownerId, setOwnerId] = useState<string | null>(
    campaign?.ownerId ?? preset?.idea?.ownerId ?? data.me,
  );
  const [budget, setBudget] = useState<string>(
    campaign?.budget != null ? String(campaign.budget) : "",
  );
  // everyone the filters reach, to show who's left out and why
  const reach = useMemo(() => {
    return audienceEligibility(audienceMatch(audience, data.leads), channel);
  }, [audience, data.leads, channel]);
  // the objective that fits most of the audience (status, value change, deadline, history)
  const bestObjective = useMemo<TemplateObjective>(() => {
    const n = new Map<TemplateObjective, number>();
    for (const l of recipients) {
      const o = pickObjective(l, data.activities).objective;
      n.set(o, (n.get(o) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "initial_outreach";
  }, [recipients, data.activities]);
  const counties = useMemo(
    () => [...new Set(data.leads.flatMap((l) => l.counties))].sort(),
    [data.leads],
  );
  const types = useMemo(
    () => [...new Set(data.leads.flatMap((l) => l.propertyTypes))].sort(),
    [data.leads],
  );
  // A saved segment is re-applied at approval, so the approved list is what's sent.
  const segmentAudience = (id: string): Audience => {
    const seg = data.segments.find((x) => x.id === id);
    if (!seg) return audience;
    const ids = applyFilters(data.leads, seg.filters, {
      activities: data.activities,
      campaigns: data.campaigns,
      me: data.me,
    }).map((l) => l.id);
    return { segmentId: seg.id, segmentName: seg.name, leadIds: ids };
  };

  const toggle = <K extends "stages" | "counties" | "propertyTypes">(k: K, v: string) =>
    setAudience((a) => {
      const cur = (a[k] ?? []) as string[];
      return {
        ...a,
        leadIds: undefined,
        segmentId: undefined,
        segmentName: undefined,
        [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
      };
    });

  async function step(label: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(label);
    try {
      await fn();
      await reload();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't work."));
    } finally {
      setBusy(null);
    }
  }
  const save = async () => {
    if (!name.trim()) throw new Error("Give the campaign a name.");
    return saveCampaign(campaign?.id ?? null, {
      name: name.trim(),
      channel,
      audience,
      subject,
      body,
      templateId,
      ownerId,
      budget: budget ? Number(budget) : null,
      frequency,
      customDays: frequency === "custom" ? Math.max(1, Number(customDays) || 14) : null,
      endsAt: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
      followupRules: rules,
    });
  };

  const audienceText = () => {
    const ups = recipients.filter((l) => (l.maxChangePct ?? 0) >= 5).length;
    const flagged = recipients.filter((l) => l.flaggedCount > 0).length;
    const extra = ` ${ups} have an assessed-value increase of 5%+; ${flagged} have properties flagged by the assessment review. Template objective: ${OBJECTIVE_LABEL[bestObjective]}.`;
    return audienceTextBase() + extra;
  };
  const audienceTextBase = () => {
    const f = funnel(recipients);
    return `Audience: ${recipients.length} leads (${Object.entries({
      new: f.total - f.contacted,
      interested: f.interested,
      registered: f.registered - f.paying,
      paying: f.paying,
    })
      .map(([k, v]) => `${k} ${v}`)
      .join(
        ", ",
      )}). Counties: ${[...new Set(recipients.map((l) => l.county).filter(Boolean))].slice(0, 8).join(", ") || "various"}. Property types: ${[...new Set(recipients.map((l) => l.propertyType).filter(Boolean))].slice(0, 6).join(", ") || "various"}.`;
  };

  return (
    <Modal onClose={onClose} xl>
      <div className="grid gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-2xl font-semibold">
            {campaign ? campaign.name : "New campaign"}
          </h2>
          <CampaignBadge status={status} />
        </div>

        {campaign && (data.campaignMetrics.get(campaign.id)?.sent ?? 0) > 0 && (
          <CampaignResults campaign={campaign} data={data} />
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <Field label="Campaign name">
              <input
                className={inputCls}
                value={name}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Collin County deadline reminder"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner">
                <select
                  className={inputCls}
                  value={ownerId ?? ""}
                  disabled={locked}
                  onChange={(e) => setOwnerId(e.target.value || null)}
                >
                  <option value="">No owner</option>
                  {data.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Budget ($)">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="optional"
                />
              </Field>
            </div>
            <Field label="Channel">
              <select
                className={inputCls}
                value={channel}
                disabled={locked}
                onChange={(e) => setChannel(e.target.value as "email" | "sms")}
              >
                <option value="email">Email</option>
                <option value="sms" disabled={!smsReady}>
                  {smsReady
                    ? "Text message (SMS) — consented leads only"
                    : "Text message — connect Telnyx first (Settings)"}
                </option>
              </select>
            </Field>
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Audience — {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
              </div>
              {reach.excluded.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Left out automatically:{" "}
                  {reach.excluded.map(([why, n]) => `${n} ${why.toLowerCase()}`).join(" · ")}
                </p>
              )}
              {data.segments.length > 0 && (
                <select
                  className={`${inputCls} mt-1.5`}
                  value={audience.segmentId ?? ""}
                  disabled={locked}
                  aria-label="Saved segment"
                  onChange={(e) =>
                    setAudience(
                      e.target.value
                        ? segmentAudience(e.target.value)
                        : { stages: ["ready", "contacted", "interested"] },
                    )
                  }
                >
                  <option value="">Choose by status, county and type below</option>
                  {data.segments.map((sg) => (
                    <option key={sg.id} value={sg.id}>
                      Saved segment: {sg.name}
                    </option>
                  ))}
                </select>
              )}
              {audience.leadIds?.length ? (
                <p className="mt-2 rounded-md bg-secondary/60 px-3 py-2 text-xs">
                  {audience.segmentName
                    ? `Segment "${audience.segmentName}" — ${audience.leadIds.length} leads`
                    : `${audience.leadIds.length} selected leads`}
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => setAudience({ stages: ["ready", "contacted", "interested"] })}
                      className="ml-2 text-accent hover:underline"
                    >
                      Use filters instead
                    </button>
                  )}
                </p>
              ) : null}
              <div
                className={`mt-1.5 flex flex-wrap gap-1.5 ${audience.leadIds?.length ? "hidden" : ""}`}
              >
                {STAGES.filter((s) => s !== "do_not_contact").map((s) => (
                  <Chip
                    key={s}
                    on={!!audience.stages?.includes(s as Stage)}
                    disabled={locked}
                    onClick={() => toggle("stages", s)}
                  >
                    {STAGE_LABEL[s]}
                  </Chip>
                ))}
              </div>
              {counties.length > 0 && !audience.leadIds?.length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {counties.map((c) => (
                    <Chip
                      key={c}
                      on={!!audience.counties?.includes(c)}
                      disabled={locked}
                      onClick={() => toggle("counties", c)}
                    >
                      {c}
                    </Chip>
                  ))}
                </div>
              )}
              {types.length > 0 && !audience.leadIds?.length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {types.map((t) => (
                    <Chip
                      key={t}
                      on={!!audience.propertyTypes?.includes(t)}
                      disabled={locked}
                      onClick={() => toggle("propertyTypes", t)}
                    >
                      {t}
                    </Chip>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                * No status selected = everyone except Not Interested. Do Not Contact, unsubscribed
                and no-email leads are always left out.
              </p>
            </div>
          </div>

          <div className="grid content-start gap-3">
            {!locked && (
              <Field
                label={`Start from a template — best fit for this audience: ${OBJECTIVE_LABEL[bestObjective]}`}
              >
                <select
                  className={inputCls}
                  value={templateId ?? ""}
                  onChange={(e) => {
                    const t = data.templates.find((x) => x.id === e.target.value);
                    setTemplateId(t?.id ?? null);
                    if (t) {
                      setSubject(t.subject ?? "");
                      setBody(t.body);
                    }
                  }}
                >
                  <option value="">— write your own —</option>
                  {TEMPLATE_OBJECTIVES.map((o) => {
                    const items = data.templates.filter(
                      (t) => t.active && t.channel === "email" && t.objective === o,
                    );
                    return items.length ? (
                      <optgroup
                        key={o}
                        label={`${OBJECTIVE_LABEL[o]}${o === bestObjective ? " (recommended)" : ""}`}
                      >
                        {items.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </Field>
            )}
            {channel === "email" && (
              <Field label="Subject">
                <input
                  className={inputCls}
                  value={subject}
                  disabled={locked}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </Field>
            )}
            <Field
              label={
                channel === "sms"
                  ? `Text (${body.length} characters · "Reply STOP to opt out." is added)`
                  : "Message"
              }
            >
              <textarea
                className={inputCls}
                rows={channel === "sms" ? 4 : 10}
                value={body}
                disabled={locked}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <div className="grid gap-2 rounded-lg border border-border p-3">
              <div className="text-xs font-semibold">Schedule</div>
              <div className="flex flex-wrap items-end gap-2 text-sm">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Repeat
                  <select
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={frequency}
                    disabled={locked}
                    onChange={(e) => setFrequency(e.target.value as CampaignFrequency)}
                  >
                    {(Object.keys(FREQUENCY_LABEL) as CampaignFrequency[]).map((f) => (
                      <option key={f} value={f}>
                        {FREQUENCY_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </label>
                {frequency === "custom" && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Every
                    <input
                      className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      inputMode="numeric"
                      value={customDays}
                      disabled={locked}
                      onChange={(e) => setCustomDays(e.target.value.replace(/\D/g, ""))}
                      aria-label="Days between sends"
                    />
                  </label>
                )}
                {frequency !== "once" && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Stop after
                    <input
                      type="date"
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      value={endsAt}
                      disabled={locked}
                      onChange={(e) => setEndsAt(e.target.value)}
                      aria-label="Stop repeating after"
                    />
                  </label>
                )}
              </div>
              {frequency !== "once" && (
                <p className="text-[11px] text-muted-foreground">
                  * Each run goes to whoever matches the audience then; nobody gets it twice in one
                  cycle.
                </p>
              )}
            </div>
            <div className="grid gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  After it goes out (runs by itself once approved)
                </span>
                {!locked && (
                  <span className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      disabled={!!busy}
                      onClick={() =>
                        void step(
                          "rules",
                          async () => {
                            const r = await runAi({
                              scope: "campaign-rules",
                              campaignId: campaign?.id ?? null,
                              instruction: `Suggest 2-3 engagement follow-up rules for this ${channel} campaign. Reply with JSON only: [{"trigger": "${channel === "sms" ? "no_reply|clicked" : "no_open|opened_no_click|clicked"}", "afterDays": number, "action": "email|call|task${smsReady ? "|sms" : ""}", "subject": "...", "body": "short plain text with {{first_name}}"}]. A call for people who clicked; a different subject for non-openers. Never promise savings.`,
                              context: `${audienceText()}\nSubject: ${subject}\nMessage: ${body}`,
                            });
                            const parsed = cleanRules(
                              JSON.parse((r.result ?? "").match(/\[[\s\S]*\]/)?.[0] ?? "[]"),
                            );
                            if (!parsed.length)
                              throw new Error("Corvus AI didn't return usable rules.");
                            setRules(parsed);
                          },
                          "Rules drafted — review them.",
                        )
                      }
                    >
                      {busy === "rules" ? "Thinking…" : "Suggest with AI"}
                    </button>
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() =>
                        setRules((x) => [
                          ...x,
                          {
                            trigger: channel === "sms" ? "no_reply" : "no_open",
                            afterDays: 3,
                            action: "email",
                          },
                        ])
                      }
                    >
                      + Add rule
                    </button>
                  </span>
                )}
              </div>
              {rules.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  None — e.g. call everyone who clicks, or resend to people who didn&apos;t open.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {rules.map((r, i) => (
                    <li key={i} className="grid gap-1.5 rounded-md bg-secondary/40 p-2 text-xs">
                      <span className="flex flex-wrap items-center gap-1.5">
                        If they
                        <select
                          className="rounded border border-input bg-background px-1 py-0.5"
                          value={r.trigger}
                          disabled={locked}
                          onChange={(e) =>
                            setRules((x) =>
                              x.map((y, k) =>
                                k === i
                                  ? { ...y, trigger: e.target.value as CampaignRule["trigger"] }
                                  : y,
                              ),
                            )
                          }
                          aria-label="Trigger"
                        >
                          {(Object.keys(RULE_TRIGGER_LABEL) as CampaignRule["trigger"][]).map(
                            (t) => (
                              <option key={t} value={t}>
                                {RULE_TRIGGER_LABEL[t]}
                              </option>
                            ),
                          )}
                        </select>
                        after
                        <input
                          className="w-12 rounded border border-input bg-background px-1 py-0.5"
                          inputMode="numeric"
                          value={r.afterDays}
                          disabled={locked}
                          onChange={(e) =>
                            setRules((x) =>
                              x.map((y, k) =>
                                k === i
                                  ? {
                                      ...y,
                                      afterDays: Number(e.target.value.replace(/\D/g, "")) || 1,
                                    }
                                  : y,
                              ),
                            )
                          }
                          aria-label="Days"
                        />
                        days →
                        <select
                          className="rounded border border-input bg-background px-1 py-0.5"
                          value={r.action}
                          disabled={locked}
                          onChange={(e) =>
                            setRules((x) =>
                              x.map((y, k) =>
                                k === i
                                  ? { ...y, action: e.target.value as CampaignRule["action"] }
                                  : y,
                              ),
                            )
                          }
                          aria-label="Action"
                        >
                          <option value="email">send an email</option>
                          <option value="sms" disabled={!smsReady}>
                            send a text
                          </option>
                          <option value="call">call (task for the owner)</option>
                          <option value="task">create a task</option>
                        </select>
                        {!locked && (
                          <button
                            type="button"
                            className="ml-auto text-muted-foreground hover:text-destructive"
                            onClick={() => setRules((x) => x.filter((_, k) => k !== i))}
                          >
                            Remove
                          </button>
                        )}
                      </span>
                      {(r.action === "email" || r.action === "sms" || r.action === "call") && (
                        <>
                          {r.action === "email" && (
                            <input
                              className="rounded border border-input bg-background px-1.5 py-1"
                              placeholder="Subject"
                              value={r.subject ?? ""}
                              disabled={locked}
                              onChange={(e) =>
                                setRules((x) =>
                                  x.map((y, k) =>
                                    k === i ? { ...y, subject: e.target.value } : y,
                                  ),
                                )
                              }
                              aria-label="Rule subject"
                            />
                          )}
                          <textarea
                            className="rounded border border-input bg-background px-1.5 py-1"
                            rows={2}
                            placeholder={r.action === "call" ? "Call notes / script" : "Message"}
                            value={r.body ?? ""}
                            disabled={locked}
                            onChange={(e) =>
                              setRules((x) =>
                                x.map((y, k) => (k === i ? { ...y, body: e.target.value } : y)),
                              )
                            }
                            aria-label="Rule message"
                          />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground">
                * Opt-outs, consent and Do Not Contact are checked again before anything goes out.
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              * Personalised per recipient: {TEMPLATE_TOKENS.join(" ")}. Never promise a reduction
              or savings amount.
            </p>
            {!locked && (
              <div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
                <Field label="Corvus AI — what should this campaign achieve?">
                  <input
                    className={inputCls}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="e.g. get registered users with a deadline this month to subscribe"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      void step(
                        "draft",
                        async () => {
                          const r = await runAi({
                            scope: "campaign",
                            campaignId: campaign?.id ?? null,
                            instruction:
                              `Write a marketing email for this audience. Goal: ${goal || "move prospects to sign up and subscribe"}. ` +
                              "Reply exactly as 'Subject: <subject>' on the first line, then a blank line, then a short plain-text body (under 140 words) with one clear call to action. " +
                              "Use {{first_name}} for the greeting and {{county}} / {{property_address}} where natural. No made-up statistics or guarantees.",
                            context: audienceText(),
                          });
                          const d = splitDraft(r.result ?? "");
                          if (d.subject) setSubject(d.subject);
                          if (d.body) setBody(d.body);
                        },
                        "Draft written — review it before saving.",
                      )
                    }
                    className="btn-outline text-xs disabled:opacity-60"
                  >
                    {busy === "draft" ? "Writing…" : "Draft the email"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      void step("advise", async () => {
                        const r = await runAi({
                          scope: "campaign",
                          campaignId: campaign?.id ?? null,
                          instruction:
                            `Advise on this campaign before it goes out. Goal: ${goal || "conversions"}. Recommend: the best audience (which stages/counties to include or exclude and why), ` +
                            "the best day/time to send in Texas, and 2-3 specific improvements to the subject and message. Keep it under 150 words.",
                          context: `${audienceText()}\nSubject: ${subject || "(none)"}\nMessage:\n${body || "(none)"}`,
                        });
                        setAiNote(r.result);
                      })
                    }
                    className="btn-outline text-xs disabled:opacity-60"
                  >
                    {busy === "advise" ? "Thinking…" : "Suggest audience & timing"}
                  </button>
                </div>
              </div>
            )}
            {status === "sent" && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void step("review", async () => {
                    const r = await runAi({
                      scope: "campaign",
                      campaignId: campaign!.id,
                      instruction:
                        "Review this sent campaign's results and suggest what to change next time (audience, subject, message, timing). 3-4 bullet points.",
                      context: `${audienceText()}\nStats: ${JSON.stringify(campaign!.stats)}\nSubject: ${subject}\nMessage:\n${body}`,
                    });
                    setAiNote(r.result);
                  })
                }
                className="btn-outline justify-self-start text-xs disabled:opacity-60"
              >
                {busy === "review" ? "Reviewing…" : "Corvus AI: how could this perform better?"}
              </button>
            )}
            {aiNote && (
              <MarkdownLite text={aiNote} className="rounded-lg bg-secondary/50 p-3 text-sm" />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {campaign && (status === "draft" || status === "paused") && (
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => {
                if (!(await confirmDialog(`Delete "${campaign.name}"?`))) return;
                void step(
                  "delete",
                  async () => {
                    await deleteCampaign(campaign.id);
                    onClose();
                  },
                  "Campaign deleted.",
                );
              }}
              className="btn-outline mr-auto text-sm text-destructive"
            >
              Delete
            </button>
          )}
          {!locked && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void step(
                  "save",
                  async () => {
                    await save();
                    if (!campaign) onClose();
                  },
                  "Saved.",
                )
              }
              className="btn-outline text-sm"
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
          )}
          {(status === "draft" || status === "paused") && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void step(
                  "approve",
                  async () => {
                    if ((channel === "email" && !subject.trim()) || !body.trim())
                      throw new Error("Add a subject and message before approving.");
                    if (channel === "email" && !data.settings.postalAddress)
                      throw new Error(
                        "Add the company's postal address in Campaigns → Settings first (CAN-SPAM).",
                      );
                    if (recipients.length === 0)
                      throw new Error("This audience has no one to send to.");
                    if (audience.segmentId) {
                      // freeze the segment's current members as the approved list
                      const frozen = segmentAudience(audience.segmentId);
                      setAudience(frozen);
                      const c = await saveCampaign(campaign?.id ?? null, {
                        name: name.trim() || "Untitled campaign",
                        channel,
                        audience: frozen,
                        subject,
                        body,
                        templateId,
                        frequency,
                        followupRules: rules,
                      });
                      await setCampaignStatus(c, "approved");
                    } else {
                      const c = await save();
                      await setCampaignStatus(c, "approved");
                    }
                    const used = data.templates.find((t) => t.id === templateId);
                    if (used) await markTemplateUsed(used);
                    onClose();
                  },
                  "Approved — send it now or schedule it.",
                )
              }
              className="btn-primary btn-primary-hover text-sm"
            >
              {status === "paused" ? "Resume" : "Approve"}
            </button>
          )}
          {(status === "approved" || status === "scheduled") && campaign && (
            <>
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                aria-label="Send at"
              />
              <button
                type="button"
                disabled={!!busy || !when}
                onClick={() =>
                  void step(
                    "schedule",
                    async () => {
                      const at = new Date(when);
                      if (!(at.getTime() > Date.now()))
                        throw new Error("Pick a time in the future.");
                      await saveCampaign(campaign.id, {
                        scheduledAt: at.toISOString(),
                        status: "scheduled",
                      });
                      onClose();
                    },
                    `Scheduled for ${new Date(when).toLocaleString()}.`,
                  )
                }
                className="btn-outline text-sm disabled:opacity-60"
              >
                Schedule
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void step(
                    "pause",
                    async () => {
                      await setCampaignStatus(campaign, "paused");
                      onClose();
                    },
                    "Paused.",
                  )
                }
                className="btn-outline text-sm"
              >
                Pause
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={async () => {
                  if (
                    !(await confirmDialog(
                      `Send "${campaign.name}" to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"} now?`,
                    ))
                  )
                    return;
                  void step("send", async () => {
                    const r = await sendCampaign(campaign.id);
                    toast.success(
                      `Sent to ${r.sent} of ${r.targeted}${r.failed ? ` — ${r.failed} failed` : ""}.`,
                    );
                    onClose();
                  });
                }}
                className="btn-primary btn-primary-hover text-sm"
              >
                {busy === "send" ? "Sending…" : "Send now"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${on ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

/** Delivery and engagement for a campaign, run by run and recipient by recipient. */
function CampaignResults({ campaign, data }: { campaign: Campaign; data: MarketingData }) {
  const m = data.campaignMetrics.get(campaign.id);
  const r = campaignRates(m);
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  useEffect(() => {
    loadMessages({ campaignId: campaign.id })
      .then(setMsgs)
      .catch(() => setMsgs([]));
  }, [campaign.id]);
  const leadName = (id: string | null) => {
    const l = data.leads.find((x) => x.id === id);
    return l ? (l.company ?? l.fullName ?? l.email ?? "Lead") : "Deleted lead";
  };
  const tile = (label: string, v: string | number, hint?: string) => (
    <div className="rounded-md bg-secondary/40 p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{v}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
  const runs =
    (
      campaign.stats as {
        runs?: { run: number; at: string; targeted: number; sent: number; failed: number }[];
      }
    ).runs ?? [];
  return (
    <section className="grid gap-3 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Results</h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        {tile("Sent", m?.sent ?? 0)}
        {tile("Delivered", r.delivered == null ? "—" : pct(r.delivered), `${m?.delivered ?? 0}`)}
        {campaign.channel === "email"
          ? tile("Opened", pct(r.opened ?? 0), `${m?.opened ?? 0}`)
          : tile("Replied", pct(r.replied ?? 0), `${m?.replied ?? 0}`)}
        {tile("Clicked", pct(r.clicked ?? 0), `${m?.clicked ?? 0}`)}
        {tile("Bounced", m?.bounced ?? 0)}
        {tile("Unsubscribed", m?.unsubscribed ?? 0)}
        {tile("Spam reports", m?.complained ?? 0)}
      </div>
      {runs.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Runs:{" "}
          {runs
            .slice(-6)
            .map((x) => `#${x.run} ${x.at.slice(0, 10)} (${x.sent})`)
            .join(" · ")}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-accent">
          Recipients ({msgs?.length ?? "…"})
        </summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Recipient</th>
                <th className="py-1 font-medium">Sent</th>
                <th className="py-1 font-medium">Status</th>
                <th className="py-1 font-medium">Opens</th>
                <th className="py-1 font-medium">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {(msgs ?? [])
                .filter((x) => x.direction === "out")
                .map((x) => (
                  <tr key={x.id} className="border-t border-border/60">
                    <td className="py-1">{leadName(x.leadId)}</td>
                    <td className="py-1">{relDays(x.sentAt)}</td>
                    <td
                      className={`py-1 ${["bounced", "complained", "failed"].includes(x.status) ? "font-semibold text-rose-700" : ""}`}
                    >
                      {x.status.replace("_", " ")}
                      {x.bounceType ? ` (${x.bounceType})` : ""}
                    </td>
                    <td className="py-1 tabular-nums">{x.openCount}</td>
                    <td className="py-1 tabular-nums">{x.clickCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="text-[11px] text-muted-foreground">
        * Opens are estimates — some mail apps block images, others open them automatically.
      </p>
    </section>
  );
}
