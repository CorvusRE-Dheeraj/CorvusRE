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
    <li className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => onToggle(item.id, e.target.checked)}
        className="mt-0.5"
      />
      <span className={item.done ? "text-muted-foreground line-through" : ""}>
        {item.label}
        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {item.grp}
        </span>
        {!item.required && <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}
      </span>
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
          <ul className="grid gap-1.5 text-sm">
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
              <div key={key} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{permitName(key)}</div>
                  <span className="text-xs text-muted-foreground">{pct}%</span>
                </div>
                <ul className="mt-2 grid gap-1.5 text-sm">
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
