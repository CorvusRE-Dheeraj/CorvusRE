import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { getErrorMessage } from "@/lib/error-message";
import { money, relDays, type MarketingData } from "@/lib/marketing";
import { groupProspects, type ProspectRecord } from "@/lib/marketing-crm";
import { importProspects, researchMany, runCountySearch } from "@/lib/marketing-research";

// Counties whose public parcel layer publishes both a value and a property
// class (see supabase/pt/functions/_shared/handlers/marketing-prospects.ts).
const COUNTIES = ["Harris", "Collin", "Denton", "Fort Bend", "Williamson"];
const sel = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

// County prospecting: commercial parcels straight from the appraisal
// district's own data, grouped by owner, already-known owners and parcels
// marked, then the chosen owners become leads — never duplicated.
export function ProspectFinder({
  data,
  reload,
  onClose,
  initialCounty,
}: {
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
  initialCounty?: string;
}) {
  const [county, setCounty] = useState(
    COUNTIES.includes(initialCounty ?? "") ? initialCounty! : "Harris",
  );
  const [minValue, setMinValue] = useState("2000000");
  const [industrial, setIndustrial] = useState(false);
  const [limit, setLimit] = useState("200");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{
    records: ProspectRecord[];
    cad: string;
    fetchedAt: string;
    excluded: number;
    minValue: number;
  } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState(data.me ?? "");
  const [research, setResearch] = useState(true);
  const groups = useMemo(
    () => (result ? groupProspects(result.records, data.leads, data.properties) : []),
    [result, data.leads, data.properties],
  );

  async function search() {
    setBusy("search");
    try {
      const r = await runCountySearch({
        county,
        minValue: Number(minValue.replace(/\D/g, "")) || 2e6,
        includeIndustrial: industrial,
        limit: Number(limit),
      });
      const recs = r.records ?? [];
      setResult({
        records: recs,
        cad: r.cad ?? "",
        fetchedAt: r.fetchedAt ?? new Date().toISOString(),
        excluded: r.excluded ?? 0,
        minValue: r.minValue ?? 0,
      });
      // pre-select owners with something new, not already leads
      setPicked(
        new Set(
          groupProspects(recs, data.leads, data.properties)
            .filter((g) => !g.existing && g.newRecords.length)
            .slice(0, 25)
            .map((g) => g.key),
        ),
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "The county's records didn't respond — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!result) return;
    setBusy("create");
    try {
      const chosen = groups.filter((g) => picked.has(g.key));
      const r = await importProspects(chosen, {
        assignTo: assignTo || null,
        fetchedAt: result.fetchedAt,
      });
      await reload();
      toast.success(
        `${r.created.length} lead${r.created.length === 1 ? "" : "s"} created${r.updated ? `, ${r.updated} existing updated` : ""} · ${r.properties} properties added.`,
      );
      if (research && r.created.length) {
        const { loadMarketing } = await import("@/lib/marketing");
        const latest = await loadMarketing();
        const fresh = latest.leads.filter((l) => r.created.some((c) => c.id === l.id)).slice(0, 15);
        const id = toast.loading(
          `Corvus AI is researching ownership for ${fresh.length} new lead${fresh.length === 1 ? "" : "s"}…`,
        );
        const done = await researchMany(fresh, latest, (n) =>
          toast.loading(`Researched ${n} of ${fresh.length}…`, { id }),
        );
        toast.success(`Researched ${done.ok} lead${done.ok === 1 ? "" : "s"}.`, { id });
        await reload();
      }
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't create those leads."));
    } finally {
      setBusy(null);
    }
  }

  const chosen = groups.filter((g) => picked.has(g.key));
  return (
    <Modal onClose={busy ? () => undefined : onClose} xl>
      <div className="grid gap-4 p-5 sm:p-6">
        <div>
          <h2 className="font-serif text-2xl font-semibold">Find prospects by county</h2>
          <p className="text-sm text-muted-foreground">
            Commercial properties read directly from the county appraisal district&apos;s public
            data, grouped by owner. Government and exempt owners are left out.
          </p>
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            County
            <select className={sel} value={county} onChange={(e) => setCounty(e.target.value)}>
              {COUNTIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Assessed value at least
            <select className={sel} value={minValue} onChange={(e) => setMinValue(e.target.value)}>
              {["500000", "1000000", "2000000", "5000000", "10000000", "25000000"].map((v) => (
                <option key={v} value={v}>
                  {money(Number(v))}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            How many
            <select className={sel} value={limit} onChange={(e) => setLimit(e.target.value)}>
              {["50", "100", "200", "500"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={industrial}
              onChange={(e) => setIndustrial(e.target.checked)}
            />
            Include industrial
          </label>
          <button
            type="submit"
            disabled={!!busy}
            className="btn-primary btn-primary-hover inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
          >
            {busy === "search" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Search className="h-4 w-4" aria-hidden />
            )}
            {busy === "search" ? "Reading county records…" : "Search"}
          </button>
        </form>
        <p className="text-[11px] text-muted-foreground">
          * Available for Harris, Collin, Denton, Fort Bend and Williamson — the counties whose
          public parcel data includes values and property classes. For others, import a list or
          research owners.
        </p>

        {result && (
          <>
            <p className="text-xs text-muted-foreground">
              Source: {result.cad} public parcel data · read {relDays(result.fetchedAt)} (
              {new Date(result.fetchedAt).toLocaleTimeString()}) · {result.records.length}{" "}
              properties, {groups.length} owners
              {result.excluded ? ` · ${result.excluded} government/exempt left out` : ""}
            </p>
            <div className="max-h-[48vh] overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="sticky top-0 border-b border-border bg-background text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all owners"
                        checked={groups.length > 0 && chosen.length === groups.length}
                        onChange={() =>
                          setPicked(
                            chosen.length === groups.length
                              ? new Set()
                              : new Set(groups.map((g) => g.key)),
                          )
                        }
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Owner</th>
                    <th className="px-3 py-2 text-right font-medium">Properties</th>
                    <th className="px-3 py-2 text-right font-medium">Assessed</th>
                    <th className="px-3 py-2 font-medium">Change</th>
                    <th className="px-3 py-2 font-medium">Mailing address</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr
                      key={g.key}
                      className={`border-b border-border/60 ${!g.newRecords.length ? "opacity-60" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${g.owner}`}
                          disabled={!g.newRecords.length}
                          checked={picked.has(g.key)}
                          onChange={() =>
                            setPicked((x) => {
                              const n = new Set(x);
                              if (n.has(g.key)) n.delete(g.key);
                              else n.add(g.key);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="max-w-[18rem] px-3 py-2">
                        <div className="truncate font-medium">{g.owner}</div>
                        <div
                          className="truncate text-xs text-muted-foreground"
                          title={g.records.map((r) => r.propertyAddress).join("\n")}
                        >
                          {g.records[0].propertyAddress}
                          {g.records.length > 1 ? ` +${g.records.length - 1} more` : ""} ·{" "}
                          {g.records[0].propertyType}
                        </div>
                        {g.existing && (
                          <div className="text-[11px] text-sky-800">
                            Already a lead: {g.existing.name}
                            {g.newRecords.length
                              ? ` — ${g.newRecords.length} new propert${g.newRecords.length === 1 ? "y" : "ies"} will be added`
                              : " — nothing new"}
                          </div>
                        )}
                        {!g.existing && g.known > 0 && (
                          <div className="text-[11px] text-amber-800">
                            {g.known} already linked to another lead
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{g.records.length}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {money(g.total)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {g.maxChangePct != null ? (
                          <span
                            className={g.maxChangePct >= 10 ? "font-semibold text-rose-700" : ""}
                          >
                            {g.maxChangePct > 0 ? "+" : ""}
                            {g.maxChangePct}%
                          </span>
                        ) : (
                          <span
                            className="text-muted-foreground"
                            title="This county's data doesn't publish last year's value yet — the assessment review reads the history"
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td
                        className="max-w-[16rem] truncate px-3 py-2 text-xs text-muted-foreground"
                        title={g.mailingAddress ?? undefined}
                      >
                        {g.mailingAddress ?? "—"}
                      </td>
                    </tr>
                  ))}
                  {groups.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        No commercial properties at that value — try a lower minimum.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
              <label className="inline-flex items-center gap-2">
                Assign to
                <select
                  className={sel}
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                >
                  <option value="">Nobody</option>
                  {data.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={research}
                  onChange={(e) => setResearch(e.target.checked)}
                />
                Research ownership with Corvus AI (first 15)
              </label>
              <button
                type="button"
                disabled={!!busy || !chosen.length}
                onClick={() => void create()}
                className="btn-primary btn-primary-hover ml-auto text-sm disabled:opacity-60"
              >
                {busy === "create"
                  ? "Saving…"
                  : `Add ${chosen.length} owner${chosen.length === 1 ? "" : "s"} to the CRM`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
