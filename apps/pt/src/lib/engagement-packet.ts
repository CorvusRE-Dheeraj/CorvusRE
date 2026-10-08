import { supabase } from "./supabase";
import { getActiveWorkspace } from "./active-account";
import { invokeEdgeFunction } from "./edge-functions";
import { AI_ACK_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "./legal";
import { SERVICE_AGREEMENT_VERSION } from "./service-agreement";
import type { SignatureValue } from "@/components/SignaturePad";

// The CorvusPT Engagement Packet: every agreement in one place, signed once with
// one signature that's then applied to each property's Service Agreement and
// Appointment of Agent (Form 50-162) when the owner asks for a protest. Mirrors
// supabase/pt/functions/_shared/engagement-packet.ts — keep PACKET_VERSION and
// PACKET_CONSENT_TEXT identical by hand; the server refuses a version mismatch.

export const PACKET_VERSION = [
  "packet-2026-10-06",
  TERMS_VERSION,
  PRIVACY_VERSION,
  SERVICE_AGREEMENT_VERSION,
  AI_ACK_VERSION,
].join("|");

export const PACKET_CONSENT_TEXT =
  "By clicking Submit, I confirm that I am the property owner or am legally authorized to act for the property owner, that I have read the documents in the CorvusPT Engagement Packet (Terms of Service, Privacy Policy, CorvusPT Service Agreement, Appointment of Agent for Property Tax Matters (Form 50-162), and AI Acknowledgement), and that I agree to be bound by them. I understand I am signing electronically, and I authorize CorvusPT to apply this electronic signature to the Service Agreement and to the Appointment of Agent (Form 50-162) for each property I ask CorvusPT to protest.";

// The brief summaries shown above the signature. `doc` names what "Read the full
// document" opens — see EngagementPacketForm.
export type PacketDocument = {
  doc: "terms" | "service-agreement" | "appointment" | "ai-ack";
  title: string;
  summary: string;
};

export const PACKET_DOCUMENTS: PacketDocument[] = [
  {
    doc: "terms",
    title: "Terms of Service & Privacy Policy",
    summary:
      "How you may use the CorvusPT platform, what we do with your information, and the limits of what the platform provides.",
  },
  {
    doc: "service-agreement",
    title: "CorvusPT Service Agreement",
    summary:
      "The services CorvusPT provides for each property you ask us to protest, what you're responsible for, and that no reduction or savings is guaranteed. A copy is saved to each property's Documents when you start its protest.",
  },
  {
    doc: "appointment",
    title: "Appointment of Agent for Property Tax Matters (Form 50-162)",
    summary:
      "The Texas Comptroller form that lets CorvusPT act as your agent with the appraisal district — filing, negotiating, and attending hearings — for each property you ask us to protest. Your signature below is applied to the form for each of those properties.",
  },
  {
    doc: "ai-ack",
    title: "AI Acknowledgement",
    summary:
      "CorvusPT uses AI-assisted analysis that may contain errors and doesn't guarantee a reduction or any particular savings. You remain responsible for verifying important information and deadlines.",
  },
];

export type SigneeRole = "owner" | "representative";

export const SIGNEE_ROLE_LABEL: Record<SigneeRole, string> = {
  owner: "the property owner",
  representative: "an authorized representative",
};

export type EngagementPacket = {
  id: string;
  packetVersion: string;
  firstName: string;
  lastName: string;
  title: string;
  role: SigneeRole;
  companyName: string | null;
  email: string | null;
  phone: string;
  signature: SignatureValue;
  signedAt: string;
};

type PacketRow = {
  id: string;
  packet_version: string;
  signee_first_name: string;
  signee_last_name: string;
  signee_title: string;
  signee_role: SigneeRole;
  company_name: string | null;
  email: string | null;
  phone: string;
  signature_type: "draw" | "type";
  signature_data: string;
  signed_at: string;
};

const PACKET_COLUMNS =
  "id, packet_version, signee_first_name, signee_last_name, signee_title, signee_role, company_name, email, phone, signature_type, signature_data, signed_at";

function fromRow(row: PacketRow): EngagementPacket {
  return {
    id: row.id,
    packetVersion: row.packet_version,
    firstName: row.signee_first_name,
    lastName: row.signee_last_name,
    title: row.signee_title,
    role: row.signee_role,
    companyName: row.company_name,
    email: row.email,
    phone: row.phone,
    signature: { type: row.signature_type, data: row.signature_data } as SignatureValue,
    signedAt: row.signed_at,
  };
}

// The signed-in user's most recent signing, current or not (RLS scopes it).
export async function getMyLatestPacket(): Promise<EngagementPacket | null> {
  const { data, error } = await supabase
    .from("engagement_packets")
    .select(PACKET_COLUMNS)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as PacketRow) : null;
}

export function isPacketCurrent(packet: EngagementPacket | null): boolean {
  return !!packet && packet.packetVersion === PACKET_VERSION;
}

export type PacketSubmission = {
  firstName: string;
  lastName: string;
  title: string;
  role: SigneeRole;
  companyName: string;
  phone: string;
  signature: SignatureValue;
};

export async function signEngagementPacket(input: PacketSubmission): Promise<EngagementPacket> {
  const row = await invokeEdgeFunction<PacketRow>("record-engagement-packet", {
    ...input,
    packetVersion: PACKET_VERSION,
  });
  const packet = fromRow(row);
  // Anything gated on the packet (the first-visit pop-up, the Agreements tab)
  // refreshes on this rather than each keeping its own copy in sync.
  window.dispatchEvent(new CustomEvent(PACKET_SIGNED_EVENT, { detail: packet }));
  return packet;
}

export const PACKET_SIGNED_EVENT = "corvuspt:packet-signed";
export const OPEN_PACKET_EVENT = "corvuspt:open-packet";

// Opens the packet pop-up from anywhere (the Agreements tab, a filing flow).
// `required` swaps "Skip for now" for "Cancel" and leads with "Please complete
// the service agreement form". Resolves with the signed packet, or null if the
// person closed it without signing.
export function openPacketDialog(opts: { required: boolean }): Promise<EngagementPacket | null> {
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent(OPEN_PACKET_EVENT, { detail: { required: opts.required, resolve } }),
    );
  });
}

// What every filing step calls before anything that needs a signature: returns
// the current signed packet, prompting for it first if there isn't one.
export async function requirePacket(): Promise<EngagementPacket | null> {
  // A team member in an owner's account never files with anyone's signature:
  // the Notice of Protest is signed by the owner, from their own login.
  if (getActiveWorkspace()) return openPacketDialog({ required: true });
  const latest = await getMyLatestPacket().catch(() => null);
  if (latest && isPacketCurrent(latest)) return latest;
  return openPacketDialog({ required: true });
}

// "Skip for now" on the first-visit pop-up is remembered per account and packet
// version, so it doesn't come back every page load — but it does come back once
// the packet changes. Local only: it's a convenience, not a record of anything.
function skipKey(userId: string): string {
  return `corvuspt.packetSkipped.${userId}.${PACKET_VERSION}`;
}

export function wasPacketSkipped(userId: string): boolean {
  try {
    return localStorage.getItem(skipKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function rememberPacketSkipped(userId: string): void {
  try {
    localStorage.setItem(skipKey(userId), "1");
  } catch {
    // storage blocked — the pop-up just shows again next visit
  }
}
