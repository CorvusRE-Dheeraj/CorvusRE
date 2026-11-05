import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// Project Chat (supabase/dp/project-chat.sql): one thread per project — a
// permitting project or a design project — between the client and CorvusDP
// staff. Kept for the life of the project; read-only once it is completed.

export type ChatThread = { kind: "permitting" | "design"; id: string };

export type ChatMessage = {
  id: string;
  owner_id: string;
  project_id: string | null;
  design_request_id: string | null;
  sender_id: string | null;
  sender_role: "client" | "staff";
  body: string;
  read_at: string | null;
  created_at: string;
};

export const CHAT_MAX_LENGTH = 4000;
const COLS =
  "id, owner_id, project_id, design_request_id, sender_id, sender_role, body, read_at, created_at";

function threadColumn(t: ChatThread) {
  return t.kind === "permitting" ? "project_id" : "design_request_id";
}

export async function listMessages(t: ChatThread): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("project_messages")
    .select(COLS)
    .eq(threadColumn(t), t.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as ChatMessage[]) ?? [];
}

export async function sendMessage(
  t: ChatThread,
  body: string,
  as: "client" | "staff",
): Promise<ChatMessage> {
  const text = body.trim();
  if (!text) throw new Error("Write a message first.");
  if (text.length > CHAT_MAX_LENGTH)
    throw new Error(`Keep it under ${CHAT_MAX_LENGTH} characters.`);
  const { data, error } = await supabase
    .from("project_messages")
    // owner_id and sender_id are filled in by the database (trigger)
    .insert({ [threadColumn(t)]: t.id, sender_role: as, body: text })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  const msg = data as ChatMessage;
  // Email the other side; a failed email never fails the message.
  void invokeEdgeFunction("project-chat-notify", { messageId: msg.id }).catch(() => undefined);
  return msg;
}

/** Marks the other side's messages in this thread as read. */
export async function markThreadRead(t: ChatThread): Promise<void> {
  await supabase.rpc("mark_project_chat_read", {
    p_project: t.kind === "permitting" ? t.id : null,
    p_design: t.kind === "design" ? t.id : null,
  });
}

/** Unread staff replies per thread, for the signed-in client. */
export async function myUnreadCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("project_messages")
    .select("project_id, design_request_id")
    .eq("sender_role", "staff")
    .is("read_at", null);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as {
    project_id: string | null;
    design_request_id: string | null;
  }[]) {
    const k = (r.project_id ?? r.design_request_id)!;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ── Staff side ──

export type AdminChatThread = ChatThread & {
  ownerId: string;
  lastAt: string;
  lastBody: string;
  lastFrom: "client" | "staff";
  unread: number;
};

/** Every thread, most recent first, with unread client messages counted. */
export async function listAllThreads(): Promise<AdminChatThread[]> {
  const { data, error } = await supabase
    .from("project_messages")
    .select(COLS)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  const threads = new Map<string, AdminChatThread>();
  for (const m of (data ?? []) as ChatMessage[]) {
    const id = (m.project_id ?? m.design_request_id)!;
    let t = threads.get(id);
    if (!t) {
      t = {
        kind: m.project_id ? "permitting" : "design",
        id,
        ownerId: m.owner_id,
        lastAt: m.created_at,
        lastBody: m.body,
        lastFrom: m.sender_role,
        unread: 0,
      };
      threads.set(id, t);
    }
    if (m.sender_role === "client" && !m.read_at) t.unread++;
  }
  return [...threads.values()];
}
