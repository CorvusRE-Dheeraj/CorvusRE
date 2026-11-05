import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Send } from "lucide-react";
import {
  listMessages,
  markThreadRead,
  sendMessage,
  CHAT_MAX_LENGTH,
  type ChatThread,
} from "@/lib/project-chat";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// One project's conversation. `as` is the side the viewer writes for: the
// client sees their own messages on the right and the team's on the left;
// staff see it the other way round. New messages are picked up every 8 s.
export function ProjectChat({
  thread,
  as,
  closed,
  clientName,
}: {
  thread: ChatThread;
  as: "client" | "staff";
  closed: boolean;
  /** shown on the client's bubbles in the staff view */
  clientName?: string;
}) {
  const queryClient = useQueryClient();
  const key = ["project-chat", thread.kind, thread.id];
  const messages = useQuery({
    queryKey: key,
    queryFn: () => listMessages(thread),
    refetchInterval: 8000,
  });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const list = messages.data ?? [];
  const other = as === "client" ? "staff" : "client";
  const unreadFromOther = list.some((m) => m.sender_role === other && !m.read_at);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [list.length]);

  useEffect(() => {
    if (!unreadFromOther) return;
    void markThreadRead(thread).then(() => {
      queryClient.invalidateQueries({ queryKey: ["project-chat-unread"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "chat-threads"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "chat-unread"] });
    });
  }, [unreadFromOther, thread, queryClient]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(thread, draft, as);
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["admin", "chat-threads"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "chat-unread"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-[28rem] min-h-48 overflow-y-auto rounded-lg border border-border bg-background p-3">
        {messages.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {as === "client"
              ? "No messages yet. Ask our team anything about this project."
              : "No messages in this project yet."}
          </p>
        ) : (
          <ul className="grid gap-3">
            {list.map((m) => {
              const mine = m.sender_role === as;
              const who =
                m.sender_role === "staff"
                  ? "CorvusDP team"
                  : as === "client"
                    ? "You"
                    : (clientName ?? "Client");
              return (
                <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] ${mine ? "text-right" : ""}`}>
                    <div
                      className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-sm ${
                        mine
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-secondary text-foreground"
                      }`}
                    >
                      {m.body}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {who} · {timeFmt.format(new Date(m.created_at))}
                      {mine && m.read_at ? " · Seen" : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {closed ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" /> This project is completed, so the chat is closed. The
          conversation stays here for your records.
        </p>
      ) : (
        <form onSubmit={send} className="mt-3 grid gap-2">
          <textarea
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            aria-label="Message"
            placeholder={as === "client" ? "Ask our team a question…" : "Reply to the client…"}
            maxLength={CHAT_MAX_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send(e);
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {as === "client"
                ? "Our team is emailed when you write, and you're emailed when we reply."
                : "The client is emailed when you reply."}
            </span>
            <button
              className="btn-accent text-sm disabled:opacity-50"
              disabled={sending || !draft.trim()}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      )}
    </div>
  );
}
