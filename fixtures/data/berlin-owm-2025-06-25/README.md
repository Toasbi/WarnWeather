# Berlin, 25 to 29 June 2025: the store art's weather

The real weather `scripts/gen-store-art-fixtures.js` builds the store art from: two files of
the offline snapshot recorded for the Berlin time-lapse, with its provenance.

- `owm-history.filled.json`: OpenWeather's hourly history for Berlin (One Call 3.0
  `timemachine`, imperial units), 24 June to 3 July 2025, with the chance of rain (ECMWF IFS via
  Open-Meteo), the UV index (NOAA GFS via Open-Meteo) and 44 missing gusts filled in, as the app
  reads those fields from Open-Meteo.
- `radar-dwd-yw-window.json`: DWD's 5-minute RADOLAN YW radar, an 8 x 8 km window around the
  point, 24 June 22:00Z to 30 June 04:00Z.
- `PROVENANCE.md`: how they were recorded, what the days hold, the fills and the caveats. The
  snapshot's other files (the unfilled history, the fills' sources, the air quality, the replay
  manifest) are not needed here and stay with the time-lapse.

Attribution, wherever the store art is shown: Weather data © OpenWeather (ODbL); radar: Deutscher
Wetterdienst (DWD), CC BY 4.0; chance of rain, UV and gusts: Open-Meteo.com, CC BY 4.0 (ECMWF IFS,
NOAA GFS). The history and its filled copy stay under the ODbL.
