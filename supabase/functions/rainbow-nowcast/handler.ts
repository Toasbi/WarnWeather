import { z } from "zod";

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_MONTHLY_BUDGET = 5000;   // matches Rainbow's free tier
export const DEFAULT_IP_HOURLY_CAP = 30;      // a real user fetches <=12/h; headroom for two devices + retries
export const ECHO_TOLERANCE_DEG = 0.5;        // catches lon/lat transposition, tolerates grid snapping
const SLOT_SECONDS = 300;
const START_MAX_AGE_SECONDS = 30 * 60;        // Rainbow accepts start_timestamp within the past 30 min
const UPSTREAM_TIMEOUT_MS = 4000;             // < the PKJS XHR's 5 s so the phone sees a real status
const RAINBOW_BASE = "https://api.rainbow.ai/nowcast/v1/precip-global";

const querySchema = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180),
  start: z.coerce.number().int().optional(),
});

/** Persistence seam: implemented over Postgres in supabase-store.ts, in-memory in tests. */
export interface Store {
  getCache(key: string): Promise<{ payload: unknown; expiresAt: string } | null>;
  setCache(key: string, payload: unknown, expiresAt: string): Promise<void>;
  getMonthlyUsage(period: string): Promise<number>;
  /** Atomic increment; returns the post-increment count. */
  incrementMonthlyUsage(period: string): Promise<number>;
  /** Atomic increment; returns the post-increment count. */
  incrementIpUsage(ipHour: string): Promise<number>;
}

export interface Deps {
  store: Store;
  fetchFn: typeof fetch;
  env: (name: string) => string | undefined;
  now: () => Date;
}

const EMPTY_FORECAST = { forecast: [] };

/** '2026-07' — the UTC month bucket for the wallet ceiling. */
function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** '<ip>:2026-07-06T12' — the per-IP UTC-hour bucket for the backstop. */
function utcHourKey(ip: string, now: Date): string {
  return ip + ":" + now.toISOString().slice(0, 13);
}

/** '<lat.3dp>:<lon.3dp>:<start>' — 3 decimals ≈ 100 m, so nearby users share one upstream call. */
function cacheKey(lat: number, lon: number, start: number): string {
  return lat.toFixed(3) + ":" + lon.toFixed(3) + ":" + start;
}

/**
 * Parses an integer env var, falling back to `fallback` only when the value is
 * unset/empty/non-numeric. Unlike `parseInt(...) || fallback`, an explicit "0"
 * is honored (the operator's emergency killswitch for the budget/IP-cap gates).
 */
function envInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Query param that treats absent AND empty ('?lat=') as missing (z.coerce would turn '' into 0). */
function qp(url: URL, name: string): string | undefined {
  const v = url.searchParams.get(name);
  return v === null || v === "" ? undefined : v;
}

/**
 * Keep a 1-min-aligned epoch within the past 30 min (small future skew allowed);
 * anything else (missing, garbage, stale, unaligned) falls back to the current
 * 5-min bucket — valid for Rainbow and cache-friendly.
 */
function normalizeStart(start: number | undefined, now: Date): number {
  const nowSec = Math.floor(now.getTime() / 1000);
  if (
    typeof start === "number" &&
    start % 60 === 0 &&
    nowSec - start <= START_MAX_AGE_SECONDS &&
    start <= nowSec + 60
  ) {
    return start;
  }
  return Math.floor(nowSec / SLOT_SECONDS) * SLOT_SECONDS;
}

export function createHandler(deps: Deps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    const url = new URL(req.url);
    const parsedQuery = querySchema.safeParse({
      lat: qp(url, "lat"),
      lon: qp(url, "lon"),
      start: qp(url, "start"),
    });
    if (!parsedQuery.success) {
      return Response.json({ error: "invalid_query" }, { status: 400 });
    }

    const apiKey = deps.env("RAINBOW_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "missing_api_key" }, { status: 500 });
    }

    const now = deps.now();
    const { lat, lon } = parsedQuery.data;
    const start = normalizeStart(parsedQuery.data.start, now);
    const key = cacheKey(lat, lon, start);

    const cached = await deps.store.getCache(key);
    const cachedFresh =
      cached && new Date(cached.expiresAt).getTime() > now.getTime() ? cached : null;
    if (cachedFresh) {
      return Response.json(cachedFresh.payload, { status: 200, headers: { "x-rainbow-cache": "hit" } });
    }

    // Guards run only on a cache miss — hits never touch a counter or upstream.
    // An expired row still serves as a stale fallback when a guard trips
    // ("cache-if-any else empty forecast", always a 200 → PKJS clears to zeros).
    const staleFallback = cached ? cached.payload : EMPTY_FORECAST;

    const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
    const ipCap = envInt(deps.env("RAINBOW_IP_HOURLY_CAP"), DEFAULT_IP_HOURLY_CAP);
    const ipCalls = await deps.store.incrementIpUsage(utcHourKey(ip, now));
    if (ipCalls > ipCap) {
      return Response.json(staleFallback, { status: 200, headers: { "x-rainbow-cache": "ip-capped" } });
    }

    const budget = envInt(deps.env("RAINBOW_MONTHLY_BUDGET"), DEFAULT_MONTHLY_BUDGET);
    const used = await deps.store.getMonthlyUsage(utcMonth(now));
    if (used >= budget) {
      return Response.json(staleFallback, { status: 200, headers: { "x-rainbow-cache": "budget-capped" } });
    }

    // Rainbow's global path order is /{lon}/{lat} — the echo check below guards
    // against a transposition regression here.
    const upstreamUrl = `${RAINBOW_BASE}/${lon}/${lat}?start_timestamp=${start}`;
    let upstream: Response;
    try {
      // Count the attempt BEFORE the call (wallet-conservative: failures burn
      // budget too, so an error storm cannot hammer upstream for free).
      await deps.store.incrementMonthlyUsage(utcMonth(now));
      upstream = await deps.fetchFn(upstreamUrl, {
        headers: { "Ocp-Apim-Subscription-Key": apiKey },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (_error) {
      return Response.json({ error: "upstream_unreachable" }, { status: 504 });
    }

    if (upstream.status === 404) {
      // Out of coverage: cache the clean clear so uncovered locations don't
      // re-hammer upstream (matches DWD's out-of-coverage → zeros semantics).
      await deps.store.setCache(key, EMPTY_FORECAST, new Date(now.getTime() + CACHE_TTL_MS).toISOString());
      return Response.json(EMPTY_FORECAST, { status: 200 });
    }
    if (!upstream.ok) {
      // 401 (bad key) / 5xx: error through, do NOT cache — the PKJS module's
      // callback(null) preserves the watch's existing radar.
      return Response.json({ error: "upstream_status_" + upstream.status }, { status: 502 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = await upstream.json();
    } catch (_error) {
      return Response.json({ error: "upstream_invalid_json" }, { status: 502 });
    }

    const echoLat = payload.latitude;
    const echoLon = payload.longitude;
    if (
      typeof echoLat !== "number" || typeof echoLon !== "number" ||
      Math.abs(echoLat - lat) > ECHO_TOLERANCE_DEG ||
      Math.abs(echoLon - lon) > ECHO_TOLERANCE_DEG
    ) {
      return Response.json({ error: "upstream_echo_mismatch" }, { status: 502 });
    }

    await deps.store.setCache(key, payload, new Date(now.getTime() + CACHE_TTL_MS).toISOString());
    return Response.json(payload, { status: 200, headers: { "x-rainbow-cache": "miss" } });
  };
}
