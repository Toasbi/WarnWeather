-- Append 'yandex' and 'tomorrowio' to the weather_provider enum so telemetry
-- ingestion for those providers stops failing with:
--   invalid input value for enum weather_provider: "tomorrowio"
-- ALTER TYPE ... ADD VALUE is used instead of the rename-recreate-swap pattern
-- (which `supabase db diff` generates) to avoid rewriting the four tables that
-- reference the enum (telemetry_weather_fetch, telemetry_dau, telemetry_errors,
-- telemetry_watch) and to avoid db diff's spurious `drop extension pg_cron`.
alter type "public"."weather_provider" add value if not exists 'yandex';
alter type "public"."weather_provider" add value if not exists 'tomorrowio';
