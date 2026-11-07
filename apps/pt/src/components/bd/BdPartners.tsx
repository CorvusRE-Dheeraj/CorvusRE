import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";
import { requestApproval } from "@/lib/staff-records";
import { supabase } from "@/lib/supabase";
import {
  bdAnalytics,
  dateShort,
  listPartners,
  partnerCommissions,
  partnerReferrals,
  recordCommission,
  recordReferral,
  savePartner,
  usd0,
  type BdAnalytics,
  type Partner,
  type TeamMember,
} from "@/lib/bd-console";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Referral partners: agreement status, manager, referred prospects,
// conversions and the subscriptions they brought. One partner per prospect,
// so revenue is never counted twice. Compensation is recorded only under a
// signed agreement; paying it is a separate Super Admin approval.
export function BdPartners({
  team,
  onAccount,
}: {
  team: TeamMember[];
  onAccount: (id: string) => void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [perf, setPerf] = useState<BdAnalytics["partners"]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setPartners(await listPartners());
      const a = await bdAnalytics(iso(new Date(Date.now() - 365 * 864e5)), iso(new Date()), null);
      setPerf(a.partners);
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't load partners."));
    }
  }, []);
  useEffect(() => void load(), [load]);
  const p = partners.find((x) => x.id === open) ?? null;
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section className="card-elev p-4 text-sm">
        <h3 className="font-semibold">Partners</h3>
        <p className="text-xs text-muted-foreground">
          Make an organization a partner from its account page.
        </p>
        <ul className="mt-3 grid gap-2">
          {partners.map((x) => {
            const s = perf.find((y) => y.id === x.id);
            const quiet = !s?.lastReferral || Date.now() - Date.parse(s.lastReferral) > 60 * 864e5;
            return (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => setOpen(x.id)}
                  className={`w-full rounded-md border p-2 text-left hover:bg-secondary/40 ${open === x.id ? "ring-2 ring-accent" : "border-border"}`}
                >
                  <div className="font-medium">{x.crm_accounts?.name ?? "Partner"}</div>
                  <div className="text-xs text-muted-foreground">
                    Agreement: {x.agreement_status} · {s?.referred ?? 0} referred ·{" "}
                    {s?.converted ?? 0} converted · {s?.subscribedProperties ?? 0} subscribed
                    properties
                  </div>
                  {quiet && (
                    <div className="text-xs text-amber-700">
                      No referrals in 60 days — follow up
                    </div>
                  )}
                </button>
              </li>
            );
          })}
          {partners.length === 0 && <li className="text-muted-foreground">No partners yet.</li>}
        </ul>
      </section>
      {p ? (
        <PartnerDetail
          key={p.id}
          p={p}
          team={team}
          perf={perf.find((y) => y.id === p.id) ?? null}
          reload={load}
          onAccount={onAccount}
        />
      ) : (
        <p className="card-elev p-6 text-sm text-muted-foreground">Pick a partner.</p>
      )}
    </div>
  );
}

function PartnerDetail({
  p,
  team,
  perf,
  reload,
  onAccount,
}: {
  p: Partner;
  team: TeamMember[];
  perf: BdAnalytics["partners"][number] | null;
  reload: () => Promise<void>;
  onAccount: (id: string) => void;
}) {
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof partnerReferrals>>>([]);
  const [comms, setComms] = useState<Awaited<ReturnType<typeof partnerCommissions>>>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<
    { id: string; full_name: string | null; email: string | null; company: string | null }[]
  >([]);
  const [method, setMethod] = useState<"introduction" | "code" | "link">("introduction");
  const [comm, setComm] = useState({ amount: "", basis: "" });
  const [why, setWhy] = useState("");
  const load = useCallback(async () => {
    setRefs(await partnerReferrals(p.id).catch(() => []));
    setComms(await partnerCommissions(p.id).catch(() => []));
  }, [p.id]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => {
      void supabase
        .from("marketing_leads")
        .select("id, full_name, email, company")
        .or(`full_name.ilike.%${q.trim()}%,email.ilike.%${q.trim()}%,company.ilike.%${q.trim()}%`)
        .limit(8)
        .then(({ data }) => setHits((data ?? []) as typeof hits));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const link = `${window.location.origin}${import.meta.env.BASE_URL}?partner=${p.referral_code}`;
  return (
    <section className="card-elev grid content-start gap-4 p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-xl font-semibold">{p.crm_accounts?.name}</h3>
          <button
            type="button"
            className="text-xs text-accent underline"
            onClick={() => onAccount(p.account_id)}
          >
            Open account (contacts, history)
          </button>
        </div>
        <select
          className={inp}
          value={p.manager ?? ""}
          onChange={(e) =>
            void savePartner({
              id: p.id,
              account_id: p.account_id,
              manager: e.target.value || null,
            }).then(reload)
          }
          aria-label="Partner manager"
        >
          <option value="">No manager</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              Manager: {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(
          [
            ["Referred", perf?.referred ?? 0],
            ["Converted", perf?.converted ?? 0],
            ["Subscribed properties", perf?.subscribedProperties ?? 0],
            ["Renewal revenue (12 mo)", usd0((perf?.revenueCents ?? 0) / 100)],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="rounded-md bg-secondary/40 p-2">
            <div className="text-[11px] text-muted-foreground">{l}</div>
            <div className="text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="rounded-md bg-secondary/40 p-3">
        <div className="font-medium">Agreement: {p.agreement_status}</div>
        <p className="text-xs text-muted-foreground">
          {p.agreement_status === "signed"
            ? `Signed ${dateShort(p.agreement_signed_at)}. ${p.agreement_terms ?? ""}`
            : "Send a partner agreement as a proposal from a referral-partner opportunity; it counts as signed when the partner signs it."}
        </p>
      </div>
      <div>
        <div className="font-medium">Approved referral link &amp; code</div>
        <p className="mt-1 break-all text-xs">
          Code <span className="font-mono font-semibold">{p.referral_code}</span> · {link}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Prospects who quote the code, or are introduced by the partner, are recorded below.
        </p>
      </div>
      <div>
        <div className="font-medium">Record a referral</div>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            className={`${inp} flex-1`}
            placeholder="Find the prospect in the CRM"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Prospect"
          />
          <select
            className={inp}
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            aria-label="How"
          >
            <option value="introduction">Introduction</option>
            <option value="code">Quoted the code</option>
            <option value="link">Came through the link</option>
          </select>
        </div>
        {hits.map((h) => (
          <button
            key={h.id}
            type="button"
            className="block w-full rounded px-2 py-1 text-left hover:bg-secondary"
            onClick={() =>
              recordReferral(p.id, h.id, method)
                .then(() => (setQ(""), load(), reload()))
                .catch((e) => toast.error(getErrorMessage(e, "Couldn't record it.")))
            }
          >
            {h.full_name ?? h.email}{" "}
            <span className="text-xs text-muted-foreground">{h.company}</span>
          </button>
        ))}
        <ul className="mt-2 grid gap-1">
          {refs.map((r) => (
            <li key={r.id} className="flex justify-between gap-2 text-xs">
              <span>
                {r.marketing_leads?.full_name ?? r.marketing_leads?.email} ({r.method})
              </span>
              <span className="text-muted-foreground">
                {r.marketing_leads?.profile_id
                  ? "registered"
                  : (r.marketing_leads?.stage ?? "prospect")}{" "}
                · {dateShort(r.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="font-medium">Compensation</div>
        {p.agreement_status !== "signed" ? (
          <p className="text-xs text-muted-foreground">
            Recorded only once a partner agreement is signed.
          </p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              className={inp}
              type="number"
              placeholder="Amount ($)"
              value={comm.amount}
              onChange={(e) => setComm({ ...comm, amount: e.target.value })}
              aria-label="Amount"
            />
            <input
              className={`${inp} flex-1`}
              placeholder="Basis (per the agreement)"
              value={comm.basis}
              onChange={(e) => setComm({ ...comm, basis: e.target.value })}
              aria-label="Basis"
            />
            <button
              type="button"
              className="btn-outline text-xs"
              disabled={!Number(comm.amount) || comm.basis.trim().length < 3}
              onClick={() =>
                recordCommission(p.id, Number(comm.amount), comm.basis.trim())
                  .then(() => (setComm({ amount: "", basis: "" }), load()))
                  .catch((e) => toast.error(getErrorMessage(e, "Couldn't record it.")))
              }
            >
              Record
            </button>
          </div>
        )}
        <ul className="mt-2 grid gap-1">
          {comms.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>
                {usd0(c.amount)} — {c.basis} · {c.status.replace(/_/g, " ")}
              </span>
              {c.status === "recorded" && (
                <span className="flex gap-1">
                  <input
                    className={`${inp} text-xs`}
                    placeholder="Why it's due"
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    aria-label="Reason"
                  />
                  <button
                    type="button"
                    className="btn-outline text-xs"
                    disabled={why.trim().length < 5}
                    onClick={() =>
                      requestApproval({
                        kind: "partner_payout",
                        payload: { commission_id: c.id },
                        reason: why,
                      })
                        .then(
                          () => (
                            setWhy(""),
                            toast.success("Payout sent for Super Admin approval"),
                            load()
                          ),
                        )
                        .catch((e) => toast.error(getErrorMessage(e, "Couldn't request it.")))
                    }
                  >
                    Request payout
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
