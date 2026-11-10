import { assert, assertEquals } from "@std/assert";
import { batchEventSchema, batchPayloadSchema, durationMsSchema } from "./handler.ts";

// The request schemas on their own; handler_test.ts drives whole requests.

const EVENT = {
  t: 1_760_000_000_000,
  provider: "dwd",
  success: true,
  error: null,
  countryCode: "DEU",
};

const BATCH = {
  eventType: "weather_fetch_batch",
  accountToken: "a".repeat(32),
  appVersion: "2.6.1",
  buildProfile: "release",
  events: [EVENT],
};

/** durationMs after a batch-event parse; throws when the event is rejected. */
function batchDuration(durationMs: unknown): unknown {
  const parsed = batchEventSchema.safeParse({ ...EVENT, durationMs });
  assert(parsed.success, "event rejected for durationMs=" + String(durationMs));
  return parsed.data.durationMs ?? null;
}

/**
 * A settings header through the batch schema, as the ingest stores it.
 * @param settings The header as posted.
 * @returns The stored settings, or null when the header fails the whole batch.
 */
function storedSettings(settings: unknown): Record<string, unknown> | null {
  const parsed = batchPayloadSchema.safeParse({ ...BATCH, settings });
  return parsed.success ? parsed.data.settings as Record<string, unknown> : null;
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

Deno.test("durationMsSchema still rejects a non-number (a type error is not a soft value)", () => {
  assert(!durationMsSchema.safeParse("1500").success);
});

// Regression pin, not coverage: radarProvider is z.string().optional(), so this passes by
// construction. It fails only if someone narrows the field to an enum and forgets the
// Rainbow (own key) source id, or 'disabled', the Off the apps before 1.10 sent and the
// apps after 2.6.1 send again. Either would 400 every batch from such an install.
Deno.test("a rainbowkey or disabled radarProvider is accepted and kept", () => {
  assertEquals(storedSettings({ radarProvider: "rainbowkey" }), { radarProvider: "rainbowkey" });
  assertEquals(storedSettings({ radarProvider: "disabled" }), { radarProvider: "disabled" });
});

// App 2.6.0 and 2.6.1 keep the radar's source apart from its Off switch (radarEnabled),
// which is no field here: the fold keeps the Off the strip step would drop.
Deno.test("radarEnabled false is stored as radarProvider 'disabled'; radarEnabled itself never is", () => {
  assertEquals(storedSettings({ radarProvider: "dwd", radarEnabled: false }), { radarProvider: "disabled" });
  assertEquals(storedSettings({ radarEnabled: false }), { radarProvider: "disabled" });
  assertEquals(storedSettings({ radarProvider: "dwd", radarEnabled: true }), { radarProvider: "dwd" });
  // Only a real false is Off: the switch is on by default, as the phone reads it.
  assertEquals(storedSettings({ radarProvider: "dwd", radarEnabled: "false" }), { radarProvider: "dwd" });
});

// The On demand fields (1.24.0) survive the strip step; the level refuses a value no
// watch sends. The code has no length bound (like alerts and warnLooks): a longer one,
// from a build with an item this ingest does not know, is kept, not a 400.
Deno.test("onDemand, batteryLowLevel and batteryLowDisplay are accepted and kept", () => {
  const onDemand = "RLLLLRRR-R" + "-".repeat(30);
  assertEquals(storedSettings({ onDemand, batteryLowLevel: 25, batteryLowDisplay: "value" }),
    { onDemand, batteryLowLevel: 25, batteryLowDisplay: "value" });
  const longer = onDemand + "-".repeat(4);
  assertEquals(storedSettings({ onDemand: longer }), { onDemand: longer });
  for (const settings of [{ batteryLowLevel: 101 }, { batteryLowLevel: 12.5 }]) {
    assertEquals(storedSettings(settings), null, JSON.stringify(settings));
  }
});

// The Weather tab fields: a toggle, an age in whole days and a count of saved places. The
// count has no max, so a page that saves more places is no 400; what no phone sends is.
Deno.test("the Weather tab fields are accepted and kept", () => {
  const tab = { startOnWeatherTab: true, weatherTabSeenDays: 0, weatherTabPlaces: 3 };
  assertEquals(storedSettings(tab), tab);
  assertEquals(storedSettings({ weatherTabSeenDays: 400, weatherTabPlaces: 5 }),
    { weatherTabSeenDays: 400, weatherTabPlaces: 5 });
  for (const settings of [{ weatherTabSeenDays: -1 }, { weatherTabSeenDays: 1.5 },
    { weatherTabPlaces: -1 }, { startOnWeatherTab: "true" }]) {
    assertEquals(storedSettings(settings), null, JSON.stringify(settings));
  }
});

// The settings this schema dropped (each read the same on every 2.6 watch, and provider
// repeats the event's own) are still sent by the apps in the field. The strip step drops
// them, so those apps keep posting whichever of them and this function deploys first.
Deno.test("a retired setting an older app still sends is dropped, never a 400", () => {
  const retired = {
    tempSlotSeparator: "brackets", tempSlotSeparatorSpaced: true, tempSlotOrder: "feels",
    uvSlotSeparator: "custom", uvSlotSeparatorSpaced: false, uvSlotOrder: "max",
    uvSlotNextDayMark: "star", aqiSlotDisplay: "both", windSlotDirection: true,
    pressureSlotUnit: true, countdownSlotUnit: true, dewSlotUnit: false, configTheme: "dark",
    provider: "dwd", precipLineFrom: "top", cloudLineFrom: "bottom", windLineFrom: "top",
    uvLineFrom: "bottom", rainBarFrom: "top", radarBarFrom: "bottom", radarEnabled: true,
  };
  assertEquals(storedSettings({ ...retired, theme: "dark" }), { theme: "dark" });
});
