-- HAND-WRITTEN (not from db diff): pg_cron scheduling is imperative state in
-- cron.job, which db diff does not capture (as in …_telemetry_cron.sql).
--
-- rainbow_prune (supabase/schemas/rainbow.sql) runs as its own hourly job, so
-- the privacy prune of the Rainbow proxy's IP buckets and cache rows no longer
-- depends on the heavy nightly telemetry rollup finishing inside the cron
-- statement timeout. At :30, clear of the rollup's 03:00 run.
create extension if not exists pg_cron;

-- Idempotent (re)schedule: drop any prior job of this name, then create it.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'rainbow-prune';

select cron.schedule(
  'rainbow-prune',
  '30 * * * *',
  $$ select public.rainbow_prune(); $$
);
