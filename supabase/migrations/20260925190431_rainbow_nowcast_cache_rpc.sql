set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_rainbow_nowcast_cache(p_cache_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('payload', c.payload, 'expires_at', c.expires_at)
    from public.rainbow_nowcast_cache c
   where c.cache_key = p_cache_key;
$function$
;




-- Hand-added: `supabase db diff` does not capture function ACLs (see rainbow.sql).
revoke all on function public.get_rainbow_nowcast_cache(text)
  from public, anon, authenticated;
