-- pgtap tests for the news edge function's RPCs (supabase/schemas/news.sql): news_list,
-- news_mark_seen, news_recent_action_count, news_reply_count_since, and their API surface.
-- Run: docker exec -i supabase_db_warnweather psql -U postgres -d postgres -X -q \
--        < supabase/tests/news_rpc_test.sql   (grep 'not ok')
-- or:  supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
set timezone = 'UTC';
select plan(42);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Hashes are opaque text to the database; 'hash-a' etc. stand in for the hex HMACs.
truncate news restart identity cascade;
truncate news_seen;
insert into news (id, created_at, target_version, title, body_md, choices) values
  (1, '2026-07-16 12:34:56.123456+00', null,    'First',     'b1', null),
  (2, '2026-07-17 23:59:59+00',        '1.8.0', 'Targeted',  'b2', null),
  (3, '2026-07-18 00:00:00+00',        '9.9.9', 'Elsewhere', 'b3', null),
  (4, '2026-07-19 08:00:00+00',        null,    'Poll',      'b4', '["Yes","No","Maybe"]'),
  (5, '2026-07-20 08:00:00+00',        null,    'Poll 2',    'b5', '["A","B"]');
insert into news_votes (news_id, account_token_hash, choice_index, choice_text, updated_at) values
  (4, 'hash-a', 2, 'Maybe', now() - interval '1 hour'),
  (5, 'hash-a', 0, 'A',     now() - interval '2 days'),
  (5, 'hash-b', 1, 'B',     now() - interval '1 hour');
insert into news_seen (account_token_hash, last_seen_news_id) values ('hash-a', 4);

-- ── news_list ───────────────────────────────────────────────────────────────
select is(
  (select array_agg((e ->> 'id')::int order by ord)
     from jsonb_array_elements(news_list('1.8.0', null, 50) -> 'items') with ordinality as t(e, ord)),
  array[5, 4, 2, 1],
  'general rows and rows targeted at exactly the caller''s version, newest first');
select is(
  (select array_agg((e ->> 'id')::int order by ord)
     from jsonb_array_elements(news_list('9.9.9', null, 50) -> 'items') with ordinality as t(e, ord)),
  array[5, 4, 3, 1],
  'another version sees its own targeted row instead');
select is(
  (select array_agg((e ->> 'id')::int order by ord)
     from jsonb_array_elements(news_list('1.8.0', null, 2) -> 'items') with ordinality as t(e, ord)),
  array[5, 4],
  'p_limit keeps the newest rows');
select is(news_list('1.8.0', null, 0) -> 'items', '[]'::jsonb, 'no rows → an empty items array, not null');
select is(
  news_list('1.8.0', null, 50) -> 'last_seen_id',
  'null'::jsonb,
  'no hash → last_seen_id null (unread unknowable)');
select ok(news_list('1.8.0', null, 50) ? 'last_seen_id', 'last_seen_id is present even when null');
select is(
  news_list('1.8.0', 'hash-new', 50) -> 'last_seen_id',
  '0'::jsonb,
  'a hash with no watermark → 0 (everything unread)');
select is(
  news_list('1.8.0', 'hash-a', 50) -> 'last_seen_id',
  '4'::jsonb,
  'a known hash → its watermark, as a JSON number');
select is(
  (select jsonb_object_agg(e ->> 'id', e -> 'my_choice')
     from jsonb_array_elements(news_list('1.8.0', 'hash-a', 50) -> 'items') as t(e)),
  '{"5": 0, "4": 2, "2": null, "1": null}'::jsonb,
  'my_choice is the caller''s own vote per item, null where there is none');
select is(
  (select jsonb_object_agg(e ->> 'id', e -> 'my_choice')
     from jsonb_array_elements(news_list('1.8.0', null, 50) -> 'items') as t(e)),
  '{"5": null, "4": null, "2": null, "1": null}'::jsonb,
  'no hash → no votes, not anybody''s');
select is(
  (select array_agg(e ->> 'id' order by ord)
     from jsonb_array_elements(news_list('1.8.0', 'hash-a', 1) -> 'items') with ordinality as t(e, ord)),
  array['5'],
  'votes never add rows beyond the limit');
select is(
  (select e from jsonb_array_elements(news_list('1.8.0', null, 50) -> 'items') as t(e) where e ->> 'id' = '4'),
  jsonb_build_object(
    'id', 4,
    'created_at', '2026-07-19 08:00:00+00'::timestamptz,
    'title', 'Poll',
    'body_md', 'b4',
    'choices', '["Yes","No","Maybe"]'::jsonb,
    'my_choice', null),
  'an item carries exactly id, created_at, title, body_md, choices, my_choice');
select is(
  (select e -> 'choices' from jsonb_array_elements(news_list('1.8.0', null, 50) -> 'items') as t(e) where e ->> 'id' = '1'),
  'null'::jsonb,
  'no poll → choices is JSON null');
select is(
  (select e ->> 'created_at' from jsonb_array_elements(news_list('1.8.0', null, 50) -> 'items') as t(e) where e ->> 'id' = '1'),
  '2026-07-16T12:34:56.123456+00:00',
  'created_at is ISO 8601 with a ''T'' and its microseconds, as a table read gave it');
select is(
  jsonb_typeof((news_list('1.8.0', null, 50) -> 'items') -> 0 -> 'id'),
  'number',
  'ids are JSON numbers');

-- ── news_mark_seen ──────────────────────────────────────────────────────────
select news_mark_seen('hash-s', 3);
select is((select last_seen_news_id from news_seen where account_token_hash = 'hash-s'), 3::bigint,
  'a first seen inserts the watermark');
update news_seen set updated_at = '2026-01-01 00:00:00+00' where account_token_hash = 'hash-s';
select news_mark_seen('hash-s', 5);
select is((select last_seen_news_id from news_seen where account_token_hash = 'hash-s'), 5::bigint,
  'a higher id raises it');
select ok((select updated_at > '2026-01-01 00:00:00+00' from news_seen where account_token_hash = 'hash-s'),
  'raising it stamps updated_at');
update news_seen set updated_at = '2026-01-01 00:00:00+00' where account_token_hash = 'hash-s';
select lives_ok($$ select news_mark_seen('hash-s', 2) $$, 'a lower id on an existing row is no unique violation');
select is((select last_seen_news_id from news_seen where account_token_hash = 'hash-s'), 5::bigint,
  'a lower id never lowers it');
select is((select updated_at from news_seen where account_token_hash = 'hash-s'), '2026-01-01 00:00:00+00'::timestamptz,
  'a no-op seen leaves updated_at alone');
select news_mark_seen('hash-s', 5);
select is((select count(*)::int from news_seen where account_token_hash = 'hash-s'), 1, 'one row per hash');

-- ── news_recent_action_count / news_reply_count_since ───────────────────────
insert into news_replies (news_id, account_token_hash, app_version, message, created_at) values
  (5, 'hash-a', '1.8.0', 'recent', now() - interval '2 hours'),
  (5, 'hash-a', '1.8.0', 'old',    now() - interval '3 days'),
  (5, 'hash-b', '1.8.0', 'other',  now() - interval '1 hour');
select is(news_recent_action_count('hash-a', now() - interval '1 day'), 2,
  'replies by created_at + votes by updated_at, inside the window, own hash only');
select is(news_recent_action_count('hash-a', now() - interval '4 days'), 4,
  'a wider window counts the older reply and vote too');
select is(news_recent_action_count('hash-new', now() - interval '1 day'), 0, 'an unknown hash counts 0');
select is(news_reply_count_since(now() - interval '1 day'), 2, 'the global count covers every hash');
select is(news_reply_count_since(now() - interval '4 days'), 3, 'and honours its window');

-- ── API surface: only the service role may call them ────────────────────────
select ok(not has_function_privilege('anon', 'public.news_list(text, text, integer)', 'execute'),
  'anon cannot execute news_list');
select ok(not has_function_privilege('authenticated', 'public.news_list(text, text, integer)', 'execute'),
  'authenticated cannot execute news_list');
select ok(has_function_privilege('service_role', 'public.news_list(text, text, integer)', 'execute'),
  'service_role can execute news_list');
select ok(not has_function_privilege('anon', 'public.news_mark_seen(text, bigint)', 'execute'),
  'anon cannot execute news_mark_seen');
select ok(not has_function_privilege('authenticated', 'public.news_mark_seen(text, bigint)', 'execute'),
  'authenticated cannot execute news_mark_seen');
select ok(has_function_privilege('service_role', 'public.news_mark_seen(text, bigint)', 'execute'),
  'service_role can execute news_mark_seen');
select ok(not has_function_privilege('anon', 'public.news_recent_action_count(text, timestamptz)', 'execute'),
  'anon cannot execute news_recent_action_count');
select ok(not has_function_privilege('authenticated', 'public.news_recent_action_count(text, timestamptz)', 'execute'),
  'authenticated cannot execute news_recent_action_count');
select ok(has_function_privilege('service_role', 'public.news_recent_action_count(text, timestamptz)', 'execute'),
  'service_role can execute news_recent_action_count');
select ok(not has_function_privilege('anon', 'public.news_reply_count_since(timestamptz)', 'execute'),
  'anon cannot execute news_reply_count_since');
select ok(not has_function_privilege('authenticated', 'public.news_reply_count_since(timestamptz)', 'execute'),
  'authenticated cannot execute news_reply_count_since');
select ok(has_function_privilege('service_role', 'public.news_reply_count_since(timestamptz)', 'execute'),
  'service_role can execute news_reply_count_since');
-- The REVOKEs are hand-appended to the migration (db diff misses ACLs), so pin the whole grant
-- list: besides the owner, service_role alone (no PUBLIC, and no other role either).
select is(
  (select array_agg(distinct p.proname::text || ':' || coalesce(r.rolname, 'PUBLIC')
                    order by p.proname::text || ':' || coalesce(r.rolname, 'PUBLIC'))
     from pg_proc p
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     left join pg_roles r on r.oid = a.grantee
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('news_list', 'news_mark_seen', 'news_recent_action_count', 'news_reply_count_since')
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> p.proowner),
  array['news_list:service_role', 'news_mark_seen:service_role',
        'news_recent_action_count:service_role', 'news_reply_count_since:service_role'],
  'EXECUTE on the four: their owner and service_role only');

-- ── Definitions: invoker rights, pinned search_path, honest volatility ──────
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('news_list', 'news_mark_seen', 'news_recent_action_count', 'news_reply_count_since')
      and not p.prosecdef
      and p.proconfig @> array['search_path=""']),
  array['news_list', 'news_mark_seen', 'news_recent_action_count', 'news_reply_count_since'],
  'all four are SECURITY INVOKER with an empty search_path');
select is(
  (select string_agg(p.proname || '=' || p.provolatile::text, ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('news_list', 'news_mark_seen', 'news_recent_action_count', 'news_reply_count_since')),
  'news_list=s,news_mark_seen=v,news_recent_action_count=s,news_reply_count_since=s',
  'the writer is VOLATILE, the readers STABLE');

select * from finish();
rollback;
