# WarnWeather — Pebble Appstore listing

## Full description (plain text — paste verbatim)

```
WarnWeather is a weather watchface for Pebble, based on the ForecasWatch2 watchface.
It supports multiple views which can be reached through a wrist flick.
Highly customizable with a modern settings UI and previews.

FORECAST
- 24-hour forecast with a temperature line and configurable, battery-friendly updates
- Up to four configurable metrics such as precipitation, cloud cover, UV index, gusts,
  wind, air pressure, feels-like temperature and dew point
- Show any metric as a line, dots or x marks, and precipitation, cloud cover, UV, wind or
  gusts also as a shaded stripe along the top or bottom of the graph
- Feels-like your way: the provider's own value, or the Steadman formula
  (temperature, humidity, wind) applied the same on every provider
- Optional day/night shading
- Fully customizable lines and colors
- Multiple weather providers, including regional and worldwide sources

RAIN RADAR
- 2-hour precipitation nowcast from regional and worldwide providers
- Worldwide Rainbow.ai radar: "Rainbow (limited)" is shared by every user, so it refreshes every
  30 minutes; turn on "Use your own key" and enter your own Rainbow API key to refresh it at your
  own update interval (free for 5,000 calls a month; Rainbow asks for a credit card)
- "Radar limit reached" on the radar when a radar source refuses requests over its limit
- Rain alert telling you when rain starts (or stops), at a status bar's edge while rain is on
  its way (On demand)
- Choose how much radar you see — Off, the rain alert only, a radar status line, or the full radar graph
- Clouds, sun and lightning rows under the radar graph: cloud cover and sun strength for the next 2 hours, with a bolt where thunderstorms are expected

HEALTH VIEW (requires a health-capable watch; heart rate needs a heart-rate sensor)
- Health status for steps, sleep, distance and heart rate
- Last-24h health chart with steps per hour, heart rate on a scale you set, and a sleep band

CALENDAR
- Multi-week calendar with current-day highlight
- Selectable start of week and customizable highlights for weekends and holidays (150+ countries)

STATUS LINES
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
- Alert highlighting: bold, outline, or fill a status slot when a metric reaches the warn or
  danger level you set (its Alert levels) (not on Pebble Classic/Steel)
- On demand: items that show at a status bar's edge only while they have something to say
  (not on Pebble Classic/Steel). Every status bar has an On demand left and right side, each
  with the items you tick:
   - System info: the watch battery at or below a warn level you set, Bluetooth when it
     disconnects, quiet time while it is on, and a sleep icon during the battery saver hours
   - Weather alerts: rain falling or on its way, or wind gusts, UV index, air quality, pollen
     (with DWD) or wind speed reaching your warn level today or, looking ahead, tomorrow;
     with the value next to the icon if you like, and » or a mark you pick on a tomorrow
     alert; the rain alert shows as an icon, the minutes, or the full countdown text
   - On by default: Bluetooth, quiet time and sleep at the top left, and the battery with
     the rain, wind gust, UV index, air quality and wind speed alerts at the top right; the
     pollen alert is off
   - When a bar runs short of room, its slots switch to short forms first (outside calendar
     views the date to its day number, "New York" to "N. York", sleep "7h", steps "12k",
     units dropped), then the slot beside the items hides and the middle slot moves aside
     and hides, and only then do the alert values and the rain text shorten and the last
     items drop

WATCHFACE THEMES
- Dark and Light, plus Black & White and Black & White Inverted options on color watches
- Theme switching: add a night theme, flipped at sunrise/sunset or between custom hours

WATCH
- Custom color, 12h/24h, optional AM/PM
- Battery, Bluetooth, quiet time and sleep indicators that show only when needed (On demand),
  plus vibrate on disconnect (Pebble Classic/Steel keeps its fixed indicators)
- Night battery saver (pause updates to the watch between hours you set, to save battery)
- Night backlight dimming

LAYOUT CUSTOMIZATION
- Multiple layout presets, with flick-to-cycle between views and optional auto-return, including Weather only: rain radar, clock, weather and a big forecast without the top bar
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
