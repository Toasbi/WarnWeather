# WarnWeather — Pebble Appstore listing

## Full description (plain text — paste verbatim)

```
WarnWeather is a weather watchface for Pebble, based on the ForecasWatch2 watchface.
Highly customizable with a modern settings UI and previews.

FORECAST
- 24-hour forecast with a temperature line and configurable, battery-friendly updates
- Configurable metrics such as precipitation, UV index, gusts, wind, air
  pressure and feels-like temperature
- Optional day/night shading
- Multiple weather providers, including regional and worldwide sources

RAIN RADAR
- 2-hour precipitation nowcast from regional and worldwide providers
- Rain countdown telling you when rain starts (or stops)
- Choose how much radar you see — Off, a rain countdown, a radar status line, or the full radar graph

HEALTH VIEW (requires a health-capable watch; heart rate needs a heart-rate sensor)
- Health status for steps, sleep, distance and heart rate
- Last-24h health chart with steps per hour, heart rate on a scale you set, and a sleep band

CALENDAR
- Multi-week calendar with current-day highlight
- Selectable start of week and customizable highlights for weekends and holidays (150+ countries)

STATUS LINES
- Configurable status slots on every view: 
   - Weather:
      - feels like temperatur
      - dew point
      - air quality
      - air pressure
      - pollen
      - wind
      - gusts
      - UV index
      - sunrise/sunset
   - Date and location:
      - Calender week  
      - date
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
- Bold status values to make them stand out or to make it easier to read
- Goal highlighting: bold, outline, or fill a status slot when it reaches a goal you set
- Threshold highlighting: bold, outline, or fill a status slot when a status slot crosses a
  warn or danger level you set

WATCHFACE THEMES
- Dark and Light, plus Black & White and Black & White Inverted options on color watches

WATCH
- Custom color, 12h/24h, optional AM/PM
- Battery, Bluetooth, quiet time, and vibrate-on-disconnect indicators
- Night battery saver (pause updates to the watch overnight to save battery)


LAYOUT CUSTOMIZATION
- Multiple layout presets, with flick-to-cycle between views and optional auto-return
- Light/Dark settings page with grouped, easy-to-browse pickers
- First-run setup wizard that picks sensible defaults for your country and watch

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
