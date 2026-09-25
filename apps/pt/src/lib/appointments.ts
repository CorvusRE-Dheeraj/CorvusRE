import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { slotLabel } from "./appointment-rules";

export type MeetingType = "call" | "virtual";

// ── Visitors: open slots and booking (edge functions; work signed-out) ──
export type OpenSlots = { days: Record<string, string[]>; from: string; to: string };

export async function fetchOpenSlots(): Promise<OpenSlots> {
  return invokeEdgeFunction<OpenSlots>("appointment-slots", {});
}

export type BookingInput = {
  name: string;
  email: string;
  phone: string;
  meetingType: MeetingType;
  notes: string;
  date: string; // YYYY-MM-DD, Central
  slot: string; // "10:00" (Central)
  // Hidden honeypot — must stay empty.
  website?: string;
};

export async function bookAppointment(
  input: BookingInput,
): Promise<{ ok: boolean; emailed: boolean }> {
  return invokeEdgeFunction<{ ok: boolean; emailed: boolean }>("book-appointment", input);
}

// ── Admin: read and manage (RLS: admins only) ──
export type AppointmentRecord = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  meetingType: MeetingType;
  notes: string | null;
  startAt: string;
  endAt: string;
  status: "booked" | "cancelled";
  createdAt: string;
};

type AppointmentRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  meeting_type: MeetingType;
  notes: string | null;
  start_at: string;
  end_at: string;
  status: "booked" | "cancelled";
  created_at: string;
};

export async function listAppointments(): Promise<AppointmentRecord[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, name, email, phone, meeting_type, notes, start_at, end_at, status, created_at")
    .order("start_at", { ascending: true });
  if (error) throw error;
  return (data as AppointmentRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    meetingType: r.meeting_type,
    notes: r.notes,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export async function cancelAppointment(id: string): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export type AppointmentBlock = {
  id: string;
  date: string;
  slot: string | null;
  note: string | null;
};

export async function listBlocks(): Promise<AppointmentBlock[]> {
  const { data, error } = await supabase
    .from("appointment_blocks")
    .select("id, block_date, slot, note")
    .order("block_date", { ascending: true });
  if (error) throw error;
  return (
    data as { id: string; block_date: string; slot: string | null; note: string | null }[]
  ).map((r) => ({ id: r.id, date: r.block_date, slot: r.slot, note: r.note }));
}

export async function addBlock(input: {
  date: string;
  slot: string | null;
  note: string;
}): Promise<void> {
  const { error } = await supabase.from("appointment_blocks").insert({
    block_date: input.date,
    slot: input.slot,
    note: input.note.trim() || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("That day or time is already blocked.");
    throw error;
  }
}

export async function removeBlock(id: string): Promise<void> {
  const { error } = await supabase.from("appointment_blocks").delete().eq("id", id);
  if (error) throw error;
}

// ── Display ──
// "Thursday, Oct 1, 2026 · 10:00 AM CT" for a stored instant.
export function formatAppointment(startAt: string): string {
  const d = new Date(startAt);
  const date = d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time} CT`;
}

export const formatSlotDay = (date: string, slot: string) =>
  `${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  })} at ${slotLabel(slot)} CT`;

// Local-calendar date ⇄ "YYYY-MM-DD" (no timezone shifting).
export const toIsoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromIsoLocal = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
