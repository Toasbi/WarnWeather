-- HAND-WRITTEN (not from db diff): lock down the SECURITY DEFINER maintenance
-- function so it is not callable via the public PostgREST API.
--
-- public.telemetry_rollup_and_prune runs as its owner (postgres) and bypasses
-- RLS. Postgres grants EXECUTE to PUBLIC by default, which the anon/authenticated
-- API roles inherit, so without this revoke the function is reachable
-- unauthenticated at POST /rest/v1/rpc/telemetry_rollup_and_prune using the anon
-- key shipped in the app — e.g. passing a negative p_raw_retention_days makes the
-- prune cutoff a far-future timestamp and deletes every raw telemetry row.
--
-- pg_cron runs the job as the owner and any manual run uses service_role, so no
-- API role needs EXECUTE. `supabase db diff` does not reliably capture function
-- ACLs, hence this is hand-written (the revoke also lives in the declarative
-- schema supabase/schemas/telemetry_analytics.sql for source-of-truth parity).
revoke all on function public.telemetry_rollup_and_prune(integer, integer, boolean)
  from public, anon, authenticated;