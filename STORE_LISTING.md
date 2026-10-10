# WarnWeather — Pebble Appstore listing

## Full description (plain text — paste verbatim)

```
WarnWeather is a weather watchface for Pebble, based on the ForecasWatch2 watchface.
It supports multiple views which can be reached through a wrist flick.
Highly customizable with a modern settings UI and previews.

FORECAST
- 24-hour forecast (12, 24 or about 58 hours on Pebble Time 2; a shorter forecast fills the
  graph) with a temperature line and configurable, battery-friendly updates
- Up to four configurable metrics such as precipitation amount & probability, cloud cover, UV index, gusts,
  wind, air pressure, feels-like temperature and dew point
- Optional day/night shading
- Pebble Time 2: left axis options (beta): high/low numbers on the axis, on the graph or
  off (no left axis: the graph uses the full width), numbers that include feels-like and dew
  point; the longer span marks the clock hours
- Fully customizable lines and colors
- Multiple weather providers, including regional and worldwide sources

ALERTS
Small screens fill up fast. Alerts reduce the clutter on your watchface by showing
information only when it's important.
- Alert icons show at the edge of a status bar only when they reach your warn level
  or are active right now, and stay hidden the rest of the time
- System info/alerts: low watch battery, Bluetooth disconnected, quiet time, and a
  sleep icon during the Battery saver hours
- Weather alerts: rain, wind gusts, UV index, air quality, pollen (DWD) and wind speed
- Heart rate alert (Pebble Time 2): a heart icon while your heart rate is at or above
  your level, and warn/danger colors for the heart rate slot
- Graph lines on Alert: show a wind, gust or UV line only where it reaches your warn
  level, so the graph stays clean until it matters (e.g. UV index only above 5, so you
  know exactly which hours you need sunscreen)
- Alert levels and colors: choose the level at which each alert shows, its color, and
  where on the screen it appears

RAIN RADAR
- 2-hour precipitation nowcast from regional and worldwide providers
- Rain countdown telling you when rain starts (or stops)
- Choose how much radar you see — Off, a rain countdown, a radar status line, or the full radar graph
- Clouds, sun and lightning rows under the radar graph for the next 2 hours

HEALTH VIEW (requires a health-capable watch; heart rate needs a heart-rate sensor)
- Health status for steps, sleep, distance and heart rate
- Last-24h health chart with steps per hour, heart rate on a scale you set, and a sleep band
- Heart rate alert and heart rate slot highlighting (Pebble Time 2; see ALERTS)

CALENDAR
- Multi-week calendar with current-day highlight
- Selectable start of week and customizable highlights for weekends and holidays (150+ countries)

STATUS LINES
- Configurable status slots on every view:
   - Weather:
      - feels-like temperature
      - dew point
      - air quality (current, today's/tomorrow's peak)
      - air pressure
      - pollen
      - wind (current, today's/tomorrow's peak)
      - gusts (current, today's/tomorrow's peak)
      - UV index (current, today's/tomorrow's peak)
      - sunrise/sunset
   - Date and location:
      - calendar week
      - date (selectable formats: European, US, ISO and more)
      - weather fetch location
      - countdown to any date
   - Health:
      - steps
      - distance
      - heart rate
      - sleep
   - Battery:
      - watch battery icon
      - watch battery percentage
      - phone battery
- Bold status values to make them stand out or easier to read
- Goal highlighting: bold, outline, or fill a status slot when it reaches a goal you set
- Threshold highlighting: bold, outline, or fill a status slot when its value crosses a
  warn or danger level you set

WATCHFACE THEMES
- Dark and Light, plus Black & White and Black & White Inverted options on color watches
- Theme switching: night theme, flipped at sunrise/sunset or between custom hours

WATCH
- Custom color, 12h/24h, optional AM/PM
- Battery, Bluetooth, quiet time, and vibrate-on-disconnect indicators
- Night battery saver (pause updates to the watch between hours you set, to save battery)
- Night backlight dimming

LAYOUT CUSTOMIZATION
- Multiple layout presets, with flick-to-cycle between views (or a double flick, to reduce accidental view switches) and optional auto-return
- Custom layout (still beta)
- First-run setup wizard that picks sensible defaults for your country and watch

WEATHER
- Detailed 5-day weather forecast for multiple locations inside the settings app

PLATFORMS
- Pebble Classic, Pebble Steel, Pebble Time, Pebble Time Steel, Pebble 2,
  Pebble Time 2, and Pebble 2 Duo

Weather and radar data from MET Norway (CC BY 4.0).


If you like this watchface and want to support the development, 
press the ❤️ button and consider buying me a coffee at
https://www.buymeacoffee.com/toaster2.

```

## Screenshots 

The store wants at least one screenshot per supported platform, so we capture all five
configs on **every** platform (aplite, basalt, diorite, emery, flint) — 5 shots × 5
platforms = 25 files, grouped per platform for upload.

Each config is a fixture bundling its own settings + weather/radar data:

| Label | Config | Fixture |
| ----- | ------ | ------- |
| `1-calendar` | Calendar view, white rain bars, precipitation line, fill off | `store-calendar` |
| `2-radar-multicolor` | Radar view, multicolor radar + rain bars | `berlin` |
| `3-wind-gust` | Wind speed line with dotted gust line | `windy` |
| `4-radar-white-wind` | Radar view (white radar) + yellow wind line with dotted gust | `store-wind-radar` |
| `5-precip-uv` | Precipitation line (filled) with dotted UV index line, multicolor rain bars | `precip-uv` |

`berlin` and `store-wind-radar` auto-tap into the radar view; the others stay on the
calendar/forecast view. On the black-and-white platforms (aplite, diorite, flint) the
multicolor/yellow settings render in B&W — expected.

Capture everything in one go:

```
scripts/capture-store-shots.sh v1.0.0
```

Output lands in `screenshot/v1.0.0/store/<platform>/<label>.png` — e.g.
`store/emery/1-calendar.png`. Upload each platform's five files to that platform in the
store listing.
