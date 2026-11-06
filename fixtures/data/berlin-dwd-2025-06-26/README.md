# Berlin, 25 and 26 June 2025: the store art's weather

The real weather `scripts/gen-store-art-fixtures.js` builds the store art from: files of the
offline snapshot recorded for the promo reel (the current store showcase), with its provenance.

- `brightsky-weather.filled.json`: DWD's hourly station records for Berlin as Bright Sky serves
  them (rain at Berlin-Friedrichshain, the rest at Berlin-Tempelhof), 18 June to 11 July 2025,
  with the chance of rain filled in from ECMWF IFS (Open-Meteo) as the app reads it.
- `openmeteo-uv-gfs.json`: the UV index the app's DWD provider takes (NOAA GFS via Open-Meteo).
- `air-quality.json`: the European AQI (CAMS via Open-Meteo), the app's Open-Meteo AQI source.
- `radar-dwd-yw-window.json`: DWD's 5-minute RADOLAN YW radar, an 8 x 8 km window around the
  point, cut to the frames the store art reads (25 June 06:00Z to 27 June 00:00Z).
- `PROVENANCE.md`: how they were recorded, what the days hold, the substitutions and caveats (the
  snapshot's other files stay with the reel).

Attribution, wherever the store art is shown: Source: Deutscher Wetterdienst (DWD), CC BY 4.0
(station observations via Bright Sky, RADOLAN radar); Weather data by Open-Meteo.com, CC BY 4.0
(ECMWF IFS, NOAA GFS); contains modified Copernicus Atmosphere Monitoring Service information 2025.
