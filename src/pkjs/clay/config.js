var meta = require('../../../package.json');
var versionLabel = "v" + meta.version + (meta.buildProfile === "dev" ? " (dev)" : "");

var HOUR_OPTIONS = (function() {
    var hours = [];
    for (var h = 0; h < 24; h += 1) {
        hours.push({
            "label": (h < 10 ? "0" + h : String(h)) + ":00",
            "value": String(h)
        });
    }
    return hours;
})();

module.exports = [
    {
        "type": "heading",
        "defaultValue": "WarnWeather"
    },
    {
        "type": "text",
        "defaultValue": "Contribute on <a href=\"https://github.com/Toasbi/WarnWeather\">GitHub!</a>"
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Time",
            },
            {
                "type": "toggle",
                "label": "Leading zero",
                "messageKey": "timeLeadingZero",
            },
            {
                "type": "toggle",
                "label": "Show AM/PM",
                "messageKey": "timeShowAmPm",
            },
            {
                "type": "select",
                "label": "Axis time format",
                "messageKey": "axisTimeFormat",
                "defaultValue": "24h",
                "description": "Tip: go to Settings > Date & Time > Time Format on your watch to change the main time format",
                "options": [
                    {
                        "label": "12h",
                        "value": "12h"
                    },
                    {
                        "label": "24h",
                        "value": "24h"
                    }
                ]
            },
            {
                "type": "select",
                "label": "Main time font",
                "messageKey": "timeFont",
                "defaultValue": "roboto",
                "options": [
                    {
                        "label": "Roboto",
                        "value": "roboto"
                    },
                    {
                        "label": "Leco",
                        "value": "leco"
                    },
                    {
                        "label": "Bitham",
                        "value": "bitham"
                    },
                ]
            },
            {
                "type": "color",
                "label": "Main time color",
                "messageKey": "colorTime",
                "defaultValue": "#FFFFFF",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Calendar",
            },
            {
                "type": "select",
                "label": "Start week on",
                "messageKey": "weekStartDay",
                "defaultValue": "sun",
                "options": [
                    {
                        "label": "Sunday",
                        "value": "sun"
                    },
                    {
                        "label": "Monday",
                        "value": "mon"
                    }
                ]
            },
            {
                "type": "select",
                "label": "First week to display",
                "messageKey": "firstWeek",
                "defaultValue": "prev",
                "options": [
                    {
                        "label": "Previous week",
                        "value": "prev"
                    },
                    {
                        "label": "Current week",
                        "value": "curr"
                    }
                ]
            },
            {
                "type": "color",
                "label": "Today highlight",
                "messageKey": "colorToday",
                "defaultValue": "#000000",
                "description": "Black (default) means match date color, any other value overrides this.",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
            {
                "type": "color",
                "label": "Sunday color",
                "messageKey": "colorSunday",
                "defaultValue": "#FF0055",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
            {
                "type": "color",
                "label": "Saturday color",
                "messageKey": "colorSaturday",
                "defaultValue": "#FF0055",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
            {
                "type": "color",
                "label": "US federal holidays color",
                "messageKey": "colorUSFederal",
                "defaultValue": "#FF0055",
                "description": "White means disable",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Weather"
            },
            {
                "type": "select",
                "label": "Update interval",
                "messageKey": "fetchIntervalMin",
                "defaultValue": "30",
                "description": "Updates only send what actually changed (deltas), so short intervals like 5 min stay battery friendly.",
                "options": [
                    {
                        "label": "5 minutes",
                        "value": "5"
                    },
                    {
                        "label": "10 minutes",
                        "value": "10"
                    },
                    {
                        "label": "15 minutes",
                        "value": "15"
                    },
                    {
                        "label": "30 minutes",
                        "value": "30"
                    },
                    {
                        "label": "1 hour",
                        "value": "60"
                    }
                ]
            },
            {
                "type": "toggle",
                "label": "Pause weather at night",
                "messageKey": "sleepNightEnabled",
                "defaultValue": false,
                "description": "Stop fetching weather between the hours below to save battery."
            },
            {
                "type": "select",
                "label": "From",
                "messageKey": "sleepStartHour",
                "defaultValue": "22",
                "options": HOUR_OPTIONS
            },
            {
                "type": "select",
                "label": "To",
                "messageKey": "sleepEndHour",
                "defaultValue": "7",
                "options": HOUR_OPTIONS
            },
            {
                "type": "toggle",
                "label": "Force weather fetch",
                "messageKey": "fetch",
                "description": "Last successful fetch:<br><span id='lastFetchSpan'>Never :(</span><span id='lastAttemptBlock'></span>"
            },
            {
                "type": "input",
                "label": "Location override",
                "messageKey": "location",
                "description": "Example: \"Manhattan\" or \"123 Oak St Plainsville KY\".<br><a href=\"https://locationiq.com/demo\">Click here</a> to test out your location query.<br>To use GPS, leave this blank and ensure GPS is enabled on your device.",
                "attributes": {
                    "placeholder": "Using GPS",
                }
            }
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Forecast"
            },
            {
                "type": "select",
                "defaultValue": "f",
                "messageKey": "temperatureUnits",
                "label": "Temperature Units",
                "options": [
                    {
                        "label": "°F",
                        "value": "f"
                    },
                    {
                        "label": "°C",
                        "value": "c"
                    }
                ]
            },
            {
                "type": "toggle",
                "label": "Day/night shading",
                "messageKey": "dayNightShading",
                "defaultValue": true,
                "description": "Show hatch shading between sunset and sunrise to distinguish day and night on the forecast graph."
            },
            {
                "type": "select",
                "label": "Secondary line",
                "messageKey": "secondaryLine",
                "defaultValue": "precip_prob",
                "description": "A second curve drawn over the temperature graph.<br><b>Precipitation probability</b> — chance of rain each hour.<br><b>Wind speed</b> — adds a dotted gust line above it (see Wind graph scale below).<br><b>Off</b> — temperature only.",
                "options": [
                    { "label": "Precipitation probability", "value": "precip_prob" },
                    { "label": "Wind speed", "value": "wind" },
                    { "label": "Off", "value": "off" }
                ]
            },
            {
                "type": "toggle",
                "label": "Fill area under line",
                "messageKey": "secondaryLineFill",
                "defaultValue": true,
                "description": "Shades the area beneath the secondary line. Only applies to the precipitation-probability line — the wind line is always drawn line-only."
            },
            {
                "type": "select",
                "label": "Wind graph scale",
                "messageKey": "windScale",
                "defaultValue": "mid",
                "description": "Sets how high the wind graph reaches.<br><b>Low</b> (30 km/h / 19 mph) — emphasizes light, gentle winds.<br><b>Mid</b> (50 km/h / 31 mph) — general use; gusts visible, typical winds sit mid-graph.<br><b>High</b> (70 km/h / 43 mph) — keeps strong gusts from flattening against the top.<br>When wind is the secondary line, a dotted line above the solid wind line shows gust speeds.",
                "options": [
                    { "label": "Low", "value": "low" },
                    { "label": "Mid", "value": "mid" },
                    { "label": "High", "value": "high" }
                ]
            },
            {
                "type": "select",
                "label": "Bars",
                "messageKey": "barSource",
                "defaultValue": "rain",
                "description": "Vertical bars show how much rain is expected each hour.<br><b>Rain amount</b> — bar height grows with rainfall on a tiered scale (0.1 / 0.5 / 2 / 10 mm steps), so light drizzle and heavy downpours both stay visible.<br><b>Off</b> — hides the bars.<br>Use <b>Bar Color</b> below to shade bars by intensity or keep them white.",
                "options": [
                    { "label": "Rain amount", "value": "rain" },
                    { "label": "Off", "value": "off" }
                ]
            },
            {
                "type": "select",
                "label": "Bar Color",
                "messageKey": "rainBarColor",
                "defaultValue": "multicolor",
                "capabilities": ["COLOR"],
                "options": [
                    { "label": "Multicolor", "value": "multicolor" },
                    { "label": "White", "value": "white" }
                ]
            },
            {
                "type": "radiogroup",
                "label": "Provider",
                "messageKey": "provider",
                "defaultValue": "wunderground",
                "description": "Weather data source.<br><b>Weather Underground</b> — no API key needed.<br><b>OpenWeatherMap</b> — requires an API key subscribed to One Call API 3.0 (see below).<br><b>Deutscher Wetterdienst</b> — Germany only, no key needed.",
                "options": [
                    {
                        "label": "Weather Underground",
                        "value": "wunderground"
                    },
                    {
                        "label": "OpenWeatherMap",
                        "value": "openweathermap"
                    },
                    {
                        "label": "Deutscher Wetterdienst (Germany only)",
                        "value": "dwd"
                    }
                ]
            },
            {
                "type": "input",
                "label": "OpenWeatherMap API key",
                "messageKey": "owmApiKey",
                "description": "<a href='https://openweathermap.org/'>Register an OpenWeatherMap account</a> and paste your API key here. The key must be subscribed to the <a href='https://openweathermap.org/api/one-call-3'>One Call API 3.0</a> plan, or fetches fail with a 401 error."
            }
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Rain radar"
            },
            {
                "type": "text",
                "defaultValue": "Rain radar appears as a second screen revealed with a wrist flick, and only when radar data is available.<br>It shows a 2-hour rain nowcast — each bar is one 5-minute frame. Solid bars are rain at your exact location, while the hatched outline behind them is the strongest rain anywhere within 2 km — an early warning that rain is nearby even when it isn't directly overhead yet."
            },
            {
                "type": "radiogroup",
                "label": "Radar provider",
                "messageKey": "radarProvider",
                "defaultValue": "disabled",
                "options": [
                    {
                        "label": "Deutscher Wetterdienst (Germany only)",
                        "value": "dwd"
                    },
                    {
                        "label": "Disabled",
                        "value": "disabled"
                    }
                ]
            },
            {
                "type": "select",
                "label": "Radar Color",
                "messageKey": "radarColor",
                "defaultValue": "multicolor",
                "capabilities": ["COLOR"],
                "options": [
                    { "label": "Multicolor", "value": "multicolor" },
                    { "label": "White", "value": "white" }
                ]
            }
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Misc"
            },
            {
                "type": "toggle",
                "label": "Show quiet time icon",
                "messageKey": "showQt",
                "defaultValue": true
            },
            {
                "type": "toggle",
                "label": "Vibrate on bluetooth disconnect",
                "messageKey": "vibe",
                "defaultValue": false
            },
            {
                "type": "select",
                "defaultValue": "both",
                "messageKey": "btIcons",
                "label": "Show icon for bluetooth",
                "options": [
                    {
                        "label": "Disconnected",
                        "value": "disconnected"
                    },
                    {
                        "label": "Connected",
                        "value": "connected"
                    },
                    {
                        "label": "Both",
                        "value": "both"
                    },
                    {
                        "label": "None",
                        "value": "none"
                    }
                ]
            },
            {
                "type": "toggle",
                "label": "Share anonymous telemetry",
                "messageKey": "telemetryEnabled",
                "defaultValue": true,
                "description": "<span style=\"color:#9aa0a6;font-size:0.82em;line-height:1.35;\">Share privacy-respecting weather telemetry to improve reliability and understand usage patterns. Learn more about what gets sent in the <a href=\"https://github.com/Toasbi/WarnWeather#telemetry\">Telemetry section</a>.</span>"
            },
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Stats"
            },
            {
                "type": "toggle",
                "label": "Enable connection stats",
                "messageKey": "devStatsEnabled",
                "defaultValue": false,
                "description": "Locally records connection events sent to the watch. Events older than 7 days are deleted."
            },
            {
                // Hidden flag set by the "Clear events" button in the stats block;
                // hidden at runtime in inject.js. Clay-only, not an AppMessage key.
                "type": "toggle",
                "label": "Clear connection stats",
                "messageKey": "devStatsClear",
                "defaultValue": false
            },
            {
                "type": "text",
                "defaultValue": "<span id='devStatsBlock'></span>"
            }
        ]
    },
    {
        "type": "submit",
        "defaultValue": "Save Settings"
    },
    {
        "type": "text",
        "defaultValue": versionLabel
    }
]
