CREATE OR REPLACE FUNCTION public.news_recent_action_count(p_account_token_hash text, p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select count(*)::integer
    from public.news_votes v
   where v.account_token_hash = p_account_token_hash
     and v.updated_at >= p_since;
$function$
;

ALTER TABLE "public"."news_replies" DROP CONSTRAINT "news_replies_news_id_fkey";

DROP FUNCTION "public"."news_reply_count_since"(p_since timestamp with time zone);

-- DELETES_DATA: Deletes all rows in the table (and the table itself)
DROP TABLE "public"."news_replies";


-- CREATE OR REPLACE keeps the function's existing grants; restating the revoke (idempotent)
-- keeps it service-role only (supabase/schemas/news.sql).
revoke all on function public.news_recent_action_count(text, timestamp with time zone)
  from public, anon, authenticated;
