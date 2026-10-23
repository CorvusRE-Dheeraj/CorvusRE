import { useMemo, useState } from "react";
import { Copy, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { confirmDialog } from "@/components/ConfirmHost";
import { getErrorMessage } from "@/lib/error-message";
import {
  BRAND_POINTS,
  OBJECTIVE_LABEL,
  TEMPLATE_OBJECTIVES,
  deleteTemplate,
  relDays,
  runAi,
  saveTemplate,
  splitDraft,
  type MarketingData,
  type Template,
  type TemplateInput,
  type TemplateObjective,
} from "@/lib/marketing";
import { TEMPLATE_TOKENS, leadName, personalize } from "@/lib/marketing-crm";
import { Field, inputCls } from "./shared";

// Reusable message templates, one library for campaigns and one-to-one
// outreach. Corvus AI picks and personalises them per prospect; staff can
// write, edit, AI-draft, duplicate and switch them off here.
export function Templates({
  data,
  reload,
  onClose,
}: {
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const byObjective = useMemo(
    () =>
      TEMPLATE_OBJECTIVES.map((o) => ({
        o,
        items: data.templates.filter((t) => t.objective === o),
      })),
    [data.templates],
  );
  if (editing)
    return (
      <TemplateEditor
        template={editing === "new" ? null : editing}
        data={data}
        onDone={async () => {
          await reload();
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  return (
    <Modal onClose={onClose} xl>
      <div className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-serif text-2xl font-semibold">Message templates</h2>
            <p className="text-sm text-muted-foreground">
              Corvus AI picks the right one for each prospect (their status, assessment change,
              deadline and past messages) and personalises it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="btn-primary btn-primary-hover inline-flex items-center gap-1.5 text-sm"
          >
            <Plus className="h-4 w-4" aria-hidden /> New template
          </button>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {byObjective.map(({ o, items }) => (
            <section key={o} className="rounded-lg border border-border p-3">
              <h3 className="text-sm font-semibold">{OBJECTIVE_LABEL[o]}</h3>
              <ul className="mt-2 grid gap-1">
                {items.map((t) => (
                  <li
                    key={t.id}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary/40 ${t.active ? "" : "opacity-50"}`}
                  >
                    <button
                      type="button"
                      onClick={() => setEditing(t)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-medium">
                        {t.name}
                        <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          {t.channel}
                        </span>
                        {t.aiGenerated && (
                          <Sparkles
                            className="ml-1 inline h-3 w-3 text-accent"
                            aria-label="Written by Corvus AI"
                          />
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.subject ?? t.body.slice(0, 70)} · used {t.uses}×{" "}
                        {t.lastUsedAt ? `· last ${relDays(t.lastUsedAt)}` : ""}
                        {!t.active && " · off"}
                      </span>
                    </button>
                  </li>
                ))}
                {items.length === 0 && <li className="text-xs text-muted-foreground">None yet.</li>}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function TemplateEditor({
  template,
  data,
  onDone,
  onCancel,
}: {
  template: Template | null;
  data: MarketingData;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [t, setT] = useState<TemplateInput>({
    name: template?.name ?? "",
    objective: template?.objective ?? "initial_outreach",
    channel: template?.channel ?? "email",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
    active: template?.active ?? true,
    aiGenerated: template?.aiGenerated ?? false,
  });
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const sample =
    data.leads.find((l) => l.portfolioCount > 0 && l.stage !== "do_not_contact") ?? data.leads[0];
  const sms = t.channel === "sms";

  async function ai(mode: "write" | "improve") {
    setBusy(mode);
    try {
      const r = await runAi({
        scope: "template",
        instruction:
          `${mode === "write" ? "Write a reusable" : "Improve this"} CorvusPT ${sms ? "SMS (under 300 characters, end with 'Reply STOP to opt out.')" : "marketing email (under 130 words, one clear call to action)"} template for: ${OBJECTIVE_LABEL[t.objective as TemplateObjective]}. ` +
          `${goal ? `Notes: ${goal}. ` : ""}Use these placeholders where natural: ${TEMPLATE_TOKENS.join(" ")}. Work in: ${BRAND_POINTS.join("; ")}. ` +
          (sms
            ? "Reply with the message text only."
            : "Reply exactly as 'Subject: <subject>' on the first line, a blank line, then the body."),
        context:
          mode === "improve"
            ? `Current template:\nSubject: ${t.subject ?? ""}\n\n${t.body ?? ""}`
            : "New template.",
      });
      const out = r.result ?? "";
      if (sms)
        setT((x) => ({
          ...x,
          body: out.replace(/^\s*(sms|message)\s*:\s*/i, "").trim(),
          aiGenerated: true,
        }));
      else {
        const d = splitDraft(out);
        setT((x) => ({
          ...x,
          subject: d.subject || x.subject,
          body: d.body || x.body,
          aiGenerated: true,
        }));
      }
      if (!t.name)
        setT((x) => ({
          ...x,
          name: `${OBJECTIVE_LABEL[x.objective as TemplateObjective]} (AI${sms ? ", text" : ""})`,
        }));
      toast.success("Draft ready — review it before saving.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't write that."));
    } finally {
      setBusy(null);
    }
  }

  const save = async (copy = false) => {
    if (!t.name?.trim() || !t.body?.trim()) return toast.error("Add a name and a message.");
    if (!sms && !t.subject?.trim()) return toast.error("Add a subject.");
    setBusy("save");
    try {
      await saveTemplate(
        copy ? null : (template?.id ?? null),
        copy ? { ...t, name: `${t.name} (copy)` } : t,
      );
      toast.success(copy ? "Copy saved." : "Template saved.");
      await onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save the template."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal onClose={onCancel} xl>
      <div className="grid gap-4 p-5 sm:p-6">
        <h2 className="font-serif text-2xl font-semibold">
          {template ? "Edit template" : "New template"}
        </h2>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            <Field label="Name">
              <input
                className={inputCls}
                value={t.name ?? ""}
                onChange={(e) => setT({ ...t, name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Objective">
                <select
                  className={inputCls}
                  value={t.objective}
                  onChange={(e) => setT({ ...t, objective: e.target.value as TemplateObjective })}
                >
                  {TEMPLATE_OBJECTIVES.map((o) => (
                    <option key={o} value={o}>
                      {OBJECTIVE_LABEL[o]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Channel">
                <select
                  className={inputCls}
                  value={t.channel}
                  onChange={(e) => setT({ ...t, channel: e.target.value as "email" | "sms" })}
                >
                  <option value="email">Email</option>
                  <option value="sms">Text (SMS)</option>
                </select>
              </Field>
            </div>
            {!sms && (
              <Field label="Subject">
                <input
                  className={inputCls}
                  value={t.subject ?? ""}
                  onChange={(e) => setT({ ...t, subject: e.target.value })}
                />
              </Field>
            )}
            <Field label={sms ? `Message (${(t.body ?? "").length} characters)` : "Message"}>
              <textarea
                className={inputCls}
                rows={sms ? 4 : 11}
                value={t.body ?? ""}
                onChange={(e) => setT({ ...t, body: e.target.value })}
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              * Placeholders: {TEMPLATE_TOKENS.join(" ")}. Never promise a reduction or a savings
              amount.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!t.active}
                onChange={(e) => setT({ ...t, active: e.target.checked })}
              />
              Active — Corvus AI may pick it
            </label>
          </div>
          <div className="grid content-start gap-3">
            <div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
              <Field label="Corvus AI — anything to emphasise?">
                <input
                  className={inputCls}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. industrial owners in Harris County"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void ai("write")}
                  className="btn-outline inline-flex items-center gap-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />{" "}
                  {busy === "write" ? "Writing…" : "Write it"}
                </button>
                <button
                  type="button"
                  disabled={!!busy || !t.body}
                  onClick={() => void ai("improve")}
                  className="btn-outline text-xs"
                >
                  {busy === "improve" ? "Improving…" : "Improve it"}
                </button>
              </div>
            </div>
            {sample && (
              <div className="rounded-lg bg-secondary/50 p-3 text-sm">
                <div className="text-xs font-semibold text-muted-foreground">
                  Preview for {leadName(sample)}
                </div>
                {!sms && (
                  <div className="mt-1 font-medium">{personalize(t.subject ?? "", sample)}</div>
                )}
                <p className="mt-1 whitespace-pre-wrap">{personalize(t.body ?? "", sample)}</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {template && !template.isDefault && (
            <button
              type="button"
              className="btn-outline mr-auto text-sm text-destructive"
              onClick={async () => {
                if (!(await confirmDialog(`Delete "${template.name}"?`))) return;
                await deleteTemplate(template.id).catch((e) =>
                  toast.error(getErrorMessage(e, "Couldn't delete.")),
                );
                await onDone();
              }}
            >
              Delete
            </button>
          )}
          <button type="button" onClick={onCancel} className="btn-outline text-sm">
            Cancel
          </button>
          {template && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void save(true)}
              className="btn-outline inline-flex items-center gap-1.5 text-sm"
            >
              <Copy className="h-4 w-4" aria-hidden /> Save as copy
            </button>
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void save()}
            className="btn-primary btn-primary-hover text-sm"
          >
            {busy === "save" ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
