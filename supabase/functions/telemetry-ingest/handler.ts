// The telemetry-ingest function: the phone's per-fetch telemetry, posted in batches (app
// >= 1.16). index.ts only wires the environment in; everything testable lives here,
// including the settings .strip() schema the watch-side snapshot is in lockstep with.
//
// Privacy: the API gateway logs the full URL of every request the function makes to
// PostgREST, so the account-token hash never rides a URL or a query filter. The hourly rate
// check is an RPC (supabase/schemas/telemetry.sql: POST /rest/v1/rpc/<fn>, arguments in the
// body), and the insert carries both hashes in its row bodies. Logs go through log.ts only.
//
// The answers the phone acts on (it reads only the status): 202 for an accepted batch, a
// 4xx for a request to drop, 429 or 500 for one to retry. The single-event shape the apps
// before 1.16 post is no longer accepted: it gets 400 invalid_payload, which those apps drop
// like any 4xx. 500 {error: 'internal_error'} answers a deploy missing its secrets, or
// anything thrown.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logEvent } from "./log.ts";

// The settings header's own bound: the ingest copies the header into every row a batch writes.
const MAX_SETTINGS_BYTES = 4096;
// The phone queues slim per-fetch records and posts them as ONE request every ~12 h
// instead of one invocation per fetch — the cap covers 50 worst-case events (512 B
// errors) plus the shared settings header.
const MAX_BATCH_BODY_BYTES = 65536;
const MAX_BATCH_EVENTS = 50;
// How far back a batched event's client timestamp may claim to be: the phone
// drops events older than this before sending, so anything older here is clock
// skew or forgery — clamped, not rejected, like every other soft field.
const MAX_BATCH_EVENT_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_EVENTS_PER_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;
// The duration_ms column is int4 (supabase/schemas/telemetry.sql).
const INT4_MAX = 2147483647;

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
    // The Units tab's feels-like formula ('provider' | 'steadman'), lockstep with
    // buildSettingsSnapshot in src/pkjs/telemetry-settings.js. z.string() like windUnits
    // so an unexpected value never fails the whole payload.
    feelsFormula: z.string().optional(),
    // The UV, wind and gust slots' day-max display mode, lockstep with
    // buildSettingsSnapshot (their pair presentation is not reported).
    uvSlotDisplay: z.string().optional(),
    windSlotDisplay: z.string().optional(),
    gustSlotDisplay: z.string().optional(),
    dateSlotMonthFormat: z.string().optional(),
    dateSlotFullFormat: z.string().optional(),
    aqiScale: z.enum(['european', 'us']).optional(),
    aqiSource: z.enum(['waqi', 'auto', 'openmeteo']).optional(),
    windUnits: z.string().optional(),
    distanceUnits: z.string().optional(),
    gustSlotDirection: z.boolean().optional(),
    windSlotUnit: z.boolean().optional(),
    gustSlotUnit: z.boolean().optional(),
    tempSlotUnit: z.boolean().optional(),
    // Lockstep with buildSettingsSnapshot in src/pkjs/telemetry-settings.js (a field
    // missing here is stripped and silently lost). z.string(), not z.enum: an old or migrated
    // blob can hold a bold mode this build's picker no longer offers, and a stricter
    // type would reject the whole event over one cosmetic setting.
    threshPhoneBatteryBoldMode: z.string().optional(),
    dayNightShading: z.boolean().optional(),
    healthMode: z.enum(['off', 'status', 'all', 'slot']).optional(),
    fetchIntervalMin: z.number().int().positive().optional(),
    rainCountdownHorizon: z.number().int().min(0).optional(),
    // The weather alerts (src/pkjs/telemetry-settings.js): the metric alerts, two letters
    // each in the On demand order (gust, uv, aqi, pollen, wind) — the look, o not placed on
    // any status bar / i icon / v icon + value, upper case while the alert looks ahead
    // to tomorrow; then the tomorrow mark in effect, r » / g > / p + / s * / n none,
    // '-' while not placed or today only (e.g. 'IrIrIro-Ir', an untouched install); and
    // the rain look, resolved as the watch draws it ('text' when unset). z.string(), not
    // z.enum: a future alert kind or look must not 400 the batch.
    alerts: z.string().optional(),
    rainAlertDisplay: z.string().optional(),
    // The warn look per paired threshold kind, one letter each in wire order (aqi,
    // pollen, wind, gust, steps, sleep, distance, uv): n none / o outline / f fill,
    // resolved with the platform default, e.g. 'ffffooof'.
    warnLooks: z.string().optional(),
    // The battery saver's night window — its own pair, present only while the saver
    // is on, so a row's `settings_json ? 'sleepStartHour'` reads "battery saver on".
    sleepStartHour: z.number().int().min(0).max(23).optional(),
    sleepEndHour: z.number().int().min(0).max(23).optional(),
    // Dim backlight (emery only — the watch-side snapshot omits the whole group on a
    // watch without the LED). backlightDimColor is the stored 'r,g,b' channel triple,
    // not a '#RRGGBB' screen colour, so z.string() per threshPhoneBatteryBoldMode's
    // rule above. DEPLOY-ORDERING: ship this function before the app release that
    // sends these, or the strip step drops them silently.
    backlightDim: z.boolean().optional(),
    backlightDimStartHour: z.number().int().min(0).max(23).optional(),
    backlightDimEndHour: z.number().int().min(0).max(23).optional(),
    backlightDimColor: z.string().optional(),
    // The automatic day/night theme switch. z.string() for the theme id and
    // mode (threshPhoneBatteryBoldMode's rule: an old blob may hold a value a
    // newer picker no longer offers, and one cosmetic field must not reject
    // the whole event). DEPLOY-ORDERING: ship this function before the app
    // release that sends these, or the strip step drops them silently.
    themeAuto: z.boolean().optional(),
    themeNight: z.string().optional(),
    themeAutoMode: z.string().optional(),
    themeAutoStartHour: z.number().int().min(0).max(23).optional(),
    themeAutoEndHour: z.number().int().min(0).max(23).optional(),
    axisTimeFormat: z.string().optional(),
    timeFont: z.string().optional(),
    timeLeadingZero: z.boolean().optional(),
    timeShowAmPm: z.boolean().optional(),
    weekStartDay: z.string().optional(),
    firstWeek: z.string().optional(),
    // aplite only (the watch-side snapshot sends them nowhere else): its quiet-time icon and
    // low-battery-only toggles, which every other watch replaced with On demand below.
    showQt: z.boolean().optional(),
    batteryLowOnly: z.boolean().optional(),
    // On demand (src/pkjs/on-demand.js telemetryCode): 40 letters, the ten items of
    // each bar (top, forecast, radar, health) in the On demand order (battery, bt, qt,
    // snooze, rain, gust, uv, aqi, pollen, wind) — L/R ticked on a side of a bar that
    // shows, l/r ticked on a hidden bar, '-' not ticked
    // (e.g. 'RLLLLRRR-R' + 30 '-', an untouched install). Absent on aplite, whose
    // showQt/batteryLowOnly above say what it draws. z.string() with no length bound, like
    // alerts and warnLooks: a future item lengthens the code and must not 400 the batch.
    // DEPLOY-ORDERING: ship this function before the app release that sends these, or
    // the strip step drops them silently.
    onDemand: z.string().optional(),
    // The All status bars card's "Weather alerts replace slots": 'now' (Right away) or 'needed'
    // (If needed). Absent on aplite, like onDemand. z.string() per
    // threshPhoneBatteryBoldMode's rule above. DEPLOY-ORDERING: ship this function before
    // the app release that sends it, or the strip step drops it silently.
    alertsReplaceSlot: z.string().optional(),
    // The weather condition slot's Look: 'both', 'text' or 'icon'. Absent on aplite. z.string()
    // per threshPhoneBatteryBoldMode's rule above. DEPLOY-ORDERING: ship this function before
    // the app release that sends it, or the strip step drops it silently.
    conditionSlotLook: z.string().optional(),
    // The Battery item's warn level as stored (a percentage) and its look ('icon' /
    // 'value'); z.string() per threshPhoneBatteryBoldMode's rule above.
    batteryLowLevel: z.number().int().min(0).max(100).optional(),
    batteryLowDisplay: z.string().optional(),
    // aplite only: the preset its Layout radio stores (every other watch keeps its screens
    // as a custom layout, the customView fields below). DEPLOY ORDERING: a value missing
    // from this enum fails the WHOLE batch (400), so a new preset (1.23.0: 'weatherOnly')
    // must be deployed here BEFORE the watch build that can send it ships.
    layoutPreset: z.enum(['classic', 'radarLast', 'forecast', 'fullCal', 'healthFirst', 'compactCal', 'compactDense', 'noCal', 'weatherOnly', 'custom']).optional(),
    // Custom-layout usage: the three packed per-view wire values (uint16; elements,
    // seats, order, clock/top-bar omissions). Present only while layoutPreset is
    // 'custom'. DEPLOY-ORDERING: this function must ship BEFORE the app release
    // that sends them, or the schema's strip step silently drops the fields.
    customView0: z.number().int().min(0).max(0xFFFF).optional(),
    customView1: z.number().int().min(0).max(0xFFFF).optional(),
    customView2: z.number().int().min(0).max(0xFFFF).optional(),
    // Custom layout v2: each view's ext word (graph size, top-area size, top-graph kind,
    // Position; bit 15 always clear). ADDITIVE on purpose — widening customView* would
    // make an older deploy reject the whole batch. Same deploy-ordering rule as above.
    customViewExt0: z.number().int().min(0).max(0x7FFF).optional(),
    customViewExt1: z.number().int().min(0).max(0x7FFF).optional(),
    customViewExt2: z.number().int().min(0).max(0x7FFF).optional(),
    viewResetMin: z.number().int().min(0).optional(),
    // The Layout card's Double flick switch (2.1.0). DEPLOY-ORDERING: ship this function
    // before the app release that sends it, or the strip step silently drops it.
    doubleFlick: z.boolean().optional(),
    // emery only, like forecastHours: the one watch with the toggle.
    largeGraphFont: z.boolean().optional(),
    // The forecast graph's time span option the watch draws, in hours (2.2.0): 12/24/48,
    // sent by an emery only (every other watch draws 24). DEPLOY-ORDERING: ship this
    // function before the app release that sends it, or the strip step silently drops it.
    // An open-ended int (no max, like viewResetMin), not an enum: a longer span a later
    // release adds cannot 400 the batch.
    forecastHours: z.number().int().min(1).optional(),
    // Graph styles (3.0.0, src/pkjs/graph-styles.js), emery only: how many exist, and the
    // length option of styles 2 and 3 while a screen shows them (as forecastHours: 12/24/48).
    // DEPLOY-ORDERING: ship this function before the app release that sends them, or the
    // strip step silently drops them. Open-ended ints, like forecastHours.
    graphStyleCount: z.number().int().min(1).optional(),
    graphStyle2Hours: z.number().int().min(1).optional(),
    graphStyle3Hours: z.number().int().min(1).optional(),
    // The forecast graph's left axis options (2.2.0, BETA, src/pkjs/forecast-axis.js),
    // emery only, as chosen. DEPLOY-ORDERING: ship this function before the app release
    // that sends them, or the strip step silently drops them. The numbers' place as a
    // plain string ('axis' | 'graph' | 'off'), not an enum: a value a later release adds
    // cannot 400 the batch. The betas' forecastAxisLine / forecastAxisOutline are gone (both
    // implied by the numbers' place): the strip step drops them from an older dev phone.
    forecastAxisNumbers: z.string().optional(),
    forecastAxisScale: z.boolean().optional(),
    vibe: z.boolean().optional(),
    btIcons: z.string().optional(),
    secondaryLine: z.string().optional(),
    secondaryLineFill: z.boolean().optional(),
    windScale: z.string().optional(),
    // The wind, gust and UV lines' Show, 'all' or 'alert' (1.24.0, src/pkjs/line-alert.js
    // showOf). DEPLOY-ORDERING: ship this function before the app release that sends
    // them, or the strip step drops them silently. z.string(), not z.enum: a future
    // Show value must not 400 the batch.
    windLineShow: z.string().optional(),
    gustLineShow: z.string().optional(),
    uvLineShow: z.string().optional(),
    pressureScale: z.string().optional(),
    thirdLine: z.string().optional(),
    fourthLine: z.string().optional(),
    fifthLine: z.string().optional(),
    secondaryLineStyle: z.string().optional(),
    thirdLineStyle: z.string().optional(),
    fourthLineStyle: z.string().optional(),
    fifthLineStyle: z.string().optional(),
    barSource: z.string().optional(),
    rainBarColor: z.string().optional(),
    // The rain radar's source, or RADAR_OFF ('disabled') while it is off (foldRadarOff
    // below turns app 2.6.0's and 2.6.1's radarEnabled false into that). z.string(), not an
    // enum: a new source must not 400 the batch.
    radarProvider: z.string().optional(),
    radarMode: z.enum(['off', 'countdown', 'status', 'graph']).optional(),
    radarColor: z.string().optional(),
    radarSky: z.boolean().optional(),
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
    // buildSettingsSnapshot in src/pkjs/telemetry-settings.js — a field missing here is
    // stripped and silently lost.
    graphMainColor: z.string().optional(),
    graphFillColor: z.string().optional(),
    graphSecondColor: z.string().optional(),
    graphThirdColor: z.string().optional(),
    graphFourthColor: z.string().optional(),
    nightHatchColor: z.string().optional(),
    nightDayLineColor: z.string().optional(),
    nightFillColor: z.string().optional(),
    // The settings page's Weather tab: whether the page opens on it, whole days since the
    // page last drew its graphs (absent without a stamp), and how many places it has saved
    // (a count; a place never leaves the phone). Open-ended ints (no max, like
    // viewResetMin): a page that saves more places cannot 400 the batch. DEPLOY-ORDERING:
    // ship this function before the app release that sends them, or the strip step drops
    // them silently.
    startOnWeatherTab: z.boolean().optional(),
    weatherTabSeenDays: z.number().int().min(0).optional(),
    weatherTabPlaces: z.number().int().min(0).optional(),
  })
  .strip();

// radarProvider while the rain radar is off: what apps before 1.10 sent, and what the apps
// after 2.6.1 send again.
const RADAR_OFF = "disabled";

/**
 * The z.preprocess step the settings header goes through before the schema: app 2.6.0 and
 * 2.6.1 report an Off rain radar as radarEnabled false beside the source they keep, and
 * radarEnabled is no field of settingsSchema, so its strip step would drop the one sign of
 * the Off. Folded into radarProvider first, every stored row names an Off radar one way
 * (the nightly rollup folds the rows stored before this). Anything else passes as posted.
 * @param settings The settings header as posted.
 * @returns The header, with radarProvider RADAR_OFF when radarEnabled is false.
 */
function foldRadarOff(settings: unknown): unknown {
  if (typeof settings !== "object" || settings === null) return settings;
  const header = settings as Record<string, unknown>;
  return header.radarEnabled === false ? { ...header, radarProvider: RADAR_OFF } : settings;
}

// A fetch's wall-clock duration — a SOFT field: out of range means null, never a
// rejected event. The phone measures Date.now() - fetchStart, so a clock step
// mid-fetch yields a negative or huge value. Rejecting a negative one 400'd the
// whole batch (the phone drops a 400, taking up to 49 good neighbours with it);
// accepting a huge one overflowed the int4 column, and that insert_failed 500 is
// retried hourly, wedging the phone's queue head for the full 72 h window. The
// phone now nulls it too (telemetry.js normalizeDurationMs); this covers the
// builds already in the field.
export const durationMsSchema = z.number().nullable().optional().transform((v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= INT4_MAX ? v : null
);

// One slim record of a batch: one fetch's outcome, with a client timestamp `t` (epoch ms)
// that becomes the row's received_at. The success/error contract is per event.
export const batchEventSchema = z.object({
  t: z.number().int().positive(),
  provider: providerSchema,
  success: z.boolean(),
  error: z.string().trim().min(1).max(512).nullable(),
  countryCode: z.string().nullable(),
  usedGpsCache: z.boolean().default(false),
  gpsErrorCode: z.number().int().nonnegative().nullable().optional(),
  locationMode: locationModeSchema.nullable().optional(),
  durationMs: durationMsSchema,
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
// nothing), then up to MAX_BATCH_EVENTS slim records. The settings go through
// foldRadarOff, then settingsSchema, the object the watch-side lockstep test
// (test/telemetry.test.js) reads.
export const batchPayloadSchema = z.object({
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
  settings: z.preprocess(foldRadarOff, settingsSchema).default({}),
  events: z.array(batchEventSchema).min(1).max(MAX_BATCH_EVENTS),
});

type BatchPayload = z.infer<typeof batchPayloadSchema>;

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

/**
 * JSON.parse reviver dropping U+0000 from every string value. Postgres text and jsonb cannot
 * hold it: the insert fails (22P05) and Postgres logs a CONTEXT line quoting the request JSON
 * before the NUL (free text, or a token hash). Applied at the parse, so validation sees what
 * gets stored. Keys are left alone: the schemas strip unknown ones.
 * @param _key The property name (unused).
 * @param value The parsed value.
 * @returns The value, any string without its NULs.
 */
export function dropNul(_key: string, value: unknown): unknown {
  return typeof value === "string" && value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
}

/**
 * Hex HMAC-SHA-256: the account- and watch-token hashes the telemetry rows are keyed by (the
 * news tables key by the same account hash).
 * @param secret The hashing secret (TELEMETRY_HASH_SECRET); must not be empty.
 * @param message The token.
 * @returns 64 hex characters.
 */
export async function hmacSha256Hex(secret: string, message: string) {
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

/** The service-role client and the token-hashing secret. */
export type IngestBackend = { client: SupabaseClient; hashSecret: string };

export type IngestDeps = {
  /** null when the deploy lacks SUPABASE_URL, the service-role key or the hashing secret. */
  backend: IngestBackend | null;
  now: () => Date;
};

/**
 * The caller's rows that ARRIVED since `since` (inserted_at, not received_at: batched rows
 * carry historical received_at and would slide past an event-time window, making the limit
 * void for a back-dated flood), by RPC so the hash rides the body.
 * @param client The service-role client.
 * @param hash The caller's account-token hash.
 * @param since Start of the window (ISO timestamp).
 * @returns The count, or null on a database error (logged by code).
 */
async function countRecentInserts(client: SupabaseClient, hash: string, since: string): Promise<number | null> {
  const { data, error } = await client.rpc("telemetry_recent_insert_count", {
    p_account_token_hash: hash,
    p_since: since,
  });
  if (error || !Number.isInteger(data)) {
    logEvent("rate_check_failed", error?.code);
    return null;
  }
  return data as number;
}

/**
 * One request, start to finish (createIngestHandler wraps it in the last line of defence).
 * @param req The phone's request.
 * @param deps Backend (or null when unconfigured) and clock.
 * @returns 202 {status: 'accepted', events}; 4xx for a request to drop; 429/500 to retry.
 */
async function handle(req: Request, deps: IngestDeps): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BATCH_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  const rawBody = await req.text();
  if (encodeUtf8(rawBody).length > MAX_BATCH_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody, dropNul);
  } catch (_error) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // A batch, or nothing: the single event an app before 1.16 posts fails here like any
  // other invalid payload.
  const batchResult = batchPayloadSchema.safeParse(parsed);
  if (!batchResult.success) {
    return Response.json({
      error: "invalid_payload",
      detail: batchResult.error.issues[0]?.message || "invalid_payload",
    }, { status: 400 });
  }
  const batch: BatchPayload = batchResult.data;
  // The header is duplicated into EVERY row of the batch, so its size is a 50x write
  // amplifier: it keeps a bound of its own. The heaviest one the phone sends measures
  // ~2.7 KB (test/telemetry.test.js).
  if (JSON.stringify(batch.settings).length > MAX_SETTINGS_BYTES ||
    JSON.stringify(batch.watchInfo).length > 1024) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  const now = deps.now().getTime();
  const floor = now - MAX_BATCH_EVENT_AGE_MS;
  const rows = batch.events.map((ev) => ({
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

  const backend = deps.backend;
  if (!backend) {
    logEvent("not_configured");
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
  const { client, hashSecret } = backend;

  const accountTokenHash = await hmacSha256Hex(hashSecret, batch.accountToken);
  const watchTokenHash = batch.watchToken && batch.watchToken.trim() !== ""
    ? await hmacSha256Hex(hashSecret, batch.watchToken)
    : null;

  // Per-account hourly ARRIVAL count: bounds physical writes per account per hour — a
  // legit watch flushes ~2 batches per DAY.
  const recent = await countRecentInserts(client, accountTokenHash, new Date(now - HOUR_MS).toISOString());
  if (recent === null) {
    return Response.json({ error: "rate_check_failed" }, { status: 500 });
  }

  if (recent >= MAX_EVENTS_PER_HOUR) {
    return Response.json({ error: "rate_limit_exceeded" }, { status: 429 });
  }

  // Both hashes ride the row bodies; the URL carries only the column names.
  const insertResult = await client.from("telemetry_weather_fetch").insert(
    rows.map((row) => ({
      account_token_hash: accountTokenHash,
      watch_token_hash: watchTokenHash,
      ...row,
    })),
  );

  if (insertResult.error) {
    logEvent("insert_failed", insertResult.error.code);
    return Response.json({ error: "insert_failed" }, { status: 500 });
  }

  return Response.json({ status: "accepted", events: rows.length }, { status: 202 });
}

/**
 * The telemetry-ingest request handler. Nothing it throws reaches the Deno runtime (which
 * would log the error's message and stack): a throw is logged as 'unhandled' with no detail
 * and answered 500 internal_error, which the phone retries like any 5xx.
 * @param deps Backend (or null when unconfigured) and clock.
 * @returns The handler Deno.serve gets.
 */
export function createIngestHandler(deps: IngestDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await handle(req, deps);
    } catch (_error) {
      // Its message may carry request data: the tag alone.
      logEvent("unhandled");
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  };
}
