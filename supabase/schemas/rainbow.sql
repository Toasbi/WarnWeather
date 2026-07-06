-- Rainbow.ai nowcast proxy state: response cache + upstream usage counters.
-- Declarative schema (source of truth). Never hand-write supabase/migrations/ —
-- generate with: supabase db diff -f rainbow_nowcast_cache

-- Short-TTL coarse response cache. cache_key = '<lat.3dp>:<lon.3dp>:<start>'
-- (3 decimals ≈ 100 m; start is the 5-min bucket) so nearby users in the same
-- window share one upstream call. TTL is enforced by the edge function
-- (expires_at comparison); expired rows double as a stale fallback when the
-- budget guards trip.
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

-- One row per requesting IP per UTC hour (key '<ip>:<YYYY-MM-DDTHH>'): the
-- coarse hourly backstop that blunts a single abuser before it burns the
-- monthly budget. Rows go dead after their hour; prune opportunistically.
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
as $$
  insert into public.rainbow_upstream_usage as u (period, upstream_calls)
  values (p_period, 1)
  on conflict (period) do update set upstream_calls = u.upstream_calls + 1
  returning upstream_calls;
$$;

create or replace function public.increment_rainbow_ip_usage(p_ip_hour text)
returns integer
language sql
as $$
  insert into public.rainbow_ip_usage as u (ip_hour, calls)
  values (p_ip_hour, 1)
  on conflict (ip_hour) do update set calls = u.calls + 1
  returning calls;
$$;
