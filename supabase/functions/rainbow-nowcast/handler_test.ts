import { assert, assertEquals, assertMatch } from "@std/assert";
import { createHandler, type Deps, type Store } from "./handler.ts";
import { createKeys } from "./keys.ts";
import { StoreError } from "./log.ts";
import { routeRequest } from "./router.ts";

const NOW = new Date("2026-07-06T12:00:00Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const BUCKET = Math.floor(NOW_SEC / 300) * 300;   // 12:00:00Z is 5-min aligned → BUCKET === NOW_SEC
const KEYS = createKeys("test-pepper");

function memoryStore() {
  const cache = new Map<string, { payload: unknown; expiresAt: string }>();
  const monthly = new Map<string, number>();
  const ip = new Map<string, number>();
  const store: Store = {
    getCache: (k) => Promise.resolve(cache.get(k) ?? null),
    setCache: (k, payload, expiresAt) => {
      cache.set(k, { payload, expiresAt });
      return Promise.resolve();
    },
    getMonthlyUsage: (p) => Promise.resolve(monthly.get(p) ?? 0),
    incrementMonthlyUsage: (p) => {
      const n = (monthly.get(p) ?? 0) + 1;
      monthly.set(p, n);
      return Promise.resolve(n);
    },
    incrementIpUsage: (k) => {
      const n = (ip.get(k) ?? 0) + 1;
      ip.set(k, n);
      return Promise.resolve(n);
    },
  };
  return { store, cache, monthly, ip };
}

const UPSTREAM_BODY = {
  longitude: 13.4,
  latitude: 52.5,
  summary: { intensity: "rain" },
  forecast: [{ precipRate: 1.2, precipType: "rain", timestampBegin: BUCKET, timestampEnd: BUCKET + 3600 }],
};

function upstreamFetch(status = 200, body: unknown = UPSTREAM_BODY) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    store: memoryStore().store,
    keys: KEYS,
    fetchFn: upstreamFetch().fetchFn,
    env: (name) => (name === "RAINBOW_API_KEY" ? "test-key" : undefined),
    now: () => NOW,
    ...overrides,
  };
}

function reqFor(query: string, ip = "203.0.113.9"): Request {
  return new Request("https://edge.local/rainbow-nowcast" + query, {
    headers: { "x-forwarded-for": ip },
  });
}

Deno.test("rejects methods other than GET and POST with 405", async () => {
  const handle = createHandler(makeDeps());
  for (const method of ["PUT", "DELETE", "PATCH", "HEAD"]) {
    const res = await handle(new Request("https://edge.local/rainbow-nowcast?lat=1&lon=2", { method }));
    assertEquals(res.status, 405, method);
  }
});

Deno.test("400 on missing, garbage, or out-of-range lat/lon", async () => {
  const handle = createHandler(makeDeps());
  assertEquals((await handle(reqFor("?lon=13.4"))).status, 400);
  assertEquals((await handle(reqFor("?lat=52.5"))).status, 400);
  assertEquals((await handle(reqFor("?lat=91&lon=13.4"))).status, 400);
  assertEquals((await handle(reqFor("?lat=52.5&lon=181"))).status, 400);
  assertEquals((await handle(reqFor("?lat=abc&lon=13.4"))).status, 400);
  assertEquals((await handle(reqFor("?lat=&lon=13.4"))).status, 400);
});

Deno.test("500 when RAINBOW_API_KEY is unset", async () => {
  const handle = createHandler(makeDeps({ env: () => undefined }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "missing_api_key");
});

Deno.test("miss → upstream call (lon/lat path order, key header), cached; repeat → cache hit", async () => {
  const mem = memoryStore();
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  const res1 = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res1.status, 200);
  assertEquals((await res1.json()).forecast.length, 1);
  assertEquals(up.calls.length, 1);
  assertEquals(
    up.calls[0].url,
    `https://api.rainbow.ai/nowcast/v1/precip-global/13.4/52.5?start_timestamp=${BUCKET}`,
  );
  assertEquals(up.calls[0].headers["ocp-apim-subscription-key"], "test-key");
  const res2 = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res2.status, 200);
  assertEquals(up.calls.length, 1, "second request served from cache");
  assertEquals(mem.monthly.get("2026-07"), 1, "exactly one upstream call counted");
});

Deno.test("expired cache row (TTL 5 min) → refetch upstream", async () => {
  const mem = memoryStore();
  mem.cache.set(await KEYS.cacheKey(52.5, 13.4, BUCKET), {
    payload: { forecast: [] },
    expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
  });
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 200);
  assertEquals(up.calls.length, 1, "expired row does not satisfy the request");
  assertEquals((await res.json()).forecast.length, 1, "fresh upstream payload returned");
});

Deno.test("monthly ceiling reached → no upstream; empty forecast when no cache", async () => {
  const mem = memoryStore();
  mem.monthly.set("2026-07", 5000);   // at the RAINBOW_MONTHLY_BUDGET default
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).forecast, []);
  assertEquals(up.calls.length, 0, "budget cap blocks upstream");
});

Deno.test("RAINBOW_MONTHLY_BUDGET secret raises the ceiling without a redeploy", async () => {
  const mem = memoryStore();
  mem.monthly.set("2026-07", 5000);
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({
    store: mem.store,
    fetchFn: up.fetchFn,
    env: (n) =>
      n === "RAINBOW_API_KEY" ? "test-key" : n === "RAINBOW_MONTHLY_BUDGET" ? "6000" : undefined,
  }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 200);
  assertEquals(up.calls.length, 1, "raised budget allows upstream");
});

Deno.test("RAINBOW_MONTHLY_BUDGET=0 (killswitch) → no upstream even with zero usage", async () => {
  const mem = memoryStore();
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({
    store: mem.store,
    fetchFn: up.fetchFn,
    env: (n) =>
      n === "RAINBOW_API_KEY" ? "test-key" : n === "RAINBOW_MONTHLY_BUDGET" ? "0" : undefined,
  }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).forecast, []);
  assertEquals(up.calls.length, 0, "budget=0 must block upstream, not fall back to the default");
});

Deno.test("RAINBOW_IP_HOURLY_CAP=0 (killswitch) → no upstream on first cache-miss request", async () => {
  const mem = memoryStore();
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({
    store: mem.store,
    fetchFn: up.fetchFn,
    env: (n) =>
      n === "RAINBOW_API_KEY" ? "test-key" : n === "RAINBOW_IP_HOURLY_CAP" ? "0" : undefined,
  }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).forecast, []);
  assertEquals(up.calls.length, 0, "ip cap=0 must block upstream, not fall back to the default");
});

Deno.test("per-IP hourly cap exceeded → no upstream, empty forecast", async () => {
  const mem = memoryStore();
  mem.ip.set(await KEYS.ipHourKey("203.0.113.9", NOW), 30);   // at the DEFAULT_IP_HOURLY_CAP
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).forecast, []);
  assertEquals(up.calls.length, 0, "ip cap blocks upstream");
});

Deno.test("echoed lat/lon far from request (transposition guard) → 502, not cached", async () => {
  const mem = memoryStore();
  const up = upstreamFetch(200, { longitude: 52.5, latitude: 13.4, forecast: [] });   // swapped echo
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 502);
  assertEquals(mem.cache.size, 0, "mismatching payload must not be cached");
});

Deno.test("upstream 404 (no data) → {forecast: []} with 200 AND cached", async () => {
  const mem = memoryStore();
  const up = upstreamFetch(404, { message: "no data" });
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  const res = await handle(reqFor(`?lat=-45.9&lon=170.5&start=${BUCKET}`));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).forecast, []);
  assertEquals(mem.cache.size, 1, "no-data clear is cached to spare upstream");
});

Deno.test("upstream 5xx → 502 error, not cached (PKJS preserves existing radar)", async () => {
  const mem = memoryStore();
  const up = upstreamFetch(500, { error: "boom" });
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 502);
  assertEquals(mem.cache.size, 0);
});

Deno.test("upstream network failure → 504", async () => {
  const fetchFn = (() => Promise.reject(new TypeError("connection refused"))) as typeof fetch;
  const handle = createHandler(makeDeps({ fetchFn }));
  const res = await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 504);
});

Deno.test("invalid start (unaligned/stale) normalizes to the current 5-min bucket", async () => {
  const mem = memoryStore();
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET + 17}`));     // not 1-min aligned
  await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET - 3600}`));   // >30 min old
  assertEquals(up.calls.length, 1, "both normalize to the same bucket → second is a cache hit");
  assert(up.calls[0].url.endsWith(`start_timestamp=${BUCKET}`), up.calls[0].url);
});

// --- POST {lat, lon, start}: the current phones' request ------------------------------

function postFor(body: unknown, ip = "203.0.113.9"): Request {
  return new Request("https://edge.local/rainbow-nowcast", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": ip },
  });
}

Deno.test("POST {lat, lon, start} → the same upstream call and answer as the legacy GET", async () => {
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ fetchFn: up.fetchFn }));
  const res = await handle(postFor({ lat: 52.5, lon: 13.4, start: BUCKET }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("x-rainbow-cache"), "miss");
  assertEquals((await res.json()).forecast.length, 1);
  assertEquals(up.calls.length, 1);
  assertEquals(up.calls[0].url, `https://api.rainbow.ai/nowcast/v1/precip-global/13.4/52.5?start_timestamp=${BUCKET}`);
});

Deno.test("the body is read whatever the content type (the phone sends text/plain)", async () => {
  for (const type of ["application/json", "text/plain;charset=UTF-8", ""]) {
    const up = upstreamFetch();
    const handle = createHandler(makeDeps({ fetchFn: up.fetchFn }));
    const res = await handle(new Request("https://edge.local/rainbow-nowcast", {
      method: "POST",
      body: JSON.stringify({ lat: 52.5, lon: 13.4, start: BUCKET }),
      headers: type ? { "content-type": type } : {},
    }));
    assertEquals(res.status, 200, type);
    assertEquals(up.calls.length, 1, type);
  }
});

Deno.test("the server rounds to 3 decimals before the upstream URL and the cache key", async () => {
  const mem = memoryStore();
  const up = upstreamFetch(200, { ...UPSTREAM_BODY, latitude: 52.517, longitude: 13.389 });
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  // Full precision via the legacy GET (an old app) …
  await handle(reqFor(`?lat=52.5170365&lon=13.3888599&start=${BUCKET}`));
  assertEquals(up.calls[0].url, `https://api.rainbow.ai/nowcast/v1/precip-global/13.389/52.517?start_timestamp=${BUCKET}`);
  // … and pre-rounded via POST (a new app) share one cache row.
  const res = await handle(postFor({ lat: 52.517, lon: 13.389, start: BUCKET }));
  assertEquals(res.headers.get("x-rainbow-cache"), "hit", "GET and POST from the same fix share the row");
  assertEquals(up.calls.length, 1);
  assertEquals([...mem.cache.keys()], [await KEYS.cacheKey(52.517, 13.389, BUCKET)]);
});

Deno.test("a manual location's string coordinates are accepted; null, '', booleans and out-of-range are 400", async () => {
  // [body, the rounded lat and lon it asks Rainbow for]
  const good: [unknown, number, number][] = [
    [{ lat: "52.5170365", lon: "13.3888599", start: BUCKET }, 52.517, 13.389],
    [{ lat: "+52.52", lon: "13.4" }, 52.52, 13.4],
    [{ lat: "-.5", lon: " 13.4 " }, -0.5, 13.4],
    [{ lat: -0.0004, lon: 13.4 }, 0, 13.4],
    [{ lat: 52.5, lon: 13.4, start: String(BUCKET) }, 52.5, 13.4],
    [{ lat: 52.5, lon: 13.4, start: null }, 52.5, 13.4],
  ];
  for (const [body, lat, lon] of good) {
    const up = upstreamFetch(200, { ...UPSTREAM_BODY, latitude: lat, longitude: lon });
    const res = await createHandler(makeDeps({ fetchFn: up.fetchFn }))(postFor(body));
    assertEquals(res.status, 200, JSON.stringify(body));
    assertEquals(up.calls.length, 1, JSON.stringify(body));
    assert(up.calls[0].url.startsWith(`https://api.rainbow.ai/nowcast/v1/precip-global/${lon}/${lat}?`), up.calls[0].url);
  }
  const bad: unknown[] = [
    { lat: null, lon: 13.4 },
    { lat: "", lon: 13.4 },
    { lat: " ", lon: 13.4 },
    { lat: true, lon: 13.4 },
    { lat: [], lon: 13.4 },
    { lat: 95, lon: 13.4 },
    { lat: 52.5, lon: -181 },
    { lat: "52.5abc", lon: 13.4 },
    { lat: "0x10", lon: 13.4 },
    { lat: "Infinity", lon: 13.4 },
    { lat: 52.5 },
    { lat: 52.5, lon: 13.4, start: "soon" },
    { lat: 52.5, lon: 13.4, start: 1.5 },
    [52.5, 13.4],
    "null",
    "not json",
    "",
  ];
  for (const body of bad) {
    const up = upstreamFetch();
    const res = await createHandler(makeDeps({ fetchFn: up.fetchFn }))(postFor(body));
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals((await res.json()).error, "invalid_body");
    assertEquals(up.calls.length, 0, JSON.stringify(body));
  }
});

Deno.test("the legacy GET rejects blank and non-decimal coordinates too (no z.coerce 0)", async () => {
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ fetchFn: up.fetchFn }));
  for (const q of ["?lat=%20&lon=13.4", "?lat=0x10&lon=13.4", "?lat=52.5&lon=13.4&start=soon"]) {
    assertEquals((await handle(reqFor(q))).status, 400, q);
  }
  // '+' in a query decodes to a space: an old app's '+52.52' still reads as 52.52.
  const res = await handle(reqFor(`?lat=+52.52&lon=13.4&start=${BUCKET}`));
  assertEquals(res.status, 200);
  assertEquals(up.calls.length, 1);
});

Deno.test("a root POST from a pre-/key-check settings page ({key}) is a 400, never an upstream call", async () => {
  const up = upstreamFetch();
  const res = await createHandler(makeDeps({ fetchFn: up.fetchFn }))(postFor({ key: "SECRETab0123456789abcdef01234567" }));
  assertEquals(res.status, 400);
  assertEquals(up.calls.length, 0);
});

Deno.test("a POST body over the cap → 413, unread past it", async () => {
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ fetchFn: up.fetchFn }));
  const big = JSON.stringify({ lat: 52.5, lon: 13.4, pad: "x".repeat(600) });
  assertEquals((await handle(postFor(big))).status, 413);
  const declared = new Request("https://edge.local/rainbow-nowcast", {
    method: "POST",
    body: JSON.stringify({ lat: 52.5, lon: 13.4 }),
    headers: { "content-length": "100000" },
  });
  assertEquals((await handle(declared)).status, 413);
  assertEquals(up.calls.length, 0);
});

// --- What is kept: the forecast only ------------------------------------------------------

Deno.test("the answer and the cache row carry the forecast only: no echoed position, no summary", async () => {
  const mem = memoryStore();
  const up = upstreamFetch();
  const handle = createHandler(makeDeps({ store: mem.store, fetchFn: up.fetchFn }));
  const miss = await (await handle(postFor({ lat: 52.5, lon: 13.4, start: BUCKET }))).json();
  const hit = await (await handle(postFor({ lat: 52.5, lon: 13.4, start: BUCKET }))).json();
  const stored = [...mem.cache.values()][0].payload;
  for (const body of [miss, hit, stored]) {
    assertEquals(body, { forecast: UPSTREAM_BODY.forecast });
  }
});

Deno.test("a stale fallback and a cache hit on an older row are stripped too", async () => {
  const mem = memoryStore();
  const key = await KEYS.cacheKey(52.5, 13.4, BUCKET);
  mem.cache.set(key, { payload: UPSTREAM_BODY, expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
  mem.monthly.set("2026-07", 5000);   // budget reached → the stale row is the answer
  const handle = createHandler(makeDeps({ store: mem.store }));
  const stale = await handle(postFor({ lat: 52.5, lon: 13.4, start: BUCKET }));
  assertEquals(stale.headers.get("x-rainbow-cache"), "budget-capped");
  assertEquals(await stale.json(), { forecast: UPSTREAM_BODY.forecast });

  mem.cache.set(key, { payload: UPSTREAM_BODY, expiresAt: new Date(NOW.getTime() + 60_000).toISOString() });
  const hit = await handle(postFor({ lat: 52.5, lon: 13.4, start: BUCKET }));
  assertEquals(hit.headers.get("x-rainbow-cache"), "hit");
  assertEquals(await hit.json(), { forecast: UPSTREAM_BODY.forecast });
});

Deno.test("the echo check compares against the rounded request", async () => {
  // Rainbow echoes its grid point; a sub-0.5° offset from the rounded request passes.
  const up = upstreamFetch(200, { ...UPSTREAM_BODY, latitude: 52.9, longitude: 13.0 });
  const res = await createHandler(makeDeps({ fetchFn: up.fetchFn }))(postFor({ lat: 52.5170365, lon: 13.3888599, start: BUCKET }));
  assertEquals(res.status, 200);
});

// --- What is stored: keyed hashes only -------------------------------------------------

Deno.test("the store sees no place and no IP: the cache key and the IP bucket are keyed hashes", async () => {
  const mem = memoryStore();
  const handle = createHandler(makeDeps({ store: mem.store }));
  await handle(postFor({ lat: 52.5, lon: 13.4, start: BUCKET }, "203.0.113.9"));
  const [cacheKey] = [...mem.cache.keys()];
  const [ipKey] = [...mem.ip.keys()];
  assertMatch(cacheKey, /^[0-9a-f]{64}$/);
  assertMatch(ipKey, /^[0-9a-f]{32}:2026-07-06T12$/);
  for (const k of [cacheKey, ipKey]) {
    for (const leak of ["52.5", "13.4", "203.0.113.9", "52:", "13:"]) {
      assert(!k.includes(leak), `${k} carries ${leak}`);
    }
  }
});

// --- Failures: logged by tag and code, answered without a stack --------------------------

/** Run fn with console.error/log/warn/info captured. */
async function captureConsole(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const saved = { error: console.error, log: console.log, warn: console.warn, info: console.info };
  const record = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  console.error = record; console.log = record; console.warn = record; console.info = record;
  try { await fn(); } finally { Object.assign(console, saved); }
  return lines;
}

Deno.test("a failing store call → 503 through the router, logged as tag + code only", async () => {
  const mem = memoryStore();
  mem.store.incrementIpUsage = () => Promise.reject(new StoreError("ip_usage_failed", "42P01"));
  const route = routeRequest(createHandler(makeDeps({ store: mem.store })), () => Promise.reject(new Error("unused")));
  let res: Response | undefined;
  const lines = await captureConsole(async () => {
    res = await route(postFor({ lat: 52.5170365, lon: 13.3888599, start: BUCKET }, "198.51.100.23"));
  });
  assertEquals(res!.status, 503);
  assertEquals(await res!.json(), { error: "unavailable" });
  assertEquals(lines, ["rainbow-nowcast ip_usage_failed 42P01"]);
});

Deno.test("an unexpected throw is logged as 'unhandled' with no message, whatever it said", async () => {
  const mem = memoryStore();
  mem.store.getMonthlyUsage = () => Promise.reject(new Error("row for 203.0.113.9 at 52.517,13.389"));
  const route = routeRequest(createHandler(makeDeps({ store: mem.store })), () => Promise.reject(new Error("unused")));
  let res: Response | undefined;
  const lines = await captureConsole(async () => {
    res = await route(postFor({ lat: 52.517, lon: 13.389, start: BUCKET }, "203.0.113.9"));
  });
  assertEquals(res!.status, 503);
  assertEquals(lines, ["rainbow-nowcast unhandled"]);
});

Deno.test("a failed cache write still answers the paid-for forecast, and logs its code", async () => {
  const mem = memoryStore();
  mem.store.setCache = () => Promise.reject(new StoreError("cache_write_failed", "23514"));
  const handle = createHandler(makeDeps({ store: mem.store }));
  let res: Response | undefined;
  const lines = await captureConsole(async () => {
    res = await handle(postFor({ lat: 52.5, lon: 13.4, start: BUCKET }));
  });
  assertEquals(res!.status, 200);
  assertEquals((await res!.json()).forecast.length, 1);
  assertEquals(lines, ["rainbow-nowcast cache_write_failed 23514"]);
});

Deno.test("a successful request logs nothing", async () => {
  const handle = createHandler(makeDeps());
  const lines = await captureConsole(async () => {
    await (await handle(postFor({ lat: 52.5, lon: 13.4, start: BUCKET }))).body?.cancel();
    await (await handle(reqFor(`?lat=52.5&lon=13.4&start=${BUCKET}`))).body?.cancel();
  });
  assertEquals(lines, []);
});
