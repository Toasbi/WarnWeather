-- Telemetry dashboards for public.telemetry_weather_fetch
--
-- Each section is one chart-ready query: paste it into a SQL block of a
-- Supabase custom report (Dashboard -> Reports -> New custom report) or run
-- it in the SQL editor. Queries return few, flat columns so Studio's chart
-- view can map them to x/y directly. All dates are UTC, matching the
-- telemetry_weather_fetch_dau_idx index.

-- ============================================================
-- 1. Daily active users (distinct accounts per day, last 30 days)
-- ============================================================
select
  (received_at at time zone 'UTC')::date as day,
  count(distinct account_token_hash) as active_users
from telemetry_weather_fetch
where received_at >= now() - interval '30 days'
group by day
order by day;

-- ============================================================
-- 2. Fetches per day, split by outcome (last 30 days)
-- ============================================================
select
  (received_at at time zone 'UTC')::date as day,
  count(*) filter (where success) as ok,
  count(*) filter (where not success) as failed
from telemetry_weather_fetch
where received_at >= now() - interval '30 days'
group by day
order by day;

-- ============================================================
-- 3. Success rate by provider (last 7 days)
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
-- 4. Top errors (last 7 days)
-- ============================================================
select
  left(error, 80) as error,
  count(*) as occurrences,
  count(distinct account_token_hash) as affected_users
from telemetry_weather_fetch
where not success
  and received_at >= now() - interval '7 days'
group by left(error, 80)
order by occurrences desc
limit 20;

-- ============================================================
-- 5. Fetch duration percentiles per day (ms, last 30 days)
-- ============================================================
select
  (received_at at time zone 'UTC')::date as day,
  percentile_cont(0.5) within group (order by duration_ms)::int as p50_ms,
  percentile_cont(0.9) within group (order by duration_ms)::int as p90_ms,
  percentile_cont(0.99) within group (order by duration_ms)::int as p99_ms
from telemetry_weather_fetch
where duration_ms is not null
  and received_at >= now() - interval '30 days'
group by day
order by day;

-- ============================================================
-- 6. App version adoption (distinct users, last 7 days)
-- ============================================================
select
  app_version,
  count(distinct account_token_hash) as users
from telemetry_weather_fetch
where received_at >= now() - interval '7 days'
group by app_version
order by users desc;

-- ============================================================
-- 7. Watch platform breakdown (distinct users, last 7 days)
-- ============================================================
select
  coalesce(watch_info ->> 'platform', 'unknown') as platform,
  count(distinct account_token_hash) as users
from telemetry_weather_fetch
where received_at >= now() - interval '7 days'
group by platform
order by users desc;

-- ============================================================
-- 8. Users by country (last 7 days)
-- ============================================================
select
  coalesce(country_code, 'unknown') as country,
  count(distinct account_token_hash) as users
from telemetry_weather_fetch
where received_at >= now() - interval '7 days'
group by country
order by users desc;

-- ============================================================
-- 9. Update interval distribution (distinct users, last 7 days)
-- Requires clients sending settings.fetchIntervalMin (>= telemetry v2).
-- ============================================================
select
  coalesce(settings_json ->> 'fetchIntervalMin', 'unknown') as interval_min,
  count(distinct account_token_hash) as users
from telemetry_weather_fetch
where received_at >= now() - interval '7 days'
group by interval_min
order by users desc;

-- ============================================================
-- 10. Night-sleep window adoption (distinct users, last 7 days)
-- Presence of sleepStartHour implies the feature is enabled; the
-- boolean itself is intentionally not stored.
-- ============================================================
select
  case when settings_json ? 'sleepStartHour' then 'enabled' else 'disabled' end as night_sleep,
  count(distinct account_token_hash) as users
from telemetry_weather_fetch
where received_at >= now() - interval '7 days'
group by night_sleep
order by users desc;

-- ============================================================
-- 11. Location mode and GPS cache usage (last 7 days)
-- ============================================================
select
  coalesce(location_mode, 'unknown') as location_mode,
  count(*) as fetches,
  count(*) filter (where used_gps_cache) as via_gps_cache
from telemetry_weather_fetch
where received_at >= now() - interval '7 days'
group by location_mode
order by fetches desc;

-- ============================================================
-- 12. Retry pressure: attempts per fetch (last 7 days)
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
-- 13. Daily feature adoption (toggle features, last 30 days)
-- One row per (day, feature). A user fires many fetches per day, so we
-- first reduce to that user's LAST event of the day and read its settings;
-- each user therefore counts once per day per feature.
--   enabled_users   = users whose feature was on
--   reporting_users = users who sent the relevant key at all (older clients
--                     predating the key are excluded, so the % stays honest)
--   enabled_pct     = enabled_users / reporting_users
-- Newer keys (secondaryLine, barSource, radarProvider, devStatsEnabled,
-- thirdLine, healthMode, rainCountdownHorizon, ...) require telemetry >= the
-- release that added them; before that they read NULL and simply drop out of
-- reporting_users.
-- ============================================================
with latest_per_user_day as (
  select distinct on ((received_at at time zone 'UTC')::date, account_token_hash)
    (received_at at time zone 'UTC')::date as day,
    settings_json
  from telemetry_weather_fetch
  where received_at >= now() - interval '30 days'
  order by (received_at at time zone 'UTC')::date, account_token_hash, received_at desc
),
flags as (
  select l.day, f.feature, f.enabled
  from latest_per_user_day l
  cross join lateral (values
    ('day_night_shading',  (l.settings_json ->> 'dayNightShading') = 'true'),
    ('forecast_secondary', (l.settings_json ->> 'secondaryLine') <> 'off'),
    -- only meaningful in precip mode; everyone else reads NULL (out of denominator)
    ('secondary_fill',     case when (l.settings_json ->> 'secondaryLine') = 'precip_prob'
                                then (l.settings_json ->> 'secondaryLineFill') = 'true' end),
    -- third metric line (any metric, incl. wind gust / UV); off sentinel = 'off'
    ('forecast_third',     (l.settings_json ->> 'thirdLine') <> 'off'),
    ('rain_bars',          (l.settings_json ->> 'barSource') <> 'off'),
    ('radar',              (l.settings_json ->> 'radarProvider') <> 'disabled'),
    -- rain-countdown alert; horizon 0 = off
    ('rain_countdown',     (l.settings_json ->> 'rainCountdownHorizon') <> '0'),
    ('health',             (l.settings_json ->> 'healthMode') <> 'off'),
    -- presence of sleepStartHour implies night-sleep on; key has always been sent,
    -- so reporting_users here is effectively all active users
    ('night_sleep',        l.settings_json ? 'sleepStartHour'),
    ('quiet_time_icon',    (l.settings_json ->> 'showQt') = 'true'),
    ('bt_vibrate',         (l.settings_json ->> 'vibe') = 'true'),
    ('time_leading_zero',  (l.settings_json ->> 'timeLeadingZero') = 'true'),
    ('time_am_pm',         (l.settings_json ->> 'timeShowAmPm') = 'true'),
    ('dev_stats',          (l.settings_json ->> 'devStatsEnabled') = 'true')
  ) as f(feature, enabled)
)
select
  day,
  feature,
  count(*) filter (where enabled) as enabled_users,
  count(*) filter (where enabled is not null) as reporting_users,
  round(100.0 * count(*) filter (where enabled)
        / nullif(count(*) filter (where enabled is not null), 0), 1) as enabled_pct
from flags
group by day, feature
order by day, feature;

-- ============================================================
-- 14. Current feature adoption snapshot (rolling last 24h)
-- Same toggle list as #13 but collapsed to one row per feature using each
-- user's most recent event. Good as a "where do things stand now" table,
-- sorted by reach. Swap the interval to widen the snapshot window.
-- ============================================================
with latest_per_user as (
  select distinct on (account_token_hash)
    settings_json
  from telemetry_weather_fetch
  where received_at >= now() - interval '24 hours'
  order by account_token_hash, received_at desc
),
flags as (
  select f.feature, f.enabled
  from latest_per_user l
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
  count(*) filter (where enabled) as enabled_users,
  count(*) filter (where enabled is not null) as reporting_users,
  round(100.0 * count(*) filter (where enabled)
        / nullif(count(*) filter (where enabled is not null), 0), 1) as enabled_pct
from flags
group by feature
order by enabled_users desc;

-- ============================================================
-- 15. Setting option distribution (multi-choice settings, last 7 days)
-- For settings that pick one of several values rather than on/off. One row
-- per (setting, chosen option) with the distinct-user count, latest value
-- per user. windScale / rainBarColor / radarColor reflect the stored value
-- even when that section isn't currently shown on the watch.
-- ============================================================
with latest_per_user as (
  select distinct on (account_token_hash)
    settings_json
  from telemetry_weather_fetch
  where received_at >= now() - interval '7 days'
  order by account_token_hash, received_at desc
)
select
  s.setting,
  s.option,
  count(*) as users
from latest_per_user l
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
  ('topViewMode',          l.settings_json ->> 'topViewMode'),
  ('layoutPreset',         l.settings_json ->> 'layoutPreset'),
  ('viewResetMin',         l.settings_json ->> 'viewResetMin'),
  ('btIcons',              l.settings_json ->> 'btIcons'),
  ('timeFont',             l.settings_json ->> 'timeFont'),
  ('axisTimeFormat',       l.settings_json ->> 'axisTimeFormat'),
  ('weekStartDay',         l.settings_json ->> 'weekStartDay'),
  ('firstWeek',            l.settings_json ->> 'firstWeek')
) as s(setting, option)
where s.option is not null
group by s.setting, s.option
order by s.setting, users desc;

-- ── Active install base (queries 16-18) ──────────────────────────────────────
-- These three count the CURRENTLY-ACTIVE fleet, not everyone who ever opened the
-- watchface. A watch is "active" when it (a) has at least 20 lifetime events — a
-- genuinely-used install, not someone who installed it, fired a few fetches
-- playing around, and removed it — and (b) fetched within the last day. Tune the
-- `events >= 20` floor per query. The unit is the WATCH: watch_token_hash, falling back to
-- account_token_hash when the watch token is null so null-watch rows don't
-- collapse into one bucket. The 1-day window is deliberately tight (the watchface
-- fetches every 30-60 min, so a day of silence means it's gone); widen the
-- `interval '1 day'` literal in each query to loosen it.

-- ============================================================
-- 16. Feature adoption — active watches only, deduplicated per watch
-- Same enabled/reporting/% columns and NULL-drops-older-clients rule as #13/#14,
-- but restricted to the active install base (see the note above).
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
-- 17. App version x watch platform — active watches only, at each watch's LATEST event
-- Version and platform grouped in one table over the active install base. Each
-- active watch appears once under its current version (never double-counted in a
-- version it moved off). app_version orders lexically (good enough for display;
-- not strict semver, so 1.10 would sort under 1.9).
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
-- 18. Lifecycle cohorts over the complete timeline
-- Every watch that ever sent data, split into a few cohorts:
--   trial   — < 20 lifetime events (installed, played around, never stuck)
--   active  — >= 20 events AND fetched within the last day
--   churned — >= 20 events but last fetch is older (was a real user, now gone)
-- Per watch, same key/window as #16-17. Covers the whole install history, so the
-- three cohorts sum to every watch ever seen.
-- ============================================================
with watch_stats as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  group by 1
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
-- 19. Churn tenure — after how many days did churned watches churn
-- For churned watches (>= 20 events, inactive > 1 day), how long they were around
-- before going silent: last_seen - first_seen. Answers "they used it for N days,
-- then churned." Buckets are prefixed 0-4 so they sort in order, not alphabetically.
-- ============================================================
with watch_stats as (
  select coalesce(watch_token_hash, account_token_hash) as watch_key,
         count(*) as events,
         min(received_at) as first_seen,
         max(received_at) as last_seen
  from telemetry_weather_fetch
  group by 1
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
-- 20. Settings profile of the ACTIVE users
-- Setting option distribution (as #15) but restricted to the active install base
-- (>= 20 events + fetched in the last day), one row per active watch at its latest
-- event. Shows how people who actually use the app configure it.
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
  ('topViewMode',          l.settings_json ->> 'topViewMode'),
  ('layoutPreset',         l.settings_json ->> 'layoutPreset'),
  ('viewResetMin',         l.settings_json ->> 'viewResetMin'),
  ('btIcons',              l.settings_json ->> 'btIcons'),
  ('timeFont',             l.settings_json ->> 'timeFont'),
  ('axisTimeFormat',       l.settings_json ->> 'axisTimeFormat'),
  ('weekStartDay',         l.settings_json ->> 'weekStartDay'),
  ('firstWeek',            l.settings_json ->> 'firstWeek')
) as s(setting, option)
where s.option is not null
group by s.setting, s.option
order by s.setting, watches desc;
