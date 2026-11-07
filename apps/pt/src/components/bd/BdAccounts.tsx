import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Search, Sparkles, Star } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import {
  bdAction,
  dateShort,
  getAccount,
  listAccounts,
  mergeAccounts,
  saveAccount,
  saveContact,
  saveOpportunity,
  savePartner,
  usd0,
  ACCOUNT_KIND_LABEL,
  CHANNELS,
  KIND_LABEL,
  STAGE_LABEL,
  type Account,
  type AccountKind,
  type Contact,
  type OpportunityKind,
  type TeamMember,
} from "@/lib/bd-console";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export function BdAccounts({
  team,
  openId,
  setOpenId,
  onOpportunity,
}: {
  team: TeamMember[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onOpportunity: (id: string) => void;
}) {
  const [rows, setRows] = useState<Account[] | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(
    () =>
      listAccounts()
        .then(setRows)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load accounts."))),
    [],
  );
  useEffect(() => void load(), [load]);
  const list = useMemo(
    () =>
      (rows ?? [])
        .filter((a) => !kind || (kind === "partners" ? a.partner : a.kind === kind))
        .filter((a) => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase())),
    [rows, q, kind],
  );
  if (openId)
    return (
      <AccountDetail
        key={openId}
        id={openId}
        team={team}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
        onOpportunity={onOpportunity}
        onOpenAccount={setOpenId}
      />
    );
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <input
            className="w-64 rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm"
            placeholder="Search organizations"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search organizations"
          />
        </label>
        <select
          className={inp}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Type"
        >
          <option value="">All types</option>
          {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
            <option key={k} value={k}>
              {ACCOUNT_KIND_LABEL[k]}
            </option>
          ))}
          <option value="partners">Referral partners</option>
        </select>
        <button
          type="button"
          className="btn-accent ml-auto text-sm"
          onClick={() => setAdding(true)}
        >
          New organization
        </button>
      </div>
      {adding && (
        <NewAccount
          team={team}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            setOpenId(id);
          }}
        />
      )}
      <div className="card-elev mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5">Organization</th>
              <th className="px-3 py-2.5">Contacts</th>
              <th className="px-3 py-2.5">Properties</th>
              <th className="px-3 py-2.5">Opportunities</th>
              <th className="px-3 py-2.5">Relationship owner</th>
              <th className="px-3 py-2.5">Last contact</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr
                key={a.id}
                className="cursor-pointer border-t border-border/60 align-top hover:bg-secondary/30"
                onClick={() => setOpenId(a.id)}
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {ACCOUNT_KIND_LABEL[a.kind]}
                    {a.partner && " · referral partner"}
                    {a.counties.length > 0 && ` · ${a.counties.join(", ")}`}
                  </div>
                  {a.duplicateOfName && (
                    <div className="text-xs text-amber-700">
                      Possible duplicate of {a.duplicateOfName}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {a.contacts}
                  <div className="text-xs text-muted-foreground">
                    {a.decisionMakers} decision-maker{a.decisionMakers === 1 ? "" : "s"}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {a.prospectProperties} prospective · {a.registeredProperties} registered ·{" "}
                  {a.subscribedProperties} subscribed
                </td>
                <td className="px-3 py-2.5">
                  {a.openOpportunities}
                  {a.pipelineValue > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {usd0(a.pipelineValue)} est.
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs">{a.ownerLabel ?? "—"}</td>
                <td className="px-3 py-2.5 text-xs">{dateShort(a.lastContact)}</td>
              </tr>
            ))}
            {rows && list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No organizations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewAccount({
  team,
  onClose,
  onSaved,
}: {
  team: TeamMember[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [f, setF] = useState({
    name: "",
    kind: "property_owner" as AccountKind,
    website: "",
    phone: "",
    counties: "",
    owner: "",
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const id = await saveAccount({
        name: f.name.trim(),
        kind: f.kind,
        website: f.website.trim() || null,
        phone: f.phone.trim() || null,
        counties: f.counties
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        relationship_owner: f.owner || null,
      });
      onSaved(id);
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't save."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card-elev mt-3 grid gap-2 p-4 text-sm md:grid-cols-3">
      <input
        className={inp}
        placeholder="Organization name"
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        aria-label="Organization name"
      />
      <select
        className={inp}
        value={f.kind}
        onChange={(e) => setF({ ...f, kind: e.target.value as AccountKind })}
        aria-label="Type"
      >
        {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
          <option key={k} value={k}>
            {ACCOUNT_KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <input
        className={inp}
        placeholder="Website (https://…)"
        value={f.website}
        onChange={(e) => setF({ ...f, website: e.target.value })}
        aria-label="Website"
      />
      <input
        className={inp}
        placeholder="Phone"
        value={f.phone}
        onChange={(e) => setF({ ...f, phone: e.target.value })}
        aria-label="Phone"
      />
      <input
        className={inp}
        placeholder="Counties (comma-separated)"
        value={f.counties}
        onChange={(e) => setF({ ...f, counties: e.target.value })}
        aria-label="Counties"
      />
      <select
        className={inp}
        value={f.owner}
        onChange={(e) => setF({ ...f, owner: e.target.value })}
        aria-label="Relationship owner"
      >
        <option value="">Relationship owner: me</option>
        {team.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2 md:col-span-3">
        <button
          type="button"
          className="btn-accent text-sm"
          disabled={busy || f.name.trim().length < 2}
          onClick={save}
        >
          Create
        </button>
        <button type="button" className="btn-outline text-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type Detail = Awaited<ReturnType<typeof getAccount>>;

function AccountDetail({
  id,
  team,
  onBack,
  onOpportunity,
  onOpenAccount,
}: {
  id: string;
  team: TeamMember[];
  onBack: () => void;
  onOpportunity: (id: string) => void;
  onOpenAccount: (id: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [contact, setContact] = useState<Partial<Contact> | null>(null);
  const [opp, setOpp] = useState<{
    title: string;
    kind: OpportunityKind;
    est: string;
    value: string;
    close: string;
    channel: string;
    lead: string;
  } | null>(null);
  const load = useCallback(
    () =>
      getAccount(id)
        .then(setD)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load the account."))),
    [id],
  );
  useEffect(() => void load(), [load]);
  if (!d) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;
  const a = d.account;
  const sug = a.ai_suggestions;
  const registered = d.contacts.filter((c) => c.profile_id).length;

  async function aiSuggest() {
    setBusy("ai");
    try {
      await bdAction("ai_account", { accountId: id });
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, "AI couldn't review this account."));
    } finally {
      setBusy(null);
    }
  }
  async function patch(p: Parameters<typeof saveAccount>[0]) {
    try {
      await saveAccount(p);
      await load();
      toast.success("Saved");
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't save."));
    }
  }

  return (
    <div className="mt-6 grid gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1 text-sm text-accent"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> All organizations
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold">{a.name}</h2>
          <p className="text-sm text-muted-foreground">
            {ACCOUNT_KIND_LABEL[a.kind]}
            {a.website && (
              <>
                {" · "}
                <a href={a.website} target="_blank" rel="noreferrer" className="underline">
                  {a.website.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
            {a.phone && ` · ${a.phone}`}
            {a.counties.length > 0 && ` · ${a.counties.join(", ")}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className={inp}
            value={a.relationship_owner ?? ""}
            onChange={(e) =>
              void patch({
                id,
                name: a.name,
                kind: a.kind,
                relationship_owner: e.target.value || null,
              })
            }
            aria-label="Relationship owner"
          >
            <option value="">No relationship owner</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                Owner: {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-outline inline-flex items-center gap-1.5 text-sm"
            onClick={aiSuggest}
            disabled={busy === "ai"}
          >
            <Sparkles className="h-4 w-4" aria-hidden />{" "}
            {busy === "ai" ? "Checking…" : "AI: duplicates & details"}
          </button>
          {!d.partner && (
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={() =>
                savePartner({ account_id: id, category: "referral" })
                  .then(load)
                  .then(() => toast.success("Partner profile created"))
                  .catch((e) =>
                    toast.error(getErrorMessage(e, "Couldn't create the partner profile.")),
                  )
              }
            >
              Make referral partner
            </button>
          )}
        </div>
      </div>

      {sug &&
        ((sug.duplicates?.length ?? 0) > 0 ||
          sug.info?.description ||
          (sug.info?.decisionMakers?.length ?? 0) > 0) && (
          <section className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
            <div className="flex items-center gap-1.5 font-semibold">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden /> AI suggestions — review
              before using
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {dateShort(sug.at)}
              </span>
            </div>
            {(sug.duplicates ?? []).map((x) => (
              <div key={x.id} className="mt-2 flex flex-wrap items-center gap-2">
                Possible duplicate:{" "}
                <button type="button" className="underline" onClick={() => onOpenAccount(x.id)}>
                  {x.name}
                </button>
                <span className="text-xs text-muted-foreground">({x.reason})</span>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() =>
                    mergeAccounts(id, x.id)
                      .then(load)
                      .then(() => toast.success(`Merged ${x.name} into ${a.name}`))
                      .catch((e) => toast.error(getErrorMessage(e, "Couldn't merge.")))
                  }
                >
                  Merge into this account
                </button>
              </div>
            ))}
            {sug.info?.description && <p className="mt-2">{sug.info.description}</p>}
            {sug.info?.portfolio && (
              <p className="mt-1 text-muted-foreground">Portfolio: {sug.info.portfolio}</p>
            )}
            {(sug.info?.decisionMakers ?? []).length > 0 && (
              <ul className="mt-2 grid gap-1">
                {sug.info!.decisionMakers!.map((p) => (
                  <li key={p.name} className="flex flex-wrap items-center gap-2">
                    {p.name}
                    {p.title && <span className="text-muted-foreground">— {p.title}</span>}
                    <a
                      href={p.source}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline"
                    >
                      source
                    </a>
                    <button
                      type="button"
                      className="text-xs text-accent underline"
                      onClick={() =>
                        setContact({ full_name: p.name, title: p.title, decision_maker: true })
                      }
                    >
                      Add as contact
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

      <section className="card-elev p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Contacts &amp; decision-makers</h3>
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => setContact({ decision_maker: false })}
          >
            Add contact
          </button>
        </div>
        {contact && (
          <div className="mt-3 grid gap-2 rounded-md border border-border p-3 text-sm md:grid-cols-3">
            <input
              className={inp}
              placeholder="Full name"
              value={contact.full_name ?? ""}
              onChange={(e) => setContact({ ...contact, full_name: e.target.value })}
              aria-label="Full name"
            />
            <input
              className={inp}
              placeholder="Title"
              value={contact.title ?? ""}
              onChange={(e) => setContact({ ...contact, title: e.target.value })}
              aria-label="Title"
            />
            <input
              className={inp}
              placeholder="Email"
              value={contact.email ?? ""}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
              aria-label="Email"
            />
            <input
              className={inp}
              placeholder="Phone"
              value={contact.phone ?? ""}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })}
              aria-label="Phone"
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!contact.decision_maker}
                onChange={(e) => setContact({ ...contact, decision_maker: e.target.checked })}
              />{" "}
              Decision-maker
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-accent text-xs"
                disabled={!contact.full_name?.trim()}
                onClick={() =>
                  saveContact({ ...contact, account_id: id, company: a.name })
                    .then(() => (setContact(null), load()))
                    .catch((e) => toast.error(getErrorMessage(e, "Couldn't save the contact.")))
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={() => setContact(null)}
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground md:col-span-3">
              An existing CRM contact with the same email joins this organization instead of being
              duplicated.
            </p>
          </div>
        )}
        <ul className="mt-3 grid gap-2 text-sm">
          {d.contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {c.decision_maker && (
                  <Star
                    className="mr-1 inline h-3.5 w-3.5 fill-amber-400 text-amber-400"
                    aria-label="Decision-maker"
                  />
                )}
                <span className="font-medium">{c.full_name ?? c.email}</span>
                {c.title && <span className="text-muted-foreground"> — {c.title}</span>}
                <span className="block text-xs text-muted-foreground">
                  {[c.email, c.phone].filter(Boolean).join(" · ")}
                  {c.profile_id && " · registered customer"}
                  {c.dnc_at && " · do not contact"}
                  {c.unsubscribed_at && " · unsubscribed"}
                  {c.outreach_paused_at && " · Marketing outreach paused"}
                </span>
              </span>
              <button
                type="button"
                className="text-xs text-accent underline"
                onClick={() => setContact(c)}
              >
                Edit
              </button>
            </li>
          ))}
          {d.contacts.length === 0 && <li className="text-muted-foreground">No contacts yet.</li>}
        </ul>
      </section>

      <section className="card-elev p-5">
        <h3 className="font-semibold">Properties</h3>
        <p className="text-xs text-muted-foreground">
          {d.properties.length} prospective ({d.properties.filter((p) => p.verified).length}{" "}
          confirmed against the county) · {registered} contact
          {registered === 1 ? "" : "s"} registered
        </p>
        {d.properties.length > 0 && (
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Address</th>
                  <th className="py-1">County</th>
                  <th className="py-1">Type</th>
                  <th className="py-1">Value</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.properties.map((p) => (
                  <tr key={p.id} className="border-t border-border/60">
                    <td className="py-1">{p.address}</td>
                    <td className="py-1">{p.county ?? p.cad ?? "—"}</td>
                    <td className="py-1">{p.property_type ?? "—"}</td>
                    <td className="py-1">{usd0(p.assessed_value)}</td>
                    <td className="py-1 text-xs">
                      {p.subscription_status
                        ? `subscribed (${p.subscription_status})`
                        : p.verified
                          ? "confirmed"
                          : "estimated"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-elev p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Opportunities</h3>
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() =>
              setOpp({
                title: `${a.name} — portfolio`,
                kind: "portfolio",
                est: "",
                value: "",
                close: "",
                channel: "outbound",
                lead: d.contacts.find((c) => c.decision_maker)?.id ?? d.contacts[0]?.id ?? "",
              })
            }
          >
            New opportunity
          </button>
        </div>
        {opp && (
          <div className="mt-3 grid gap-2 rounded-md border border-border p-3 text-sm md:grid-cols-3">
            <input
              className={`${inp} md:col-span-2`}
              value={opp.title}
              onChange={(e) => setOpp({ ...opp, title: e.target.value })}
              aria-label="Title"
            />
            <select
              className={inp}
              value={opp.kind}
              onChange={(e) => setOpp({ ...opp, kind: e.target.value as OpportunityKind })}
              aria-label="Type"
            >
              {(Object.keys(KIND_LABEL) as OpportunityKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              className={inp}
              type="number"
              placeholder="Estimated properties"
              value={opp.est}
              onChange={(e) => setOpp({ ...opp, est: e.target.value })}
              aria-label="Estimated properties"
            />
            <input
              className={inp}
              type="number"
              placeholder="Potential annual value ($)"
              value={opp.value}
              onChange={(e) => setOpp({ ...opp, value: e.target.value })}
              aria-label="Potential value"
            />
            <input
              className={inp}
              type="date"
              value={opp.close}
              onChange={(e) => setOpp({ ...opp, close: e.target.value })}
              aria-label="Expected close"
            />
            <select
              className={inp}
              value={opp.lead}
              onChange={(e) => setOpp({ ...opp, lead: e.target.value })}
              aria-label="Main contact"
            >
              <option value="">Main contact…</option>
              {d.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name ?? c.email}
                </option>
              ))}
            </select>
            <select
              className={inp}
              value={opp.channel}
              onChange={(e) => setOpp({ ...opp, channel: e.target.value })}
              aria-label="Source channel"
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  Source: {c}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-accent text-xs"
                disabled={opp.title.trim().length < 3}
                onClick={() =>
                  saveOpportunity({
                    account_id: id,
                    title: opp.title.trim(),
                    kind: opp.kind,
                    est_property_count: opp.est ? Number(opp.est) : null,
                    potential_value: opp.value ? Number(opp.value) : null,
                    expected_close: opp.close || null,
                    primary_lead_id: opp.lead || null,
                    source_channel: opp.channel,
                    partner_id: null,
                  })
                    .then((oid) => onOpportunity(oid))
                    .catch((e) =>
                      toast.error(getErrorMessage(e, "Couldn't create the opportunity.")),
                    )
                }
              >
                Create
              </button>
              <button type="button" className="btn-outline text-xs" onClick={() => setOpp(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <ul className="mt-3 divide-y divide-border/60 text-sm">
          {d.opportunities.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex w-full justify-between gap-2 py-2 text-left hover:bg-secondary/30"
                onClick={() => onOpportunity(o.id)}
              >
                <span>{o.title}</span>
                <span className="text-xs text-muted-foreground">
                  {STAGE_LABEL[o.stage]} · {usd0(o.potentialValue)} est.
                </span>
              </button>
            </li>
          ))}
          {d.opportunities.length === 0 && (
            <li className="py-2 text-muted-foreground">No opportunities yet.</li>
          )}
        </ul>
      </section>

      <section className="card-elev p-5">
        <h3 className="font-semibold">Communication history</h3>
        <p className="text-xs text-muted-foreground">
          Shared with Marketing — the same CRM history.
        </p>
        <ul className="mt-2 grid gap-2 text-sm">
          {[
            ...d.history.map((h) => ({
              at: h.created_at,
              text: h.summary,
              kind: h.kind.startsWith("bd_") ? "Business Development" : "Marketing",
              detail: h.outcome,
            })),
            ...d.activities
              .filter((x) => x.status !== "planned")
              .map((x) => ({
                at: x.completed_at ?? x.created_at,
                text: x.subject,
                kind: `BD ${x.kind}`,
                detail: x.outcome,
              })),
          ]
            .sort((x, y) => y.at.localeCompare(x.at))
            .slice(0, 60)
            .map((h, i) => (
              <li key={i} className="border-l-2 border-border pl-3">
                {h.text}
                {h.detail && <span className="text-muted-foreground"> — {h.detail}</span>}
                <div className="text-xs text-muted-foreground">
                  {dateShort(h.at)} · {h.kind}
                </div>
              </li>
            ))}
          {d.history.length === 0 && d.activities.length === 0 && (
            <li className="text-muted-foreground">Nothing yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
