# WarnWeather Pebble appstore listing

## Full description (plain text, paste as is)

```
WarnWeather is a weather watchface for Pebble, inspired by ForecasWatch2.

FORECAST
- Hourly forecast graph: temperature plus up to four lines*
- Rain chance and amount, clouds, UV, wind, gusts, pressure, feels-like, dew point
- Lines, stripes, dots or bars, with your own colors*
- 12 to 66 hours ahead* and up to six graphs*
- Day/night shading

ALERTS*
Icons that appear only when something needs your attention:
- Rain on its way, with a countdown
- Wind, gusts, UV, air quality, pollen
- Low battery, Bluetooth lost, quiet time
- Your own warn and danger levels and colors

RAIN RADAR*
- Rain for the next 2 hours, in 5-minute steps
- Clouds, sun and lightning

STATUS BARS
- Weather condition, temperature, air quality, wind, UV, sunrise and sunset, pollen
- Date, week, city, countdown
- Steps, sleep, distance, heart rate*
- Watch and phone battery
- Name your own bars and place them on any screen*

HEALTH*
- Steps, sleep and heart rate chart for the last 24 hours

CALENDAR
- Two or three weeks, with holidays for 150+ countries

WATCH
- Up to three screens, switched with a wrist flick*
- Dark, light and black & white themes, with a night theme
- 12h/24h, clock color, smooth digits*
- Battery saver hours, night backlight*

SETTINGS
- Live preview of your watch
- 5-day forecast for your saved places

* Depends on your watch model.

If you like this watchface, press the ❤️ button. You can support its development at
https://www.buymeacoffee.com/toaster2.
```

## Screenshots

The store needs at least one screenshot per supported platform, so all five configs are
captured on every platform (aplite, basalt, diorite, emery, flint): 25 files, grouped per
platform for upload.

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
multicolor and yellow settings render in black and white.

Capture everything in one go:

```
scripts/capture-store-shots.sh v1.0.0
```

Output goes to `screenshot/v1.0.0/store/<platform>/<label>.png`, for example
`store/emery/1-calendar.png`. Upload each platform's five files to that platform in the
store listing.
