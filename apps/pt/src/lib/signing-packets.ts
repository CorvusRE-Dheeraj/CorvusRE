import { rgb, StandardFonts, type PDFDocument } from "pdf-lib";
import { supabase } from "./supabase";

// Signing packet tracking IDs (supabase/pt/signing-packets.sql): every
// e-signature gets a permanent ID like CPT-7F3K-9Q2M, registered by the
// database with who signed, when, from where, and a fingerprint of the record
// as signed. Anyone can check an ID at /verify.
//
// Where a signed PDF is built before the signature is saved (protest forms,
// settlement, BPP rendition), the ID is made here first so it can be printed
// on the PDF, then sent with the signing as `signing_tracking_id` — the
// database accepts it if it's well formed and unused (and issues its own
// otherwise; signing never fails over it).

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
export const TRACKING_ID_RE = /^CPT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function newTrackingId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const s = [...bytes].map((b) => ALPHABET[b % 32]).join("");
  return `CPT-${s.slice(0, 4)}-${s.slice(4)}`;
}

// "cpt 7f3k 9q2m" / "CPT-7F3K-9Q2M" → "CPT-7F3K-9Q2M" (null if it can't be one)
export function normalizeTrackingId(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const body = raw.startsWith("CPT") ? raw.slice(3) : raw;
  if (body.length !== 8) return null;
  const id = `CPT-${body.slice(0, 4)}-${body.slice(4)}`;
  return TRACKING_ID_RE.test(id) ? id : null;
}

export function verifyUrl(trackingId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://corvusre.com";
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return `${origin}${base}/verify?id=${encodeURIComponent(trackingId)}`;
}

export type VerifiedPacket = {
  trackingId: string;
  title: string;
  kind: string;
  signedAt: string;
  signer: string | null; // first name + last initial
  fingerprint: string;
};

// Public check (no sign-in needed).
export async function verifySigningPacket(trackingId: string): Promise<VerifiedPacket | null> {
  const { data, error } = await supabase.rpc("verify_signing_packet", {
    p_tracking_id: trackingId,
  });
  if (error) throw error;
  const row = (
    data as
      | {
          tracking_id: string;
          title: string;
          kind: string;
          signed_at: string;
          signer: string | null;
          fingerprint: string;
        }[]
      | null
  )?.[0];
  return row
    ? {
        trackingId: row.tracking_id,
        title: row.title,
        kind: row.kind,
        signedAt: row.signed_at,
        signer: row.signer,
        fingerprint: row.fingerprint,
      }
    : null;
}

// Prints the tracking ID along the bottom of every page of a signed PDF.
export async function stampTrackingId(doc: PDFDocument, trackingId: string): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = `CorvusPT signing packet ${trackingId} · verify at ${verifyUrl(trackingId).replace(/^https?:\/\//, "")}`;
  for (const page of doc.getPages()) {
    const { width } = page.getSize();
    const size = 6.5;
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: Math.max(12, (width - w) / 2),
      y: 8,
      size,
      font,
      color: rgb(0.35, 0.35, 0.4),
    });
  }
}

export type MySigningPacket = {
  trackingId: string;
  title: string;
  kind: string;
  signedAt: string;
  signerName: string | null;
};

// Everything this user has signed, newest first. Filtered by user: RLS also
// lets admins read everyone's.
export async function listMySigningPackets(userId: string): Promise<MySigningPacket[]> {
  const { data, error } = await supabase
    .from("signing_packets")
    .select("tracking_id, title, kind, signed_at, signer_name")
    .eq("user_id", userId)
    .order("signed_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (
    (data ?? []) as {
      tracking_id: string;
      title: string;
      kind: string;
      signed_at: string;
      signer_name: string | null;
    }[]
  ).map((r) => ({
    trackingId: r.tracking_id,
    title: r.title,
    kind: r.kind,
    signedAt: r.signed_at,
    signerName: r.signer_name,
  }));
}
