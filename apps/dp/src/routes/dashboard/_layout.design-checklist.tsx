import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { setDesignChecklistDone } from "@/lib/design-requests";
import { designChecklist, DESIGN_CHECKLIST_GROUPS } from "@/lib/design-workspace";
import { Section, Loading } from "@/components/dp-ui";
import { useActiveDesignRequest, EmptyDesign, designSubtitle } from "@/components/design-workspace";

export const Route = createFileRoute("/dashboard/_layout/design-checklist")({
  head: () => ({ meta: [{ title: "Design Checklist — CorvusDP" }] }),
  component: DesignChecklist,
});

function DesignChecklist() {
  const { loading, dr, brief, refetch } = useActiveDesignRequest();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown straight away while the save is in flight, then replaced by the
  // saved row (or dropped again if the save fails).
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  if (loading) return <Loading />;
  if (!dr || !brief) return <EmptyDesign />;

  const doneKeys = optimistic ?? dr.checklist_done ?? [];
  const items = designChecklist({ ...dr, checklist_done: doneKeys }, brief);
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);

  async function toggle(key: string, next: boolean) {
    if (!dr) return;
    setSaving(key);
    setError(null);
    const current = new Set(doneKeys);
    if (next) current.add(key);
    else current.delete(key);
    setOptimistic([...current]);
    try {
      await setDesignChecklistDone(dr.id, [...current]);
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that change.");
    } finally {
      setOptimistic(null);
      setSaving(null);
    }
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Design checklist"
        subtitle={designSubtitle(dr)}
        right={
          <span className="text-sm font-semibold tabular-nums">
            {doneCount}/{items.length} done
          </span>
        }
      >
        <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Items marked "automatic" tick themselves from your approval and consultation request; a
          stage your design team completes ticks off that stage's items too.
        </p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Section>

      {DESIGN_CHECKLIST_GROUPS.map((group) => {
        const rows = items.filter((i) => i.group === group);
        if (rows.length === 0) return null;
        return (
          <Section
            key={group}
            title={group}
            right={
              <span className="text-xs text-muted-foreground tabular-nums">
                {rows.filter((r) => r.done).length}/{rows.length}
              </span>
            }
          >
            <ul className="grid gap-2">
              {rows.map((it) => (
                <li key={it.key}>
                  <label
                    className={`flex items-start gap-3 rounded-lg border border-border p-3 text-sm ${
                      it.auto ? "" : "cursor-pointer hover:bg-secondary/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      checked={it.done}
                      disabled={it.auto || saving === it.key}
                      onChange={(e) => toggle(it.key, e.target.checked)}
                    />
                    <span className={it.done ? "text-muted-foreground line-through" : ""}>
                      {it.label}
                    </span>
                    {it.auto && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        automatic
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}
