import { assert, assertEquals } from "@std/assert";
import { batchEventSchema, durationMsSchema, telemetryPayloadSchema } from "./index.ts";

// Importing index.ts runs its top-level Deno.serve, which binds a port at load —
// hence `deno test --allow-net` (same as news's suite).

const EVENT = {
  t: 1_760_000_000_000,
  provider: "dwd",
  success: true,
  error: null,
  countryCode: "DEU",
};

const LEGACY = {
  eventType: "weather_fetch",
  accountToken: "a".repeat(32),
  provider: "dwd",
  success: true,
  error: null,
  countryCode: "DEU",
  appVersion: "1.15.0",
  buildProfile: "release",
};

/** durationMs after a batch-event parse; throws when the event is rejected. */
function batchDuration(durationMs: unknown): unknown {
  const parsed = batchEventSchema.safeParse({ ...EVENT, durationMs });
  assert(parsed.success, "event rejected for durationMs=" + String(durationMs));
  return parsed.data.durationMs ?? null;
}

Deno.test("durationMs in the int4 range passes through unchanged", () => {
  assertEquals(batchDuration(0), 0);
  assertEquals(batchDuration(1500), 1500);
  assertEquals(batchDuration(2147483647), 2147483647, "int4 max still inserts");
});

Deno.test("a clock-step durationMs is nulled, not rejected (it must never 400 or 500 the batch)", () => {
  // Forward step past int4 (phone booted at its build-time floor, then synced
  // network time mid-fetch): used to pass zod and 500 the insert on the int4
  // column — retried hourly, wedging the queue head for 72 h.
  assertEquals(batchDuration(1_700_000_000_000), null);
  assertEquals(batchDuration(2147483648), null, "one past int4 max");
  // Backward step: used to 400 the whole batch, dropping its good neighbours.
  assertEquals(batchDuration(-8000), null);
  assertEquals(batchDuration(1.5), null, "a fraction is not a whole-ms duration");
  assertEquals(batchDuration(null), null);
  assertEquals(batchDuration(undefined), null);
});

Deno.test("the legacy single-event shape nulls an out-of-range durationMs too", () => {
  for (const bad of [-1, 1_700_000_000_000]) {
    const parsed = telemetryPayloadSchema.safeParse({ ...LEGACY, durationMs: bad });
    assert(parsed.success, "legacy payload rejected for durationMs=" + bad);
    assertEquals(parsed.data.durationMs ?? null, null);
  }
  const ok = telemetryPayloadSchema.safeParse({ ...LEGACY, durationMs: 2300 });
  assert(ok.success);
  assertEquals(ok.data.durationMs, 2300);
});

Deno.test("durationMsSchema still rejects a non-number (a type error is not a soft value)", () => {
  assert(!durationMsSchema.safeParse("1500").success);
});
