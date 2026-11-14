# Open-Meteo Weather

Open-Meteo Weather is a Pebble plugin that serves `weather/location` from
[Open-Meteo](https://open-meteo.com). It works worldwide and needs no key. It sends one instance per
weather location set up in the Pebble app (the phone's position for the current-location one), in
the user's units. It has everything the Pebble app needs to be the watch's weather provider
(Settings > Weather), and the extended readings listed in [../README.md](../README.md#what-they-serve).

The forecast comes from the ECMWF IFS 0.25° model (`models=ecmwf_ifs025`), whose rain amount tracks
its rain chance. UV comes from NOAA GFS. The WarnWeather watchface makes the same choices for
Open-Meteo.

The plugin asks for Location, and Internet for `api.open-meteo.com`. It makes two requests per
place, at most every 30 minutes while something reads the source. Places within about a kilometre
share one forecast.

Attribution: weather data by [Open-Meteo.com](https://open-meteo.com/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its free API is for non-commercial use.

Source: [src/open-meteo.js](src/open-meteo.js) (requests and mapping), [src/source.js](src/source.js)
(what it serves). Build and test: see [../README.md](../README.md#build-test-install).
