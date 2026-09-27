import { assert, assertEquals, assertMatch, assertNotEquals, assertThrows } from "@std/assert";
import { createKeys, IP_MAC_HEX_CHARS, resolvePepper } from "./keys.ts";

const H12 = new Date("2026-07-06T12:34:56Z");
const H13 = new Date("2026-07-06T13:00:01Z");

Deno.test("cacheKey: 64 hex, deterministic, rounding-canonical, and no coordinate in it", async () => {
  const k = createKeys("pepper-a");
  const key = await k.cacheKey(52.517, 13.389, 1783339200);
  assertMatch(key, /^[0-9a-f]{64}$/);
  assertEquals(await k.cacheKey(52.517, 13.389, 1783339200), key);
  assertEquals(await k.cacheKey(52.5170365, 13.3888599, 1783339200), key, "rounded again inside");
  assertEquals(await createKeys("pepper-a").cacheKey(52.517, 13.389, 1783339200), key, "same pepper, same key");
  assertNotEquals(await k.cacheKey(52.517, 13.389, 1783339500), key, "another 5-min start");
  assertNotEquals(await k.cacheKey(52.518, 13.389, 1783339200), key, "another place");
  assertNotEquals(await createKeys("pepper-b").cacheKey(52.517, 13.389, 1783339200), key, "keyed: another pepper");
  assertEquals(await k.cacheKey(-0.0004, 0, 60), await k.cacheKey(0, 0, 60), "-0 and 0 are one place");
  for (const leak of ["52.517", "13.389", "1783339200"]) assert(!key.includes(leak));
});

Deno.test("ipHourKey: '<32 hex>:<YYYY-MM-DDTHH>', a new pseudonym every hour, no IP in it", async () => {
  const k = createKeys("pepper-a");
  const a12 = await k.ipHourKey("203.0.113.9", H12);
  const a13 = await k.ipHourKey("203.0.113.9", H13);
  assertEquals(a12.length, IP_MAC_HEX_CHARS + 1 + 13);
  assertMatch(a12, /^[0-9a-f]{32}:2026-07-06T12$/);
  assertMatch(a13, /^[0-9a-f]{32}:2026-07-06T13$/);
  assertNotEquals(a12.slice(0, 32), a13.slice(0, 32), "the hour is inside the MAC: no hour-by-hour profile");
  assertEquals(await k.ipHourKey("203.0.113.9", new Date("2026-07-06T12:00:00Z")), a12, "one bucket per hour");
  assertNotEquals(await k.ipHourKey("203.0.113.10", H12), a12);
  const v6 = await k.ipHourKey("2001:db8::1", H12);
  assertMatch(v6, /^[0-9a-f]{32}:2026-07-06T12$/, "an IPv6 address leaves no colon of its own");
  assert(!a12.includes("203.0.113"));
});

Deno.test("the cache and IP keys come from separate subkeys", async () => {
  const k = createKeys("pepper-a");
  // Same MAC input shape can't collide across purposes: compare the raw prefixes.
  const cache = await k.cacheKey(1, 2, 3);
  const ip = await k.ipHourKey("1.000|2.000|3", H12);
  assertNotEquals(cache.slice(0, 32), ip.slice(0, 32));
});

/**
 * What telemetry-ingest and news store for a caller-chosen token: hex HMAC-SHA-256(secret, token)
 * (their hmacSha256Hex). Anyone can POST a token, so this is an oracle over the secret.
 * @param secret The secret.
 * @param token The caller-chosen token.
 * @returns 64 hex characters.
 */
async function storedTokenHash(secret: string, token: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(token)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hex MAC of a message under a key given as hex bytes (an attacker replaying a stored hash as a key).
 * @param keyHex The key bytes, in hex.
 * @param message The message.
 * @returns 64 hex characters.
 */
async function macUnderHexKey(keyHex: string, message: string): Promise<string> {
  const raw = new Uint8Array(keyHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("a secret shared with telemetry leaks no subkey: HMAC(pepper, label) is not the subkey", async () => {
  // One anonymous telemetry POST with accountToken "rainbow-ip/v1" stores HMAC(secret, label) in
  // hex. If that were the IP subkey, whoever reads the telemetry tables could recompute every
  // IP bucket without the secret. The root is SHA-256 of a labelled pepper, not the pepper.
  for (const pepper of ["pepper-a", "x".repeat(100)]) { // > 64 bytes: HMAC hashes such a key itself
    const k = createKeys(pepper);
    const bucket = await k.ipHourKey("203.0.113.9", H12);
    const hour = bucket.slice(IP_MAC_HEX_CHARS + 1);
    const ipOracle = await storedTokenHash(pepper, "rainbow-ip/v1");
    assertNotEquals(
      (await macUnderHexKey(ipOracle, "203.0.113.9|" + hour)).slice(0, IP_MAC_HEX_CHARS),
      bucket.slice(0, IP_MAC_HEX_CHARS),
    );
    const cacheOracle = await storedTokenHash(pepper, "rainbow-cache/v1");
    assertNotEquals(
      await macUnderHexKey(cacheOracle, "52.517|13.389|1783339200"),
      await k.cacheKey(52.517, 13.389, 1783339200),
    );
  }
});

Deno.test("resolvePepper: RAINBOW_IP_HASH_KEY, else the service-role key; blank counts as unset; never the telemetry secret", () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];
  assertEquals(resolvePepper(env({ RAINBOW_IP_HASH_KEY: "r", TELEMETRY_HASH_SECRET: "t", SUPABASE_SERVICE_ROLE_KEY: "s" })), "r");
  assertEquals(resolvePepper(env({ RAINBOW_IP_HASH_KEY: "", TELEMETRY_HASH_SECRET: "t", SUPABASE_SERVICE_ROLE_KEY: "s" })), "s");
  assertEquals(resolvePepper(env({ TELEMETRY_HASH_SECRET: "t", SUPABASE_SERVICE_ROLE_KEY: "s" })), "s");
  assertEquals(resolvePepper(env({ TELEMETRY_HASH_SECRET: "t" })), "", "the telemetry secret is an HMAC oracle: not a fallback");
  assertEquals(resolvePepper(env({})), "");
});

Deno.test("createKeys refuses an empty pepper (WebCrypto would refuse it on every request)", () => {
  assertThrows(() => createKeys(""));
});
