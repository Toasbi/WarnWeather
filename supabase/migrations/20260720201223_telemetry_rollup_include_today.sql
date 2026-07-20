-- NOTE: `supabase db diff` emits `drop extension pg_cron` here because pg_cron is
-- declared in a hand-written migration (20260720192917_telemetry_cron.sql), not in
-- the declarative schemas/. Dropping it would delete the scheduled job — removed by
-- hand. Ignore/strip that line on every future diff that touches this schema.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.telemetry_rollup_and_prune(p_raw_retention_days integer DEFAULT 14, p_error_retention_days integer DEFAULT 49, p_prune boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- 1. Rebuild telemetry_dau for every UTC day present in raw (incl. today —
  --    today's row is live and finalizes when the day completes; pruning is
  --    bounded by age only, so it never deletes today's raw).
  delete from public.telemetry_dau
   where activity_date in (
     select distinct (received_at at time zone 'UTC')::date
       from public.telemetry_weather_fetch
   );

  insert into public.telemetry_dau (
    watch_key, activity_date, account_token_hash, fetch_count,
    provider, radar_provider, country_code,
    watch_platform, watch_model, watch_language, app_version, build_profile)
  select
    d.watch_key, d.day, d.account_token_hash, d.fetch_count,
    l.provider, l.radar_provider, l.country_code,
    l.watch_platform, l.watch_model, l.watch_language, l.app_version, l.build_profile
  from (
    select
      coalesce(watch_token_hash, account_token_hash) as watch_key,
      (received_at at time zone 'UTC')::date as day,
      max(account_token_hash) as account_token_hash,
      count(*) as fetch_count
    from public.telemetry_weather_fetch
    group by 1, 2
  ) d
  join lateral (
    select
      t.provider,
      t.settings_json ->> 'radarProvider' as radar_provider,
      t.country_code,
      t.watch_info ->> 'platform' as watch_platform,
      t.watch_info ->> 'model' as watch_model,
      t.watch_info ->> 'language' as watch_language,
      t.app_version,
      t.build_profile
    from public.telemetry_weather_fetch t
    where coalesce(t.watch_token_hash, t.account_token_hash) = d.watch_key
      and (t.received_at at time zone 'UTC')::date = d.day
    order by t.received_at desc
    limit 1
  ) l on true;

  -- 2. Upsert telemetry_watch (latest dims + monotone first/last seen).
  insert into public.telemetry_watch (
    watch_key, account_token_hash, first_seen, last_seen,
    first_app_version, last_app_version, country_code, provider, radar_provider,
    watch_platform, watch_model, watch_language, watch_firmware, build_profile, settings_json)
  select
    w.watch_key, w.account_token_hash, w.first_seen, w.last_seen,
    l.app_version, l.app_version, l.country_code, l.provider, l.radar_provider,
    l.watch_platform, l.watch_model, l.watch_language, l.watch_firmware, l.build_profile, l.settings_json
  from (
    select
      coalesce(watch_token_hash, account_token_hash) as watch_key,
      max(account_token_hash) as account_token_hash,
      min(received_at) as first_seen,
      max(received_at) as last_seen
    from public.telemetry_weather_fetch
    group by 1
  ) w
  join lateral (
    select
      t.app_version, t.country_code, t.provider,
      t.settings_json ->> 'radarProvider' as radar_provider,
      t.watch_info ->> 'platform' as watch_platform,
      t.watch_info ->> 'model' as watch_model,
      t.watch_info ->> 'language' as watch_language,
      concat_ws('.', t.watch_info -> 'firmware' ->> 'major',
                     t.watch_info -> 'firmware' ->> 'minor',
                     t.watch_info -> 'firmware' ->> 'patch') as watch_firmware,
      t.build_profile,
      nullif(t.settings_json, '{}'::jsonb) as settings_json
    from public.telemetry_weather_fetch t
    where coalesce(t.watch_token_hash, t.account_token_hash) = w.watch_key
    order by t.received_at desc
    limit 1
  ) l on true
  on conflict (watch_key) do update set
    account_token_hash = excluded.account_token_hash,
    first_seen = least(public.telemetry_watch.first_seen, excluded.first_seen),
    last_seen  = greatest(public.telemetry_watch.last_seen, excluded.last_seen),
    last_app_version = case when excluded.last_seen >= public.telemetry_watch.last_seen
                            then excluded.last_app_version else public.telemetry_watch.last_app_version end,
    country_code = case when excluded.last_seen >= public.telemetry_watch.last_seen
                        then excluded.country_code else public.telemetry_watch.country_code end,
    provider = case when excluded.last_seen >= public.telemetry_watch.last_seen
                    then excluded.provider else public.telemetry_watch.provider end,
    radar_provider = case when excluded.last_seen >= public.telemetry_watch.last_seen
                          then excluded.radar_provider else public.telemetry_watch.radar_provider end,
    watch_platform = case when excluded.last_seen >= public.telemetry_watch.last_seen
                          then excluded.watch_platform else public.telemetry_watch.watch_platform end,
    watch_model = case when excluded.last_seen >= public.telemetry_watch.last_seen
                       then excluded.watch_model else public.telemetry_watch.watch_model end,
    watch_language = case when excluded.last_seen >= public.telemetry_watch.last_seen
                          then excluded.watch_language else public.telemetry_watch.watch_language end,
    watch_firmware = case when excluded.last_seen >= public.telemetry_watch.last_seen
                          then excluded.watch_firmware else public.telemetry_watch.watch_firmware end,
    build_profile = case when excluded.last_seen >= public.telemetry_watch.last_seen
                         then excluded.build_profile else public.telemetry_watch.build_profile end,
    -- keep the newest NON-NULL settings snapshot; never overwrite with older/null
    settings_json = coalesce(
      case when excluded.last_seen >= public.telemetry_watch.last_seen
           then excluded.settings_json else null end,
      public.telemetry_watch.settings_json,
      excluded.settings_json);
  -- NOTE: first_app_version intentionally NOT in the update list (insert-only).

  -- 2b. Recompute lifetime_events from the full daily fact (idempotent).
  update public.telemetry_watch w
     set lifetime_events = coalesce(
       (select sum(d.fetch_count) from public.telemetry_dau d where d.watch_key = w.watch_key), 0);

  -- 3. Rebuild telemetry_errors for every day present in raw (incl. today).
  delete from public.telemetry_errors
   where (received_at at time zone 'UTC')::date in (
     select distinct (received_at at time zone 'UTC')::date
       from public.telemetry_weather_fetch
   );
  insert into public.telemetry_errors (
    received_at, watch_key, account_token_hash, provider, error, country_code,
    app_version, build_profile, gps_error_code, location_mode, duration_ms, attempt, watch_platform)
  select
    received_at, coalesce(watch_token_hash, account_token_hash), account_token_hash,
    provider, error, country_code, app_version, build_profile,
    gps_error_code, location_mode, duration_ms, attempt, watch_info ->> 'platform'
  from public.telemetry_weather_fetch
  where not success;

  -- 4. Prune (raw first-rolled-up days, aged errors, dead rainbow rows).
  if p_prune then
    delete from public.telemetry_weather_fetch
      where received_at < now() - make_interval(days => p_raw_retention_days);
    delete from public.telemetry_errors
      where received_at < now() - make_interval(days => p_error_retention_days);
    delete from public.rainbow_nowcast_cache where expires_at < now();
    -- IPv6 keys contain colons; the hour suffix is the last 13 chars ("YYYY-MM-DDTHH").
    delete from public.rainbow_ip_usage
      where right(ip_hour, 13) < to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24');
  end if;
end;
$function$
;


