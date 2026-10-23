-- Per-caller rate limits for public edge functions (AI and county lookups).
-- Each function calls hit_rate_limit(bucket, limit, window) through the
-- service role; a bucket is "<function>:<sha256 of the caller's IP>" (no raw
-- IPs are stored). Fixed window: the count resets once the window has passed.
-- Shared by CorvusPT and CorvusDP (same file in supabase/dp).

create table if not exists public.rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

alter table public.rate_limits enable row level security;
-- No policies: only the service role (which bypasses RLS) touches it.
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.hit_rate_limit(p_bucket text, p_limit integer, p_window_secs integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_secs) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_secs) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- Old buckets are useless once their window has passed; sweep them nightly.
create index if not exists rate_limits_window_start_idx on public.rate_limits (window_start);
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('rate-limits-sweep') where exists (select 1 from cron.job where jobname = 'rate-limits-sweep');
    perform cron.schedule('rate-limits-sweep', '17 4 * * *',
      $sql$delete from public.rate_limits where window_start < now() - interval '1 day'$sql$);
  end if;
end $$;
