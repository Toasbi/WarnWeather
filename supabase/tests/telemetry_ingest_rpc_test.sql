-- pgtap tests for the telemetry-ingest edge function's RPC (supabase/schemas/telemetry.sql):
-- telemetry_recent_insert_count, the hourly rate check, and its API surface.
-- Run: docker exec -i supabase_db_warnweather psql -U postgres -d postgres -X -q \
--        < supabase/tests/telemetry_ingest_rpc_test.sql   (grep 'not ok')
-- or:  supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
set timezone = 'UTC';
select plan(13);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Hashes are opaque text to the database; 'hash-a' etc. stand in for the hex HMACs.
-- The window under test starts at 2026-07-06 11:00 (the function's "now - 1 h").
delete from telemetry_weather_fetch
 where account_token_hash in ('hash-a', 'hash-b', 'hash-new');
insert into telemetry_weather_fetch
  (account_token_hash, provider, success, app_version, build_profile, received_at, inserted_at)
values
  -- in the window
  ('hash-a', 'dwd', true, '1.23.0', 'release', '2026-07-06 11:30:00+00', '2026-07-06 11:30:00+00'),
  ('hash-a', 'dwd', true, '1.23.0', 'release', '2026-07-06 11:59:59+00', '2026-07-06 11:59:59+00'),
  -- exactly on the window's start: counted (>=)
  ('hash-a', 'dwd', true, '1.23.0', 'release', '2026-07-06 11:00:00+00', '2026-07-06 11:00:00+00'),
  -- a batched row: its event happened two days ago, but it ARRIVED in the window
  ('hash-a', 'dwd', true, '1.23.0', 'release', '2026-07-04 12:00:00+00', '2026-07-06 11:45:00+00'),
  -- arrived before the window
  ('hash-a', 'dwd', true, '1.23.0', 'release', '2026-07-06 10:59:59+00', '2026-07-06 10:59:59+00'),
  -- the reverse of the batched row: a recent event stamp, but it arrived before the window
  ('hash-a', 'dwd', true, '1.23.0', 'release', '2026-07-06 11:30:00+00', '2026-07-06 10:00:00+00'),
  -- another account in the window
  ('hash-b', 'dwd', true, '1.23.0', 'release', '2026-07-06 11:30:00+00', '2026-07-06 11:30:00+00');

-- ── telemetry_recent_insert_count ───────────────────────────────────────────
select is(
  telemetry_recent_insert_count('hash-a', '2026-07-06 11:00:00+00'),
  4,
  'the caller''s arrivals since p_since, by inserted_at, the start included');
select is(
  telemetry_recent_insert_count('hash-b', '2026-07-06 11:00:00+00'),
  1,
  'another account''s rows are its own');
select is(
  telemetry_recent_insert_count('hash-a', '2026-07-06 11:45:00+00'),
  2,
  'a back-dated batch row counts when it arrived, not when its event happened');
select is(
  telemetry_recent_insert_count('hash-new', '2026-07-06 11:00:00+00'),
  0,
  'an account with no rows → 0, not null');
select is(
  telemetry_recent_insert_count(null, '2026-07-06 11:00:00+00'),
  0,
  'a null hash matches nothing');
select is(
  pg_typeof(telemetry_recent_insert_count('hash-a', '2026-07-06 11:00:00+00'))::text,
  'integer',
  'a plain integer, which PostgREST returns as a JSON number');

-- ── API surface: only the service role may call it ──────────────────────────
select ok(
  not has_function_privilege('anon', 'public.telemetry_recent_insert_count(text, timestamptz)', 'execute'),
  'anon cannot execute telemetry_recent_insert_count');
select ok(
  not has_function_privilege('authenticated', 'public.telemetry_recent_insert_count(text, timestamptz)', 'execute'),
  'authenticated cannot execute telemetry_recent_insert_count');
select ok(
  has_function_privilege('service_role', 'public.telemetry_recent_insert_count(text, timestamptz)', 'execute'),
  'service_role can execute telemetry_recent_insert_count');
select ok(
  not exists (
    select 1
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'public.telemetry_recent_insert_count(text, timestamptz)'::regprocedure
       and a.grantee = 0),
  'PUBLIC holds no grant on it');

-- ── Definition: invoker rights, pinned search_path, honest volatility ───────
select ok(
  (select not p.prosecdef
     from pg_proc p
    where p.oid = 'public.telemetry_recent_insert_count(text, timestamptz)'::regprocedure),
  'SECURITY INVOKER');
select ok(
  (select p.proconfig @> array['search_path=""']
     from pg_proc p
    where p.oid = 'public.telemetry_recent_insert_count(text, timestamptz)'::regprocedure),
  'an empty search_path');
select is(
  (select p.provolatile::text
     from pg_proc p
    where p.oid = 'public.telemetry_recent_insert_count(text, timestamptz)'::regprocedure),
  's',
  'STABLE: it only reads');

select * from finish();
rollback;
