set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.news_list(p_version text, p_account_token_hash text, p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with items as (
    select n.id, n.created_at, n.title, n.body_md, n.choices
      from public.news n
     where n.target_version is null or n.target_version = p_version
     order by n.id desc
     limit p_limit
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id,
               'created_at', i.created_at,
               'title', i.title,
               'body_md', i.body_md,
               'choices', i.choices,
               'my_choice', v.choice_index
             ) order by i.id desc)
        from items i
        left join public.news_votes v
          on v.news_id = i.id
         and v.account_token_hash = p_account_token_hash
    ), '[]'::jsonb),
    'last_seen_id', case
      when p_account_token_hash is null then null
      else coalesce((
        select s.last_seen_news_id
          from public.news_seen s
         where s.account_token_hash = p_account_token_hash
      ), 0)
    end
  );
$function$
;

CREATE OR REPLACE FUNCTION public.news_mark_seen(p_account_token_hash text, p_max_seen_id bigint)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  insert into public.news_seen as s (account_token_hash, last_seen_news_id, updated_at)
  values (p_account_token_hash, p_max_seen_id, now())
  on conflict (account_token_hash) do update
    set last_seen_news_id = excluded.last_seen_news_id,
        updated_at = excluded.updated_at
    where s.last_seen_news_id < excluded.last_seen_news_id;
$function$
;

CREATE OR REPLACE FUNCTION public.news_recent_action_count(p_account_token_hash text, p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (
    (select count(*)
       from public.news_replies r
      where r.account_token_hash = p_account_token_hash
        and r.created_at >= p_since)
    + (select count(*)
         from public.news_votes v
        where v.account_token_hash = p_account_token_hash
          and v.updated_at >= p_since)
  )::integer;
$function$
;

CREATE OR REPLACE FUNCTION public.news_reply_count_since(p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select count(*)::integer
    from public.news_replies r
   where r.created_at >= p_since;
$function$
;



-- Hand-added: `supabase db diff` does not capture function ACLs (see news.sql).
revoke all on function public.news_list(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.news_mark_seen(text, bigint)
  from public, anon, authenticated;
revoke all on function public.news_recent_action_count(text, timestamp with time zone)
  from public, anon, authenticated;
revoke all on function public.news_reply_count_since(timestamp with time zone)
  from public, anon, authenticated;
