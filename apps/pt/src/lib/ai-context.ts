import { listProperties } from "./properties";
import { listProtests } from "./protests";

const STATUS_LABEL: Record<string, string> = {
  requested: "protest requested",
  filed: "protest filed",
  under_review: "protest under county review",
  hearing_scheduled: "protest hearing scheduled",
  resolved: "protest resolved",
};

// Compact plain-text account summary handed to the AI as prompt context — not a
// structured schema, since ask-about-document just drops this string into a
// "Context:\n{context}" prefix ahead of the user's question.
export async function buildUserContext(userId: string): Promise<string> {
  const [properties, protests] = await Promise.all([
    listProperties(userId),
    listProtests(userId),
  ]);
  if (properties.length === 0) return "";

  const lines = properties.map((p) => {
    const protest = protests.find((pr) => pr.propertyId === p.id);
    const parts = [p.address];
    if (p.cad) parts.push(`CAD: ${p.cad}`);
    if (p.propertyType) parts.push(`type: ${p.propertyType}`);
    if (p.totalValue != null) parts.push(`assessed value: $${p.totalValue.toLocaleString()}`);
    if (p.protestDeadline) parts.push(`protest deadline: ${p.protestDeadline}`);
    parts.push(protest ? STATUS_LABEL[protest.status] : "no protest requested yet");
    return `- ${parts.join(" | ")}`;
  });

  return `The signed-in user owns these properties on CorvusPT.ai:\n${lines.join("\n")}`;
}
