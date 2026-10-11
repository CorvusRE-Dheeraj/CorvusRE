import { invokeEdgeFunction } from "./edge-functions";

// County emails sent to CorvusPT's agent address (properties@srclandbuilding.com)
// are read from that mailbox (connected read-only by an admin) and filed as
// documents of this type under the customer's property — see the
// county-mailbox-admin / sync-county-mailbox edge functions.
export const COUNTY_EMAIL_DOCUMENT_TYPE = "County Email";

export type CountyMailboxStatus = {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  queued: number;
  expectedEmail: string;
};

export type QueuedCountyEmail = {
  id: string;
  from_address: string | null;
  subject: string | null;
  text_excerpt: string | null;
  received_at: string;
  county: string | null;
  file_names: string[];
};

const call = <T>(action: string, extra: Record<string, unknown> = {}) =>
  invokeEdgeFunction<T>("county-mailbox-admin", { action, ...extra });

export const getCountyMailboxStatus = () => call<CountyMailboxStatus>("status");

// Full-page redirect to Google's consent screen (read-only Gmail), returning to
// this admin page — base-path-aware, same pattern as startGoogleCalendarConnect.
export async function startCountyMailboxConnect(): Promise<void> {
  const { authUrl } = await call<{ authUrl: string }>("start", {
    redirectPath: `${import.meta.env.BASE_URL}admin`,
  });
  window.location.href = authUrl;
}

export const checkCountyMailboxNow = () =>
  call<{ checked: number; filed: number; queued: number; ignored: number }>("sync");

export async function listQueuedCountyEmails(): Promise<QueuedCountyEmail[]> {
  return (await call<{ emails: QueuedCountyEmail[] }>("list")).emails;
}

export const assignCountyEmail = (emailId: string, propertyId: string) =>
  call<{ ok: boolean }>("assign", { emailId, propertyId });

export const disconnectCountyMailbox = () => call<{ ok: boolean }>("disconnect");

// CorvusPT's own address for county correspondence — Resend inbound on
// inbox.corvusre.com, read by county-mail-inbound. Given to appraisal districts
// as the agent's email and copied on every email CorvusPT drafts to a county,
// so county replies file themselves under the right case.
export const CORVUSPT_COUNTY_EMAIL = "county@inbox.corvusre.com";
