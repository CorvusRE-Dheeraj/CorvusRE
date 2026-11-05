import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { listAllThreads, type AdminChatThread } from "@/lib/project-chat";
import { ProjectChat } from "@/components/ProjectChat";
import { Section, Pill } from "@/components/dp-ui";

type ThreadInfo = AdminChatThread & { name: string; closed: boolean; client: string };

const timeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Staff console → Chat: every project conversation, newest first, with the
// number of client messages nobody on the team has read yet.
export function AdminProjectChat() {
  const threads = useQuery({
    queryKey: ["admin", "chat-threads"],
    refetchInterval: 15000,
    queryFn: async (): Promise<ThreadInfo[]> => {
      const all = await listAllThreads();
      const pIds = all.filter((t) => t.kind === "permitting").map((t) => t.id);
      const dIds = all.filter((t) => t.kind === "design").map((t) => t.id);
      const owners = [...new Set(all.map((t) => t.ownerId))];
      const [p, d, o] = await Promise.all([
        pIds.length
          ? supabase.from("projects").select("id, name, address, completed_at").in("id", pIds)
          : { data: [] },
        dIds.length
          ? supabase
              .from("design_requests")
              .select("id, project_name, address, city, completed_at")
              .in("id", dIds)
          : { data: [] },
        owners.length
          ? supabase.from("profiles").select("id, email, first_name, last_name").in("id", owners)
          : { data: [] },
      ]);
      type Row = Record<string, string | null>;
      const byId = new Map<string, Row>(
        [...((p.data ?? []) as Row[]), ...((d.data ?? []) as Row[])].map((r) => [r.id!, r]),
      );
      const people = new Map<string, Row>(((o.data ?? []) as Row[]).map((r) => [r.id!, r]));
      return all.map((t) => {
        const r = byId.get(t.id) ?? {};
        const who = people.get(t.ownerId) ?? {};
        return {
          ...t,
          name: r.project_name ?? r.name ?? r.address ?? r.city ?? "Project",
          closed: !!r.completed_at,
          client:
            [who.first_name, who.last_name].filter(Boolean).join(" ") || who.email || "Client",
        };
      });
    },
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = threads.data ?? [];
  const selected = list.find((t) => t.id === selectedId) ?? list[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
      <Section title={`Conversations (${list.length})`}>
        {threads.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No client has written yet.</p>
        ) : (
          <ul className="grid gap-1">
            {list.map((t) => (
              <li key={t.id}>
                <button
                  className={`w-full overflow-hidden rounded-md px-2.5 py-2 text-left text-sm ${
                    t.id === selected?.id
                      ? "bg-nav-highlight text-nav-highlight-foreground"
                      : "hover:bg-secondary"
                  }`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    {t.unread > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
                        {t.unread}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.client} · {t.kind === "design" ? "Design" : "Permitting"} ·{" "}
                    {timeFmt.format(new Date(t.lastAt))}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.lastFrom === "staff" ? "You: " : ""}
                    {t.lastBody}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {selected && (
        <Section
          title={selected.name}
          subtitle={`${selected.client} · ${selected.kind === "design" ? "Design project" : "Permitting project"}`}
          right={selected.closed ? <Pill tone="green">Completed</Pill> : undefined}
        >
          <ProjectChat
            key={selected.id}
            thread={{ kind: selected.kind, id: selected.id }}
            as="staff"
            closed={selected.closed}
            clientName={selected.client}
          />
        </Section>
      )}
    </div>
  );
}

/** Unread client messages across all threads, for the tab badge. */
export function useAdminChatUnread(enabled: boolean): number {
  const q = useQuery({
    queryKey: ["admin", "chat-unread"],
    enabled,
    refetchInterval: 30000,
    queryFn: async () => {
      const { count } = await supabase
        .from("project_messages")
        .select("id", { count: "exact", head: true })
        .eq("sender_role", "client")
        .is("read_at", null);
      return count ?? 0;
    },
  });
  return q.data ?? 0;
}
