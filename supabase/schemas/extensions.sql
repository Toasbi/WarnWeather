-- Extensions that migrations rely on but db diff cannot otherwise see.
-- pg_cron is enabled here so the declarative "desired state" matches the
-- migration-built state; otherwise `supabase db diff` spuriously proposes
-- `drop extension pg_cron`, which would delete the scheduled telemetry
-- maintenance job (cron.job row) on any push. The schedule itself is
-- imperative state (cron.job data) and stays in the hand-written migration.
create extension if not exists pg_cron;
