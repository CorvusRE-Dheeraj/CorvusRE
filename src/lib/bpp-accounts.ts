import { supabase } from "./supabase";
import type { SignatureValue } from "@/components/SignaturePad";
import type { Tier, PropertyValueBracket } from "./billing";

// Business Personal Property tax accounts — distinct from public.properties (real
// estate): a business can render BPP for a location without owning the real estate
// itself, so this needs its own entity rather than being a filtered property view.
export type BppAccountRecord = {
  id: string;
  businessName: string;
  accountNumber: string | null;
  cad: string | null;
  locationAddress: string | null;
  createdAt: string;
  taxYear: number | null;
  renderedValue: number | null;
  priorValue: number | null;
  // The county's own assessed value, once they respond to the rendition —
  // null until then. A protest only becomes possible once this disagrees
  // with renderedValue (see bppNeedsProtest in this file).
  noticeValue: number | null;
  renditionDeadline: string | null;
  protestDeadline: string | null;
  renditionSignatureType: "draw" | "type" | null;
  renditionSignatureData: string | null;
  renditionSignedAt: string | null;
  renditionFiledAt: string | null;
  estimatedSavings: number | null;
  // This account's own, real, independent Stripe subscription — see
  // cancel-bpp-subscription/create-bpp-checkout-session. Never client-
  // writable (see the column-level UPDATE grant in schema.sql); only the
  // stripe-webhook edge function (service role) ever sets these.
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  planTier: Tier | null;
  valueBracket: PropertyValueBracket | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  autoRefile: boolean;
  autoRefileAuthorizedAt: string | null;
};

type BppAccountRow = {
  id: string;
  business_name: string;
  account_number: string | null;
  cad: string | null;
  location_address: string | null;
  created_at: string;
  tax_year: number | null;
  rendered_value: number | null;
  prior_value: number | null;
  notice_value: number | null;
  rendition_deadline: string | null;
  protest_deadline: string | null;
  rendition_signature_type: "draw" | "type" | null;
  rendition_signature_data: string | null;
  rendition_signed_at: string | null;
  rendition_filed_at: string | null;
  estimated_savings: number | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  plan_tier: Tier | null;
  value_bracket: PropertyValueBracket | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  auto_refile: boolean;
  auto_refile_authorized_at: string | null;
};

const SELECT_COLUMNS =
  "id, business_name, account_number, cad, location_address, created_at, tax_year, rendered_value, prior_value, notice_value, rendition_deadline, protest_deadline, rendition_signature_type, rendition_signature_data, rendition_signed_at, rendition_filed_at, estimated_savings, stripe_subscription_id, subscription_status, plan_tier, value_bracket, cancel_at_period_end, cancel_at, auto_refile, auto_refile_authorized_at";

function fromRow(row: BppAccountRow): BppAccountRecord {
  return {
    id: row.id,
    businessName: row.business_name,
    accountNumber: row.account_number,
    cad: row.cad,
    locationAddress: row.location_address,
    createdAt: row.created_at,
    taxYear: row.tax_year,
    renderedValue: row.rendered_value,
    priorValue: row.prior_value,
    noticeValue: row.notice_value,
    renditionDeadline: row.rendition_deadline,
    protestDeadline: row.protest_deadline,
    renditionSignatureType: row.rendition_signature_type,
    renditionSignatureData: row.rendition_signature_data,
    renditionSignedAt: row.rendition_signed_at,
    renditionFiledAt: row.rendition_filed_at,
    estimatedSavings: row.estimated_savings,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
    planTier: row.plan_tier,
    valueBracket: row.value_bracket,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelAt: row.cancel_at,
    autoRefile: row.auto_refile,
    autoRefileAuthorizedAt: row.auto_refile_authorized_at,
  };
}

export async function listBppAccounts(userId: string): Promise<BppAccountRecord[]> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as BppAccountRow[]).map(fromRow);
}

export async function getBppAccount(id: string): Promise<BppAccountRecord | null> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as BppAccountRow) : null;
}

// April 15 statutory rendition deadline (extendable, but this app doesn't
// track a per-account extension) — this year's if it hasn't passed yet,
// otherwise next year's. Also used by tax-calendar.ts as the calendar's
// fallback event date for an account that has no renditionDeadline of its
// own yet (e.g. one added before this existed).
export function nextBppRenditionDeadline(from: Date = new Date()): string {
  const year = from.getFullYear();
  const thisYearDeadline = new Date(Date.UTC(year, 3, 15));
  const deadline =
    from <= thisYearDeadline ? thisYearDeadline : new Date(Date.UTC(year + 1, 3, 15));
  return deadline.toISOString().slice(0, 10);
}

export async function addBppAccount(
  userId: string,
  account: {
    businessName: string;
    accountNumber?: string;
    cad?: string;
    locationAddress?: string;
    taxYear?: number;
    renderedValue?: number;
    priorValue?: number;
    noticeValue?: number;
    protestDeadline?: string;
    estimatedSavings?: number;
  },
): Promise<BppAccountRecord> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .insert({
      user_id: userId,
      business_name: account.businessName,
      account_number: account.accountNumber ?? null,
      cad: account.cad ?? null,
      location_address: account.locationAddress ?? null,
      tax_year: account.taxYear ?? null,
      rendered_value: account.renderedValue ?? null,
      prior_value: account.priorValue ?? null,
      notice_value: account.noticeValue ?? null,
      rendition_deadline: nextBppRenditionDeadline(),
      protest_deadline: account.protestDeadline ?? null,
      estimated_savings: account.estimatedSavings ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

export async function updateBppAccount(
  id: string,
  patch: {
    businessName?: string;
    accountNumber?: string;
    cad?: string;
    locationAddress?: string;
    taxYear?: number;
    renderedValue?: number;
    priorValue?: number;
    noticeValue?: number;
    protestDeadline?: string;
    estimatedSavings?: number;
  },
): Promise<BppAccountRecord> {
  const update: Record<string, unknown> = {};
  if (patch.businessName !== undefined) update.business_name = patch.businessName;
  if (patch.accountNumber !== undefined) update.account_number = patch.accountNumber;
  if (patch.cad !== undefined) update.cad = patch.cad;
  if (patch.locationAddress !== undefined) update.location_address = patch.locationAddress;
  if (patch.taxYear !== undefined) update.tax_year = patch.taxYear;
  if (patch.renderedValue !== undefined) update.rendered_value = patch.renderedValue;
  if (patch.priorValue !== undefined) update.prior_value = patch.priorValue;
  if (patch.noticeValue !== undefined) update.notice_value = patch.noticeValue;
  if (patch.protestDeadline !== undefined) update.protest_deadline = patch.protestDeadline;
  if (patch.estimatedSavings !== undefined) update.estimated_savings = patch.estimatedSavings;
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update(update)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

// Signs Form 50-144 (see PdfFormEditor / protest-documents.ts) — a rendition
// is filed with the county directly by the owner (there's no ARB process for
// it), so this just records the sign-off; markRenditionFiled below records
// the county actually has it.
export async function signRendition(
  id: string,
  signature: SignatureValue,
): Promise<BppAccountRecord> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update({
      rendition_signature_type: signature.type,
      rendition_signature_data: signature.data,
      rendition_signed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

export async function markRenditionFiled(id: string): Promise<BppAccountRecord> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update({ rendition_filed_at: new Date().toISOString() })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

// Opt-in year-over-year auto-refile — see the matching setAutoRefile() in
// properties.ts for the full reasoning (same consent-timestamp convention).
export async function setBppAutoRefile(id: string, enabled: boolean): Promise<BppAccountRecord> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update({
      auto_refile: enabled,
      auto_refile_authorized_at: enabled ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

export async function deleteBppAccount(id: string): Promise<void> {
  const { error } = await supabase.from("bpp_accounts").delete().eq("id", id);
  if (error) throw error;
}

// A protest only makes sense once the county's own notice_value actually
// disagrees with what was rendered — otherwise there's nothing to contest
// yet (still waiting on the county's response to the rendition).
export function bppNeedsProtest(
  account: Pick<BppAccountRecord, "renderedValue" | "noticeValue">,
): boolean {
  return (
    account.noticeValue != null &&
    account.renderedValue != null &&
    account.noticeValue !== account.renderedValue
  );
}
