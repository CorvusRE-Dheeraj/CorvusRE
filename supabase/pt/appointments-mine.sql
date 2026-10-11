
-- A signed-in customer can see (and reach the reschedule/cancel link for) their own
-- appointments: ones booked while signed in, or booked with their account's email.
drop policy if exists "Users read their own appointments" on public.appointments;
create policy "Users read their own appointments"
  on public.appointments for select
  to authenticated
  using (user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
