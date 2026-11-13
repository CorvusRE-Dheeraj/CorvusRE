import { createFileRoute } from "@tanstack/react-router";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { updatePermit } from "@/lib/projects";
import { CheckCircle2, Circle, FileCheck2 } from "lucide-react";
import { Section, Pill, EmptyProject, Loading, inputCls } from "@/components/dp-ui";
import { dateShort } from "@/lib/format";

export const Route = createFileRoute("/dashboard/_layout/approvals")({
  head: () => ({ meta: [{ title: "Approvals — CorvusDP" }] }),
  component: Approvals,
});

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function Approvals() {
  const { loading, hasProject, project, bundle, refetch } = useActiveProjectBundle();
  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const permits = bundle?.permits ?? [];
  const approved = permits.filter((p) => p.status === "approved");
  const total = permits.length;
  const readiness = total ? Math.round((approved.length / total) * 100) : 0;
  const ready = approved.length === total && total > 0;

  const now = new Date();

  return (
    <div className="grid gap-5">
      <Section
        title="Permit approval status"
        subtitle="Permits that have cleared review — numbers, conditions, and expiry. Still in review? Check Permits or Reviews instead."
      >
        {approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved permits yet.</p>
        ) : (
          <div className="grid gap-3">
            {approved.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-card p-4 text-sm shadow-[var(--shadow-card)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
                      <FileCheck2 className="h-4 w-4" aria-hidden />
                    </span>
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Approved {dateShort(p.approved_at)}
                      </div>
                    </div>
                  </div>
                  <Pill tone="green">Approved</Pill>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Permit number</span>
                    <input
                      defaultValue={p.permit_number ?? ""}
                      onBlur={async (e) => {
                        if (e.target.value !== (p.permit_number ?? "")) {
                          await updatePermit(p.id, { permit_number: e.target.value });
                          refetch();
                        }
                      }}
                      placeholder="e.g. BP-2026-01234"
                      className={inputCls}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Expiry date</span>
                    <input
                      type="date"
                      defaultValue={p.expiry_date ?? ""}
                      onBlur={async (e) => {
                        if (e.target.value !== (p.expiry_date ?? "")) {
                          // `|| null`: expiry_date is a `date` column, so
                          // clearing the field posted "" and Postgres rejected
                          // it (400) — the date silently stayed set, with the
                          // rejection surfacing only as an unhandled promise.
                          await updatePermit(p.id, { expiry_date: e.target.value || null });
                          refetch();
                        }
                      }}
                      className={inputCls}
                    />
                  </label>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <label
                      htmlFor={`approval-doc-${p.id}`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Approval document link
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`approval-doc-${p.id}`}
                        defaultValue={p.approval_doc_url ?? ""}
                        placeholder="Paste a link, or upload on the Documents tab"
                        onBlur={async (e) => {
                          if (e.target.value !== (p.approval_doc_url ?? "")) {
                            await updatePermit(p.id, { approval_doc_url: e.target.value });
                            refetch();
                          }
                        }}
                        className={inputCls}
                      />
                      {p.approval_doc_url && (
                        <a
                          href={p.approval_doc_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-outline shrink-0 px-3 py-2 text-sm"
                        >
                          Open
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Pre-construction clearance status">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Overall construction readiness</span>
          <span className="text-muted-foreground">{readiness}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="progress-fill h-full rounded-full bg-accent"
            style={{ width: `${readiness}%` }}
          />
        </div>
        <ul className="mt-4 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
          {permits.map((p) => (
            <li
              key={p.id}
              className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
            >
              {p.status === "approved" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p.status === "approved" ? "Cleared" : "Pending"}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="font-semibold">Ready for construction</span>
          <Pill tone={ready ? "green" : "amber"}>{ready ? "Yes" : "Not yet"}</Pill>
        </div>
      </Section>

      <Section title="Permit expiry tracker">
        {approved.filter((p) => p.expiry_date).length === 0 ? (
          <p className="text-sm text-muted-foreground">No expiry dates recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Permit</th>
                  <th className="px-2 py-2 font-medium">Expiry</th>
                  <th className="px-2 py-2 font-medium">Days remaining</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {approved
                  .filter((p) => p.expiry_date)
                  .map((p) => {
                    const days = daysBetween(now, new Date(p.expiry_date!));
                    return (
                      <tr key={p.id} className="row-hover border-b border-border/60">
                        <td className="px-2 py-2 font-medium">{p.name}</td>
                        <td className="px-2 py-2">{dateShort(p.expiry_date)}</td>
                        <td className="px-2 py-2 tabular-nums">{days}</td>
                        <td className="px-2 py-2">
                          <Pill tone={days < 0 ? "red" : days < 30 ? "amber" : "green"}>
                            {days < 0 ? "Expired" : days < 30 ? "Renewal recommended" : "Active"}
                          </Pill>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
