import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MarkdownLite } from "@/components/MarkdownLite";
import { AdminSupportEscalations } from "@/components/AdminSupportEscalations";
import { askAboutDocument } from "@/lib/document-ai";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/error-message";
import { supabase } from "@/lib/supabase";
import {
  HandoffInbox,
  OwnerHandoff,
  RecordHistory,
  RequestApprovalButton,
  type StaffContext,
} from "@/components/staff/StaffRecords";
import { useStaffContext } from "@/hooks/use-staff-context";
import { useLiveRefresh } from "@/lib/staff-records";
import {
  getStaffRole,
  money,
  relDays,
  toHandoff,
  type Handoff,
  type StaffRole,
} from "@/lib/marketing";

// Customer Support workspace: every lead that became a paying customer is
// handed over here with an AI summary of their properties, subscription,
// past conversations and onboarding to-dos. Support takes it from here
// (subscription help, property onboarding, protest support); Marketing keeps
// its history. Support Admins and Super Admins only.
export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [{ title: "Customer Support — CorvusPT" }, { name: "robots", content: "noindex" }],
  }),
  component: SupportPage,
});

type Details = {
  handoff_id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  subscribed_at: string | null;
  history: { at: string; kind: string; summary: string; body: string | null }[];
};

function SupportPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [handoffs, setHandoffs] = useState<Handoff[] | null>(null);
  const [details, setDetails] = useState<Map<string, Details>>(new Map());
  const [tab, setTab] = useState<"open" | "mine" | "done" | "escalations">("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const staffCtx = useStaffContext();

  useEffect(() => {
    if (loading) return;
    if (!user) return void nav({ to: "/admin-login" });
    getStaffRole(user.id)
      .then((r) => (r.isSupportAdmin || r.isSuperAdmin ? setRole(r) : nav({ to: "/admin-login" })))
      .catch(() => nav({ to: "/admin-login" }));
  }, [loading, user, nav]);

  const load = useCallback(async () => {
    const [h, d] = await Promise.all([
      supabase.from("support_handoffs").select("*").order("created_at", { ascending: false }),
      supabase.rpc("support_handoff_details"),
    ]);
    if (h.error) throw h.error;
    setHandoffs((h.data ?? []).map(toHandoff));
    setDetails(new Map(((d.data ?? []) as Details[]).map((x) => [x.handoff_id, x])));
  }, []);
  useEffect(() => {
    if (role) load().catch((e) => toast.error(getErrorMessage(e, "Couldn't load the queue.")));
  }, [role, load]);
  // a handoff from Marketing or a ticket moved by a colleague appears live
  useLiveRefresh(
    ["support_handoffs", "record_transfers"],
    () => void load().catch(() => undefined),
    !!role,
  );

  const list = useMemo(
    () =>
      (handoffs ?? []).filter((h) =>
        tab === "open"
          ? h.status === "open"
          : tab === "mine"
            ? h.status !== "done" && h.assignedTo === user?.id
            : h.status === "done",
      ),
    [handoffs, tab, user],
  );
  if (!role) return null;
  const open = handoffs?.find((h) => h.id === openId) ?? null;
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-soft">Customer Support Admin</span>
        {role.isSuperAdmin && (
          <span className="text-xs text-muted-foreground">Viewing with Super Admin access</span>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Customer Support</h1>
          <p className="text-sm text-muted-foreground">
            New paying customers handed over from Marketing — onboard them and own their
            subscription and protest support.
          </p>
        </div>
        <RequestApprovalButton ctx={staffCtx} />
      </div>
      <HandoffInbox ctx={staffCtx} department="support" />
      <div
        className="mt-5 inline-flex rounded-md border border-border p-0.5 text-sm"
        role="tablist"
      >
        {(
          [
            ["open", `New (${(handoffs ?? []).filter((h) => h.status === "open").length})`],
            [
              "mine",
              `Mine (${(handoffs ?? []).filter((h) => h.status !== "done" && h.assignedTo === user?.id).length})`,
            ],
            ["done", "Onboarded"],
            ["escalations", "Escalations"],
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
      {tab === "escalations" ? (
        <div className="mt-4">
          <AdminSupportEscalations />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul className="grid content-start gap-2">
            {handoffs === null && <li className="text-sm text-muted-foreground">Loading…</li>}
            {handoffs && list.length === 0 && (
              <li className="card-elev p-4 text-sm text-muted-foreground">Nothing here.</li>
            )}
            {list.map((h) => {
              const d = details.get(h.id);
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(h.id)}
                    className={`card-elev w-full p-3 text-left hover:bg-secondary/40 ${openId === h.id ? "ring-2 ring-accent" : ""}`}
                  >
                    <div className="font-medium">
                      {d?.company || d?.name || d?.email || "Customer"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Subscribed {relDays(d?.subscribed_at ?? h.createdAt)} ·{" "}
                      {h.snapshot.properties?.length ?? 0} propert
                      {(h.snapshot.properties?.length ?? 0) === 1 ? "y" : "ies"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {h.assignedTo ? `Owner: ${staffCtx.nameOf(h.assignedTo)}` : "Needs an owner"}
                      {h.status === "open" ? " · not accepted yet" : ""}
                    </div>
                    {!!h.snapshot.needs?.length && (
                      <div className="mt-1 text-xs text-amber-800">
                        {h.snapshot.needs.length} onboarding item
                        {h.snapshot.needs.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {open ? (
            <HandoffDetail
              h={open}
              d={details.get(open.id)}
              me={user!.id}
              reload={load}
              ctx={staffCtx}
            />
          ) : (
            <p className="card-elev p-6 text-sm text-muted-foreground">
              Pick a customer to see their handoff.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HandoffDetail({
  h,
  d,
  me,
  reload,
  ctx,
}: {
  h: Handoff;
  d: Details | undefined;
  me: string;
  reload: () => Promise<void>;
  ctx: StaffContext;
}) {
  const [notes, setNotes] = useState(h.notes ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setNotes(h.notes ?? ""), [h.id, h.notes]);
  const update = async (label: string, patch: Record<string, unknown>, ok: string) => {
    setBusy(label);
    try {
      const { error } = await supabase.from("support_handoffs").update(patch).eq("id", h.id);
      if (error) throw error;
      await reload();
      toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't save."));
    } finally {
      setBusy(null);
    }
  };
  async function summarize() {
    setBusy("ai");
    try {
      const { answer } = await askAboutDocument({
        question:
          "Write a short handoff note in markdown for Customer Support about this new paying CorvusPT customer: **Customer**, **Properties & subscription**, **What happened before they subscribed** (key conversations, concerns, promises), **Onboarding to do**. Use only the facts; don't promise savings.",
        context: JSON.stringify({
          customer: {
            name: d?.name,
            company: d?.company,
            email: d?.email,
            phone: d?.phone,
            subscribedAt: d?.subscribed_at,
          },
          snapshot: h.snapshot,
          history: d?.history,
        }),
      });
      await update(
        "ai",
        { summary: answer, summary_at: new Date().toISOString() },
        "Summary ready.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't summarise this customer."));
      setBusy(null);
    }
  }
  const s = h.snapshot;
  return (
    <section className="card-elev grid content-start gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold">
            {d?.company || d?.name || "Customer"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[d?.company && d?.name, d?.email, d?.phone].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">
            Handed over {relDays(h.createdAt)}
            {h.status === "open" && h.assignedTo && h.assignedTo !== me
              ? ` · waiting for ${ctx.nameOf(h.assignedTo)} to accept`
              : ""}
            {h.status === "accepted" && ` · being onboarded${h.assignedTo === me ? " by you" : ""}`}
            {h.status === "done" && ` · onboarded ${relDays(h.doneAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {h.status === "open" && (!h.assignedTo || h.assignedTo === me) && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void update(
                  "accept",
                  { status: "accepted", assigned_to: me, accepted_at: new Date().toISOString() },
                  "Accepted — it's yours.",
                )
              }
              className="btn-primary btn-primary-hover text-sm"
            >
              Accept handoff
            </button>
          )}
          {h.status === "accepted" && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void update(
                  "done",
                  { status: "done", done_at: new Date().toISOString() },
                  "Marked onboarded.",
                )
              }
              className="btn-primary btn-primary-hover text-sm"
            >
              Onboarding done
            </button>
          )}
          {h.status === "done" && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void update("reopen", { status: "accepted", done_at: null }, "Reopened.")
              }
              className="btn-outline text-sm"
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <OwnerHandoff
          ctx={ctx}
          entityType="onboarding"
          entityId={h.id}
          ownerId={h.assignedTo}
          label={d?.company || d?.name || d?.email || "Customer"}
          onChanged={() => void reload()}
        />
        <RequestApprovalButton
          ctx={ctx}
          kind="refund"
          email={d?.email}
          label="Refund / discount / agreement…"
          className="btn-outline inline-flex items-center gap-1.5 py-1 text-xs"
        />
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Handoff summary
          </h3>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void summarize()}
            className="text-xs text-accent hover:underline"
          >
            {busy === "ai" ? "Writing…" : h.summary ? "Refresh" : "Summarise now"}
          </button>
        </div>
        {h.summary ? (
          <>
            <MarkdownLite text={h.summary} className="mt-2 text-sm" />
            <p className="text-[11px] text-muted-foreground">Corvus AI · {relDays(h.summaryAt)}</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Corvus AI writes this within the hour — or press Summarise now.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">Onboarding to do</h3>
          {s.needs?.length ? (
            <ul className="mt-2 grid gap-1 text-sm">
              {s.needs.map((n) => (
                <li key={n} className="flex gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />{" "}
                  {n}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nothing outstanding.</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Agreements {s.packetSigned ? "signed" : "not signed"} · Terms{" "}
            {s.termsAccepted ? "accepted" : "not accepted"}
            {s.bpp?.accounts ? ` · ${s.bpp.paid}/${s.bpp.accounts} BPP accounts subscribed` : ""}
            {s.openEscalations
              ? ` · ${s.openEscalations} open support request${s.openEscalations === 1 ? "" : "s"}`
              : ""}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Updated {relDays(s.refreshedAt ?? null)}
          </p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">
            Properties & subscriptions ({s.properties?.length ?? 0})
          </h3>
          <ul className="mt-2 grid gap-1.5 text-sm">
            {(s.properties ?? []).map((p, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2">
                <span className="truncate">{p.address ?? "—"}</span>
                <span className="text-right tabular-nums">{money(p.value)}</span>
                <span className="text-xs text-muted-foreground">
                  {[p.cad, p.account && `#${p.account}`, p.plan].filter(Boolean).join(" · ")}
                  {p.deadline && ` · deadline ${p.deadline}`}
                </span>
                <span
                  className={`text-right text-xs ${["active", "trialing"].includes(p.status ?? "") ? "text-emerald-700" : p.status === "past_due" ? "font-semibold text-rose-700" : "text-muted-foreground"}`}
                >
                  {p.status ?? "not subscribed"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">Support notes</h3>
        <textarea
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Support notes"
        />
        <button
          type="button"
          disabled={!!busy || notes === (h.notes ?? "")}
          onClick={() => void update("notes", { notes }, "Notes saved.")}
          className="btn-outline mt-2 text-xs"
        >
          Save notes
        </button>
      </div>

      <div className="rounded-lg border border-border p-4">
        <RecordHistory
          profileId={h.profileId}
          leadId={h.leadId}
          title="Shared history (Marketing → Support, cases, approvals)"
          limit={20}
        />
      </div>

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Marketing history ({d?.history.length ?? 0})
        </summary>
        <ul className="mt-2 grid max-h-80 gap-2 overflow-y-auto text-sm">
          {(d?.history ?? []).map((a, i) => (
            <li key={i} className="border-l-2 border-border pl-3">
              <div className="flex justify-between gap-2">
                <span>{a.summary}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{relDays(a.at)}</span>
              </div>
              {a.body && (
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{a.body}</p>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
