# DWD Weather (Bright Sky)

A Pebble plugin serving `weather/location` from the Deutscher Wetterdienst's open data, through
[Bright Sky](https://brightsky.dev): no key. One instance per weather location set up in the Pebble
app (the phone's position for the current-location one), in the user's units. It has everything the
Pebble app needs to be the watch's weather provider (Settings > Weather), plus the extended
readings listed in [../README.md](../README.md#what-they-serve), except UV, which DWD's open data
doesn't have.

- **Area:** Germany and the countries around it (latitude 45.5-56°N, longitude 5-17.5°E). All of it
  keeps Central European Time, so the local day is worked out by the EU summer-time rule. Places
  outside it are left out, and the Pebble app shows its own weather for them.
- **Data:** DWD MOSMIX forecasts from the nearest station within 50 km, with observations for the
  hours of today already past, and the latest observation for now. Sunrise and sunset are worked out
  (Bright Sky has none).
- **Permissions:** Location, and Internet for `api.brightsky.dev`.
- **Requests:** two per place, every 30 minutes at most while something reads the source.
- **Attribution:** source: Deutscher Wetterdienst ([DWD open data](https://www.dwd.de/opendata)),
  via [Bright Sky](https://brightsky.dev).

Source: [src/bright-sky.js](src/bright-sky.js) (requests and mapping), [src/source.js](src/source.js)
(what it serves). Build and test: see [../README.md](../README.md#build-test-install).
