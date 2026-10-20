import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";
import {
  OBJECTIVE_LABEL,
  TEMPLATE_OBJECTIVES,
  isDnc,
  leadFacts,
  logActivity,
  markTemplateUsed,
  money,
  runAi,
  saveFollowup,
  splitDraft,
  type Lead,
  type MarketingData,
  type TemplateObjective,
} from "@/lib/marketing";
import { personalize, pickTemplate } from "@/lib/marketing-crm";
import { inputCls } from "./shared";

// One-to-one outreach for a lead: the template Corvus AI picks for them,
// personalised from their properties and assessment findings, which staff
// edit, regenerate and approve (approval schedules it as a follow-up).
export function OutreachWriter({
  lead,
  data,
  reload,
}: {
  lead: Lead;
  data: MarketingData;
  reload: () => Promise<void>;
}) {
  const [channel, setChannel] = useState<"email" | "sms">(lead.email ? "email" : "sms");
  const [objective, setObjective] = useState<TemplateObjective | "">("");
  const pick = useMemo(
    () => pickTemplate(lead, data.templates, data.activities, channel, objective || undefined),
    [lead, data.templates, data.activities, channel, objective],
  );
  const [templateId, setTemplateId] = useState<string | null>(null);
  const tpl = data.templates.find((t) => t.id === templateId) ?? pick.template;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ai, setAi] = useState(false);
  const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setTemplateId(null);
  }, [channel, objective]);
  useEffect(() => {
    setSubject(tpl?.subject ? personalize(tpl.subject, lead) : "");
    setBody(tpl ? personalize(tpl.body, lead) : "");
    setAi(false);
  }, [tpl, lead]);

  const blocked = isDnc(lead)
    ? "Do Not Contact"
    : channel === "email" && (!lead.email || lead.unsubscribedAt)
      ? lead.unsubscribedAt
        ? "unsubscribed from email"
        : "no email address"
      : channel === "sms" && !lead.phone
        ? "no phone number"
        : null;
  const props = data.properties
    .filter((p) => p.leadId === lead.id)
    .sort((a, b) => (b.assessedValue ?? 0) - (a.assessedValue ?? 0));

  async function generate() {
    setBusy("ai");
    try {
      const r = await runAi({
        scope: "outreach",
        leadId: lead.id,
        instruction:
          `Personalise this ${channel === "sms" ? "text message (under 300 characters, keep 'Reply STOP to opt out.')" : "email (under 140 words)"} for this prospect. ` +
          `Objective: ${OBJECTIVE_LABEL[pick.objective]}. Use their real properties and assessment findings where they help; keep the template's call to action. ` +
          (channel === "sms"
            ? "Reply with the message text only."
            : "Reply exactly as 'Subject: <subject>' on the first line, a blank line, then the body."),
        context:
          `Template:\n${tpl?.subject ? `Subject: ${tpl.subject}\n\n` : ""}${tpl?.body ?? "(none — write from scratch)"}\n\n` +
          leadFacts(lead, data.activities, data.followups) +
          `\nProperties:\n${
            props
              .slice(0, 6)
              .map(
                (p) =>
                  `- ${p.address} | ${p.county ?? "?"} County | ${money(p.assessedValue)}${p.changePct != null ? ` | ${p.changePct > 0 ? "+" : ""}${p.changePct}% on last year` : ""}${p.analysis?.flags.length ? ` | findings: ${p.analysis.flags.map((f) => f.text).join(" ")}` : ""}`,
              )
              .join("\n") || "- none on file"
          }`,
      });
      const out = r.result ?? "";
      if (channel === "sms") setBody(out.replace(/^\s*(sms|message)\s*:\s*/i, "").trim());
      else {
        const d = splitDraft(out);
        if (d.subject) setSubject(d.subject);
        if (d.body) setBody(d.body);
      }
      setAi(true);
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't write that."));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!body.trim() || (channel === "email" && !subject.trim()))
      return toast.error("Add a subject and message.");
    setBusy("approve");
    try {
      await saveFollowup(null, {
        leadId: lead.id,
        channel,
        dueAt: new Date(`${due}T09:00:00`).toISOString(),
        subject:
          channel === "email" ? subject.trim() : (tpl?.name ?? OBJECTIVE_LABEL[pick.objective]),
        message: body.trim(),
        aiGenerated: ai,
        templateId: tpl?.id ?? null,
      });
      if (tpl) await markTemplateUsed(tpl);
      await logActivity({
        leadId: lead.id,
        kind: "note",
        summary: `${channel === "sms" ? "Text" : "Email"} approved: ${OBJECTIVE_LABEL[pick.objective]}${tpl ? ` (template "${tpl.name}")` : ""}`,
      });
      await reload();
      toast.success(
        channel === "sms"
          ? "Approved — saved as a text follow-up."
          : "Approved — it's in Follow-ups, ready to send.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save it."));
    } finally {
      setBusy(null);
    }
  }

  const options = data.templates.filter(
    (t) => t.active && t.channel === channel && t.objective === pick.objective,
  );
  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Write outreach
      </h3>
      {blocked && isDnc(lead) ? (
        <p className="mt-2 text-sm text-muted-foreground">No outreach — Do Not Contact.</p>
      ) : (
        <div className="mt-2 grid gap-2">
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={channel}
              onChange={(e) => setChannel(e.target.value as "email" | "sms")}
              aria-label="Channel"
            >
              <option value="email">Email</option>
              <option value="sms">Text</option>
            </select>
            <select
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={objective}
              onChange={(e) => setObjective(e.target.value as TemplateObjective | "")}
              aria-label="Objective"
            >
              <option value="">
                Best fit:{" "}
                {
                  OBJECTIVE_LABEL[
                    pickTemplate(lead, data.templates, data.activities, channel).objective
                  ]
                }
              </option>
              {TEMPLATE_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {OBJECTIVE_LABEL[o]}
                </option>
              ))}
            </select>
            {options.length > 1 && (
              <select
                className="max-w-[12rem] rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={tpl?.id ?? ""}
                onChange={(e) => setTemplateId(e.target.value)}
                aria-label="Template"
              >
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {pick.why}
            {tpl
              ? ` · template "${tpl.name}"`
              : " · no active template for this — Corvus AI will write one"}
          </p>
          {channel === "email" && (
            <input
              className={inputCls}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              aria-label="Subject"
            />
          )}
          <textarea
            className={inputCls}
            rows={channel === "sms" ? 3 : 7}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Message"
          />
          {channel === "sms" && (
            <p className="text-[11px] text-muted-foreground">
              {body.length} characters · saved as a text follow-up (sending needs an SMS provider)
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void generate()}
              className="btn-outline inline-flex items-center gap-1.5 text-xs"
            >
              {ai ? (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              {busy === "ai" ? "Writing…" : ai ? "Regenerate" : "Personalise with AI"}
            </button>
            {ai && tpl && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSubject(tpl.subject ? personalize(tpl.subject, lead) : "");
                  setBody(personalize(tpl.body, lead));
                  setAi(false);
                }}
              >
                Back to template
              </button>
            )}
            <input
              type="date"
              className="ml-auto rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Send on"
            />
            <button
              type="button"
              disabled={!!busy || !!blocked}
              title={blocked ?? undefined}
              onClick={() => void approve()}
              className="btn-primary btn-primary-hover text-xs disabled:opacity-60"
            >
              {busy === "approve" ? "Saving…" : "Approve"}
            </button>
          </div>
          {blocked && <p className="text-[11px] text-rose-700">Can&apos;t approve: {blocked}.</p>}
        </div>
      )}
    </section>
  );
}
