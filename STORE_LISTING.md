# WarnWeather — Pebble Appstore listing

The store description field is **plain text only** — paste the block below verbatim
(headings and bullets are plain characters, not markdown).

## Title

WarnWeather — weather, radar & calendar

## Short blurb (one-liner)

Temperature, rain, and wind for the next 24 hours, plus a live rain radar and a 3-week calendar — all on your Pebble watchface.

## Full description (plain text — paste verbatim)

```
WarnWeather is a weather watchface for Pebble, inspired by ForecasWatch2. It packs a
whole day of temperature, precipitation probability+amount, UV-index and wind into a single graph, and keeps a
3-week calendar and a live rain radar one wrist-flick away.

TIME
- Current time
- Next sunrise or sunset time

FORECAST
- 24-hour weather forecast with configurable update frequency
- Current temperature
- Temperature forecast line
- Optional main metric (solid line) and optional second metric (drawn as bar-aligned square dots) — each
  independently shows precipitation %, wind speed, wind gusts, or UV index; the main-metric line can
  have a configurable fill
- Optional hourly rain bars — multicolor or white on color watches
- Optional day/night hatch shading on the graph
- Fahrenheit and Celsius temperatures
- Multiple weather providers: Weather Underground, OpenWeatherMap, Open-Meteo, and
  Deutscher Wetterdienst via Bright Sky (Germany only)
- GPS or manual location entry
- City where the forecast was fetched

RAIN RADAR (for now only available for Deutscher Wetterdienst)
- 2-hour precipitation nowcast in 5-minute frames — rain at your exact location plus
  the strongest rain approaching from within 2 km
- Switch between calendar and radar view with a flick of your wrist
- Optional rain countdown: when rain is on the way, the month turns into "Drizzle / Rain /
  Downpour in X min", with a rain-lines intensity icon colour-matched to the radar bars
  (and "… for X min" while it's raining), configurable look-ahead (30 min / 60 min / 2 hours)

HEALTH VIEW (requires health-capable watch)
- Flick your wrist to switch the forecast graph to a health overview: hourly step bars,
  a sleep band along the bottom (light/deep sleep), and a heart-rate dotted line
- Status line shows today's steps, last night's sleep duration, and current heart rate
- Heart rate requires a watch with a built-in heart-rate sensor; unavailable values
  show as placeholders
- Enable in settings

CALENDAR
- 3-week calendar
- Highlight public holidays for your country — 150+ countries worldwide, with
  region/state granularity where holidays vary (Germany, Austria, Switzerland, Spain, UK,
  United States)
- Customize colors for Sundays, Saturdays, and holidays

WATCH STATUS
- Battery indicator
- Bluetooth connection indicator
- Vibrate on disconnect
- Quiet time indicator
- Sleep mode (battery-saving night pause)

CUSTOMIZATION
- Customize time font and color

UPDATES
- Update notifications: get a one-time heads-up when a newer version is available in the appstore.

PLATFORMS
- Pebble Classic, Pebble Steel, Pebble Time, Pebble Time Steel, Pebble 2, and
  Pebble Time 2
```

## Screenshots (planned)

The store wants at least one screenshot per supported platform, so we capture all four
configs on **every** platform (aplite, basalt, diorite, emery, flint) — 4 shots × 5
platforms = 20 files, grouped per platform for upload.

Each config is a fixture bundling its own settings + weather/radar data:

| Label | Config | Fixture |
| ----- | ------ | ------- |
| `1-calendar` | Calendar view, white rain bars, precipitation line, fill off | `store-calendar` |
| `2-radar-multicolor` | Radar view, multicolor radar + rain bars | `berlin` |
| `3-wind-gust` | Wind speed line with dotted gust line | `windy` |
| `4-radar-white-wind` | Radar view (white radar) + yellow wind line with dotted gust | `store-wind-radar` |

`berlin` and `store-wind-radar` auto-tap into the radar view; the others stay on the
calendar/forecast view. On the black-and-white platforms (aplite, diorite) the multicolor/
yellow settings render in B&W — expected.

Capture everything in one go:

```
scripts/capture-store-shots.sh v1.0.0
```

Output lands in `screenshot/v1.0.0/store/<platform>/<label>.png` — e.g.
`store/emery/1-calendar.png`. Upload each platform's four files to that platform in the
store listing.
