import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileWarning,
  Lock,
  Mail,
  Sparkles,
} from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import { supportJourney } from "@/lib/journey-steps";
import {
  cents,
  documentIssues,
  getCustomerDetail,
  listTemplates,
  nextOnboardingStep,
  propertyConflicts,
  setOnboarding,
  shortDate,
  supportAction,
  CATEGORY_LABEL,
  STATUS_LABEL,
  type Billing,
  type CustomerDetail,
  type DocumentIssue,
  type SupportTemplate,
  type TeamMember,
} from "@/lib/support-console";
import { RequestApprovalDialog, type StaffContext } from "@/components/staff/StaffRecords";

type Tab = "overview" | "journey" | "billing" | "tickets" | "timeline";

type AiCustomer = {
  summary: string;
  incompleteSteps: { step: string; recommendation: string }[];
  followUps: string[];
  risks: { property: string | null; risk: string; severity: string }[];
  conflicts: { property: string | null; field: string; detail: string }[];
};

const sel = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export function SupportCustomerDetail({
  profileId,
  team,
  ctx,
  onBack,
  onTicket,
  onNewTicket,
}: {
  profileId: string;
  team: TeamMember[];
  ctx: StaffContext;
  onBack: () => void;
  onTicket: (id: string) => void;
  onNewTicket: (profileId: string, propertyId?: string | null, subject?: string) => void;
}) {
  const [d, setD] = useState<CustomerDetail | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [ai, setAi] = useState<AiCustomer | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [templates, setTemplates] = useState<SupportTemplate[]>([]);
  const [compose, setCompose] = useState<{
    template: string;
    propertyId: string | null;
    issue: string;
    nextStep: string;
  } | null>(null);
  const [approval, setApproval] = useState<
    null | "refund" | "pricing_exception" | "subscription_override"
  >(null);

  const load = useCallback(
    () =>
      getCustomerDetail(profileId)
        .then(setD)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load this customer."))),
    [profileId],
  );
  useEffect(() => {
    setD(null);
    setAi(null);
    void load();
    listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [load]);

  async function runAi() {
    setAiBusy(true);
    try {
      setAi(await supportAction<AiCustomer>("ai_customer", { profileId }));
    } catch (e) {
      toast.error(getErrorMessage(e, "AI couldn't summarize this customer."));
    } finally {
      setAiBusy(false);
    }
  }

  if (!d) return <p className="mt-6 text-sm text-muted-foreground">Loading customer…</p>;
  const steps = d.onboarding.steps;
  const doneCount = steps.filter((s) => s.done).length;
  const next = nextOnboardingStep(steps);
  const rec = d.onboarding.record;

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-accent"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> All customers
      </button>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold">{d.profile.name ?? d.profile.email}</h2>
          <p className="text-sm text-muted-foreground">
            {[d.profile.email, d.profile.phone, d.profile.company].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">
            Customer since {shortDate(d.profile.createdAt)} ·{" "}
            {d.lead
              ? `From Marketing (${d.lead.source}${d.lead.assignedTo ? `, ${d.lead.assignedTo}` : ""})`
              : (d.profile.source ?? "Signed up directly")}
            {d.handoff && ` · Handoff ${d.handoff.status}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={() => onNewTicket(profileId)}
          >
            New ticket
          </button>
          <button
            type="button"
            className="btn-accent inline-flex items-center gap-1.5 text-sm"
            onClick={runAi}
            disabled={aiBusy}
          >
            <Sparkles className="h-4 w-4" aria-hidden /> {aiBusy ? "Reading…" : "AI summary"}
          </button>
        </div>
      </div>

      {ai && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
          <div className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden /> AI summary
          </div>
          <p className="mt-1">{ai.summary}</p>
          {ai.incompleteSteps.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Onboarding — how to help
              </div>
              <ul className="mt-1 list-disc pl-5">
                {ai.incompleteSteps.map((s) => (
                  <li key={s.step}>
                    <span className="font-medium">{s.step}:</span> {s.recommendation}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ai.risks.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Risks</div>
              <ul className="mt-1 list-disc pl-5">
                {ai.risks.map((r, i) => (
                  <li key={i} className={r.severity === "high" ? "text-destructive" : ""}>
                    {r.property ? `${r.property}: ` : ""}
                    {r.risk}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ai.conflicts.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Conflicts to confirm with the customer (nothing was changed)
              </div>
              <ul className="mt-1 list-disc pl-5">
                {ai.conflicts.map((c, i) => (
                  <li key={i}>
                    {c.property ? `${c.property} — ` : ""}
                    {c.field}: {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ai.followUps.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Recommended follow-ups
              </div>
              <ul className="mt-1 list-disc pl-5">
                {ai.followUps.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div
        className="mt-5 inline-flex flex-wrap rounded-md border border-border p-0.5 text-sm"
        role="tablist"
      >
        {(
          [
            ["overview", "Onboarding"],
            ["journey", `Property journey (${d.properties.length})`],
            ["billing", "Billing"],
            ["tickets", `Tickets (${d.tickets.length})`],
            ["timeline", "Timeline"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1 ${tab === k ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="card-elev p-5">
            <h3 className="font-semibold">
              Onboarding — {doneCount} of {steps.length} done
            </h3>
            <ul className="mt-3 grid gap-2 text-sm">
              {steps.map((s) => (
                <li key={s.key} className="flex items-start gap-2">
                  {s.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  )}
                  <span className={s.done ? "text-muted-foreground" : ""}>
                    {s.label}
                    {s.detail && (
                      <span className="text-xs text-muted-foreground"> — {s.detail}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {next && (
              <button
                type="button"
                className="btn-outline mt-4 inline-flex items-center gap-1.5 text-sm"
                onClick={() =>
                  setCompose({
                    template: "onboarding_next_step",
                    propertyId: null,
                    issue: "",
                    nextStep: next.label.toLowerCase(),
                  })
                }
              >
                <Mail className="h-4 w-4" aria-hidden /> Send reminder: {next.label}
              </button>
            )}
            {rec?.last_reminder_at && (
              <p className="mt-2 text-xs text-muted-foreground">
                {rec.reminders_sent} reminder{rec.reminders_sent === 1 ? "" : "s"} sent · last{" "}
                {shortDate(rec.last_reminder_at)}
              </p>
            )}
          </div>
          <div className="card-elev grid content-start gap-3 p-5 text-sm">
            <label className="grid gap-1">
              <span className="font-medium">Onboarding owner</span>
              <select
                className={sel}
                value={rec?.owner ?? ""}
                onChange={(e) =>
                  setOnboarding(profileId, {
                    owner: e.target.value || null,
                    status: rec?.status === "complete" ? "complete" : "in_progress",
                  })
                    .then(load)
                    .then(() => toast.success("Owner updated"))
                    .catch((err) => toast.error(getErrorMessage(err, "Couldn't update.")))
                }
              >
                <option value="">Nobody yet</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Status</span>
              <select
                className={sel}
                value={rec?.status ?? "not_started"}
                onChange={(e) =>
                  setOnboarding(profileId, {
                    status: e.target.value as "not_started" | "in_progress" | "complete",
                  })
                    .then(load)
                    .catch((err) => toast.error(getErrorMessage(err, "Couldn't update.")))
                }
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
              </select>
            </label>
            {rec?.completed_at && (
              <p className="text-xs text-muted-foreground">
                Completed {shortDate(rec.completed_at)}
              </p>
            )}
            {d.handoff?.summary && (
              <div className="rounded-md bg-secondary/50 p-3 text-xs">
                <div className="font-semibold">Marketing handoff summary</div>
                <p className="mt-1 whitespace-pre-wrap">{d.handoff.summary}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "journey" && (
        <JourneySection
          d={d}
          onRequest={(template, propertyId, issue) =>
            setCompose({ template, propertyId, issue, nextStep: "" })
          }
          onNewTicket={(propertyId, subject) => onNewTicket(profileId, propertyId, subject)}
        />
      )}

      {tab === "billing" && (
        <BillingSection
          profileId={profileId}
          email={d.profile.email}
          onApproval={setApproval}
          reload={load}
        />
      )}

      {tab === "tickets" && (
        <section className="card-elev mt-4 p-5">
          {d.tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets for this customer.</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {d.tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap justify-between gap-2 py-2 text-left hover:bg-secondary/30"
                    onClick={() => onTicket(t.id)}
                  >
                    <span>
                      #{t.number} {t.subject}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t.category ? CATEGORY_LABEL[t.category] : "Uncategorized"} ·{" "}
                        {shortDate(t.createdAt)}
                      </span>
                    </span>
                    <span className="text-xs">{STATUS_LABEL[t.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "timeline" && (
        <section className="card-elev mt-4 p-5">
          <ul className="grid gap-2 text-sm">
            {[
              ...d.events.map((e) => ({
                at: e.at,
                text: e.summary,
                who: e.actor,
                dept: e.department,
              })),
              ...d.subscriptionEvents.map((s) => ({
                at: s.created_at,
                text: `Subscription ${s.kind.replace(/_/g, " ")}${s.amount_cents != null ? ` — ${cents(s.amount_cents)}` : ""}${s.detail ? ` (${s.detail})` : ""}`,
                who: "Stripe",
                dept: "billing",
              })),
            ]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((e, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  <div>{e.text}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {e.who ?? "System"} · {e.dept}
                  </div>
                </li>
              ))}
            {d.events.length === 0 && d.subscriptionEvents.length === 0 && (
              <li className="text-muted-foreground">Nothing recorded yet.</li>
            )}
          </ul>
        </section>
      )}

      {compose && (
        <ComposeTemplate
          profileId={profileId}
          templates={templates}
          properties={d.properties.map((p) => ({ id: p.id, address: p.address }))}
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={load}
        />
      )}
      {approval && (
        <RequestApprovalDialog
          ctx={ctx}
          initialKind={approval}
          initialEmail={d.profile.email ?? ""}
          onClose={() => setApproval(null)}
          onDone={load}
        />
      )}
    </div>
  );
}

// ── property journey + document assistance ─────────────────────────────────

function JourneySection({
  d,
  onRequest,
  onNewTicket,
}: {
  d: CustomerDetail;
  onRequest: (template: string, propertyId: string, issue: string) => void;
  onNewTicket: (propertyId: string, subject: string) => void;
}) {
  const issues = useMemo(() => documentIssues(d.documents), [d.documents]);
  async function openDoc(id: string) {
    try {
      const { url } = await supportAction<{ url: string }>("doc_url", { documentId: id });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't open the file."));
    }
  }
  if (d.properties.length === 0)
    return <p className="card-elev mt-4 p-5 text-sm text-muted-foreground">No properties yet.</p>;
  return (
    <div className="mt-4 grid gap-4">
      <p className="flex items-start gap-2 rounded-md bg-secondary/50 p-3 text-xs">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Support explains steps and requests information. Values, settlement decisions and filing
        decisions stay with the customer and Operations — nothing here changes them.
      </p>
      {d.properties.map((p) => {
        const protest = d.protests.find((x) => x.propertyId === p.id) ?? null;
        const docs = d.documents.filter((x) => x.propertyId === p.id && !x.deletedAt);
        const bill = d.bills.find((b) => b.propertyId === p.id) ?? null;
        const j = supportJourney({
          property: p,
          protest,
          documents: docs.length,
          packetSigned: d.packetSigned,
          bill,
        });
        const pIssues = issues.filter((x) => x.propertyId === p.id);
        const conflicts = propertyConflicts(p.raw);
        const versions = new Map(
          d.documents.filter((x) => x.editedFrom).map((x) => [x.editedFrom as string, x]),
        );
        return (
          <section key={p.id} className="card-elev p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{p.address}</h3>
                <p className="text-xs text-muted-foreground">
                  {p.cad ?? "County unknown"} · Account {p.accountNumber ?? "—"} · Tax year{" "}
                  {p.taxYear ?? "—"} · {p.ownerName ?? "Owner unknown"}
                </p>
              </div>
              <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
                Stage: {j.stage}
              </span>
            </div>
            <ol className="mt-3 flex flex-wrap gap-1" aria-label="Journey Map">
              {j.steps.map((s, i) => (
                <li
                  key={s.label}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    i === j.stageIndex
                      ? "bg-accent text-accent-foreground"
                      : s.done
                        ? "bg-success/15 text-success"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {s.label}
                </li>
              ))}
            </ol>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Alongside
                </div>
                <ul className="mt-1 grid gap-1 text-sm">
                  {j.parallel.map((x) => (
                    <li key={x.label}>
                      <span className="text-muted-foreground">{x.label}:</span> {x.status}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Outstanding
                </div>
                <ul className="mt-1 grid gap-1 text-sm">
                  {j.outstanding.length ? (
                    j.outstanding.map((x) => <li key={x}>• {x}</li>)
                  ) : (
                    <li className="text-muted-foreground">Nothing outstanding</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Deadlines
                </div>
                <ul className="mt-1 grid gap-1 text-sm">
                  {j.deadlines.length ? (
                    j.deadlines.map((x) => (
                      <li key={x.label + x.date}>
                        {x.label}: <span className="font-medium">{shortDate(x.date)}</span>
                        <span
                          className={`block text-[11px] ${x.verified ? "text-success" : "text-amber-700"}`}
                        >
                          {x.verified ? "✓ " : ""}
                          {x.source}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="text-muted-foreground">None on file</li>
                  )}
                </ul>
              </div>
            </div>
            <p className="mt-3 text-sm">
              <span className="font-semibold">Next action:</span> {j.nextAction}
            </p>
            {j.flags.length > 0 && (
              <ul className="mt-3 grid gap-1">
                {j.flags.map((f) => (
                  <li
                    key={f.text}
                    className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-xs ${
                      f.severity === "high"
                        ? "bg-destructive/10 text-destructive"
                        : f.severity === "medium"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-secondary"
                    }`}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {f.text}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 border-t border-border/60 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                  <FileWarning className="h-4 w-4" aria-hidden /> Documents
                </h4>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-outline text-xs"
                    onClick={() =>
                      onRequest("upload_request", p.id, docs.length ? "" : "your appraisal notice")
                    }
                  >
                    Request upload
                  </button>
                  <button
                    type="button"
                    className="btn-outline text-xs"
                    onClick={() => onNewTicket(p.id, `Document help — ${p.address}`)}
                  >
                    Raise ticket
                  </button>
                </div>
              </div>
              {conflicts.length > 0 && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  <div className="font-semibold">
                    The county check found differences — the record wasn&apos;t changed:
                  </div>
                  <ul className="mt-1 list-disc pl-4">
                    {conflicts.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="mt-1 underline"
                    onClick={() => onRequest("correction_request", p.id, conflicts.join("\n"))}
                  >
                    Ask the customer to confirm
                  </button>
                </div>
              )}
              {pIssues.length > 0 && (
                <IssueList
                  issues={pIssues}
                  onRequest={(issue) => onRequest("correction_request", p.id, issue)}
                />
              )}
              {docs.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No documents uploaded.</p>
              ) : (
                <ul className="mt-2 grid gap-1 text-sm">
                  {docs.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {x.fileName}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {x.type ?? x.category ?? "document"} · {shortDate(x.uploadedAt)}
                          {x.verificationStatus && ` · ${x.verificationStatus.replace(/_/g, " ")}`}
                          {x.editedFrom && " · edited copy (original kept)"}
                          {versions.has(x.id) && " · has a newer version"}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-accent underline"
                        onClick={() => void openDoc(x.id)}
                      >
                        Open <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function IssueList({
  issues,
  onRequest,
}: {
  issues: DocumentIssue[];
  onRequest: (issue: string) => void;
}) {
  return (
    <ul className="mt-2 grid gap-1">
      {issues.map((i) => (
        <li
          key={i.documentId + i.kind}
          className="rounded-md bg-amber-50 p-2 text-xs text-amber-900"
        >
          <span className="font-semibold">{i.label}</span> — {i.fileName}
          {i.detail && <span className="block">{i.detail}</span>}
          <button
            type="button"
            className="mt-0.5 underline"
            onClick={() =>
              onRequest(`${i.label} in "${i.fileName}"${i.detail ? `: ${i.detail}` : ""}`)
            }
          >
            Request a correction
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── billing ──────────────────────────────────────────────────────────────────

function BillingSection({
  profileId,
  email,
  onApproval,
  reload,
}: {
  profileId: string;
  email: string | null;
  onApproval: (k: "refund" | "pricing_exception" | "subscription_override") => void;
  reload: () => void;
}) {
  const [b, setB] = useState<Billing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [discount, setDiscount] = useState({ propertyId: "", policyId: "" });
  const [cancel, setCancel] = useState({ propertyId: "", reason: "" });
  const load = useCallback(() => {
    setErr(null);
    supportAction<Billing>("billing", { profileId })
      .then(setB)
      .catch((e) => setErr(getErrorMessage(e, "Couldn't load billing.")));
  }, [profileId]);
  useEffect(() => load(), [load]);

  async function act(key: string, action: string, body: Record<string, unknown>, ok: string) {
    setBusy(key);
    try {
      const r = await supportAction<{
        ok?: boolean;
        blocked?: boolean;
        message?: string;
        endsAt?: string;
      }>(action, { profileId, ...body });
      if (r.blocked) toast.error(r.message ?? "Not allowed by the policy.");
      else toast.success(r.endsAt ? `${ok} — ends ${shortDate(r.endsAt)}` : ok);
      load();
      reload();
    } catch (e) {
      toast.error(getErrorMessage(e, "That didn't work."));
    } finally {
      setBusy(null);
    }
  }

  if (err) return <p className="card-elev mt-4 p-5 text-sm text-destructive">{err}</p>;
  if (!b) return <p className="mt-4 text-sm text-muted-foreground">Loading billing from Stripe…</p>;
  const subscribed = b.covered.filter((c) => c.subscriptionId);
  return (
    <div className="mt-4 grid gap-4">
      {b.mode === "test" && <p className="text-xs text-amber-700">Stripe test mode</p>}
      <section className="card-elev p-5">
        <h3 className="font-semibold">Plan & covered properties</h3>
        <ul className="mt-2 grid gap-1 text-sm">
          {b.covered.map((c) => (
            <li key={c.id}>
              {c.label} —{" "}
              <span className="text-muted-foreground">
                {c.plan?.replace(/_/g, " ") ?? "no plan"} · {c.status ?? "not subscribed"}
              </span>
            </li>
          ))}
        </ul>
        {b.subscriptions.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5">Covers</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5">Price</th>
                  <th className="py-1.5">Started</th>
                  <th className="py-1.5">Renews / ends</th>
                  <th className="py-1.5">Discount</th>
                </tr>
              </thead>
              <tbody>
                {b.subscriptions.map((s) => (
                  <tr key={s.id} className="border-t border-border/60">
                    <td className="py-1.5">{s.covers ?? s.id}</td>
                    <td className="py-1.5">{s.status}</td>
                    <td className="py-1.5">
                      {cents(s.amountCents)}/{s.interval ?? "—"}
                      {s.committed && (
                        <span className="block text-[11px] text-muted-foreground">
                          12-month commitment
                        </span>
                      )}
                    </td>
                    <td className="py-1.5">{shortDate(s.startedAt)}</td>
                    <td className="py-1.5">
                      {s.cancelAt
                        ? `Ends ${shortDate(s.cancelAt)}`
                        : s.cancelAtPeriodEnd
                          ? `Ends ${shortDate(s.currentPeriodEnd)}`
                          : `Renews ${shortDate(s.currentPeriodEnd)}`}
                    </td>
                    <td className="py-1.5">{s.discount ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-elev p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Invoices</h3>
          <button
            type="button"
            className="btn-outline text-xs"
            disabled={!b.permissions.paymentLinks || !b.customer || busy === "link"}
            title={b.permissions.paymentLinks ? undefined : "Not switched on for Support"}
            onClick={() => void act("link", "payment_link", {}, "Secure payment link emailed")}
          >
            Email a secure payment link
          </button>
        </div>
        {b.invoices.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No invoices.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5">Invoice</th>
                  <th className="py-1.5">Date</th>
                  <th className="py-1.5">Covers</th>
                  <th className="py-1.5">Amount</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {b.invoices.map((i) => (
                  <tr key={i.id} className="border-t border-border/60">
                    <td className="py-1.5">{i.number ?? i.id.slice(-8)}</td>
                    <td className="py-1.5">{shortDate(i.createdAt)}</td>
                    <td className="py-1.5">{i.covers ?? "—"}</td>
                    <td className="py-1.5">{cents(i.amountDueCents)}</td>
                    <td className={`py-1.5 ${i.status === "open" ? "text-destructive" : ""}`}>
                      {i.status}
                      {i.status === "open" && i.attempts > 0 && (
                        <span className="block text-[11px]">
                          {i.attempts} failed attempt{i.attempts === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        className="text-xs text-accent underline disabled:opacity-50"
                        disabled={!b.permissions.resendInvoices || busy === i.id}
                        onClick={() =>
                          void act(i.id, "resend_invoice", { invoiceId: i.id }, "Invoice re-sent")
                        }
                      >
                        Resend
                      </button>
                      {i.status === "open" && b.permissions.paymentLinks && (
                        <button
                          type="button"
                          className="ml-3 text-xs text-accent underline"
                          onClick={() =>
                            void act(
                              `pay-${i.id}`,
                              "payment_link",
                              { invoiceId: i.id },
                              "Payment link emailed",
                            )
                          }
                        >
                          Payment link
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-elev p-5">
        <h3 className="font-semibold">Payment history</h3>
        <p className="text-xs text-muted-foreground">
          Card brand and last 4 only — full card details stay with Stripe.
        </p>
        {b.payments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No payments.</p>
        ) : (
          <ul className="mt-2 grid gap-1 text-sm">
            {b.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {shortDate(p.createdAt)} · {cents(p.amountCents)} · {p.card ?? "—"}
                  {p.refundedCents > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · refunded {cents(p.refundedCents)}
                    </span>
                  )}
                  {p.failure && <span className="block text-xs text-destructive">{p.failure}</span>}
                </span>
                <span className={p.status === "succeeded" ? "text-success" : "text-destructive"}>
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-elev grid gap-4 p-5 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">Approved discount</h3>
          {!b.permissions.discounts ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Not switched on for Support. Use a pricing-exception request instead.
            </p>
          ) : b.discountPolicies.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No approved discount policies yet.</p>
          ) : (
            <div className="mt-2 grid gap-2 text-sm">
              <select
                className={sel}
                value={discount.propertyId}
                onChange={(e) => setDiscount({ ...discount, propertyId: e.target.value })}
              >
                <option value="">Property…</option>
                {subscribed.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                className={sel}
                value={discount.policyId}
                onChange={(e) => setDiscount({ ...discount, policyId: e.target.value })}
              >
                <option value="">Policy…</option>
                {b.discountPolicies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-outline text-sm"
                disabled={!discount.propertyId || !discount.policyId || busy === "discount"}
                onClick={() => void act("discount", "apply_discount", discount, "Discount applied")}
              >
                Apply
              </button>
            </div>
          )}
        </div>
        <div>
          <h3 className="font-semibold">Cancel by policy</h3>
          {!b.permissions.cancellations ? (
            <p className="mt-1 text-sm text-muted-foreground">Not switched on for Support.</p>
          ) : (
            <div className="mt-2 grid gap-2 text-sm">
              <select
                className={sel}
                value={cancel.propertyId}
                onChange={(e) => setCancel({ ...cancel, propertyId: e.target.value })}
              >
                <option value="">Property…</option>
                {subscribed.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                className={sel}
                placeholder="Why the customer is cancelling"
                value={cancel.reason}
                onChange={(e) => setCancel({ ...cancel, reason: e.target.value })}
              />
              <button
                type="button"
                className="btn-outline text-sm text-destructive"
                disabled={
                  !cancel.propertyId || cancel.reason.trim().length < 5 || busy === "cancel"
                }
                onClick={() =>
                  void act("cancel", "cancel_by_policy", cancel, "Cancellation scheduled")
                }
              >
                Schedule cancellation
              </button>
              <p className="text-[11px] text-muted-foreground">
                Follows the plan&apos;s commitment: monthly plans can give notice once 13 months are
                complete; the plan ends 60 days later.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="card-elev p-5">
        <h3 className="font-semibold">Needs Super Admin approval</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline text-sm"
            disabled={!email}
            onClick={() => onApproval("refund")}
          >
            Request a refund
          </button>
          <button
            type="button"
            className="btn-outline text-sm"
            disabled={!email}
            onClick={() => onApproval("pricing_exception")}
          >
            Request a pricing exception
          </button>
          <button
            type="button"
            className="btn-outline text-sm"
            disabled={!email}
            onClick={() => onApproval("subscription_override")}
          >
            Request a subscription-term override
          </button>
        </div>
      </section>
    </div>
  );
}

// ── approved template email ─────────────────────────────────────────────────

function ComposeTemplate({
  profileId,
  templates,
  properties,
  initial,
  onClose,
  onSent,
}: {
  profileId: string;
  templates: SupportTemplate[];
  properties: { id: string; address: string }[];
  initial: { template: string; propertyId: string | null; issue: string; nextStep: string };
  onClose: () => void;
  onSent: () => void;
}) {
  const usable = templates.filter(
    (t) => t.approved && t.purpose !== "acknowledgement" && t.purpose !== "resolved",
  );
  const [key, setKey] = useState(initial.template);
  const [propertyId, setPropertyId] = useState(initial.propertyId ?? "");
  const [issue, setIssue] = useState(initial.issue);
  const [nextStep, setNextStep] = useState(initial.nextStep);
  const [busy, setBusy] = useState(false);
  const tpl = usable.find((t) => t.key === key || t.id === key) ?? null;
  const needs = (v: string) =>
    !!tpl && (tpl.body.includes(`{{${v}}}`) || tpl.subject.includes(`{{${v}}}`));
  const preview = tpl
    ? tpl.body
        .replace(/\{\{first_name\}\}/g, "(first name)")
        .replace(/\{\{next_step\}\}/g, nextStep || "(next step)")
        .replace(/\{\{issue\}\}/g, issue || "(what's needed)")
        .replace(
          /\{\{property_address\}\}/g,
          properties.find((p) => p.id === propertyId)?.address ?? "your property",
        )
        .replace(/\{\{link\}\}/g, "(secure link)")
    : "";
  async function send() {
    setBusy(true);
    try {
      await supportAction("send_template", {
        profileId,
        template: key,
        propertyId: propertyId || null,
        issue,
        nextStep,
      });
      toast.success("Sent");
      onSent();
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't send."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Send an approved message"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-background p-5 shadow-xl">
        <h3 className="font-serif text-lg font-semibold">Send an approved message</h3>
        <div className="mt-3 grid gap-3 text-sm">
          <select
            className={sel}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="Template"
          >
            {usable.map((t) => (
              <option key={t.id} value={t.key ?? t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {needs("property_address") && (
            <select
              className={sel}
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              aria-label="Property"
            >
              <option value="">Property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                </option>
              ))}
            </select>
          )}
          {needs("next_step") && (
            <input
              className={sel}
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              placeholder="Next step"
              aria-label="Next step"
            />
          )}
          {needs("issue") && (
            <textarea
              className={`${sel} min-h-[80px]`}
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              placeholder="What's needed"
              aria-label="What's needed"
            />
          )}
          <pre className="whitespace-pre-wrap rounded-md bg-secondary/50 p-3 font-sans text-xs">
            {preview}
          </pre>
          <p className="text-[11px] text-muted-foreground">
            Only Super-Admin-approved templates can be sent. It&apos;s recorded in the
            customer&apos;s timeline.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-accent text-sm"
            disabled={
              busy ||
              !tpl ||
              (needs("property_address") && !propertyId) ||
              (needs("issue") && !issue.trim())
            }
            onClick={send}
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
