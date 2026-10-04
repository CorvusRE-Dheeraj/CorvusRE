import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// "Task - AI Logs and Outputs": every AI call's real input and output is
// stored so staff can review results (see the admin "AI Logs" tab). Never
// throws — a logging failure must never turn a successful AI response into
// an error for the caller.
export async function logAiCall(
  kind: "feasibility_summary" | "design_narrative" | "review_comment_translation" | "assistant_chat",
  input: unknown,
  output: unknown,
  userId?: string | null,
): Promise<void> {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await admin.from("ai_logs").insert({ kind, input, output, user_id: userId ?? null });
  } catch (err) {
    console.error(`ai_logs insert failed for ${kind} (non-blocking):`, err);
  }
}
