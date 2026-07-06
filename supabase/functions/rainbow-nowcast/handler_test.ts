import { assert, assertEquals } from "@std/assert";
import { createHandler, type Deps, type Store } from "./handler.ts";

const NOW = new Date("2026-07-06T12:00:00Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const BUCKET = Math.floor(NOW_SEC / 300) * 300;   // 12:00:00Z is 5-min aligned → BUCKET === NOW_SEC

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

Deno.test("rejects non-GET with 405", async () => {
  const handle = createHandler(makeDeps());
  const res = await handle(new Request("https://edge.local/rainbow-nowcast?lat=1&lon=2", { method: "POST" }));
  assertEquals(res.status, 405);
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
  mem.cache.set(`52.500:13.400:${BUCKET}`, {
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

Deno.test("per-IP hourly cap exceeded → no upstream, empty forecast", async () => {
  const mem = memoryStore();
  mem.ip.set("203.0.113.9:2026-07-06T12", 30);   // at the DEFAULT_IP_HOURLY_CAP
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
