// The news handler over the real supabase-js client and a recording fetch: proves what the
// gateway would log (Supabase logs the full URL of every PostgREST request the function makes,
// so no account token, token hash or reply text may appear in one), what the function logs
// (a tag and a code, nothing else), and that the external contract old settings pages rely on
// is unchanged.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { createNewsHandler, type NewsBackend } from "./handler.ts";
import { safeCode } from "./log.ts";

const NOW = new Date("2026-07-06T12:00:00Z");
const DAY_AGO = "2026-07-05T12:00:00.000Z";
const SECRET = "compare-secret";
const TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
// HMAC-SHA-256(SECRET, TOKEN): pinned, because every stored row is keyed by it — a changed
// hash would orphan each account's watermark, votes and budget.
const HASH = "ae0b0084ba00d7f665d63c0f9349384fcef73b5f07003eb375f3c23a14e4550f";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type Recorded = { method: string; url: string; body: string };
type Answer = [number, unknown];

/**
 * A PostgREST stand-in: records each request and answers it from `answer`.
 * @param answer (method, path, body) -> [status, JSON body, or a raw string sent as is].
 */
function recordingFetch(answer: (method: string, path: string, body: string) => Answer) {
  const requests: Recorded[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = req.body ? await req.text() : "";
    requests.push({ method: req.method, url: req.url, body });
    const [status, reply] = answer(req.method, new URL(req.url).pathname, body);
    const text = reply === undefined ? null : typeof reply === "string" ? reply : JSON.stringify(reply);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchFn, requests };
}

function backendOver(fetchFn: typeof fetch): NewsBackend {
  const client = createClient("http://pg.test", "service-key", {
    global: { fetch: fetchFn },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, hashSecret: SECRET };
}

/** Everything console.error printed while `fn` ran. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const saved = console.error;
  console.error = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = saved;
  }
}

/**
 * Drive one POST through a handler over `answer` and check the privacy invariants on every
 * PostgREST request it made.
 */
async function call(payload: unknown, answer: (method: string, path: string, body: string) => Answer) {
  const pg = recordingFetch(answer);
  const handler = createNewsHandler({ backend: backendOver(pg.fetchFn), now: () => NOW });
  const { result: res, lines } = await captureLogs(() =>
    handler(new Request("https://edge.local/news", { method: "POST", body: JSON.stringify(payload) }))
  );
  const text = await res.text();
  for (const r of pg.requests) {
    const url = decodeURIComponent(r.url);
    for (const secret of [TOKEN, HASH, "a private reply"]) {
      assert(!url.includes(secret), r.method + " " + r.url + " carries personal data");
    }
    assert(r.method !== "HEAD", "no HEAD requests (the old head:true counts)");
    if (new URL(r.url).pathname.startsWith("/rest/v1/rpc/")) {
      assertEquals(r.method, "POST", r.url + ": an RPC is a plain POST");
      assertEquals(new URL(r.url).search, "", r.url + ": RPC arguments ride the body");
    }
  }
  for (const line of lines) {
    for (const secret of [TOKEN, HASH, "a private reply", "Key ("]) {
      assert(!line.includes(secret), "log line carries request data: " + line);
    }
  }
  const route = pg.requests.map((r) => r.method + " " + new URL(r.url).pathname);
  const bodies = pg.requests.map((r) => (r.body ? JSON.parse(r.body) : null));
  return { res, text, route, bodies, requests: pg.requests, lines };
}

function unexpected(method: string, path: string): Answer {
  return [404, { code: "PGRST202", message: "unexpected " + method + " " + path, details: null, hint: null }];
}

function assertCors(res: Response) {
  for (const [k, v] of Object.entries(CORS)) assertEquals(res.headers.get(k), v, k);
}

// ── list ────────────────────────────────────────────────────────────────────

// Captured on the local stack (supabase start) with the same rows and account state:
// RPC_ANSWER is what POST /rest/v1/rpc/news_list returned, OLD_LIST_RESPONSE what the
// function answered before the RPC, from its three table reads (items, news_seen, news_votes).
const RPC_ANSWER = String.raw`{"items": [{"id": 5, "title": "Second poll", "body_md": "x", "choices": ["A", "B"], "my_choice": 0, "created_at": "2026-07-20T08:00:00+00:00"}, {"id": 4, "title": "Poll \"quotes\" & <tags>", "body_md": "Vote ✓ ünïcödé", "choices": ["Yes", "No", "Maybe"], "my_choice": 2, "created_at": "2026-07-19T08:00:00+00:00"}, {"id": 2, "title": "Targeted", "body_md": "line1\n- a\n- b", "choices": null, "my_choice": null, "created_at": "2026-07-17T23:59:59+00:00"}, {"id": 1, "title": "First", "body_md": "Hello **world**", "choices": null, "my_choice": null, "created_at": "2026-07-16T12:34:56.123456+00:00"}], "last_seen_id": 5}`;
const OLD_LIST_RESPONSE = String.raw`{"items":[{"id":5,"created_at":"2026-07-20T08:00:00+00:00","title":"Second poll","body_md":"x","choices":["A","B"],"myChoice":0},{"id":4,"created_at":"2026-07-19T08:00:00+00:00","title":"Poll \"quotes\" & <tags>","body_md":"Vote ✓ ünïcödé","choices":["Yes","No","Maybe"],"myChoice":2},{"id":2,"created_at":"2026-07-17T23:59:59+00:00","title":"Targeted","body_md":"line1\n- a\n- b","choices":null,"myChoice":null},{"id":1,"created_at":"2026-07-16T12:34:56.123456+00:00","title":"First","body_md":"Hello **world**","choices":null,"myChoice":null}],"lastSeenId":5}`;

Deno.test("list: one RPC with its arguments in the body, answered byte-for-byte as before", async () => {
  const { res, text, route, bodies } = await call(
    { op: "list", version: "1.8.0", accountToken: " " + TOKEN + " " },
    (method, path) => (path === "/rest/v1/rpc/news_list" ? [200, RPC_ANSWER] : unexpected(method, path)),
  );
  assertEquals(route, ["POST /rest/v1/rpc/news_list"]);
  assertEquals(bodies[0], { p_version: "1.8.0", p_account_token_hash: HASH, p_limit: 50 });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertCors(res);
  assertEquals(text, OLD_LIST_RESPONSE);
});

Deno.test("list: no or a nonconforming token asks with a null hash and answers lastSeenId null", async () => {
  for (const accountToken of [undefined, "", "   ", "!!!", "short"]) {
    const { res, text, bodies } = await call(
      { op: "list", version: "1.8.0", accountToken },
      (method, path) =>
        path === "/rest/v1/rpc/news_list"
          ? [200, { items: [], last_seen_id: null }]
          : unexpected(method, path),
    );
    assertEquals(bodies, [{ p_version: "1.8.0", p_account_token_hash: null, p_limit: 50 }], String(accountToken));
    assertEquals(res.status, 200);
    assertEquals(text, '{"items":[],"lastSeenId":null}');
  }
});

Deno.test("list: a token with no watermark yet stays 0 (everything unread), not null", async () => {
  const { text } = await call(
    { op: "list", version: "1.8.0", accountToken: TOKEN },
    (method, path) =>
      path === "/rest/v1/rpc/news_list"
        ? [200, { items: [{ id: 7, created_at: "2026-07-20T08:00:00+00:00", title: "t", body_md: "b", choices: null, my_choice: null }], last_seen_id: 0 }]
        : unexpected(method, path),
  );
  assertEquals(
    text,
    '{"items":[{"id":7,"created_at":"2026-07-20T08:00:00+00:00","title":"t","body_md":"b","choices":null,"myChoice":null}],"lastSeenId":0}',
  );
});

Deno.test("list: a failed RPC is 500 list_failed, logged by its code alone", async () => {
  const { res, text, lines } = await call(
    { op: "list", version: "1.8.0", accountToken: TOKEN },
    () => [400, { code: "42883", message: "function news_list(" + HASH + ") does not exist", details: HASH, hint: TOKEN }],
  );
  assertEquals(res.status, 500);
  assertCors(res);
  assertEquals(text, '{"error":"list_failed"}');
  assertEquals(lines, ["news list_failed 42883"]);
});

// ── seen ────────────────────────────────────────────────────────────────────

Deno.test("seen: one upsert RPC, the hash in its body", async () => {
  const { res, text, route, bodies, lines } = await call(
    { op: "seen", accountToken: TOKEN, maxSeenId: 4 },
    (method, path) => (path === "/rest/v1/rpc/news_mark_seen" ? [204, undefined] : unexpected(method, path)),
  );
  assertEquals(route, ["POST /rest/v1/rpc/news_mark_seen"]);
  assertEquals(bodies[0], { p_account_token_hash: HASH, p_max_seen_id: 4 });
  assertEquals(res.status, 200);
  assertCors(res);
  assertEquals(text, '{"ok":true}');
  assertEquals(lines, []);
});

Deno.test("seen: a failed RPC is 500 seen_failed, logged by its code alone", async () => {
  const { res, text, lines } = await call(
    { op: "seen", accountToken: TOKEN, maxSeenId: 4 },
    () => [409, { code: "23505", message: "duplicate key", details: "Key (account_token_hash)=(" + HASH + ") already exists", hint: null }],
  );
  assertEquals(res.status, 500);
  assertEquals(text, '{"error":"seen_failed"}');
  assertEquals(lines, ["news seen_failed 23505"]);
});

// ── vote ────────────────────────────────────────────────────────────────────

/** PostgREST answers for a vote that goes through; `actions` is the caller's budget used. */
function voteAnswers(actions: unknown) {
  return (method: string, path: string): Answer => {
    if (path === "/rest/v1/news" && method === "GET") return [200, [{ choices: ["Yes", "No", "Maybe"] }]];
    if (path === "/rest/v1/rpc/news_recent_action_count") return [200, actions];
    if (path === "/rest/v1/news_votes" && method === "POST") return [201, undefined];
    return unexpected(method, path);
  };
}

Deno.test("vote: the item by id, the budget by RPC, the vote upserted with the hash in its row", async () => {
  const { res, text, route, bodies, requests, lines } = await call(
    { op: "vote", accountToken: TOKEN, newsId: 4, choiceIndex: 1 },
    voteAnswers(3),
  );
  assertEquals(route, [
    "GET /rest/v1/news",
    "POST /rest/v1/rpc/news_recent_action_count",
    "POST /rest/v1/news_votes",
  ]);
  const lookup = new URL(requests[0].url).searchParams;
  assertEquals([lookup.get("select"), lookup.get("id")], ["choices", "eq.4"], "only the news id is a filter");
  assertEquals(bodies[1], { p_account_token_hash: HASH, p_since: DAY_AGO });
  assertEquals(new URL(requests[2].url).searchParams.get("on_conflict"), "news_id,account_token_hash");
  assertEquals(bodies[2], {
    news_id: 4,
    account_token_hash: HASH,
    choice_index: 1,
    choice_text: "No",
    updated_at: NOW.toISOString(),
  });
  assertEquals(res.status, 200);
  assertCors(res);
  assertEquals(text, '{"ok":true}');
  assertEquals(lines, []);
});

Deno.test("vote: a spent budget is 429 {error, remaining: 0} and stores nothing", async () => {
  const { res, text, route } = await call(
    { op: "vote", accountToken: TOKEN, newsId: 4, choiceIndex: 0 },
    voteAnswers(10),
  );
  assertEquals(res.status, 429);
  assertEquals(text, '{"error":"rate_limit_exceeded","remaining":0}');
  assert(!route.includes("POST /rest/v1/news_votes"));
});

Deno.test("vote: an index past the poll, or no poll at all, is 400 unknown_choice before any count", async () => {
  for (const [row, choiceIndex] of [[[{ choices: ["A", "B"] }], 2], [[{ choices: null }], 0], [[], 0]] as const) {
    const { res, text, route } = await call(
      { op: "vote", accountToken: TOKEN, newsId: 4, choiceIndex },
      (method, path) => (path === "/rest/v1/news" ? [200, row] : unexpected(method, path)),
    );
    assertEquals(res.status, 400);
    assertEquals(text, '{"error":"unknown_choice"}');
    assertEquals(route, ["GET /rest/v1/news"]);
  }
});

Deno.test("vote: failures answer as before and log a tag and a code only", async () => {
  const lookupFails = await call(
    { op: "vote", accountToken: TOKEN, newsId: 4, choiceIndex: 0 },
    () => [500, { code: "XX000", message: "boom " + TOKEN, details: null, hint: null }],
  );
  assertEquals([lookupFails.res.status, lookupFails.text], [500, '{"error":"news_lookup_failed"}']);
  assertEquals(lookupFails.lines, ["news news_lookup_failed XX000"]);

  const countFails = await call(
    { op: "vote", accountToken: TOKEN, newsId: 4, choiceIndex: 0 },
    (method, path) =>
      path === "/rest/v1/rpc/news_recent_action_count"
        ? [503, { code: "PGRST003", message: "timed out for " + HASH, details: null, hint: null }]
        : voteAnswers(0)(method, path),
  );
  assertEquals([countFails.res.status, countFails.text], [500, '{"error":"rate_check_failed"}']);
  assertEquals(countFails.lines, ["news rate_check_failed PGRST003"]);

  const upsertFails = await call(
    { op: "vote", accountToken: TOKEN, newsId: 4, choiceIndex: 0 },
    (method, path) =>
      path === "/rest/v1/news_votes"
        ? [409, { code: "23503", message: "fk", details: "Key (news_id)=(4) is not present", hint: null }]
        : voteAnswers(0)(method, path),
  );
  assertEquals([upsertFails.res.status, upsertFails.text], [500, '{"error":"vote_failed"}']);
  assertEquals(upsertFails.lines, ["news vote_failed 23503"]);
});

// ── reply ───────────────────────────────────────────────────────────────────

/** PostgREST answers for a reply; `total` is all accounts' replies, `mine` the caller's budget. */
function replyAnswers(total: unknown, mine: unknown, insert: Answer = [201, undefined]) {
  return (method: string, path: string): Answer => {
    if (path === "/rest/v1/rpc/news_reply_count_since") return [200, total];
    if (path === "/rest/v1/rpc/news_recent_action_count") return [200, mine];
    if (path === "/rest/v1/news_replies" && method === "POST") return insert;
    return unexpected(method, path);
  };
}

const REPLY = { op: "reply", accountToken: TOKEN, version: "1.8.0", newsId: 5, message: "  a private reply  " };

Deno.test("reply: both counts by RPC, the reply inserted with the hash in its row, 202", async () => {
  const { res, text, route, bodies, lines } = await call(REPLY, replyAnswers(12, 3));
  assertEquals(route, [
    "POST /rest/v1/rpc/news_reply_count_since",
    "POST /rest/v1/rpc/news_recent_action_count",
    "POST /rest/v1/news_replies",
  ]);
  assertEquals(bodies[0], { p_since: DAY_AGO });
  assertEquals(bodies[1], { p_account_token_hash: HASH, p_since: DAY_AGO });
  assertEquals(bodies[2], { news_id: 5, account_token_hash: HASH, app_version: "1.8.0", message: "a private reply" });
  assertEquals(res.status, 202);
  assertCors(res);
  assertEquals(text, '{"ok":true}');
  assertEquals(lines, []);
});

Deno.test("reply: a U+0000 never reaches the database (Postgres refuses it and logs the JSON around it)", async () => {
  // Postgres rejects \u0000 in text (22P05) with a CONTEXT line quoting ~50 characters of the
  // request JSON before it: the reply's free text, or the account-token hash.
  const nul = await call({ ...REPLY, message: "\u0000 a private\u0000 reply \u0000" }, replyAnswers(0, 0));
  assertEquals(nul.res.status, 202);
  assertEquals(nul.bodies[2].message, "a private reply");
  for (const r of nul.requests) assert(!r.body.includes("\\u0000"), r.method + " " + r.url + " sends a NUL");

  const onlyNul = await call({ ...REPLY, message: " \u0000\u0000 " }, replyAnswers(0, 0));
  assertEquals(onlyNul.res.status, 400);
  assertEquals(JSON.parse(onlyNul.text).error, "invalid_payload");
  assertEquals(onlyNul.route, []);
});

Deno.test("reply: the global cap is 429 before the caller's own count, and logged as a tag", async () => {
  const { res, text, route, lines } = await call(REPLY, replyAnswers(500, 0));
  assertEquals(res.status, 429);
  assertEquals(text, '{"error":"rate_limit_exceeded","remaining":0}');
  assertEquals(route, ["POST /rest/v1/rpc/news_reply_count_since"]);
  assertEquals(lines, ["news reply_cap_reached"]);
});

Deno.test("reply: a spent budget is 429 and stores nothing", async () => {
  const { res, text, route, lines } = await call(REPLY, replyAnswers(12, 10));
  assertEquals(res.status, 429);
  assertEquals(text, '{"error":"rate_limit_exceeded","remaining":0}');
  assert(!route.includes("POST /rest/v1/news_replies"));
  assertEquals(lines, []);
});

Deno.test("reply: to a deleted item is 400 unknown_news, logged not at all", async () => {
  const { res, text, lines } = await call(
    REPLY,
    replyAnswers(0, 0, [409, { code: "23503", message: "fk", details: "Key (news_id)=(5) is not present", hint: null }]),
  );
  assertEquals(res.status, 400);
  assertEquals(text, '{"error":"unknown_news"}');
  assertEquals(lines, []);
});

Deno.test("reply: failures answer as before and log a tag and a code only", async () => {
  const totalFails = await call(REPLY, (method, path) =>
    path === "/rest/v1/rpc/news_reply_count_since"
      ? [500, { code: "57014", message: "canceled", details: null, hint: null }]
      : replyAnswers(0, 0)(method, path));
  assertEquals([totalFails.res.status, totalFails.text], [500, '{"error":"rate_check_failed"}']);
  assertEquals(totalFails.lines, ["news rate_check_failed 57014"]);

  const notANumber = await call(REPLY, replyAnswers(0, "many"));
  assertEquals([notANumber.res.status, notANumber.text], [500, '{"error":"rate_check_failed"}']);
  assertEquals(notANumber.lines, ["news rate_check_failed"]);

  const insertFails = await call(
    REPLY,
    replyAnswers(0, 0, [400, { code: "23514", message: "check", details: "Failing row contains (a private reply)", hint: null }]),
  );
  assertEquals([insertFails.res.status, insertFails.text], [500, '{"error":"insert_failed"}']);
  assertEquals(insertFails.lines, ["news insert_failed 23514"]);
});

// ── transport, configuration and the last line of defence ──────────────────

Deno.test("transport answers are unchanged: OPTIONS, GET, oversized, not JSON, invalid", async () => {
  const handler = createNewsHandler({ backend: null, now: () => NOW });
  const options = await handler(new Request("https://edge.local/news", { method: "OPTIONS" }));
  assertEquals(options.status, 204);
  assertCors(options);
  const cases: Array<[RequestInit, number, string]> = [
    [{ method: "GET" }, 405, '{"error":"method_not_allowed"}'],
    [{ method: "POST", body: "x".repeat(4097) }, 413, '{"error":"payload_too_large"}'],
    [{ method: "POST", body: "{nope" }, 400, '{"error":"invalid_json"}'],
    [
      { method: "POST", body: JSON.stringify({ op: "list", version: "1.8.0,x" }) },
      400,
      '{"error":"invalid_payload","detail":"Invalid string: must match pattern /^[0-9A-Za-z.+-]+$/"}',
    ],
  ];
  for (const [init, status, body] of cases) {
    const res = await handler(new Request("https://edge.local/news", init));
    assertEquals([res.status, await res.text()], [status, body], String(init.method));
    assertCors(res);
  }
});

Deno.test("a deploy without its secrets answers valid requests 500 internal_error, logged as a tag", async () => {
  const handler = createNewsHandler({ backend: null, now: () => NOW });
  const { result: res, lines } = await captureLogs(() =>
    handler(new Request("https://edge.local/news", {
      method: "POST",
      body: JSON.stringify({ op: "list", version: "1.8.0", accountToken: TOKEN }),
    }))
  );
  assertEquals([res.status, await res.text()], [500, '{"error":"internal_error"}']);
  assertCors(res);
  assertEquals(lines, ["news not_configured"]);
});

Deno.test("anything thrown is 500 internal_error with CORS, logged as 'unhandled' with no detail", async () => {
  const pg = recordingFetch(voteAnswers(0));
  const handler = createNewsHandler({
    backend: backendOver(pg.fetchFn),
    now: () => {
      throw new Error("clock failed for " + TOKEN);
    },
  });
  const { result: res, lines } = await captureLogs(() =>
    handler(new Request("https://edge.local/news", {
      method: "POST",
      body: JSON.stringify({ op: "vote", accountToken: TOKEN, newsId: 4, choiceIndex: 0 }),
    }))
  );
  assertEquals([res.status, await res.text()], [500, '{"error":"internal_error"}']);
  assertCors(res);
  assertEquals(lines, ["news unhandled"]);
});

Deno.test("safeCode keeps machine codes and drops everything else", () => {
  assertEquals(safeCode("23505"), "23505");
  assertEquals(safeCode("PGRST202"), "PGRST202");
  assertEquals(safeCode(429), "429");
  assertEquals(safeCode("duplicate key value violates unique constraint"), "");
  assertEquals(safeCode(HASH), "");
  assertEquals(safeCode(""), "");
  assertEquals(safeCode(1.5), "");
  assertEquals(safeCode({ code: "23505" }), "");
  assertEquals(safeCode(undefined), "");
});
