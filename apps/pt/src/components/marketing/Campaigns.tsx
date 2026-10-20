import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { confirmDialog } from "@/components/ConfirmHost";
import { MarkdownLite } from "@/components/MarkdownLite";
import { getErrorMessage } from "@/lib/error-message";
import {
  STAGES,
  STAGE_LABEL,
  audienceLeads,
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
} from "@/lib/marketing";
import { TEMPLATE_TOKENS, applyFilters, pickObjective } from "@/lib/marketing-crm";
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
  const [preset, setPreset] = useState<{ name: string; audience: Audience } | null>(null);
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

  const groups: { title: string; items: Campaign[] }[] = [
    {
      title: "Live",
      items: data.campaigns.filter((c) =>
        ["approved", "scheduled", "sending", "paused"].includes(c.status),
      ),
    },
    { title: "Drafts", items: data.campaigns.filter((c) => c.status === "draft") },
    { title: "Sent", items: data.campaigns.filter((c) => c.status === "sent") },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Email campaigns go to leads who haven&apos;t unsubscribed. Every email includes a
          one-click unsubscribe link.
        </p>
        <button
          type="button"
          onClick={() => setShowTemplates(true)}
          className="btn-outline ml-auto text-sm"
        >
          Templates ({data.templates.filter((t) => t.active).length})
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
      {groups.map((g) => (
        <section key={g.title} className="card-elev p-4">
          <h2 className="text-sm font-semibold">
            {g.title} ({g.items.length})
          </h2>
          {g.items.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="mt-2 grid gap-1">
              {g.items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-secondary/50 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.channel.toUpperCase()} · {audienceLeads(c.audience, data.leads).length}{" "}
                        recipients
                        {c.status === "scheduled" &&
                          c.scheduledAt &&
                          ` · sends ${new Date(c.scheduledAt).toLocaleString()}`}
                      </span>
                    </span>
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {c.status === "sent"
                        ? `Sent ${c.stats.sent ?? 0}/${c.stats.targeted ?? 0} · ${relDays(c.sentAt)}`
                        : `Updated ${relDays(c.updatedAt)}`}
                    </span>
                    <CampaignBadge status={c.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {showTemplates && (
        <Templates data={data} reload={reload} onClose={() => setShowTemplates(false)} />
      )}
      {editing && (
        <CampaignEditor
          campaign={editing === "new" ? null : editing}
          preset={editing === "new" ? preset : null}
          data={data}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CampaignEditor({
  campaign,
  preset,
  data,
  reload,
  onClose,
}: {
  campaign: Campaign | null;
  preset: { name: string; audience: Audience } | null;
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(campaign?.name ?? preset?.name ?? "");
  const [channel, setChannel] = useState<"email" | "sms">(campaign?.channel ?? "email");
  const [audience, setAudience] = useState<Audience>(
    campaign?.audience ?? preset?.audience ?? { stages: ["ready", "contacted", "interested"] },
  );
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [body, setBody] = useState(campaign?.body ?? "");
  const [templateId, setTemplateId] = useState<string | null>(campaign?.templateId ?? null);
  const [goal, setGoal] = useState("");
  const [when, setWhen] = useState(campaign?.scheduledAt ? campaign.scheduledAt.slice(0, 16) : "");
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const status = campaign?.status ?? "draft";
  const locked = status === "sent" || status === "sending";
  const recipients = useMemo(() => audienceLeads(audience, data.leads), [audience, data.leads]);
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

        {status === "sent" && (
          <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Targeted</div>
              <div className="text-xl font-semibold">{campaign?.stats.targeted ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Delivered to sender</div>
              <div className="text-xl font-semibold">{campaign?.stats.sent ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Failed</div>
              <div className="text-xl font-semibold">{campaign?.stats.failed ?? 0}</div>
            </div>
            {!!campaign?.stats.errors?.length && (
              <p className="text-xs text-rose-700 sm:col-span-3">
                {campaign.stats.errors.join(" · ")}
              </p>
            )}
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Conversions from this audience so far:{" "}
              {recipients.filter((l) => l.stage === "subscribed").length} subscribed of{" "}
              {recipients.length} (
              {pct(
                recipients.length
                  ? recipients.filter((l) => l.stage === "subscribed").length / recipients.length
                  : 0,
              )}
              ).
            </p>
          </div>
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
            <Field label="Channel">
              <select
                className={inputCls}
                value={channel}
                disabled={locked}
                onChange={(e) => setChannel(e.target.value as "email" | "sms")}
              >
                <option value="email">Email</option>
                <option value="sms" disabled>
                  SMS — connect an SMS provider first
                </option>
              </select>
            </Field>
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Audience — {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
              </div>
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
            <Field label="Subject">
              <input
                className={inputCls}
                value={subject}
                disabled={locked}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
            <Field label="Message">
              <textarea
                className={inputCls}
                rows={10}
                value={body}
                disabled={locked}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
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
                    if (!subject.trim() || !body.trim())
                      throw new Error("Add a subject and message before approving.");
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
              {status === "paused" ? "Resume (approve)" : "Approve"}
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
