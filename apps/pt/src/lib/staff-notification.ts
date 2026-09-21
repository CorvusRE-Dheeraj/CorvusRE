import { invokeEdgeFunction } from "./edge-functions";

// Sends staff notifications via Resend (send-staff-notification edge
// function), same as every other transactional email this app sends. Works for a signed-out caller
// too (the /contact page doesn't require sign-in).
export async function notifyStaff(input: {
  subject: string;
  message: string;
  replyToEmail?: string;
  replyToName?: string;
}): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>("send-staff-notification", input);
}
