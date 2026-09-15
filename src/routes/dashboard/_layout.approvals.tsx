import { createFileRoute } from "@tanstack/react-router";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { updatePermit } from "@/lib/projects";
import { Section, Pill, EmptyProject, Loading } from "@/components/dp-ui";
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
        subtitle="Approved permits, numbers, and documents (PRD 1.1.28)."
      >
        {approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved permits yet.</p>
        ) : (
          <div className="grid gap-2">
            {approved.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.name}</span>
                  <Pill tone="green">Approved</Pill>
                </div>
                <div className="mt-1 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <span>Approved: {dateShort(p.approved_at)}</span>
                  <span>
                    Permit #:{" "}
                    <input
                      defaultValue={p.permit_number ?? ""}
                      onBlur={async (e) => {
                        if (e.target.value !== (p.permit_number ?? "")) {
                          await updatePermit(p.id, { permit_number: e.target.value });
                          refetch();
                        }
                      }}
                      placeholder="add"
                      className="rounded border border-input bg-background px-1"
                    />
                  </span>
                  <span>
                    Expiry:{" "}
                    <input
                      type="date"
                      defaultValue={p.expiry_date ?? ""}
                      onBlur={async (e) => {
                        if (e.target.value !== (p.expiry_date ?? "")) {
                          await updatePermit(p.id, { expiry_date: e.target.value });
                          refetch();
                        }
                      }}
                      className="rounded border border-input bg-background px-1"
                    />
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Approval document URL:{" "}
                  <input
                    defaultValue={p.approval_doc_url ?? ""}
                    placeholder="paste a link, or upload on the Documents tab"
                    onBlur={async (e) => {
                      if (e.target.value !== (p.approval_doc_url ?? "")) {
                        await updatePermit(p.id, { approval_doc_url: e.target.value });
                        refetch();
                      }
                    }}
                    className="w-full rounded border border-input bg-background px-1"
                  />
                  {p.approval_doc_url && (
                    <a
                      href={p.approval_doc_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-accent underline underline-offset-2"
                    >
                      open
                    </a>
                  )}
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
        <ul className="mt-3 grid gap-1.5 text-sm">
          {permits.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span
                className={`inline-block h-4 w-4 rounded-full ${p.status === "approved" ? "bg-accent" : "border border-border"}`}
              />
              {p.name} — {p.status === "approved" ? "cleared" : "pending"}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm font-semibold">Ready for construction: {ready ? "Yes" : "No"}</p>
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
