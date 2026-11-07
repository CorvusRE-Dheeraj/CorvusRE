import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, Send, ShieldCheck, Sparkles } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import { requestApproval, useLiveRefresh } from "@/lib/staff-records";
import { MarkdownLite } from "@/components/MarkdownLite";
import { TIER_LABEL, type Tier } from "@/lib/billing";
import {
  addFeatureRequest,
  approvedQuote,
  bdAction,
  createProposal,
  dateShort,
  getAccount,
  getOpportunity,
  handoffToSupport,
  isStalled,
  listOpportunities,
  listSupportTeam,
  listTemplates,
  pricingDeviations,
  saveActivity,
  saveOpportunity,
  stageBlocker,
  updateProposal,
  usd0,
  verifyAgreement,
  verifyPayment,
  ACTIVITY_LABEL,
  KIND_LABEL,
  PIPELINE,
  STAGE_LABEL,
  type Activity,
  type Opportunity,
  type Proposal,
  type ProposalPricing,
  type Stage,
  type TeamMember,
  type Template,
} from "@/lib/bd-console";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export function BdPipeline({
  me,
  team,
  isSupervisor,
  openId,
  setOpenId,
  onAccount,
}: {
  me: string;
  team: TeamMember[];
  isSupervisor: boolean;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onAccount: (id: string) => void;
}) {
  const [rows, setRows] = useState<Opportunity[] | null>(null);
  const [owner, setOwner] = useState("");
  const [show, setShow] = useState<"open" | "closed">("open");
  const load = useCallback(
    () =>
      listOpportunities()
        .then(setRows)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load opportunities."))),
    [],
  );
  useEffect(() => void load(), [load]);
  useLiveRefresh(["bd_opportunities"], () => void load(), true);
  const list = useMemo(
    () =>
      (rows ?? []).filter(
        (o) => !owner || (owner === "me" ? o.assignedTo === me : o.assignedTo === owner),
      ),
    [rows, owner, me],
  );
  if (openId)
    return (
      <OpportunityDetail
        key={openId}
        id={openId}
        team={team}
        isSupervisor={isSupervisor}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
        onAccount={onAccount}
      />
    );
  const nameOf = (id: string | null) => team.find((t) => t.id === id)?.name ?? "Unassigned";
  const stages: Stage[] =
    show === "open" ? PIPELINE.filter((s) => s !== "active") : ["active", "on_hold", "lost"];
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={inp}
          value={show}
          onChange={(e) => setShow(e.target.value as "open" | "closed")}
          aria-label="Show"
        >
          <option value="open">Open pipeline</option>
          <option value="closed">Active customers, on hold, lost</option>
        </select>
        <select
          className={inp}
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          aria-label="Assigned to"
        >
          <option value="">Everyone</option>
          <option value="me">Mine</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Values are estimates (forecast) until a customer is active and paying.
        </span>
      </div>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {stages.map((s) => {
          const col = list.filter((o) => o.stage === s);
          return (
            <section key={s} className="w-64 shrink-0 rounded-lg bg-secondary/40 p-2">
              <h3 className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {STAGE_LABEL[s]} <span>{col.length}</span>
              </h3>
              <ul className="mt-2 grid gap-2">
                {col.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(o.id)}
                      className="card-elev w-full p-2.5 text-left text-sm hover:bg-background"
                    >
                      <div className="font-medium">{o.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.accountName} · {KIND_LABEL[o.kind]}
                      </div>
                      <div className="mt-1 text-xs">
                        {usd0(o.potentialValue)} est. · {o.estPropertyCount ?? "?"} properties
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {nameOf(o.assignedTo)}
                        {o.expectedClose && ` · close ${dateShort(o.expectedClose)}`}
                      </div>
                      {o.nextAction && (
                        <div
                          className={`mt-1 text-xs ${o.nextActionAt && o.nextActionAt < new Date().toISOString().slice(0, 10) ? "text-destructive" : ""}`}
                        >
                          Next: {o.nextAction}
                          {o.nextActionAt && ` (${dateShort(o.nextActionAt)})`}
                        </div>
                      )}
                      {isStalled(o) && (
                        <div className="mt-1 text-xs font-semibold text-amber-700">Stalled</div>
                      )}
                      {(s === "on_hold" || s === "lost") && o.stageReason && (
                        <div className="mt-1 text-xs text-muted-foreground">{o.stageReason}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {rows && rows.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          No opportunities yet — create one from an organization or a research finding.
        </p>
      )}
    </div>
  );
}

type Detail = Awaited<ReturnType<typeof getOpportunity>>;

function OpportunityDetail({
  id,
  team,
  isSupervisor,
  onBack,
  onAccount,
}: {
  id: string;
  team: TeamMember[];
  isSupervisor: boolean;
  onBack: () => void;
  onAccount: (id: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [acct, setAcct] = useState<Awaited<ReturnType<typeof getAccount>> | null>(null);
  const [move, setMove] = useState<{ to: Stage; reason: string } | null>(null);
  const [evidence, setEvidence] = useState("");
  const [support, setSupport] = useState<{ id: string; name: string }[]>([]);
  const [receiver, setReceiver] = useState("");
  const [feature, setFeature] = useState("");
  const load = useCallback(async () => {
    const r = await getOpportunity(id);
    setD(r);
    setAcct(await getAccount(r.opportunity.accountId).catch(() => null));
  }, [id]);
  useEffect(() => {
    load().catch((e) => toast.error(getErrorMessage(e, "Couldn't load the opportunity.")));
    listSupportTeam()
      .then(setSupport)
      .catch(() => setSupport([]));
  }, [load]);
  if (!d) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;
  const o = d.opportunity;

  async function patch(p: Parameters<typeof saveOpportunity>[0], ok?: string) {
    try {
      await saveOpportunity({ id, ...p });
      await load();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't save."));
    }
  }
  const blocker = move ? stageBlocker(o, move.to) : null;
  const props = acct?.properties ?? [];
  const tiers = {
    estimated: o.estPropertyCount,
    identified: props.length,
    confirmed: props.filter((p) => p.verified).length,
    registered: acct ? acct.contacts.filter((c) => c.profile_id).length : 0,
    subscribed: props.filter(
      (p) =>
        p.subscription_status && ["active", "trialing", "past_due"].includes(p.subscription_status),
    ).length,
  };
  const quote = o.planTier
    ? approvedQuote(o.planTier, o.estPropertyCount ?? 1, o.billingInterval ?? "month")
    : null;

  return (
    <div className="mt-6 grid gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1 text-sm text-accent"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Pipeline
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold">{o.title}</h2>
          <button
            type="button"
            className="text-sm text-accent underline"
            onClick={() => onAccount(o.accountId)}
          >
            {o.accountName}
          </button>
          <span className="text-sm text-muted-foreground">
            {" "}
            · {KIND_LABEL[o.kind]} · created {dateShort(o.createdAt)}
          </span>
        </div>
        <span className="rounded-full bg-accent/10 px-3 py-1 text-sm font-semibold text-accent">
          {STAGE_LABEL[o.stage]}
        </span>
      </div>
      {isStalled(o) && (
        <p className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" aria-hidden /> Stalled — no stage change or activity
          for over 21 days.
        </p>
      )}

      <section className="card-elev p-5">
        <h3 className="font-semibold">Stage</h3>
        <div className="mt-2 flex flex-wrap gap-1">
          {[...PIPELINE, "on_hold" as Stage, "lost" as Stage].map((s) => (
            <button
              key={s}
              type="button"
              disabled={s === o.stage}
              onClick={() => setMove({ to: s, reason: "" })}
              className={`rounded px-2 py-1 text-xs ${s === o.stage ? "bg-accent text-accent-foreground" : "bg-secondary hover:bg-secondary/70"}`}
            >
              {STAGE_LABEL[s]}
            </button>
          ))}
        </div>
        {move && (
          <div className="mt-3 grid gap-2 rounded-md border border-border p-3 text-sm">
            <div>
              Move to <span className="font-semibold">{STAGE_LABEL[move.to]}</span>
            </div>
            {blocker && <p className="text-destructive">{blocker}</p>}
            {(move.to === "on_hold" || move.to === "lost") && (
              <input
                className={inp}
                placeholder="Reason (required)"
                value={move.reason}
                onChange={(e) => setMove({ ...move, reason: e.target.value })}
                aria-label="Reason"
              />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-accent text-xs"
                disabled={
                  !!blocker ||
                  ((move.to === "on_hold" || move.to === "lost") && move.reason.trim().length < 3)
                }
                onClick={() =>
                  void patch(
                    { stage: move.to, stage_reason: move.reason.trim() || null },
                    "Stage updated",
                  ).then(() => setMove(null))
                }
              >
                Move
              </button>
              <button type="button" className="btn-outline text-xs" onClick={() => setMove(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md bg-secondary/40 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Agreement
            </div>
            {o.agreementVerifiedAt ? (
              <p className="mt-1 text-success">
                Verified {dateShort(o.agreementVerifiedAt)} — {o.agreementEvidence}
              </p>
            ) : (
              <>
                <p className="mt-1 text-muted-foreground">
                  Verified from a signed proposal
                  {isSupervisor ? ", or confirm a signed copy you've seen" : ""}.
                </p>
                {isSupervisor && (
                  <input
                    className={`${inp} mt-2 w-full`}
                    placeholder="Signed copy you've seen (what and where)"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    aria-label="Agreement evidence"
                  />
                )}
                <button
                  type="button"
                  className="btn-outline mt-2 text-xs"
                  onClick={() =>
                    verifyAgreement(id, evidence || undefined)
                      .then((r) => (toast.success(`Agreement verified — ${r}`), load()))
                      .catch((e) => toast.error(getErrorMessage(e, "Couldn't verify.")))
                  }
                >
                  Verify agreement
                </button>
              </>
            )}
          </div>
          <div className="rounded-md bg-secondary/40 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Payment
            </div>
            {o.paymentVerifiedAt ? (
              <p className="mt-1 text-success">
                Verified {dateShort(o.paymentVerifiedAt)} — {o.paymentEvidence}
              </p>
            ) : (
              <>
                <p className="mt-1 text-muted-foreground">
                  Verified from a paid subscription on the customer&apos;s own account.
                </p>
                <button
                  type="button"
                  className="btn-outline mt-2 text-xs"
                  onClick={() =>
                    verifyPayment(id)
                      .then((r) => (toast.success(`Payment verified — ${r}`), load()))
                      .catch((e) => toast.error(getErrorMessage(e, "Couldn't verify.")))
                  }
                >
                  Check payment
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="card-elev grid gap-3 p-5 text-sm md:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Assigned to</span>
          <select
            className={inp}
            value={o.assignedTo ?? ""}
            onChange={(e) => void patch({ assigned_to: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Estimated properties</span>
          <input
            className={inp}
            type="number"
            defaultValue={o.estPropertyCount ?? ""}
            onBlur={(e) =>
              void patch({ est_property_count: e.target.value ? Number(e.target.value) : null })
            }
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Potential annual value (estimate)</span>
          <input
            className={inp}
            type="number"
            defaultValue={o.potentialValue ?? ""}
            onBlur={(e) =>
              void patch({ potential_value: e.target.value ? Number(e.target.value) : null })
            }
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Expected close</span>
          <input
            className={inp}
            type="date"
            defaultValue={o.expectedClose ?? ""}
            onBlur={(e) => void patch({ expected_close: e.target.value || null })}
          />
        </label>
        <label className="grid gap-1 md:col-span-2">
          <span className="text-xs text-muted-foreground">Next action</span>
          <div className="flex gap-2">
            <input
              className={`${inp} flex-1`}
              defaultValue={o.nextAction ?? ""}
              onBlur={(e) => void patch({ next_action: e.target.value || null })}
              aria-label="Next action"
            />
            <input
              className={inp}
              type="date"
              defaultValue={o.nextActionAt ?? ""}
              onBlur={(e) => void patch({ next_action_at: e.target.value || null })}
              aria-label="Next action date"
            />
          </div>
        </label>
      </section>

      <section className="card-elev p-5 text-sm">
        <h3 className="font-semibold">Portfolio</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
          {(
            [
              ["Estimated", tiers.estimated ?? "—", "the prospect's own estimate"],
              ["Identified", tiers.identified, "properties found in the CRM"],
              ["Confirmed", tiers.confirmed, "matched to the county record"],
              ["Registered contacts", tiers.registered, "with a CorvusPT account"],
              ["Subscribed", tiers.subscribed, "paid subscriptions"],
            ] as const
          ).map(([l, v, h]) => (
            <div key={l} className="rounded-md bg-secondary/40 p-2">
              <div className="text-[11px] text-muted-foreground">{l}</div>
              <div className="text-lg font-semibold">{v}</div>
              <div className="text-[10px] text-muted-foreground">{h}</div>
            </div>
          ))}
        </div>
        {acct && (
          <p className="mt-2 text-xs text-muted-foreground">
            Counties:{" "}
            {[...new Set(props.map((p) => p.county ?? p.cad).filter(Boolean))].join(", ") ||
              acct.account.counties.join(", ") ||
              "—"}{" "}
            · Owner entities:{" "}
            {[...new Set(props.map((p) => p.owner_name).filter(Boolean))].slice(0, 5).join(", ") ||
              "—"}{" "}
            · Decision-makers:{" "}
            {acct.contacts
              .filter((c) => c.decision_maker)
              .map((c) => c.full_name)
              .join(", ") || "none recorded"}
          </p>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Approved plan</span>
            <select
              className={inp}
              value={o.planTier ?? ""}
              onChange={(e) => void patch({ plan_tier: (e.target.value || null) as Tier | null })}
            >
              <option value="">Choose…</option>
              {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Billing</span>
            <select
              className={inp}
              value={o.billingInterval ?? "month"}
              onChange={(e) => void patch({ billing_interval: e.target.value as "month" | "year" })}
            >
              <option value="month">Monthly (12-month commitment)</option>
              <option value="year">Yearly upfront (50% off year 1)</option>
            </select>
          </label>
          {quote && (
            <div className="rounded-md bg-accent/5 p-2 text-xs">
              <div className="font-semibold">Estimated subscription value</div>
              {quote.properties} × {quote.plan}: ${quote.first}/mo first, ${quote.additional}/mo
              each additional
              <div>
                = ${quote.monthly.toLocaleString("en-US")}/mo ·{" "}
                {usd0(o.billingInterval === "year" ? quote.firstYear : quote.annual)} first year
              </div>
            </div>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!o.requirements.multipleUsers}
              onChange={(e) =>
                void patch({ requirements: { ...o.requirements, multipleUsers: e.target.checked } })
              }
            />
            Needs multiple users
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!o.requirements.centralizedBilling}
              onChange={(e) =>
                void patch({
                  requirements: { ...o.requirements, centralizedBilling: e.target.checked },
                })
              }
            />
            Needs centralized billing
          </label>
          <input
            className={inp}
            placeholder="Other requirements"
            defaultValue={o.requirements.notes ?? ""}
            onBlur={(e) =>
              void patch({ requirements: { ...o.requirements, notes: e.target.value } })
            }
            aria-label="Other requirements"
          />
        </div>
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Feature requests (recorded, not promised)
          </div>
          <ul className="mt-1 text-sm">
            {d.featureRequests.map((r) => (
              <li key={r.id}>
                • {r.feature} <span className="text-xs text-muted-foreground">({r.status})</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex gap-2">
            <input
              className={`${inp} flex-1`}
              placeholder="Something they asked for that CorvusPT doesn't do"
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              aria-label="Feature request"
            />
            <button
              type="button"
              className="btn-outline text-xs"
              disabled={feature.trim().length < 3}
              onClick={() =>
                addFeatureRequest({
                  opportunity_id: id,
                  account_id: o.accountId,
                  feature: feature.trim(),
                })
                  .then(() => (setFeature(""), load()))
                  .catch((e) => toast.error(getErrorMessage(e, "Couldn't record it.")))
              }
            >
              Record request
            </button>
          </div>
        </div>
      </section>

      <Proposals
        opportunity={o}
        proposals={d.proposals}
        contacts={acct?.contacts ?? []}
        reload={load}
      />

      <Followups
        opportunity={o}
        activities={d.activities}
        contacts={acct?.contacts ?? []}
        team={team}
        reload={load}
      />

      <section className="card-elev p-5 text-sm">
        <h3 className="font-semibold">Handoff to Customer Support</h3>
        {d.handoff ? (
          <p className="mt-1">
            Handed off {dateShort(d.handoff.created_at)} · status{" "}
            <span className="font-medium">{d.handoff.status}</span>
            {d.handoff.accepted_at && ` · accepted ${dateShort(d.handoff.accepted_at)}`}
            {d.handoff.done_at && ` · onboarding complete ${dateShort(d.handoff.done_at)}`}
            {d.handoff.assigned_to &&
              ` · ${support.find((s) => s.id === d.handoff!.assigned_to)?.name ?? "Support owner"}`}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            Once the agreement is verified, hand the customer to Support with their contacts,
            agreement, plan, requirements and what&apos;s still outstanding. You keep the
            relationship; Support runs onboarding. Protest documents stay with Support and
            Operations.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            className={inp}
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            aria-label="Receiving support owner"
          >
            <option value="">Receiving support owner…</option>
            {support.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-accent text-xs"
            disabled={!o.agreementVerifiedAt}
            title={o.agreementVerifiedAt ? undefined : "Verify the agreement first"}
            onClick={() =>
              handoffToSupport(id, receiver || null)
                .then(() => (toast.success("Handed off to Customer Support"), load()))
                .catch((e) => toast.error(getErrorMessage(e, "Couldn't hand off.")))
            }
          >
            {d.handoff ? "Update handoff" : "Hand off to Support"}
          </button>
        </div>
      </section>
    </div>
  );
}

// ── proposals ───────────────────────────────────────────────────────────────

const PROPOSAL_STATUS: Record<Proposal["status"], string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved to send",
  sent: "Sent",
  superseded: "Superseded",
  accepted: "Accepted",
  signed: "Signed",
  declined: "Declined",
};

function Proposals({
  opportunity: o,
  proposals,
  contacts,
  reload,
}: {
  opportunity: Opportunity;
  proposals: Proposal[];
  contacts: {
    id: string;
    full_name: string | null;
    email: string | null;
    decision_maker: boolean;
  }[];
  reload: () => Promise<void>;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [pricing, setPricing] = useState<ProposalPricing>({
    tier: o.planTier ?? "owner_managed",
    interval: o.billingInterval ?? "month",
    properties: o.estPropertyCount ?? 1,
    discountPct: 0,
    commitmentMonths: null,
    customTerms: "",
  });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; title: string; body: string } | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [why, setWhy] = useState("");
  useEffect(() => {
    listTemplates()
      .then((t) => {
        const ok = t.filter((x) => x.approved);
        setTemplates(ok);
        setTemplateId(ok.find((x) => x.kind === o.kind)?.id ?? ok[0]?.id ?? "");
      })
      .catch(() => setTemplates([]));
  }, [o.kind]);
  const current = proposals.find((p) => p.status !== "superseded") ?? null;
  const devs = pricingDeviations(pricing);

  async function draft() {
    setBusy("draft");
    try {
      const r = await bdAction<{ title: string; body: string; pricing: ProposalPricing }>(
        "ai_proposal",
        { opportunityId: o.id, templateId, pricing, notes },
      );
      const id = await createProposal({
        opportunity_id: o.id,
        template_id: templateId,
        title: r.title,
        body: r.body,
        pricing: { ...pricing, ...r.pricing },
      });
      await bdAction("check_proposal", { proposalId: id }).catch(() => undefined);
      await reload();
      toast.success("Draft ready — review it before sending");
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't draft the proposal."));
    } finally {
      setBusy(null);
    }
  }
  async function check(id: string) {
    setBusy("check");
    try {
      const r = await bdAction<{ deviations: unknown[] }>("check_proposal", { proposalId: id });
      await reload();
      toast.success(
        r.deviations.length
          ? `${r.deviations.length} departure(s) from the approved terms`
          : "Matches the approved terms",
      );
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't check the proposal."));
    } finally {
      setBusy(null);
    }
  }
  async function send(p: Proposal) {
    setBusy("send");
    try {
      const r = await bdAction<{ overlap: string[] }>("send_proposal", {
        proposalId: p.id,
        leadId: sendTo || o.primaryLeadId,
      });
      await reload();
      toast.success("Proposal sent");
      if (r.overlap?.length)
        toast.message("Heads-up: Marketing is also in touch", {
          description: r.overlap.join(" · "),
        });
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't send."));
    } finally {
      setBusy(null);
    }
  }
  async function askApproval(p: Proposal) {
    setBusy("approval");
    try {
      const r = await requestApproval({
        kind: "proposal_exception",
        payload: { proposal_id: p.id },
        reason: why,
      });
      await reload();
      toast.success(r.status === "executed" ? "Approved" : "Sent to the Super Admin for approval");
      setWhy("");
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't request approval."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card-elev p-5 text-sm">
      <h3 className="font-semibold">Proposals</h3>
      <div className="mt-3 grid gap-2 rounded-md border border-border p-3 md:grid-cols-3">
        <select
          className={inp}
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          aria-label="Template"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className={inp}
          value={pricing.tier}
          onChange={(e) => setPricing({ ...pricing, tier: e.target.value as Tier })}
          aria-label="Plan"
        >
          {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          className={inp}
          value={pricing.interval}
          onChange={(e) => setPricing({ ...pricing, interval: e.target.value as "month" | "year" })}
          aria-label="Billing"
        >
          <option value="month">Monthly</option>
          <option value="year">Yearly upfront</option>
        </select>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Properties</span>
          <input
            className={inp}
            type="number"
            min={1}
            value={pricing.properties}
            onChange={(e) => setPricing({ ...pricing, properties: Number(e.target.value) || 1 })}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Extra discount % (needs approval)</span>
          <input
            className={inp}
            type="number"
            min={0}
            max={100}
            value={pricing.discountPct}
            onChange={(e) => setPricing({ ...pricing, discountPct: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">
            Commitment months (blank = standard)
          </span>
          <input
            className={inp}
            type="number"
            value={pricing.commitmentMonths ?? ""}
            onChange={(e) =>
              setPricing({
                ...pricing,
                commitmentMonths: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        <input
          className={`${inp} md:col-span-3`}
          placeholder="Custom terms or commitments (needs approval)"
          value={pricing.customTerms}
          onChange={(e) => setPricing({ ...pricing, customTerms: e.target.value })}
          aria-label="Custom terms"
        />
        <input
          className={`${inp} md:col-span-3`}
          placeholder="Notes for the AI draft (what matters to this prospect)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Notes"
        />
        {devs.length > 0 && (
          <p className="text-xs text-amber-800 md:col-span-3">
            Needs Super Admin approval before sending: {devs.map((x) => x.detail).join("; ")}
          </p>
        )}
        <button
          type="button"
          className="btn-accent inline-flex w-fit items-center gap-1.5 text-xs"
          disabled={!templateId || busy === "draft"}
          onClick={draft}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />{" "}
          {busy === "draft"
            ? "Drafting…"
            : current
              ? "Draft a new version with AI"
              : "Draft with AI"}
        </button>
      </div>

      {proposals.length > 0 && (
        <ul className="mt-4 grid gap-3">
          {proposals.map((p) => (
            <li
              key={p.id}
              className={`rounded-md border p-3 ${p.status === "superseded" ? "border-border/50 opacity-70" : "border-border"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  v{p.version} — {p.title}
                </span>
                <span className="text-xs">
                  {PROPOSAL_STATUS[p.status]}
                  {p.sent_at && ` · sent ${dateShort(p.sent_at)} to ${p.sent_to}`}
                  {p.viewed_at && ` · viewed ${dateShort(p.viewed_at)}`}
                  {p.signed_at && ` · signed by ${p.signer_name} ${dateShort(p.signed_at)}`}
                  {p.approved_at && ` · approved ${dateShort(p.approved_at)}`}
                </span>
              </div>
              {p.deviations.length > 0 && (
                <ul className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                  {p.deviations.map((x, i) => (
                    <li key={i}>
                      ⚠ {x.detail}
                      {x.ai && " (AI)"}
                    </li>
                  ))}
                </ul>
              )}
              {p.status !== "superseded" && (
                <>
                  {edit?.id === p.id ? (
                    <div className="mt-2 grid gap-2">
                      <input
                        className={inp}
                        value={edit.title}
                        onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                        aria-label="Proposal title"
                      />
                      <textarea
                        className={`${inp} min-h-[260px] font-mono text-xs`}
                        value={edit.body}
                        onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                        aria-label="Proposal text"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-accent text-xs"
                          onClick={() =>
                            updateProposal(p.id, { title: edit.title, body: edit.body })
                              .then(() => check(p.id))
                              .then(() => setEdit(null))
                              .catch((e) => toast.error(getErrorMessage(e, "Couldn't save.")))
                          }
                        >
                          Save &amp; check
                        </button>
                        <button
                          type="button"
                          className="btn-outline text-xs"
                          onClick={() => setEdit(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-accent">Read</summary>
                      <div className="prose prose-sm mt-2 max-w-none">
                        <MarkdownLite text={p.body} />
                      </div>
                    </details>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {["draft", "approved"].includes(p.status) && (
                      <button
                        type="button"
                        className="btn-outline text-xs"
                        onClick={() => setEdit({ id: p.id, title: p.title, body: p.body })}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-outline text-xs"
                      disabled={busy === "check"}
                      onClick={() => void check(p.id)}
                    >
                      Check against approved terms
                    </button>
                    {p.status === "draft" && p.deviations.length > 0 && (
                      <>
                        <input
                          className={`${inp} text-xs`}
                          placeholder="Why this exception is needed"
                          value={why}
                          onChange={(e) => setWhy(e.target.value)}
                          aria-label="Reason for exception"
                        />
                        <button
                          type="button"
                          className="btn-outline text-xs"
                          disabled={why.trim().length < 5 || busy === "approval"}
                          onClick={() => void askApproval(p)}
                        >
                          Request approval
                        </button>
                      </>
                    )}
                    {(p.status === "approved" ||
                      (p.status === "draft" && p.deviations.length === 0)) && (
                      <>
                        <select
                          className={`${inp} text-xs`}
                          value={sendTo}
                          onChange={(e) => setSendTo(e.target.value)}
                          aria-label="Send to"
                        >
                          <option value="">
                            {contacts.find((c) => c.id === o.primaryLeadId)?.full_name ??
                              "Main contact"}
                          </option>
                          {contacts
                            .filter((c) => c.email)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.full_name ?? c.email}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className="btn-accent inline-flex items-center gap-1 text-xs"
                          disabled={busy === "send"}
                          onClick={() => void send(p)}
                        >
                          <Send className="h-3.5 w-3.5" aria-hidden /> Send
                        </button>
                      </>
                    )}
                    {p.status === "sent" && (
                      <span className="text-xs text-muted-foreground">
                        The prospect reads, signs or declines it from the link in their email.
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── follow-ups on this opportunity ──────────────────────────────────────────

function Followups({
  opportunity: o,
  activities,
  contacts,
  team,
  reload,
}: {
  opportunity: Opportunity;
  activities: Activity[];
  contacts: { id: string; full_name: string | null; email: string | null }[];
  team: TeamMember[];
  reload: () => Promise<void>;
}) {
  const [f, setF] = useState<{
    kind: Activity["kind"];
    subject: string;
    due: string;
    owner: string;
    priority: Activity["priority"];
    lead: string;
  } | null>(null);
  const [done, setDone] = useState<{ id: string; outcome: string; notes: string } | null>(null);
  const [msg, setMsg] = useState<{
    lead: string;
    purpose: string;
    subject: string;
    body: string;
    blocked: string | null;
    overlap: string[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function draftMsg() {
    if (!msg) return;
    setBusy("draft");
    try {
      const r = await bdAction<{
        subject: string;
        body: string;
        blocked: string | null;
        overlap: string[];
      }>("ai_message", { opportunityId: o.id, leadId: msg.lead, purpose: msg.purpose });
      setMsg({ ...msg, ...r });
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't draft."));
    } finally {
      setBusy(null);
    }
  }
  async function sendMsg(confirmOverlap = false) {
    if (!msg) return;
    setBusy("send");
    try {
      const r = await bdAction<{ ok: boolean; needsConfirm?: boolean; overlap?: string[] }>(
        "send_message",
        {
          leadId: msg.lead,
          subject: msg.subject,
          body: msg.body,
          opportunityId: o.id,
          confirmOverlap,
        },
      );
      if (r.needsConfirm) {
        setMsg({ ...msg, overlap: r.overlap ?? [] });
        toast.message("Marketing is in touch with this contact — confirm to send anyway");
      } else {
        toast.success("Sent and logged");
        setMsg(null);
        await reload();
      }
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't send."));
    } finally {
      setBusy(null);
    }
  }
  async function complete() {
    if (!done) return;
    setBusy("done");
    try {
      let summary: string | null = null;
      if (done.notes.trim().length >= 10) {
        const r = await bdAction<{
          summary?: string;
          nextSteps?: { action: string; due: string | null }[];
          featureRequests?: string[];
        }>("ai_summarize", {
          activityId: done.id,
          notes: done.notes,
        }).catch(() => null);
        summary = r?.summary ?? null;
        if (r?.nextSteps?.length)
          toast.message("Suggested next steps", {
            description: r.nextSteps.map((s) => s.action).join(" · "),
          });
        for (const fr of r?.featureRequests ?? [])
          await addFeatureRequest({
            opportunity_id: o.id,
            account_id: o.accountId,
            feature: fr,
          }).catch(() => undefined);
      }
      await saveActivity({
        id: done.id,
        status: "done",
        outcome: done.outcome || null,
        notes: done.notes || null,
        ...(summary ? { ai_summary: summary } : {}),
      });
      setDone(null);
      await reload();
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't save."));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card-elev p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Follow-ups &amp; communication</h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() =>
              setMsg({
                lead: o.primaryLeadId ?? contacts[0]?.id ?? "",
                purpose: "follow up",
                subject: "",
                body: "",
                blocked: null,
                overlap: [],
              })
            }
          >
            Write a message
          </button>
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() =>
              setF({
                kind: "call",
                subject: "",
                due: "",
                owner: o.assignedTo ?? "",
                priority: "normal",
                lead: o.primaryLeadId ?? "",
              })
            }
          >
            Schedule
          </button>
        </div>
      </div>
      {f && (
        <div className="mt-3 grid gap-2 rounded-md border border-border p-3 md:grid-cols-3">
          <select
            className={inp}
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value as Activity["kind"] })}
            aria-label="Kind"
          >
            {(Object.keys(ACTIVITY_LABEL) as Activity["kind"][])
              .filter((k) => k !== "email" && k !== "note")
              .map((k) => (
                <option key={k} value={k}>
                  {ACTIVITY_LABEL[k]}
                </option>
              ))}
          </select>
          <input
            className={`${inp} md:col-span-2`}
            placeholder="Subject"
            value={f.subject}
            onChange={(e) => setF({ ...f, subject: e.target.value })}
            aria-label="Subject"
          />
          <input
            className={inp}
            type="datetime-local"
            value={f.due}
            onChange={(e) => setF({ ...f, due: e.target.value })}
            aria-label="When"
          />
          <select
            className={inp}
            value={f.owner}
            onChange={(e) => setF({ ...f, owner: e.target.value })}
            aria-label="Owner"
          >
            <option value="">Me</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            className={inp}
            value={f.priority}
            onChange={(e) => setF({ ...f, priority: e.target.value as Activity["priority"] })}
            aria-label="Priority"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <select
            className={inp}
            value={f.lead}
            onChange={(e) => setF({ ...f, lead: e.target.value })}
            aria-label="With"
          >
            <option value="">With…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name ?? c.email}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-accent text-xs"
              disabled={f.subject.trim().length < 3 || !f.due}
              onClick={() =>
                saveActivity({
                  opportunity_id: o.id,
                  account_id: o.accountId,
                  kind: f.kind,
                  subject: f.subject.trim(),
                  due_at: new Date(f.due).toISOString(),
                  owner: f.owner || null,
                  priority: f.priority,
                  lead_id: f.lead || null,
                })
                  .then(() => (setF(null), reload()))
                  .catch((e) => toast.error(getErrorMessage(e, "Couldn't schedule.")))
              }
            >
              Save
            </button>
            <button type="button" className="btn-outline text-xs" onClick={() => setF(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && (
        <div className="mt-3 grid gap-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap gap-2">
            <select
              className={inp}
              value={msg.lead}
              onChange={(e) => setMsg({ ...msg, lead: e.target.value })}
              aria-label="To"
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name ?? c.email}
                </option>
              ))}
            </select>
            <input
              className={`${inp} flex-1`}
              placeholder="Purpose (e.g. confirm meeting, proposal reminder)"
              value={msg.purpose}
              onChange={(e) => setMsg({ ...msg, purpose: e.target.value })}
              aria-label="Purpose"
            />
            <button
              type="button"
              className="btn-outline inline-flex items-center gap-1 text-xs"
              disabled={busy === "draft" || !msg.lead}
              onClick={draftMsg}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Draft with AI
            </button>
          </div>
          {msg.blocked && (
            <p className="text-xs text-destructive">Can&apos;t email this contact: {msg.blocked}</p>
          )}
          {msg.overlap.length > 0 && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
              Marketing overlap: {msg.overlap.join(" · ")}
            </p>
          )}
          <input
            className={inp}
            placeholder="Subject"
            value={msg.subject}
            onChange={(e) => setMsg({ ...msg, subject: e.target.value })}
            aria-label="Subject"
          />
          <textarea
            className={`${inp} min-h-[140px]`}
            value={msg.body}
            onChange={(e) => setMsg({ ...msg, body: e.target.value })}
            aria-label="Message"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-accent text-xs"
              disabled={
                !!msg.blocked ||
                !msg.subject.trim() ||
                msg.body.trim().length < 5 ||
                busy === "send"
              }
              onClick={() => void sendMsg(msg.overlap.length > 0)}
            >
              {msg.overlap.length > 0 ? "Send anyway" : "Send"}
            </button>
            <button type="button" className="btn-outline text-xs" onClick={() => setMsg(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ul className="mt-3 grid gap-2">
        {activities.map((a) => (
          <li key={a.id} className="rounded-md bg-secondary/30 p-2">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase">
                  {ACTIVITY_LABEL[a.kind]}
                </span>
                {a.subject}
              </span>
              <span
                className={`text-xs ${a.status === "planned" && a.due_at && a.due_at < new Date().toISOString() ? "text-destructive" : "text-muted-foreground"}`}
              >
                {a.status} ·{" "}
                {a.due_at
                  ? new Date(a.due_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—"}{" "}
                · {team.find((t) => t.id === a.owner)?.name ?? "—"} · {a.priority}
              </span>
            </div>
            {a.outcome && <div className="text-xs">Outcome: {a.outcome}</div>}
            {a.ai_summary && (
              <div className="text-xs text-muted-foreground">Summary: {a.ai_summary}</div>
            )}
            {a.status === "planned" &&
              (done?.id === a.id ? (
                <div className="mt-2 grid gap-2">
                  <input
                    className={inp}
                    placeholder="Outcome"
                    value={done.outcome}
                    onChange={(e) => setDone({ ...done, outcome: e.target.value })}
                    aria-label="Outcome"
                  />
                  <textarea
                    className={`${inp} min-h-[80px]`}
                    placeholder="Notes — AI summarizes them and suggests next steps"
                    value={done.notes}
                    onChange={(e) => setDone({ ...done, notes: e.target.value })}
                    aria-label="Notes"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-accent text-xs"
                      disabled={busy === "done"}
                      onClick={complete}
                    >
                      Mark done
                    </button>
                    <button
                      type="button"
                      className="btn-outline text-xs"
                      onClick={() => setDone(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-accent underline"
                    onClick={() => setDone({ id: a.id, outcome: "", notes: "" })}
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline"
                    onClick={() => void saveActivity({ id: a.id, status: "missed" }).then(reload)}
                  >
                    Missed
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline"
                    onClick={() => void saveActivity({ id: a.id, status: "canceled" }).then(reload)}
                  >
                    Cancel
                  </button>
                </div>
              ))}
          </li>
        ))}
        {activities.length === 0 && <li className="text-muted-foreground">Nothing scheduled.</li>}
      </ul>
    </section>
  );
}
