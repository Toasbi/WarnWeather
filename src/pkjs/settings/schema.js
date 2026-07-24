// src/pkjs/settings/schema.js — ES5, PKJS-parsed. WarnWeather's settings SoT.
var meta = require('../../../package.json');
var BMC_BADGE = require('./bmc-badge.js');
var holidayData = require('./holiday-data.js');
var versionLabel = 'v' + meta.version + (meta.buildProfile === 'dev' ? ' (dev)' : '');
var HOURS = (function () {
    var o = [], h;
    for (h = 0; h < 24; h += 1) {
        o.push([(h < 10 ? '0' + h : String(h)) + ':00', String(h)]);
    }
    return o;
})();
// Per-metric hints, shared by the secondary + third line pickers. Each explains how
// the metric maps to graph height; UV mirrors the precip-percentage phrasing.
var LINE_HINTS = {
    precip_prob: 'Chance of rain each hour<br>— half-height = 50% rain chance<br>— full-height = 100% rain chance',
    wind: 'Wind speed each hour, scaled by the wind graph scale below.',
    gust: 'Wind gust peaks each hour, scaled by the wind graph scale below.',
    uv: 'UV index each hour<br>— half-height = UV 5.5<br>— full-height = UV 11 (extreme)',
    off: 'No third line — temperature and the secondary line only.'
};
// The second metric renders as square dots aligned to the rain bars; its picker reuses the
// per-metric LINE_HINTS prose with a dots note appended. Separate from LINE_HINTS because
// hintByValue REPLACES item.hint (no append), and LINE_HINTS is shared with the solid
// main-metric picker (which must not show the dots note).
var DOTS_NOTE = '<br>Drawn as square dots, aligned to the rain bars.';
var THIRD_LINE_HINTS = {
    precip_prob: LINE_HINTS.precip_prob + DOTS_NOTE,
    wind: LINE_HINTS.wind + DOTS_NOTE,
    gust: LINE_HINTS.gust + DOTS_NOTE,
    uv: LINE_HINTS.uv + DOTS_NOTE,
    off: 'No second metric — temperature and the main metric only.'
};
// Third-line options derived from the secondary metric: Off plus the three metrics
// the secondary line is NOT using, so the same metric can't be picked on both lines.
// The engine's display-snap resets thirdLine if it ever collides (see engine.js).
var THIRD_LINE_OPTIONS = {
    precip_prob: [['Off', 'off'], ['Wind speed', 'wind'], ['Wind gusts', 'gust'], ['UV Index', 'uv']],
    wind: [['Off', 'off'], ['Precipitation %', 'precip_prob'], ['Wind gusts', 'gust'], ['UV Index', 'uv']],
    gust: [['Off', 'off'], ['Precipitation %', 'precip_prob'], ['Wind speed', 'wind'], ['UV Index', 'uv']],
    uv: [['Off', 'off'], ['Precipitation %', 'precip_prob'], ['Wind speed', 'wind'], ['Wind gusts', 'gust']]
};
// windScale ceilings pre-rendered per wind unit, chosen by showWhen on windUnits
// (§2b). Same descriptive tails as the original single hint; only the ceiling +
// unit change. Ceilings: kph 30/50/70 · mph 19/31/43 · kn 16/27/38.
var WIND_SCALE_HINTS_KPH = {
    low: 'Tops out at 30 kph — emphasizes light, gentle winds.',
    mid: 'Tops out at 50 kph — general use; gusts visible, typical winds sit mid-graph.',
    high: 'Tops out at 70 kph — keeps strong gusts from flattening against the top.'
};
var WIND_SCALE_HINTS_MPH = {
    low: 'Tops out at 19 mph — emphasizes light, gentle winds.',
    mid: 'Tops out at 31 mph — general use; gusts visible, typical winds sit mid-graph.',
    high: 'Tops out at 43 mph — keeps strong gusts from flattening against the top.'
};
var WIND_SCALE_HINTS_KNOTS = {
    low: 'Tops out at 16 kn — emphasizes light, gentle winds.',
    mid: 'Tops out at 27 kn — general use; gusts visible, typical winds sit mid-graph.',
    high: 'Tops out at 38 kn — keeps strong gusts from flattening against the top.'
};
// The two line-contexts each windScale copy is gated on (secondary vs. third line),
// combined per-copy with a windUnits equality below.
var WIND_SCALE_WHEN_SECONDARY = {key: 'secondaryLine', in: ['wind', 'gust']};
var WIND_SCALE_WHEN_THIRD = {all: [
    {key: 'thirdLine', in: ['wind', 'gust']},
    {not: {key: 'secondaryLine', in: ['wind', 'gust']}}
]};
// One windScale copy: base line-context AND the given windUnits value, with the
// pre-rendered hint set for that unit. `context` is 'secondary' | 'third'.
function windScaleCopy(context, unit, hints) {
    var lineWhen = context === 'secondary'
        ? [WIND_SCALE_WHEN_SECONDARY]
        : WIND_SCALE_WHEN_THIRD.all;
    return {
        type: 'segmented',
        messageKey: 'windScale',
        label: 'Wind graph scale',
        defaultValue: 'mid',
        joinPrevious: true,
        hintByValue: hints,
        options: [['Low', 'low'], ['Mid', 'mid'], ['High', 'high']],
        showWhen: {all: lineWhen.concat([{key: 'windUnits', eq: unit}])}
    };
}
// Color swatches (5 intensity bands) — shown only in the Multicolor hint.
var SWATCHES = '<span style="display:inline-flex;gap:7px;margin-top:6px;align-items:flex-end;">' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#AAAAAA;margin-bottom:3px;"></span>0.1</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#55FFFF;margin-bottom:3px;"></span>0.5</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#00FF00;margin-bottom:3px;"></span>2</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FFFF00;margin-bottom:3px;"></span>10</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FF5555;margin-bottom:3px;"></span>40</span>' + '</span>';
// Bar color hint depends on the selected mode (hintByValue): Multicolor shows the swatches; White doesn't.
var MULTICOLOR_HINT = 'Colors each part differently depending on intensity:' + SWATCHES;
var WHITE_HINT = 'Shows every bar in a single color.';
// Full-width note between the Bars and Bar color controls (its own staticText) so the prose isn't
// cramped in a control's left column. Color watches only; B/W uses BW_LEGEND.
var SCALE_NOTE = 'The bars don\'t scale linearly. They\'re divided into 5 parts, standing for up to 0.1, 0.5, 2, 10 and 40 mm/h of downfall, so light drizzle stays visible while heavy rain still has room to grow.';
// B/W watches hide the color picker (no colors to choose), so this stands in for COLOR_LEGEND
// there: text-only, since height is the only encoding (no color steps to show).
var BW_LEGEND = 'The bars don\'t scale linearly. They\'re divided into 5 parts, standing for up to 0.1, 0.5, 2, 10 and 40 mm/h of downfall.';
// Per-provider "why it's best" note — the picker's hintByValue, so only the selected provider's
// rationale renders. The hinted-row wrap layout flows it around the trigger and gives it the
// full row width below, so the fuller prose no longer needs its own staticText. The short
// tags live in the dropdown option descs; these give the fuller rationale.
var PROVIDER_WHY = {
    dwd: 'Germany\'s national weather service — the most accurate forecasts across Germany and decent across Central Europe (ICON model). No API key needed.',
    metno: 'The service behind yr.no — best across the Nordics with a 2.5 km model, and solid worldwide. No API key needed.',
    openmeteo: 'Automatically picks the best national model for your location (DWD, NOAA, Météo-France, ECMWF…). Free, no API key.',
    openweathermap: 'A popular general-purpose API with solid worldwide coverage. Needs a free API key on the One Call 3.0 plan.',
    tomorrowio: 'Minute-by-minute hyperlocal forecasts worldwide, from proprietary ML models and satellites. Needs a free API key.',
    wunderground: 'A huge crowd-sourced network of 250,000+ personal weather stations — dense local readings, strongest across the US and Europe. No API key needed.',
    yandex: 'Best across Russia and the CIS, using the Meteum machine-learning forecast. Needs an API key.'
};
var RADAR_WHY = {
    dwd: 'Precise weather radar — rain at your exact spot and nearby (~2 km). Germany only.',
    metno: 'Precise weather radar — rain at your exact spot. Nordics only.',
    rainbow: 'A model nowcast blending satellite and radar — works worldwide.',
    tomorrowio: 'A precise ML rain nowcast, worldwide. Uses your tomorrow.io API key (nothing works without one) and counts against the same call budget.'
};
// The tomorrow.io key + budget guard render under whichever picker actually uses the key:
// the General tab when it's the WEATHER provider, the Radar tab when it's radar-only (so the
// key never sits in the weather section for a non-weather provider). Both contexts reuse the
// same messageKeys (mutually-exclusive showWhen, like the theme color/B&W split).
var TOMORROWIO_WEATHER_WHEN = {key: 'provider', eq: 'tomorrowio'};
var TOMORROWIO_RADAR_ONLY_WHEN = {all: [{key: 'radarProvider', eq: 'tomorrowio'}, {key: 'provider', ne: 'tomorrowio'}]};
// A tap-to-copy button (copy icon) for use inside hint HTML: copies `url` via the engine's delegated
// [data-copy] handler and flashes a "Copied" toast. Used instead of a plain link where tapping is
// useless — e.g. a page that 404s on the mobile site, so users copy the URL and open it on desktop.
// `label` is the accessible name / tooltip; `url` is a trusted constant here (not user input).
function copyBtn(url, label) {
    return '<button type="button" class="copybtn" data-copy="' + url + '" title="' + label + '" aria-label="' + label + '">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>';
}

/**
 * Per-slot phone-only target date, shown only while its owning slot is Countdown.
 * @param {string} slotKey Owning status-slot message key.
 * @param {Object} [barWhen] Existing Radar/Health bar visibility predicate.
 * @returns {Object} Date-control schema item.
 */
function countdownDateItem(slotKey, barWhen) {
    var countdownWhen = {key: slotKey, eq: 'countdown'};
    return {
        type: 'date',
        messageKey: slotKey + 'Countdown',
        label: 'Countdown date',
        defaultFrom: {resolver: 'todayDate'},
        joinPrevious: true,
        showWhen: barWhen ? {all: [barWhen, countdownWhen]} : countdownWhen
    };
}
// The signup link opens in an external browser (target=_blank). The Development > API Keys page 404s on
// tomorrow.io's MOBILE site, so it gets a copy button instead of a (useless-on-mobile) link — users copy
// the URL and open it in desktop-site mode. See copyBtn() + the engine's [data-copy] handler.
var TOMORROWIO_KEY_HINT = '<a target=\'_blank\' href=\'https://app.tomorrow.io/signup\'>Create a free tomorrow.io account</a> (no credit card needed), then open <b>https://app.tomorrow.io/development/keys</b>' + copyBtn('https://app.tomorrow.io/development/keys', 'Copy the API-keys page link') + ', copy your key and paste it here, then Test it. The free plan is plenty — see the call budget below.<br><b>IMPORTANT: On a phone, tomorrow.io\'s mobile site shows an error (404) on the API-keys page — tap the copy button, then open the link in your browser\'s desktop-site mode.</b>';
var TOMORROWIO_BUDGET_HINT = 'Only offer update intervals that fit the free plan. Turn off to pick any interval — over-budget calls are rejected by tomorrow.io until the limit resets, and the watch keeps its last data.';
module.exports = {
    appName: 'WarnWeather',
    themeKey: 'configTheme',
    versionLabel: versionLabel + ' <a href="https://github.com/Toasbi/WarnWeather">GitHub source</a>',
    tabs: [{
        id: 'general', label: 'General', sections: [{
            block: 'noticesPanel',
            items: [{
                type: 'hidden',
                messageKey: 'fetchNoticeAck',
                defaultValue: false
            }]
        }, {
            items: [{
                type: 'select',
                messageKey: 'theme',
                label: 'Theme',
                defaultValue: 'dark',
                hintByValue: {
                    dark: 'Black background, white text/lines (default).',
                    light: 'White background, black text/lines. Graph colors are unchanged for now.',
                    bw: 'Renders exactly like a Black & White watch — same colors, same drawing.',
                    'bw-light': 'Renders exactly like a Black & White watch in its Light theme — black on white.'
                },
                options: [['Dark', 'dark'], ['Light (Alpha)', 'light'], ['B&W', 'bw'], ['B&W Inverted', 'bw-light']],
                showWhen: {env: 'color'},
                onChange: 'themeConvert'
            }, {
                type: 'select',
                messageKey: 'theme',
                label: 'Theme',
                defaultValue: 'dark',
                hintByValue: {
                    dark: 'Black background, white text/lines (default).',
                    light: 'White background, black text/lines. Graph colors are unchanged for now.'
                },
                options: [['Dark', 'dark'], ['Light (Alpha)', 'light']],
                // aplite compiles the light polarity out (no WW_THEME_POLARITY — the
                // theme sweep pushed the image past the 24 KB launch ceiling), so the
                // picker is hidden there entirely; a choice would be a silent no-op.
                // diorite/flint (also B&W) keep this 2-option slot.
                showWhen: {all: [{not: {env: 'color'}}, {env: 'themePolarity'}]},
                onChange: 'themeConvert'
            }, {
                type: 'toggle',
                messageKey: 'sleepNightEnabled',
                label: 'Night battery saver',
                defaultValue: true,
                hint: 'Stop fetching weather between the hours below to save battery.'
            }, {
                type: 'select',
                messageKey: 'sleepStartHour',
                label: 'From',
                defaultValue: '0',
                options: HOURS,
                inline: 'sleepHours',
                joinPrevious: true,
                showWhen: {key: 'sleepNightEnabled', eq: true}
            }, {
                type: 'select',
                messageKey: 'sleepEndHour',
                label: 'To',
                defaultValue: '7',
                options: HOURS,
                inline: 'sleepHours',
                showWhen: {key: 'sleepNightEnabled', eq: true}
            }, {
                type: 'segmented', messageKey: 'locationMode', label: 'Location', defaultValue: 'gps', hintByValue: {
                    gps: 'Detect your location automatically via phone GPS.', manual: 'Enter a city or address below.'
                }, options: [['GPS', 'gps'], ['Manual', 'manual']]
            }, {
                type: 'text',
                messageKey: 'location',
                label: 'Manual location',
                defaultValue: '',
                attributes: {placeholder: 'e.g. Manhattan'},
                hint: 'Example: "Manhattan" or "123 Oak St Plainsville KY".',
                showWhen: {key: 'locationMode', eq: 'manual'}
            }, {
                type: 'select',
                messageKey: 'gpsCacheMin',
                label: 'GPS cache',
                defaultValue: '30',
                joinPrevious: 'loose',
                optionsFrom: {interval: 'fetchIntervalMin', ladder: [30, 60, 120, 360, 720, 1440]},
                showWhen: {key: 'locationMode', eq: 'gps'},
                hint: 'How long a GPS fix is reused before re-acquiring. Longer saves battery; shorter keeps your location fresher on the move. The lowest value matches your update interval.'
            }]
        }, {
            title: 'Provider settings', items: [{
                type: 'select',
                messageKey: 'fetchIntervalMin',
                label: 'Update interval',
                defaultValue: '15',
                hint: 'Updates only send what actually changed (deltas), so short intervals like 5 min stay battery friendly.',
                optionsFrom: {resolver: 'fetchIntervalBudget'}
            }, {
                type: 'select',
                messageKey: 'provider',
                label: 'Weather provider',
                defaultValue: 'wunderground',
                onChange: 'clearPollenForProvider',
                // Flags the country-matched option "(Recommended)" (DE→DWD, Nordics→Met.no, else→Open-Meteo),
                // reading the same country→provider map the wizard uses. See blocks.js recommend resolvers.
                recommendFrom: 'recommendedWeatherProvider',
                // Options are alphabetical by name. The 3rd tuple slot's desc is the short "what it's
                // best at" tag shown under each name in the dropdown; the selected provider's fuller
                // rationale renders via hintByValue (PROVIDER_WHY) — the wrap layout flows it around
                // the trigger and full-width below it.
                // Scope (Germany/Nordics) lives in the desc + the "why" note, not the label —
                // the label stays short so the collapsed trigger doesn't overlap the field label.
                // DWD carries a `short` so the trigger reads "DWD" while the sheet keeps the full name.
                hintByValue: PROVIDER_WHY,
                options: [
                    ['Deutscher Wetterdienst', 'dwd', {desc: 'Best in Germany · no key', short: 'DWD'}],
                    ['Met.no', 'metno', {desc: 'Best in the Nordics (behind yr.no) · no key'}],
                    ['Open-Meteo', 'openmeteo', {desc: 'Good automatic national model selection · no key'}],
                    ['OpenWeatherMap', 'openweathermap', {desc: 'Popular general-purpose API, worldwide · needs a free key'}],
                    ['Tomorrow.io', 'tomorrowio', {desc: 'Precise hyperlocal forecasts, worldwide · needs a free key'}],
                    ['Weather Underground', 'wunderground', {desc: 'Crowd-sourced network of 250,000+ local stations · no key'}],
                    ['Yandex Weather', 'yandex', {desc: 'Best across Russia & CIS · needs a key'}]
                ]
            }, {
                type: 'text',
                messageKey: 'owmApiKey',
                label: 'OpenWeatherMap API key',
                defaultValue: '',
                joinPrevious: 'loose',
                suffixAction: 'testOwmKey',
                suffixLabel: 'Test',
                hint: '<a href=\'https://openweathermap.org/\'>Register an OpenWeatherMap account</a> and paste your API key here, then Test it. The key must be subscribed to <a href=\'https://openweathermap.org/api/one-call-3\'>One Call API 3.0</a> (it has a free allowance) or fetches fail with a 401.',
                showWhen: {key: 'provider', eq: 'openweathermap'}
            }, {
                type: 'text',
                messageKey: 'yandexApiKey',
                label: 'Yandex Weather API key',
                defaultValue: '',
                joinPrevious: 'loose',
                hint: 'Register a Yandex Weather API key at <a href=\'https://yandex.com/dev/weather/\'>yandex.com/dev/weather</a> and paste it here.',
                showWhen: {key: 'provider', eq: 'yandex'}
            }, {
                // Shown here only when tomorrow.io is the WEATHER provider; when it's radar-only the
                // same key + budget guard render in the Radar tab instead (see TOMORROWIO_RADAR_ONLY_WHEN).
                type: 'text',
                messageKey: 'tomorrowioApiKey',
                label: 'Tomorrow.io API key',
                defaultValue: '',
                joinPrevious: 'loose',
                suffixAction: 'testTomorrowioKey',
                suffixLabel: 'Test',
                hint: TOMORROWIO_KEY_HINT,
                showWhen: TOMORROWIO_WEATHER_WHEN
            }, {
                type: 'toggle',
                messageKey: 'tomorrowioFitBudget',
                label: 'Fit update interval to rate limit',
                defaultValue: true,
                joinPrevious: 'loose',
                // blockBefore: the usage read-out sits between the API key field and this
                // toggle, joined into the same tomorrow.io group.
                blockBefore: 'tomorrowioBudget',
                hint: TOMORROWIO_BUDGET_HINT,
                showWhen: TOMORROWIO_WEATHER_WHEN
            }, {
                type: 'select',
                messageKey: 'aqiSource',
                label: 'AQI provider',
                defaultValue: 'waqi',
                hintByValue: {
                    auto: 'Prefers WAQI and falls back to Open-Meteo when no nearby station is available.',
                    waqi: 'WAQI (aqicn.org) reads real monitoring stations — most accurate, but rural / under-monitored areas may have no nearby station and show "--".',
                    openmeteo: 'Open-Meteo is a global model with coverage everywhere.'
                },
                options: [['Auto', 'auto'], ['WAQI', 'waqi'], ['Open-Meteo', 'openmeteo']]
            }]
        }, {
            title: 'Units', items: [{
                type: 'segmented',
                messageKey: 'temperatureUnits',
                label: 'Temperature',
                defaultValue: 'c',
                options: [['°F', 'f'], ['°C', 'c']]
            }, {
                type: 'segmented',
                messageKey: 'aqiScale',
                label: 'Air quality scale',
                defaultValue: 'european',
                options: [['European', 'european'], ['US', 'us']],
                showWhen: {key: 'aqiSource', eq: 'openmeteo'},
                hint: 'Which air-quality index the Open-Meteo source reports. WAQI always uses the US EPA scale.'
            }, {
                type: 'segmented',
                messageKey: 'windUnits',
                label: 'Wind speed',
                defaultValue: 'kph',
                options: [['kph', 'kph'], ['mph', 'mph'], ['Knots', 'knots']],
                hint: 'Unit for the wind and gust status items.'
            }, {
                type: 'segmented',
                messageKey: 'distanceUnits',
                label: 'Distance',
                defaultValue: 'metric',
                options: [['Kilometres', 'metric'], ['Miles', 'imperial']],
                hint: 'Unit for the "Walked distance" status item.'
            }]
        }]
    }, {
        id: 'forecast', label: 'Forecast', sections: [{
            intro: 'The forecast graph looks up to 24 hours ahead. Temperature is always shown; on top of it the main metric (a solid line) shows one of precipitation %, wind speed, wind gusts or UV index, and an optional second metric (drawn as bar-aligned square dots) adds another — plus optional bars for the hourly rain amount.',
            items: [{
                type: 'select',
                messageKey: 'secondaryLine',
                label: 'Main metric',
                defaultValue: 'precip_prob',
                hintByValue: LINE_HINTS,
                options: [['Precipitation %', 'precip_prob'], ['Wind speed', 'wind'], ['Wind gusts', 'gust'], ['UV Index', 'uv']],
                blockBefore: 'forecastPreview',
                blockBeforeSticky: true
            }, {
                type: 'toggle',
                messageKey: 'secondaryLineFill',
                label: 'Fill area below the line',
                defaultValue: true,
                joinPrevious: true,
                hint: 'Fills the area beneath the line.'
            },
            windScaleCopy('secondary', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('secondary', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('secondary', 'knots', WIND_SCALE_HINTS_KNOTS),
            {
                type: 'select',
                messageKey: 'thirdLine',
                label: 'Second metric',
                defaultValue: 'uv',
                hintByValue: THIRD_LINE_HINTS,
                optionsFrom: {byKey: 'secondaryLine', map: THIRD_LINE_OPTIONS}
            },
            windScaleCopy('third', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('third', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('third', 'knots', WIND_SCALE_HINTS_KNOTS),
            {
                type: 'segmented',
                messageKey: 'barSource',
                label: 'Bars',
                defaultValue: 'rain',
                hintByValue: {rain: 'Adds bars that represent the rain amount in one hour.'},
                options: [['Rain', 'rain'], ['Off', 'off']]
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: SCALE_NOTE,
                capabilities: ['COLOR'],
                showWhen: {all: [{key: 'barSource', eq: 'rain'}, {key: 'theme', nin: ['bw', 'bw-light']}]}
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: BW_LEGEND,
                // Effective color: shows whenever the display isn't rendering as color —
                // real B&W hardware OR the Black & White theme (bw/bw-light) on a color watch.
                showWhen: {all: [
                    {not: {all: [{env: 'color'}, {key: 'theme', nin: ['bw', 'bw-light']}]}},
                    {key: 'barSource', eq: 'rain'}
                ]}
            }, {
                type: 'segmented',
                messageKey: 'rainBarColor',
                label: 'Bar color',
                defaultValue: 'multicolor',
                joinPrevious: true,
                hintByValue: {multicolor: MULTICOLOR_HINT, white: WHITE_HINT},
                capabilities: ['COLOR'],
                // VALUE stays 'white' for wire compatibility (the watch resolves it to the
                // right polarity color itself — see rain-tier.js); only the label changes.
                options: [['Multicolor', 'multicolor'], ['Solid', 'white']],
                showWhen: {all: [{key: 'barSource', eq: 'rain'}, {key: 'theme', nin: ['bw', 'bw-light']}]}
            }, {
                type: 'toggle',
                messageKey: 'dayNightShading',
                label: 'Day / night shading',
                defaultValue: true,
                hint: 'Show hatch shading between sunset and sunrise to distinguish day and night on the forecast graph.'
            }]
        }]
    }, {
        // aplite compiles the rain-radar view out (WW_RAIN_RADAR undefined — the 24 KB
        // budget can't afford it), so the whole tab is env-hidden there (tab-level
        // showWhen; see platform.js radar env flag). Mirrors the health tab.
        id: 'radar', label: 'Radar', showWhen: {env: 'radar'}, sections: [{
            intro: 'Rain radar is a second view — a precise short-term rain forecast for your location. Set where it appears in the Layout tab.<br>',
            items: [{
                type: 'radio',
                messageKey: 'radarMode',
                label: 'Radar view',
                defaultValue: 'graph',
                hintByValue: {
                    off: 'Radar is hidden.',
                    countdown: 'Shows a “Rain in X′” countdown in the Watch Status Bar, without adding a separate Radar view.',
                    status: 'Adds the Radar Status Bar while retaining the forecast graph.',
                    graph: 'Also adds the full radar graph.'
                },
                options: [['Off', 'off'], ['Countdown only', 'countdown'], ['Status bar', 'status'], ['Status + Graph', 'graph']],
                onChange: 'resetStatusRadar'
            }, {
                type: 'select',
                messageKey: 'radarProvider',
                label: 'Radar provider',
                defaultValue: 'rainbow',
                showWhen: {key: 'radarMode', ne: 'off'},
                // Flags the country-matched option "(Recommended)" (DE→DWD, Nordics→Met.no, else→Rainbow),
                // the same map the wizard uses. See blocks.js recommend resolvers.
                recommendFrom: 'recommendedRadarProvider',
                // Rainbow is always offered. Builds without a proxy endpoint
                // (dev/forks) still show it; selecting it there fails soft with
                // the Task 2 warning. Production always sets RAINBOW_PROXY_ENDPOINT.
                // desc (3rd tuple slot) = the short "what it's best at" tag under each name in the
                // dropdown, mirroring the weather picker. DWD/Met.no are real radar; Rainbow/Tomorrow.io
                // are model nowcasts (Tomorrow.io is the precise, worldwide one).
                // The selected provider's fuller rationale renders via hintByValue (RADAR_WHY),
                // wrapping around the trigger — mirroring the weather picker.
                // Scope lives in the desc + "why" note, not the label (keeps the trigger short).
                hintByValue: RADAR_WHY,
                options: [
                    ['DWD', 'dwd', {desc: 'Best radar in Germany · exact spot + nearby'}],
                    ['Met.no', 'metno', {desc: 'Best radar in the Nordics · exact spot'}],
                    ['Rainbow', 'rainbow', {desc: 'Global satellite + radar rain nowcast'}],
                    ['Tomorrow.io', 'tomorrowio', {desc: 'Precise ML rain nowcast, worldwide · uses your key'}]
                ]
            }, {
                // Tomorrow.io key + budget guard, radar-only: shown here (under the radar picker) when
                // tomorrow.io drives the radar but is NOT the weather provider, so the key isn't orphaned
                // in the weather section. Same messageKeys as the General-tab pair (mutually exclusive).
                type: 'text',
                messageKey: 'tomorrowioApiKey',
                label: 'Tomorrow.io API key',
                defaultValue: '',
                joinPrevious: 'loose',
                suffixAction: 'testTomorrowioKey',
                suffixLabel: 'Test',
                hint: TOMORROWIO_KEY_HINT,
                showWhen: TOMORROWIO_RADAR_ONLY_WHEN
            }, {
                type: 'toggle',
                messageKey: 'tomorrowioFitBudget',
                label: 'Fit update interval to rate limit',
                defaultValue: true,
                joinPrevious: 'loose',
                blockBefore: 'tomorrowioBudget',
                hint: TOMORROWIO_BUDGET_HINT,
                showWhen: TOMORROWIO_RADAR_ONLY_WHEN
            }, {
                // Radar preview now rides the bar-scale note (blockBefore), so it sits BELOW the picker
                // instead of stickied above it; the note stands as separate info text beneath the preview
                // (no joinPrevious). One of SCALE_NOTE (color) / BW_LEGEND (B/W) shows in graph mode.
                type: 'staticText',
                blockBefore: 'radarPreview',
                text: SCALE_NOTE,
                hinted: true,
                capabilities: ['COLOR'],
                showWhen: {all: [{key: 'radarMode', eq: 'graph'}, {key: 'theme', nin: ['bw', 'bw-light']}]}
            }, {
                type: 'staticText',
                blockBefore: 'radarPreview',
                text: BW_LEGEND,
                hinted: true,
                showWhen: {all: [
                    {not: {all: [{env: 'color'}, {key: 'theme', nin: ['bw', 'bw-light']}]}},
                    {key: 'radarMode', eq: 'graph'}
                ]}
            }, {
                type: 'segmented',
                messageKey: 'radarColor',
                label: 'Radar color',
                defaultValue: 'multicolor',
                hintByValue: {multicolor: MULTICOLOR_HINT, white: WHITE_HINT},
                capabilities: ['COLOR'],
                // VALUE stays 'white' for wire compatibility (the watch resolves it to the
                // right polarity color itself — see rain-tier.js); only the label changes.
                options: [['Multicolor', 'multicolor'], ['Solid', 'white']],
                showWhen: {all: [{key: 'radarMode', eq: 'graph'}, {key: 'theme', nin: ['bw', 'bw-light']}]}
            }, {
                type: 'select',
                messageKey: 'rainCountdownHorizon',
                label: 'Rain countdown',
                defaultValue: '60',
                hint: 'Show a rain countdown in the Watch Status Bar when there is rain at your location within the selected time frame.<br>Because rain radar data is changing frequently, using a lower time window shows fewer false positives.',
                options: [['Within 30 min', '30'], ['Within 60 min', '60'], ['Within 2 hours', '120']],
                showWhen: {all: [{key: 'radarMode', ne: 'off'}, {env: 'platform', ne: 'aplite'}]}
            }]
        }]
    }, {
        // aplite has no health sensors — the watch compiles the view out, so the whole
        // tab is env-hidden there (tab-level showWhen; see platform.js health env flag).
        id: 'health', label: 'Health', showWhen: {env: 'health'}, sections: [{
            intro: 'Show your activity on the watchface: today\'s steps, last night\'s sleep, and current heart rate. Where it appears is set in the Layout tab.',
            items: [{
                type: 'radio',
                messageKey: 'healthMode',
                label: 'Health view',
                defaultValue: 'all',
                hintByValue: {
                    off: 'Health is hidden.',
                    slot: 'Lets you put health items (steps, sleep, heart rate, walked distance) in any status bar, without adding a separate Health view.',
                    status: 'Adds the Health Status Bar — today\'s steps, last night\'s sleep, and current heart rate. Heart rate needs a watch with a heart-rate sensor.',
                    all: 'Also adds a health graph (hourly step bars, a sleep band, and a heart-rate line). Feedback very welcome via <a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a>.'
                },
                options: [['Off', 'off'], ['Status slots only', 'slot'], ['Status bar', 'status'], ['Status + Graph (BETA)', 'all']],
                onChange: 'resetStatusHealth'
            }]
        }]
    }, {
        id: 'watch', label: 'Watch', sections: [{
            // The intro + the four status-bar sections share one groupCard so they render as a
            // single card (each title becomes an in-card sub-header). Time/Calendar below stay
            // their own cards.
            groupCard: 'watchStatus',
            intro: 'Every view has its own status bar — one row with a left, middle, and right slot you can fill with weather, time, health, and more. Choose what each view shows below.',
            items: []
        }, {
            groupCard: 'watchStatus',
            title: 'Forecast Status Bar',
            items: [
                {
                    type: 'select',
                    messageKey: 'statusForecastLeft',
                    label: 'Left slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusForecastLeft'}},
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusForecastLeft', position: 'left'}}
                },
                countdownDateItem('statusForecastLeft'),
                {
                    type: 'select',
                    messageKey: 'statusForecastMid',
                    label: 'Middle slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusForecastMid'}},
                    joinPrevious: true,
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusForecastMid', position: 'mid'}}
                },
                countdownDateItem('statusForecastMid'),
                {
                    type: 'select',
                    messageKey: 'statusForecastRight',
                    label: 'Right slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusForecastRight'}},
                    joinPrevious: true,
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusForecastRight', position: 'right'}}
                },
                countdownDateItem('statusForecastRight')
            ]
        }, {
            groupCard: 'watchStatus',
            title: 'Radar Status Bar',
            items: [
                {
                    type: 'select', messageKey: 'statusRadarLeft', label: 'Left slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusRadarLeft'}},
                    showWhen: {all: [{env: 'radar'}, {key: 'radarMode', in: ['status', 'graph']}]},
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusRadarLeft', position: 'left'}}
                },
                countdownDateItem('statusRadarLeft',
                    {all: [{env: 'radar'}, {key: 'radarMode', in: ['status', 'graph']}]}),
                {
                    type: 'select', messageKey: 'statusRadarMid', label: 'Middle slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusRadarMid'}}, joinPrevious: true,
                    showWhen: {all: [{env: 'radar'}, {key: 'radarMode', in: ['status', 'graph']}]},
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusRadarMid', position: 'mid'}}
                },
                countdownDateItem('statusRadarMid',
                    {all: [{env: 'radar'}, {key: 'radarMode', in: ['status', 'graph']}]}),
                {
                    type: 'select', messageKey: 'statusRadarRight', label: 'Right slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusRadarRight'}}, joinPrevious: true,
                    showWhen: {all: [{env: 'radar'}, {key: 'radarMode', in: ['status', 'graph']}]},
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusRadarRight', position: 'right'}}
                },
                countdownDateItem('statusRadarRight',
                    {all: [{env: 'radar'}, {key: 'radarMode', in: ['status', 'graph']}]})
            ]
        }, {
            groupCard: 'watchStatus',
            title: 'Health Status Bar',
            items: [
                {
                    type: 'select', messageKey: 'statusHealthLeft', label: 'Left slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusHealthLeft'}},
                    showWhen: {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]},
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusHealthLeft', position: 'left'}}
                },
                countdownDateItem('statusHealthLeft',
                    {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]}),
                {
                    type: 'select', messageKey: 'statusHealthMid', label: 'Middle slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusHealthMid'}}, joinPrevious: true,
                    showWhen: {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]},
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusHealthMid', position: 'mid'}}
                },
                countdownDateItem('statusHealthMid',
                    {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]}),
                {
                    type: 'select', messageKey: 'statusHealthRight', label: 'Right slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusHealthRight'}}, joinPrevious: true,
                    showWhen: {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]},
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusHealthRight', position: 'right'}}
                },
                countdownDateItem('statusHealthRight',
                    {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]})
            ]
        }, {
            groupCard: 'watchStatus',
            title: 'Watch Status Bar',
            items: [
                {
                    // aplite compiles out rain radar (WW_RAIN_RADAR), so no incoming-rain
                    // alert can ever replace this bar there — hide the note on aplite.
                    type: 'staticText',
                    text: 'An incoming-rain alert temporarily replaces the left and middle slot.',
                    showWhen: {env: 'platform', ne: 'aplite'}
                },
                {
                    // joinPrevious drops the divider between the incoming-rain note above and
                    // the slots, so the Watch Status Bar note flows straight into its slots.
                    // On aplite the note is hidden, so this simply becomes the first item.
                    type: 'select', messageKey: 'statusTopLeft', label: 'Left slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusTopLeft'}}, joinPrevious: true,
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusTopLeft', position: 'left'}}
                },
                countdownDateItem('statusTopLeft'),
                {
                    type: 'select', messageKey: 'statusTopMid', label: 'Middle slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusTopMid'}}, joinPrevious: true,
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusTopMid', position: 'mid'}}
                },
                countdownDateItem('statusTopMid'),
                {
                    type: 'select', messageKey: 'statusTopRight', label: 'Right slot',
                    defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: 'statusTopRight'}}, joinPrevious: true,
                    onChange: 'dedupeStatusSlot',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {slotKey: 'statusTopRight', position: 'right'}}
                },
                countdownDateItem('statusTopRight'),
                {
                    type: 'toggle', messageKey: 'batteryLowOnly', label: 'Show battery below 10%',
                    defaultValue: true,
                    hint: 'Replaces the top-right slot when your battery drops below 10%.'
                },
                {type: 'toggle', messageKey: 'showQt', label: 'Show quiet time icon', defaultValue: true},
                {
                    type: 'toggle', messageKey: 'vibe', label: 'Vibrate on bluetooth disconnect',
                    defaultValue: false
                },
                {
                    // joinPrevious groups the bluetooth icon select with the vibrate-on-disconnect
                    // toggle above it (no divider between the two bluetooth settings); the divider
                    // stays between "Show quiet time icon" and "Vibrate on bluetooth disconnect".
                    type: 'select',
                    messageKey: 'btIcons',
                    label: 'Show icon for bluetooth',
                    defaultValue: 'disconnected',
                    joinPrevious: 'loose',
                    options: [['Disconnected', 'disconnected'], ['Connected', 'connected'], ['Both', 'both'], ['None', 'none']]
                }
            ]
        }, {
            title: 'Time', items: [{
                type: 'toggle', messageKey: 'timeLeadingZero', label: 'Leading zero', defaultValue: false
            }, {type: 'toggle', messageKey: 'timeShowAmPm', label: 'Show AM / PM', defaultValue: false}, {
                type: 'segmented',
                messageKey: 'axisTimeFormat',
                label: 'Axis time format',
                defaultValue: '24h',
                hint: 'Tip: Settings &gt; Date &amp; Time &gt; Time Format changes the main time format.',
                options: [['12h', '12h'], ['24h', '24h']]
            }, {
                type: 'segmented',
                messageKey: 'timeFont',
                label: 'Main time font',
                defaultValue: 'roboto',
                options: [['Roboto', 'roboto'], ['Leco', 'leco'], ['Bitham', 'bitham']]
            }, {
                type: 'color',
                messageKey: 'colorTime',
                label: 'Main time color',
                defaultValue: 0xFFFFFF,
                capabilities: ['COLOR'],
                showWhen: {key: 'theme', nin: ['bw', 'bw-light']}
            }]
        }, {
            title: 'Calendar', items: [{
                type: 'segmented',
                messageKey: 'weekStartDay',
                label: 'Start week on',
                defaultValue: 'mon',
                options: [['Sun', 'sun'], ['Mon', 'mon']]
            }, {
                type: 'segmented',
                messageKey: 'firstWeek',
                label: 'First week to display',
                defaultValue: 'prev',
                options: [['Prev', 'prev'], ['Curr', 'curr']]
            }, {
                type: 'color',
                messageKey: 'colorToday',
                label: 'Today highlight',
                defaultValue: 0,
                capabilities: ['COLOR'],
                hint: 'Black (default) means match date color; any other value overrides it.',
                showWhen: {key: 'theme', nin: ['bw', 'bw-light']}
            }, {
                type: 'color',
                messageKey: 'colorSunday',
                label: 'Sunday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                showWhen: {key: 'theme', nin: ['bw', 'bw-light']}
            }, {
                type: 'color',
                messageKey: 'colorSaturday',
                label: 'Saturday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                showWhen: {key: 'theme', nin: ['bw', 'bw-light']}
            }, {type: 'toggle', messageKey: 'holidaysEnabled', label: 'Holiday highlight', defaultValue: true}, {
                type: 'color',
                messageKey: 'colorUSFederal',
                label: 'Holiday color',
                defaultValue: 0x0055FF,
                capabilities: ['COLOR'],
                // White is the "no highlight" appearance in dark; the holidaysEnabled
                // toggle owns on/off instead of a special color.
                excludeColors: ['#FFFFFF'],
                joinPrevious: 'loose',
                showWhen: {all: [{key: 'holidaysEnabled', eq: true}, {key: 'theme', eq: 'dark'}]}
            }, {
                type: 'color',
                messageKey: 'colorUSFederal',
                label: 'Holiday color',
                defaultValue: 0x0055FF,
                capabilities: ['COLOR'],
                // Black is the "no highlight" appearance in the light theme instead.
                excludeColors: ['#000000'],
                joinPrevious: 'loose',
                showWhen: {all: [{key: 'holidaysEnabled', eq: true}, {key: 'theme', eq: 'light'}]}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayCountry',
                label: 'Country',
                defaultValue: 'DE',
                joinPrevious: true,
                options: holidayData.COUNTRY_OPTIONS,
                showWhen: {key: 'holidaysEnabled', eq: true}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegion',
                label: 'Region',
                defaultValue: 'all',
                joinPrevious: true,
                optionsFrom: {byKey: 'holidayCountry', map: holidayData.REGION_OPTIONS},
                showWhen: {
                    all: [{
                        key: 'holidayCountry',
                        in: Object.keys(holidayData.REGION_OPTIONS)
                    }, {key: 'holidaysEnabled', eq: true}]
                }
            }]
        }]
    }, {
        id: 'layout', label: 'Layout', sections: [{
            intro: 'How the watchface is arranged, and what a wrist-flick reveals — shown side by side in the preview. What a metric means or how it\'s coloured lives in its own tab.',
            items: [{
                type: 'radio',
                messageKey: 'layoutPreset',
                label: 'Layout preset',
                defaultValue: 'compactCal',
                hintByValue: {
                    fullCal: '3-row calendar. Health and radar appear on wrist-flicks.',
                    compactCal: '2-row calendar. Flick to radar and health as you enable them.',
                    compactDense: 'Compact calendar with the Health and Forecast Status Bars shown together.',
                    noCal: 'No calendar — a big forecast. Flick to radar and health.'
                },
                // Compact-dense only differs from Compact when a health status row OR the
                // radar status row is shown; with both off the two produce identical cycles,
                // so it's hidden then. A stored compactDense falls back to the default
                // (compactCal) via the defaultValue-snap in engine.resolveRowItem. Order
                // stays constant (compactDense between compactCal and noCal) so toggling
                // health/radar doesn't reshuffle the list. See the layoutPresetOptions
                // resolver in blocks.js.
                optionsFrom: { resolver: 'layoutPresetOptions' },
                blockBefore: 'layoutPreviewCombined',
                blockBeforeSticky: true
            }, {
                type: 'segmented',
                messageKey: 'viewResetMin',
                label: 'View reset time',
                defaultValue: '2',
                hint: 'Automatically return to the default view after the selected time has passed.',
                options: [['Never', '0'], ['1m', '1'], ['2m', '2'], ['5m', '5'], ['10m', '10']],
                showWhen: {env: 'platform', ne: 'aplite'}
            }, {
                type: 'toggle',
                messageKey: 'swapClockStatus',
                label: 'Swap clock and status row',
                defaultValue: false,
                hint: 'Move the status row below the clock, next to the forecast.',
                showWhen: {
                    all: [
                        {key: 'layoutPreset', eq: 'compactCal'},
                        {env: 'platform', ne: 'aplite'}
                    ]
                }
            }]
        }]
    }, {
        id: 'more', label: 'More', sections: [{
            title: 'Misc',
            items: [{
                type: 'toggle',
                messageKey: 'telemetryEnabled',
                label: 'Share anonymous telemetry',
                defaultValue: true,
                hint: 'Share privacy-respecting weather telemetry to improve reliability and understand usage patterns. Learn more about what gets sent in the <a href="https://github.com/Toasbi/WarnWeather#telemetry">Telemetry section</a>.'
            }, {
                type: 'button',
                label: 'Run setup again',
                action: 'startWizard',
                hint: 'Re-open the first-run setup wizard.'
            }, {
                // Config-UI-only flag: set true when onboarding is finished/skipped so the
                // wizard never auto-opens again. Rides the saved-settings blob (localStorage);
                // NOT a messageKey — never sent to the watch.
                type: 'hidden',
                messageKey: 'onboardingDone',
                defaultValue: false
            }]
        }, {
            title: 'Links', items: [{
                type: 'staticText',
                text: '<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;">' + '<span style="font-size:14.5px;font-weight:600;color:var(--lbl);">Help</span>' + '<a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a></div>'
            }, {
                type: 'staticText',
                text: '<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;">' + '<span style="font-size:14.5px;font-weight:600;color:var(--lbl);">Support me <3</span>' + '<a href="https://buymeacoffee.com/toaster2"><img alt="Buy me a coffee" style="height:40px;width:auto;display:block;" src="' + BMC_BADGE + '"></a></div>'
            }]
        }, {
            title: 'Advanced', collapsible: true, items: [{
                type: 'segmented',
                messageKey: 'configTheme',
                label: 'Settings Theme',
                defaultValue: 'auto',
                options: [['Auto', 'auto'], ['Light', 'light'], ['Dark', 'dark']],
                hint: 'Auto follows your Pebble app theme. The watchface itself is unaffected.'
            }, {
                type: 'toggle',
                messageKey: 'fetch',
                label: 'Force weather fetch',
                defaultValue: false,
                hint: 'Re-fetch the weather the moment you save.',
                block: 'lastFetch'
            }, {
                type: 'toggle',
                messageKey: 'devStatsEnabled',
                label: 'Enable connection stats',
                defaultValue: false,
                hint: 'Locally records connection events sent to the watch. Events older than 7 days are deleted.'
            }, {
                type: 'toggle',
                messageKey: 'reset',
                label: 'Reset watchface',
                defaultValue: false,
                hint: 'When you save, this erases all settings and cached data and re-runs first-time setup. This cannot be undone.'
            }]
        }, {
            title: 'Connection stats', collapsible: true, block: 'devStats', items: [{
                type: 'toggle',
                messageKey: 'devStatsClear',
                label: 'Clear connection stats',
                defaultValue: false,
                showWhen: {key: 'devStatsEnabled', eq: true}
            }]
        }]
    }]
};
