module.exports = {
    // The newest release-notification version already shown (release-notifications.js).
    MAX_NOTIFIED_VERSION_KEY: 'max_notified_version',
    // Marker keys for the Clay-settings migrations (settings/domain/migrations/registry.js, run by
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
    // pairs back to blank, temperature separator slash -> bar; settings/domain/migrations/v1_24.js).
    // Replaced, never released: dev builds of 1.24.0 ran these steps under markers of
    // their own, 'v1.24.0_threshold_highlight_toggle_migration',
    // 'v1.24.0_rain_horizon_off_migration', 'v1.24.0_seed_pair_blank_migration',
    // 'v1.24.0_seed_pair_any_unit_migration' and 'v1.24.0_temp_separator_bar_migration',
    // and under this string, which is kept on purpose: an install that holds it ran the
    // moves, and a re-run there would read settings saved on the 1.24.0 page as 1.23
    // shapes (a highlight switched off with its pair kept would come back on).
    ALERT_LEVELS_MIGRATION_KEY: 'v1.24.0_warn_look_migration',
    // 1.24.0: the status bars moved onto On demand (settings/domain/migrations/v1_24.js migrateOnDemand).
    ON_DEMAND_MIGRATION_KEY: 'v1.24.0_on_demand_migration',
    // 1.24.0: "Rainbow (own key)" is stored as radarProvider 'rainbowkey' instead of
    // 'rainbow' plus rainbowOwnKey (settings/domain/migrations/radar.js migrateRainbowOwnKeySource). A
    // marker of its own, not a step of the alert levels' or On demand's: dev and beta
    // installs already hold both of those, and they still store the pair.
    RAINBOW_OWN_KEY_SOURCE_MIGRATION_KEY: 'v1.24.0_rainbow_own_key_source_migration',
    // 2.0.1: every install onto the alert defaults, a weather warn look filled and an
    // alert's Look Icon + value (settings/domain/migrations/alert-defaults.js migrateAlertDefaults).
    ALERT_DEFAULTS_MIGRATION_KEY: 'v2.0.1_alert_defaults_migration',
    // 2.6.0: every install onto screens: the custom layout's keys, the modes worked out from
    // them and radarEnabled (settings/domain/migrations/screens.js migrateToScreens).
    SCREENS_MIGRATION_KEY: 'v2.6.0_screens_migration',
    // 3.0.0: an install from before keeps the slots it showed when the Forecast bar's and
    // the top row's defaults changed (settings/domain/migrations/status-slots.js keepSlotDefaults27). Named
    // while 3.0.0 was still planned as 2.7.0; test builds already marked it, so it stays.
    SLOT_DEFAULTS_2_7_MIGRATION_KEY: 'v2.7.0_slot_defaults_migration',
    // 3.3.0: every install onto the city slot's weather icon, on by default now
    // (settings/domain/migrations/status-slots.js migrateCitySlotIconOn).
    CITY_SLOT_ICON_MIGRATION_KEY: 'v3.3.0_city_slot_icon_migration',
    // 3.3.0: the two watch battery items and the two phone battery items became one each,
    // with a Look (settings/domain/migrations/status-slots.js mergeBatterySlots).
    BATTERY_SLOTS_MERGE_MIGRATION_KEY: 'v3.3.0_battery_slots_merge_migration',
    // 3.5.0: the Plugin value's one set of settings into each slot that holds it
    // (settings/domain/migrations/status-slots.js movePluginValueIntoSlots).
    PLUGIN_VALUE_SLOTS_MIGRATION_KEY: 'v3.5.0_plugin_value_slots_migration',
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
    // again for a day, or until the user forces a fetch (weather/adapter/location.js).
    GEOCODE_NOT_FOUND_KEY: 'geocodeNotFound',
    // The last city name the ArcGIS reverse geocode resolved, with the
    // coordinates it was resolved for ({name, lat, lon}) — the City slot's
    // stand-in when a later lookup fails nearby (weather/adapter/location.js).
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
    // Set once a notification made the phone ask for ShowNotifications (notify-watch.js), so a
    // question the user dismissed is not asked again on every run.
    NOTIFY_ASKED_KEY: 'notify_asked',
    LAST_UPDATE_CHECK_KEY: 'last_update_check',
    WU_HOURLY_CACHE_KEY: 'wuHourlyCache',
    // The UV / wind / gust / AQI forecast for today's hours already begun, kept
    // across fetches, so each slot's day max (the Day max / Both modes) knows
    // whether today's peak is still ahead, running or behind
    // (weather/domain/day-peaks.js). One record per metric.
    UV_DAY_RECORD_KEY: 'uvDayRecord',
    WIND_DAY_RECORD_KEY: 'windDayRecord',
    GUST_DAY_RECORD_KEY: 'gustDayRecord',
    AQI_DAY_RECORD_KEY: 'aqiDayRecord',
    // The last good AQI reading ({scale, at: epoch ms, lat, lon, aqi}) — the AQI
    // slot's stand-in when a later lookup at the same place, in the same scale,
    // answers no reading (a WAQI '-' or no station, a timeout) within 2 h
    // (weather/adapter/air-quality.js). Stays on the phone.
    LAST_AQI_KEY: 'lastAqi',
    NEWS_CACHE_KEY: 'newsCache',
    NOTICES_KEY: 'notices',
    // The ids of the new-feature tips this install has seen (feature-tips-seen.js): a JSON
    // list. Absent until the first boot of a build with tips, which writes every id for a
    // fresh install and none for one from before.
    FEATURE_TIPS_SEEN_KEY: 'feature_tips_seen',
    LAST_SENT_NOTICE_KEY: 'lastSentNotice',
    // The Weather Underground key is scraped rather than typed, and has always
    // lived outside the settings blob under this literal name (wunderground.js).
    WU_API_KEY: 'wundergroundApiKey',
    // Where "Reset watchface" parks the credentials it deliberately keeps, until
    // the next boot's seedDefaults folds them back into a fresh blob.
    PRESERVED_KEYS_KEY: 'preservedApiKeys',
    // Phone battery (the Pebble app's Phone plugin, or the Battery Status API of the
    // Chromium WebView PKJS runs in on Android; phone-battery.js). SUPPORTED is the
    // persisted detector result, so the config page's env can omit the slot items before
    // any reading has landed; LEVEL is the EXACT percentage (0..100, rounded), read back
    // by the baker. LEVEL is NOT the 5-point bucket: the bucket is the send trigger and
    // lives in memory only, so the watch always shows the phone's real charge.
    // SUPPORTED was 'phoneBatterySupported' while the WebView was the only source: under
    // a new name every phone judges again, now that the Phone plugin is one.
    PHONE_BATTERY_SUPPORTED: 'phoneBatteryReadable',
    PHONE_BATTERY_LEVEL: 'phoneBatteryLevel',
    // What a build from before the Phone plugin left behind, dropped at every start: its
    // verdict, and the charging flag the slot no longer shows.
    PHONE_BATTERY_RETIRED_KEYS: ['phoneBatterySupported', 'phoneBatteryCharging'],
    // The phone's battery as the watch was last sent it ({level}; phone-battery.js
    // readShown): what a weather fetch's bake shows, so the charge drifting inside its
    // 5-point bucket does not change the status. Kept across PKJS restarts, unlike the
    // level above, because the watch keeps showing it.
    PHONE_BATTERY_SHOWN: 'phoneBatteryShown',
    // The estimate of the days the watch has left on its charge as it was last heard
    // ({days, updatedAt}; battery-estimate.js), which the watch battery's text (its Text
    // and Icon + text looks) can show. Kept across PKJS restarts so a bake shows the days
    // at once.
    BATTERY_ESTIMATE: 'batteryEstimate',
    // When that estimate was last read ({source: null, at: epoch ms, failures: failed reads in
    // a row, made: when Muninn made the estimate it heard, or null}; plugin-reads.js recordOf,
    // plugin-read-schedule.js), so neither a PKJS restart nor a settings save reads it again
    // before estimate-reads.js says. Absent while the days are not wanted, so switching them on
    // reads at once.
    BATTERY_ESTIMATE_READ: 'batteryEstimateRead',
    // Each value a Plugin value slot shows, as it was last heard, by its source (the key of
    // plugin-values.js sourceOf): {<source>: {source, reading: {short, time, number, unit, state,
    // long}, at, validUntil}} (plugin-value-source.js, plugin-value-reads.js valueOf), kept
    // across PKJS restarts so a bake shows it at once. A value's own `source` names the plugin
    // and the value it was read from; a value of another source is never shown. An entry goes
    // at a start or a save once no slot picks its source; a slot of a bar the watch is not sent
    // keeps it, so the value shows at once when its bar is shown again.
    PLUGIN_VALUES: 'pluginValues',
    // When each of those values was last read, by its source: {<source>: {source, at, failures,
    // validUntil}} (plugin-reads.js recordOf, plugin-read-schedule.js), so neither a PKJS restart
    // nor a settings save reads it again before plugin-value-reads.js says. An entry goes with
    // its value, and is forgotten with a new reading at a complication's place, or when the read
    // under way stops as no slot shows the value any more (plugin-read-schedule.js stop), so the
    // value is read at once.
    PLUGIN_VALUE_READS: 'pluginValueReads',
    // The instances the last read of each plugin's item a Plugin value slot picks brought, by the
    // item (plugin-values.js itemKeyOf: 'plugin/category/item'): {<item>: [{id, name}]}
    // (plugin-reader.js instancesOf), for the slot's dialog's Which row. Another app's data. An
    // entry goes at a start or a save once no slot picks a value of its item.
    PLUGIN_INSTANCES: 'pluginInstances',
    // Until 3.5.0, when the item had one source for every slot: its value as last heard, and
    // when it was last read. plugin-value-source.js moves them into the maps above at its start
    // and removes them.
    PLUGIN_VALUE: 'pluginValue',
    PLUGIN_VALUE_READ: 'pluginValueRead',
    // The user's complications in the Pebble app as last heard ([{position, category, item,
    // index, property}]; complication-list.js, complications.js), so the settings page lists
    // them as it opens and the Plugin value slot reads its complication right after a PKJS
    // start. Absent while the Pebble app has served none.
    COMPLICATIONS: 'complications',
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
    // ONE batch request every ~12 h / 24 events instead, plus on the settings
    // Save and open triggers below. Slim per-event records only (the
    // settings/watchInfo header is snapshotted at flush time).
    TELEMETRY_QUEUE_KEY: 'telemetryQueue',
    // '1' once this install has had a telemetry batch accepted (telemetry.js).
    // Until then a settings Save sends the queue at once, so a new install that
    // keeps telemetry on is counted even if it leaves before the ~12 h batch;
    // after it, the once-a-day settings-open send takes over. A reset clears it,
    // like any fresh install.
    TELEMETRY_REPORTED_KEY: 'telemetryReported',
    // UTC day ('YYYY-MM-DD') of the last send triggered by opening the settings
    // page (telemetry.js): that trigger fires at most once a day.
    TELEMETRY_OPEN_SEND_DAY_KEY: 'telemetryOpenSendDay',
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
    // The last sky request of the radar's sky rows ({id, at: epoch ms, tuple}, no position;
    // radar-sky-source.js minRequestIntervalMs): Open-Meteo is asked at most once per UTC
    // half hour, and the cycles of that half hour re-serve its answer. Kept only once an
    // answer came, so a failed request is asked again on the next cycle.
    SKY_REQUEST_THROTTLE_KEY: 'skyRequestThrottle',
    // The last answer each keyed source gave the user's own API key ({<id>: {keyHash,
    // status}}: the key's fingerprint — never the key — and the HTTP status that answered
    // it, per weather provider or radar source; key-result.js). The settings page reads it
    // as userData.keyResults for the key status under the Weather and Radar provider rows.
    // Replaced, never released: dev builds of 1.24.0 kept the radar's verdict alone under
    // 'radarKeyResult' ({id, keyHash, status}); nothing reads that string any more, and it
    // is not reused.
    KEY_RESULTS_KEY: 'keyResults',
    // The weather provider's run of failed updates of one kind ({id, kind, n}: the
    // provider id, 'server' — a 5xx, an unreadable answer, a timeout or no connection —
    // or 'coverage' — no data for the place — and how many updates in a row;
    // fetch-cycle.js countFailureRun). Its notice waits for the second one, so a one-off
    // stays quiet; a success, another kind of failure or another provider ends the run.
    SERVER_FAILURE_STREAK_KEY: 'serverFailureStreak',
    // Which regional radar sources can see the last update's location ({dwd, metno}:
    // true = outside its area; plus misses: {dwd: n}, DWD's 404s in a row from inside its
    // area; weather/domain/radar/radar-coverage.js), never the position itself. The settings page reads
    // it as userData.radarCoverage for the note under the Radar provider row.
    RADAR_COVERAGE_KEY: 'radarCoverage',
    // What each weather provider last answered ({v: 1, entries: [{provider, kind, place, at,
    // request, startTime, fields}]}), so a fetch soon after asks nobody again;
    // weather/domain/forecast-snapshot.js says what is kept and how long it serves. The
    // Force weather fetch toggle drops it (index.js), as does a reset.
    FORECAST_SNAPSHOTS_KEY: 'forecastSnapshots'
};
