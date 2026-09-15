import { supabase } from "./supabase";
import type { SignatureValue } from "@/components/SignaturePad";

export type AuthorizationInput = {
  protestId?: string;
  propertyId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  isEntity: boolean;
  entityName?: string;
  entityRelationship?: string;
  entityType?: string;
  purchasedRecently: boolean;
  signature: SignatureValue;
};

export async function createAuthorization(userId: string, input: AuthorizationInput): Promise<void> {
  const { error } = await supabase.from("protest_authorizations").insert({
    protest_id: input.protestId ?? null,
    property_id: input.propertyId,
    user_id: userId,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    is_entity: input.isEntity,
    entity_name: input.isEntity ? (input.entityName ?? null) : null,
    entity_relationship: input.isEntity ? (input.entityRelationship ?? null) : null,
    entity_type: input.isEntity ? (input.entityType ?? null) : null,
    purchased_recently: input.purchasedRecently,
    signature_type: input.signature.type,
    signature_data: input.signature.data,
  });
  if (error) throw error;
}

export type AuthorizationRecord = {
  id: string;
  protestId: string | null;
  propertyId: string;
  firstName: string;
  lastName: string;
  phone: string;
  isEntity: boolean;
  entityName: string | null;
  entityRelationship: string | null;
};

type AuthorizationRow = {
  id: string;
  protest_id: string | null;
  property_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  is_entity: boolean;
  entity_name: string | null;
  entity_relationship: string | null;
};

// Only the fields the 50-162 filler (src/lib/protest-documents.ts) actually needs —
// email/signature/purchasedRecently aren't read back here. Most recent authorization
// per protest, in case a customer ever re-signs (createAuthorization has no update path).
export async function getAuthorization(protestId: string): Promise<AuthorizationRecord | null> {
  const { data, error } = await supabase
    .from("protest_authorizations")
    .select("id, protest_id, property_id, first_name, last_name, phone, is_entity, entity_name, entity_relationship")
    .eq("protest_id", protestId)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as AuthorizationRow;
  return {
    id: row.id,
    protestId: row.protest_id,
    propertyId: row.property_id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    isEntity: row.is_entity,
    entityName: row.entity_name,
    entityRelationship: row.entity_relationship,
  };
}
