-- One rule for "paid" across the database, matching apps/pt/src/lib/subscription-status.ts:
--   paid (unlocks features):        active, trialing, past_due
--   has a live subscription (don't  active, trialing, past_due, incomplete, unpaid
--   sell another / don't delete):
-- stripe-webhook stores Stripe's status as-is; a renewal that is being retried
-- ("past_due") must not lock a paying customer out or send them to checkout.

create or replace function public.property_is_paid(p_property_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and p.user_id = auth.uid()
      and (
        p.subscription_status in ('active', 'trialing', 'past_due')
        or (select plan from public.profiles where id = auth.uid()) = 'beta'
      )
  );
$$;

create or replace function public.bpp_is_paid(p_bpp_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.bpp_accounts b
    where b.id = p_bpp_account_id
      and b.user_id = auth.uid()
      and (
        b.subscription_status in ('active', 'trialing', 'past_due')
        or (select plan from public.profiles where id = auth.uid()) = 'beta'
      )
  );
$$;

-- Deleting a property/BPP account with any live subscription would leave Stripe
-- billing for something that no longer exists — cancel first, then delete.
drop policy if exists "Users can delete their own properties" on public.properties;
create policy "Users can delete their own properties"
  on public.properties for delete
  using (
    (select auth.uid()) = user_id
    and coalesce(subscription_status, '') not in ('active', 'trialing', 'past_due', 'incomplete', 'unpaid')
  );

drop policy if exists "Users can delete their own BPP accounts" on public.bpp_accounts;
create policy "Users can delete their own BPP accounts"
  on public.bpp_accounts for delete
  using (
    (select auth.uid()) = user_id
    and coalesce(subscription_status, '') not in ('active', 'trialing', 'past_due', 'incomplete', 'unpaid')
  );
