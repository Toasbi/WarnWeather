// Request routing for the rainbow-nowcast function, and its last line of defence: nothing a
// handler throws reaches the Deno runtime (which would log the error's message and stack).
import { CORS_HEADERS } from "./key-check.ts";
import { logCaught } from "./log.ts";

/** The last non-empty path segment: 'key-check' for '/rainbow-nowcast/key-check/'. */
function lastSegment(pathname: string): string {
  const parts = pathname.split("/").filter((p) => p !== "");
  return parts.length ? parts[parts.length - 1] : "";
}

/**
 * Route by path, then method:
 * - '<function>/key-check' -> the settings page's Rainbow key Test (key-check.ts: POST, and
 *   OPTIONS for a preflight; anything else 405 there).
 * - the function root -> the nowcast (handler.ts): POST {lat, lon, start}, and the legacy
 *   GET ?lat&lon&start of older app versions. OPTIONS is answered 204 here: the phone sends a
 *   CORS simple request (text/plain), so it never needs one, and nothing is granted to a
 *   browser page (no Access-Control-Allow-Origin on the nowcast). Other methods -> 405 there.
 * A throw from either handler is logged by tag and code only and answered 503, which the
 * phone treats as transient and keeps the watch's radar. A 404/405 would clear it and a 429
 * shows the limit notice, so never use those for a failure that can heal.
 * @param nowcast The nowcast handler (handler.ts createHandler).
 * @param keyCheck The key-check handler (key-check.ts createKeyCheckHandler).
 * @returns The handler Deno.serve gets.
 */
export function routeRequest(
  nowcast: (req: Request) => Promise<Response>,
  keyCheck: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    let isKeyCheck = false;
    try {
      isKeyCheck = lastSegment(new URL(req.url).pathname) === "key-check";
      if (isKeyCheck) return await keyCheck(req);
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
      }
      return await nowcast(req);
    } catch (error) {
      logCaught(error);
      // The key check's answers all carry CORS so the page can read them; this one too.
      return Response.json(
        { error: "unavailable" },
        { status: 503, headers: isKeyCheck ? { "cache-control": "no-store", ...CORS_HEADERS } : {} },
      );
    }
  };
}
