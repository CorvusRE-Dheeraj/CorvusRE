// "Your signed documents" — sent by record-engagement-packet right after someone
// signs the Engagement Packet: a short confirmation with a link to the client
// portal, and an HTML copy of exactly what they signed attached. Never throws —
// the signing itself is already recorded, and a failed email must not undo or
// re-surface it as an error.
import { emailShell, escapeHtml } from "./email-shell.ts";
import { loginUrl } from "./app-url.ts";
import { PACKET_CONSENT_TEXT, PACKET_DOCUMENTS } from "./engagement-packet.ts";
import {
  CORVUSPT_CONTACT,
  CORVUSPT_LEGAL_ENTITY,
  SERVICE_AGREEMENT_SECTIONS,
  SERVICE_AGREEMENT_VERSION,
} from "./service-agreement.ts";

export type SignedPacket = {
  firstName: string;
  lastName: string;
  title: string;
  role: "owner" | "representative";
  companyName: string | null;
  email: string;
  phone: string;
  signatureType: "draw" | "type";
  signatureData: string;
  signedAt: string;
  ipAddress: string | null;
  packetVersion: string;
};

const ROLE_LABEL = {
  owner: "the property owner",
  representative: "an authorized representative",
} as const;

function signedAtLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "long",
    timeStyle: "short",
  }) + " (Central)";
}

// The attached copy: a standalone HTML page of the packet as signed.
function renderSignedCopy(p: SignedPacket): string {
  const e = escapeHtml;
  const signature =
    p.signatureType === "draw"
      ? `<img src="${e(p.signatureData)}" alt="Signature" style="height:64px;">`
      : `<span style="font-family:Georgia,serif; font-style:italic; font-size:28px;">${e(p.signatureData)}</span>`;
  const docs = PACKET_DOCUMENTS.map(
    (d) => `<h3 style="margin:16px 0 4px;">${e(d.title)}</h3><p style="margin:0; color:#42506a;">${e(d.summary)}</p>`,
  ).join("");
  const agreement = SERVICE_AGREEMENT_SECTIONS.map(
    (s) =>
      `<h4 style="margin:12px 0 4px;">${e(s.n)}. ${e(s.title)}</h4>${s.body
        .map((b) => `<p style="margin:0 0 6px; color:#42506a;">${e(b)}</p>`)
        .join("")}`,
  ).join("");
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 16px 4px 0; color:#67788f;">${e(k)}</td><td style="padding:4px 0;">${e(v)}</td></tr>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>CorvusPT Engagement Packet — signed</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#16233a; max-width:760px; margin:32px auto; padding:0 16px; line-height:1.5;">
<h1 style="margin:0 0 4px;">CorvusPT Engagement Packet</h1>
<p style="margin:0 0 20px; color:#67788f;">Signed copy · packet version ${e(p.packetVersion)}</p>
<table style="font-size:14px; border-collapse:collapse;">
${row("Signed by", `${p.firstName} ${p.lastName}`)}
${row("Title", p.title)}
${row("Signing as", ROLE_LABEL[p.role])}
${p.companyName ? row("Company / entity", p.companyName) : ""}
${row("Email", p.email)}
${row("Phone", p.phone)}
${row("Signed on", signedAtLabel(p.signedAt))}
${p.ipAddress ? row("IP address", p.ipAddress) : ""}
</table>
<h2 style="margin:28px 0 4px;">Documents in this packet</h2>
${docs}
<h2 style="margin:28px 0 4px;">Consent</h2>
<p style="margin:0;">${e(PACKET_CONSENT_TEXT)}</p>
<div style="margin:20px 0; padding:16px; border:1px solid #e2e8ef; border-radius:8px;">
<div style="font-size:12px; color:#67788f; margin-bottom:6px;">Electronic signature</div>
${signature}
</div>
<h2 style="margin:28px 0 4px;">CorvusPT Service Agreement (version ${e(SERVICE_AGREEMENT_VERSION)})</h2>
${agreement}
<p style="margin:28px 0 0; font-size:12px; color:#67788f;">${e(CORVUSPT_LEGAL_ENTITY)} · ${e(CORVUSPT_CONTACT.address)} · ${e(CORVUSPT_CONTACT.phone)} · ${e(CORVUSPT_CONTACT.email)}</p>
</body></html>`;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function sendSignedPacketEmail(p: SignedPacket): Promise<void> {
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("Missing RESEND_API_KEY");
    if (!p.email) return;

    const html = emailShell({
      eyebrow: "Signed documents",
      heading: "Your signed CorvusPT documents",
      intro:
        `Thanks, ${escapeHtml(p.firstName)} — your CorvusPT Engagement Packet was signed on ` +
        `${escapeHtml(signedAtLabel(p.signedAt))}. A copy of everything you signed is attached. ` +
        `Log in to your client portal to access your property dashboard and get started.`,
      bodyRows: PACKET_DOCUMENTS.map(
        (d) =>
          `<tr><td style="padding:6px 0; vertical-align:top; width:22px;">✓</td><td style="padding:6px 0;"><strong>${escapeHtml(d.title)}</strong></td></tr>`,
      ).join(""),
      ctaLabel: "Open your client portal",
      ctaHref: loginUrl("/dashboard"),
      footnote:
        "Each property's own Service Agreement copy is saved to that property's Documents when its protest starts. You can review what you signed any time from the Agreements tab. You manage the protest. CorvusPT helps make it easier.",
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "CorvusPT <info@corvusre.com>",
        to: p.email,
        subject: "Your signed CorvusPT documents",
        html,
        attachments: [
          {
            filename: "CorvusPT-Engagement-Packet-signed.html",
            content: toBase64(renderSignedCopy(p)),
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`Resend error ${res.status} sending signed documents:`, await res.text());
    }
  } catch (err) {
    console.error("Signed documents email failed (signing itself is recorded):", err);
  }
}
