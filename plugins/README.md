# Weather plugins

Weather plugins for the Pebble app's plugin system, built and released separately from the
WarnWeather watchface. Each is a plugin-only pbw (no watch binary) that answers `weather/location`
for any watchface or watchapp, for the Pebble app's own weather (Settings > Weather > Weather
provider) and for Index.

Plugins are a preview: the Pebble app ships with them off (Settings > Plugins > Plugins / permissions
preview turns them on), the API will still change, and publishing plugins is limited to invited
developers. See the [plugin guide](https://developer.repebble.com/guides/plugins/preview/).

The watchface doesn't read plugins yet. The shared weather vocabulary has no hourly rain, wind or UV,
only hourly temperature and condition, which is too little for its graphs. The plan is to propose
the extended readings below upstream, then add a provider to the face that reads them.

## The plugins

| Plugin | Folder | Data | Area | Internet |
| --- | --- | --- | --- | --- |
| Open-Meteo Weather | [open-meteo/](open-meteo/) | ECMWF IFS, UV from GFS | worldwide | `api.open-meteo.com` |
| DWD Weather (Bright Sky) | [dwd/](dwd/) | DWD MOSMIX and observations | Germany and the countries around it | `api.brightsky.dev` |

Both are keyless and also ask for Location.

## What they serve

One `weather/location` instance per weather location set up in the Pebble app, in its order and
under its instanceIds (the phone's position stands in for the current-location entry), with:

- **the standard readings** the plugin guide names (Weather, under Categories), in the shapes the
  built-in weather plugin uses. That includes everything the Pebble app needs to make a plugin the
  watch's weather provider.
- **extended readings** named the way the standard ones are, for watchfaces that draw a forecast.
  This list is what we'd propose upstream:

| Reading | Now | Hourly | Daily | Shapes |
| --- | --- | --- | --- | --- |
| Chance of rain, % | `precipitation` (standard) | `hourly_precipitation` | `daily_precipitation` (standard) | numericValue 0-100, shortText |
| Rain amount, mm or in | `precipitation_amount` | `hourly_precipitation_amount` | `daily_precipitation_amount` | numericValue, shortText |
| Feels like | `feels_like` (standard) | `hourly_feels_like` | | as temperature |
| Dew point | `dew_point` | `hourly_dew_point` | | as temperature |
| Humidity, % | `humidity` (standard) | `hourly_humidity` | | numericValue 0-100, shortText |
| Wind speed | `wind_speed` (standard) | `hourly_wind_speed` | `daily_wind_speed` (highest) | numericValue, shortText |
| Gusts | `wind_gust` | `hourly_wind_gust` | `daily_wind_gust` (highest) | numericValue, shortText |
| Wind direction, ° it comes from | `wind_direction` (standard) | `hourly_wind_direction` | | numericValue 0-360, shortText compass point |
| UV index | `uv_index` (standard) | `hourly_uv_index` | `daily_uv_index` (highest) | numericValue 0-11, shortText |
| Pressure at sea level, hPa or inHg | `pressure` | `hourly_pressure` | | numericValue, shortText, longText |
| Cloud cover, % | `cloud_cover` | `hourly_cloud_cover` | | numericValue 0-100, shortText |

How to read them:

- Series start at the place's local midnight, as the guide asks: hourly ones run 96 hours (so always
  72 hours ahead or more), daily ones up to 7 days.
- Interval readings (rain chance and amount, gusts, the condition) cover the hour that starts at
  their stamp. Instants (temperature, humidity, pressure, wind speed and direction) are at it.
- A numericValue is in the user's unit from `preferences/units`, and its `unit` says which. Text
  shapes use the same unit.
- A condition's shortText is at most 12 characters and its longText at most 32: what the watch's
  weather app shows of them. Condition codes are longText, as in the built-in plugin.
- `sunrise`/`sunset` and the wind direction carry a shortText too (`07:12`, `NE`), for small slots.
- A reading a provider lacks is left out, never sent empty.

Forecasts are cached for 30 minutes per place (places within about a kilometre share one). When the
provider can't be reached, a forecast up to 6 hours old stands in and is retried after 5 minutes.

## Layout

- `lib/`: what every weather plugin shares: the vocabulary (`vocabulary.js`), the user's places and
  units, the cache, sun times, and the instance builder (`instance.js` documents the normalized
  forecast a provider produces). `weather-source.js` is the source handler itself.
- `<plugin>/src/`: the provider (requests and mapping to a normalized forecast), `source.js` (what it
  serves) and `index.js` (the entry point).
- `<plugin>/package.json`: the manifest. Its `properties` block must match `lib/vocabulary.js`
  exactly (the Pebble app silently drops an undeclared shape); `test/manifest.test.js` checks it.
- `scripts/build.js`: bundles `src/index.js` with what it requires into `plugin.js` and zips it with
  `appinfo.json` (the manifest, marked `manifestVersion` 2) into the pbw. No Pebble SDK needed.
- `test/`: Node tests against recorded answers, including a port of the Pebble app's shape
  validator (`test/helpers/validate.js`).

Plugin code runs in the Pebble app's plugin engine, not on aplite's old JavaScriptCore, so the
watchface's ES5 rule doesn't apply here (modern syntax up to ES2017 is fine), but npm packages are
out: the bundler follows relative requires only.

## Build, test, install

```bash
node plugins/scripts/build.js            # every plugin; or name some: ... build.js dwd
node --test 'plugins/test/**/*.test.js'  # also part of `mise test`
```

Each build writes `plugins/<folder>/build/<name>.pbw` (and the bundled `plugin.js` beside it). To
try one, turn on the plugin preview in the Pebble app and install the pbw, e.g.
`pebble install --phone <ip> plugins/dwd/build/dwd-weather.pbw`. Its logs show in `pebble logs`.

## Releasing

A plugin is released by its own version, independently of the watchface:

1. Bump `version` in the plugin's `package.json` and add a `## <version>` section to its
   `CHANGELOG.md` (the release notes; `test/manifest.test.js` checks there is one).
2. Build, and upload `build/<name>.pbw` to the plugin's listing. The first listing is created by hand
   (`pebble publish` asks for its name, description and category; store icons are PNGs of
   `icon.svg`, e.g. `resvg -w 144 -h 144 --background white icon.svg icon-large.png`, and 80 px for
   the small one).

Keep plugin commits inside `plugins/`: release-please leaves `plugins/` out of the watchface's
version, so a `feat(plugins): ...` there doesn't bump the app. A commit that also touches app files
does.

## Adding a weather provider

1. Copy a plugin folder and give it a new `uuid` and `name`.
2. Write `src/<provider>.js`: `fetchForecast(coords, nowMs)` resolving to a normalized forecast (see
   the top of `lib/instance.js`). Keep the provider's quirks there.
3. List what it serves in `src/source.js` (`SERVES`), and set the manifest's `properties` to
   `vocabulary.declare(SERVES)`.
4. Record fixtures with its own request URLs and add a test like `test/open-meteo.test.js`.
