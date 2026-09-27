set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.telemetry_recent_insert_count(p_account_token_hash text, p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select count(*)::integer
    from public.telemetry_weather_fetch t
   where t.account_token_hash = p_account_token_hash
     and t.inserted_at >= p_since;
$function$
;





-- Hand-added: `supabase db diff` does not capture function ACLs (see telemetry.sql).
revoke all on function public.telemetry_recent_insert_count(text, timestamp with time zone)
  from public, anon, authenticated;
