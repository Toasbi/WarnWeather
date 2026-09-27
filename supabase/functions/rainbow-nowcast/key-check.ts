// Key-check mode of the rainbow-nowcast edge function (the '<function>/key-check' path, see
// router.ts): the settings page's "Test" button for the Rainbow (own key) radar source. The
// webview can never call api.rainbow.ai itself (it answers any request carrying an Origin
// header with an empty 200), so the page POSTs the user's key here and this function makes
// ONE upstream call with it at a fixed point.
//
// Independent of handler.ts on purpose: no DB, no cache, no shared wallet, no logging, and
// nothing imported from the nowcast handler (not even types). body.ts is shared request
// parsing (the capped body reader) and upstream.ts the Rainbow API base both callers use;
// neither is the handler.
import { z } from "zod";
import { readCapped } from "./body.ts";
import { RAINBOW_BASE } from "./upstream.ts";

// A fixed, always-covered point (Berlin), so the check exercises auth, never coverage.
export const TEST_LON = 13.405;
export const TEST_LAT = 52.52;
// Under the settings page XHR's 8 s, so the page sees a real 504 instead of its own timeout.
export const KEY_CHECK_TIMEOUT_MS = 5000;
export const MAX_BODY_BYTES = 1024;
// DB-free per-IP limiter (per isolate, so best effort): enough for a person tapping Test,
// not for a script using the project's egress to probe keys. Every POST still costs an
// edge invocation; this protects upstream (and the shared radar's standing with Rainbow's
// edge), not the invocation count. An accepted risk; DEV.md says what to do on abuse.
export const KEY_CHECKS_PER_IP_PER_MIN = 5;
export const KEY_CHECK_WINDOW_MS = 60_000;
// The settings page runs from a data: URL (opaque origin), so browser CORS applies.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};
// An APIM subscription key's shape (Azure APIM generates 32 hex characters; the range and
// '_'/'-' leave slack for custom keys). Junk never reaches upstream, and CR/LF or spaces can
// never reach an upstream header. The shape is a guess, not Rainbow's spec: if a real Rainbow
// key ever fails this check (Test then says it doesn't look like a Rainbow key), loosen the
// regex.
const bodySchema = z.object({ key: z.string().trim().regex(/^[A-Za-z0-9_-]{16,128}$/) });

export interface KeyCheckDeps {
  fetchFn: typeof fetch;
  now?: () => number;   // epoch ms; Date.now by default (tests inject a clock)
}   // no store field: no DB access, by type

/**
 * A JSON response carrying the CORS headers (every key-check answer does, errors included,
 * so the page can read the status instead of seeing an opaque network error).
 * @param body Response body, serialised as JSON.
 * @param status HTTP status.
 * @returns The response.
 */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
  });
}

/**
 * POST {"key": "..."} (sent as text/plain by the page: no preflight) -> one upstream call with
 * that key -> HTTP 200 {"status": <upstream status>}. Proxy-side problems keep their own HTTP
 * status (400 invalid key/payload, 413 too large, 429 per-IP limit, 504 upstream unreachable),
 * so a gateway or proxy error can never read as a key verdict. No DB, no cache, no shared
 * wallet, no logging, and the key is never echoed.
 * @param deps Upstream fetch and an optional clock (epoch ms).
 * @returns The request handler.
 */
export function createKeyCheckHandler(deps: KeyCheckDeps) {
  const now = deps.now ?? Date.now;
  // Per handler instance (= per isolate in production; fresh per test).
  const hits = new Map<string, { n: number; windowStart: number }>();

  /** Count this POST against its IP; true when over the limit. Prunes expired windows first. */
  function overLimit(ip: string, nowMs: number): boolean {
    for (const [k, v] of hits) if (nowMs - v.windowStart >= KEY_CHECK_WINDOW_MS) hits.delete(k);
    const entry = hits.get(ip);
    if (!entry) { hits.set(ip, { n: 1, windowStart: nowMs }); return false; }
    entry.n += 1;
    return entry.n > KEY_CHECKS_PER_IP_PER_MIN;
  }

  return async function keyCheck(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    // Same client-IP read as handler.ts's per-IP cap.
    const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
    if (overLimit(ip, now())) return json({ error: "rate_limited" }, 429);
    // Fast path: a declared oversize body is refused unread. readCapped enforces the cap
    // for real (no, or a lying, Content-Length).
    if (parseInt(req.headers.get("content-length") || "0", 10) > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }
    let raw: string | null;
    try { raw = await readCapped(req, MAX_BODY_BYTES); } catch { return json({ error: "invalid_payload" }, 400); }
    if (raw === null) return json({ error: "payload_too_large" }, 413);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return json({ error: "invalid_payload" }, 400); }
    const body = bodySchema.safeParse(parsed);
    if (!body.success) return json({ error: "invalid_key" }, 400);
    let upstream: Response;
    try {
      // No start_timestamp: Rainbow then uses "now" — the check is about auth, not frames.
      // Deno's server-side fetch sends no Origin header, so Rainbow's empty-200 neutering of
      // Origin-carrying requests doesn't apply (the live nowcast proxy relies on the same).
      upstream = await deps.fetchFn(`${RAINBOW_BASE}/${TEST_LON}/${TEST_LAT}`, {
        headers: { "Ocp-Apim-Subscription-Key": body.data.key },
        signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
      });
    } catch {
      return json({ error: "upstream_unreachable" }, 504);
    }
    try { await upstream.body?.cancel(); } catch { /* already closed */ }
    return json({ status: upstream.status }, 200);
  };
}
