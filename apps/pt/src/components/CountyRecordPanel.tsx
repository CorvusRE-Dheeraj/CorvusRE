import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Row = {
  cad: string;
  protested_at: string | null;
  scheduled_hearing: string | null;
  actual_hearing: string | null;
  release_date: string | null;
  stage: string | null;
  initial_value: number | null;
  final_value: number | null;
  withdrawn: boolean;
  source: string;
  synced_at: string;
};

const fmt = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const usd = (n: number) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;

// The appraisal district's own published record of this case
// (sync-county-records), when the county publishes one.
export function CountyRecordPanel({ protestId }: { protestId: string }) {
  const [r, setR] = useState<Row | null>(null);
  useEffect(() => {
    supabase
      .from("county_case_records")
      .select(
        "cad, protested_at, scheduled_hearing, actual_hearing, release_date, stage, initial_value, final_value, withdrawn, source, synced_at",
      )
      .eq("protest_id", protestId)
      .maybeSingle()
      .then(({ data }) => setR((data as Row | null) ?? null));
  }, [protestId]);
  if (!r) return null;

  const items: [string, string][] = [];
  if (r.protested_at) items.push(["Protest received", fmt(r.protested_at)]);
  if (r.scheduled_hearing)
    items.push([
      `${r.stage === "informal" ? "Informal" : "ARB"} hearing scheduled`,
      fmt(r.scheduled_hearing),
    ]);
  if (r.actual_hearing) items.push(["Hearing held", fmt(r.actual_hearing)]);
  if (r.final_value != null && r.release_date)
    items.push([
      "Final value released",
      `${usd(r.final_value)}${r.initial_value != null && Number(r.initial_value) !== Number(r.final_value) ? ` (from ${usd(r.initial_value)})` : ""} · ${fmt(r.release_date)}`,
    ]);
  if (r.withdrawn) items.push(["Status", "Withdrawn"]);

  return (
    <section
      aria-label="County record"
      className="mt-4 rounded-lg border border-border p-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <Landmark className="h-4 w-4 text-accent" aria-hidden="true" />
        <h3 className="font-semibold">{r.cad}&apos;s record of this protest</h3>
      </div>
      {items.length > 0 ? (
        <dl className="mt-2 grid gap-1 sm:grid-cols-2">
          {items.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-muted-foreground">No entry for this protest yet.</p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        From {r.source}, checked {fmt(r.synced_at)}. Corvus AI fills in your case from it
        automatically and never overwrites what you&apos;ve entered.
      </p>
    </section>
  );
}
