import { assert, assertEquals } from "@std/assert";
import {
  createKeyCheckHandler,
  KEY_CHECK_WINDOW_MS,
  KEY_CHECKS_PER_IP_PER_MIN,
  MAX_BODY_BYTES,
} from "./key-check.ts";

// A distinctive, valid 32-character key: every invalid key below carries "SECRET" too, so
// "the response never contains the key" is an assertion that can actually fail.
const K = "SECRETab0123456789abcdef01234567";
const T0 = Date.UTC(2026, 8, 25, 10, 0, 0);
const UPSTREAM_URL = "https://api.rainbow.ai/nowcast/v1/precip-global/13.405/52.52";

type Call = { url: string; headers: Record<string, string>; signal: AbortSignal | null | undefined };

/** A recording upstream stub answering every call with `status` (and a nowcast-ish body). */
function upstreamFetch(status = 200) {
  const calls: Call[] = [];
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      signal: init?.signal,
    });
    return Promise.resolve(new Response(JSON.stringify({ latitude: 52.52, longitude: 13.405, forecast: [] }), { status }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** An upstream that never answers: the fetch rejects (DNS failure, reset, timeout abort). */
function unreachableFetch() {
  const calls: string[] = [];
  const fetchFn = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.reject(new TypeError("error sending request"));
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** A settable clock for the limiter. */
function clock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

// Outside the limiter test every request gets its own client IP, so a loop of bad bodies
// (the limiter runs before parsing) never reads 429 instead of 400.
let ipSeq = 0;
function nextIp(): string {
  ipSeq += 1;
  return `198.51.${Math.floor(ipSeq / 256)}.${ipSeq % 256}`;
}

function post(body: string, ip = nextIp(), extraHeaders: Record<string, string> = {}): Request {
  return new Request("https://edge.local/rainbow-nowcast/key-check", {
    method: "POST",
    body,
    headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": ip, ...extraHeaders },
  });
}

function keyBody(key: unknown): string {
  return JSON.stringify({ key });
}

function assertCors(res: Response) {
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
}

Deno.test("OPTIONS preflight → 204 with CORS, no upstream call", async () => {
  const up = upstreamFetch();
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  const res = await handle(new Request("https://edge.local/rainbow-nowcast/key-check", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertCors(res);
  assert((res.headers.get("access-control-allow-methods") || "").includes("POST"));
  assertEquals(up.calls.length, 0);
});

Deno.test("POST a valid key → one upstream call with it in the header → 200 {status: 200}", async () => {
  const up = upstreamFetch(200);
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  const res = await handle(post(keyBody(K)));
  assertEquals(res.status, 200);
  assertCors(res);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(await res.json(), { status: 200 });
  assertEquals(up.calls.length, 1);
  assertEquals(up.calls[0].url, UPSTREAM_URL, "fixed Berlin point, lon/lat order, no start_timestamp");
  assert(!up.calls[0].url.includes(K), "the key never rides the URL");
  assertEquals(up.calls[0].headers["ocp-apim-subscription-key"], K);
  assert(up.calls[0].signal instanceof AbortSignal, "the upstream call is bounded by a timeout signal");
});

Deno.test("the key is trimmed before it reaches the upstream header", async () => {
  const up = upstreamFetch(200);
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  const res = await handle(post(keyBody("  " + K + " \n")));
  assertEquals(res.status, 200);
  assertEquals(up.calls.length, 1);
  assertEquals(up.calls[0].headers["ocp-apim-subscription-key"], K);
});

Deno.test("upstream 401/403/404/429/500 → HTTP 200 carrying that status (never a pass-through status)", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const up = upstreamFetch(status);
    const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
    const res = await handle(post(keyBody(K)));
    assertEquals(res.status, 200, `upstream ${status}`);
    assertCors(res);
    assertEquals(await res.json(), { status }, `upstream ${status}`);
    assertEquals(up.calls.length, 1, `upstream ${status}`);
  }
});

Deno.test("upstream unreachable → 504 upstream_unreachable, with CORS", async () => {
  const up = unreachableFetch();
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  const res = await handle(post(keyBody(K)));
  assertEquals(res.status, 504);
  assertCors(res);
  assertEquals(await res.json(), { error: "upstream_unreachable" });
  assertEquals(up.calls.length, 1);
});

// Bodies that must never reach upstream: not JSON, no key, a non-string key, and keys that
// fail the APIM shape (space, control char, ':', too short, too long).
const INVALID_BODIES: string[] = [
  "nope",
  "{}",
  '{"key":""}',
  '{"key":42}',
  '{"key":"SECRETab cd0123456789"}',
  '{"key":"SECRETab\\u0007cd0123456789"}',
  '{"key":"SECRET:0123456789ab"}',
  keyBody("SECRET012345678"),                 // 15 characters
  keyBody("SECRET" + "a".repeat(123)),        // 129 characters
];

Deno.test("invalid payload or key → 400 with CORS and no upstream call", async () => {
  assertEquals(JSON.parse(INVALID_BODIES[7]).key.length, 15);
  assertEquals(JSON.parse(INVALID_BODIES[8]).key.length, 129);
  for (const body of INVALID_BODIES) {
    const up = upstreamFetch(200);
    const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
    const res = await handle(post(body));
    assertEquals(res.status, 400, body);
    assertCors(res);
    assertEquals(up.calls.length, 0, body);
  }
});

Deno.test("a 16-character key and a key with '_' and '-' pass the shape check", async () => {
  for (const key of ["SECRET0123456789", "SECRET_ab-cd0123456789"]) {
    const up = upstreamFetch(200);
    const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
    const res = await handle(post(keyBody(key)));
    assertEquals(res.status, 200, key);
    assertEquals(await res.json(), { status: 200 }, key);
    assertEquals(up.calls.length, 1, key);
    assertEquals(up.calls[0].headers["ocp-apim-subscription-key"], key);
  }
});

/** A valid key body padded (unknown fields are ignored by the key check) to exactly `bytes` bytes. */
function paddedKeyBody(bytes: number): string {
  const base = JSON.stringify({ key: K, pad: "" }).length;
  const body = JSON.stringify({ key: K, pad: "x".repeat(bytes - base) });
  assertEquals(new TextEncoder().encode(body).length, bytes);
  return body;
}

Deno.test("a body over MAX_BODY_BYTES → 413 with no upstream call; exactly MAX_BODY_BYTES still checks", async () => {
  const up = upstreamFetch(200);
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  const res = await handle(post(paddedKeyBody(MAX_BODY_BYTES + 1)));
  assertEquals(res.status, 413);
  assertCors(res);
  assertEquals(await res.json(), { error: "payload_too_large" });
  assertEquals(up.calls.length, 0);
  const atLimit = await handle(post(paddedKeyBody(MAX_BODY_BYTES)));
  assertEquals(atLimit.status, 200);
  assertEquals(up.calls.length, 1);
});

Deno.test("a declared content-length over MAX_BODY_BYTES → 413 before the body is read", async () => {
  const up = upstreamFetch(200);
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  const req = post(keyBody(K), nextIp(), { "content-length": "5000" });
  assertEquals(req.headers.get("content-length"), "5000");
  const res = await handle(req);
  assertEquals(res.status, 413);
  assertCors(res);
  assertEquals(up.calls.length, 0);
});

/**
 * A POST whose body streams `chunks` chunks of `chunkBytes` each, with no content-length
 * (a chunked upload). Pull-based: `pulls` counts the chunks asked for, and `cancelled` is
 * set when the reader gives up on it.
 */
function streamedPost(chunks: number, chunkBytes: number, fill = 0x78) {
  const probe = { pulls: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (probe.pulls >= chunks) { controller.close(); return; }
      probe.pulls += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(fill));
    },
    cancel() { probe.cancelled = true; },
  });
  const req = new Request("https://edge.local/rainbow-nowcast/key-check", {
    method: "POST",
    body,
    headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": nextIp() },
  });
  return { req, probe };
}

Deno.test("a streamed body with no content-length stops being read at MAX_BODY_BYTES: 413, never drained", async () => {
  const up = upstreamFetch(200);
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  // ~10 MB if drained, in 1 KB chunks.
  const { req, probe } = streamedPost(10 * 1024, 1024);
  assertEquals(req.headers.get("content-length"), null, "no declared length: the pre-check can't catch it");
  const res = await handle(req);
  assertEquals(res.status, 413);
  assertCors(res);
  assertEquals(await res.json(), { error: "payload_too_large" });
  assertEquals(up.calls.length, 0);
  assert(probe.cancelled, "the body stream was cancelled, not drained");
  assert(probe.pulls <= 8, `read stopped at the cap (${probe.pulls} chunks pulled)`);
});

Deno.test("a streamed body of exactly MAX_BODY_BYTES in small chunks still checks the key", async () => {
  const up = upstreamFetch(200);
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  const bytes = new TextEncoder().encode(paddedKeyBody(MAX_BODY_BYTES));
  let off = 0;
  const req = new Request("https://edge.local/rainbow-nowcast/key-check", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (off >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(off, off + 100));
        off += 100;
      },
    }),
    headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": nextIp() },
  });
  assertEquals(req.headers.get("content-length"), null);
  const res = await handle(req);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: 200 });
  assertEquals(up.calls.length, 1);
  assertEquals(up.calls[0].headers["ocp-apim-subscription-key"], K);
});

Deno.test("the key never comes back: no response on any path contains the key sent", async () => {
  const seen: { label: string; status: number; text: string }[] = [];
  const record = async (label: string, res: Response) => {
    seen.push({ label, status: res.status, text: await res.text() });
  };
  for (const status of [200, 401, 403, 404, 429, 500]) {
    await record(`upstream ${status}`, await createKeyCheckHandler({ fetchFn: upstreamFetch(status).fetchFn })(post(keyBody(K))));
  }
  for (const body of INVALID_BODIES) {
    await record(`invalid ${body.slice(0, 24)}`, await createKeyCheckHandler({ fetchFn: upstreamFetch().fetchFn })(post(body)));
  }
  const handle = createKeyCheckHandler({ fetchFn: upstreamFetch().fetchFn });
  await record("413 body", await handle(post(paddedKeyBody(MAX_BODY_BYTES + 1))));
  await record("413 content-length", await handle(post(keyBody(K), nextIp(), { "content-length": "5000" })));
  const limited = createKeyCheckHandler({ fetchFn: upstreamFetch().fetchFn, now: clock().now });
  for (let i = 0; i < KEY_CHECKS_PER_IP_PER_MIN; i++) await (await limited(post(keyBody(K), "203.0.113.7"))).body?.cancel();
  await record("429 limiter", await limited(post(keyBody(K), "203.0.113.7")));
  await record("504", await createKeyCheckHandler({ fetchFn: unreachableFetch().fetchFn })(post(keyBody(K))));

  const statuses = new Set(seen.map((s) => s.status));
  for (const s of [200, 400, 413, 429, 504]) assert(statuses.has(s), `path with HTTP ${s} exercised`);
  for (const { label, text } of seen) {
    assert(!text.includes(K), `${label}: response echoes the key`);
    assert(!text.includes("SECRET"), `${label}: response echoes (part of) the key`);
  }
});

Deno.test("per-IP limiter: 5 checks a minute per IP, then 429 with CORS and no upstream call", async () => {
  const up = upstreamFetch(200);
  const c = clock();
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn, now: c.now });
  const A = "1.2.3.4";
  for (let i = 0; i < 4; i++) {
    assertEquals((await handle(post(keyBody(K), A))).status, 200, `POST ${i + 1}`);
  }
  // Preflights don't count: were they counted, the 5th POST below would be the 8th hit.
  for (let i = 0; i < 3; i++) {
    const pre = await handle(new Request("https://edge.local/rainbow-nowcast/key-check", {
      method: "OPTIONS",
      headers: { "x-forwarded-for": A },
    }));
    assertEquals(pre.status, 204);
  }
  assertEquals((await handle(post(keyBody(K), A))).status, 200, "POST 5");
  assertEquals(up.calls.length, KEY_CHECKS_PER_IP_PER_MIN);

  const sixth = await handle(post(keyBody(K), A));
  assertEquals(sixth.status, 429);
  assertCors(sixth);
  assertEquals(await sixth.json(), { error: "rate_limited" });
  assertEquals(up.calls.length, 5, "a limited check never reaches upstream");

  // Another client is unaffected.
  assertEquals((await handle(post(keyBody(K), "5.6.7.8"))).status, 200);
  assertEquals(up.calls.length, 6);

  // The first x-forwarded-for entry is the client: a proxy-appended hop doesn't reset it.
  assertEquals((await handle(post(keyBody(K), "1.2.3.4, 10.0.0.1"))).status, 429);
  assertEquals(up.calls.length, 6);

  c.advance(KEY_CHECK_WINDOW_MS - 1);
  assertEquals((await handle(post(keyBody(K), A))).status, 429, "still inside the minute");
  c.advance(1);
  assertEquals((await handle(post(keyBody(K), A))).status, 200, "a new minute, a new allowance");
  assertEquals(up.calls.length, 7);
});

Deno.test("GET straight to the key-check handler → 405", async () => {
  const up = upstreamFetch(200);
  const handle = createKeyCheckHandler({ fetchFn: up.fetchFn });
  const res = await handle(new Request("https://edge.local/rainbow-nowcast/key-check?lat=52.5&lon=13.4"));
  assertEquals(res.status, 405);
  assertCors(res);
  assertEquals(up.calls.length, 0);
});
