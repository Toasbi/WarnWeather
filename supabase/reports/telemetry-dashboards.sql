-- Telemetry dashboards.
--
-- Freshness is the priority: the "currently active" panels read the live raw
-- table so they reflect today, not last night's rollup. Sources by query:
--   • Active-base snapshots (#7, #8, #11, #12, #13, #14) and recent-ops
--     (#2, #3, #4, #5, #6): live from raw public.telemetry_weather_fetch. Raw is
--     retained only 14 days, so these are bounded to that window.
--   • Daily active users (#1) and lifecycle/churn (#9, #10): union — finalized
--     history from the daily rollup (telemetry_dau + telemetry_watch, written by
--     public.telemetry_rollup_and_prune() ~03:00 UTC) plus TODAY AND YESTERDAY
--     live from raw, so neither is stale. telemetry_dau's row for a given UTC day
--     is not finalized until the ~03:00 rollup of the *next* day, so between 00:00
--     and 03:00 UTC yesterday's rollup row still holds only its first ~3 hours;
--     reading yesterday from raw (retained 14 days) avoids that undercount. These
--     never read lifetime_events; the event count is recomputed from telemetry_dau
--     (days before yesterday) + raw.
--   • Top errors (#4): live from raw within its 7-day window (raw keeps the error
--     text 14 days). The telemetry_errors rollup (~7-week retention) is only for
--     error history older than raw.
--
-- "Active watch" = >= 20 events in raw AND last_seen >= now() - interval '1 day'.
-- The watch is watch_key = coalesce(watch_token_hash, account_token_hash). All
-- dates are UTC. Paste each section into a Supabase custom report (Dashboard ->
-- Reports -> New custom report) or run it in the SQL editor.

-- ============================================================
-- 1. Daily active users (last 30 days).
-- count(*) = active watches; count(distinct account_token_hash) = active accounts.
-- telemetry_dau is only rebuilt by the nightly telemetry_rollup_and_prune() cron
-- (~03:00 UTC), and it does not FINALIZE a given UTC day until the run of the
-- *next* day: during the 03:00 run on day D it writes D's row from only the ~3
-- hours seen so far, then finalizes it at 03:00 on D+1. So both the current day
-- AND yesterday can be understated in telemetry_dau (yesterday until tonight's
-- rollup catches up). Compute today and yesterday live from the raw, real-time
-- telemetry_weather_fetch table (retained 14 days) instead; older finalized days
-- still come from telemetry_dau.
-- ============================================================
select
  activity_date as day,
  count(*) as active_watches,
  count(distinct account_token_hash) as active_accounts
from telemetry_dau
where activity_date >= (now() at time zone 'UTC')::date - 30
  and activity_date <  (now() at time zone 'UTC')::date - 1
group by day

union all

select
  (received_at at time zone 'UTC')::date as day,
  count(distinct coalesce(watch_token_hash, account_token_hash)) as active_watches,
  count(distinct account_token_hash) as active_accounts
from telemetry_weather_fetch
where (received_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 1
group by day

order by day;

-- ============================================================
-- 2. Fetches per day, split by outcome (raw; last 14 days)
-- ============================================================
select
  (received_at at time zone 'UTC')::date as day,
  count(*) filter (where success) as ok,
  count(*) filter (where not success) as failed
from telemetry_weather_fetch
where received_at >= now() - interval '14 days'
group by day
order by day;

-- ============================================================
-- 3. Success rate by provider (raw; last 7 days)
-- ============================================================
select
  provider,
  count(*) as fetches,
  round(100.0 * count(*) filter (where success) / count(*), 1) as success_pct
from telemetry_weather_fetch
where received_at >= now() - interval '7 days'
group by provider
order by fetches desc;

-- ============================================================
-- 4. Top errors (raw telemetry_weather_fetch; last 7 days)
-- Reads raw, not the telemetry_errors rollup: raw carries the error text and is
-- retained 14 days (> this 7-day window), so it is live and complete. The
-- telemetry_errors rollup is only rebuilt at ~03:00 UTC, so it misses today's
-- failures and (until tonight's rollup) most of yesterday's. Query telemetry_errors
-- directly only when you need error history older than raw's 14-day retention.
-- ============================================================
select
  left(error, 80) as error,
  count(*) as occurrences,
  count(distinct coalesce(watch_token_hash, account_token_hash)) as affected_watches
from telemetry_weather_fetch
where not success
  and received_at >= now() - interval '7 days'
group by left(error, 80)
order by occurrences desc
limit 20;

-- ============================================================
-- 5. Fetch duration percentiles per day (raw; ms, last 14 days)
-- ============================================================
select
  (received_at at time zone 'UTC')::date as day,
  percentile_cont(0.5) within group (order by duration_ms)::int as p50_ms,
  percentile_cont(0.9) within group (order by duration_ms)::int as p90_ms,
  percentile_cont(0.99) within group (order by duration_ms)::int as p99_ms
from telemetry_weather_fetch
where duration_ms is not null
  and received_at >= now() - interval '14 days'
group by day
order by day;

-- ============================================================
-- 6. Retry pressure: attempts per fetch (raw; last 7 days)
-- attempt = 1 means first try; higher buckets indicate flaky fetches.
-- ============================================================
select
  coalesce(attempt::text, 'unknown') as attempt,
  count(*) as fetches
from telemetry_weather_fetch
where received_at >= now() - interval '7 days'
group by attempt
order by attempt;

-- ── Active install base (queries 7, 8, 11, 12, 13, 14) ──────────────────────
-- These count the CURRENTLY-ACTIVE fleet live from raw telemetry_weather_fetch,
-- not last night's rollup snapshot. A watch is "active" when it (a) has >= 20
-- events in the retained raw window — a genuinely-used install, not someone who
-- fired a few fetches and removed it — and (b) fetched within the last day. The
-- unit is the WATCH: watch_token_hash, falling back to account_token_hash when
-- the watch token is null. The 1-day window is deliberately tight (the watchface
-- fetches every 30-60 min, so a day of silence means it's gone); widen the
-- `interval '1 day'` literal to loosen it. Each report is pasted standalone, so
-- the watch_stats / active / latest_per_watch preamble is repeated per query.

-- ============================================================
-- 7. Feature adoption — active watches only, deduplicated per watch
-- enabled_pct is over the reporting watches (a NULL enabled drops older clients
-- that don't send that setting, so they don't skew the denominator).
-- ============================================================
with watch_stats as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  group by 1
),
active as (
  select watch_key from watch_stats
  where events >= 20 and last_seen >= now() - interval '1 day'
),
latest_per_watch as (
  select distinct on (coalesce(t.watch_token_hash, t.account_token_hash))
    t.settings_json
  from telemetry_weather_fetch t
  join active a on a.watch_key = coalesce(t.watch_token_hash, t.account_token_hash)
  order by coalesce(t.watch_token_hash, t.account_token_hash), t.received_at desc
),
flags as (
  select f.feature, f.enabled
  from latest_per_watch l
  cross join lateral (values
    ('day_night_shading',  (l.settings_json ->> 'dayNightShading') = 'true'),
    ('forecast_secondary', (l.settings_json ->> 'secondaryLine') <> 'off'),
    ('secondary_fill',     case when (l.settings_json ->> 'secondaryLine') = 'precip_prob'
                                then (l.settings_json ->> 'secondaryLineFill') = 'true' end),
    ('forecast_third',     (l.settings_json ->> 'thirdLine') <> 'off'),
    ('rain_bars',          (l.settings_json ->> 'barSource') <> 'off'),
    ('radar',              (l.settings_json ->> 'radarProvider') <> 'disabled'),
    ('rain_countdown',     (l.settings_json ->> 'rainCountdownHorizon') <> '0'),
    ('health',             (l.settings_json ->> 'healthMode') <> 'off'),
    ('night_sleep',        l.settings_json ? 'sleepStartHour'),
    ('view_auto_reset',    (l.settings_json ->> 'viewResetMin') <> '0'),
    ('quiet_time_icon',    (l.settings_json ->> 'showQt') = 'true'),
    ('battery_low_only',   (l.settings_json ->> 'batteryLowOnly') = 'true'),
    ('bt_icons',           (l.settings_json ->> 'btIcons') <> 'none'),
    ('bt_vibrate',         (l.settings_json ->> 'vibe') = 'true'),
    ('time_leading_zero',  (l.settings_json ->> 'timeLeadingZero') = 'true'),
    ('time_am_pm',         (l.settings_json ->> 'timeShowAmPm') = 'true'),
    ('dev_stats',          (l.settings_json ->> 'devStatsEnabled') = 'true')
  ) as f(feature, enabled)
)
select
  feature,
  count(*) filter (where enabled) as enabled_watches,
  count(*) filter (where enabled is not null) as reporting_watches,
  round(100.0 * count(*) filter (where enabled)
        / nullif(count(*) filter (where enabled is not null), 0), 1) as enabled_pct
from flags
group by feature
order by enabled_watches desc;

-- ============================================================
-- 8. App version x watch platform — active watches only, at each watch's
-- latest event. app_version orders lexically (not strict semver).
-- ============================================================
with watch_stats as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  group by 1
),
active as (
  select watch_key from watch_stats
  where events >= 20 and last_seen >= now() - interval '1 day'
),
latest_per_watch as (
  select distinct on (coalesce(t.watch_token_hash, t.account_token_hash))
    t.app_version,
    coalesce(t.watch_info ->> 'platform', 'unknown') as platform
  from telemetry_weather_fetch t
  join active a on a.watch_key = coalesce(t.watch_token_hash, t.account_token_hash)
  order by coalesce(t.watch_token_hash, t.account_token_hash), t.received_at desc
)
select
  app_version,
  platform,
  count(*) as watches
from latest_per_watch
group by app_version, platform
order by app_version desc, watches desc;

-- ============================================================
-- 9. Lifecycle cohorts over the complete timeline
--   trial   — < 20 events (installed, played around, never stuck)
--   active  — >= 20 events AND seen within the last day
--   churned — >= 20 events but last seen is older (was a real user, now gone)
-- Union: finalized history from telemetry_dau + telemetry_watch (first/last_seen)
-- plus TODAY AND YESTERDAY live from raw, so the split reflects the current day and
-- isn't skewed by yesterday's not-yet-finalized rollup row (see #1). The event
-- count is recomputed (telemetry_dau days before yesterday + raw for yesterday and
-- today); it never reads lifetime_events. least()/greatest() ignore NULLs, so a
-- watch missing from either side (e.g. brand-new today, or long-churned and pruned
-- from raw) still gets correct first/last_seen.
-- ============================================================
with recent as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         min(received_at) as first_seen,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  where (received_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 1
  group by 1
),
hist as (
  select watch_key, sum(fetch_count) as events
  from telemetry_dau
  where activity_date < (now() at time zone 'UTC')::date - 1
  group by watch_key
),
watch_stats as (
  select
    coalesce(w.watch_key, h.watch_key, t.watch_key) as watch_key,
    coalesce(h.events, 0) + coalesce(t.events, 0)   as events,
    least(w.first_seen, t.first_seen)               as first_seen,
    greatest(w.last_seen, t.last_seen)              as last_seen
  from telemetry_watch w
  full outer join hist   h on h.watch_key = w.watch_key
  full outer join recent t on t.watch_key = coalesce(w.watch_key, h.watch_key)
)
select
  case
    when events < 20                              then 'trial (<20 events)'
    when last_seen >= now() - interval '1 day'    then 'active'
    else                                               'churned'
  end as cohort,
  count(*) as watches,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from watch_stats
group by 1
order by watches desc;

-- ============================================================
-- 10. Churn tenure — how long churned watches lasted (last_seen - first_seen).
-- Buckets prefixed 0-6 so they sort in order. Same union as #9 (finalized rollup
-- history + today AND yesterday live from raw; the event count never uses
-- lifetime_events).
-- ============================================================
with recent as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         min(received_at) as first_seen,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  where (received_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 1
  group by 1
),
hist as (
  select watch_key, sum(fetch_count) as events
  from telemetry_dau
  where activity_date < (now() at time zone 'UTC')::date - 1
  group by watch_key
),
watch_stats as (
  select
    coalesce(w.watch_key, h.watch_key, t.watch_key) as watch_key,
    coalesce(h.events, 0) + coalesce(t.events, 0)   as events,
    least(w.first_seen, t.first_seen)               as first_seen,
    greatest(w.last_seen, t.last_seen)              as last_seen
  from telemetry_watch w
  full outer join hist   h on h.watch_key = w.watch_key
  full outer join recent t on t.watch_key = coalesce(w.watch_key, h.watch_key)
),
churned as (
  select extract(epoch from (last_seen - first_seen)) / 86400.0 as tenure_days
  from watch_stats
  where events >= 20 and last_seen < now() - interval '1 day'
)
select
  case
    when tenure_days < 1  then '0: < 1 day'
    when tenure_days < 2  then '1: 1-2 days'
    when tenure_days < 3  then '2: 2-3 days'
    when tenure_days < 7  then '3: 3-7 days'
    when tenure_days < 30 then '4: 7-30 days'
    when tenure_days < 90 then '5: 30-90 days'
    else                       '6: 90+ days'
  end as churned_after,
  count(*) as watches,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from churned
group by 1
order by churned_after;

-- ============================================================
-- 11. Settings profile of the ACTIVE watches
-- Option distribution over the active install base, one row per active watch.
-- ============================================================
with watch_stats as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  group by 1
),
active as (
  select watch_key from watch_stats
  where events >= 20 and last_seen >= now() - interval '1 day'
),
latest_per_watch as (
  select distinct on (coalesce(t.watch_token_hash, t.account_token_hash))
    t.settings_json
  from telemetry_weather_fetch t
  join active a on a.watch_key = coalesce(t.watch_token_hash, t.account_token_hash)
  order by coalesce(t.watch_token_hash, t.account_token_hash), t.received_at desc
)
select
  s.setting,
  s.option,
  count(*) as watches
from latest_per_watch l
cross join lateral (values
  ('temperatureUnits',     l.settings_json ->> 'temperatureUnits'),
  ('provider',             l.settings_json ->> 'provider'),
  ('fetchIntervalMin',     l.settings_json ->> 'fetchIntervalMin'),
  ('secondaryLine',        l.settings_json ->> 'secondaryLine'),
  ('thirdLine',            l.settings_json ->> 'thirdLine'),
  ('windScale',            l.settings_json ->> 'windScale'),
  ('rainBarColor',         l.settings_json ->> 'rainBarColor'),
  ('radarProvider',        l.settings_json ->> 'radarProvider'),
  ('radarColor',           l.settings_json ->> 'radarColor'),
  ('healthMode',           l.settings_json ->> 'healthMode'),
  ('rainCountdownHorizon', l.settings_json ->> 'rainCountdownHorizon'),
  ('layoutPreset',         l.settings_json ->> 'layoutPreset'),
  ('viewResetMin',         l.settings_json ->> 'viewResetMin'),
  ('btIcons',              l.settings_json ->> 'btIcons'),
  ('timeFont',             l.settings_json ->> 'timeFont'),
  ('axisTimeFormat',       l.settings_json ->> 'axisTimeFormat'),
  ('weekStartDay',         l.settings_json ->> 'weekStartDay'),
  ('firstWeek',            l.settings_json ->> 'firstWeek'),
  ('theme',                l.settings_json ->> 'theme'),
  ('configTheme',          l.settings_json ->> 'configTheme'),
  ('aqiScale',             l.settings_json ->> 'aqiScale'),
  ('aqiSource',            l.settings_json ->> 'aqiSource')
) as s(setting, option)
where s.option is not null
group by s.setting, s.option
order by s.setting, watches desc;

-- ============================================================
-- 12. Weather provider by country — active watches only
-- ============================================================
with watch_stats as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  group by 1
),
active as (
  select watch_key from watch_stats
  where events >= 20 and last_seen >= now() - interval '1 day'
),
latest_per_watch as (
  select distinct on (coalesce(t.watch_token_hash, t.account_token_hash))
    coalesce(t.country_code, 'unknown') as country,
    t.provider
  from telemetry_weather_fetch t
  join active a on a.watch_key = coalesce(t.watch_token_hash, t.account_token_hash)
  order by coalesce(t.watch_token_hash, t.account_token_hash), t.received_at desc
)
select
  country,
  provider,
  count(*) as watches
from latest_per_watch
group by country, provider
order by country, watches desc;

-- ============================================================
-- 13. Status usage overview — pool all 12 status slots across active watches,
-- rank each status code by total uses ("what status is used how often").
-- ============================================================
with watch_stats as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  group by 1
),
active as (
  select watch_key from watch_stats
  where events >= 20 and last_seen >= now() - interval '1 day'
),
latest_per_watch as (
  select distinct on (coalesce(t.watch_token_hash, t.account_token_hash))
    t.settings_json
  from telemetry_weather_fetch t
  join active a on a.watch_key = coalesce(t.watch_token_hash, t.account_token_hash)
  order by coalesce(t.watch_token_hash, t.account_token_hash), t.received_at desc
)
select
  code,
  count(*) as uses
from latest_per_watch a
cross join lateral (values
  (a.settings_json ->> 'statusForecastLeft'), (a.settings_json ->> 'statusForecastMid'),
  (a.settings_json ->> 'statusForecastRight'), (a.settings_json ->> 'statusRadarLeft'),
  (a.settings_json ->> 'statusRadarMid'), (a.settings_json ->> 'statusRadarRight'),
  (a.settings_json ->> 'statusTopLeft'), (a.settings_json ->> 'statusTopMid'),
  (a.settings_json ->> 'statusTopRight'), (a.settings_json ->> 'statusHealthLeft'),
  (a.settings_json ->> 'statusHealthMid'), (a.settings_json ->> 'statusHealthRight')
) as s(code)
where code is not null and code <> 'empty'
group by code
order by uses desc;

-- ============================================================
-- 14. Per-slot ranking — for each of the 12 slots, rank the codes chosen
-- (`rnk` = popularity within that slot).
-- ============================================================
with watch_stats as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  group by 1
),
active as (
  select watch_key from watch_stats
  where events >= 20 and last_seen >= now() - interval '1 day'
),
latest_per_watch as (
  select distinct on (coalesce(t.watch_token_hash, t.account_token_hash))
    t.settings_json
  from telemetry_weather_fetch t
  join active a on a.watch_key = coalesce(t.watch_token_hash, t.account_token_hash)
  order by coalesce(t.watch_token_hash, t.account_token_hash), t.received_at desc
)
select
  slot,
  code,
  count(*) as watches,
  rank() over (partition by slot order by count(*) desc) as rnk
from latest_per_watch a
cross join lateral (values
  ('statusForecastLeft',  a.settings_json ->> 'statusForecastLeft'),
  ('statusForecastMid',   a.settings_json ->> 'statusForecastMid'),
  ('statusForecastRight', a.settings_json ->> 'statusForecastRight'),
  ('statusRadarLeft',     a.settings_json ->> 'statusRadarLeft'),
  ('statusRadarMid',      a.settings_json ->> 'statusRadarMid'),
  ('statusRadarRight',    a.settings_json ->> 'statusRadarRight'),
  ('statusTopLeft',       a.settings_json ->> 'statusTopLeft'),
  ('statusTopMid',        a.settings_json ->> 'statusTopMid'),
  ('statusTopRight',      a.settings_json ->> 'statusTopRight'),
  ('statusHealthLeft',    a.settings_json ->> 'statusHealthLeft'),
  ('statusHealthMid',     a.settings_json ->> 'statusHealthMid'),
  ('statusHealthRight',   a.settings_json ->> 'statusHealthRight')
) as s(slot, code)
where code is not null
group by slot, code
order by slot, watches desc;
