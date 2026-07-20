-- HAND-WRITTEN (not from db diff): pg_cron scheduling is imperative state in
-- cron.job, which db diff does not capture. See the retention design spec
-- (docs/superpowers/specs/2026-07-20-supabase-telemetry-retention-cleanup-design.md).
create extension if not exists pg_cron;

-- Idempotent (re)schedule: drop any prior job of this name, then create it.
-- unschedule-by-jobid runs once per matching row (0 or 1), so a fresh DB is a no-op.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'telemetry-daily-maintenance';

select cron.schedule(
  'telemetry-daily-maintenance',
  '0 3 * * *',
  $$ select public.telemetry_rollup_and_prune(); $$
);
