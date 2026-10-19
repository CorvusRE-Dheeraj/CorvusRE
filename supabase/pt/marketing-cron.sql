-- Hourly: send Marketing campaigns whose scheduled time has passed
-- (admin-update-plan?action=marketing-send, { process: "due" }). Same
-- service-role Bearer pattern as this project's other cron jobs.
select cron.unschedule('marketing-due') where exists (select 1 from cron.job where jobname = 'marketing-due');
select cron.schedule('marketing-due', '5 * * * *', $job$
  select net.http_post(
    url := 'https://iotzuhuajbsxxuccuihn.supabase.co/functions/v1/admin-update-plan?action=marketing-send',
    headers := jsonb_build_object('Authorization', 'Bearer <service role key>', 'Content-Type', 'application/json'),
    body := '{"process":"due"}'::jsonb,
    timeout_milliseconds := 150000)
$job$);
