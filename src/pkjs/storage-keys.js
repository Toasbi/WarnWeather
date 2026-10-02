module.exports = {
    // The newest release-notification version already shown (release-notifications.js).
    MAX_NOTIFIED_VERSION_KEY: 'max_notified_version',
    // Marker keys for the Clay-settings migrations (migrations/registry.js, run by
    // clay-migrations.js). APPEND-ONLY: a shipped marker string is the on-flash record
    // that a migration ran, so it is never reused, renamed or renumbered. Part of a
    // migration's identity — listed here to honor the one-registry rule; the entries
    // and their bodies live under migrations/.
    WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY: 'v1.34.0_weekend_holiday_color_migration',
    HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY: 'v1.4.0_holiday_white_to_toggle_migration',
    HOLIDAY_REGION_KEY_MIGRATION_KEY: 'v1.4.0_holiday_region_key_migration',
    STATUS_LINE_HEALTH_DEFAULTS_MIGRATION_KEY: 'v1.8.0_status_line_health_defaults_migration',
    STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY: 'v1.8.0_status_top_right_battery_migration',
    RADAR_VIEW_MODE_MIGRATION_KEY: 'v1.10.0_radar_view_mode_migration',
    GRAPH_NIGHT_COLORS_MIGRATION_KEY: 'v1.15.0_graph_night_colors_migration',
    CARRIED_GRAPH_NIGHT_TINT_MIGRATION_KEY: 'v1.15.1_carried_graph_night_tint_migration',
    LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY: 'v1.16.0_light_graph_color_retune_migration',
    LIGHT_SOLID_BARS_MIGRATION_KEY: 'v1.16.0_light_solid_bars_migration',
    ONBOARDING_EXISTING_INSTALL_MIGRATION_KEY: 'v1.20.0_onboarding_existing_install_migration',
    // Replaced, never released: 'v1.23.0_norain_empty_to_default_migration' only ran on
    // dev builds of 1.23.0, which then learnt to move the old default text too.
    NORAIN_DEFAULT_TEXT_MIGRATION_KEY: 'v1.23.0_norain_default_text_migration',
    FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY: 'v1.23.1_fifth_line_style_default_migration',
    STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY: 'v1.23.1_stripe_metric_rule_resend_migration',
    // The 1.24.0 alert-levels move (highlight toggles, warn look, rain window Off, seed
    // pairs back to blank, temperature separator slash -> bar; migrations/v1_24.js).
    // Replaced, never released: dev builds of 1.24.0 ran these steps under markers of
    // their own, 'v1.24.0_threshold_highlight_toggle_migration',
    // 'v1.24.0_rain_horizon_off_migration', 'v1.24.0_seed_pair_blank_migration',
    // 'v1.24.0_seed_pair_any_unit_migration' and 'v1.24.0_temp_separator_bar_migration',
    // and under this string, which is kept on purpose: an install that holds it ran the
    // moves, and a re-run there would read settings saved on the 1.24.0 page as 1.23
    // shapes (a highlight switched off with its pair kept would come back on).
    ALERT_LEVELS_MIGRATION_KEY: 'v1.24.0_warn_look_migration',
    // 1.24.0: the status bars moved onto On demand (migrations/v1_24.js migrateOnDemand).
    ON_DEMAND_MIGRATION_KEY: 'v1.24.0_on_demand_migration',
    FETCH_ATTEMPT_KEY: 'weather_fetch_attempt',
    LAST_FETCH_SUCCESS_KEY: 'lastFetchSuccess',
    LAST_FETCH_ATTEMPT_KEY: 'lastFetchAttempt',
    // The last GPS fix ({lat, lon, time}) — the fallback location.js serves for
    // up to 24 h when a fresh fix fails. Must stay exactly 'gpsCache': installs
    // already persist it under that name.
    GPS_CACHE_KEY: 'gpsCache',
    GEOCODE_CACHE_KEY: 'geocodeCache',
    GEOCODE_BACKOFF_KEY: 'geocodeBackoff',
    // An address LocationIQ could not resolve ({query, time}): it is not asked
    // again for a day, or until the user forces a fetch (weather/location.js).
    GEOCODE_NOT_FOUND_KEY: 'geocodeNotFound',
    // The last city name the ArcGIS reverse geocode resolved, with the
    // coordinates it was resolved for ({name, lat, lon}) — the City slot's
    // stand-in when a later lookup fails nearby (weather/location.js).
    LAST_CITY_KEY: 'lastCity',
    AUTH_BACKOFF_KEY: 'authBackoff',
    LAST_IS_SLEEPING_KEY: 'lastIsSleeping',
    LAST_HOLIDAY_DAY_KEY: 'last_holiday_day',
    LAST_SENT_FORECAST_KEY: 'lastSentForecast',
    LAST_SENT_STATUS_KEY: 'lastSentStatus',
    LAST_SENT_SUN_KEY: 'lastSentSun',
    LAST_SENT_RADAR_KEY: 'lastSentRadar',
    LAST_SENT_SKY_KEY: 'lastSentSky',
    LAST_SENT_SLEEP_KEY: 'lastSentSleep',
    LAST_SENT_CLAY_KEY: 'lastSentClaySettings',
    DEV_STATS_KEY: 'devStats',
    HOLIDAY_CACHE_PREFIX: 'holidays_',
    HOLIDAY_BACKOFF_PREFIX: 'holidaysBackoff_',
    UPDATE_NOTIFIED_VERSION_KEY: 'update_notified_version',
    LAST_UPDATE_CHECK_KEY: 'last_update_check',
    WU_HOURLY_CACHE_KEY: 'wuHourlyCache',
    // The UV / wind / gust / AQI forecast for today's hours already begun, kept
    // across fetches, so each slot's day max (the Day max / Both modes) knows
    // whether today's peak is still ahead, running or behind
    // (weather/day-peaks.js). One record per metric.
    UV_DAY_RECORD_KEY: 'uvDayRecord',
    WIND_DAY_RECORD_KEY: 'windDayRecord',
    GUST_DAY_RECORD_KEY: 'gustDayRecord',
    AQI_DAY_RECORD_KEY: 'aqiDayRecord',
    NEWS_CACHE_KEY: 'newsCache',
    NOTICES_KEY: 'notices',
    LAST_SENT_NOTICE_KEY: 'lastSentNotice',
    // The Weather Underground key is scraped rather than typed, and has always
    // lived outside the settings blob under this literal name (wunderground.js).
    WU_API_KEY: 'wundergroundApiKey',
    // Where "Reset watchface" parks the credentials it deliberately keeps, until
    // the next boot's seedDefaults folds them back into a fresh blob.
    PRESERVED_KEYS_KEY: 'preservedApiKeys',
    // Phone battery (Android only — the Battery Status API exists solely in the
    // Chromium WebView PKJS runs in there). SUPPORTED is the persisted detector
    // result, so the config page's env can omit the slot items before any
    // reading has landed; LEVEL is the EXACT percentage (0..100, rounded) and
    // CHARGING the charging flag, both read back by the baker. LEVEL is NOT the
    // 5-point bucket: the bucket is the send trigger and lives in memory only
    // (phone-battery.js), so the watch always shows the phone's real charge.
    PHONE_BATTERY_SUPPORTED: 'phoneBatterySupported',
    PHONE_BATTERY_LEVEL: 'phoneBatteryLevel',
    PHONE_BATTERY_CHARGING: 'phoneBatteryCharging',
    // The re-bake snapshot: the handful of payload keys buildStatusLines reads,
    // plus the watchInfo its platform env is derived from, version-stamped as
    // one JSON blob. PKJS is torn down whenever the user leaves the watchface,
    // and without this a battery event after a restart had nothing to re-bake
    // and reached the watch not at all until the next completed fetch. Settings
    // are deliberately NOT in here -- the re-bake pairs this with the live blob
    // (phone-battery.js explains why).
    PHONE_BATTERY_SNAPSHOT: 'phoneBatterySnapshot',
    // Pending telemetry events awaiting a batched send (telemetry.js). Each
    // weather fetch used to POST its own event — ~59 edge-function invocations
    // per watch per day against Supabase's 500k/month cap; the queue drains as
    // ONE batch request every ~12 h / 24 events instead. Slim per-event records
    // only (the settings/watchInfo header is snapshotted at flush time).
    TELEMETRY_QUEUE_KEY: 'telemetryQueue',
    // The in-flight batch's record ids ({ids: [...]}), written just before the
    // POST and cleared on its outcome. A mark still present when a NEW PKJS
    // session first flushes means the previous session died between send and
    // ACK — outcome unknown — and those records are dropped instead of resent:
    // at-most-once, because a duplicate batch inflates fetch_count server-side
    // (no idempotency key) while a lost one costs a few telemetry rows.
    TELEMETRY_SENDING_KEY: 'telemetrySending',
    // The settings page Weather tab's data for the place it opens on ({v, data}),
    // refreshed at most once a day on settings open (weather-tab-cache.js).
    WEATHER_TAB_CACHE_KEY: 'weatherTabCache',
    // The last radar request of a throttled radar source ({id, at: epoch ms, tuples?}, no
    // position; see radar-factory.js RADAR_MIN_REQUEST_INTERVAL_MS): the shared Rainbow proxy
    // is asked at most once per 30-minute slot, wherever the watch is, and the throttled
    // cycles of that slot re-serve its answer. Persisted so a PKJS relaunch doesn't reset
    // it; a reset's localStorage.clear() drops it (the next fetch then requests).
    RADAR_REQUEST_THROTTLE_KEY: 'radarRequestThrottle',
    // The last answer each keyed source gave the user's own API key ({<id>: {keyHash,
    // status}}: the key's fingerprint — never the key — and the HTTP status that answered
    // it, per weather provider or radar source; key-result.js). The settings page reads it
    // as userData.keyResults for the key status under the Weather and Radar provider rows.
    // Replaced, never released: dev builds of 1.24.0 kept the radar's verdict alone under
    // 'radarKeyResult' ({id, keyHash, status}); nothing reads that string any more, and it
    // is not reused.
    KEY_RESULTS_KEY: 'keyResults',
    // The weather provider's run of server failures ({id, n}: the provider id and how
    // many updates in a row it answered with a 5xx, a timeout or no connection;
    // fetch-cycle.js). Its notice waits for the second one, so a one-off outage stays
    // quiet; a success, another kind of failure or another provider ends the run.
    SERVER_FAILURE_STREAK_KEY: 'serverFailureStreak',
    // Which regional radar sources can see the last update's location ({dwd, metno}:
    // true = outside its area; plus misses: {dwd: n}, DWD's 404s in a row from inside its
    // area; weather/radar-coverage.js), never the position itself. The settings page reads
    // it as userData.radarCoverage for the note under the Radar provider row.
    RADAR_COVERAGE_KEY: 'radarCoverage'
};
