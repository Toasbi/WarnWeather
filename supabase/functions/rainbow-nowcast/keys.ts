// The stored keys of the nowcast proxy: the cache key and the per-IP hourly bucket. Both are
// keyed hashes (HMAC-SHA-256 under a server-side pepper), so the database holds no location
// and no client IP. A plain SHA-256 would not do: there are few enough 3-decimal points on
// Earth to brute-force one back to its place, and an IPv4 space to brute-force back to an IP.
//
// One pepper, two purposes: each gets its own subkey (HMAC(root, label)), so a cache key can
// never be matched against an IP key. The subkeys are derived once per isolate.
//
// The root is SHA-256(ROOT_LABEL + pepper), never the pepper itself. telemetry-ingest and news
// store hex HMAC(TELEMETRY_HASH_SECRET, token) for any token anyone POSTs, so a root of
// HMAC(pepper, ...) would let a caller have the subkeys written into the telemetry tables by
// posting the labels as tokens, should the pepper ever equal that secret. The label prefix also
// keeps the root apart from the SHA-256(pepper) HMAC uses for itself when a key exceeds 64 bytes.
import { roundCoord } from "./body.ts";

/** The proxy's two stored keys. */
export interface Keys {
  /**
   * The cache key of a request: 64 hex characters.
   * @param lat Latitude (rounded to 3 decimals again here, so the key is canonical).
   * @param lon Longitude (likewise).
   * @param start The normalized 5-min start epoch.
   */
  cacheKey(lat: number, lon: number, start: number): Promise<string>;
  /**
   * The per-IP UTC-hour bucket: '<32 hex>:<YYYY-MM-DDTHH>'. The hour is inside the MAC too,
   * so one IP gets a new pseudonym every hour; it stays readable after the last ':' because
   * the hourly prune (rainbow_prune, supabase/schemas/rainbow.sql) reads it there — keep that
   * suffix exactly.
   * @param ip The client IP as read from x-forwarded-for.
   * @param now The request time.
   */
  ipHourKey(ip: string, now: Date): Promise<string>;
}

/** Hex characters kept of the IP MAC: 128 bits, plenty for a bucket the prune keeps a day. */
export const IP_MAC_HEX_CHARS = 32;

const encoder = new TextEncoder();

/** Domain label hashed in front of the pepper to make the root key (see the header). */
const ROOT_LABEL = "rainbow-nowcast/root/v1\u0000";

/**
 * The hashing pepper: RAINBOW_IP_HASH_KEY, else SUPABASE_SERVICE_ROLE_KEY (always set for an
 * edge function). Never TELEMETRY_HASH_SECRET: telemetry and news turn it into an HMAC oracle
 * (see the header). A blank value counts as unset: WebCrypto refuses a zero-length HMAC key.
 * @param env Environment lookup.
 * @returns The pepper, or "" when neither is set.
 */
export function resolvePepper(env: (name: string) => string | undefined): string {
  return env("RAINBOW_IP_HASH_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || "";
}

/**
 * An HMAC-SHA-256 signing key over raw bytes.
 * @param raw Key material (non-empty).
 * @returns The CryptoKey.
 */
function importHmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/**
 * HMAC-SHA-256 of a text message.
 * @param key The signing key.
 * @param message The message (UTF-8 encoded).
 * @returns The 32-byte MAC.
 */
async function mac(key: CryptoKey, message: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/**
 * Lowercase hex of some bytes.
 * @param bytes The bytes.
 * @returns Their hex, two characters per byte.
 */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The key derivation for one pepper. The subkeys are imported on first use and cached.
 * @param pepper The secret (non-empty; see resolvePepper).
 * @returns The two key builders.
 */
export function createKeys(pepper: string): Keys {
  if (!pepper) throw new Error("rainbow-nowcast: no hashing pepper");
  let subkeys: Promise<{ ip: CryptoKey; cache: CryptoKey }> | null = null;
  const derive = () => {
    if (!subkeys) {
      subkeys = (async () => {
        const rootBytes = await crypto.subtle.digest("SHA-256", encoder.encode(ROOT_LABEL + pepper));
        const root = await importHmacKey(new Uint8Array(rootBytes));
        return {
          ip: await importHmacKey(await mac(root, "rainbow-ip/v1")),
          cache: await importHmacKey(await mac(root, "rainbow-cache/v1")),
        };
      })();
      // A failed derivation is not cached: the next request tries again.
      subkeys.catch(() => { subkeys = null; });
    }
    return subkeys;
  };
  return {
    async cacheKey(lat, lon, start) {
      const { cache } = await derive();
      return hex(await mac(cache, roundCoord(lat).toFixed(3) + "|" + roundCoord(lon).toFixed(3) + "|" + start));
    },
    async ipHourKey(ip, now) {
      const { ip: ipKey } = await derive();
      const hour = now.toISOString().slice(0, 13);
      return hex(await mac(ipKey, ip + "|" + hour)).slice(0, IP_MAC_HEX_CHARS) + ":" + hour;
    },
  };
}
