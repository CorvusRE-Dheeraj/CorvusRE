import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Sparkles } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import {
  bdAction,
  dateShort,
  listResearch,
  markFinding,
  saveAccount,
  saveContact,
  usd0,
  type AccountKind,
  type ResearchFinding,
  type ResearchRow,
} from "@/lib/bd-console";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

// Research requests → findings with sources, research date and unverified
// assumptions. Nothing becomes an account until staff review it.
export function BdResearch({ onAccount }: { onAccount: (id: string) => void }) {
  const [mode, setMode] = useState<"county" | "organization" | "website">("county");
  const [p, setP] = useState({
    county: "Collin",
    propertyType: "commercial",
    minProperties: "5",
    organization: "",
    url: "",
    partnerCategory: "",
  });
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ResearchRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(
    () =>
      listResearch()
        .then((r) => {
          setRows(r);
          setOpen((o) => o ?? r[0]?.id ?? null);
        })
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load research."))),
    [],
  );
  useEffect(() => void load(), [load]);

  async function run() {
    setBusy(true);
    try {
      const r = await bdAction<{ id: string }>("research", {
        mode,
        ...p,
        minProperties: Number(p.minProperties) || 5,
      });
      setOpen(r.id);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, "Research failed."));
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function accept(r: ResearchRow, i: number) {
    const f = r.findings[i];
    try {
      const id = await saveAccount({
        name: f.name,
        kind: (f.kind as AccountKind) ?? "property_owner",
        counties: f.counties,
        notes: f.whyCorvus ?? null,
      });
      for (const dm of f.decisionMakers ?? [])
        await saveContact({
          account_id: id,
          full_name: dm.name,
          title: dm.title,
          decision_maker: true,
          company: f.name,
          source: "research",
        });
      const next = r.findings.map((x, j) =>
        j === i ? { ...x, reviewed: true, accountId: id } : x,
      );
      await markFinding(r.id, next);
      await load();
      toast.success("Account created from the reviewed finding");
      onAccount(id);
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't create the account."));
    }
  }
  async function dismiss(r: ResearchRow, i: number) {
    await markFinding(
      r.id,
      r.findings.map((x, j) => (j === i ? { ...x, reviewed: true } : x)),
    ).catch(() => undefined);
    await load();
  }
  const cur = rows.find((r) => r.id === open) ?? null;
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <section className="card-elev grid gap-2 p-4 text-sm">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Request research
          </h3>
          <select
            className={inp}
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            aria-label="Research by"
          >
            <option value="county">By county &amp; property type (portfolio owners)</option>
            <option value="organization">By organization name</option>
            <option value="website">From an organization&apos;s website</option>
          </select>
          {mode === "county" && (
            <>
              <input
                className={inp}
                value={p.county}
                onChange={(e) => setP({ ...p, county: e.target.value })}
                aria-label="County"
                placeholder="County"
              />
              <select
                className={inp}
                value={p.propertyType}
                onChange={(e) => setP({ ...p, propertyType: e.target.value })}
                aria-label="Property type"
              >
                <option value="commercial">Commercial</option>
                <option value="multifamily">Multifamily</option>
                <option value="residential">Residential</option>
                <option value="land">Land</option>
                <option value="any">Any</option>
              </select>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  Minimum properties in the portfolio
                </span>
                <input
                  className={inp}
                  type="number"
                  min={2}
                  value={p.minProperties}
                  onChange={(e) => setP({ ...p, minProperties: e.target.value })}
                />
              </label>
            </>
          )}
          {mode === "organization" && (
            <input
              className={inp}
              value={p.organization}
              onChange={(e) => setP({ ...p, organization: e.target.value })}
              placeholder="e.g. Parkwood Office"
              aria-label="Organization"
            />
          )}
          {mode === "website" && (
            <input
              className={inp}
              value={p.url}
              onChange={(e) => setP({ ...p, url: e.target.value })}
              placeholder="https://…"
              aria-label="Website"
            />
          )}
          <select
            className={inp}
            value={p.partnerCategory}
            onChange={(e) => setP({ ...p, partnerCategory: e.target.value })}
            aria-label="Partner category"
          >
            <option value="">Prospects (owners)</option>
            <option value="broker">Partner: brokers</option>
            <option value="management_company">Partner: management companies</option>
            <option value="consultant">Partner: consultants</option>
          </select>
          <button type="button" className="btn-accent text-sm" disabled={busy} onClick={run}>
            {busy ? "Researching…" : "Run research"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            Texas only (what CorvusPT supports). County portfolios come from open appraisal rolls
            (Collin today); organization search covers the 11 counties CorvusPT reads directly;
            website research reads only that site.
          </p>
        </section>
        <section className="card-elev p-4 text-sm">
          <h3 className="font-semibold">Past research</h3>
          <ul className="mt-2 grid gap-1">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpen(r.id)}
                  className={`w-full rounded px-2 py-1 text-left hover:bg-secondary ${open === r.id ? "bg-secondary" : ""}`}
                >
                  {String(r.params.mode ?? "county")}:{" "}
                  {String(r.params.county ?? r.params.organization ?? r.params.url ?? "")}
                  <span className="block text-xs text-muted-foreground">
                    {dateShort(r.created_at)} · {r.status} · {r.findings.length} finding
                    {r.findings.length === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="card-elev p-5 text-sm">
        {!cur ? (
          <p className="text-muted-foreground">Run research to see findings here.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">Findings</h3>
              <span className="text-xs text-muted-foreground">
                Researched {dateShort(cur.researched_at ?? cur.created_at)}
              </span>
            </div>
            {cur.error && <p className="mt-2 text-destructive">{cur.error}</p>}
            {cur.coverage_note && (
              <p className="mt-1 text-xs text-muted-foreground">{cur.coverage_note}</p>
            )}
            {cur.summary && <p className="mt-2">{cur.summary}</p>}
            <ul className="mt-3 grid gap-3">
              {cur.findings.map((f: ResearchFinding, i: number) => (
                <li
                  key={i}
                  className={`rounded-md border p-3 ${f.reviewed ? "border-border/50 opacity-70" : "border-border"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{f.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {f.properties != null && `${f.properties} properties`}
                        {f.marketValue != null && ` · ${usd0(f.marketValue)} market value`}
                        {f.counties.length > 0 && ` · ${f.counties.join(", ")}`}
                      </div>
                    </div>
                    {f.reviewed ? (
                      f.accountId ? (
                        <button
                          type="button"
                          className="text-xs text-accent underline"
                          onClick={() => onAccount(f.accountId!)}
                        >
                          Open account
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Dismissed</span>
                      )
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-accent text-xs"
                          onClick={() => void accept(cur, i)}
                        >
                          Reviewed — create account
                        </button>
                        <button
                          type="button"
                          className="btn-outline text-xs"
                          onClick={() => void dismiss(cur, i)}
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                  {f.whyCorvus && <p className="mt-2">Why CorvusPT: {f.whyCorvus}</p>}
                  {f.ownership && (
                    <p className="mt-1 text-xs text-muted-foreground">Ownership: {f.ownership}</p>
                  )}
                  {(f.decisionMakers ?? []).length > 0 && (
                    <p className="mt-1 text-xs">
                      Decision-makers:{" "}
                      {f
                        .decisionMakers!.map((d) => `${d.name}${d.title ? ` (${d.title})` : ""}`)
                        .join(", ")}
                    </p>
                  )}
                  {(f.sampleAddresses ?? []).length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      e.g. {f.sampleAddresses!.join(" · ")}
                    </p>
                  )}
                  {f.assumptions.length > 0 && (
                    <ul className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
                      {f.assumptions.map((a) => (
                        <li key={a}>Unverified: {a}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {f.sources.map((s, j) =>
                      s.url ? (
                        <a
                          key={j}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-accent underline"
                        >
                          {s.label} <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      ) : (
                        <span key={j} className="text-muted-foreground">
                          Source: {s.label}
                        </span>
                      ),
                    )}
                  </div>
                </li>
              ))}
              {cur.findings.length === 0 && cur.status === "done" && (
                <li className="text-muted-foreground">No findings.</li>
              )}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
