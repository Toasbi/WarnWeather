# DWD Weather (Bright Sky)

DWD Weather is a Pebble plugin that serves `weather/location` from the Deutscher Wetterdienst's open
data, through [Bright Sky](https://brightsky.dev). It needs no key. It sends one instance per
weather location set up in the Pebble app (the phone's position for the current-location one), in
the user's units. It has everything the Pebble app needs to be the watch's weather provider
(Settings > Weather), and the extended readings listed in [../README.md](../README.md#what-they-serve)
except UV, which DWD's open data doesn't have.

It covers Germany and the countries around it (latitude 45.5-56°N, longitude 5-17.5°E). The whole
area keeps Central European Time, so the plugin works out the local day with the EU summer-time
rule. Places outside the area are left out, and the Pebble app shows its own weather for them.

The forecasts are DWD MOSMIX from the nearest station within 50 km. Observations fill the hours of
today that have already passed, and the latest observation is the current weather. Bright Sky has
no sunrise or sunset, so the plugin works them out.

The plugin asks for Location, and Internet for `api.brightsky.dev`. It makes two requests per place,
at most every 30 minutes while something reads the source.

Attribution: source: Deutscher Wetterdienst ([DWD open data](https://www.dwd.de/opendata)), via
[Bright Sky](https://brightsky.dev).

Source: [src/bright-sky.js](src/bright-sky.js) (requests and mapping), [src/source.js](src/source.js)
(what it serves). Build and test: see [../README.md](../README.md#build-test-install).
