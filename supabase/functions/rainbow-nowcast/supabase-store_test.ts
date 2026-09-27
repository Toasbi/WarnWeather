// The real supabase-js client over a recording fetch: proves what the gateway would log.
// Supabase logs the full URL of every PostgREST request the function makes, so no key (the
// cache key, the IP bucket), no coordinate and no IP may appear in one.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";
import { createKeys } from "./keys.ts";
import { createSupabaseStore } from "./supabase-store.ts";

const NOW = new Date("2026-07-06T12:00:00Z");
const BUCKET = Math.floor(NOW.getTime() / 1000);
const IP = "203.0.113.9";
const KEYS = createKeys("test-pepper");

type Recorded = { method: string; url: string; body: string };

/**
 * A PostgREST stand-in: records each request and answers it from `answer`.
 * @param answer (method, path, body) -> [status, JSON body].
 */
function recordingFetch(answer: (method: string, path: string, body: string) => [number, unknown]) {
  const requests: Recorded[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = req.body ? await req.text() : "";
    requests.push({ method: req.method, url: req.url, body });
    const [status, json] = answer(req.method, new URL(req.url).pathname, body);
    return new Response(json === undefined ? null : JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, requests };
}

function client(fetchFn: typeof fetch) {
  return createClient("http://pg.test", "service-key", {
    global: { fetch: fetchFn },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const UPSTREAM = { latitude: 52.517, longitude: 13.389, forecast: [{ precipRate: 1, timestampBegin: BUCKET, timestampEnd: BUCKET + 300 }] };
const upstreamFetch = (() => Promise.resolve(new Response(JSON.stringify(UPSTREAM)))) as typeof fetch;

/** PostgREST answers for a cache miss that goes upstream. */
function missAnswers(method: string, path: string): [number, unknown] {
  if (path === "/rest/v1/rpc/get_rainbow_nowcast_cache") return [200, null];
  if (path === "/rest/v1/rpc/increment_rainbow_ip_usage") return [200, 1];
  if (path === "/rest/v1/rpc/increment_rainbow_usage") return [200, 1];
  if (path === "/rest/v1/rainbow_upstream_usage" && method === "GET") return [200, []];
  if (path === "/rest/v1/rainbow_nowcast_cache" && method === "POST") return [201, undefined];
  return [404, { code: "PGRST000", message: "unexpected " + method + " " + path }];
}

function handlerOver(fetchFn: typeof fetch) {
  return createHandler({
    store: createSupabaseStore(client(fetchFn)),
    keys: KEYS,
    fetchFn: upstreamFetch,
    env: (n) => (n === "RAINBOW_API_KEY" ? "test-key" : undefined),
    now: () => NOW,
  });
}

function post(): Request {
  return new Request("https://edge.local/rainbow-nowcast", {
    method: "POST",
    body: JSON.stringify({ lat: 52.5170365, lon: 13.3888599, start: BUCKET }),
    headers: { "x-forwarded-for": IP },
  });
}

Deno.test("a cache miss: RPCs and an upsert, every key in a body, none in a URL", async () => {
  const pg = recordingFetch(missAnswers);
  const res = await handlerOver(pg.fetchFn)(post());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { forecast: UPSTREAM.forecast });

  const cacheKey = await KEYS.cacheKey(52.517, 13.389, BUCKET);
  const ipKey = await KEYS.ipHourKey(IP, NOW);
  assertEquals(pg.requests.map((r) => r.method + " " + new URL(r.url).pathname), [
    "POST /rest/v1/rpc/get_rainbow_nowcast_cache",
    "POST /rest/v1/rpc/increment_rainbow_ip_usage",
    "GET /rest/v1/rainbow_upstream_usage",
    "POST /rest/v1/rpc/increment_rainbow_usage",
    "POST /rest/v1/rainbow_nowcast_cache",
  ]);
  for (const r of pg.requests) {
    for (const secret of [cacheKey, ipKey, ipKey.slice(0, 32), IP, "52.517", "13.389", "52.5170365"]) {
      assert(!decodeURIComponent(r.url).includes(secret), `${r.method} ${r.url} carries ${secret}`);
    }
    assert(r.method !== "HEAD", "no HEAD requests");
    if (new URL(r.url).pathname.startsWith("/rest/v1/rpc/")) {
      assertEquals(new URL(r.url).search, "", `${r.url}: RPC arguments ride the body`);
    }
  }
  // The keys went where they belong: in the bodies.
  assertEquals(JSON.parse(pg.requests[0].body), { p_cache_key: cacheKey });
  assertEquals(JSON.parse(pg.requests[1].body), { p_ip_hour: ipKey });
  assertEquals(new URL(pg.requests[2].url).searchParams.get("period"), "eq.2026-07", "only the month is a filter");
  const row = JSON.parse(pg.requests[4].body);
  assertEquals(row.cache_key, cacheKey);
  assertEquals(row.payload, { forecast: UPSTREAM.forecast }, "the stored payload holds no position");
});

Deno.test("a cache hit is one RPC, read back from {payload, expires_at}", async () => {
  const pg = recordingFetch((method, path) => {
    if (path === "/rest/v1/rpc/get_rainbow_nowcast_cache") {
      return [200, { payload: { forecast: [{ precipRate: 2 }] }, expires_at: "2026-07-06T12:04:00+00:00" }];
    }
    return missAnswers(method, path);
  });
  const res = await handlerOver(pg.fetchFn)(post());
  assertEquals(res.headers.get("x-rainbow-cache"), "hit");
  assertEquals(await res.json(), { forecast: [{ precipRate: 2 }] });
  assertEquals(pg.requests.length, 1);
});

Deno.test("PostgREST errors: logged and thrown by code only, never by message", async () => {
  const lines: string[] = [];
  const saved = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const pg = recordingFetch((method, path) => {
      if (path === "/rest/v1/rpc/get_rainbow_nowcast_cache") {
        return [404, { code: "PGRST202", message: "Could not find get_rainbow_nowcast_cache(" + IP + ")", details: "52.517", hint: null }];
      }
      if (path === "/rest/v1/rpc/increment_rainbow_ip_usage") {
        return [409, { code: "23505", message: "duplicate key", details: "Key (ip_hour)=(" + IP + ") already exists", hint: null }];
      }
      return missAnswers(method, path);
    });
    const store = createSupabaseStore(client(pg.fetchFn));
    assertEquals(await store.getCache("k"), null, "a failed cache read is a miss");
    let thrown: unknown;
    try { await store.incrementIpUsage("k"); } catch (e) { thrown = e; }
    assert(thrown instanceof Error);
    assertEquals((thrown as Error).message, "rainbow-nowcast store call failed");
    assertEquals((thrown as { code?: string }).code, "23505");
  } finally {
    console.error = saved;
  }
  assertEquals(lines, ["rainbow-nowcast cache_read_failed PGRST202"]);
});
