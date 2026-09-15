import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useActiveProjectBundle } from "@/hooks/use-project";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notifications";
import { Section, Pill, EmptyProject, Loading, humanize } from "@/components/dp-ui";
import { dateShort } from "@/lib/format";

export const Route = createFileRoute("/dashboard/_layout/notifications")({
  head: () => ({ meta: [{ title: "Alerts & Notifications — CorvusDP" }] }),
  component: Notifications,
});

function Notifications() {
  const { loading, hasProject, project } = useActiveProjectBundle();
  const projectId = project?.id;
  const q = useQuery({
    queryKey: ["notifications", projectId],
    queryFn: () => listNotifications(projectId!),
    enabled: !!projectId,
  });

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const rows = q.data ?? [];
  const unread = rows.filter((n) => !n.read).length;

  return (
    <Section
      title="Alerts & notifications"
      subtitle={
        unread
          ? `${unread} unread — in-app only on this build (no email/SMS transport).`
          : "You're all caught up."
      }
      right={
        unread > 0 ? (
          <button
            className="btn-outline text-sm"
            onClick={async () => {
              await markAllNotificationsRead(projectId!);
              q.refetch();
            }}
          >
            Mark all read
          </button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notifications yet.</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((n, i) => (
            <li
              key={n.id}
              className={`list-item-enter rounded-lg border p-3 text-sm ${n.read ? "border-border" : "border-accent/40 bg-accent/5"}`}
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Pill
                    tone={
                      n.kind === "permit_status"
                        ? "blue"
                        : n.kind === "engagement"
                          ? "amber"
                          : "gray"
                    }
                  >
                    {humanize(n.kind)}
                  </Pill>
                  <span className="font-medium">{n.title}</span>
                </div>
                <span className="text-xs text-muted-foreground">{dateShort(n.created_at)}</span>
              </div>
              {n.body && <p className="mt-1 text-muted-foreground">{n.body}</p>}
              {!n.read && (
                <button
                  className="mt-1 text-xs text-accent underline underline-offset-2"
                  onClick={async () => {
                    await markNotificationRead(n.id);
                    q.refetch();
                  }}
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
