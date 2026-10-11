// Deploy via CLI: `supabase functions deploy appointment-slots`.
// Public read: the open appointment slots a visitor can pick from, computed on the
// server from the booking rules (../_shared/appointment-rules.ts), the existing
// bookings, and the admin's blocked days/slots. Nothing about WHO booked anything is
// returned — only which times are still open. Works signed-out (default JWT checks
// pass with the anon key, same as send-staff-notification).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  APPT_ZONE,
  earliestBookableDate,
  latestBookableDate,
  openSlotsInRange,
} from "../_shared/appointment-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // A visitor rescheduling passes their manage token so their own time counts as free.
    let ownToken = "";
    try {
      ownToken = String(((await req.json()) as { token?: string }).token ?? "");
    } catch {
      // no body — plain availability
    }
    const now = Date.now();
    const from = earliestBookableDate(now);
    const to = latestBookableDate(now);

    const [{ data: booked, error: bookedErr }, { data: blocks, error: blocksErr }] = await Promise.all([
      admin.from("appointments").select("start_at, manage_token").eq("status", "booked").gte("start_at", new Date(now - 86_400_000).toISOString()),
      admin.from("appointment_blocks").select("block_date, slot").gte("block_date", from),
    ]);
    if (bookedErr || blocksErr) throw new Error((bookedErr ?? blocksErr)!.message);

    const days = openSlotsInRange(
      from,
      to,
      (booked ?? [])
        .filter((b) => !ownToken || b.manage_token !== ownToken)
        .map((b) => ({ startMs: new Date(b.start_at as string).getTime() })),
      (blocks ?? []).map((b) => ({ date: b.block_date as string, slot: (b.slot as string | null) ?? null })),
      now,
    );
    return new Response(JSON.stringify({ days, from, to, timeZone: APPT_ZONE }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Could not load appointment times." }),
      { status: 500, headers: corsHeaders },
    );
  }
});
