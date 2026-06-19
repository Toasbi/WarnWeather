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
whole day of temperature, precipitation, and wind into a single graph, and keeps a
3-week calendar and a live rain radar one wrist-flick away.

TIME
- Current time
- Next sunrise or sunset time

FORECAST
- 24-hour weather forecast with configurable update frequency
- Current temperature
- Temperature forecast line
- Optional secondary line: precipitation probability or wind speed with a dotted gust line
  above it
- Optional hourly rain bars — multicolor or white on color watches
- Optional day/night hatch shading on the graph
- Fahrenheit and Celsius temperatures
- Multiple weather providers: Weather Underground, OpenWeatherMap, and Deutscher
  Wetterdienst via Bright Sky (Germany only)
- GPS or manual location entry
- City where the forecast was fetched

RAIN RADAR (for now only available for Deutscher Wetterdienst)
- 2-hour precipitation nowcast in 5-minute frames — rain at your exact location plus
  the strongest rain approaching from within 2 km
- Switch between calendar and radar view with a flick or tap

CALENDAR
- 3-week calendar
- Customize colors for Sundays, Saturdays, and US federal holidays

WATCH STATUS
- Battery indicator
- Bluetooth connection indicator
- Vibrate on disconnect
- Quiet time indicator
- Sleep mode (battery-saving night pause)

CUSTOMIZATION
- Customize time font and color

PLATFORMS
- Pebble Classic, Pebble Steel, Pebble Time, Pebble Time Steel, Pebble 2, and
  Pebble Time 2
```

## Screenshots (planned)

| # | Platform | Content | Fixture | Capture |
| - | -------- | ------- | ------- | ------- |
| 1 | emery | Calendar view, white rain bars, precipitation line with fill off | `store-calendar` | `scripts/capture-screenshots.sh v1.0.0 store-calendar` → keep `screenshot/v1.0.0/raw/emery.png` |
| 2 | basalt | Radar view, multicolor radar + rain bars | `berlin` | `scripts/capture-screenshots.sh v1.0.0 berlin` → keep `screenshot/v1.0.0/raw/basalt.png` |
| 3 | aplite | Wind speed line with dotted gust line | `windy` | `scripts/capture-screenshots.sh v1.0.0 windy` → keep `screenshot/v1.0.0/raw/aplite.png` |

All three fixtures exist (`store-calendar.json` added for shot #1). Each capture run shoots all
platforms; keep only the file listed above. `store-calendar` and `windy` stay on the forecast/
calendar view; `berlin` is wired to tap into the radar view automatically.
