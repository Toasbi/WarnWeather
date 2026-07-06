-- Rainbow.ai nowcast proxy state: response cache + upstream usage counters.
-- Source of truth is the declarative schema supabase/schemas/rainbow.sql.
-- Applied to the remote project (ref uorytkglrxbafryiugpu) via the Supabase MCP
-- apply_migration at version 20260706215254; mirrored here so `supabase db push`
-- sees a consistent migration history (Docker was unavailable to run `db diff`).

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

-- Atomic increment-and-read. search_path is pinned empty (bodies are fully
-- schema-qualified) to satisfy the function_search_path_mutable advisor.
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
