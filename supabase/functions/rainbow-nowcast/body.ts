// Request parsing for the rainbow-nowcast function: the capped body reader (shared with
// key-check.ts) and the nowcast request itself, as a POST body (current phones) or as the
// legacy GET query (app versions from 1.7.0 until the POST shipped — remove the GET path once
// telemetry shows none of them).
//
// Coordinates are rounded to 3 decimals (~110 m, the cache's precision) before anything else
// sees them, so neither the cache key nor the upstream URL carries more than that. Phones from
// this release on send them rounded already; the server rounds again (idempotent) because the
// legacy GET sends full precision.
import { z } from "zod";

/** Byte cap for a nowcast POST body: {"lat":..,"lon":..,"start":..} is ~60 bytes. */
export const NOWCAST_MAX_BODY_BYTES = 512;

/**
 * The request body as text, read chunk by chunk and abandoned as soon as it passes `max`
 * bytes. A body with no Content-Length (chunked), or a non-numeric or negative one, gets
 * past a header pre-check; req.text() would then buffer all of it before any size check,
 * and one large upload could take down the worker (and the nowcast requests in flight on it).
 * @param req The request.
 * @param max Byte cap.
 * @returns The decoded body ("" when there is none), or null when it is over the cap (the
 *   stream is cancelled, not drained).
 */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

/**
 * Round a coordinate to 3 decimals, the one algorithm the phone (src/pkjs/weather/coords.js)
 * uses too, so an old GET and a new POST from the same fix share a cache row. -0 comes back
 * as 0 (so it can never format as "-0.000").
 * @param x Decimal degrees.
 * @returns x rounded to 3 decimals.
 */
export function roundCoord(x: number): number {
  const r = Math.round(x * 1000) / 1000;
  return r === 0 ? 0 : r;
}

// A decimal number as text: '52.5170365', '+52.52', '-.5', '13.', '1e-7'. Deliberately
// narrower than z.coerce.number(), which reads '', ' ', null, false and [] as 0, a valid
// (0, 0) request that would be cached and answered as "no rain".
const DECIMAL_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const INTEGER_TEXT = /^[-+]?\d+$/;

/** A finite number, or decimal text (a manual location's coordinates are strings). */
const decimal = z.union([
  z.number(),
  z.string().trim().regex(DECIMAL_TEXT).transform(Number),
]).pipe(z.number().finite());

/** An integer, or integer text (the legacy query's start). */
const integer = z.union([
  z.number().int(),
  z.string().trim().regex(INTEGER_TEXT).transform(Number),
]).pipe(z.number().int());

const requestSchema = z.object({
  lat: decimal.transform(roundCoord).pipe(z.number().min(-90).max(90)),
  lon: decimal.transform(roundCoord).pipe(z.number().min(-180).max(180)),
  // null, like absent: normalizeStart falls back to the current 5-min bucket.
  start: integer.nullish().transform((v) => v ?? undefined),
});

/** A validated nowcast request: coordinates already rounded to 3 decimals. */
export interface NowcastRequest {
  lat: number;
  lon: number;
  start?: number;
}

/**
 * Validate a nowcast request's fields (from either transport).
 * @param input The raw {lat, lon, start}.
 * @returns The request with rounded coordinates, or null when it is not a valid request.
 */
function parseFields(input: unknown): NowcastRequest | null {
  const parsed = requestSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/**
 * The legacy GET query (?lat&lon&start). An empty parameter counts as missing.
 * @param url The request URL.
 * @returns The request, or null when invalid.
 */
export function parseNowcastQuery(url: URL): NowcastRequest | null {
  const qp = (name: string) => {
    const v = url.searchParams.get(name);
    return v === null || v === "" ? undefined : v;
  };
  return parseFields({ lat: qp("lat"), lon: qp("lon"), start: qp("start") });
}

/**
 * A POST body: the JSON object {"lat", "lon", "start"}. Read whatever the Content-Type says
 * (the phone sends it as text/plain, a CORS simple request).
 * @param raw The body text.
 * @returns The request, or null when it is not JSON or not a valid request.
 */
export function parseNowcastBody(raw: string): NowcastRequest | null {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return null; }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  return parseFields(json);
}
