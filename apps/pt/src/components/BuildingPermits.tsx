import { useEffect, useState } from "react";
import { ExternalLink, Hammer } from "lucide-react";
import {
  isValueAdding,
  loadBuildingPermits,
  permitsSupported,
  PERMIT_SOURCES,
  type BuildingPermit,
} from "@/lib/building-permits";
import { countyFromCad } from "@/lib/tax-rates-official";

const money = (n: number | null) =>
  n == null || n === 0 ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const date = (iso: string | null) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

// Module 5 (Improvement Condition): the building permits the appraisal
// district recorded for this property. Work done under a permit is a common
// reason the county raises an improvement value — so it's worth checking the
// value change matches the work actually done (and that finished, not planned,
// work is what's being taxed).
export function BuildingPermits({
  cad,
  accountNumber,
}: {
  cad: string | null;
  accountNumber: string | null;
}) {
  const [permits, setPermits] = useState<BuildingPermit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = permitsSupported(cad);
  useEffect(() => {
    if (!supported || !accountNumber) return;
    const ctl = new AbortController();
    setPermits(null);
    setError(null);
    loadBuildingPermits(cad, accountNumber, ctl.signal)
      .then((p) => setPermits(p ?? []))
      .catch((e) => {
        if (!ctl.signal.aborted)
          setError(e instanceof Error ? e.message : "Permit data unavailable");
      });
    return () => ctl.abort();
  }, [cad, accountNumber, supported]);

  const county = countyFromCad(cad);
  const src = county ? PERMIT_SOURCES[county] : undefined;
  if (!supported) {
    return (
      <section className="card-elev p-4 text-sm" aria-label="Building permits">
        <h3 className="flex items-center gap-2 font-semibold">
          <Hammer className="h-4 w-4" aria-hidden /> Building permits
        </h3>
        <p className="mt-1 text-muted-foreground">
          {county
            ? `${county.replace(/\b\w/g, (c) => c.toUpperCase())} County doesn't`
            : "This county doesn't"}{" "}
          publish building permits as open data yet. If work was done on the building, add the
          permit or invoices to the building records so they can be checked against the
          county&apos;s value.
        </p>
      </section>
    );
  }
  const valueAdding = (permits ?? []).filter(isValueAdding);
  return (
    <section className="card-elev p-4 text-sm" aria-label="Building permits">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Hammer className="h-4 w-4" aria-hidden /> Building permits (last 3 years)
        </h3>
        {src && (
          <a
            href={src.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent underline"
          >
            Source: {src.label} <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
      {!accountNumber ? (
        <p className="mt-1 text-muted-foreground">
          Add the CAD account number to see this property&apos;s permits.
        </p>
      ) : error ? (
        <p className="mt-1 text-muted-foreground">
          Couldn&apos;t load permits right now ({error}).
        </p>
      ) : !permits ? (
        <p className="mt-1 text-muted-foreground">Loading permits…</p>
      ) : permits.length === 0 ? (
        <p className="mt-1 text-muted-foreground">
          The appraisal district has no building permits on record for this property in the last
          three years.
        </p>
      ) : (
        <>
          <p className="mt-1">
            {permits.length} permit{permits.length === 1 ? "" : "s"} on record
            {valueAdding.length > 0 &&
              ` — ${valueAdding.length} for work that usually adds value (new construction, additions, finish-out, remodels, pools). Check that the county's improvement value reflects only work that's finished, and at what it actually cost.`}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3">Issued</th>
                  <th className="py-1.5 pr-3">Work</th>
                  <th className="py-1.5 pr-3">Issued by</th>
                  <th className="py-1.5 pr-3 text-right">Permit value</th>
                  <th className="py-1.5 pr-3 text-right">Area (sq ft)</th>
                </tr>
              </thead>
              <tbody>
                {permits.map((p) => (
                  <tr key={p.id} className="border-t border-border/60 align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3">{date(p.issuedAt)}</td>
                    <td className="py-1.5 pr-3">
                      {p.type ?? "—"}
                      {p.subtype && <span className="text-muted-foreground"> · {p.subtype}</span>}
                      {isValueAdding(p) && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                          Adds value
                        </span>
                      )}
                      {(p.number || p.comments) && (
                        <div className="text-xs text-muted-foreground">
                          {p.number && `#${p.number}`}
                          {p.number && p.comments && " · "}
                          {p.comments}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{p.issuedBy ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right">{money(p.value)}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {p.buildingArea ? p.buildingArea.toLocaleString("en-US") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
