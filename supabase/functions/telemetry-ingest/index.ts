import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const MAX_BODY_BYTES = 4096;
// Batched shape (app >= 1.16): the phone queues slim per-fetch records and posts
// them as ONE request every ~12 h instead of one invocation per fetch — the cap
// covers 50 worst-case events (512 B errors) plus the shared settings header.
const MAX_BATCH_BODY_BYTES = 65536;
const MAX_BATCH_EVENTS = 50;
// How far back a batched event's client timestamp may claim to be: the phone
// drops events older than this before sending, so anything older here is clock
// skew or forgery — clamped, not rejected, like every other soft field.
const MAX_BATCH_EVENT_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_EVENTS_PER_HOUR = 60;

const providerSchema = z.enum([
  "wunderground",
  "openweathermap",
  "mock",
  "dwd",
  "openmeteo",
  "metno",
  "yandex",
  "tomorrowio",
]);
const locationModeSchema = z.enum(["gps", "manual_coordinates", "manual_address"]);

const firmwareSchema = z.object({
  major: z.number().int().nonnegative().optional(),
  minor: z.number().int().nonnegative().optional(),
  patch: z.number().int().nonnegative().optional(),
  suffix: z.string().optional(),
}).strip();

const watchInfoSchema = z.object({
  platform: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  firmware: firmwareSchema.optional(),
}).strip();

const settingsSchema = z
  .object({
    temperatureUnits: z.string().optional(),
    tempSlotDisplay: z.string().optional(),
    dateSlotMonthFormat: z.string().optional(),
    dateSlotFullFormat: z.string().optional(),
    aqiScale: z.enum(['european', 'us']).optional(),
    aqiSource: z.enum(['waqi', 'auto', 'openmeteo']).optional(),
    windUnits: z.string().optional(),
    distanceUnits: z.string().optional(),
    windSlotDirection: z.boolean().optional(),
    gustSlotDirection: z.boolean().optional(),
    windSlotUnit: z.boolean().optional(),
    gustSlotUnit: z.boolean().optional(),
    pressureSlotUnit: z.boolean().optional(),
    countdownSlotUnit: z.boolean().optional(),
    tempSlotUnit: z.boolean().optional(),
    dewSlotUnit: z.boolean().optional(),
    // Lockstep with buildSettingsSnapshot in src/pkjs/telemetry.js (a field missing
    // here is stripped and silently lost). z.string(), not z.enum: an old or migrated
    // blob can hold a bold mode this build's picker no longer offers, and a stricter
    // type would reject the whole event over one cosmetic setting.
    threshPhoneBatteryBoldMode: z.string().optional(),
    configTheme: z.enum(['auto', 'light', 'dark']).optional(),
    dayNightShading: z.boolean().optional(),
    healthMode: z.enum(['off', 'status', 'all', 'slot']).optional(),
    provider: providerSchema.optional(),
    fetchIntervalMin: z.number().int().positive().optional(),
    rainCountdownHorizon: z.number().int().min(0).optional(),
    sleepStartHour: z.number().int().min(0).max(23).optional(),
    sleepEndHour: z.number().int().min(0).max(23).optional(),
    axisTimeFormat: z.string().optional(),
    timeFont: z.string().optional(),
    timeLeadingZero: z.boolean().optional(),
    timeShowAmPm: z.boolean().optional(),
    weekStartDay: z.string().optional(),
    firstWeek: z.string().optional(),
    showQt: z.boolean().optional(),
    batteryLowOnly: z.boolean().optional(),
    topViewMode: z.enum(['full', 'compact', 'none']).optional(),
    layoutPreset: z.enum(['classic', 'radarLast', 'forecast', 'fullCal', 'healthFirst', 'compactCal', 'compactDense', 'noCal', 'custom']).optional(),
    // Custom-layout usage: the three packed per-view wire values (uint16; elements,
    // seats, order, clock/top-bar omissions). Present only while layoutPreset is
    // 'custom'. DEPLOY-ORDERING: this function must ship BEFORE the app release
    // that sends them, or the schema's strip step silently drops the fields.
    customView0: z.number().int().min(0).max(0xFFFF).optional(),
    customView1: z.number().int().min(0).max(0xFFFF).optional(),
    customView2: z.number().int().min(0).max(0xFFFF).optional(),
    viewResetMin: z.number().int().min(0).optional(),
    largeGraphFont: z.boolean().optional(),
    vibe: z.boolean().optional(),
    btIcons: z.string().optional(),
    secondaryLine: z.string().optional(),
    secondaryLineFill: z.boolean().optional(),
    windScale: z.string().optional(),
    pressureScale: z.string().optional(),
    thirdLine: z.string().optional(),
    barSource: z.string().optional(),
    rainBarColor: z.string().optional(),
    radarProvider: z.string().optional(),
    radarMode: z.enum(['off', 'countdown', 'status', 'graph']).optional(),
    radarColor: z.string().optional(),
    devStatsEnabled: z.boolean().optional(),
    theme: z.string().optional(),
    statusForecastLeft: z.string().optional(),
    statusForecastMid: z.string().optional(),
    statusForecastRight: z.string().optional(),
    statusRadarLeft: z.string().optional(),
    statusRadarMid: z.string().optional(),
    statusRadarRight: z.string().optional(),
    statusTopLeft: z.string().optional(),
    statusTopMid: z.string().optional(),
    statusTopRight: z.string().optional(),
    statusHealthLeft: z.string().optional(),
    statusHealthMid: z.string().optional(),
    statusHealthRight: z.string().optional(),
    colorTime: z.number().optional(),
    colorToday: z.number().optional(),
    colorSunday: z.number().optional(),
    colorSaturday: z.number().optional(),
    colorUSFederal: z.number().optional(),
    // The six graph colours, one per painted ELEMENT of the graph, already resolved
    // phone-side to the polarity the watch renders. The colours are stored per METRIC on
    // the phone; which metric each of these belongs to is the secondaryLine / thirdLine in
    // the same snapshot. z.string(), NOT z.number() like the colorTime family above: the
    // watch sends '#RRGGBB' for a colour the user moved and the literal 'default' while it
    // is still the built-in, so a number-typed field would fail safeParse on essentially
    // every event and 400 the WHOLE payload — the fetch outcome with it, and nothing
    // retries a 400. And not a z.enum of the 64 Pebble swatches either: a stricter type
    // would reject an entire event over one cosmetic setting. Lockstep with
    // buildSettingsSnapshot in src/pkjs/telemetry.js — a field missing here is stripped and
    // silently lost.
    graphMainColor: z.string().optional(),
    graphFillColor: z.string().optional(),
    graphSecondColor: z.string().optional(),
    nightHatchColor: z.string().optional(),
    nightBoundaryColor: z.string().optional(),
    nightFillColor: z.string().optional(),
  })
  .strip();

const telemetryPayloadSchema = z.object({
  eventType: z.literal("weather_fetch"),
  accountToken: z.string().trim().min(1, {
    message: "invalid_account_token",
  }),
  watchToken: z.string().nullable().optional(),
  provider: providerSchema,
  success: z.boolean(),
  error: z.string().trim().min(1).max(512).nullable(),
  countryCode: z.string().nullable(),
  settings: settingsSchema.default({}),
  appVersion: z.string().trim().min(1, { message: "invalid_app_version" }),
  buildProfile: z.string().trim().min(1, {
    message: "invalid_build_profile",
  }),
  watchInfo: watchInfoSchema.default({}),
  usedGpsCache: z.boolean().default(false),
  gpsErrorCode: z.number().int().nonnegative().nullable().optional(),
  locationMode: locationModeSchema.nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  attempt: z.number().int().positive().nullable().optional(),
}).superRefine((payload, ctx) => {
  if (payload.success && payload.error !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "error_must_be_null_on_success",
      path: ["error"],
    });
  }

  if (!payload.success && payload.error === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "error_required_on_failure",
      path: ["error"],
    });
  }
});

type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;

// One slim record of a batch — the per-event half of the legacy payload, with a
// client timestamp `t` (epoch ms) standing in for the server-side received_at.
// The success/error contract is per event, exactly as on the legacy shape.
const batchEventSchema = z.object({
  t: z.number().int().positive(),
  provider: providerSchema,
  success: z.boolean(),
  error: z.string().trim().min(1).max(512).nullable(),
  countryCode: z.string().nullable(),
  usedGpsCache: z.boolean().default(false),
  gpsErrorCode: z.number().int().nonnegative().nullable().optional(),
  locationMode: locationModeSchema.nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  attempt: z.number().int().positive().nullable().optional(),
}).superRefine((ev, ctx) => {
  if (ev.success && ev.error !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "error_must_be_null_on_success",
      path: ["error"],
    });
  }
  if (!ev.success && ev.error === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "error_required_on_failure",
      path: ["error"],
    });
  }
});

// The batch envelope: tokens/version/watchInfo/settings once (the rollup only
// ever reads the NEWEST settings per watch, so per-event snapshots bought
// nothing), then up to MAX_BATCH_EVENTS slim records. settingsSchema is the
// SAME object the legacy shape uses — the telemetry.js lockstep test keys off
// it, so the two shapes cannot drift apart.
const batchPayloadSchema = z.object({
  eventType: z.literal("weather_fetch_batch"),
  accountToken: z.string().trim().min(1, {
    message: "invalid_account_token",
  }),
  watchToken: z.string().nullable().optional(),
  appVersion: z.string().trim().min(1, { message: "invalid_app_version" }),
  buildProfile: z.string().trim().min(1, {
    message: "invalid_build_profile",
  }),
  watchInfo: watchInfoSchema.default({}),
  settings: settingsSchema.default({}),
  events: z.array(batchEventSchema).min(1).max(MAX_BATCH_EVENTS),
});

type BatchPayload = z.infer<typeof batchPayloadSchema>;

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encodeUtf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encodeUtf8(message));
  const bytes = new Uint8Array(signature);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  // Outer cap is the batch bound; the tighter legacy bound is re-checked after
  // the shape is known (a cap that tight would reject every batch, and the
  // shape is only knowable after parsing).
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BATCH_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  const rawBody = await req.text();
  const rawBytes = encodeUtf8(rawBody).length;
  if (rawBytes > MAX_BATCH_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (_error) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const isBatch = typeof parsed === "object" && parsed !== null &&
    (parsed as { eventType?: unknown }).eventType === "weather_fetch_batch";

  // Both shapes normalize to the same insert rows; received_at is explicit on
  // every row (the legacy path's value matches the column default it used to
  // rely on).
  let accountToken: string;
  let watchToken: string | null | undefined;
  let rows: Record<string, unknown>[];

  if (isBatch) {
    const batchResult = batchPayloadSchema.safeParse(parsed);
    if (!batchResult.success) {
      return Response.json({
        error: "invalid_payload",
        detail: batchResult.error.issues[0]?.message || "invalid_payload",
      }, { status: 400 });
    }
    const batch: BatchPayload = batchResult.data;
    // The header is duplicated into EVERY row of the batch, so its size is a
    // 50x write amplifier: the legacy shape bounded settings via its 4096 B
    // whole-payload cap, and a batch keeps the same per-field bound — a legit
    // snapshot measures ~2.5 KB.
    if (JSON.stringify(batch.settings).length > MAX_BODY_BYTES ||
      JSON.stringify(batch.watchInfo).length > 1024) {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    accountToken = batch.accountToken;
    watchToken = batch.watchToken;
    const now = Date.now();
    const floor = now - MAX_BATCH_EVENT_AGE_MS;
    rows = batch.events.map((ev) => ({
      // The client timestamp, clamped into [now - 72 h, now]: the phone drops
      // older events before sending, so an out-of-range t is skew or forgery —
      // and an unclamped future/ancient received_at would corrupt the
      // day-aligned DAU rollup and dodge the 7-day prune.
      received_at: new Date(Math.min(Math.max(ev.t, floor), now)).toISOString(),
      provider: ev.provider,
      success: ev.success,
      error: ev.error,
      country_code: ev.countryCode,
      settings_json: batch.settings,
      app_version: batch.appVersion,
      build_profile: batch.buildProfile,
      watch_info: batch.watchInfo,
      used_gps_cache: ev.usedGpsCache,
      gps_error_code: ev.gpsErrorCode ?? null,
      location_mode: ev.locationMode ?? null,
      duration_ms: ev.durationMs ?? null,
      attempt: ev.attempt ?? null,
    }));
  } else {
    // Legacy single-event shape (app <= 1.15.x keeps sending it from the
    // field) — including its original tighter body cap.
    if (rawBytes > MAX_BODY_BYTES) {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    const payloadResult = telemetryPayloadSchema.safeParse(parsed);
    if (!payloadResult.success) {
      return Response.json({
        error: "invalid_payload",
        detail: payloadResult.error.issues[0]?.message || "invalid_payload",
      }, { status: 400 });
    }
    const payload: TelemetryPayload = payloadResult.data;
    accountToken = payload.accountToken;
    watchToken = payload.watchToken;
    rows = [{
      received_at: new Date().toISOString(),
      provider: payload.provider,
      success: payload.success,
      error: payload.error,
      country_code: payload.countryCode,
      settings_json: payload.settings,
      app_version: payload.appVersion,
      build_profile: payload.buildProfile,
      watch_info: payload.watchInfo,
      used_gps_cache: payload.usedGpsCache,
      gps_error_code: payload.gpsErrorCode ?? null,
      location_mode: payload.locationMode ?? null,
      duration_ms: payload.durationMs ?? null,
      attempt: payload.attempt ?? null,
    }];
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const telemetryHashSecret = Deno.env.get("TELEMETRY_HASH_SECRET");

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is not set");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  if (!telemetryHashSecret) {
    throw new Error("TELEMETRY_HASH_SECRET is not set");
  }

  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
  );
  const accountTokenHash = await hmacSha256Hex(
    telemetryHashSecret,
    accountToken,
  );
  const watchTokenHash = watchToken && watchToken.trim() !== ""
    ? await hmacSha256Hex(telemetryHashSecret, watchToken)
    : null;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Per-account hourly ARRIVAL count (inserted_at, not received_at): batched
  // rows carry historical received_at and would slide past an event-time
  // window, making the limit void for a back-dated flood. inserted_at is
  // always now() at insert, so this bounds physical writes per account per
  // hour for both shapes — a legit watch flushes ~2 batches per DAY.
  const rate = await supabase
    .from("telemetry_weather_fetch")
    .select("id", { count: "exact", head: true })
    .eq("account_token_hash", accountTokenHash)
    .gte("inserted_at", oneHourAgo);

  if (rate.error) {
    return Response.json({ error: "rate_check_failed" }, { status: 500 });
  }

  if ((rate.count || 0) >= MAX_EVENTS_PER_HOUR) {
    return Response.json({ error: "rate_limit_exceeded" }, { status: 429 });
  }

  const insertResult = await supabase.from("telemetry_weather_fetch").insert(
    rows.map((row) => ({
      account_token_hash: accountTokenHash,
      watch_token_hash: watchTokenHash,
      ...row,
    })),
  );

  if (insertResult.error) {
    return Response.json({ error: "insert_failed" }, { status: 500 });
  }

  return Response.json({ status: "accepted", events: rows.length }, { status: 202 });
});
