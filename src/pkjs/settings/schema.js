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
module.exports = {
    appName: 'WarnWeather',
    themeKey: 'configTheme',
    versionLabel: versionLabel + ' <a href="https://github.com/Toasbi/WarnWeather">GitHub source</a>',
    tabs: [{
        id: 'general', label: 'General', sections: [{
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
                type: 'select',
                messageKey: 'fetchIntervalMin',
                label: 'Update interval',
                defaultValue: '15',
                hint: 'Updates only send what actually changed (deltas), so short intervals like 5 min stay battery friendly.',
                options: [['5 minutes', '5'], ['10 minutes', '10'], ['15 minutes', '15'], ['30 minutes', '30'], ['1 hour', '60']]
            }, {
                type: 'toggle',
                messageKey: 'sleepNightEnabled',
                label: 'Pause weather at night',
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
                type: 'radio',
                messageKey: 'provider',
                label: 'Provider',
                defaultValue: 'wunderground',
                onChange: 'clearPollenForProvider',
                hintByValue: {
                    wunderground: 'Global · no API key needed.',
                    openweathermap: 'Global · enter API key below.',
                    dwd: 'Germany only · no API key needed.',
                    openmeteo: 'Global · no API key needed.',
                    metno: 'Nordics · the service behind yr.no · 2.5 km model · no API key needed.'
                },
                options: [['Weather Underground', 'wunderground'], ['OpenWeatherMap', 'openweathermap'], ['Deutscher Wetterdienst (Germany only)', 'dwd'], ['Open-Meteo', 'openmeteo'], ['Met.no (Nordics only)', 'metno']]
            }, {
                type: 'text',
                messageKey: 'owmApiKey',
                label: 'OpenWeatherMap API key',
                defaultValue: '',
                joinPrevious: true,
                suffixAction: 'testOwmKey',
                suffixLabel: 'Test',
                hint: '<a href=\'https://openweathermap.org/\'>Register an OpenWeatherMap account</a> and paste your API key here, then Test it. The key must be subscribed to <a href=\'https://openweathermap.org/api/one-call-3\'>One Call API 3.0</a> (it has a free allowance) or fetches fail with a 401. Saving a changed key re-fetches automatically.',
                showWhen: {key: 'provider', eq: 'openweathermap'}
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
                joinPrevious: true,
                optionsFrom: {interval: 'fetchIntervalMin', ladder: [30, 60, 120, 360, 720, 1440]},
                showWhen: {key: 'locationMode', eq: 'gps'},
                hint: 'How long a GPS fix is reused before re-acquiring. Longer saves battery; shorter keeps your location fresher on the move. The lowest value matches your update interval.'
            }]
        }, {
            title: 'Units', items: [{
                type: 'segmented',
                messageKey: 'temperatureUnits',
                label: 'Temperature',
                defaultValue: 'c',
                options: [['°F', 'f'], ['°C', 'c']]
            }, {
                type: 'select',
                messageKey: 'aqiSource',
                label: 'AQI source',
                defaultValue: 'waqi',
                options: [['WAQI', 'waqi'], ['Auto', 'auto'], ['Open-Meteo', 'openmeteo']]
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: 'WAQI (aqicn.org) reads real monitoring stations — most accurate, but rural / under-monitored areas may have no nearby station and show "--". Auto prefers WAQI and falls back to Open-Meteo. Open-Meteo is a global model with coverage everywhere.'
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
                joinPrevious: true,
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
                type: 'select',
                messageKey: 'radarProvider',
                label: 'Radar provider',
                defaultValue: 'rainbow',
                hintByValue: {
                    dwd: 'Precise weather radar — rain at your exact spot and nearby (~2 km).',
                    metno: 'Precise weather radar — rain at your exact spot.',
                    rainbow: 'Model-based nowcast, works worldwide.'
                },
                // Rainbow is always offered. Builds without a proxy endpoint
                // (dev/forks) still show it; selecting it there fails soft with
                // the Task 2 warning. Production always sets RAINBOW_PROXY_ENDPOINT.
                options: [['DWD (Germany only)', 'dwd'], ['Met.no (Nordics only)', 'metno'], ['Rainbow (Worldwide)', 'rainbow'], ['Off', 'disabled']],
                blockBefore: 'radarPreview',
                blockBeforeSticky: true,
                onChange: 'resetStatusRadar'
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: SCALE_NOTE,
                capabilities: ['COLOR'],
                showWhen: {all: [{key: 'radarProvider', ne: 'disabled'}, {key: 'theme', nin: ['bw', 'bw-light']}]}
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: BW_LEGEND,
                showWhen: {all: [
                    {not: {all: [{env: 'color'}, {key: 'theme', nin: ['bw', 'bw-light']}]}},
                    {key: 'radarProvider', ne: 'disabled'}
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
                showWhen: {all: [{key: 'radarProvider', ne: 'disabled'}, {key: 'theme', nin: ['bw', 'bw-light']}]}
            }, {
                type: 'select',
                messageKey: 'rainCountdownHorizon',
                label: 'Rain Alert',
                defaultValue: '60',
                hint: 'Show an incoming rain alert in the Watch Status Bar when there is rain at your location within the selected time frame.',
                options: [['Off', '0'], ['Within 30 min', '30'], ['Within 60 min', '60'], ['Within 2 hours', '120']],
                showWhen: {all: [{key: 'radarProvider', ne: 'disabled'}, {env: 'platform', ne: 'aplite'}]}
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: 'Because rain radar data is changing frequently, using a lower time window shows fewer false positives.',
                showWhen: {key: 'radarProvider', ne: 'disabled'}
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
                label: 'Health view (BETA)',
                defaultValue: 'all',
                hintByValue: {
                    off: 'Health is hidden.',
                    status: 'Adds the Health Status Bar — today\'s steps, last night\'s sleep, and current heart rate. Heart rate needs a watch with a heart-rate sensor.',
                    all: 'Also adds a health graph (hourly step bars, a sleep band, and a heart-rate line). Feedback very welcome via <a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a>.'
                },
                options: [['Off', 'off'], ['Status bar', 'status'], ['Status + Graph (ALPHA)', 'all']],
                onChange: 'resetStatusHealth'
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
                // Compact-dense only differs from Compact when a health status row is shown;
                // with health off the two produce identical cycles, so it's hidden then. A
                // stored compactDense falls back to the default (compactCal) via the
                // defaultValue-snap in engine.resolveRowItem. Order stays constant across
                // modes so toggling health doesn't reshuffle the list.
                optionsFrom: { byKey: 'healthMode', map: {
                    off: [
                        ['Full calendar', 'fullCal'],
                        ['Compact calendar', 'compactCal'],
                        ['No calendar', 'noCal']
                    ],
                    status: [
                        ['Full calendar', 'fullCal'],
                        ['Compact calendar', 'compactCal'],
                        ['Compact calendar (dense)', 'compactDense'],
                        ['No calendar', 'noCal']
                    ],
                    all: [
                        ['Full calendar', 'fullCal'],
                        ['Compact calendar', 'compactCal'],
                        ['Compact calendar (dense)', 'compactDense'],
                        ['No calendar', 'noCal']
                    ]
                } },
                blockBefore: 'layoutPreviewCombined',
                blockBeforeSticky: true
            }, {
                type: 'segmented',
                messageKey: 'viewResetMin',
                label: 'View reset time',
                defaultValue: '2',
                options: [['Never', '0'], ['1m', '1'], ['2m', '2'], ['5m', '5'], ['10m', '10']],
                showWhen: {env: 'platform', ne: 'aplite'}
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: 'Automatically return to the default view after the selected time has passed.',
                showWhen: {env: 'platform', ne: 'aplite'}
            }]
        }]
    }, {
        id: 'watch', label: 'Watch', sections: [{
            intro: 'Every view has its own status bar — one row with a left, middle, and right slot you can fill with weather, time, health, and more. Choose what each view shows below.',
            items: []
        }, {
            title: 'Forecast Status Bar',
            items: [
                {
                    type: 'searchSelect',
                    messageKey: 'statusForecastLeft',
                    label: 'Left slot',
                    defaultValue: 'temp',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusForecastMid', 'statusForecastRight'],
                               slotKey: 'statusForecastLeft', position: 'left'}}
                },
                {
                    type: 'searchSelect',
                    messageKey: 'statusForecastMid',
                    label: 'Middle slot',
                    defaultValue: 'city',
                    joinPrevious: true,
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusForecastLeft', 'statusForecastRight'],
                               slotKey: 'statusForecastMid', position: 'mid'}}
                },
                {
                    type: 'searchSelect',
                    messageKey: 'statusForecastRight',
                    label: 'Right slot',
                    defaultValue: 'sun',
                    joinPrevious: true,
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusForecastLeft', 'statusForecastMid'],
                               slotKey: 'statusForecastRight', position: 'right'}}
                }
            ]
        }, {
            title: 'Radar Status Bar',
            items: [
                {
                    type: 'searchSelect', messageKey: 'statusRadarLeft', label: 'Left slot',
                    defaultValue: 'temp',
                    showWhen: {all: [{env: 'radar'}, {key: 'radarProvider', ne: 'disabled'}]},
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusRadarMid', 'statusRadarRight'],
                               slotKey: 'statusRadarLeft', position: 'left'}}
                },
                {
                    type: 'searchSelect', messageKey: 'statusRadarMid', label: 'Middle slot',
                    defaultValue: 'city', joinPrevious: true,
                    showWhen: {all: [{env: 'radar'}, {key: 'radarProvider', ne: 'disabled'}]},
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusRadarLeft', 'statusRadarRight'],
                               slotKey: 'statusRadarMid', position: 'mid'}}
                },
                {
                    type: 'searchSelect', messageKey: 'statusRadarRight', label: 'Right slot',
                    defaultValue: 'sun', joinPrevious: true,
                    showWhen: {all: [{env: 'radar'}, {key: 'radarProvider', ne: 'disabled'}]},
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusRadarLeft', 'statusRadarMid'],
                               slotKey: 'statusRadarRight', position: 'right'}}
                }
            ]
        }, {
            title: 'Health Status Bar',
            items: [
                {
                    type: 'searchSelect', messageKey: 'statusHealthLeft', label: 'Left slot',
                    defaultValue: 'steps',
                    showWhen: {all: [{env: 'health'}, {key: 'healthMode', ne: 'off'}]},
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusHealthMid', 'statusHealthRight'],
                               slotKey: 'statusHealthLeft', position: 'left'}}
                },
                {
                    type: 'searchSelect', messageKey: 'statusHealthMid', label: 'Middle slot',
                    defaultValue: 'empty', joinPrevious: true,
                    showWhen: {all: [{env: 'health'}, {key: 'healthMode', ne: 'off'}]},
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusHealthLeft', 'statusHealthRight'],
                               slotKey: 'statusHealthMid', position: 'mid'}}
                },
                {
                    type: 'searchSelect', messageKey: 'statusHealthRight', label: 'Right slot',
                    defaultValue: 'sleep', joinPrevious: true,
                    showWhen: {all: [{env: 'health'}, {key: 'healthMode', ne: 'off'}]},
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusHealthLeft', 'statusHealthMid'],
                               slotKey: 'statusHealthRight', position: 'right'}}
                }
            ]
        }, {
            title: 'Watch Status Bar',
            items: [
                {
                    type: 'staticText',
                    text: 'An incoming-rain alert temporarily replaces this bar.'
                },
                {
                    type: 'searchSelect', messageKey: 'statusTopLeft', label: 'Left slot',
                    defaultValue: 'empty',
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusTopMid', 'statusTopRight'],
                               slotKey: 'statusTopLeft', position: 'left'}}
                },
                {
                    type: 'searchSelect', messageKey: 'statusTopMid', label: 'Middle slot',
                    defaultValue: 'date', joinPrevious: true,
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusTopLeft', 'statusTopRight'],
                               slotKey: 'statusTopMid', position: 'mid'}}
                },
                {
                    type: 'searchSelect', messageKey: 'statusTopRight', label: 'Right slot',
                    defaultValue: 'battery', joinPrevious: true,
                    optionsFrom: {resolver: 'statusSlot',
                        args: {excludeKeys: ['statusTopLeft', 'statusTopMid'],
                               slotKey: 'statusTopRight', position: 'right'}}
                },
                {
                    type: 'toggle', messageKey: 'batteryLowOnly', label: 'Show battery below 10%',
                    defaultValue: false,
                    hint: 'Replaces the top-right slot when your battery drops below 10%.'
                },
                {type: 'toggle', messageKey: 'showQt', label: 'Show quiet time icon', defaultValue: true},
                {
                    type: 'toggle', messageKey: 'vibe', label: 'Vibrate on bluetooth disconnect',
                    defaultValue: false, joinPrevious: true
                },
                {
                    type: 'select',
                    messageKey: 'btIcons',
                    label: 'Show icon for bluetooth',
                    defaultValue: 'both',
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
                defaultValue: 'sun',
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
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                // White is the "no highlight" appearance in dark; the holidaysEnabled
                // toggle owns on/off instead of a special color.
                excludeColors: ['#FFFFFF'],
                joinPrevious: true,
                showWhen: {all: [{key: 'holidaysEnabled', eq: true}, {key: 'theme', eq: 'dark'}]}
            }, {
                type: 'color',
                messageKey: 'colorUSFederal',
                label: 'Holiday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                // Black is the "no highlight" appearance in the light theme instead.
                excludeColors: ['#000000'],
                joinPrevious: true,
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
