// Where each phone-app and settings-page file belongs (docs/adr/0005-architecture-rules.md):
// its domain context and its role. A file placed at src/pkjs/<context>/<role>/… needs no entry:
// its path says it. This table holds the files not yet moved there, so it only shrinks.
//
// Contexts: weather, forecast-graphs, status-bars, alerts, layout, calendar, theme, health,
// settings, wire, notices, telemetry. Two homes are not contexts: shell (the composition root)
// and lib (generic helpers). Roles: domain, application, adapter for the phone app; page for
// the settings page's files, and page-engine for config-ui, the engine that knows nothing of
// WarnWeather.

const HOMES = {
  'shell': ['index.js', 'fetch-cycle.js'],
  'lib': ['polyfills.js', 'utf8.js', 'wire-units.js', 'config-ui/lib/color.js',
    'config-ui/lib/platform.js'],

  'weather/domain': [
    'forecast-series.js', 'forecast-span.js', 'forecast-span-hours.js', 'key-fingerprint.js',
    'weather/cloud-cover.js', 'weather/condition.js', 'weather/coords.js', 'weather/feels-like.js',
    'weather/fetch-options.js', 'weather/hourly-window.js', 'weather/pressure-plausibility.js',
    'weather/radar-dedupe.js', 'weather/radar-sky.js', 'weather/radar-wire.js',
    'weather/rain-tier.js', 'weather/sun-events.js',
    'settings/weather-tab-model.js',
  ],
  'weather/application': [
    'auth-backoff.js', 'provider-factory.js', 'weather/provider.js', 'weather/radar-factory.js',
  ],
  'weather/adapter': [
    'active-fixture.generated.js', 'fixture-weather.js', 'key-result.js',
    'settings/weather-tab-data.js', 'weather-tab-cache.js',
    'weather/air-quality.js', 'weather/brightsky.js', 'weather/day-peaks.js',
    'weather/dwd-radar.js', 'weather/dwd.js', 'weather/http.js', 'weather/location.js',
    'weather/metno-headers.js', 'weather/metno-radar.js', 'weather/metno.js',
    'weather/openmeteo.js', 'weather/openweathermap.js', 'weather/pollen.js',
    'weather/radar-coverage.js', 'weather/radar-fetch.js', 'weather/rainbow-radar.js',
    'weather/tomorrowio-radar.js', 'weather/tomorrowio.js', 'weather/wu-current-hour-cache.js',
    'weather/wunderground.js', 'weather/yandex.js',
  ],

  'forecast-graphs/domain': [
    'draw-from.js', 'forecast-axis.js', 'graph-styles.js', 'line-style.js', 'stripe-levels.js',
    'weather/graph-style-wire.js', 'weather/graph-wire.js',
  ],

  'status-bars/domain': [
    'city-ladder.js', 'on-demand.js', 'slot-text.js', 'status-line-catalog.js',
    'status-lines.js', 'status-pair.js',
  ],
  'status-bars/application': ['status-rebake.js'],
  'status-bars/adapter': ['phone-battery.js'],

  'alerts/domain': ['line-alert.js', 'status-thresholds.js', 'status-wire.js'],

  'layout/domain': [
    'screens.js', 'view-cycle.js',
  ],

  'calendar/domain': ['date-format.js', 'holidays/holiday-mask.js', 'holidays/serial-day.js'],
  'calendar/adapter': ['holidays/nager-source.js'],

  'theme/domain': [
    'night-light.js', 'pebble-colors.js', 'resolve-ink.js', 'settings/preview-palette.js',
    'theme-flip.js', 'theme-schedule.js',
  ],

  'health/domain': ['sleep-window.js'],

  'settings/domain': [
    'clay-payload.js', 'config-close.js', 'render-signature.js', 'storage-keys.js',
    'migrations/alert-defaults.js', 'migrations/graph-colors.js', 'migrations/holidays.js',
    'migrations/light-theme.js', 'migrations/line-styles.js', 'migrations/onboarding.js',
    'migrations/radar.js', 'migrations/registry.js', 'migrations/screens.js',
    'migrations/seed-pairs.js', 'migrations/status-slots.js', 'migrations/v1_24.js',
  ],
  'settings/application': ['clay-migrations.js'],
  'settings/adapter': ['clay-settings.js'],

  'wire/application': ['change-detector.js', 'channel-scheduler.js'],
  'wire/adapter': ['outbox.js'],

  'notices/application': [
    'notices.js', 'release-notifications.js', 'settings/news-protocol.js', 'update-check.js',
  ],
  'notices/adapter': ['news-cache.js', 'notify-watch.js', 'update-check-runner.js'],

  'telemetry/application': ['telemetry-settings.js'],
  'telemetry/adapter': ['dev-stats.js', 'telemetry.js'],

  // The settings page.
  'page-engine': [
    'config-ui/index.js', 'config-ui/scripts/build-page.js', 'config-ui/lib/checklist.js',
    'config-ui/lib/date-picker.js', 'config-ui/lib/defaults.js',
    'config-ui/lib/engine.js', 'config-ui/lib/html.js', 'config-ui/lib/links.js',
    'config-ui/lib/range-control.js',
    'config-ui/lib/rgb-control.js', 'config-ui/lib/schema-walk.js', 'config-ui/lib/show-when.js',
    'config-ui/lib/ui.js',
  ],
  'settings/page': [
    'settings/blocks.js', 'settings/bmc-badge.js', 'settings/country-defaults.js',
    'settings/defaults-policy.js', 'settings/index.js', 'settings/onbuild.js',
    'settings/page.generated.js', 'settings/preview-svg.js', 'settings/schema-gates.js',
    'settings/schema.js', 'settings/support.js', 'settings/tab-icons.js',
    'settings/when-resolvers.js', 'settings/wizard-css.js', 'settings/wizard-finish.js',
    'settings/wizard-forecast.js',
    'settings/wizard-screens.js', 'settings/wizard-upsell.js',
    'settings/wizard.js',
  ],
  'weather/page': [
    'settings/condition-glyphs.generated.js', 'settings/condition-pixels.generated.js',
    'settings/interval-budget.js', 'settings/key-sources.js', 'settings/key-status.js',
    'settings/key-test.js', 'settings/owm-key-test.js', 'settings/preview-radar.js',
    'settings/rainbow-budget.js', 'settings/rainbow-key-test.js', 'settings/tomorrowio-budget.js',
    'settings/tomorrowio-key-test.js', 'settings/weather-tab.js', 'settings/weather-tab-charts.js',
    'settings/weather-tab-css.js', 'settings/weather-tab-icons.js',
    'settings/weather-tab-interact.js',
    'settings/weather-tab-readouts.js',
  ],
  'forecast-graphs/page': [
    'settings/forecast-hints.js', 'settings/forecast-lines-schema.js',
    'settings/forecast-metrics.js', 'settings/forecast-sample.js', 'settings/graph-styles-page.js',
    'settings/preview-axis.js', 'settings/preview-forecast.js', 'settings/preview-rain.js',
    'settings/preview-stripe.js',
  ],
  'status-bars/page': [
    'settings/preview-status-bars.js', 'settings/reset-status-defaults.js',
    'settings/status-slot-icons.js',
  ],
  'alerts/page': [
    'settings/alerts-page.js', 'settings/alerts-schema.js', 'settings/level-rows-schema.js',
  ],
  'layout/page': [
    'screen-presets.js', 'settings/clock-glyphs.generated.js', 'settings/custom-layout-schema.js',
    'settings/preview-watch.js', 'settings/screen-frame.js', 'settings/screen-legend.js',
    'settings/screens-page.js', 'settings/watch-fonts.generated.js', 'settings/watch-text.js',
  ],
  'calendar/page': ['settings/holiday-data.js'],
  'theme/page': [
    'settings/night-hours.js', 'settings/theme-convert.js',
    'settings/vendor-suncalc.js',
  ],
  'health/page': ['settings/preview-health.js'],
  'notices/page': ['settings/news.js', 'settings/notices-panel.js'],
  'telemetry/page': ['settings/preview-diagnostics.js'],
};

const CONTEXTS = ['weather', 'forecast-graphs', 'status-bars', 'alerts', 'layout', 'calendar',
  'theme', 'health', 'settings', 'wire', 'notices', 'telemetry'];
const ROLES = ['domain', 'application', 'adapter'];

const BY_FILE = {};
Object.keys(HOMES).forEach((home) => {
  HOMES[home].forEach((f) => {
    if (BY_FILE[f]) { throw new Error(`${f} has two homes: ${BY_FILE[f]} and ${home}`); }
    BY_FILE[f] = home;
  });
});

/**
 * A file's home, from its path once it sits in src/pkjs/<context>/<role>/, else from HOMES.
 * @param {string} rel path relative to src/pkjs, with forward slashes
 * @returns {?{context: string, role: string}} null when the file has no home
 */
function homeOf(rel) {
  const parts = rel.split('/');
  if (parts.length > 2 && CONTEXTS.indexOf(parts[0]) !== -1 && ROLES.indexOf(parts[1]) !== -1) {
    return { context: parts[0], role: parts[1] };
  }
  const home = BY_FILE[rel];
  if (!home) { return null; }
  const [context, role] = home.split('/');
  return { context, role: role || context };
}

module.exports = { HOMES, CONTEXTS, ROLES, homeOf };
