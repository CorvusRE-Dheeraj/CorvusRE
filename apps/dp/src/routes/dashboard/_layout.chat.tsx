import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { listProjects, listArchivedProjects } from "@/lib/projects";
import {
  listDesignRequests,
  listArchivedDesignRequests,
  designRequestName,
} from "@/lib/design-requests";
import { myUnreadCounts } from "@/lib/project-chat";
import { ProjectChat } from "@/components/ProjectChat";
import { Section, Pill, Loading } from "@/components/dp-ui";

type ChatSearch = { type?: "permitting" | "design"; id?: string };

// Project Chat for the client: their projects on the left, the selected
// project's conversation with the CorvusDP team on the right.
export const Route = createFileRoute("/dashboard/_layout/chat")({
  head: () => ({ meta: [{ title: "Project Chat — CorvusDP" }] }),
  validateSearch: (s: Record<string, unknown>): ChatSearch => ({
    type: s.type === "design" ? "design" : s.type === "permitting" ? "permitting" : undefined,
    id: typeof s.id === "string" ? s.id : undefined,
  }),
  component: Chat,
});

type Entry = { kind: "permitting" | "design"; id: string; name: string; closed: boolean };

function Chat() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const nav = useNavigate();
  const enabled = !!user?.id;
  const q = useQuery({
    queryKey: ["chat-projects", user?.id],
    enabled,
    queryFn: async (): Promise<Entry[]> => {
      const [p, pa, d, da] = await Promise.all([
        listProjects(user!.id),
        listArchivedProjects(user!.id),
        listDesignRequests(user!.id),
        listArchivedDesignRequests(user!.id),
      ]);
      return [
        ...p.map((x) => ({
          kind: "permitting" as const,
          id: x.id,
          name: x.name ?? x.address ?? "Property",
          closed: false,
        })),
        ...d.map((x) => ({
          kind: "design" as const,
          id: x.id,
          name: designRequestName(x),
          closed: false,
        })),
        ...pa.map((x) => ({
          kind: "permitting" as const,
          id: x.id,
          name: x.name ?? x.address ?? "Property",
          closed: true,
        })),
        ...da.map((x) => ({
          kind: "design" as const,
          id: x.id,
          name: designRequestName(x),
          closed: true,
        })),
      ];
    },
  });
  const unread = useQuery({
    queryKey: ["project-chat-unread", user?.id],
    queryFn: myUnreadCounts,
    enabled,
    refetchInterval: 15000,
  });

  if (q.isLoading) return <Loading />;
  const entries = q.data ?? [];
  if (entries.length === 0)
    return (
      <Section title="Project Chat">
        <p className="text-sm text-muted-foreground">
          Start a permitting or design project and you can chat with our team about it here.
        </p>
      </Section>
    );
  const selected =
    entries.find((e) => e.id === search.id) ??
    entries.find((e) => !e.closed && (!search.type || e.kind === search.type)) ??
    entries[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      <Section title="Your projects">
        <ul className="grid gap-1">
          {entries.map((e) => {
            const n = unread.data?.[e.id] ?? 0;
            const on = e.id === selected.id;
            return (
              <li key={e.id}>
                <button
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
                    on ? "bg-nav-highlight text-nav-highlight-foreground" : "hover:bg-secondary"
                  }`}
                  onClick={() =>
                    nav({ to: ".", search: { type: e.kind, id: e.id }, resetScroll: false })
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {e.kind === "design" ? "Design" : "Permitting"}
                      {e.closed ? " · Completed" : ""}
                    </span>
                  </span>
                  {n > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
                      {n}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section
        title={selected.name}
        subtitle="Ask the CorvusDP team anything about this project. Messages are kept until the project is completed."
        right={
          <Pill tone={selected.closed ? "green" : "gray"}>
            {selected.closed ? "Completed" : selected.kind === "design" ? "Design" : "Permitting"}
          </Pill>
        }
      >
        <ProjectChat
          key={selected.id}
          thread={{ kind: selected.kind, id: selected.id }}
          as="client"
          closed={selected.closed}
        />
      </Section>
    </div>
  );
}
