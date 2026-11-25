-- 005_scheduled_jobs.sql — nightly raw-video purge via the `purge-raw-video` edge function (Nov 25 2026).
-- 004 removed 001's SQL-only job, which nulled pointers without deleting storage objects.
--
-- Needs two Vault secrets, created out of band (never in git):
--   select vault.create_secret('<random 32+ char token>', 'purge_cron_secret');   -- = edge secret PURGE_CRON_SECRET
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
-- The job reads them at run time, so this file holds no secret. The token is purge-only: the
-- scheduler never holds the service-role key.
--
-- Guarded so the migration also applies where pg_cron / pg_net / Vault are unavailable (PGlite tests,
-- local stacks without the extensions): then it is a no-op.

do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;

    -- Re-runnable: replace any previous definition of the job.
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-raw-video-edge';

    perform cron.schedule(
      'purge-raw-video-edge',
      '15 3 * * *',
      $job$
        select net.http_post(
          url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                     || '/functions/v1/purge-raw-video',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                           where name = 'purge_cron_secret'),
            'Content-Type', 'application/json'),
          body    := '{}'::jsonb,
          timeout_milliseconds := 120000)
      $job$
    );
  end if;
end
$outer$;
