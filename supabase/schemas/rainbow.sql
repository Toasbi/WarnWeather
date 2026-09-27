-- Rainbow.ai nowcast proxy state: response cache + upstream usage counters.
-- Declarative schema (source of truth). Never hand-write supabase/migrations/ —
-- generate with: supabase db diff -f rainbow_nowcast_cache

-- Short-TTL coarse response cache. cache_key = hex HMAC-SHA-256 of
-- '<lat.3dp>|<lon.3dp>|<start>' under a key derived from a server-side pepper
-- (rainbow-nowcast keys.ts; 3 decimals ≈ 100 m, start is the 5-min bucket) so
-- nearby users in the same window share one upstream call, and no row names a
-- place. payload is
-- {forecast: [...]} only (Rainbow's echoed position is dropped). Rows written
-- before the keyed hash (plain '<lat>:<lon>:<start>' keys) are never read again
-- and go with the hourly expires_at prune (rainbow_prune below). TTL is
-- enforced by the edge function (expires_at comparison); expired rows double as
-- a stale fallback when the budget guards trip.
create table public.rainbow_nowcast_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamp with time zone not null,

  check (jsonb_typeof(payload) = 'object')
);

alter table public.rainbow_nowcast_cache enable row level security;

create policy no_api_access_rainbow_nowcast_cache
on public.rainbow_nowcast_cache
for all
to anon, authenticated
using (false)
with check (false);

create index rainbow_nowcast_cache_expires_idx
  on public.rainbow_nowcast_cache (expires_at);

-- One row per UTC month (e.g. '2026-07'): the hard wallet cap. Above
-- RAINBOW_MONTHLY_BUDGET upstream calls, the proxy serves cache-or-empty.
create table public.rainbow_upstream_usage (
  period text primary key,
  upstream_calls integer not null default 0
);

alter table public.rainbow_upstream_usage enable row level security;

create policy no_api_access_rainbow_upstream_usage
on public.rainbow_upstream_usage
for all
to anon, authenticated
using (false)
with check (false);

-- One row per requesting IP per UTC hour: the coarse hourly backstop that
-- blunts a single abuser before it burns the monthly budget. Key
-- '<32 hex HMAC of ip|hour>:<YYYY-MM-DDTHH>' (rainbow-nowcast keys.ts): no raw
-- IP is stored, and the hour after the last ':' is what the hourly prune
-- (rainbow_prune below, right(ip_hour, 13)) reads, so keep that suffix.
create table public.rainbow_ip_usage (
  ip_hour text primary key,
  calls integer not null default 0
);

alter table public.rainbow_ip_usage enable row level security;

create policy no_api_access_rainbow_ip_usage
on public.rainbow_ip_usage
for all
to anon, authenticated
using (false)
with check (false);

-- Atomic increment-and-read: a plain read-modify-write races between
-- concurrent edge invocations; the upsert increments atomically and returns
-- the post-increment count.
create or replace function public.increment_rainbow_usage(p_period text)
returns integer
language sql
set search_path = ''
as $$
  insert into public.rainbow_upstream_usage as u (period, upstream_calls)
  values (p_period, 1)
  on conflict (period) do update set upstream_calls = u.upstream_calls + 1
  returning upstream_calls;
$$;

create or replace function public.increment_rainbow_ip_usage(p_ip_hour text)
returns integer
language sql
set search_path = ''
as $$
  insert into public.rainbow_ip_usage as u (ip_hour, calls)
  values (p_ip_hour, 1)
  on conflict (ip_hour) do update set calls = u.calls + 1
  returning calls;
$$;

-- The cache read, as an RPC so the key rides the request body: a table read
-- would put it in the PostgREST URL's query filter, and the API gateway logs
-- every URL. Returns {payload, expires_at} (expires_at a JSON timestamp), or
-- null when there is no row; freshness is the edge function's call.
create or replace function public.get_rainbow_nowcast_cache(p_cache_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('payload', c.payload, 'expires_at', c.expires_at)
    from public.rainbow_nowcast_cache c
   where c.cache_key = p_cache_key;
$$;

-- Service-role only: the edge function is the sole caller. (SECURITY INVOKER +
-- the deny-all RLS above already keep anon off the table; this also keeps the
-- RPC itself off the public API surface.)
revoke all on function public.get_rainbow_nowcast_cache(text)
  from public, anon, authenticated;

-- The privacy prune: the per-IP buckets older than a day, and cache rows an hour
-- past expiry (with them any location-keyed row from before the keyed hash).
-- Scheduled hourly as its own pg_cron job ('rainbow-prune', hand-written
-- migration …_rainbow_prune_cron.sql), not as a step of
-- telemetry_rollup_and_prune: that rollup is the statement that once crossed
-- the cron timeout nightly, and its rollback would have kept these rows too.
--
-- The per-IP buckets are only ever read for the current UTC hour, so a day is
-- kept, no more. A key ends in its UTC hour, the last 13 chars:
-- '<32-hex HMAC>:YYYY-MM-DDTHH' (rainbow-nowcast keys.ts), or '<ip>:YYYY-MM-DDTHH'
-- before it, IPv6 colons and all. The cutoff is taken in UTC too, so a session
-- in another time zone prunes the same rows.
--
-- A cache row is looked up only while its start is inside the proxy's 30-min
-- window, i.e. at most 25 min past expires_at (as the guards' stale fallback);
-- the hour's grace keeps every row that can still be read.
create or replace function public.rainbow_prune()
returns void
language sql
set search_path = ''
as $$
  delete from public.rainbow_nowcast_cache
   where expires_at < now() - interval '1 hour';
  delete from public.rainbow_ip_usage
   where right(ip_hour, 13)
         < to_char((now() at time zone 'UTC') - interval '1 day', 'YYYY-MM-DD"T"HH24');
$$;

-- Off the API: pg_cron runs it as the owner, manual runs use the service role.
revoke all on function public.rainbow_prune()
  from public, anon, authenticated;
