module.exports = {
    FETCH_ATTEMPT_KEY: 'weather_fetch_attempt',
    LAST_FETCH_SUCCESS_KEY: 'lastFetchSuccess',
    LAST_FETCH_ATTEMPT_KEY: 'lastFetchAttempt',
    GEOCODE_CACHE_KEY: 'geocodeCache',
    GEOCODE_BACKOFF_KEY: 'geocodeBackoff',
    AUTH_BACKOFF_KEY: 'authBackoff',
    LAST_IS_SLEEPING_KEY: 'lastIsSleeping',
    LAST_HOLIDAY_DAY_KEY: 'last_holiday_day',
    LAST_SENT_FORECAST_KEY: 'lastSentForecast',
    LAST_SENT_STATUS_KEY: 'lastSentStatus',
    LAST_SENT_SUN_KEY: 'lastSentSun',
    LAST_SENT_RADAR_KEY: 'lastSentRadar',
    LAST_SENT_SLEEP_KEY: 'lastSentSleep',
    LAST_SENT_CLAY_KEY: 'lastSentClaySettings',
    DEV_STATS_KEY: 'devStats',
    HOLIDAY_CACHE_PREFIX: 'holidays_',
    HOLIDAY_BACKOFF_PREFIX: 'holidaysBackoff_',
    UPDATE_NOTIFIED_VERSION_KEY: 'update_notified_version',
    LAST_UPDATE_CHECK_KEY: 'last_update_check',
    WU_HOURLY_CACHE_KEY: 'wuHourlyCache',
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
    PHONE_BATTERY_SNAPSHOT: 'phoneBatterySnapshot'
};
