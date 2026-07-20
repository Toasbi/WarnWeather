-- pgtap tests for the telemetry analytics rollup (tables + rollup function).
-- Run: psql "$DB_URL" -f supabase/tests/telemetry_rollup_test.sql  (grep '^not ok')
-- or:  supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

-- Schema: the three rollup tables exist with the expected keys + RLS policies.
select has_table('public', 'telemetry_watch', 'telemetry_watch exists');
select has_table('public', 'telemetry_dau', 'telemetry_dau exists');
select has_table('public', 'telemetry_errors', 'telemetry_errors exists');
select col_is_pk('public', 'telemetry_watch', 'watch_key', 'telemetry_watch PK is watch_key');
select col_is_pk('public', 'telemetry_dau', array['watch_key', 'activity_date'],
                 'telemetry_dau PK is (watch_key, activity_date)');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('telemetry_watch', 'telemetry_dau', 'telemetry_errors')),
  3, 'three no_api_access policies present');

select * from finish();
rollback;
