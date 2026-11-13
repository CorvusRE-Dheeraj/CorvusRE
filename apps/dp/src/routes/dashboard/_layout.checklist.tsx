import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { setChecklistDone } from "@/lib/projects";
import { checklistCompletion } from "@/lib/checklist";
import type { ChecklistRow } from "@/lib/projects";
import { Section, EmptyProject, Loading } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/checklist")({
  head: () => ({ meta: [{ title: "Checklist — CorvusDP" }] }),
  component: Checklist,
});

function Item({
  item,
  onToggle,
}: {
  item: ChecklistRow;
  onToggle: (id: string, done: boolean) => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-secondary/70">
        <input
          type="checkbox"
          checked={item.done}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--color-accent)]"
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={item.done ? "text-muted-foreground line-through" : ""}>
            {item.label}
          </span>
          {item.grp && (
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
              {item.grp.replace(/_/g, " ").toLowerCase()}
            </span>
          )}
          {!item.required && <span className="text-[11px] text-muted-foreground">Optional</span>}
        </span>
      </label>
    </li>
  );
}

function Checklist() {
  const { loading, hasProject, project, bundle, refetch } = useActiveProjectBundle();

  const all = bundle?.checklist ?? [];
  const preApp = useMemo(() => all.filter((c) => c.kind === "pre_app"), [all]);
  const byPermit = useMemo(() => {
    const map: Record<string, ChecklistRow[]> = {};
    for (const item of all.filter((c) => c.kind !== "pre_app")) {
      const key = item.permit_key ?? "general";
      (map[key] ??= []).push(item);
    }
    return map;
  }, [all]);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const permitName = (key: string) =>
    (bundle?.permits ?? []).find((p) => p.permit_key === key)?.name ?? key;

  async function toggle(id: string, done: boolean) {
    await setChecklistDone(id, done);
    refetch();
  }

  const submissionItems = all.filter((c) => c.kind !== "pre_app");
  const overall = checklistCompletion(submissionItems);
  const preAppPct = checklistCompletion(preApp);

  return (
    <div className="grid gap-5">
      <Section
        title="Pre-application checklist"
        subtitle={`Complete these before submitting anything · ${preAppPct}% done`}
        right={
          <button className="btn-outline text-sm" onClick={() => window.print()}>
            Export / print
          </button>
        }
      >
        {preApp.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pre-application items.</p>
        ) : (
          <ul className="-mx-2.5 grid gap-0.5 text-sm">
            {preApp.map((item) => (
              <Item key={item.id} item={item} onToggle={toggle} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="City-specific submission checklists"
        subtitle={`Overall completion: ${overall}% of required items`}
      >
        <div className="grid gap-4">
          {Object.entries(byPermit).map(([key, items]) => {
            const pct = checklistCompletion(items);
            return (
              <div
                key={key}
                className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">{permitName(key)}</div>
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {pct}% done
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="progress-fill h-full rounded-full bg-accent"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <ul className="-mx-2.5 mt-2 grid gap-0.5 text-sm">
                  {items.map((item) => (
                    <Item key={item.id} item={item} onToggle={toggle} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
