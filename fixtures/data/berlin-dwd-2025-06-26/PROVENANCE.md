# Provenance: Berlin, 2025-06-26

This is the offline weather snapshot for the promo reel. It holds one real Berlin day, the storm
day 2025-06-26, with the eight days before it and the fourteen days after it, as the replay serves them to the app's own fetch chain. Settings: provider `dwd`, radar `dwd`, sky rows
on, AQI source Open-Meteo, location `52.52,13.405` (52.520 / 13.405, rounded to 3 decimals).
`manifest.json` lists every request the fetch cycle makes, which parameters depend on the frame
time, and the file (or record) that answers each one. The recorder is `scripts/promo/record/`
(see its README to record another day); its radar extract and its request URLs reproduce this
snapshot exactly.

Coverage: whole GMT days, 2025-06-18 to 2025-07-10. The radar covers 2025-06-20 00:05Z to
2025-07-05 03:00Z. The frame days are 06-21 to 07-07: the reel's poster and first frame is 11:00 on
06-21 on every platform, and its opening steps hourly (the "Weather only" scene shows the radar in
5-minute steps on 06-22 from 19:00 to 19:35); the Views radar shows the shower before dawn on 06-23
(03:25 to 04:55), the storm day's Alerts beats stay at their real times, and the chapters after the
storm step hourly on to 22:00 on 07-06 (23:00 on 07-07 on flint; aplite's reel ends at 02:00 on
06-30); the capture pads reach back to 06:00 on 06-21 and on to 03:00 on 07-07 (flint: its last
frame; aplite: 07:00 on 06-30). Day peaks read 49 h ahead, so the files run 3 days past the last
frame day, and every frame from 2025-06-19 00:00 to 2025-07-07 23:45 CEST has its full look-ahead.
06-18 to 06-20 have no frames: the fifth extension recorded them for a longer opening than the final
one (22:00Z on 06-20 still seeds the day-peak fetch at local midnight of 06-21). Every frame from
02:00 CEST on 06-20 to 03:00 CEST on 07-05 gets a full 2-hour radar window. Recorded on 2026-09-28 for 06-25 to 06-29
(radar to 06-27 06:00Z); Bright Sky was recorded again the same night in app-sized windows.
Extended on 2026-09-29 to 07-01 (radar to 06-29 06:00Z), again the same day to 06-24 to 07-04
(radar 06-25 04:05Z to 06-30 09:00Z), and a third time the same day to 06-22 to 07-06 (radar
06-24 09:05Z to 07-01 20:00Z), with the same recorder; the data already here did not change any
time (see Verification). Extended on 2026-09-29 a fourth time, to 06-20 to 07-06 (radar 06-22
00:05Z to 07-01 20:00Z), for the opening at the faster pace; the data already here did not change
either. Extended on 2026-09-29 a fifth time, to 06-18 to 07-10 (radar 06-20 00:05Z to 07-05
03:00Z), for the fast clock with no scene shorter than before it; the data already here did not
change either.

## Sources

| File | What | Observation or model | From |
|---|---|---|---|
| `brightsky-weather.json` | Hourly weather: twelve raw responses in app-sized windows, joined on their timestamps | Observation: DWD stations. Rain: Berlin-Friedrichshain 17473 (1.9 km). Temperature, wind, gusts, cloud, dew point, pressure: Berlin-Tempelhof 00433 (5.8 km). Sunshine: Dahlem 00403. Solar: Potsdam 03987 | Bright Sky `/weather` |
| `brightsky-weather.filled.json` | The same, with the chance of rain filled in (on 06-19 to 06-22 the reel reads it from 96 h later, a declared substitution) | Observation, plus model for the chance | Derived (see Substitutions) |
| `radar-dwd-yw-window.json` | 5-min radar, 8×8 km window, 4356 frames | Observation: radar | DWD Climate Data Center, RADOLAN YW |
| `openmeteo-uv-gfs.json` | UV index | Model: NCEP GFS | Open-Meteo Historical Forecast |
| `openmeteo-sky15.json` | Sky rows: cloud layers, sun (DNI), lightning potential, weather code, 15 min | Model: Open-Meteo best_match | Open-Meteo Historical Forecast |
| `air-quality.json` | European and US AQI | Model: CAMS | Open-Meteo Air Quality |
| `manifest.json` → `place` | City slot (`district` = "Mitte") | Our own place-name record | Written for the snapshot; the replay builds the reverse-geocode answer from it |
| `openmeteo-forecast-ecmwf.json` | Source of the chance-of-rain fill. The dwd provider does not request it | Model: ECMWF IFS 0.25 | Open-Meteo Historical Forecast |
| `openmeteo-aux.json` | Open-Meteo provider aux call. The dwd provider does not request it | Model: best_match | Open-Meteo Historical Forecast |
| `openmeteo-precip15-fallback.json` | Radar fallback only: model rain at the point | Model: best_match | Open-Meteo Historical Forecast |

Sunrise and sunset are not stored. The app computes them with SunCalc.

## The other days

Frame days are 06-21 (from the poster at 11:00; capture pads from 06:00) to 07-07 (flint's last
frame at 23:00; capture pads only on emery and basalt, to 03:00); 06-18 to 06-20 and 07-08 to 07-10
have no frames. Hours are CEST, each hourly value is the hour ending at its stamp.

- **2025-06-18 (Wednesday), no frames:** Observations (from 02:00): 15.7 to 27.8 °C, 66 % cloud, 12 h 11 min of sun, gusts up to 43 km/h (14–15 h), dry. Model: GFS UV up to 6.55 (7 shown from 13 to 15 h), no lightning in the sky rows, ECMWF chance of rain 2 % at most (14–17 h), then 22 % in the last two hours (the 3-hour block that ends at 02:00 on 06-19).
- **2025-06-19 (Thursday), no frames:** sunny and cooler. Observations: 15.3 to 21.9 °C, 33 % cloud, 13 h 12 min of sun, gusts up to 49 km/h (15–16 h), dry. Model: GFS UV up to 6.9 (7 shown from 12 to 15 h), no lightning in the sky rows, ECMWF chance of rain 22 % until 02:00, then 0 %; the substitution gives it 06-23's chance from 03:00 instead (up to 75 %, see Substitutions). No radar (it starts on 06-20).
- **2025-06-20 (Friday), no frames (22:00Z seeds the day-peak fetch at local midnight of 06-21):** clear. Observations: 11.6 to 23.6 °C, 7 % cloud, 15 h 18 min of sun, gusts up to 36 km/h (12–13 h), dry, and dry on the radar (from 02:00). Model: GFS UV up to 6.9 (shown as 7), no lightning in the sky rows (0 % cloud in them through the night), ECMWF chance of rain 0 %; the substitution gives it 06-24's (up to 45 %, see Substitutions).
- **2025-06-21 (Saturday), the reel's poster and first frame (11:00; capture pads from 06:00), then the opening's full calendar, on every platform:** sunny and warmer. Observations: 11 to 29 °C, 29 % cloud, 15 h 35 min of sun, gusts up to 23 km/h (15–16 h), dry, and dry on the radar. Model: GFS UV up to 6.9 (shown as 7), no lightning in the sky rows, ECMWF chance of rain 0 %; the reel shows 06-25's (up to 98 %, see Substitutions).
- **2025-06-22 (Sunday), the opening: the full calendar to 02:00, the dense compact calendar from 03:00, the Views layout's first view from 11:00, "Weather only" with the radar from 19:00 to 19:35 and no calendar from 20:00; on aplite no calendar from 03:00, then the Forecast graph scene from 11:00:** hot. Observations: 15 to 34 °C, 60 % cloud, 14 h 18 min of sun, gusts up to 36 km/h (14–15 h), dry, and dry on the radar. Model: GFS UV up to 6.95 (shown as 7), no lightning in the sky rows, ECMWF chance of rain 0 %; the reel shows 06-26's (up to 92 % from 18 to 20 h, see Substitutions).
- **2025-06-23 (Monday), the end of the opening (to 03:00), the Views radar on the shower before dawn (03:25–04:55), the health view from 05:00 to 19:00, then the Alerts setup (alerts-row) from 20:00; on aplite the Forecast graph scene all day:** a
  shower before dawn and a gusty evening. Observations: 16.5 to 27 °C, 63 % cloud, 8 h 47 min of
  sun, gusts up to 99.7 km/h (17–18 h), 0.2 mm at the gauge (05–06 h). The radar has rain at the
  point from 04:45 to 05:00 (peak 9.8 mm/h) and from 17:05 to 17:10 (peak 2.9 mm/h). Model: GFS UV
  up to 5.9, lightning in the sky rows 04:15–05:00, ECMWF chance of rain up to 75 %.
- **2025-06-24 (Tuesday), the Alerts setup (alerts-row) all day; on aplite the Forecast graph scene to 14:00:** Observations: 14 to 24 °C, 87 % cloud on average, 2 h 47 min of sun,
  gusts up to 55 km/h (16–17 h), 0.4 mm at the gauge between 13 and 15 h. The radar has rain at the
  point from 12:55 to 14:00 (peak 1.1 mm/h). Model: GFS UV up to 4.7, no lightning in the sky rows,
  ECMWF chance of rain 45 % at most.
- **2025-06-25 (Wednesday), the Alerts setup (alerts-row) to 06:00, then the UV and gust slots (alerts-both) from 07:00:** wet morning, then broken
  sun. Observations: 16.5 to 25 °C, 77 % cloud, 4 h 48 min of sun, gusts up to 55 km/h (16–17 h),
  7.0 mm at the gauge, 6.9 of it between 04 and 09 h. The radar has rain at the point from 03:50 to
  05:45 (peak 8.1 mm/h) and from 06:25 to 07:40 (peak 1.3 mm/h), and drizzle from 09:45 to 09:55;
  the window holds all of it (see the caveats for the rain alert). Model: GFS UV up to 6.8 (12–13 h,
  shown as 7), no lightning in the sky rows, ECMWF chance of rain up to 98 % (05–08 h).
- **2025-06-27 (Friday):** grey and cooler. Observations: 17 to 22 °C, 91 % cloud on average, 5 h 15 min
  of sun, gusts up to 54 km/h around noon, and a short shower: the radar has rain at the point from
  12:25 to 13:00 CEST, the Friedrichshain gauge 0.7 mm between 12 and 14 CEST. Model: GFS UV up to
  5.6, no lightning in the sky rows, ECMWF chance of rain 100 % for 11 to 14 CEST.
- **2025-06-28 (Saturday):** dry, sunny and warm again. Observations: 14 to 29 °C, 10 h 40 min of
  sun, gusts up to 45 km/h, no rain at the gauge or on the radar. Model: GFS UV up to 6.6 (the 14–15
  CEST hour, shown as 7), no lightning in the sky rows, ECMWF chance of rain 4 % at most.
- **2025-06-29 (Sunday):** dry, warm, sun and cloud. Observations: 21 to 28 °C, 53 % cloud,
  10 h 24 min of sun, gusts up to 54 km/h (19–20 h), no rain at the gauge or on the radar. Model:
  GFS UV up to 6.85 (13–14 h, shown as 7), no lightning in the sky rows, ECMWF chance of rain 73 to
  100 % from 08 to 14 h while it stayed dry.
- **2025-06-30 (Monday):** dry and sunny, fresher. Observations: 14 to 26.5 °C, 25 % cloud,
  16 h 5 min of sun, gusts up to 46 km/h (14–15 h), no rain at the gauge or on the radar.
  Model: GFS UV up to 6.9 (7 shown from 12 to 15 h), no lightning in the sky rows, ECMWF chance of
  rain 0 %.
- **2025-07-01 (Tuesday):** hot and cloudless. Observations: 14 to 32 °C, 0 % cloud, 16 h 3 min
  of sun, gusts up to 26 km/h, dry, and dry on the radar. Model: GFS UV up to 7.0 (7
  shown from 12 to 15 h), no lightning in the sky rows, ECMWF chance of rain 0 %.
- **2025-07-02 (Wednesday), the status bars with the radar from 22:00 (status-dense):** hotter
  still and clear. Observations: 18 to 37 °C, 1 % cloud, 15 h 53 min of sun, gusts up to 26 km/h,
  dry, and dry on the radar. Model: GFS UV up to 7.0, no lightning, ECMWF chance of rain 0 %.
- **2025-07-03 (Thursday), the status bars with the radar all day (status-dense):** cooler with
  cloud. Observations: 17.5 to 28.5 °C, 67 % cloud, 7 h 10 min of sun, gusts up to 51 km/h
  (13–14 h), 0.7 mm at the gauge between 08 and 10 h. The radar has rain at the point from 07:45 to
  09:35 with breaks (peak 1.5 mm/h; see the caveats for the rain alert). Model: GFS UV up to 6.85,
  showers in the sky rows' weather codes but no lightning, ECMWF chance of rain up to 90 %.
- **2025-07-04 (Friday), the status bars with the radar to 22:00 (status-dense):** fresh and dry.
  Observations: 13 to 24 °C, 46 % cloud, 11 h 5 min of sun, gusts up to 37 km/h, dry, and dry on the
  radar. Model: GFS UV up to 6.75, no lightning, ECMWF chance of rain 0 %.
- **2025-07-05 (Saturday), the last status scenes, then the clock faces from 17:00:** warm, mostly cloudy, dry. Observations: 14 to 28.6 °C, 74 % cloud, 11 h 8 min of sun, gusts up to 42 km/h (14–15 h), and dry on the radar (to 05:00). Model: GFS UV up to 6.0, no lightning, ECMWF chance of rain 2 % at most.
- **2025-07-06 (Sunday), the clock faces; the reel's last frame at 22:00 on emery and basalt:** overcast and dry. Observations: 18.6 to 28.5 °C, 99 % cloud at Tempelhof, 6 h 40 min of sun at Dahlem, gusts up to 45 km/h (16–17 h). Model: GFS UV up to 6.35, no lightning, ECMWF chance of rain up to 14 %.
- **2025-07-07 (Monday), flint's last day (the clock faces, its last frame at 23:00); capture pads only on emery and basalt (to 03:00):** grey, with heavy rain in the evening. Observations: 16.8 to 24.3 °C, 93 % cloud, 2 h 50 min of sun, gusts up to 31 km/h (17–18 h), 11.5 mm at the gauge, 10.8 of it between 17 and 19 h. Model: GFS UV up to 5.85, lightning in the sky rows 17:15–18:00, ECMWF chance of rain up to 94 %. No radar (it ends at 05:00 on 07-05).
- **2025-07-08 (Tuesday), look-ahead only:** cool and grey. Observations: 13.6 to 21.5 °C, 87 % cloud, 6 h 36 min of sun, gusts up to 39 km/h (16–17 h), 0.8 mm at the gauge between 03 and 05 h. Model: GFS UV up to 5.7, no lightning, ECMWF chance of rain up to 92 %.
- **2025-07-09 (Wednesday), look-ahead only:** cool and grey. Observations: 15.7 to 21.1 °C, 94 % cloud, 2 h 1 min of sun, gusts up to 44 km/h (17–18 h), 1.7 mm at the gauge between 09 and 12 h; the 11:00 temperature, dew point and humidity are Dahlem's (Tempelhof has a gap). Model: GFS UV up to 6.05, no lightning, ECMWF chance of rain up to 82 %.
- **2025-07-10 (Thursday), look-ahead only (data to 02:00 on 07-11):** grey, with heavy rain in the afternoon. Observations: 15.5 to 21.5 °C, 95 % cloud, 4 h 27 min of sun, gusts up to 30 km/h (11–12 h), 12.9 mm at the gauge, 10.1 of it between 13 and 14 h. Model: GFS UV up to 5.95, lightning in the sky rows 14:15–15:00, ECMWF chance of rain up to 94 %.

## Attribution and licences

- **DWD:** Source: Deutscher Wetterdienst (DWD), CC BY 4.0 (dwd.de/copyright). Station
  observations come via Bright Sky. RADOLAN YW radar comes from opendata.dwd.de. Changes: the
  radar is cut to an 8×8 km window, and a chance of rain from ECMWF is added to the observations
  (from 06-19 to 06-22 the ECMWF chance of 96 h later, see Substitutions).
- **Bright Sky:** brightsky.dev, an open-source JSON API for DWD open data. The data is DWD's,
  so the DWD line above applies.
- **Open-Meteo:** Weather data by Open-Meteo.com, CC BY 4.0. Models: NOAA NCEP GFS (UV),
  ECMWF IFS (© ECMWF, CC BY 4.0) and Open-Meteo best_match.
- **Air quality:** Contains modified Copernicus Atmosphere Monitoring Service information 2025
  (CAMS, via Open-Meteo, CC BY 4.0).
- **Geocoding:** none stored. The City slot's answer is synthesized from the snapshot's own
  place-name record (Berlin, district Mitte), because Esri's terms limit storing geocode results.

## Substitutions

1. **Chance of rain.** DWD observations carry no `precipitation_probability`, so it is null in all
   553 records. In the filled file it comes from ECMWF IFS 0.25 (`ecmwf_ifs025`), read by 3-hour
   ensemble block, the same way the app reads that field (`openmeteo.js`
   `ensembleBlockSlice`). All 553 records are filled.
2. **Radar.** Bright Sky `/radar` keeps only 6 h, and for past dates it returns `"radar": []`.
   The frames therefore come from DWD's own YW 5-min archive. The unit is the same (0.01 mm per
   5 min), but the grid is DWD's 900×900 national grid, not Bright Sky's 1200×1100 grid. Both are
   1 km polar stereographic. The replay serves observed frames as the 2-hour nowcast: at every
   frame, the "forecast" is what actually happened next.
3. **Current weather.** Bright Sky `/current_weather` has no archive. The replay rebuilds it at
   the frame time from the hourly records.
4. **Open-Meteo `current=`.** The historical API answers `current=` with today's values. The
   replay rebuilds `current` from the hourly series, and `wind_speed_10m` is stored as an hourly
   field in `openmeteo-aux.json` for that.
5. **City.** The reverse geocode is not stored. The replay answers it in ArcGIS's shape from the
   manifest's `place` record (district Mitte, city Berlin, region Berlin, country DEU).
6. **Chance of rain on 06-19 to 06-22, borrowed (promo only).** ECMWF's chance of rain is 0 % in
   every 3-hour block from the record stamped 03:00 on 06-19 to the one stamped 02:00 on 06-23
   (01:00Z on 06-19 to 00:00Z on 06-23), so the opening's filled rain-chance line had nothing to
   draw (nor had aplite's Forecast graph scene, whose first graphs, from 11:00 on 06-22, look ahead
   into those days with the same filled line). The owner's call: "just copy rain chance from the time after that you already have. That
   way it's realistic and you don't have to make it up". The manifest declares it
   (`substitutions`, `rain-chance-borrowed`): those 96 records take the chance of the record
   96 h later, hour for hour, from the showery days right after (03:00 on 06-23 to 02:00 on 06-27,
   0 to 98 %). So 06-19 shows 06-23's chance from 03:00 (up to 75 %), 06-20 shows 06-24's (up to
   45 %), 06-21 shows 06-25's (up to 98 %) and 06-22 shows 06-26's (up to 92 %). They are real
   ECMWF values, in whole 3-hour blocks, at the same time of day four days later. Only the chance
   is copied: the rain amounts stay the observed 0 mm (the rain bars stay empty), the radar stays
   the real, dry radar, and `brightsky-weather.filled.json` stays as recorded. The replay, the
   planner and the coherence report apply the substitution when they read the file
   (`scripts/promo/lib/substitutions.js`). 06-18 and everything from 03:00 on 06-23 are as
   recorded.

## Known caveats

- **Radar time stamp, ±5 min.** A YW stamp is read as the END of its 5 minutes, which is what
  `dwd-radar.js` assumes for Bright Sky. DWD only calls it "Zeitpunkt der Messung". If it is the
  start, every radar time moves 5 min later. The rain at the point is then 18:20–18:30 CEST, not
  18:15–18:25.
- **Short rain at the point.** On the radar, rain at the point lasts 10 min (18:15–18:25 CEST).
  The Friedrichshain gauge measured about 20 min (18:20–18:40).
- **Cloudy noon vs the UV model.** UV is GFS model output. The clouds and the sunshine are station
  observations. From 12 to 13 CEST Dahlem saw 2 min of sun and Tempelhof 100 % cloud, and GFS dips to
  UV 3.5 in that hour. At 13–15 CEST GFS peaks at 6.5, while the sun came back only at 14:00. From
  15 to 16 CEST there were 57 min of sun, but GFS UV is down to 1.6. The UV slot and the cloud line
  therefore need not agree.
- **Lightning is model output.** Weather code 95/96/99 or `lightning_potential` ≥ 1 in the sky
  rows. Observed lightning is not used.
- **Gusts.** The app reads Berlin-Tempelhof: 94.0 km/h in the 18–19 CEST hour. That reaches danger
  at the default gust levels (60/90 when this was written; 2.0 seeds gusts at 65/90 km/h,
  `status-thresholds.js` SEEDS, and 94.0 is danger there too). The checkpoint-1 figure of 86.4 km/h is BER airport's, which
  Bright Sky only serves to requests of 73 records or more (see Verification).
- **Station choice depends on the request window.** Bright Sky picks its fallback stations per
  request. Every window the app builds (25 to 50 records) gets Tempelhof for temperature, wind,
  gusts, cloud, dew point and pressure; a window of 73 records or more gets Dahlem and BER instead.
  So Bright Sky is recorded in windows of at most 72 h, and must be re-recorded that way. One
  station change does not depend on the window: at 11:00 CEST on 07-09 Tempelhof has no temperature,
  dew point or humidity, and Dahlem answers them in every window. No frame reads that hour.
- **Pollen is left out.** DWD Pollenflug has no archive, and no setup may show it unless a
  synthetic band is added and marked as such.
- **City slot reads "Mitte".** The app shows `address.District || City || Region`, and the point
  lies in the Mitte district. No app setting names the city instead: the reverse geocode always
  runs on the fetch coordinates, and a manual address only moves those coordinates.
- **Radar window edges.** A frame before 02:00 CEST on 06-20, or after 03:00 CEST on 07-05, gets a
  partial radar window (the host logs `radar partial n/24`), and the missing part reads as dry. A
  frame whose window holds no archived frame at all gets a 404 (`MISS-COVERAGE`). The planner's
  coverage guard (`scripts/promo/plan/coverage.js`) refuses a plan with such a frame in a setup that
  fetches the radar.
- **A rain alert on 06-25.** The morning rain is on the radar: "Rain in 60′" from 02:50 CEST,
  rain from 03:50 to 05:45 with short breaks (peak 8.1 mm/h), "Rain in 25′" at 06:00, "Rain for 20′"
  at 06:25, rain and drizzle until 07:40, then "Drizzle in 60′" from 08:45, "Drizzle for 10′" at
  09:45, and gone at 09:55 (the same words on emery, basalt and flint; aplite fetches no radar).
  Every setup has the rain alert on, so a setup that fetches the radar shows it in that time
  (written for the pre-2.0 design, where `alertRain` switched it on; since 2.0 the rain alert draws
  on a status bar with the Rain item placed On demand, and the reel's base keeps the default tick at
  the top strip's left): in the current plan the Alerts setup (alerts-row) steps hourly to 06:00 on
  06-25 and alerts-both on from 07:00, and their frames read
  "Rain in 50′" (03:00), "Rain for 5′" (04:00), "Rain for 45′" (05:00), "Rain in 25′" (06:00),
  "Rain for 10′" (07:00) and "Drizzle in 45′" (09:00).
- **A rain alert on 06-23.** The shower before dawn is on the radar: "Rain in 60′" from 03:45 CEST,
  "Rain for 15′" at 04:45, and gone at 05:00 (peak 9.8 mm/h, Rain on every platform). The Views
  radar (views-radar) steps through it in 5 minutes from 03:25 to 04:55: no text to 03:40, then
  "Rain in 60′" down to "Rain in 5′" (04:40), "Rain for 15′" at 04:45 and "Rain for 5′" at 04:55.
  The evening cell ("Rain in 60′" from 16:05, "Rain for 5′" at 17:05, peak 2.9 mm/h) is in the
  radar window of the health view (views-health, which fetches the radar) at its 17:00 frame
  ("Rain in 5′"), but that view shows no bar with the Rain item (the top strip and the health bar;
  the reel ticks Rain on the forecast bar), so nothing draws it.
- **A shower on 06-24.** The radar has rain at the point from 12:55 to 14:00 CEST (peak 1.1 mm/h):
  "Rain in 60′" from 11:55, "Rain for 65′" at 12:55, and gone at 14:00 (Rain on every platform). In
  the current plan the Alerts setup (alerts-row) steps hourly through 06-24 with the Rain item at the
  top strip's left, so its 12:00 and 13:00 frames draw it ("Rain in 55′", "Rain for 60′").
- **A rain alert on 06-27.** The midday shower is on the radar too: "Rain in 60′" from 11:25 CEST,
  "Rain for 35′" at 12:25, then "Drizzle for 5′" at 12:55, and gone at 13:00 (peak 3.3 mm/h, Rain
  on every platform). A setup whose status bars show the Rain item around noon on 06-27 shows it.
- **A rain alert on 07-03.** The morning showers are on the radar: "Drizzle in 60′" from 06:45 CEST,
  "Drizzle for 5′" at 07:45, "Drizzle in 15′" at 07:50, "Drizzle for 5′" at 08:05, "Rain in 25′" at
  08:10, "Rain for 30′" at 08:35, "Drizzle for 10′" at 08:55, "Rain in 15′" at 09:05, "Rain for 15′"
  at 09:20, and gone at 09:35 (peak 1.5 mm/h, the same words on emery, basalt and flint). In the
  current plan status-dense fetches the radar all day on 07-03, so its hourly frames read "Drizzle
  in 45′" (07:00), "Drizzle in 5′" (08:00) and "Drizzle for 5′" (09:00).
- **UV 7 is not only the storm day's.** GFS UV rounds to 7 around noon on every frame day but
  06-23, 06-24, 06-27 and 07-05 to 07-07: 6.9 on 06-21, 6.95 on 06-22, 6.8 on 06-25, 6.55 on
  06-26, 6.6 on 06-28, 6.85 on 06-29, 6.9 on 06-30, 7.0 on 07-01 and 07-02, 6.85 on 07-03 and 6.75
  on 07-04 (6.0, 6.35 and 5.85 on 07-05 to 07-07; 6.55 to 6.9 on 06-18 to 06-20 and at most 6.05 on
  07-08 to 07-10, days without reel frames). At the reel's UV levels (5/7) a UV slot reads danger at
  noon on those days too. The UV alert sits at its default spot (the top strip's right) in every
  setup but the health view: the opening judges today only (`openingAlerts`), so its icon comes and
  goes there, and after the storm it judges today and tomorrow, so a UV icon shows in every frame.
- **Borrowed chance, dry days.** From 03:00 on 06-19 to 02:00 on 06-23 the snapshot holds the
  chance of rain of four days later (Substitutions, 6), up to 98 %, over 0 mm of rain and a dry
  radar, so the opening's graphs draw a chance of rain over empty rain bars until the 06-23 shower
  reaches their right edge (from 06:00 on 06-22). A chance of rain is not rain, as on 06-29 below.
- **Model chance, dry day.** On 06-29 ECMWF gives a 73 to 100 % chance of rain from 08 to 14 CEST,
  but the stations stayed dry. Frames from about 09:00 CEST on 06-28 on have that chance in their
  24 h look-ahead.
- **Radar fallback file.** `openmeteo-precip15-fallback.json` (model rain at the point) is
  documented data only. No replay entry reads it: the replay builds every `/radar` answer from
  `radar-dwd-yw-window.json`, so a radar request it cannot answer fails loudly instead of falling
  back to model rain.

## Verification

Adversarial check on 2026-09-29, by an agent other than the recorder. The scripts are in
`scratchpad/snapshot/adversarial/` (not committed).

**Fix: Bright Sky re-recorded (`brightsky-weather.json`, `brightsky-weather.filled.json`).**
- Problem: the first recording asked Bright Sky for all 121 hours in one request. Bright Sky picks
  its fallback stations per request window: a window of 73 records or more gets Dahlem (temperature,
  cloud, dew point, pressure) and BER airport (wind, gusts). Every window the app builds
  (`dwd.js` `forecastWindow()`, 25 to 50 records) gets Berlin-Tempelhof for all of those. So the
  file held values the app never receives. For example, the storm hour's gust was 86.4 km/h
  instead of 94.0, and 17:00 CEST read 31.8 °C instead of 32.1.
- Fix: recorded again as three windows of 49, 49 and 25 records, joined on their timestamps. The
  records at the shared timestamps are identical. The result equals, record for record, the
  answers to all 62 windows the app builds for frames from 06-26 00:00 to 06-27 06:00 CEST (both
  the 24 h window and the day-peak window). It also equals 5 more app-sized windows over 06-25 and
  06-27 to 06-30. Precipitation (Friedrichshain) is unchanged. The chance of rain was filled again
  with the same 3-hour block rule: 121 of 121 records.
- Knock-on changes to the checkpoint-1 numbers: the gust is 94.0 km/h in the 18–19 CEST hour,
  which is danger at the default gust levels (60/90), not only at 60/80 (the pre-2.0 defaults; 2.0
  seeds gusts at 65/90 km/h, where 94.0 is danger too). The day's gust hours
  before the storm change too (e.g. 26.6 km/h, not 43.2, for 17–18 CEST). Tmax is 32.1 °C (15Z).
  UV, rain, radar, sky rows and AQI are not affected.

**Checks that passed:**
- URL builders: all 8 request templates match `dwd-radar.js` `buildRadarUrl`, `radar-sky.js`
  `buildOpenMeteoSkyUrl`, `provider.js` `withCityName`, `dwd.js` `withDwdForecast` /
  `withDwdCurrent`, `openmeteo.js` `buildUvUrl`, `air-quality.js` `buildAqiUrl` and `pollen.js`
  `buildUrl`. Every entry id `replay.entryId()` derives from them is in `entries`. The fetch cycle
  makes no weather request that the snapshot lacks, apart from the ones listed under
  `not_recorded` (current weather, pollen, WAQI, LocationIQ).
- Coverage: no gaps and no nulls in any series (ECMWF's `windgusts_10m` is all null by design).
  Bright Sky has 121 hours, 06-25T00Z to 06-30T00Z. UV, AQI and aux have 120 hours and the 15-min
  files 480 quarter hours, 06-25 to 06-29. ECMWF runs to 06-30. The radar has 361 frames every
  5 min, 06-26T00:00Z to 06-27T06:00Z.
- Live re-query: 14 values from narrow windows (Bright Sky 5, GFS UV 3, sky rows 3, AQI, ECMWF
  chance, ArcGIS District). All 14 are identical after the fix; before it, 4 Bright Sky values
  differed.
- Radar: 6 frames decoded again from the YW tars with a separate decoder (06-26 00:00Z, 16:05Z,
  16:15Z, 16:20Z, 06-27 00:00Z, 06:00Z). All are identical to the window, cell for cell. The
  point's grid index (762.476, 632.601) was derived again from the sphere projection (header
  `VS 2`), which reproduces the grid's four published corners.
- Rain alert: the app's `dwd-radar.js` on `brightsky_crop`, then `rain_countdown.c` and
  `rain_tier.c` reimplemented line for line, every minute from 06-26 00:00 to 06-27 06:00 CEST.
  Result: no alert until "Rain in 60′" at 17:15 CEST, "Rain for 10′" at 18:15, gone at 18:25. The
  peak (195 tenths, tier 5) reads Downpour on emery and Rain on the 144 px platforms. The 5×5 crop
  and the 8×8 window give identical tuples for all 361 slot 0s.
- Key numbers: the UV slot shows 7 at 13–15 CEST (GFS 6.5 and 6.55 → 65 and 66 tenths). The
  bolt is in the sky rows from 16:20 to 19:10 CEST: at 16:15 the 18:15 lightning quarter hour
  still lies just past the 2 h radar window, and it leaves at 19:15.
- Files: only JSON and this file; no tar or binary data.

**Extension to 07-01 (2026-09-29).** Recorded with `scripts/promo/record/` (`record.js
--first-day 2025-06-26 --last-day 2025-06-28`, then `extract_radar.py` over YW-250626 to
YW-250629). The checks are in `scratchpad/pipeline/cp4/snapA/` (not committed).
- No drift: every source was fetched again, and the data already here is unchanged. The 121 old
  Bright Sky records, raw and filled, are byte-identical, and the old records' text is a byte prefix
  of the new files. Every old Open-Meteo, AQI, UV and sky-row value is identical at its stamp
  (6,240 values), and the 361 old radar frames are byte-identical. Only the station list's
  `last_record` dates for Tempelhof and Potsdam moved on by a day.
- Bright Sky writes an object's keys in no fixed order: `fallback_source_ids` comes back in a
  different order from request to request. The stitch therefore compares data, not key order, and
  a re-record keeps a committed record whose data is unchanged.
- Bright Sky: 169 records, 06-25T00Z to 07-02T00Z, in windows of 49 + 49 + 49 + 25 records,
  Tempelhof for temperature and gusts in all four. The 86 windows the app builds for hourly frames
  from 06-27 06:00 to 06-29 00:00 CEST (the 24 h window and the day-peak window) were fetched live
  again: all 2,688 records equal the stitch. The chance is filled in all 169 records.
- Radar: 937 frames, no gaps, and no missing, clutter or negative cells in the window.
  `validate_radar.js`: the 5×5 crop and the 8×8 window give the same tuples for all 914 slot 0s,
  and slot 0 equals an independent full-grid decode of the tars at the point for all 914.
- URLs: the recorder's dry-run URLs equal the URLs it fetched and the manifest's endpoints, and
  every URL the app built in `enumerate.js` maps to its entry.
- Chain: the promo phone chain (`scripts/promo/report/headless-phone.js`) ran every setup of the
  current plan at 12:30 on 06-27, and at 12:00, 23:55 and 24:00 on 06-28 (emery: 23 setups; aplite:
  10 setups, 12:00 and 24:00 only). All 112 frames were answered from this directory with 0
  misses. `enumerate.js` at 13:00 on 06-27, 12:00 on 06-28 and 00:00 on 06-29: 0 misses, and
  every answer is as long as its request asks (Bright Sky up to 50 records, UV 96 h, 24 radar
  frames).

**Second extension, 06-24 to 07-04 (2026-09-29).** For the reel's final pacing: its start is laid
out backwards from the storm day's Alerts beats into 06-25 (first frame 05:00 CEST), and the later
chapters run on to 07-01 (last frame 12:00); the capture pads reach 02:00 and 15:00. Recorded with
`scripts/promo/record/` (`record.js --first-day 2025-06-25 --last-day 2025-07-01`, then
`extract_radar.py --from 2025-06-25T04:05Z --to 2025-06-30T09:00Z` over YW-250625 to YW-250630),
first into a copy under `build/`, then compared with the files here. The checks are in
`scratchpad/pipeline/cp4/snapB/` (not committed).
- No drift: the 169 Bright Sky records already here, raw and filled, are byte-identical (0 changed,
  0 dropped, 96 added). Every old Open-Meteo, AQI, UV and sky-row value is identical at its stamp
  (8,640 values), and the 937 old radar frames are byte-identical. Bright Sky's station list gained
  Berlin-Wedding 17452 and Berlin-Friedrichshain-Nord 19897, which answer the condition in four new
  records (06-24 12–13Z, 07-03 07–08Z).
- Bright Sky: 265 records, 06-24T00Z to 07-05T00Z, in windows of 49 + 49 + 49 + 49 + 49 + 25
  records, Tempelhof for temperature and gusts in all six. The 180 windows the app builds for hourly
  frames from 06-25 00:00 to 06-26 00:00 and from 06-29 00:00 to 07-01 16:00 CEST (the 24 h window
  and the day-peak window) were fetched live again: all 5,786 records equal the stitch, none is
  missing, and Tempelhof answers temperature and gusts in all 180. The chance is filled in all 265.
- Radar: 1500 frames, no gaps, and no missing, clutter or negative cells in the window.
  `validate_radar.js`: the 5×5 crop and the 8×8 window give the same tuples for all 1477 slot 0s,
  and slot 0 equals an independent full-grid decode of the six tars at the point for all 1477.
- URLs: the recorder's dry-run URLs equal the URLs it fetched and the manifest's endpoints; each
  Open-Meteo URL carries the live builder's query minus the window parameters, plus whole days; the
  Bright Sky windows have `dwd.js`'s exact shape; every URL the app built in `enumerate.js` maps to
  its entry.
- Coverage: `node scripts/promo/plan/index.js` plans all four platforms with the coverage guard on
  (forecast frames 06-25 00:00 to 07-01 23:45, radar frames 06-25 06:00 to 06-30 09:00 CEST).
- Chain: the promo phone chain ran every capture of the current plans at their first and last watch
  time (pads included) and every setup at its own first and last capture: 154 frames (emery 46,
  basalt 46, flint 42, aplite 20), all answered from this directory with 0 misses. The 8 radar
  setups' edge frames get a full 24-frame radar answer. `enumerate.js` (radar on) at 06:00 on 06-25
  and 09:00 on 06-30, and (radar off, as the plan's setups there) at 02:00 on 06-25 and 15:00 on
  07-01: 0 misses, and every answer is as long as its request asks.

**Third extension, 06-22 to 07-06 (2026-09-29).** For the new opening: the reel's poster is now at
00:00 on 06-24 and its opening steps hourly to the radar flick on 06-25, and the scrub after the
storm runs on to 20:00 on 07-02 (11:00 on 07-03 on flint); the capture pads reach 19:00 on 06-23
and 16:00 on 07-03. Recorded with `scripts/promo/record/` (`record.js --first-day 2025-06-23
--last-day 2025-07-03`, then `extract_radar.py --from 2025-06-24T09:05Z --to 2025-07-01T20:00Z`
over YW-250624 to YW-250701), first into a copy under `build/`, then compared with the files here.
The checks are in `scratchpad/pipeline/cp4b/snapshot/` (not committed).
- No drift: the 265 Bright Sky records already here, raw and filled, are byte-identical (0 changed,
  0 dropped, 96 added), and their text is one contiguous run of the new files. Every old Open-Meteo,
  AQI, UV and sky-row value is identical at its stamp (13,440 values), and the 1500 old radar frames
  are byte-identical. Bright Sky's station list is the same seven stations; five of them report a
  `last_record` one day later.
- Bright Sky: 361 records, 06-22T00Z to 07-07T00Z, in windows of 7 × 49 + 25 records, Tempelhof for
  temperature and gusts in all eight. The 158 windows the app builds for hourly frames from 06-23
  19:00 to 06-25 00:00 and from 07-01 16:00 to 07-03 16:00 CEST (the 24 h window and the day-peak
  window) were fetched live again: all 4,976 records equal the stitch, none is missing, and
  Tempelhof answers temperature and gusts in all 158. The chance is filled in all 361.
- Radar: 2148 frames, no gaps, and no missing, clutter or negative cells in the window.
  `validate_radar.js`: the 5×5 crop and the 8×8 window give the same tuples for all 2125 slot 0s,
  and slot 0 equals an independent full-grid decode of the eight tars at the point for all 2125.
- URLs: the recorder's dry-run URLs equal the URLs it fetched and the manifest's endpoints; each
  Open-Meteo URL carries the live builder's query minus the window parameters, plus whole days; the
  Bright Sky windows have `dwd.js`'s exact shape; every URL the app built in `enumerate.js` maps to
  its entry.
- Coverage: `node scripts/promo/plan/index.js` plans all four platforms with the coverage guard on
  (forecast frames 06-23 00:00 to 07-03 23:45, radar frames 06-24 11:00 to 07-01 20:00 CEST). The
  plans equal the report-mode plans made before the extension, frame for frame and capture for
  capture, with every spare kept.
- Chain: the promo phone chain ran every capture of the current plans at their first and last watch
  time (pads included), at the first and last frame the reel uses, and every setup at its own first
  and last capture: 170 frames (emery 50, basalt 50, flint 46, aplite 24), all answered from this
  directory with 0 misses. The 7 radar setups' edge frames get a full 24-frame radar answer.
  `enumerate.js` (radar on) at 11:00 on 06-24 and 20:00 on 07-01, and (radar off) at 19:00 on 06-23
  and 16:00 on 07-03: 0 misses, and every answer is as long as its request asks.

**Fourth extension, 06-20 to 07-06 (2026-09-29).** For the opening at the owner's faster pace: its
first frame is 03:00 CEST on 06-22, and its "Weather only" scene fetches the radar on 06-23 from
01:00 to 08:00; the capture pads reach back to 22:00 on 06-21 (radar from 20:00 on 06-22). Recorded
with `scripts/promo/record/` (`record.js --first-day 2025-06-21 --last-day 2025-07-03`, then
`extract_radar.py --from 2025-06-22T00:05Z --to 2025-07-01T20:00Z` over YW-250622 to YW-250701),
first into a copy under `build/`, then compared with the files here. The checks are in
`scratchpad/snapshot-ext4/` (not committed).
- No drift: the 361 Bright Sky records already here, raw and filled, are byte-identical (0 changed,
  0 dropped, 48 added), and their text is one contiguous run of the new files. Every old Open-Meteo,
  AQI, UV and sky-row value is identical at its stamp (18,240 values), and the 2148 old radar frames
  are byte-identical. Bright Sky's station list is unchanged (the same seven stations, same data).
- Bright Sky: 409 records, 06-20T00Z to 07-07T00Z, in windows of 8 × 49 + 25 records, Tempelhof for
  temperature and gusts in all nine. The 92 windows the app builds for hourly frames from 06-21
  22:00 to 06-23 19:00 CEST (the 24 h window and the day-peak window) were fetched live again: all
  2,939 records equal the stitch, none is missing, and Tempelhof answers temperature and gusts in
  all 92. The 48 new records take the usual stations (Friedrichshain for rain and the condition,
  Tempelhof, Dahlem for sunshine, Potsdam for solar). The chance is filled in all 409.
- Radar: 2832 frames, no gaps, and no missing, clutter or negative cells in the window.
  `validate_radar.js`: the 5×5 crop and the 8×8 window give the same tuples for all 2809 slot 0s,
  and slot 0 equals an independent full-grid decode of the ten tars at the point for all 2809.
- URLs: the recorder's dry-run URLs equal the URLs it fetched and the manifest's endpoints; every
  URL the app built in `enumerate.js` maps to its entry.
- Coverage: `node scripts/promo/plan/index.js --coverage report` finds every frame of every platform
  inside the snapshot (forecast frames 06-21 22:00 to 07-03 16:00 CEST with the pads, radar data
  06-22 18:05Z to 07-01 20:00Z). `enumerate.js` at 04:00 on 06-23 and at 20:00 on 06-22 (Weather
  only, radar graph, sky rows on) and at 22:00 on 06-21 (radar off): 0 misses.

**Fifth extension, 06-18 to 07-10 (2026-09-29).** For the fast clock with no scene shorter than
before it: the Views radar moved to the 06-23 shower, and the reel is chained back from it and the
storm at 0.2 s per hourly step, so its poster and first frame is 22:00 CEST on 06-19 (capture pads
from 17:00) and its "Weather only" scene shows the radar on 06-20 from 23:00 to 23:35; after the
storm it scrubs on to 22:00 on 07-06 (capture pads to 03:00 on 07-07), with status-dense fetching
the radar to 22:00 on 07-04. Recorded with `scripts/promo/record/` (`record.js --first-day
2025-06-19 --last-day 2025-07-07`, then `extract_radar.py --from 2025-06-20T00:05Z --to
2025-07-05T03:00Z` over YW-250620 to YW-250705, the six new tars downloaded from DWD's recent/
folder), first into a copy under `build/`, then compared with the files here. The checks are in
`scratchpad/snapshot-ext5/` (not committed).
- No drift: the 409 Bright Sky records already here, raw and filled, are byte-identical (0 changed,
  0 dropped, 144 added), and their text is one contiguous run of the new files. Every old Open-Meteo,
  AQI, UV and sky-row value is identical at its stamp (20,640 values), and the 2832 old radar frames
  are byte-identical. Bright Sky's seven stations are unchanged; Berlin-Mitte/Südpanke 17483 and
  Berlin-Neukölln 17460 join the station list and answer the condition in six new records on 07-07.
- Bright Sky: 553 records, 06-18T00Z to 07-11T00Z, in windows of 11 × 49 + 25 records, Tempelhof for
  temperature and gusts in all twelve (the window from 07-08 also takes Dahlem for 07-09 09Z, where
  Tempelhof has a gap; a 25-record window gets the same). The 276 windows the app builds for hourly
  frames from 06-19 17:00 to 06-21 22:00 and from 07-03 16:00 to 07-07 03:00 CEST (the 24 h window
  and the day-peak window) were fetched live again: all 8,691 records equal the stitch, none is
  missing, and Tempelhof answers temperature and gusts in all 276. The chance is filled in all 553.
- Radar: 4356 frames, no gaps, and no missing, clutter or negative cells in the window.
  `validate_radar.js`: the 5×5 crop and the 8×8 window give the same tuples for all 4333 slot 0s,
  and slot 0 equals an independent full-grid decode of the sixteen tars at the point for all 4333.
  The whole of 06-20 is kept, although the plans read the radar on it only from 20:05Z, so an
  earlier poster time needs no new extension.
- URLs: the recorder's dry-run URLs equal the URLs it fetched and the manifest's endpoints; each
  Open-Meteo URL carries the live builder's query minus the window parameters, plus whole days; every
  URL the app built in `enumerate.js` maps to its entry.
- Coverage: `node scripts/promo/plan/index.js --coverage report` finds every frame of every platform
  inside the snapshot (forecast frames 06-19 17:00 to 07-07 03:00 CEST with the pads, radar data
  06-20 20:05Z to 07-05 03:00Z), and plans made with the coverage guard on answer every capture,
  spares included. They equal the plans made on the snapshot before this extension, frame for frame
  and capture for capture.
- Chain: the promo phone chain ran every capture of the current plans at their first and last watch
  time (pads included), at the first and last frame the reel uses, and every setup at its own first
  and last capture: 176 frames (emery 52, basalt 52, flint 48, aplite 24), all answered from this
  directory with 0 misses. The 8 radar setups' edge frames get a full 24-frame radar answer.
  `enumerate.js` with each setup's own settings at 22:00 and 23:05 on 06-20 (Weather only, radar
  graph, sky rows on), at 17:00 on 06-19 (radar off), at 03:00 on 07-05 (status-dense, radar on) and
  at 03:00 on 07-07 (radar off): 0 misses, and no answer is partial.
