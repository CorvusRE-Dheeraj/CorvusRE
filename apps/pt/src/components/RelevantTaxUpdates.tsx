import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import {
  STATUS_LABEL,
  listTaxReports,
  propertiesAffected,
  updatesForProperty,
  type PropertyContext,
  type TaxUpdate,
  type TaxUpdateTag,
} from "@/lib/tax-updates";

// One fetch per page load shared by every panel on screen.
let latest: Promise<TaxUpdate[]> | null = null;
function latestUpdates(): Promise<TaxUpdate[]> {
  latest ??= listTaxReports()
    .then((r) => r[0]?.updates ?? [])
    .catch(() => {
      latest = null;
      return [];
    });
  return latest;
}

// A compact "May Affect Your Property" panel for the places a person is working
// on a specific property or case — Property, View Case, Arbitration, Court
// Appeal. Shows nothing when the latest report has nothing relevant, so it never
// adds noise. Full detail lives on the Texas Tax Updates tab.
export function RelevantTaxUpdates({
  property,
  protest,
  topics,
  max = 3,
}: {
  property: PropertyRecord;
  protest: ProtestRecord | null;
  topics?: TaxUpdateTag[];
  max?: number;
}) {
  const [updates, setUpdates] = useState<TaxUpdate[]>([]);
  useEffect(() => {
    let live = true;
    void latestUpdates().then((u) => live && setUpdates(u));
    return () => {
      live = false;
    };
  }, []);

  const relevant = updatesForProperty(updates, { property, protest }, topics);
  if (relevant.length === 0) return null;

  return (
    <section className="rounded-md border border-warning/40 bg-warning/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-warning-foreground">
          <MapPin className="h-3.5 w-3.5" />
          Texas tax updates that may affect {property.address}
        </h2>
        <Link to="/dashboard/tax-updates" className="text-xs text-accent hover:underline">
          See all updates →
        </Link>
      </div>
      <ul className="mt-2 grid gap-2">
        {relevant.slice(0, max).map((u) => (
          <li key={u.id} className="text-xs">
            <div className="font-medium text-foreground">
              {u.title}{" "}
              <span className="font-normal text-muted-foreground">
                · {STATUS_LABEL[u.status]}
                {u.counties.length ? ` · ${u.counties.join(", ")}` : ""}
              </span>
            </div>
            <div className="text-muted-foreground">{u.whyItMatters}</div>
            <a
              href={u.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {u.sourceName} →
            </a>
          </li>
        ))}
      </ul>
      {relevant.length > max && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">+{relevant.length - max} more</p>
      )}
    </section>
  );
}

// One line for the Properties page: how many of the latest updates may affect
// any of the owner's properties, linking to the full tab. Silent when none do.
export function TaxUpdatesBanner({ contexts }: { contexts: PropertyContext[] }) {
  const [updates, setUpdates] = useState<TaxUpdate[]>([]);
  useEffect(() => {
    let live = true;
    void latestUpdates().then((u) => live && setUpdates(u));
    return () => {
      live = false;
    };
  }, []);

  const affecting = updates.filter((u) => propertiesAffected(u, contexts).length > 0);
  if (affecting.length === 0) return null;
  return (
    <Link
      to="/dashboard/tax-updates"
      className="mt-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning-foreground hover:bg-warning/15"
    >
      <MapPin className="h-3.5 w-3.5 shrink-0" />
      {affecting.length} Texas tax update{affecting.length === 1 ? "" : "s"} may affect your
      properties — see Texas Tax Updates →
    </Link>
  );
}
