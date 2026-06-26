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
// Color swatches (5 intensity bands) — shown only in the Multicolor hint.
var SWATCHES = '<span style="display:inline-flex;gap:7px;margin-top:6px;align-items:flex-end;">' + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#AAAAAA;margin-bottom:3px;"></span>0.1</span>' + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#55FFFF;margin-bottom:3px;"></span>0.5</span>' + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#00FF00;margin-bottom:3px;"></span>2</span>' + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FFFF00;margin-bottom:3px;"></span>10</span>' + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FF5555;margin-bottom:3px;"></span>40</span>' + '</span>';
// Bar color hint depends on the selected mode (hintByValue): Multicolor shows the swatches; White doesn't.
var MULTICOLOR_HINT = 'Colors each part differently depending on intensity:' + SWATCHES;
var WHITE_HINT = 'Shows every bar in a single color.';
// Full-width note between the Bars and Bar color controls (its own staticText) so the prose isn't
// cramped in a control's left column. Color watches only; B/W uses BW_LEGEND.
var SCALE_NOTE = '<span style="color:#A9AEB8;font-size:12.5px;line-height:1.55;">The bars don\'t scale linearly. They\'re divided into 5 parts, standing for up to 0.1, 0.5, 2, 10 and 40 mm/h of downfall, so light drizzle stays visible while heavy rain still has room to grow.</span>';
// B/W watches hide the color picker (no colors to choose), so this stands in for COLOR_LEGEND
// there: text-only, since height is the only encoding (no color steps to show).
var BW_LEGEND = '<span style="color:#A9AEB8;font-size:12.5px;line-height:1.55;">The bars don\'t scale linearly. They\'re divided into 5 parts, standing for up to 0.1, 0.5, 2, 10 and 40 mm/h of downfall.</span>';
module.exports = {
    appName: 'WarnWeather',
    versionLabel: versionLabel + ' <a href="https://github.com/Toasbi/WarnWeather">GitHub source</a>',
    tabs: [{
        id: 'general', label: 'General', sections: [{
            items: [{
                type: 'segmented',
                messageKey: 'temperatureUnits',
                label: 'Temperature units',
                defaultValue: 'c',
                options: [['°F', 'f'], ['°C', 'c']]
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
                defaultValue: false,
                hint: 'Stop fetching weather between the hours below to save battery.'
            }, {
                type: 'select',
                messageKey: 'sleepStartHour',
                label: 'From',
                defaultValue: '22',
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
                hintByValue: {
                    wunderground: 'Global · no API key needed.',
                    openweathermap: 'Global · enter API key below.',
                    dwd: 'Germany only · no API key needed.',
                    openmeteo: 'Global · no API key needed.'
                },
                options: [['Weather Underground', 'wunderground'], ['OpenWeatherMap', 'openweathermap'], ['Deutscher Wetterdienst (Germany only)', 'dwd'], ['Open-Meteo', 'openmeteo']]
            }, {
                type: 'text',
                messageKey: 'owmApiKey',
                label: 'OpenWeatherMap API key',
                defaultValue: '',
                joinPrevious: true,
                hint: '<a href=\'https://openweathermap.org/\'>Register an OpenWeatherMap account</a> and paste your API key here. The key must be subscribed to the <a href=\'https://openweathermap.org/api/one-call-3\'>One Call API 3.0</a> plan, or fetches fail with a 401 error.',
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
        }]
    }, {
        id: 'forecast', label: 'Forecast', sections: [{
            intro: 'The forecast graph looks up to 24 hours ahead. Temperature is always shown; on top of it you choose what to add ' + '— the chance of rain or wind speed with gusts as a second line, plus optional bars for the hourly rain amount.',
            items: [{
                type: 'segmented',
                messageKey: 'secondaryLine',
                label: 'Secondary line',
                defaultValue: 'precip_prob',
                hintByValue: {
                    precip_prob: 'Chance of rain each hour<br>— half-height = 50% rain chance<br>— full-height = 100% rain chance',
                    wind: 'Wind speed, with an optional dotted gust line above it.',
                    off: 'Temperature only.'
                },
                options: [['Precip', 'precip_prob'], ['Wind', 'wind'], ['Off', 'off']],
                blockBefore: 'forecastPreview',
                blockBeforeSticky: true
            }, {
                type: 'toggle',
                messageKey: 'secondaryLineFill',
                label: 'Secondary line fill',
                defaultValue: true,
                joinPrevious: true,
                hint: 'Fills the area beneath the curve.',
                showWhen: {key: 'secondaryLine', eq: 'precip_prob'}
            }, {
                type: 'segmented',
                messageKey: 'windScale',
                label: 'Wind graph scale',
                defaultValue: 'mid',
                joinPrevious: true,
                hintByValue: {
                    low: 'Tops out at 30 km/h (19 mph) — emphasizes light, gentle winds.',
                    mid: 'Tops out at 50 km/h (31 mph) — general use; gusts visible, typical winds sit mid-graph.',
                    high: 'Tops out at 70 km/h (43 mph) — keeps strong gusts from flattening against the top.'
                },
                options: [['Low', 'low'], ['Mid', 'mid'], ['High', 'high']],
                showWhen: {key: 'secondaryLine', eq: 'wind'}
            }, {
                type: 'toggle',
                messageKey: 'gustLine',
                label: 'Gust line',
                defaultValue: true,
                joinPrevious: true,
                hint: 'Dotted line above the wind speed showing gust peaks.',
                showWhen: {key: 'secondaryLine', eq: 'wind'}
            }, {
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
                showWhen: {key: 'barSource', eq: 'rain'}
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: BW_LEGEND,
                showWhen: {all: [{not: {env: 'color'}}, {key: 'barSource', eq: 'rain'}]}
            }, {
                type: 'segmented',
                messageKey: 'rainBarColor',
                label: 'Bar color',
                defaultValue: 'multicolor',
                joinPrevious: true,
                hintByValue: {multicolor: MULTICOLOR_HINT, white: WHITE_HINT},
                capabilities: ['COLOR'],
                options: [['Multicolor', 'multicolor'], ['White', 'white']],
                showWhen: {key: 'barSource', eq: 'rain'}
            }, {
                type: 'toggle',
                messageKey: 'dayNightShading',
                label: 'Day / night shading',
                defaultValue: true,
                hint: 'Show hatch shading between sunset and sunrise to distinguish day and night on the forecast graph.'
            }]
        }]
    }, {
        id: 'radar', label: 'Radar', sections: [{
            intro: 'Rain radar appears as a second screen revealed with a wrist flick.<br>' + 'Unlike the model prediction in the forecast graph, this is a short-term nowcast based on actual radar measurements moving toward you, and it refreshes often as new radar scans arrive. ' + 'Behind the scenes the provider gives a sequence of radar images covering the next 2 hours; we read the rain intensity at your location in each image and turn every 5-minute frame into one bar whose height is the rain amount. ' + 'Solid bars are rain at your exact spot; the hatched outline behind them is the strongest rain anywhere within 2 km — an early warning that rain is nearby even when it isn\'t directly overhead yet.<br>' + 'Radar is Germany-only for now (Deutscher Wetterdienst). I\'m open to adding more providers, but so far I haven\'t found another free one that delivers 5-minute updates precise to your exact location.',
            items: [{
                type: 'segmented',
                messageKey: 'radarProvider',
                label: 'Radar provider',
                defaultValue: 'disabled',
                hintByValue: {dwd: 'Deutscher Wetterdienst (Germany only)'},
                options: [['DWD', 'dwd'], ['Off', 'disabled']],
                blockBefore: 'radarPreview',
                blockBeforeSticky: true
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: SCALE_NOTE,
                capabilities: ['COLOR'],
                showWhen: {key: 'radarProvider', ne: 'disabled'}
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: BW_LEGEND,
                showWhen: {all: [{not: {env: 'color'}}, {key: 'radarProvider', ne: 'disabled'}]}
            }, {
                type: 'segmented',
                messageKey: 'radarColor',
                label: 'Radar color',
                defaultValue: 'multicolor',
                hintByValue: {multicolor: MULTICOLOR_HINT, white: WHITE_HINT},
                capabilities: ['COLOR'],
                options: [['Multicolor', 'multicolor'], ['White', 'white']],
                showWhen: {key: 'radarProvider', ne: 'disabled'}
            }]
        }]
    }, {
        id: 'watch', label: 'Watch', sections: [{
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
                capabilities: ['COLOR']
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
                hint: 'Black (default) means match date color; any other value overrides it.'
            }, {
                type: 'color',
                messageKey: 'colorSunday',
                label: 'Sunday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR']
            }, {
                type: 'color',
                messageKey: 'colorSaturday',
                label: 'Saturday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR']
            }, {type: 'toggle', messageKey: 'holidaysEnabled', label: 'Holiday highlight', defaultValue: true}, {
                type: 'color',
                messageKey: 'colorUSFederal',
                label: 'Holiday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                // White is the "no highlight" appearance for normal days, so it is not a valid
                // holiday color — the holidaysEnabled toggle owns on/off instead.
                excludeColors: ['#FFFFFF'],
                joinPrevious: true,
                showWhen: {key: 'holidaysEnabled', eq: true}

            }, {
                type: 'searchSelect',
                messageKey: 'holidayCountry',
                label: 'Country',
                defaultValue: 'US',
                joinPrevious: true,
                options: holidayData.COUNTRY_OPTIONS,
                showWhen: {key: 'holidaysEnabled', eq: true}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegionDE',
                label: 'Region',
                defaultValue: 'all',
                joinPrevious: true,
                options: holidayData.REGION_OPTIONS.DE,
                showWhen: {all: [{key: 'holidayCountry', eq: 'DE'}, {key: 'holidaysEnabled', eq: true}]}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegionAT',
                label: 'Region',
                defaultValue: 'all',
                joinPrevious: true,
                options: holidayData.REGION_OPTIONS.AT,
                showWhen: {all: [{key: 'holidayCountry', eq: 'AT'}, {key: 'holidaysEnabled', eq: true}]}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegionCH',
                label: 'Region',
                defaultValue: 'all',
                joinPrevious: true,
                options: holidayData.REGION_OPTIONS.CH,
                showWhen: {all: [{key: 'holidayCountry', eq: 'CH'}, {key: 'holidaysEnabled', eq: true}]}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegionES',
                label: 'Region',
                defaultValue: 'all',
                joinPrevious: true,
                options: holidayData.REGION_OPTIONS.ES,
                showWhen: {all: [{key: 'holidayCountry', eq: 'ES'}, {key: 'holidaysEnabled', eq: true}]}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegionGB',
                label: 'Region',
                defaultValue: 'all',
                joinPrevious: true,
                options: holidayData.REGION_OPTIONS.GB,
                showWhen: {all: [{key: 'holidayCountry', eq: 'GB'}, {key: 'holidaysEnabled', eq: true}]}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegionUS',
                label: 'State',
                defaultValue: 'all',
                joinPrevious: true,
                options: holidayData.REGION_OPTIONS.US,
                showWhen: {all: [{key: 'holidayCountry', eq: 'US'}, {key: 'holidaysEnabled', eq: true}]}
            }]
        }]
    }, {
        id: 'more', label: 'More', sections: [{
            title: 'Misc',
            items: [{type: 'toggle', messageKey: 'showQt', label: 'Show quiet time icon', defaultValue: true}, {
                type: 'toggle', messageKey: 'vibe', label: 'Vibrate on bluetooth disconnect', defaultValue: false
            }, {
                type: 'select',
                messageKey: 'btIcons',
                label: 'Show icon for bluetooth',
                defaultValue: 'both',
                options: [['Disconnected', 'disconnected'], ['Connected', 'connected'], ['Both', 'both'], ['None', 'none']]
            }, {
                type: 'toggle',
                messageKey: 'telemetryEnabled',
                label: 'Share anonymous telemetry',
                defaultValue: true,
                hint: 'Share privacy-respecting weather telemetry to improve reliability and understand usage patterns. Learn more about what gets sent in the <a href="https://github.com/Toasbi/WarnWeather#telemetry">Telemetry section</a>.'
            }]
        }, {
            title: 'Links', items: [{
                type: 'staticText',
                text: '<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;">' + '<span style="font-size:14.5px;font-weight:600;color:#ECEEF3;">Help</span>' + '<a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a></div>'
            }, {
                type: 'staticText',
                text: '<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;">' + '<span style="font-size:14.5px;font-weight:600;color:#ECEEF3;">Support</span>' + '<a href="https://buymeacoffee.com/toaster2"><img alt="Buy me a coffee" style="height:40px;width:auto;display:block;" src="' + BMC_BADGE + '"></a></div>'
            }]
        }, {
            title: 'Advanced', collapsible: true, items: [{
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
