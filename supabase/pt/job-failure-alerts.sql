-- Hourly email to staff when a scheduled job failed or a background HTTP call
-- (pg_cron → pg_net → edge function) came back with an error. Until now a
-- failing reminder or sync job was only visible by reading cron tables.
--
-- Same delivery as notify_new_client_errors (error-alerts.sql): replace
-- <anon key> with the project's anon key when applying.
insert into public.ops_state (key, value) values ('jobs_notified_at', now())
on conflict (key) do nothing;

create or replace function public.notify_failed_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_now timestamptz := now();
  v_cron int;
  v_cron_lines text;
  v_http int;
  v_http_lines text;
begin
  select value into v_since from public.ops_state where key = 'jobs_notified_at';
  v_since := coalesce(v_since, v_now - interval '1 hour');

  select count(*), string_agg(format('%s  %s  %s', j.jobname, d.status, left(coalesce(d.return_message, ''), 160)), E'\n' order by d.start_time)
    into v_cron, v_cron_lines
    from cron.job_run_details d join cron.job j using (jobid)
   where d.start_time > v_since and d.status not in ('succeeded', 'running', 'starting');

  select count(*), string_agg(format('HTTP %s  %s', coalesce(r.status_code::text, 'no response'),
                                     left(coalesce(r.error_msg, r.content, ''), 160)), E'\n' order by r.created)
    into v_http, v_http_lines
    from (select * from net._http_response
           where created > v_since and (status_code is null or status_code >= 400)
           order by created limit 20) r;

  update public.ops_state set value = v_now where key = 'jobs_notified_at';
  if v_cron = 0 and v_http = 0 then return; end if;

  perform net.http_post(
    url := 'https://iotzuhuajbsxxuccuihn.supabase.co/functions/v1/send-staff-notification',
    headers := jsonb_build_object('Authorization', 'Bearer <anon key>', 'apikey', '<anon key>', 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'subject', format('CorvusPT: %s scheduled job problem%s', v_cron + v_http, case when v_cron + v_http = 1 then '' else 's' end),
      'message', 'Scheduled work that failed in the last hour.' || E'\n\n'
        || case when v_cron > 0 then 'Jobs that failed:' || E'\n' || v_cron_lines || E'\n\n' else '' end
        || case when v_http > 0 then 'Server-function calls that returned an error:' || E'\n' || v_http_lines || E'\n\n' else '' end
        || 'Details: cron.job_run_details and net._http_response in Supabase.'
    ),
    timeout_milliseconds := 20000);
end;
$$;
revoke all on function public.notify_failed_jobs() from public, anon, authenticated;

select cron.unschedule('job-failure-alert') where exists (select 1 from cron.job where jobname = 'job-failure-alert');
select cron.schedule('job-failure-alert', '12 * * * *', 'select public.notify_failed_jobs()');
