-- Shopify sync schedule (setup script, NOT a migration)
-- Calls the shopify-sync Edge Function every minute, so changes reach Shopify without anyone clicking "Sync now".
-- Run it once per Supabase project, in the SQL Editor, after migration 0029 and after deploying shopify-sync.
--
-- Before running:
--   1. Database -> Extensions: enable pg_cron and pg_net.
--   2. Replace the two placeholders below with your project URL and secret key
--      (Project Settings -> API Keys, starts with sb_secret_).
--   3. Run it, then UNDO your edit (put the placeholders back) before saving or committing this file.
--      The real key must never be committed to GitHub.
--
-- Why not a migration: it contains a secret, and a migration would turn the schedule on in every database
-- that is rebuilt from the migrations (including test copies).
-- Based on: https://supabase.com/docs/guides/functions/schedule-functions

-- 1. Keep the project URL and secret key in Supabase Vault (encrypted), not in the job itself
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('sb_secret_YOUR_KEY', 'secret_key');

-- 2. Every minute, ask shopify-sync to send whatever is waiting
select cron.schedule(
  'shopify-sync-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/shopify-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')),
    body := '{"action": "run"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ---------------------------------------------------------------- Useful afterwards (run one at a time)
-- Is it running? (newest first)
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--
-- Stop the schedule (e.g. after the defense):
--   select cron.unschedule('shopify-sync-every-minute');
--
-- The secret key changed (e.g. it was rotated): update the stored copy
--   select vault.update_secret((select id from vault.secrets where name = 'secret_key'), 'sb_secret_NEW_KEY');
