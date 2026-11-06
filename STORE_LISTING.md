# WarnWeather — Pebble Appstore listing

## Full description (plain text — paste verbatim)

```
WarnWeather is a weather watchface for Pebble, based on the ForecasWatch2 watchface.
It supports multiple views which can be reached through a wrist flick.
Highly customizable with a modern settings UI and previews.

FORECAST
- 24-hour forecast (12, 24 or up to 66 hours on Pebble Time 2; a shorter forecast fills the
  graph) with a temperature line and configurable, battery-friendly updates
- Up to four configurable metrics such as precipitation amount & probability, cloud cover, UV index, gusts,
  wind, air pressure, feels-like temperature and dew point
- Optional day/night shading, with a line at midnight where the next day starts
- Pebble Time 2: left axis options: high/low values on the axis, on the graph or off (no left
  axis: the graph uses the full width), values that include feels-like and dew point
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
- Tap a slot in the settings page's picture of your status bars to change it
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
- Multiple layout presets, picked from pictures of the view each one gives, with flick-to-cycle between views (or a double flick, to reduce accidental view switches) and optional auto-return
- Custom layout
- First-run setup that previews your watch as you pick its layout, health view, theme and forecast look, with sensible defaults for your country and watch
- A settings page that draws your watch, every view of it, as you change it, with Revert to undo your changes

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

Each platform's listing shows, in this order:

1. `1-showcase.gif`: the showcase, about a minute on Pebble Time 2 and less where a watch has
   fewer settings: a day and a half on the watch as a time-lapse over the Whitsun weekend, from
   a calm Saturday (on Pebble Time 2 opening in the long forecast span without the left axis)
   to Sunday's thunderstorm, stopping to explain what the screen shows (the UV slot's Now / Day
   max / Both, the graph's lines, the forecast length and the left axis on Pebble Time 2, the
   calendar's holidays, tomorrow's `»` at night, the alerts before the storm), then the
   layouts and the wordmark.
2. `2-…png` to `6-…png`: five store screens, a headline over the watch's screen: the forecast,
   the alerts, the health view, the UV slot's values, Weather only (aplite: the forecast, its
   graph lines, the UV slot's values, the calendar, the UV graph).
3. The real-day time-lapse GIFs already on the listing (a day of real weather, frame by
   frame), kept as they are.

The old promo reel and the single screenshots are replaced by 1 and 2. Build the set with:

```
scripts/capture-store-art.sh v2.3.0       # every scene on all five watches
python3 -I scripts/store-art.py v2.3.0    # the GIFs and store screens
```

Output lands in `screenshot/v2.3.0/store-art/<platform>/` (also zipped as
`build/store-art/warnweather-store-v2.3.0.zip`). Upload each platform's folder to that
platform in file order. See DEV.md, Store art.

The five curated configs `scripts/capture-store-shots.sh` captures
(`screenshot/<version>/store/<platform>/<label>.png`) are no longer uploaded; they still feed
the README's framed hero shots (`mise composite`).
