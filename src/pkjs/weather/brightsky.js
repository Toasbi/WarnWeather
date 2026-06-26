// src/pkjs/weather/brightsky.js
//
// Shared base URL for the Brightsky (Deutscher Wetterdienst) API, used by both
// the DWD forecast/current provider (dwd.js) and the rain-radar nowcast
// (radar.js). Kept in one place so the two callers can't drift apart.

var BASE_URL = 'https://api.brightsky.dev';

module.exports = { BASE_URL: BASE_URL };
