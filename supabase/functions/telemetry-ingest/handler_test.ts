// The telemetry-ingest handler over the real supabase-js client and a recording fetch: proves
// what the gateway would log (Supabase logs the full URL of every PostgREST request the
// function makes, so no account or watch token, neither hash, and no event data may appear in
// one), what the function logs (a tag and a code, nothing else), and that the answers every
// app version in the field relies on are unchanged.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { createIngestHandler, type IngestBackend } from "./handler.ts";
import { safeCode } from "./log.ts";

const NOW = new Date("2026-07-06T12:00:00Z");
const HOUR_AGO = "2026-07-06T11:00:00.000Z";
const SECRET = "compare-secret";
const TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WATCH = "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww";
// HMAC-SHA-256(SECRET, TOKEN): pinned, because every row is keyed by it (DAU, the rollup, the
// rate limit) — a changed hash would split each account in two. It equals the news suite's
// pin: both functions key their tables by the same pseudonym.
const HASH = "ae0b0084ba00d7f665d63c0f9349384fcef73b5f07003eb375f3c23a14e4550f";
const WATCH_HASH = "72231f0e30d87ca9db3cf5cd30f80a670548f00341ea32c6efdec29210082bdb";
// A failed fetch's error string: event data, which belongs in the row body only.
const ERROR_TEXT = "HTTP 401 from provider-sentinel";
const PERSONAL = [TOKEN, WATCH, HASH, WATCH_HASH, ERROR_TEXT];
const RPC_PATH = "/rest/v1/rpc/telemetry_recent_insert_count";
const TABLE_PATH = "/rest/v1/telemetry_weather_fetch";

type Recorded = { method: string; url: string; body: string };
type Answer = [number, unknown];
type Answerer = (method: string, path: string, body: string) => Answer;

/**
 * A PostgREST stand-in: records each request and answers it from `answer`.
 * @param answer (method, path, body) -> [status, JSON body, or a raw string sent as is].
 */
function recordingFetch(answer: Answerer) {
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

function backendOver(fetchFn: typeof fetch): IngestBackend {
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
 * Drive one request through a handler over `answer` and check the privacy invariants on every
 * PostgREST request it made and every line it logged.
 * @param init The request (a POST of `init.body`, unless init says otherwise).
 * @param answer The PostgREST stand-in's answers.
 */
async function send(init: RequestInit, answer: Answerer) {
  const pg = recordingFetch(answer);
  const handler = createIngestHandler({ backend: backendOver(pg.fetchFn), now: () => NOW });
  const { result: res, lines } = await captureLogs(() =>
    handler(new Request("https://edge.local/telemetry-ingest", { method: "POST", ...init }))
  );
  const text = await res.text();
  for (const r of pg.requests) {
    const url = decodeURIComponent(r.url);
    for (const secret of PERSONAL) {
      assert(!url.includes(secret), r.method + " " + r.url + " carries personal data");
    }
    assert(r.method !== "HEAD", "no HEAD requests (the old head:true count)");
    const { pathname, search } = new URL(r.url);
    if (pathname.startsWith("/rest/v1/rpc/")) {
      assertEquals(r.method, "POST", r.url + ": an RPC is a plain POST");
      assertEquals(search, "", r.url + ": RPC arguments ride the body");
    }
  }
  for (const line of lines) {
    for (const secret of [...PERSONAL, "Failing row", "Key ("]) {
      assert(!line.includes(secret), "log line carries request data: " + line);
    }
  }
  const route = pg.requests.map((r) => r.method + " " + new URL(r.url).pathname);
  const bodies = pg.requests.map((r) => (r.body ? JSON.parse(r.body) : null));
  return { res, text, route, bodies, requests: pg.requests, lines };
}

/** POST `payload` as JSON through a handler over `answer`. */
function post(payload: unknown, answer: Answerer) {
  return send({ body: JSON.stringify(payload) }, answer);
}

function unexpected(method: string, path: string): Answer {
  return [404, { code: "PGRST202", message: "unexpected " + method + " " + path, details: null, hint: null }];
}

/**
 * PostgREST answers for a request that gets through.
 * @param count What the rate-check RPC answers (the caller's arrivals this hour).
 * @param insert What the insert answers.
 */
function answers(count: unknown, insert: Answer = [201, undefined]): Answerer {
  return (method, path) => {
    if (path === RPC_PATH && method === "POST") return [200, count];
    if (path === TABLE_PATH && method === "POST") return insert;
    return unexpected(method, path);
  };
}

const WATCH_INFO = {
  platform: "basalt",
  model: "pebble_time_black",
  language: "en_US",
  firmware: { major: 4, minor: 4, patch: 2, suffix: "" },
};

const FAILED_EVENT = {
  t: NOW.getTime() - 5 * 60 * 1000,
  provider: "dwd",
  success: false,
  error: ERROR_TEXT,
  countryCode: "DEU",
  usedGpsCache: true,
  gpsErrorCode: 3,
  locationMode: "gps",
  durationMs: 1200,
  attempt: 2,
};

const OK_EVENT = { t: NOW.getTime() - 60 * 1000, provider: "dwd", success: true, error: null, countryCode: "DEU" };

const BATCH = {
  eventType: "weather_fetch_batch",
  accountToken: " " + TOKEN + " ",
  watchToken: WATCH,
  appVersion: "1.23.0",
  buildProfile: "release",
  watchInfo: WATCH_INFO,
  settings: { provider: "dwd", radarProvider: "rainbowkey", notASetting: "stripped" },
  events: [FAILED_EVENT, OK_EVENT],
};

const LEGACY = {
  eventType: "weather_fetch",
  accountToken: TOKEN,
  provider: "openmeteo",
  success: true,
  error: null,
  countryCode: "AUT",
  settings: { provider: "openmeteo" },
  appVersion: "1.15.0",
  buildProfile: "release",
  watchInfo: WATCH_INFO,
  locationMode: "manual_address",
  durationMs: 800,
};

/** The insert row a batch event becomes (the batch's header duplicated into it). */
function batchRow(receivedAt: string, event: Record<string, unknown>) {
  return {
    account_token_hash: HASH,
    watch_token_hash: WATCH_HASH,
    received_at: receivedAt,
    provider: event.provider,
    success: event.success,
    error: event.error,
    country_code: event.countryCode,
    settings_json: { provider: "dwd", radarProvider: "rainbowkey" },
    app_version: "1.23.0",
    build_profile: "release",
    watch_info: WATCH_INFO,
    used_gps_cache: event.usedGpsCache ?? false,
    gps_error_code: event.gpsErrorCode ?? null,
    location_mode: event.locationMode ?? null,
    duration_ms: event.durationMs ?? null,
    attempt: event.attempt ?? null,
  };
}

// ── the two shapes ──────────────────────────────────────────────────────────

Deno.test("batch: the rate check is one RPC with the hash in its body, the rows carry both hashes in theirs", async () => {
  const { res, text, route, bodies, requests, lines } = await post(BATCH, answers(3));
  assertEquals(route, ["POST " + RPC_PATH, "POST " + TABLE_PATH]);
  assertEquals(bodies[0], { p_account_token_hash: HASH, p_since: HOUR_AGO });
  assertEquals(
    [...new URL(requests[1].url).searchParams.keys()],
    ["columns"],
    "the insert URL names columns, nothing else",
  );
  assertEquals(bodies[1], [
    batchRow(new Date(FAILED_EVENT.t).toISOString(), FAILED_EVENT),
    batchRow(new Date(OK_EVENT.t).toISOString(), OK_EVENT),
  ]);
  assertEquals(res.status, 202);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(text, '{"status":"accepted","events":2}');
  assertEquals(lines, []);
});

Deno.test("legacy single event: one row, stamped with the server's now", async () => {
  const { res, text, route, bodies, lines } = await post(LEGACY, answers(0));
  assertEquals(route, ["POST " + RPC_PATH, "POST " + TABLE_PATH]);
  assertEquals(bodies[0], { p_account_token_hash: HASH, p_since: HOUR_AGO });
  assertEquals(bodies[1], [{
    account_token_hash: HASH,
    watch_token_hash: null,
    received_at: NOW.toISOString(),
    provider: "openmeteo",
    success: true,
    error: null,
    country_code: "AUT",
    settings_json: { provider: "openmeteo" },
    app_version: "1.15.0",
    build_profile: "release",
    watch_info: WATCH_INFO,
    used_gps_cache: false,
    gps_error_code: null,
    location_mode: "manual_address",
    duration_ms: 800,
    attempt: null,
  }]);
  assertEquals(res.status, 202);
  assertEquals(text, '{"status":"accepted","events":1}');
  assertEquals(lines, []);
});

Deno.test("a blank or absent watch token stores a null hash, never HMAC('')", async () => {
  for (const watchToken of ["   ", "", null, undefined]) {
    const { res, bodies } = await post({ ...BATCH, watchToken }, answers(0));
    assertEquals(res.status, 202, String(watchToken));
    for (const row of bodies[1]) assertEquals(row.watch_token_hash, null, String(watchToken));
  }
});

Deno.test("a U+0000 in any string never reaches the database, and never fails the batch", async () => {
  // Postgres rejects \u0000 in text and jsonb (22P05) with a CONTEXT line quoting ~50
  // characters of the request JSON before it. Stripped at the parse, so validation sees the rest.
  const N = "\u0000";
  const { res, bodies, requests } = await post({
    ...BATCH,
    accountToken: TOKEN + N,
    watchToken: WATCH + N,
    appVersion: "1.23.0" + N,
    buildProfile: N + "release",
    watchInfo: { ...WATCH_INFO, model: "pebble" + N, firmware: { ...WATCH_INFO.firmware, suffix: N } },
    settings: { provider: "dwd", radarProvider: "rainbow" + N + "key", theme: N },
    events: [{ ...FAILED_EVENT, error: ERROR_TEXT + N, countryCode: "D" + N + "EU" }, OK_EVENT],
  }, answers(0));
  assertEquals(res.status, 202);
  for (const r of requests) assert(!r.body.includes("\\u0000"), r.method + " " + r.url + " sends a NUL");
  assertEquals(bodies[0].p_account_token_hash, HASH, "the token hashes as the one without the NUL");
  const [failed] = bodies[1];
  assertEquals(failed.watch_token_hash, WATCH_HASH);
  assertEquals([failed.app_version, failed.build_profile, failed.error, failed.country_code], [
    "1.23.0",
    "release",
    ERROR_TEXT,
    "DEU",
  ]);
  assertEquals(failed.settings_json, { provider: "dwd", radarProvider: "rainbowkey", theme: "" });
  assertEquals(failed.watch_info, { ...WATCH_INFO, model: "pebble" });

  const legacy = await post({ ...LEGACY, success: false, error: "timeout" + N, countryCode: N }, answers(0));
  assertEquals(legacy.res.status, 202);
  assertEquals([legacy.bodies[1][0].error, legacy.bodies[1][0].country_code], ["timeout", ""]);

  const onlyNul = await post({ ...LEGACY, success: false, error: N + " " + N }, answers(0));
  assertEquals(onlyNul.res.status, 400, "an error of nothing but NULs is a blank error");
  assertEquals(onlyNul.route, []);
});

Deno.test("batch timestamps are clamped into [now - 72 h, now]", async () => {
  const future = { ...OK_EVENT, t: NOW.getTime() + 60 * 60 * 1000 };
  const ancient = { ...OK_EVENT, t: NOW.getTime() - 100 * 60 * 60 * 1000 };
  const { bodies } = await post({ ...BATCH, events: [future, ancient] }, answers(0));
  assertEquals(
    bodies[1].map((row: { received_at: string }) => row.received_at),
    [NOW.toISOString(), new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString()],
  );
});

// ── the hourly limit ────────────────────────────────────────────────────────

Deno.test("the hourly limit: 59 arrivals still insert, 60 is 429 and inserts nothing", async () => {
  const under = await post(BATCH, answers(59));
  assertEquals([under.res.status, under.text], [202, '{"status":"accepted","events":2}']);

  const at = await post(BATCH, answers(60));
  assertEquals(at.res.status, 429);
  assertEquals(at.res.headers.get("content-type"), "application/json");
  assertEquals(at.text, '{"error":"rate_limit_exceeded"}');
  assertEquals(at.route, ["POST " + RPC_PATH]);
  assertEquals(at.lines, []);
});

Deno.test("a failed rate check is 500 rate_check_failed, logged by its code alone, and inserts nothing", async () => {
  const rpcFails = await post(
    BATCH,
    () => [404, { code: "PGRST202", message: "function telemetry_recent_insert_count(" + HASH + ")", details: TOKEN, hint: null }],
  );
  assertEquals([rpcFails.res.status, rpcFails.text], [500, '{"error":"rate_check_failed"}']);
  assertEquals(rpcFails.route, ["POST " + RPC_PATH]);
  assertEquals(rpcFails.lines, ["telemetry-ingest rate_check_failed PGRST202"]);

  for (const notACount of ["many", null, 1.5]) {
    const odd = await post(BATCH, answers(notACount));
    assertEquals([odd.res.status, odd.text], [500, '{"error":"rate_check_failed"}'], String(notACount));
    assertEquals(odd.route, ["POST " + RPC_PATH]);
    assertEquals(odd.lines, ["telemetry-ingest rate_check_failed"]);
  }
});

Deno.test("an unreachable database is 500 rate_check_failed, and the network error is not logged", async () => {
  const handler = createIngestHandler({
    backend: backendOver((() => Promise.reject(new TypeError("connect failed for " + HASH))) as typeof fetch),
    now: () => NOW,
  });
  const { result: res, lines } = await captureLogs(() =>
    handler(new Request("https://edge.local/telemetry-ingest", { method: "POST", body: JSON.stringify(BATCH) }))
  );
  assertEquals([res.status, await res.text()], [500, '{"error":"rate_check_failed"}']);
  assertEquals(lines, ["telemetry-ingest rate_check_failed"]);
});

Deno.test("a failed insert is 500 insert_failed, logged by its code alone", async () => {
  const { res, text, lines } = await post(
    BATCH,
    answers(0, [400, { code: "23514", message: "check", details: "Failing row contains (" + HASH + ", " + ERROR_TEXT + ")", hint: null }]),
  );
  assertEquals([res.status, text], [500, '{"error":"insert_failed"}']);
  assertEquals(lines, ["telemetry-ingest insert_failed 23514"]);
});

// ── transport, configuration and the last line of defence ──────────────────

Deno.test("transport and validation answers are unchanged, and none of them reaches the database", async () => {
  const pad = "x".repeat(4096);
  const cases: Array<[RequestInit, number, string]> = [
    [{ method: "GET" }, 405, '{"error":"method_not_allowed"}'],
    [{ method: "PUT", body: JSON.stringify(BATCH) }, 405, '{"error":"method_not_allowed"}'],
    [{ body: "x".repeat(65537) }, 413, '{"error":"payload_too_large"}'],
    // The legacy shape keeps its tighter 4096 B cap; a batch of the same size is fine.
    [{ body: JSON.stringify({ ...LEGACY, pad }) }, 413, '{"error":"payload_too_large"}'],
    // A batch's shared header is written into every row: the settings keep a 4096 B bound.
    [
      { body: JSON.stringify({ ...BATCH, settings: { theme: pad } }) },
      413,
      '{"error":"payload_too_large"}',
    ],
    [{ body: "{nope" }, 400, '{"error":"invalid_json"}'],
    [
      { body: JSON.stringify({ ...LEGACY, accountToken: "  " }) },
      400,
      '{"error":"invalid_payload","detail":"invalid_account_token"}',
    ],
    [
      { body: JSON.stringify({ ...BATCH, events: [{ ...OK_EVENT, error: "not null on success" }] }) },
      400,
      '{"error":"invalid_payload","detail":"error_must_be_null_on_success"}',
    ],
    [
      { body: JSON.stringify({ ...LEGACY, success: false, error: null }) },
      400,
      '{"error":"invalid_payload","detail":"error_required_on_failure"}',
    ],
  ];
  for (const [init, status, body] of cases) {
    const { res, text, route, lines } = await send(init, (method, path) => unexpected(method, path));
    const label = String(init.method ?? "POST") + " " + String(init.body ?? "").slice(0, 40);
    assertEquals([res.status, text], [status, body], label);
    assertEquals(res.headers.get("content-type"), "application/json", label);
    assertEquals(route, [], label);
    assertEquals(lines, [], label);
  }
});

Deno.test("a batch with more than 50 events is 400 invalid_payload", async () => {
  const events = Array.from({ length: 51 }, () => OK_EVENT);
  const { res, text, route } = await post({ ...BATCH, events }, answers(0));
  assertEquals(res.status, 400);
  assert(text.startsWith('{"error":"invalid_payload","detail":'), text);
  assertEquals(route, []);
});

Deno.test("a deploy without its secrets answers valid requests 500 internal_error, logged as a tag", async () => {
  const handler = createIngestHandler({ backend: null, now: () => NOW });
  const { result: res, lines } = await captureLogs(() =>
    handler(new Request("https://edge.local/telemetry-ingest", { method: "POST", body: JSON.stringify(BATCH) }))
  );
  assertEquals([res.status, await res.text()], [500, '{"error":"internal_error"}']);
  assertEquals(lines, ["telemetry-ingest not_configured"]);

  // Validation still comes first, as it did when the secrets were read per request: a
  // request the phone must drop is a 400, not a retryable 500.
  const invalid = await handler(new Request("https://edge.local/telemetry-ingest", { method: "POST", body: "{nope" }));
  assertEquals([invalid.status, await invalid.text()], [400, '{"error":"invalid_json"}']);
});

Deno.test("anything thrown is 500 internal_error, logged as 'unhandled' with no detail", async () => {
  const pg = recordingFetch(answers(0));
  const handler = createIngestHandler({
    backend: backendOver(pg.fetchFn),
    now: () => {
      throw new Error("clock failed for " + TOKEN);
    },
  });
  const { result: res, lines } = await captureLogs(() =>
    handler(new Request("https://edge.local/telemetry-ingest", { method: "POST", body: JSON.stringify(BATCH) }))
  );
  assertEquals([res.status, await res.text()], [500, '{"error":"internal_error"}']);
  assertEquals(lines, ["telemetry-ingest unhandled"]);
  assertEquals(pg.requests, []);
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
