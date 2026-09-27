// What the proxy keeps of a Rainbow answer. Every app version since 1.7.0 reads only
// body.forecast[i].{precipRate, timestampBegin, timestampEnd} on the proxy path
// (src/pkjs/weather/rainbow-radar.js resampleForecast), so the cache stores, and the phone
// gets, the forecast intervals alone: Rainbow's echoed latitude/longitude (the requested
// place, used only for the echo check before this runs) and its summary are dropped.

/** The fields of a forecast interval that are kept (precipType is Rainbow's own label). */
const INTERVAL_FIELDS = ["precipRate", "precipType", "timestampBegin", "timestampEnd"] as const;

/** The stored and returned payload. */
export interface ForecastPayload {
  forecast: Record<string, unknown>[];
}

/**
 * Reduce a Rainbow answer (or an older cache row) to its forecast intervals.
 * @param payload Parsed upstream body, or a cached payload.
 * @returns {forecast: [...]}, each interval with only INTERVAL_FIELDS; a missing or
 *   non-array forecast is [] (the phone reads both as 24 zeros), and non-object entries
 *   are dropped.
 */
export function pickForecast(payload: unknown): ForecastPayload {
  const raw = payload !== null && typeof payload === "object"
    ? (payload as Record<string, unknown>).forecast
    : undefined;
  if (!Array.isArray(raw)) return { forecast: [] };
  const forecast: Record<string, unknown>[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const kept: Record<string, unknown> = {};
    for (const field of INTERVAL_FIELDS) {
      if (field in entry) kept[field] = (entry as Record<string, unknown>)[field];
    }
    forecast.push(kept);
  }
  return { forecast };
}
