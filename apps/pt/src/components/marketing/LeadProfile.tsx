import { useMemo, useState } from "react";
import { Ban, Check, Mail, MapPin, Phone, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { confirmDialog } from "@/components/ConfirmHost";
import { MarkdownLite } from "@/components/MarkdownLite";
import { getErrorMessage } from "@/lib/error-message";
import {
  OUTCOME_LABEL,
  SOURCE_LABEL,
  STAGES,
  STAGE_LABEL,
  addProperties,
  deleteLead,
  deleteProperty,
  dismissSuggestion,
  isDnc,
  logActivity,
  money,
  relDays,
  runRules,
  saveFollowup,
  scoreLead,
  setLeadStage,
  leadFacts,
  runAi,
  updateLead,
  type Activity,
  type Lead,
  type LeadInput,
  type LeadProperty,
  type MarketingData,
  type Outcome,
  type Stage,
} from "@/lib/marketing";
import {
  journeyLinks,
  journeySteps,
  rankLead,
  shownPriority,
  cleanCounty,
  cleanEmail,
  cleanPhone,
  estSavings,
  leadName,
  opportunity,
  recommend,
  splitAddress,
} from "@/lib/marketing-crm";
import {
  acceptCandidate,
  analyzeProperty,
  dropFlag,
  refreshProperty,
  researchLead,
  researchPropertyOwner,
  verifyField,
  verifyProperty,
} from "@/lib/marketing-research";
import { OutreachWriter } from "./OutreachWriter";
import {
  Field,
  PriorityBadge,
  ScoreBadge,
  SourceChip,
  StageBadge,
  inputCls,
  type Go,
} from "./shared";

const OPP_TONE = {
  strong: "bg-emerald-600 text-white",
  good: "bg-emerald-100 text-emerald-900",
  check: "bg-secondary text-muted-foreground",
} as const;

const KIND_LABEL: Record<Activity["kind"], string> = {
  note: "Note",
  email: "Email",
  sms: "SMS",
  call: "Call",
  meeting: "Meeting",
  journey: "Journey",
  stage: "Status",
  ai: "AI",
  follow_up: "Follow-up",
  campaign: "Campaign",
  import: "Import",
  sync: "Podio",
  research: "Research",
  assign: "Assigned",
};

/** One page for everything about a lead. */
export function LeadProfile({
  lead,
  data,
  go,
  reload,
  onClose,
  onOpenLead,
}: {
  lead: Lead;
  data: MarketingData;
  go: Go;
  reload: () => Promise<void>;
  onClose: () => void;
  onOpenLead: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const s = scoreLead(lead, data.activities);
  const rec = recommend(lead, data, s.score);
  const props = data.properties.filter((p) => p.leadId === lead.id);
  const rank = rankLead(lead, props, data.activities);
  const shown = shownPriority(lead, rank);
  const staffPriority = lead.fieldSources.priority?.source === "Staff";
  const history = data.activities.filter((a) => a.leadId === lead.id);
  const fups = data.followups.filter((x) => x.leadId === lead.id);
  const staffName = (id: string | null) => data.staff.find((x) => x.id === id)?.name ?? null;
  const sharedWith = useMemo(() => {
    const keys = new Set(props.map((p) => p.dedupeKey));
    const out = new Map<string, string>();
    for (const p of data.properties)
      if (p.leadId !== lead.id && keys.has(p.dedupeKey)) {
        const o = data.leads.find((l) => l.id === p.leadId);
        if (o) out.set(o.id, leadName(o));
      }
    return [...out.entries()];
  }, [props, data.properties, data.leads, lead.id]);
  const dnc = isDnc(lead);

  const act = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try {
      await fn();
      await reload();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't save."));
    } finally {
      setBusy(null);
    }
  };

  if (editing)
    return (
      <Modal onClose={() => setEditing(false)} wide>
        <LeadForm
          lead={lead}
          data={data}
          title="Edit lead"
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            const sources = { ...lead.fieldSources };
            for (const k of [
              "email",
              "phone",
              "mailingAddress",
              "ownerNames",
              "fullName",
              "company",
            ] as const)
              if (input[k] !== undefined && input[k] !== lead[k])
                sources[k] = { source: "Staff", verified: true, at: new Date().toISOString() };
            await updateLead(lead.id, { ...input, fieldSources: sources });
            await runRules(lead.id);
            await reload();
            setEditing(false);
            toast.success("Lead saved.");
          }}
        />
      </Modal>
    );

  const contactRow = (label: string, field: keyof Lead, icon?: React.ReactNode) => {
    const v = lead[field] as string | null;
    return (
      <>
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </dt>
        <dd className="min-w-0 break-words">
          {v ?? <span className="text-muted-foreground">—</span>}
          {v && (
            <SourceChip
              src={lead.fieldSources[field]}
              onVerify={() =>
                void act("verify", () => verifyField(lead, field), "Marked verified.")
              }
            />
          )}
        </dd>
      </>
    );
  };

  return (
    <Modal onClose={onClose} xl>
      <div className="grid gap-4 p-5 sm:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-2xl font-semibold">{leadName(lead)}</h2>
              <PriorityBadge priority={shown} />
              <StageBadge stage={lead.stage} />
            </div>
            <p className="text-sm text-muted-foreground">
              {[
                lead.company && lead.fullName,
                SOURCE_LABEL[lead.source],
                `added ${relDays(lead.createdAt)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              {lead.profileId && " · has a CorvusPT account"}
              {lead.podioItemId && " · linked to Podio"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ScoreBadge score={s.score} />
            <select
              aria-label="Status"
              value={lead.stage}
              disabled={!!busy}
              onChange={async (e) => {
                const next = e.target.value as Stage;
                if (
                  next === "do_not_contact" &&
                  !(await confirmDialog(
                    `Mark ${leadName(lead)} Do Not Contact? Pending emails, texts and calls are cancelled and no outreach can be scheduled.`,
                  ))
                )
                  return;
                void act("stage", () => setLeadStage(lead, next), "Status updated.");
              }}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {STAGES.map((st) => (
                <option key={st} value={st}>
                  {STAGE_LABEL[st]}
                </option>
              ))}
            </select>
            <select
              aria-label="Priority"
              value={staffPriority ? (lead.priority ?? "") : ""}
              disabled={!!busy}
              title="Corvus AI ranks every lead; pick a level to override it"
              onChange={(e) => {
                const v = e.target.value as "high" | "medium" | "low" | "";
                const fs = { ...lead.fieldSources };
                if (v)
                  fs.priority = { source: "Staff", verified: true, at: new Date().toISOString() };
                else delete fs.priority;
                void act(
                  "priority",
                  () => updateLead(lead.id, { priority: v || null, fieldSources: fs }),
                  v ? "Priority set." : "Back to the AI ranking.",
                );
              }}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Priority: AI ({rank.level})</option>
              <option value="high">High (set by staff)</option>
              <option value="medium">Medium (set by staff)</option>
              <option value="low">Low (set by staff)</option>
            </select>
            <select
              aria-label="Assigned to"
              value={lead.assignedTo ?? ""}
              disabled={!!busy}
              onChange={(e) =>
                void act(
                  "assign",
                  () => updateLead(lead.id, { assignedTo: e.target.value || null }),
                  "Assignment saved.",
                )
              }
              className="max-w-[11rem] rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Unassigned</option>
              {data.staff.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.id === data.me ? `${st.name} (me)` : st.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void act("research", async () => {
                  const r = await researchLead(lead, data);
                  toast.success(
                    `Research done${r.linked ? ` — linked ${r.linked} propert${r.linked === 1 ? "y" : "ies"}` : ""}${r.candidates ? `, ${r.candidates} to verify` : ""}.`,
                  );
                })
              }
              className="btn-outline inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
            >
              <Search
                className={`h-4 w-4 ${busy === "research" ? "animate-pulse" : ""}`}
                aria-hidden
              />
              {busy === "research"
                ? "Researching…"
                : lead.researchedAt
                  ? "Research again"
                  : "Research"}
            </button>
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
                      `Delete ${leadName(lead)}? Their properties and history go too.`,
                    ))
                  )
                    return;
                  void act(
                    "delete",
                    async () => {
                      await deleteLead(lead.id);
                      onClose();
                    },
                    "Lead deleted.",
                  );
                }}
                className="btn-outline text-sm text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>

        <JourneyStrip lead={lead} data={data} />
        {dnc && (
          <p className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <Ban className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b>Do Not Contact</b> — {lead.dncReason ?? "set by staff"}. No emails, texts or calls
              can be sent or scheduled.
            </span>
          </p>
        )}
        {lead.suggestedStage && !dnc && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              Suggested status: <b>{STAGE_LABEL[lead.suggestedStage]}</b>
              {lead.suggestedStageReason && ` — ${lead.suggestedStageReason}`}
            </span>
            <button
              type="button"
              className="btn-primary btn-primary-hover py-1 text-xs"
              onClick={() =>
                void act(
                  "accept",
                  () => setLeadStage(lead, lead.suggestedStage!),
                  "Status updated.",
                )
              }
            >
              Accept
            </button>
            <button
              type="button"
              className="btn-outline py-1 text-xs"
              onClick={() => void act("dismiss", () => dismissSuggestion(lead))}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Left: who + what they own */}
          <div className="grid content-start gap-4">
            <section className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Contact</h3>
              <dl className="mt-2 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                {lead.company && contactRow("Contact person", "fullName")}
                {contactRow("Email", "email", <Mail className="h-3.5 w-3.5" aria-hidden />)}
                {contactRow("Phone", "phone", <Phone className="h-3.5 w-3.5" aria-hidden />)}
                {contactRow(
                  "Mailing address",
                  "mailingAddress",
                  <MapPin className="h-3.5 w-3.5" aria-hidden />,
                )}
                {contactRow("Owner(s) on record", "ownerNames")}
                <dt className="text-muted-foreground">City / ZIP</dt>
                <dd>{[lead.city, lead.zip].filter(Boolean).join(" ") || "—"}</dd>
                {lead.unsubscribedAt && (
                  <>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="font-semibold text-rose-700">
                      Unsubscribed {relDays(lead.unsubscribedAt)}
                    </dd>
                  </>
                )}
              </dl>
              {lead.notes && (
                <p className="mt-3 whitespace-pre-wrap rounded-md bg-secondary/50 p-2 text-sm">
                  {lead.notes}
                </p>
              )}
            </section>

            <PortfolioCard
              lead={lead}
              data={data}
              busy={busy}
              act={act}
              sharedWith={sharedWith}
              onOpenLead={onOpenLead}
            />

            {lead.researchFlags.length > 0 && (
              <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
                <h3 className="text-sm font-semibold">To verify ({lead.researchFlags.length})</h3>
                <ul className="mt-2 grid gap-2 text-sm">
                  {lead.researchFlags.map((f, i) => (
                    <li key={f.id ?? i} className="flex flex-wrap items-start gap-2">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${f.severity === "warning" ? "bg-amber-500" : "bg-sky-500"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        {f.message}
                        {f.candidate?.assessedValue != null && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {money(f.candidate.assessedValue)}
                          </span>
                        )}
                      </span>
                      {f.candidate ? (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            className="btn-outline py-0.5 text-xs"
                            onClick={() =>
                              void act(
                                "cand",
                                () => acceptCandidate(lead, f),
                                "Added to the portfolio.",
                              )
                            }
                          >
                            Theirs — add
                          </button>
                          <button
                            type="button"
                            className="btn-outline py-0.5 text-xs"
                            onClick={() => void act("cand", () => dropFlag(lead, f))}
                          >
                            Not theirs
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-accent hover:underline"
                          onClick={() => void act("flag", () => dropFlag(lead, f))}
                        >
                          Done
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Right: what to do next + everything that happened */}
          <div className="grid content-start gap-4">
            <NextAction
              key={`${lead.nextAction ?? ""}|${lead.nextActionAt ?? ""}`}
              lead={lead}
              rec={rec}
              data={data}
              busy={busy}
              act={act}
              go={go}
              onClose={onClose}
            />

            <OutreachWriter lead={lead} data={data} reload={reload} />

            <section className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Corvus AI
                </h3>
                {lead.aiSummaryAt && (
                  <span className="text-[11px] text-muted-foreground">
                    {relDays(lead.aiSummaryAt)}
                  </span>
                )}
              </div>
              {lead.aiSummary ? (
                <MarkdownLite text={lead.aiSummary} className="mt-2 text-sm" />
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Press Research for a profile, priority and next action.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Why {shown[0].toUpperCase() + shown.slice(1)} priority
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {staffPriority
                    ? `Set by staff · AI ranks it ${rank.level}`
                    : `AI ranking · ${rank.points} points`}
                </span>
              </div>
              {rank.strongest && (
                <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-950">
                  <b>Strongest opportunity:</b> {rank.strongest}
                </p>
              )}
              <ul className="mt-2 grid gap-0.5 text-xs">
                {rank.factors.map((f) => (
                  <li key={f.label} className="flex justify-between gap-2">
                    <span>{f.label}</span>
                    <span
                      className={`tabular-nums ${f.points < 0 ? "text-rose-700" : "text-muted-foreground"}`}
                    >
                      {f.points > 0 ? "+" : ""}
                      {f.points}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                * High 55+, Medium 30+. Indicators of protest potential — not a promise of a lower
                value or savings.
              </p>
            </section>

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
            </section>

            <History lead={lead} data={data} history={history} staffName={staffName} act={act} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

type Act = (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function PortfolioCard({
  lead,
  data,
  busy,
  act,
  sharedWith,
  onOpenLead,
}: {
  lead: Lead;
  data: MarketingData;
  busy: string | null;
  act: Act;
  sharedWith: [string, string][];
  onOpenLead: (id: string) => void;
}) {
  const props = data.properties
    .filter((p) => p.leadId === lead.id)
    .sort((a, b) => (b.assessedValue ?? 0) - (a.assessedValue ?? 0));
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ address: "", county: "", propertyType: "", value: "", account: "" });
  const total = props.reduce((s, p) => s + (p.assessedValue ?? 0), 0);
  const savings = props.reduce((s, p) => s + estSavings(p.assessedValue), 0);
  const counties = [...new Set(props.map((p) => p.county).filter(Boolean))];
  return (
    <section
      className={`rounded-lg border p-4 ${total >= 5e6 || props.length >= 5 ? "border-emerald-300 bg-emerald-50/30" : "border-border"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Portfolio — {props.length} propert{props.length === 1 ? "y" : "ies"}
          {(total >= 5e6 || props.length >= 5) && (
            <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              High value
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => setAdding((x) => !x)}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add property
        </button>
      </div>
      {props.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          <b className="text-foreground">{money(total)}</b> assessed ·{" "}
          {counties.join(", ") || "county unknown"} · possible savings ~
          <b className="text-foreground">{money(savings)}/yr</b>*
        </p>
      )}
      {sharedWith.length > 0 && (
        <p className="mt-1 text-xs">
          Co-owned with:{" "}
          {sharedWith.map(([id, name], i) => (
            <span key={id}>
              {i > 0 && ", "}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => onOpenLead(id)}
              >
                {name}
              </button>
            </span>
          ))}
        </p>
      )}
      {adding && (
        <form
          className="mt-3 grid gap-2 rounded-md bg-secondary/40 p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.address.trim() && !f.account.trim())
              return toast.error("Add an address or account number.");
            void act(
              "addprop",
              async () => {
                await addProperties([
                  {
                    leadId: lead.id,
                    address: f.address.trim() || null,
                    ...splitAddress(f.address),
                    county: cleanCounty(f.county),
                    propertyType: f.propertyType || null,
                    assessedValue: f.value ? Number(f.value.replace(/[^0-9.]/g, "")) : null,
                    accountNumber: f.account.trim() || null,
                    source: "manual",
                    sourceDetail: "Entered by staff",
                    verified: true,
                  },
                ]);
                await runRules(lead.id);
                setF({ address: "", county: "", propertyType: "", value: "", account: "" });
                setAdding(false);
              },
              "Property added — press Research to fill in county details.",
            );
          }}
        >
          <input
            className={`${inputCls} sm:col-span-2`}
            placeholder="Address, city, TX ZIP"
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
            aria-label="Property address"
          />
          <input
            className={inputCls}
            placeholder="County"
            value={f.county}
            onChange={(e) => setF({ ...f, county: e.target.value })}
            aria-label="County"
          />
          <input
            className={inputCls}
            placeholder="Type (e.g. Commercial)"
            value={f.propertyType}
            onChange={(e) => setF({ ...f, propertyType: e.target.value })}
            aria-label="Property type"
          />
          <input
            className={inputCls}
            placeholder="Assessed value"
            inputMode="decimal"
            value={f.value}
            onChange={(e) => setF({ ...f, value: e.target.value })}
            aria-label="Assessed value"
          />
          <input
            className={inputCls}
            placeholder="Account # (optional)"
            value={f.account}
            onChange={(e) => setF({ ...f, account: e.target.value })}
            aria-label="Account number"
          />
          <button
            type="submit"
            disabled={!!busy}
            className="btn-primary btn-primary-hover text-sm sm:col-span-2"
          >
            Add to portfolio
          </button>
        </form>
      )}
      {props.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No properties yet — add one, or press Research to find them by owner name.
        </p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {props.map((p) => (
            <PropertyRow key={p.id} p={p} lead={lead} data={data} busy={busy} act={act} />
          ))}
        </ul>
      )}
      {props.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          * Possible savings are a rough illustration for prioritising (a 5% reduction at a ~2.2%
          tax rate) — not a quote or a guarantee.
        </p>
      )}
    </section>
  );
}

function NextAction({
  lead,
  rec,
  data,
  busy,
  act,
  go,
  onClose,
}: {
  lead: Lead;
  rec: ReturnType<typeof recommend>;
  data: MarketingData;
  busy: string | null;
  act: Act;
  go: Go;
  onClose: () => void;
}) {
  const [text, setText] = useState(lead.nextAction ?? "");
  const [due, setDue] = useState(lead.nextActionAt?.slice(0, 10) ?? "");
  const dnc = isDnc(lead);
  const recDue = new Date(Date.now() + rec.dueInDays * 864e5);
  const overdue = lead.nextActionAt && new Date(lead.nextActionAt) < new Date();
  const save = (t: string, d: string, source: "Staff" | "Corvus AI") =>
    updateLead(lead.id, {
      nextAction: t || null,
      nextActionAt: t && d ? new Date(`${d}T17:00:00`).toISOString() : null,
      fieldSources: { ...lead.fieldSources, nextAction: { source, at: new Date().toISOString() } },
    });
  return (
    <section className={`rounded-lg border p-4 ${overdue ? "border-rose-300" : "border-border"}`}>
      <h3 className="text-sm font-semibold">Next action</h3>
      {dnc ? (
        <p className="mt-2 text-sm text-muted-foreground">None — Do Not Contact.</p>
      ) : (
        <>
          <form
            className="mt-2 grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act("next", () => save(text.trim(), due, "Staff"), "Next action saved.");
            }}
          >
            <input
              className={inputCls}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What happens next with this lead?"
              aria-label="Next action"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due"
              />
              <button type="submit" disabled={!!busy} className="btn-outline text-xs">
                Save
              </button>
              {lead.nextAction && (
                <button
                  type="button"
                  disabled={!!busy}
                  className="btn-outline text-xs"
                  onClick={() =>
                    void act(
                      "nextdone",
                      async () => {
                        await logActivity({
                          leadId: lead.id,
                          kind: "note",
                          summary: `Done: ${lead.nextAction}`,
                        });
                        await save("", "", "Staff");
                        setText("");
                        setDue("");
                      },
                      "Marked done.",
                    )
                  }
                >
                  Done
                </button>
              )}
              {overdue && <span className="text-xs font-semibold text-rose-700">Overdue</span>}
            </div>
          </form>
          <div className="mt-3 rounded-md bg-secondary/50 p-3 text-sm">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden /> Recommended
            </div>
            <p className="mt-1">
              {rec.action}{" "}
              <span className="text-muted-foreground">
                ({rec.dueInDays === 0 ? "today" : `by ${recDue.toLocaleDateString()}`})
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy}
                className="btn-outline py-1 text-xs"
                onClick={() => {
                  setText(rec.action);
                  setDue(recDue.toISOString().slice(0, 10));
                  void act(
                    "userec",
                    () => save(rec.action, recDue.toISOString().slice(0, 10), "Corvus AI"),
                    "Next action set.",
                  );
                }}
              >
                Use this
              </button>
              {!rec.planned && rec.channel !== "none" && rec.channel !== "task" && (
                <button
                  type="button"
                  disabled={
                    !!busy || (rec.channel === "email" && (!lead.email || !!lead.unsubscribedAt))
                  }
                  className="btn-outline py-1 text-xs"
                  onClick={() =>
                    void act(
                      "fup",
                      () =>
                        saveFollowup(null, {
                          leadId: lead.id,
                          dueAt: new Date(recDue.setHours(9, 0, 0, 0)).toISOString(),
                          channel: rec.channel as "email" | "call",
                          subject: rec.action.slice(0, 80),
                          aiGenerated: true,
                        }),
                      "Follow-up scheduled.",
                    )
                  }
                >
                  Schedule as {rec.channel === "call" ? "a call" : "an email"}
                </button>
              )}
              {rec.campaign && (
                <button
                  type="button"
                  className="btn-outline py-1 text-xs"
                  onClick={() => {
                    onClose();
                    go("campaigns", { campaignId: rec.campaign!.id });
                  }}
                >
                  Fits campaign: {rec.campaign.name}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function History({
  lead,
  data,
  history,
  staffName,
  act,
}: {
  lead: Lead;
  data: MarketingData;
  history: Activity[];
  staffName: (id: string | null) => string | null;
  act: Act;
}) {
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"note" | "call" | "email" | "sms" | "meeting">("note");
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [next, setNext] = useState<{
    on: boolean;
    days: number;
    channel: "call" | "email" | "meeting" | "task";
  }>({
    on: false,
    days: 3,
    channel: lead.phone ? "call" : "email",
  });
  const dnc = isDnc(lead);
  const summary = data.aiRuns.find((r) => r.scope === "history" && r.leadId === lead.id) ?? null;
  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Communication history</h3>
      <form
        className="mt-2 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim() && !outcome) return;
          void act(
            "log",
            async () => {
              await logActivity({
                leadId: lead.id,
                kind,
                summary:
                  kind === "note"
                    ? "Note"
                    : `${{ call: "Call", sms: "Text", email: "Email", meeting: "Meeting" }[kind]} logged${outcome ? ` — ${OUTCOME_LABEL[outcome]}` : ""}`,
                body: note.trim() || null,
                outcome: outcome || null,
              });
              if (kind !== "note")
                await updateLead(lead.id, { lastContactedAt: new Date().toISOString() });
              await runRules(lead.id);
              if (next.on && !dnc && outcome !== "do_not_contact" && outcome !== "not_interested") {
                const due = new Date(Date.now() + next.days * 864e5);
                due.setHours(10, 0, 0, 0);
                await saveFollowup(null, {
                  leadId: lead.id,
                  channel:
                    next.channel === "email" && (!lead.email || lead.unsubscribedAt)
                      ? "task"
                      : next.channel,
                  dueAt: due.toISOString(),
                  subject: outcome
                    ? `Follow up: ${OUTCOME_LABEL[outcome].toLowerCase()}`
                    : "Follow up",
                  assignedTo: lead.assignedTo ?? data.me,
                  status: next.channel === "email" ? "draft" : "pending",
                });
              }
              setNote("");
              setOutcome("");
              setNext((x) => ({ ...x, on: false }));
            },
            "Saved to history.",
          );
        }}
      >
        <textarea
          className={inputCls}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note, or log a call, email or text…"
          aria-label="History entry"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            aria-label="Entry type"
          >
            <option value="note">Note</option>
            <option value="call" disabled={dnc}>
              Call
            </option>
            <option value="email" disabled={dnc}>
              Email (sent outside the app)
            </option>
            <option value="sms" disabled={dnc}>
              Text
            </option>
            <option value="meeting" disabled={dnc}>
              Meeting
            </option>
          </select>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as Outcome | "")}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            aria-label="Outcome"
          >
            <option value="">Outcome…</option>
            {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-primary btn-primary-hover text-sm">
            Save
          </button>
        </div>
        {!dnc && (
          <label className="flex flex-wrap items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={next.on}
              onChange={(e) => setNext({ ...next, on: e.target.checked })}
            />
            Then schedule a
            <select
              className="rounded border border-input bg-background px-1 py-0.5"
              value={next.channel}
              onChange={(e) => setNext({ ...next, channel: e.target.value as typeof next.channel })}
              aria-label="Next follow-up type"
            >
              <option value="call">call</option>
              <option value="email">email (for approval)</option>
              <option value="meeting">meeting</option>
              <option value="task">task</option>
            </select>
            in
            <select
              className="rounded border border-input bg-background px-1 py-0.5"
              value={next.days}
              onChange={(e) => setNext({ ...next, days: Number(e.target.value) })}
              aria-label="Days until the follow-up"
            >
              {[1, 2, 3, 5, 7, 14].map((d) => (
                <option key={d} value={d}>
                  {d} day{d === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="text-[11px] text-muted-foreground">
          * The outcome updates the status by your approved rules.
        </p>
      </form>
      <div className="mt-3 rounded-md bg-secondary/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden /> Conversation summary
          </span>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            disabled={!history.length}
            onClick={() =>
              void act("summ", async () => {
                await runAi({
                  scope: "history",
                  leadId: lead.id,
                  instruction:
                    "Summarise this prospect's communication history for the team in markdown: **Where things stand** (1-2 lines), **Important discussions** (bullets: what they said, concerns, promises made), **Next steps** (1-3 bullets). Use only the history given.",
                  context:
                    leadFacts(lead, data.activities, data.followups) +
                    `\nFull history (newest first):\n${history
                      .slice(0, 60)
                      .map(
                        (a) =>
                          `- ${a.createdAt.slice(0, 10)} ${a.kind}${a.outcome ? ` (${a.outcome})` : ""}: ${a.summary}${a.body ? ` — ${a.body.slice(0, 300)}` : ""}`,
                      )
                      .join("\n")}`,
                });
              })
            }
          >
            {summary ? "Refresh" : "Summarise"}
          </button>
        </div>
        {summary?.result ? (
          <>
            <MarkdownLite text={summary.result} className="mt-1 text-sm" />
            <p className="text-[10px] text-muted-foreground">{relDays(summary.createdAt)}</p>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Corvus AI summarises what's been discussed and what to do next.
          </p>
        )}
      </div>
      <ul className="mt-3 grid max-h-96 gap-2 overflow-y-auto pr-1 text-sm">
        {history.length === 0 && <li className="text-muted-foreground">No history yet.</li>}
        {history.map((a) => (
          <li key={a.id} className="border-l-2 border-border pl-3">
            <div className="flex justify-between gap-2">
              <span className="font-medium">
                <span className="mr-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  {KIND_LABEL[a.kind]}
                </span>
                {a.summary}
              </span>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                title={new Date(a.createdAt).toLocaleString()}
              >
                {relDays(a.createdAt)}
              </span>
            </div>
            {a.body && <p className="whitespace-pre-wrap text-muted-foreground">{a.body}</p>}
            <p className="text-[11px] text-muted-foreground">
              {a.createdBy ? (staffName(a.createdBy) ?? "Staff") : "Automatic"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Add / edit a lead. A new lead can include its first property. */
export function LeadForm({
  lead,
  data,
  title,
  onSave,
  onCancel,
}: {
  lead?: Lead;
  data: MarketingData;
  title: string;
  onSave: (
    input: LeadInput,
    property?: { address: string; county: string; propertyType: string; value: string },
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<LeadInput>({
    fullName: lead?.fullName ?? "",
    company: lead?.company ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    mailingAddress: lead?.mailingAddress ?? "",
    ownerNames: lead?.ownerNames ?? "",
    city: lead?.city ?? "",
    zip: lead?.zip ?? "",
    source: lead?.source ?? "manual",
    assignedTo: lead?.assignedTo ?? data.me,
    notes: lead?.notes ?? "",
  });
  const [prop, setProp] = useState({ address: "", county: "", propertyType: "", value: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof LeadInput) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.fullName && !f.company && !f.email)
          return toast.error("Add a name, company or email.");
        const em = cleanEmail(f.email);
        if (!em.valid) return toast.error("That email doesn't look right.");
        const ph = cleanPhone(f.phone);
        setBusy(true);
        try {
          await onSave(
            {
              ...f,
              email: em.value ?? "",
              phone: ph.value ?? "",
              assignedTo: f.assignedTo || null,
            },
            !lead && (prop.address || prop.value) ? prop : undefined,
          );
        } catch (err) {
          toast.error(getErrorMessage(err, "Could not save this lead."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      {lead?.profileId && (
        <p className="text-xs text-muted-foreground">
          * Linked to a CorvusPT account — status and properties follow the account.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner / company">
          <input className={inputCls} value={f.company ?? ""} onChange={set("company")} />
        </Field>
        <Field label="Contact name">
          <input className={inputCls} value={f.fullName ?? ""} onChange={set("fullName")} />
        </Field>
        <Field label="Email">
          <input className={inputCls} type="email" value={f.email ?? ""} onChange={set("email")} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={f.phone ?? ""} onChange={set("phone")} />
        </Field>
        <Field label="Mailing address">
          <input
            className={inputCls}
            value={f.mailingAddress ?? ""}
            onChange={set("mailingAddress")}
          />
        </Field>
        <Field label="Owner(s) on record">
          <input className={inputCls} value={f.ownerNames ?? ""} onChange={set("ownerNames")} />
        </Field>
        <Field label="City">
          <input className={inputCls} value={f.city ?? ""} onChange={set("city")} />
        </Field>
        <Field label="ZIP">
          <input
            className={inputCls}
            value={f.zip ?? ""}
            onChange={set("zip")}
            inputMode="numeric"
          />
        </Field>
        <Field label="Assigned to">
          <select className={inputCls} value={f.assignedTo ?? ""} onChange={set("assignedTo")}>
            <option value="">Unassigned</option>
            {data.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {!lead && (
          <Field label="Source">
            <select className={inputCls} value={f.source} onChange={set("source")}>
              {(["manual", "referral", "website", "event", "import", "podio"] as const).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {!lead && (
        <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            First property (optional — Research finds the rest)
          </legend>
          <input
            className={`${inputCls} sm:col-span-2`}
            placeholder="Address, city, TX ZIP"
            value={prop.address}
            onChange={(e) => setProp({ ...prop, address: e.target.value })}
            aria-label="Property address"
          />
          <input
            className={inputCls}
            placeholder="County"
            value={prop.county}
            onChange={(e) => setProp({ ...prop, county: e.target.value })}
            aria-label="County"
          />
          <input
            className={inputCls}
            placeholder="Type"
            value={prop.propertyType}
            onChange={(e) => setProp({ ...prop, propertyType: e.target.value })}
            aria-label="Property type"
          />
          <input
            className={inputCls}
            placeholder="Assessed value"
            inputMode="decimal"
            value={prop.value}
            onChange={(e) => setProp({ ...prop, value: e.target.value })}
            aria-label="Assessed value"
          />
        </fieldset>
      )}
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

const FLAG_DOT = { strong: "bg-rose-600", moderate: "bg-amber-500", info: "bg-sky-500" } as const;

function PropertyRow({
  p,
  lead,
  data,
  busy,
  act,
}: {
  p: LeadProperty;
  lead: Lead;
  data: MarketingData;
  busy: string | null;
  act: Act;
}) {
  const o = opportunity(p);
  const flags = p.analysis?.flags ?? [];
  return (
    <li className="grid gap-1 border-b border-border/60 pb-2 text-sm last:border-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
        <span className="min-w-0 truncate font-medium" title={p.address ?? undefined}>
          {p.address ?? `Account ${p.accountNumber}`}
        </span>
        <span className="text-right font-semibold tabular-nums">
          {money(p.assessedValue)}
          {p.valueYear && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              {p.valueYear}
            </span>
          )}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {[
          p.county && `${p.county} County`,
          p.propertyType,
          p.accountNumber && `#${p.accountNumber}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        {p.changePct != null && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${p.changePct >= 10 ? "bg-rose-100 text-rose-900" : p.changePct >= 5 ? "bg-amber-100 text-amber-900" : "bg-secondary"}`}
            title={`Previous${p.priorYear ? ` (${p.priorYear})` : ""}: ${money(p.priorValue)}`}
          >
            {p.changePct > 0 ? "+" : ""}
            {p.changePct}% vs {p.priorYear ?? "last year"}
          </span>
        )}
        {o && !flags.length && !(p.changePct != null && o.note.startsWith("Value up")) && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${OPP_TONE[o.level]}`}>
            {o.note}
          </span>
        )}
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${p.verified ? "bg-secondary" : "bg-amber-50 text-amber-900"}`}
          title={p.sourceDetail ?? undefined}
        >
          {p.verified ? "✓ " : ""}
          {p.sourceDetail ?? p.source}
          {p.refreshedAt && ` · updated ${relDays(p.refreshedAt)}`}
        </span>
      </div>
      {flags.length > 0 && (
        <ul className="grid gap-0.5 text-xs">
          {flags.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${FLAG_DOT[f.level]}`}
                aria-hidden
              />
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      {p.analysis?.explanation && (
        <details className="text-xs">
          <summary className="cursor-pointer text-accent">Corvus AI on this assessment</summary>
          <MarkdownLite text={p.analysis.explanation} className="mt-1" />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Sources:{" "}
            {p.analysis.sources.map((src, i) => (
              <span key={i}>
                {i > 0 && " · "}
                {src.url ? (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {src.label}
                  </a>
                ) : (
                  src.label
                )}
              </span>
            ))}
            {p.analyzedAt && ` · reviewed ${relDays(p.analyzedAt)}`}
          </p>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <button
          type="button"
          disabled={!!busy}
          className="text-accent hover:underline disabled:opacity-50"
          onClick={() =>
            void act(
              `refresh-${p.id}`,
              async () => {
                if (!(await refreshProperty(p)))
                  throw new Error("The county record wasn't found for this address.");
              },
              "Updated from the county record.",
            )
          }
        >
          {busy === `refresh-${p.id}` ? "Refreshing…" : "Refresh from county"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          className="text-accent hover:underline disabled:opacity-50"
          onClick={() =>
            void act(`analyze-${p.id}`, async () => {
              const a = await analyzeProperty(lead, p);
              toast.success(
                a.flags.filter((f) => f.level !== "info").length
                  ? "Assessment reviewed — concerns flagged."
                  : "Assessment reviewed — nothing flagged.",
              );
            })
          }
        >
          {busy === `analyze-${p.id}`
            ? "Reviewing…"
            : p.analysis && "comps" in p.analysis
              ? "Review again"
              : "Review assessment"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          className="text-accent hover:underline disabled:opacity-50"
          onClick={() =>
            void act(`owner-${p.id}`, async () => {
              const r = await researchPropertyOwner(lead, p, data);
              toast.success(
                `Owner researched — ${r.linked} more propert${r.linked === 1 ? "y" : "ies"} linked${r.candidates ? `, ${r.candidates} to verify` : ""}.`,
              );
            })
          }
        >
          {busy === `owner-${p.id}` ? "Researching…" : "Research owner"}
        </button>
        <span className="ml-auto flex gap-1">
          {!p.verified && (
            <button
              type="button"
              aria-label="Mark verified"
              title="Mark verified"
              className="rounded p-1 hover:bg-secondary"
              onClick={() => void act("vp", () => verifyProperty(p))}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          {p.source !== "account" && (
            <button
              type="button"
              aria-label="Remove from portfolio"
              title="Remove from portfolio"
              className="rounded p-1 hover:bg-secondary"
              onClick={async () => {
                if (
                  await confirmDialog(
                    `Remove ${p.address ?? "this property"} from ${leadName(lead)}'s portfolio?`,
                  )
                )
                  void act("rmprop", () => deleteProperty(p.id));
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

/** Contacted → Subscribed for this lead: done steps with dates, the next step's link, and the Support handoff. */
function JourneyStrip({ lead, data }: { lead: Lead; data: MarketingData }) {
  const steps = journeySteps(lead, data.activities);
  const handoff = data.handoffs.find((h) => h.leadId === lead.id);
  const links = journeyLinks(
    lead,
    `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, ""),
  );
  const nextLink =
    lead.stage === "registered" ||
    lead.stage === "property_added" ||
    lead.stage === "subscription_started"
      ? lead.stage === "registered"
        ? { label: "add-property link", url: links.addProperty }
        : { label: "checkout link", url: links.checkout }
      : lead.stage !== "subscribed"
        ? { label: "registration link", url: links.registration }
        : null;
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <ol className="flex flex-wrap items-center gap-1 text-[11px]">
        {steps.map((st, i) => (
          <li key={st.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span
              className={`rounded-full px-2 py-0.5 ${st.current ? "bg-accent font-semibold text-accent-foreground" : st.done ? "bg-emerald-100 text-emerald-900" : "bg-secondary text-muted-foreground"}`}
              title={st.at ? new Date(st.at).toLocaleString() : st.done ? "Done" : "Not yet"}
            >
              {st.done && !st.current ? "✓ " : ""}
              {st.label}
              {st.at && (
                <span className="opacity-70">
                  {" "}
                  · {new Date(st.at).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
              )}
            </span>
          </li>
        ))}
        {nextLink && !isDnc(lead) && (
          <li className="ml-auto">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-accent hover:underline"
              title={nextLink.url}
              onClick={() =>
                navigator.clipboard
                  .writeText(nextLink.url)
                  .then(() => toast.success("Link copied."))
                  .catch(() => toast.error("Couldn't copy."))
              }
            >
              Copy {nextLink.label}
            </button>
          </li>
        )}
      </ol>
      {handoff && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
          <b>Customer Support</b> took over {relDays(handoff.createdAt)} —{" "}
          {handoff.status === "open"
            ? "waiting for Support to pick it up"
            : handoff.status === "accepted"
              ? "Support is onboarding them"
              : "onboarding done"}
          .
          {!!handoff.snapshot.needs?.length && (
            <> Onboarding: {handoff.snapshot.needs.join(" · ")}.</>
          )}{" "}
          Marketing history stays here.
        </div>
      )}
    </div>
  );
}
