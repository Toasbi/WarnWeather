# Open-Meteo Weather

A Pebble plugin serving `weather/location` from [Open-Meteo](https://open-meteo.com): worldwide,
no key. One instance per weather location set up in the Pebble app (the phone's position for the
current-location one), in the user's units. It has everything the Pebble app needs to be the
watch's weather provider (Settings > Weather), plus the extended readings listed in
[../README.md](../README.md#what-they-serve).

- **Data:** the ECMWF IFS 0.25° model (`models=ecmwf_ifs025`), whose rain amount tracks its rain
  chance; UV from NOAA GFS. These are the WarnWeather watchface's own choices for Open-Meteo.
- **Permissions:** Location, and Internet for `api.open-meteo.com`.
- **Requests:** two per place, every 30 minutes at most while something reads the source. Places
  within about a kilometre share one.
- **Attribution:** weather data by [Open-Meteo.com](https://open-meteo.com/), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its free API is for non-commercial use.

Source: [src/open-meteo.js](src/open-meteo.js) (requests and mapping), [src/source.js](src/source.js)
(what it serves). Build and test: see [../README.md](../README.md#build-test-install).
