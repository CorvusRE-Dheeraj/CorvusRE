-- Hourly email to staff when the app logged new browser errors (client_errors).
-- Calls send-staff-notification with the public anon key (it's already in the
-- website; no secret is stored here). Sends nothing when there's nothing new.
create table if not exists public.ops_state (
  key text primary key,
  value timestamptz not null default now()
);
alter table public.ops_state enable row level security;
revoke all on public.ops_state from anon, authenticated;
insert into public.ops_state (key, value) values ('client_errors_notified_at', now())
  on conflict (key) do nothing;

create or replace function public.notify_new_client_errors()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_now timestamptz := now();
  v_count int;
  v_lines text;
begin
  select value into v_since from public.ops_state where key = 'client_errors_notified_at';
  select count(*),
         string_agg(format('%s  %s  %s', ref, coalesce(route, '?'), left(coalesce(message, ''), 140)), E'
' order by created_at)
    into v_count, v_lines
    from (select * from public.client_errors
           where created_at > coalesce(v_since, v_now - interval '1 hour')
           order by created_at limit 25) e;
  update public.ops_state set value = v_now where key = 'client_errors_notified_at';
  if v_count = 0 then return; end if;
  perform net.http_post(
    url := 'https://iotzuhuajbsxxuccuihn.supabase.co/functions/v1/send-staff-notification',
    headers := jsonb_build_object('Authorization', 'Bearer <anon key>', 'apikey', '<anon key>', 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'subject', format('CorvusPT: %s new app error%s', v_count, case when v_count = 1 then '' else 's' end),
      'message', 'New errors seen by users in the last hour (reference, page, message):' || E'

' || v_lines ||
                 E'

Full details: client_errors table in Supabase.'
    ),
    timeout_milliseconds := 20000);
end;
$$;
revoke all on function public.notify_new_client_errors() from public, anon, authenticated;

select cron.unschedule('client-errors-alert') where exists (select 1 from cron.job where jobname = 'client-errors-alert');
select cron.schedule('client-errors-alert', '7 * * * *', 'select public.notify_new_client_errors()');
