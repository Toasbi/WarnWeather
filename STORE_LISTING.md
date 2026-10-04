# WarnWeather — Pebble Appstore listing

## Full description (plain text — paste verbatim)

```
WarnWeather is a weather watchface for Pebble, based on the ForecasWatch2 watchface.
It supports multiple views which can be reached through a wrist flick.
Highly customizable with a modern settings UI and previews.

ALERTS
Small screens fill up fast. Alerts keep the watchface clean and bring information
up only when it matters, so you know before it gets dangerous.
- Alert icons show at the edge of a status bar only when they reach your warn level
  or are active right now, and stay hidden the rest of the time
- System info: low watch battery, Bluetooth disconnected, quiet time, and a sleep
  icon during the Battery saver hours
- Weather alerts: rain on its way (as an icon, the minutes, or a countdown), and wind gusts,
  UV index, air quality, pollen (DWD) or wind speed reaching your warn level, today
  or tomorrow
- Alert levels: a warn and a danger level for each weather alert, with its own
  colors on color watches
- Alert highlighting: bold, outline, or fill a status slot when it reaches the warn
  or danger level you set
- Graph lines on Alert: set a wind, gust or UV line's Visible values to Alert and it
  shows only the hours that reach your warn level, so the graph stays empty until it
  matters
- Pick the status bars that show each alert, left or right; on a crowded bar the
  status slots shorten first to make room
- Ready out of the box: battery, Bluetooth, quiet time, sleep, rain, wind, gust,
  UV and air quality alerts are on by default
(Alerts are not available on Pebble Classic/Steel)

FORECAST
- 24-hour forecast with a temperature line and configurable, battery-friendly updates
- Up to four configurable metrics such as precipitation, cloud cover, UV index, gusts,
  wind, air pressure, feels-like temperature and dew point
- Show any metric as a line, dots or x marks, and precipitation, cloud cover, UV, wind or
  gusts also as a shaded stripe along the top or bottom of the graph
- Draw from: Bottom | Top: the precipitation, cloud cover, wind, gust and UV lines, and
  (Bars from) the forecast's and the radar's rain bars, can hang from the top of the graph,
  so they cover the temperature curve less (not on Pebble Classic/Steel)
- Feels-like your way: the provider's own value, or the Steadman formula
  (temperature, humidity, wind) applied the same on every provider
- Optional day/night shading
- Fully customizable lines and colors
- Multiple weather providers, including regional and worldwide sources

RAIN RADAR
- 2-hour precipitation nowcast from regional and worldwide providers
- Worldwide Rainbow.ai radar: "Rainbow (limited)" is shared by every user, so it refreshes every
  30 minutes; pick "Rainbow (own key)" and add your own Rainbow API key to refresh it at your
  own update interval (free for 5,000 calls a month; Rainbow asks for a credit card)
- "Radar limit reached" on the radar when a radar source refuses requests over its limit
- Outside a regional radar's area (DWD: Germany, Met.no: the Nordic countries) the radar says so,
  and the radar settings suggest a source that covers your location
- Rain alert telling you when rain starts (or stops), at a status bar's edge while rain is on
  its way (see ALERTS)
- Choose how much radar you see — Off, the rain alert only, a radar status line, or the full radar graph
- Clouds, sun and lightning rows under the radar graph: cloud cover and sun strength for the next 2 hours, with a bolt where thunderstorms are expected

HEALTH VIEW (requires a health-capable watch; heart rate needs a heart-rate sensor)
- Health status for steps, sleep, distance and heart rate
- Last-24h health chart with steps per hour, heart rate on a scale you set, and a sleep band

CALENDAR
- Multi-week calendar with current-day highlight
- Selectable start of week and customizable highlights for weekends and holidays (150+ countries)

STATUS BARS
- Configurable status slots on every view:
   - Weather:
      - feels-like temperature
      - dew point
      - air quality (current, and today's/tomorrow's peak with the Open-Meteo AQI provider)
      - air pressure
      - pollen
      - wind (current, and today's/tomorrow's peak)
      - gusts (current, and today's/tomorrow's peak)
      - UV index (current, and today's/tomorrow's peak)
      - sunrise/sunset
   - Date and location:
      - calendar week
      - date (selectable format — European, US, ISO, or spelled-out month)
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
- Bold status values to make them stand out or easier to read (not on Pebble Classic/Steel)
- Goal highlighting: bold, outline, or fill a status slot when it reaches a goal you set
  (not on Pebble Classic/Steel)
- Alerts at each status bar's edge (see ALERTS)

WATCHFACE THEMES
- Dark and Light, plus Black & White and Black & White Inverted options on color watches
- Theme switching: add a night theme, flipped at sunrise/sunset or between custom hours

WATCH
- Custom color, 12h/24h, optional AM/PM
- Battery, Bluetooth, quiet time and sleep indicators that show only when needed (see ALERTS),
  plus vibrate on disconnect (Pebble Classic/Steel keeps its fixed indicators)
- Night battery saver (pause updates to the watch between hours you set, to save battery)
- Night backlight dimming

LAYOUT CUSTOMIZATION
- Multiple layout presets, with flick-to-cycle between views and optional auto-return, including Weather only: rain radar, clock, weather and a big forecast without the top bar
- Custom layout (still beta)
- First-run setup wizard that picks sensible defaults for your country and watch
- A settings page in six tabs (Weather, Watchface, Status bars, Alerts, Graphs, Setup; no
  Alerts tab on Pebble Classic/Steel) with a live preview, an explanation under each setting or behind a ? icon, rarely-changed
  settings under More options, and full-screen dialogs

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
