# WarnWeather — Pebble Appstore listing

## Full description (plain text — paste verbatim)

```
WarnWeather is a weather watchface for Pebble, based on the ForecasWatch2 watchface.
Highly customizable with a modern settings UI and previews.


If you like this watchface and want to support the development, 
press the ❤️ button and consider buying me a coffee at
https://www.buymeacoffee.com/toaster2.


FORECAST
- 24-hour weather forecast with configurable update frequency
  Optimized for low battery consumption, messages are only sent if something changes
- Fahrenheit and Celsius temperatures
- Weather status with: 
  - Current temperature
  - City where the forecast was fetched
  - Next sunrise or sunset time
- Temperature forecast line
- Configurable metrics:
  - precipitation probability
  - precipitation amount
  - UV index
  - wind speed
  - wind gusts
- Optional day/night hatch shading
- Multiple weather providers: 
  - Weather Underground
  - OpenWeatherMap
  - Open-Meteo
  - Deutscher Wetterdienst via Bright Sky (Germany only)
- GPS or manual location with configurable GPS cache


RAIN RADAR (for now only available for Deutscher Wetterdienst)
- 2-hour precipitation nowcast in 5-minute frames — rain at your exact location plus
  the strongest rain approaching from within 2 km
- Rain countdown: when rain is on the way, the top status line turns into 
  "Drizzle / Rain / Downpour in X min",
  and while it's raining, "… for X min".
  Configurable look-ahead (30 min / 60 min / 2 hours)

HEALTH VIEW (requires a health-capable watch; heart rate needs a heart-rate sensor)
- Health status with:
  - today's steps
  - last night's sleep
  - current heart rate
- Optional last 24h chart with
  - steps per hour
  - sleep band at the bottom (light/deep)
  - heart-rate line

CALENDAR
- 3/2-week calendar with current day highlight
- Selectable start of week day (Sun/Mon)
- Customizable highlight for
  - Saturday
  - Sunday
  - Holidays (supporting 150+ countries worldwide and their region/state)

TIME
- Current time in custom color
- 12h/24h format
- Optional AM/PM format

WATCH STATUS
- Battery indicator
- Bluetooth connection indicator
- Vibrate on disconnect
- Quiet time indicator
- Sleep mode (battery-saving night pause)

LAYOUT CUSTOMIZATION
- Four layout presets set your calendar style: Full calendar (3-row), Compact
  calendar (2-row), Compact calendar (dense — health and weather status shown
  together), or No calendar (full-date strip, bigger clock/status line, full-screen
  forecast)
- The wrist-flick cycle builds itself: enable health or radar and a flick reveals
  them automatically (previewed live in settings)
- Optional auto-return to the default view a set time after flicking away
  (1-10 minutes, or never)

UPDATES
- Update notifications: get a one-time heads-up when a newer version is available in the appstore.

PLATFORMS
- Pebble Classic, Pebble Steel, Pebble Time, Pebble Time Steel, Pebble 2, and
  Pebble Time 2
```

## Screenshots 

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
