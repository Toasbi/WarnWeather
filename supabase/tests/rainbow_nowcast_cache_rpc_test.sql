-- pgtap tests for public.get_rainbow_nowcast_cache (supabase/schemas/rainbow.sql) and for
-- public.rainbow_prune, the hourly prune of the cache rows and IP buckets (keys.ts formats).
-- Run: docker exec -i supabase_db_warnweather psql -U postgres -d postgres -X -q \
--        < supabase/tests/rainbow_nowcast_cache_rpc_test.sql   (grep 'not ok')
-- or:  supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
set timezone = 'UTC';
select plan(21);

-- ── The cache read ──────────────────────────────────────────────────────────
insert into rainbow_nowcast_cache (cache_key, payload, expires_at)
values (repeat('a', 64), '{"forecast": [{"precipRate": 1.2}]}', '2026-07-06 12:05:00+00');

select is(
  get_rainbow_nowcast_cache(repeat('a', 64)) -> 'payload',
  '{"forecast": [{"precipRate": 1.2}]}'::jsonb,
  'a stored key → its payload');
select is(
  (get_rainbow_nowcast_cache(repeat('a', 64)) ->> 'expires_at')::timestamptz,
  '2026-07-06 12:05:00+00'::timestamptz,
  'expires_at round-trips as a timestamp');
select ok(
  strpos(get_rainbow_nowcast_cache(repeat('a', 64)) ->> 'expires_at', 'T') > 0,
  'expires_at is ISO 8601 (a ''T'', so JavaScript''s Date reads it)');
select is(
  get_rainbow_nowcast_cache(repeat('b', 64)),
  null::jsonb,
  'an unknown key → null');

-- ── API surface: only the service role may call it ──────────────────────────
select ok(
  not has_function_privilege('anon', 'public.get_rainbow_nowcast_cache(text)', 'execute'),
  'anon cannot execute get_rainbow_nowcast_cache');
select ok(
  not has_function_privilege('authenticated', 'public.get_rainbow_nowcast_cache(text)', 'execute'),
  'authenticated cannot execute get_rainbow_nowcast_cache');
select ok(
  has_function_privilege('service_role', 'public.get_rainbow_nowcast_cache(text)', 'execute'),
  'service_role can execute get_rainbow_nowcast_cache');

-- ── rainbow_prune: its own job, off the API ─────────────────────────────────
-- Not a step of telemetry_rollup_and_prune: that rollup once hit the cron statement timeout
-- nightly, and its rollback would keep the IP buckets and old location-keyed rows with it.
select ok(
  not has_function_privilege('anon', 'public.rainbow_prune()', 'execute'),
  'anon cannot execute rainbow_prune');
select ok(
  not has_function_privilege('authenticated', 'public.rainbow_prune()', 'execute'),
  'authenticated cannot execute rainbow_prune');
select ok(
  has_function_privilege('service_role', 'public.rainbow_prune()', 'execute'),
  'service_role can execute rainbow_prune (manual runs)');
select is(
  (select array_agg(distinct coalesce(r.rolname::text, 'PUBLIC') order by coalesce(r.rolname::text, 'PUBLIC'))
     from pg_proc p
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     left join pg_roles r on r.oid = a.grantee
    where p.oid = 'public.rainbow_prune()'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> p.proowner),
  array['service_role'],
  'EXECUTE on rainbow_prune: its owner and service_role only (no PUBLIC)');
select isnt_definer('public', 'rainbow_prune', array[]::text[], 'rainbow_prune is security invoker');
select is(
  (select proconfig from pg_proc where oid = 'public.rainbow_prune()'::regprocedure),
  array['search_path=""'],
  'rainbow_prune pins an empty search_path');
select is(
  (select array_agg(schedule || ' ' || btrim(command)) from cron.job where jobname = 'rainbow-prune'),
  array['30 * * * * select public.rainbow_prune();'],
  'rainbow-prune is its own hourly pg_cron job');
select is(
  (select count(*)::int from cron.job where command ilike '%rainbow_prune%'),
  1,
  'exactly one job runs rainbow_prune');

-- ── The prune reads the hashed keys' hour suffix ──────────────────────────
-- keys.ts ipHourKey: '<32 hex>:<YYYY-MM-DDTHH>'. Only the current UTC hour's bucket is ever
-- read, so the prune keeps a day of buckets, no more.
delete from rainbow_ip_usage;
insert into rainbow_ip_usage (ip_hour, calls)
values (repeat('c', 32) || ':' || to_char(now() - interval '25 hours', 'YYYY-MM-DD"T"HH24'), 1),
       (repeat('d', 32) || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24'), 1),
       (repeat('e', 32) || ':' || to_char(now() - interval '23 hours', 'YYYY-MM-DD"T"HH24'), 1),
       -- a raw-IP row from before the keyed hash (IPv6, colons and all)
       ('2001:db8::1:' || to_char(now() - interval '25 hours', 'YYYY-MM-DD"T"HH24'), 1),
       -- and a raw IPv4 one from the day before that
       ('203.0.113.9:' || to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24'), 1);
select is(length((select ip_hour from rainbow_ip_usage where ip_hour like 'd%')), 46,
  'a hashed IP key is 32 + 1 + 13 characters');

-- A cache row can be looked up only while its start is within the proxy's 30-min window, so
-- at most 25 min past expires_at (as a stale fallback); an hour's grace keeps every such row.
delete from rainbow_nowcast_cache;
insert into rainbow_nowcast_cache (cache_key, payload, expires_at)
values ('k-live', '{}'::jsonb, now() + interval '4 minutes'),
       ('k-stale', '{}'::jsonb, now() - interval '20 minutes'),
       ('k-dead', '{}'::jsonb, now() - interval '61 minutes'),
       -- a location-keyed row from before the keyed hash
       ('52.517:13.389:1783339200', '{}'::jsonb, now() - interval '1 day');

-- The rollup no longer touches either table.
select telemetry_rollup_and_prune(p_prune => true);
select is((select count(*)::int from rainbow_ip_usage), 5, 'telemetry_rollup_and_prune leaves the IP buckets alone');
select is((select count(*)::int from rainbow_nowcast_cache), 4, 'telemetry_rollup_and_prune leaves the cache alone');

select rainbow_prune();
select is(
  (select array_agg(left(ip_hour, 1) order by ip_hour) from rainbow_ip_usage),
  array['d', 'e'],
  'hashed and raw buckets older than a day are pruned; the last day''s are kept');
select is(
  (select array_agg(cache_key order by cache_key) from rainbow_nowcast_cache),
  array['k-live', 'k-stale'],
  'cache rows an hour past expiry are pruned (old location keys with them); live and stale-fallback rows stay');

-- The hour keys are UTC, and so is the cutoff: a session far ahead of UTC (UTC+14) prunes the
-- same rows, so it keeps a bucket 23 UTC hours old (a local cutoff would drop it).
set local timezone = 'Pacific/Kiritimati';
select rainbow_prune();
set local timezone = 'UTC';
select is(
  (select array_agg(left(ip_hour, 1) order by ip_hour) from rainbow_ip_usage),
  array['d', 'e'],
  'the cutoff is taken in UTC whatever the session time zone');

select * from finish();
rollback;
