// One place every CorvusDP transactional email goes through Resend from —
// same provider/pattern as the CorvusPT door, reusing the same verified
// corvusre.com sending domain (a separate RESEND_API_KEY secret is still
// required on this project; Supabase secrets can't be copied across
// projects, only re-entered).
export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) throw new Error("Missing RESEND_API_KEY");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "CorvusDP <info@corvusre.com>",
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend error ${res.status}: ${text.slice(0, 300)}`);
  }
}

export function appUrl(): string {
  return Deno.env.get("APP_URL") ?? "https://corvusre.com/corvusdp";
}
