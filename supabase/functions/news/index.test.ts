import { assert, assertEquals } from "@std/assert";
import {
  accountTokenSchema,
  conformingToken,
  hmacSha256Hex,
  payloadSchema,
  versionSchema,
} from "./index.ts";

// A conforming 32-hex account token (today's Pebble format).
const HEX32 = "0123456789abcdef0123456789abcdef";

function accepts(payload: unknown): boolean {
  return payloadSchema.safeParse(payload).success;
}

// --- op routing ---

Deno.test("each op's valid payload is accepted", () => {
  assert(accepts({ op: "list", version: "1.8.0" }));
  assert(accepts({ op: "list", version: "1.8.0", accountToken: HEX32 }));
  assert(accepts({ op: "seen", accountToken: HEX32, maxSeenId: 5 }));
  assert(accepts({
    op: "reply",
    accountToken: HEX32,
    version: "1.8.0",
    newsId: 3,
    message: "hi",
  }));
  assert(accepts({ op: "vote", accountToken: HEX32, newsId: 3, choiceIndex: 0 }));
});

Deno.test("unknown op is rejected", () => {
  assert(!accepts({ op: "delete", accountToken: HEX32 }));
  assert(!accepts({ op: "", version: "1.8.0" }));
  assert(!accepts({ version: "1.8.0" }));
});

// --- version regex (feeds a PostgREST .or() filter) ---

Deno.test("version with PostgREST metacharacters is rejected", () => {
  assert(!versionSchema.safeParse("1.8.0,x").success); // comma
  assert(!versionSchema.safeParse("1.8.0(x").success); // open paren
  assert(!versionSchema.safeParse("1.8.0)").success); // close paren
  // and rejected via a full list payload too
  assert(!accepts({ op: "list", version: "1.8.0,target_version" }));
});

Deno.test("version regex accepts a full semver-ish string", () => {
  assert(versionSchema.safeParse("1.7.2-beta+1").success);
  assert(accepts({ op: "list", version: "1.7.2-beta+1" }));
});

// --- accountToken shape (strict on writes) ---

Deno.test("accountToken shape is enforced on seen/reply/vote writes", () => {
  // too short (< 8 chars)
  assert(!accepts({ op: "seen", accountToken: "short", maxSeenId: 5 }));
  // bad chars (space / punctuation)
  assert(!accepts({ op: "vote", accountToken: "bad token!", newsId: 3, choiceIndex: 0 }));
  assert(!accepts({
    op: "reply",
    accountToken: "!!!!!!!!",
    version: "1.8.0",
    newsId: 3,
    message: "hi",
  }));
  // 32-hex and preview-account-token accepted
  assert(accountTokenSchema.safeParse(HEX32).success);
  assert(accountTokenSchema.safeParse("preview-account-token").success);
  assert(accepts({ op: "seen", accountToken: "preview-account-token", maxSeenId: 5 }));
});

// --- reply message bounds ---

Deno.test("reply message: blank rejected, 1000 ok, 1001 rejected", () => {
  const base = { op: "reply", accountToken: HEX32, version: "1.8.0", newsId: 3 };
  assert(!accepts({ ...base, message: "" }));
  assert(!accepts({ ...base, message: "   " })); // trims to empty
  assert(accepts({ ...base, message: "x".repeat(1000) }));
  assert(!accepts({ ...base, message: "x".repeat(1001) }));
});

// --- vote choiceIndex bounds ---

Deno.test("vote choiceIndex: negative and non-integer rejected", () => {
  const base = { op: "vote", accountToken: HEX32, newsId: 3 };
  assert(!accepts({ ...base, choiceIndex: -1 }));
  assert(!accepts({ ...base, choiceIndex: 1.5 }));
  assert(accepts({ ...base, choiceIndex: 0 }));
});

// --- conformingToken (lenient reads) ---

Deno.test("conformingToken returns '' for junk, the token for conforming input", () => {
  assertEquals(conformingToken("!!!"), "");
  assertEquals(conformingToken("short"), "");
  assertEquals(conformingToken(""), "");
  assertEquals(conformingToken(null), "");
  assertEquals(conformingToken(42), "");
  assertEquals(conformingToken(HEX32), HEX32);
  assertEquals(conformingToken("  " + HEX32 + "  "), HEX32); // trims
  assertEquals(conformingToken("preview-account-token"), "preview-account-token");
});

// --- hmacSha256Hex (known vector) ---

Deno.test("hmacSha256Hex matches the RFC-style known vector", async () => {
  // HMAC-SHA256(key="key", message="message")
  assertEquals(
    await hmacSha256Hex("key", "message"),
    "6e9ef29b75fffc5b7abae527d58fdadb2fe42e7219011976917343065f58ed4a",
  );
});
