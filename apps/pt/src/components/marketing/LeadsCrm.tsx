import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { confirmDialog } from "@/components/ConfirmHost";
import { getErrorMessage } from "@/lib/error-message";
import {
  SOURCE_LABEL,
  STAGES,
  STAGE_LABEL,
  createLead,
  deleteLead,
  leadFacts,
  logActivity,
  money,
  relDays,
  runAi,
  saveFollowup,
  scoreLead,
  setLeadStage,
  updateLead,
  type Lead,
  type LeadInput,
  type MarketingData,
  type Stage,
} from "@/lib/marketing";
import { AiBox, Field, ScoreBadge, StageBadge, inputCls, type Focus, type Go } from "./shared";

// Prospect profiles: who they are, their property, where they are in the
// pipeline, their score, and every touchpoint. One record per person — beta
// signups and registered users are folded in automatically (Sync), so this is
// the only place a lead's details are edited.
export function LeadsCrm({
  data,
  focus,
  go,
  reload,
}: {
  data: MarketingData;
  focus: Focus;
  go: Go;
  reload: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [stages, setStages] = useState<Stage[]>(focus.stages ?? []);
  const [openId, setOpenId] = useState<string | null>(focus.leadId ?? null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (focus.leadId) setOpenId(focus.leadId);
    if (focus.stages) setStages(focus.stages);
  }, [focus]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.leads
      .filter((l) => !stages.length || stages.includes(l.stage))
      .filter(
        (l) =>
          !q ||
          [l.fullName, l.email, l.company, l.propertyAddress, l.county, l.ownerNames]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(q)),
      )
      .map((l) => ({ l, s: scoreLead(l, data.activities) }))
      .sort((a, b) => b.s.score - a.s.score || b.l.createdAt.localeCompare(a.l.createdAt));
  }, [data, query, stages]);

  const open = data.leads.find((l) => l.id === openId) ?? null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">Search leads</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, company, property, county…"
            className={`${inputCls} pl-9`}
          />
        </label>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn-primary btn-primary-hover inline-flex items-center gap-1.5 text-sm"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add lead
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by stage">
        {STAGES.map((s) => {
          const on = stages.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => setStages((prev) => (on ? prev.filter((x) => x !== s) : [...prev, s]))}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {STAGE_LABEL[s]} ({data.leads.filter((l) => l.stage === s).length})
            </button>
          );
        })}
        {stages.length > 0 && (
          <button
            type="button"
            onClick={() => setStages([])}
            className="px-2 text-xs text-accent hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="card-elev overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Lead</th>
              <th className="px-3 py-2 font-medium">Property</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Last contact</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No leads match. Add one, or press Sync to pull in beta signups and new users.
                </td>
              </tr>
            )}
            {rows.map(({ l, s }) => (
              <tr
                key={l.id}
                onClick={() => setOpenId(l.id)}
                className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary/40"
              >
                <td className="px-3 py-2">
                  <ScoreBadge score={s.score} />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{l.fullName || l.email || "Unnamed"}</div>
                  <div className="text-xs text-muted-foreground">
                    {[l.company, SOURCE_LABEL[l.source]].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className="truncate">{l.propertyAddress ?? "—"}</div>
                  <div className="text-muted-foreground">
                    {[
                      l.county && `${l.county} County`,
                      l.appraisedValue != null && money(l.appraisedValue),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StageBadge stage={l.stage} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {relDays(l.lastContactedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <LeadProfile
          lead={open}
          data={data}
          go={go}
          reload={reload}
          onClose={() => setOpenId(null)}
        />
      )}
      {adding && (
        <Modal onClose={() => setAdding(false)} wide>
          <LeadForm
            title="Add a lead"
            onCancel={() => setAdding(false)}
            onSave={async (input) => {
              const l = await createLead(input);
              await logActivity({ leadId: l.id, kind: "note", summary: "Lead added" });
              await reload();
              setAdding(false);
              setOpenId(l.id);
              toast.success("Lead added.");
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function LeadForm({
  lead,
  title,
  onSave,
  onCancel,
}: {
  lead?: Lead;
  title: string;
  onSave: (input: LeadInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<LeadInput>({
    fullName: lead?.fullName ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    company: lead?.company ?? "",
    source: lead?.source ?? "manual",
    propertyAddress: lead?.propertyAddress ?? "",
    county: lead?.county ?? "",
    propertyType: lead?.propertyType ?? "",
    appraisedValue: lead?.appraisedValue ?? null,
    protestDeadline: lead?.protestDeadline ?? "",
    ownerNames: lead?.ownerNames ?? "",
    notes: lead?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof LeadInput) => (e: { target: { value: string } }) =>
    setF((p) => ({
      ...p,
      [k]:
        k === "appraisedValue"
          ? e.target.value
            ? Number(e.target.value.replace(/[^0-9.]/g, ""))
            : null
          : e.target.value,
    }));
  const synced = !!lead?.profileId;
  return (
    <form
      className="grid gap-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.fullName && !f.email) return toast.error("Add at least a name or an email.");
        setBusy(true);
        try {
          await onSave(f);
        } catch (err) {
          toast.error(getErrorMessage(err, "Could not save this lead."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      {synced && (
        <p className="text-xs text-muted-foreground">
          * Linked to a CorvusPT account — property details refresh from it on each Sync.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={inputCls} value={f.fullName ?? ""} onChange={set("fullName")} />
        </Field>
        <Field label="Email">
          <input className={inputCls} type="email" value={f.email ?? ""} onChange={set("email")} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={f.phone ?? ""} onChange={set("phone")} />
        </Field>
        <Field label="Company">
          <input className={inputCls} value={f.company ?? ""} onChange={set("company")} />
        </Field>
        <Field label="Property address">
          <input
            className={inputCls}
            value={f.propertyAddress ?? ""}
            onChange={set("propertyAddress")}
          />
        </Field>
        <Field label="Owner(s) on record">
          <input className={inputCls} value={f.ownerNames ?? ""} onChange={set("ownerNames")} />
        </Field>
        <Field label="County">
          <input
            className={inputCls}
            value={f.county ?? ""}
            onChange={set("county")}
            placeholder="e.g. Collin"
          />
        </Field>
        <Field label="Property type">
          <input
            className={inputCls}
            value={f.propertyType ?? ""}
            onChange={set("propertyType")}
            placeholder="e.g. Commercial"
          />
        </Field>
        <Field label="Appraised value ($)">
          <input
            className={inputCls}
            inputMode="decimal"
            value={f.appraisedValue ?? ""}
            onChange={set("appraisedValue")}
          />
        </Field>
        <Field label="Protest deadline">
          <input
            className={inputCls}
            type="date"
            value={f.protestDeadline ?? ""}
            onChange={set("protestDeadline")}
          />
        </Field>
        {!lead && (
          <Field label="Source">
            <select className={inputCls} value={f.source} onChange={set("source")}>
              {(["manual", "referral", "website", "event", "import"] as const).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label="Notes">
        <textarea className={inputCls} rows={3} value={f.notes ?? ""} onChange={set("notes")} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-outline text-sm">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save lead"}
        </button>
      </div>
    </form>
  );
}

function LeadProfile({
  lead,
  data,
  go,
  reload,
  onClose,
}: {
  lead: Lead;
  data: MarketingData;
  go: Go;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState<"note" | "call">("note");
  const s = scoreLead(lead, data.activities);
  const history = data.activities.filter((a) => a.leadId === lead.id);
  const fups = data.followups.filter((x) => x.leadId === lead.id);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      await reload();
      toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't save."));
    }
  };

  if (editing)
    return (
      <Modal onClose={() => setEditing(false)} wide>
        <LeadForm
          lead={lead}
          title="Edit lead"
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await updateLead(lead.id, input);
            await reload();
            setEditing(false);
            toast.success("Lead saved.");
          }}
        />
      </Modal>
    );

  return (
    <Modal onClose={onClose} xl>
      <div className="grid gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-semibold">
              {lead.fullName || lead.email || "Unnamed lead"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {[lead.company, lead.email, lead.phone].filter(Boolean).join(" · ") ||
                "No contact details"}
              {lead.unsubscribedAt && (
                <span className="ml-2 font-semibold text-rose-700">Unsubscribed</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ScoreBadge score={s.score} />
            <select
              aria-label="Stage"
              value={lead.stage}
              onChange={(e) =>
                void act(() => setLeadStage(lead, e.target.value as Stage), "Stage updated.")
              }
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {STAGES.map((st) => (
                <option key={st} value={st}>
                  {STAGE_LABEL[st]}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setEditing(true)} className="btn-outline text-sm">
              Edit
            </button>
            {!lead.profileId && (
              <button
                type="button"
                aria-label="Delete lead"
                onClick={async () => {
                  if (
                    !(await confirmDialog(
                      `Delete ${lead.fullName || lead.email}? Their history goes too.`,
                    ))
                  )
                    return;
                  void act(async () => {
                    await deleteLead(lead.id);
                    onClose();
                  }, "Lead deleted.");
                }}
                className="btn-outline text-sm text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <section className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Property</h3>
              <dl className="mt-2 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Address</dt>
                <dd>{lead.propertyAddress ?? "—"}</dd>
                <dt className="text-muted-foreground">Owner(s)</dt>
                <dd>{lead.ownerNames ?? "—"}</dd>
                <dt className="text-muted-foreground">County</dt>
                <dd>{lead.county ?? "—"}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd>{lead.propertyType ?? "—"}</dd>
                <dt className="text-muted-foreground">Appraised</dt>
                <dd>{money(lead.appraisedValue)}</dd>
                <dt className="text-muted-foreground">Protest deadline</dt>
                <dd>{lead.protestDeadline ?? "—"}</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd>
                  {SOURCE_LABEL[lead.source]} · added {relDays(lead.createdAt)}
                </dd>
              </dl>
              {lead.notes && (
                <p className="mt-3 whitespace-pre-wrap rounded-md bg-secondary/50 p-2 text-sm">
                  {lead.notes}
                </p>
              )}
            </section>
            <section className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Why this score ({s.score})</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                {s.reasons.length ? (
                  s.reasons.map((r) => <li key={r}>{r}</li>)
                ) : (
                  <li>Not enough information yet — add the property and contact details.</li>
                )}
              </ul>
            </section>
            <AiBox
              title="Corvus AI — research & next action"
              text={lead.aiSummary}
              when={lead.aiSummaryAt ? relDays(lead.aiSummaryAt) : null}
              runLabel="Research this lead"
              run={async () => {
                const r = await runAi({
                  scope: "lead",
                  leadId: lead.id,
                  instruction:
                    "Assess this prospect for CorvusPT. Give: (1) a 2-sentence profile and how promising they are, (2) what information is missing and how to find it from public sources (appraisal district record, county records), " +
                    "(3) the single best next action with timing and channel, and (4) a one-line talking point tied to their property or deadline.",
                  context: leadFacts(lead, data.activities, data.followups),
                });
                await updateLead(lead.id, {
                  aiSummary: r.result ?? "",
                  aiSummaryAt: new Date().toISOString(),
                });
                await logActivity({
                  leadId: lead.id,
                  kind: "ai",
                  summary: "Corvus AI researched this lead",
                });
                await reload();
              }}
            />
          </div>

          <div className="grid content-start gap-4">
            <section className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Follow-ups</h3>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    go("followups", { leadId: lead.id });
                  }}
                  className="text-xs text-accent hover:underline"
                >
                  Plan in Follow-ups →
                </button>
              </div>
              {fups.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="mt-2 grid gap-1 text-sm">
                  {fups.slice(0, 6).map((x) => (
                    <li key={x.id} className="flex justify-between gap-2">
                      <span className="truncate">
                        {x.channel} · {x.subject || x.message?.slice(0, 40) || "—"}
                      </span>
                      <span
                        className={`shrink-0 text-xs ${x.status === "pending" && new Date(x.dueAt) < new Date() ? "font-semibold text-rose-700" : "text-muted-foreground"}`}
                      >
                        {x.status === "pending" ? new Date(x.dueAt).toLocaleDateString() : x.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() =>
                  void act(
                    () =>
                      saveFollowup(null, {
                        leadId: lead.id,
                        dueAt: new Date(Date.now() + 2 * 864e5).toISOString(),
                        channel: lead.phone ? "call" : "email",
                        subject: "Check in",
                      }),
                    "Follow-up added for 2 days from now.",
                  )
                }
                className="btn-outline mt-3 text-xs"
              >
                + Quick follow-up in 2 days
              </button>
            </section>

            <section className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Communication history</h3>
              <form
                className="mt-2 grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  void act(
                    async () => {
                      await logActivity({
                        leadId: lead.id,
                        kind: noteKind,
                        summary: noteKind === "call" ? "Call logged" : "Note",
                        body: note.trim(),
                      });
                      if (noteKind === "call")
                        await updateLead(lead.id, {
                          lastContactedAt: new Date().toISOString(),
                          ...(lead.stage === "new" ? { stage: "contacted" } : {}),
                        });
                      setNote("");
                    },
                    noteKind === "call" ? "Call logged." : "Note added.",
                  );
                }}
              >
                <textarea
                  className={inputCls}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note or log a call…"
                />
                <div className="flex gap-2">
                  <select
                    value={noteKind}
                    onChange={(e) => setNoteKind(e.target.value as "note" | "call")}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                    aria-label="Entry type"
                  >
                    <option value="note">Note</option>
                    <option value="call">Call</option>
                  </select>
                  <button type="submit" className="btn-primary btn-primary-hover text-sm">
                    Save
                  </button>
                </div>
              </form>
              <ul className="mt-3 grid max-h-80 gap-2 overflow-y-auto pr-1 text-sm">
                {history.length === 0 && <li className="text-muted-foreground">No history yet.</li>}
                {history.map((a) => (
                  <li key={a.id} className="border-l-2 border-border pl-3">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{a.summary}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relDays(a.createdAt)}
                      </span>
                    </div>
                    {a.body && (
                      <p className="whitespace-pre-wrap text-muted-foreground">{a.body}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </Modal>
  );
}
