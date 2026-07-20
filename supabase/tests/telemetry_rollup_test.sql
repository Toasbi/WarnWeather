-- pgtap tests for the telemetry analytics rollup (tables + rollup function).
-- Run: docker exec -i supabase_db_warnweather psql -U postgres -d postgres -X -q \
--        < supabase/tests/telemetry_rollup_test.sql   (grep 'not ok')
-- or:  supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
set timezone = 'UTC';  -- make current_date / day-bucketing deterministic
select plan(17);

-- ── Schema ────────────────────────────────────────────────────────────────
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

-- ── Behavior ──────────────────────────────────────────────────────────────
-- Seed: watchA has 2 fetches (1 failed) on a completed day 2 days ago, plus a
-- stale row 20 days ago. acctB (null watch token) has 1 fetch 2 days ago.
insert into telemetry_weather_fetch
  (received_at, account_token_hash, watch_token_hash, provider, success, error,
   country_code, settings_json, app_version, build_profile, watch_info, duration_ms, attempt)
values
  ((current_date - 2) + time '09:00', 'acctA', 'watchA', 'dwd', true, null, 'DE',
   '{"radarProvider":"rainbow","statusForecastLeft":"temp","statusTopMid":"city"}',
   '1.8.0', 'release',
   '{"platform":"basalt","model":"pebble_time","language":"en","firmware":{"major":4,"minor":3,"patch":2}}',
   120, 1),
  ((current_date - 2) + time '10:00', 'acctA', 'watchA', 'dwd', false, 'HTTP 500', 'DE',
   '{"radarProvider":"rainbow","statusForecastLeft":"wind"}', '1.8.0', 'release',
   '{"platform":"basalt","model":"pebble_time","language":"en","firmware":{"major":4,"minor":3,"patch":2}}',
   900, 2),
  ((current_date - 2) + time '09:30', 'acctB', null, 'openmeteo', true, null, 'US',
   '{"radarProvider":"disabled","statusForecastLeft":"temp"}', '1.7.2', 'release',
   '{"platform":"aplite","model":"pebble_steel","language":"de"}', 200, 1),
  ((current_date - 20) + time '09:00', 'acctA', 'watchA', 'dwd', true, null, 'DE',
   '{}', '1.6.0', 'release', '{"platform":"basalt"}', 100, 1),
  -- watchT is active RIGHT NOW (today) on 1.8.1 with a status slot set.
  (now(), 'acctT', 'watchT', 'openmeteo', true, null, 'AT',
   '{"radarProvider":"openmeteo","statusForecastLeft":"uv"}', '1.8.1', 'release',
   '{"platform":"chalk","model":"pebble_time_round","language":"fr"}', 180, 1);

insert into rainbow_nowcast_cache (cache_key, payload, expires_at)
values ('k-expired', '{}'::jsonb, now() - interval '1 hour'),
       ('k-live',    '{}'::jsonb, now() + interval '1 hour');

-- First run WITHOUT prune: rollup only.
select telemetry_rollup_and_prune(p_prune => false);

select is((select fetch_count from telemetry_dau
             where watch_key = 'watchA' and activity_date = current_date - 2),
          2::int, 'watchA has 2 fetches on the day');
select is((select radar_provider from telemetry_dau
             where watch_key = 'watchA' and activity_date = current_date - 2),
          'rainbow', 'dau radar_provider extracted from settings_json');
select is((select watch_key from telemetry_dau
             where watch_key = 'acctB' and activity_date = current_date - 2),
          'acctB', 'null watch_token falls back to account_token as watch_key');
select is((select lifetime_events from telemetry_watch where watch_key = 'watchA'),
          3::int, 'lifetime_events sums dau (2 on recent day + 1 on stale day)');
select is((select last_app_version from telemetry_watch where watch_key = 'watchA'),
          '1.8.0', 'last_app_version is the newest version seen');
select is((select watch_language from telemetry_watch where watch_key = 'acctB'),
          'de', 'watch_language extracted from watch_info');
select is((select count(*)::int from telemetry_errors where watch_key = 'watchA'),
          1, 'one error row copied for watchA');
select is((select fetch_count from telemetry_dau
             where watch_key = 'watchT' and activity_date = current_date),
          1::int, 'today is rolled up (live current day, e.g. release-day fleet)');

-- Idempotency: a second identical run must not change counts.
select telemetry_rollup_and_prune(p_prune => false);
select is((select fetch_count from telemetry_dau
             where watch_key = 'watchA' and activity_date = current_date - 2),
          2::int, 'fetch_count unchanged after second run (idempotent)');
select is((select lifetime_events from telemetry_watch where watch_key = 'watchA'),
          3::int, 'lifetime_events unchanged after second run (idempotent)');

-- Now prune: stale raw row + expired cache go away, live cache stays.
select telemetry_rollup_and_prune(p_raw_retention_days => 14, p_prune => true);
select is((select count(*)::int from rainbow_nowcast_cache), 1,
          'expired cache pruned, live cache kept');

select * from finish();
rollback;
