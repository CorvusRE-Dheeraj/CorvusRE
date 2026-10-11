// The engagement packet's versions and consent wording — the server-side copy of
// apps/pt/src/lib/engagement-packet.ts (a Deno function can't import from src/).
// Keep the two identical by hand: the client shows this text, the server stores
// it with the signature, and record-engagement-packet refuses a signing whose
// packetVersion doesn't match PACKET_VERSION here.
import { SERVICE_AGREEMENT_VERSION } from "./service-agreement.ts";

export const TERMS_VERSION = "2026-09-07";
export const PRIVACY_VERSION = "2026-09-07";
export const SIGNUP_ACK_VERSION = "2026-09-07";
export const AI_ACK_VERSION = "2026-09-07";

// Changes whenever any document in the packet changes, which re-prompts everyone.
export const PACKET_VERSION = [
  "packet-2026-10-06",
  TERMS_VERSION,
  PRIVACY_VERSION,
  SERVICE_AGREEMENT_VERSION,
  AI_ACK_VERSION,
].join("|");

// Same summaries as the client's PACKET_DOCUMENTS — what the signer saw above the
// signature, reproduced in the signed copy emailed to them.
export const PACKET_DOCUMENTS: { title: string; summary: string }[] = [
  {
    title: "Terms of Service & Privacy Policy",
    summary:
      "How you may use the CorvusPT platform, what we do with your information, and the limits of what the platform provides.",
  },
  {
    title: "CorvusPT Service Agreement",
    summary:
      "The services CorvusPT provides for each property you ask us to protest, what you're responsible for, and that no reduction or savings is guaranteed. A copy is saved to each property's Documents when you start its protest.",
  },
  {
    title: "Appointment of Agent for Property Tax Matters (Form 50-162)",
    summary:
      "The Texas Comptroller form that lets CorvusPT act as your agent with the appraisal district — filing, negotiating, and attending hearings — for each property you ask us to protest. Your signature below is applied to the form for each of those properties.",
  },
  {
    title: "AI Acknowledgement",
    summary:
      "CorvusPT uses AI-assisted analysis that may contain errors and doesn't guarantee a reduction or any particular savings. You remain responsible for verifying important information and deadlines.",
  },
];

export const PACKET_CONSENT_TEXT =
  "By clicking Submit, I confirm that I am the property owner or am legally authorized to act for the property owner, that I have read the documents in the CorvusPT Engagement Packet (Terms of Service, Privacy Policy, CorvusPT Service Agreement, Appointment of Agent for Property Tax Matters (Form 50-162), and AI Acknowledgement), and that I agree to be bound by them. I understand I am signing electronically, and I authorize CorvusPT to apply this electronic signature to the Service Agreement and to the Appointment of Agent (Form 50-162) for each property I ask CorvusPT to protest.";
