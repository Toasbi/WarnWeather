-- Telemetry dashboards.
--
-- Source of truth is now the rollup tables written daily by
-- public.telemetry_rollup_and_prune():
--   telemetry_watch   — one row per watch (current snapshot; active-base flags)
--   telemetry_dau     — one row per (watch, day) activity fact (full history)
--   telemetry_errors  — slim failed-fetch log (~7 weeks)
-- Raw telemetry_weather_fetch is retained only 14 days, so recent-ops queries
-- (#2, #3, #5, #6) that still read it are bounded to that window.
--
-- "Active watch" = lifetime_events >= 20 AND last_seen >= now() - interval '1 day'.
-- The watch is watch_key = coalesce(watch_token_hash, account_token_hash), baked
-- into the rollup. All dates are UTC. Paste each section into a Supabase custom
-- report (Dashboard -> Reports -> New custom report) or run it in the SQL editor.

-- ============================================================
-- 1. Daily active users (last 30 days).
-- count(*) = active watches; count(distinct account_token_hash) = active accounts.
-- telemetry_dau is only rebuilt by the nightly telemetry_rollup_and_prune() cron
-- (~03:00 UTC), so its row for the current UTC day reflects only fetches seen as
-- of that run and understates today until tonight's rollup catches up. Compute
-- today live from the raw, real-time telemetry_weather_fetch table instead;
-- history (finalized days) still comes from telemetry_dau.
-- ============================================================
select
  activity_date as day,
  count(*) as active_watches,
  count(distinct account_token_hash) as active_accounts
from telemetry_dau
where activity_date >= (now() at time zone 'UTC')::date - 30
  and activity_date < (now() at time zone 'UTC')::date
group by day

union all

select
  (now() at time zone 'UTC')::date as day,
  count(distinct coalesce(watch_token_hash, account_token_hash)) as active_watches,
  count(distinct account_token_hash) as active_accounts
from telemetry_weather_fetch
where (received_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date

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
-- 4. Top errors (telemetry_errors; last 7 days, up to 7 weeks retained)
-- ============================================================
select
  left(error, 80) as error,
  count(*) as occurrences,
  count(distinct watch_key) as affected_watches
from telemetry_errors
where received_at >= now() - interval '7 days'
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

-- ============================================================
-- 7. Feature adoption — active watches only
-- ============================================================
with active as (
  select settings_json from telemetry_watch
  where lifetime_events >= 20 and last_seen >= now() - interval '1 day'
),
flags as (
  select f.feature, f.enabled
  from active l
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
    ('quiet_time_icon',    (l.settings_json ->> 'showQt') = 'true'),
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
select
  last_app_version as app_version,
  coalesce(watch_platform, 'unknown') as platform,
  count(*) as watches
from telemetry_watch
where lifetime_events >= 20 and last_seen >= now() - interval '1 day'
group by last_app_version, platform
order by app_version desc, watches desc;

-- ============================================================
-- 9. Lifecycle cohorts over the complete timeline
--   trial   — < 20 lifetime events (installed, played around, never stuck)
--   active  — >= 20 events AND seen within the last day
--   churned — >= 20 events but last seen is older (was a real user, now gone)
-- ============================================================
select
  case
    when lifetime_events < 20                        then 'trial (<20 events)'
    when last_seen >= now() - interval '1 day'       then 'active'
    else                                                  'churned'
  end as cohort,
  count(*) as watches,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from telemetry_watch
group by 1
order by watches desc;

-- ============================================================
-- 10. Churn tenure — how long churned watches lasted (last_seen - first_seen).
-- Buckets prefixed 0-6 so they sort in order.
-- ============================================================
with churned as (
  select extract(epoch from (last_seen - first_seen)) / 86400.0 as tenure_days
  from telemetry_watch
  where lifetime_events >= 20 and last_seen < now() - interval '1 day'
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
with active as (
  select settings_json from telemetry_watch
  where lifetime_events >= 20 and last_seen >= now() - interval '1 day'
)
select
  s.setting,
  s.option,
  count(*) as watches
from active l
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
select
  coalesce(country_code, 'unknown') as country,
  provider,
  count(*) as watches
from telemetry_watch
where lifetime_events >= 20 and last_seen >= now() - interval '1 day'
group by country, provider
order by country, watches desc;

-- ============================================================
-- 13. Status usage overview — pool all 12 status slots across active watches,
-- rank each status code by total uses ("what status is used how often").
-- ============================================================
with active as (
  select settings_json from telemetry_watch
  where lifetime_events >= 20 and last_seen >= now() - interval '1 day'
)
select
  code,
  count(*) as uses
from active a
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
with active as (
  select settings_json from telemetry_watch
  where lifetime_events >= 20 and last_seen >= now() - interval '1 day'
)
select
  slot,
  code,
  count(*) as watches,
  rank() over (partition by slot order by count(*) desc) as rnk
from active a
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
