# Provenance: Berlin (OpenWeatherMap), 2025-06-25

This is the offline weather snapshot for the Berlin timelapse (`promo/timelapses/berlin.json`). It
holds five real days in Berlin, 2025-06-25 to 2025-06-29 with the storm evening of 06-26, plus the
day before and three days after, as the replay serves them to the app's own OpenWeatherMap fetch
chain. The point is the reel's own (`promo/snapshots/berlin-2025-06-26`, which holds the same days
from DWD's stations). Settings: provider `openweathermap` (any key text: the replay never reads it,
and the timelapse sets `promo-replay`), radar `dwd` in the dense layout's radar row (`radarMode`
status: the app fetches the radar, but with the rain alert off no frame shows it; the sky rows are
not fetched), AQI source Open-Meteo
(European scale), location `52.52,13.405` (Berlin, by Alexanderplatz). `manifest.json` lists every
request the fetch cycle makes, which parameters depend on the frame time, and the file (or record)
that answers each one. The recorder is `scripts/promo/record/record-owm.js` (see its README,
"Recording an OpenWeatherMap day").

Coverage: whole GMT days, 2025-06-24 to 2025-07-02. The OpenWeather history holds every hour from
2025-06-24 00:00Z to 2025-07-03 00:00Z (217 records: 02:00 CEST on 06-24 to 02:00 CEST on 07-03); the
fill sources run one day longer, to 07-03 23:00Z, and the AQI file to 07-02 23:00Z. The radar holds
every 5 minutes from 2025-06-24 22:00Z to 2025-06-30 04:00Z (1513 frames, none missing). The frames
step hourly from 06:00 CEST on 06-25 to 23:00 CEST on 06-29 (114 steps, a 24.2 s GIF), and the
capture adds two spare frames at 04:00 and 05:00 on 06-25. Each capture's 2-hour radar window lies
inside the radar file; the last one reaches 01:00 on 06-30. One Call answers 48 hours from the
frame's hour, so the last frame reads on to 22:00 on 07-01; the runner's day-peak seed fetch at local
midnight of 06-25 (22:00Z on 06-24) reads One Call from there. CEST (UTC+2) holds all through the
snapshot. Recorded on 2026-10-05 with `record-owm.js --snapshot
promo/snapshots/berlin-owm-2025-06-25 --lat 52.52 --lon 13.405 --first-day 2025-06-25 --last-day
2025-06-29`, in two runs: first with `--last-day 2025-06-27` (169 One Call timemachine calls), then
to 06-29 when the timelapse grew from three days to five (48 calls: the recorder fetches only the
hours it does not hold yet). The radar was cut with `extract_radar.py` from the DWD YW tars already
downloaded for berlin-2025-06-26 (YW-250624 to YW-250630).

## Sources

| File | What | Observation or model | From |
|---|---|---|---|
| `owm-history.json` | Hourly weather at the point: 217 timemachine answers, one per hour, in the app's units (imperial) | OpenWeather's historical data for the point | OpenWeather One Call API 3.0 `timemachine` |
| `owm-history.filled.json` | The same, with the chance of rain, UV and the missing gusts filled in | History, plus model for the fills | Derived (see Fills) |
| `radar-dwd-yw-window.json` | 5-min radar, 8×8 km window, 1513 frames | Observation: radar | DWD Climate Data Center, RADOLAN YW |
| `fill-ecmwf-chance.json` | Source of the chance-of-rain fill | Model: ECMWF IFS 0.25 | Open-Meteo Historical Forecast |
| `fill-gfs-uv.json` | Source of the UV fill: the app's own Open-Meteo UV request | Model: NCEP GFS | Open-Meteo Historical Forecast |
| `fill-gust.json` | Source of the gust fill: the app's own Open-Meteo gust request | Model: Open-Meteo best_match | Open-Meteo Historical Forecast |
| `air-quality.json` | European and US AQI | Model: CAMS | Open-Meteo Air Quality |
| `manifest.json` → `place` | City slot ("Berlin") | Our own place-name record | Written for the snapshot; the replay builds the reverse-geocode answer from it |

Sunrise and sunset are OpenWeather's, from the history records; the replay serves them as One
Call's `daily`, of which the app reads nothing else.

## What the timelapse shows

One setup, `berlin-dense`, which never changes view: the reel's dense compact-calendar setup
(`compactDense`). It has two calendar rows and the radar row above the clock with the AQI, the wind
and the gusts. The top bar shows the calendar week, the date and the battery; the weather bar the
temperature (now and feels-like), the City slot and the next sunrise or sunset. The graph has the
rain bars, the chance of rain as the filled line and UV as dots. Dark theme. Emery, basalt and flint
only: aplite fetches no radar.

The alerts for gusts, UV, AQI and wind look ahead: with Days "Today + tomorrow" an alert shows the
rest of today's peak while it reaches the warn level, else tomorrow's peak, marked ». On emery they
sit at the top bar's right edge, beside the battery; on basalt and flint at its left edge, beside
the week, since an alert at the right edge pushes the battery out first (the watch hides an edge's
slot before it drops an alert) and the 144-px bars rarely have room for both. There the week gives
way instead while the alerts need the room. The rain alert is off. The UV levels are the timelapse's
own (warn 5, danger 7); the gusts use the app's default levels (warn 65, danger 90 km/h); AQI warns
from 70 (danger 90) and wind from 45 km/h (danger 60). In the frames the UV alert is on throughout
(today's peak until the afternoon, then tomorrow's) and the gust alert carries the storm (see
06-26); AQI and wind stay below their levels.

## The days

Hours are CEST. A record's hour is the hour starting at its stamp, as the app reads One Call's
`hourly`. Temperatures are in °C and wind in km/h, as the timelapse shows them (converted from the
history's °F and mph); rain is in mm (OpenWeather gives precipitation in mm in every unit system).
UV is GFS's and the chance of rain ECMWF's (see Fills). The radar facts of 06-25 to 06-27 are those
of berlin-2025-06-26's PROVENANCE.md, whose frames these are. The alert times come from the
planner's restatement of the app's rules (`scripts/promo/plan/events.js`; see Verification).

- **2025-06-24 (Tuesday), from 02:00, no frames:** 14.6 to 21.9 °C, 79 % cloud, 0.4 mm of rain
  (18–20 h), gusts up to 57.9 km/h (16–17 h). UV up to 4.7, chance of rain up to 45 %.
- **2025-06-25 (Wednesday), frames from 06:00 (spares from 04:00):** a wet morning, then broken sun.
  16.8 to 25.6 °C, 58 % cloud, 7.5 mm of rain (05–12 and 15–16 h), gusts up to 51.5 km/h (11–12 h),
  wind up to 35.4 km/h. UV up to 6.8 (12–13 h), chance of rain up to 98 % (05–08 h). AQI up to 28.
  The radar has rain at the point from 03:50 to 05:45 and from 06:25 to 07:40, and drizzle from 09:45
  to 09:55.
- **2025-06-26 (Thursday), the storm day, frames all day:** hot, then the evening storm. 15.1 to
  31.7 °C, 62 % cloud, 5.7 mm of rain from 18 to 23 h, gusts up to 103 km/h (18–19 h, the history's
  own), wind up to 27.4 km/h. UV up to 6.55 (14–15 h; 6.5 or more from 13 to 15 h), chance of rain up
  to 92 % (17–20 h). AQI up to 48. The radar has rain at the point from 18:15 to 18:25. The gust
  alert is at danger from the first frame: through 06-25 with this day's 103 km/h as tomorrow's
  (»103), from 00:00 as today's. After the gust hour it warns from 19:00 (79 km/h in the hours left)
  and goes off at 21:00.
- **2025-06-27 (Friday), frames all day:** grey and cooler. 17.4 to 21.9 °C, 86 % cloud, 1.2 mm of
  rain (08–09 and 13–15 h), gusts up to 59.5 km/h (14–15 h), wind up to 41.8 km/h. UV up to 5.6,
  chance of rain 100 % at 11–14 h. AQI up to 40. The radar has the midday shower at the point from
  12:25 to 13:00.
- **2025-06-28 (Saturday), frames all day:** dry, sunny and warm again. 14.8 to 29.7 °C, 58 % cloud,
  dry, gusts up to 51.5 km/h (18–19 h), wind up to 30.6 km/h. UV up to 6.6 (14–15 h), chance of rain
  4 % at most. AQI up to 37. No rain on the radar at the point.
- **2025-06-29 (Sunday), frames to 23:00 (the last frame):** warm, sun and cloud. 21.2 to 28 °C,
  48 % cloud, 1.4 mm of rain (10–15 h), gusts up to 59.5 km/h (15–16 h), wind up to 38.6 km/h. UV up
  to 6.85 (13–14 h), chance of rain 100 % at 11–14 h. AQI up to 33. No rain on the radar at the
  point (see Known caveats).
- **2025-06-30 (Monday), look-ahead only:** 14.7 to 27 °C, 12 % cloud, dry, gusts up to 35.4 km/h.
  UV up to 6.9, chance of rain 0 %. AQI up to 34.
- **2025-07-01 (Tuesday), look-ahead only (the last frame reads to 22:00):** 14.5 to 33.7 °C,
  cloudless, dry, gusts up to 29 km/h. UV up to 7, chance of rain 0 %.
- **2025-07-02 (Wednesday) and 2025-07-03 to 02:00:** no frame reads them.

## Attribution and licences

- **OpenWeather:** Weather data © OpenWeather. OpenWeather licenses the data and database of its
  self-service plans under the Open Database License (ODbL). `owm-history.json` is an extract of it
  and `owm-history.filled.json` a derivative, so both stay under the ODbL. Whatever shows this data
  (the timelapse GIFs, wherever they are published) needs the attribution "Weather data ©
  OpenWeather" with it.
- **DWD:** Source: Deutscher Wetterdienst (DWD), CC BY 4.0 (dwd.de/copyright). RADOLAN YW radar
  from opendata.dwd.de. Change: the radar is cut to an 8×8 km window.
- **Open-Meteo:** Weather data by Open-Meteo.com, CC BY 4.0. Models: ECMWF IFS (© ECMWF, CC BY 4.0)
  for the chance of rain, NOAA NCEP GFS for UV, Open-Meteo best_match for gusts. Changes: the values
  are copied into OpenWeather's record shape (the chance as a fraction, gusts in mph).
- **Air quality:** Contains modified Copernicus Atmosphere Monitoring Service information 2025
  (CAMS, via Open-Meteo, CC BY 4.0).
- **Geocoding:** none stored. The City slot's answer is synthesized from the snapshot's own
  place-name record, because Esri's terms limit storing geocode results.

## Fills

1. **Chance of rain.** OpenWeather's history has no `pop`. The filled file takes it from ECMWF IFS
   0.25 (`ecmwf_ifs025`) `precipitation_probability` by 3-hour block, the way the app reads that
   field from Open-Meteo (`openmeteo.js` `ensembleBlockSlice`): the record stamped dt, the hour
   starting at dt, takes the block at the first 3-hour UTC boundary at or after dt + 1 h. All 217
   records are filled.
2. **UV.** The history has no `uvi` either. It comes from GFS `uv_index` stamped dt + 1 h, as the
   app's own Open-Meteo UV request reads it (`openmeteo.js` `buildUvUrl`, `mapUv`). All 217 records
   are filled.
3. **Gusts.** The history holds `wind_gust` in 173 of 217 records. The other 44 take Open-Meteo
   best_match `windgusts_10m` stamped dt + 1 h (the max of the hour starting at dt, as `openmeteo.js`
   `mapGusts` reads it), converted from km/h to the history's mph (÷ 1.60934, 4 decimals, so the
   app's mph to km/h gives the km/h back). A record with its own gust keeps it.
4. **One Call at the frame time.** One Call's URL names no time: it answers the moment it is asked.
   The promo phone posts its own clock with every replay request, and the replay rebuilds One Call
   at that time from the filled history (`replay.js` `owmOneCall`): `hourly` is the 48 records from
   the frame's hour, `current` the 10-minute floor interpolated between the hours, `daily` the
   sunrise and sunset of each local day. A frame whose 48 hours run past the history gets a 404,
   never a partial forecast.
5. **Radar.** Bright Sky `/radar` keeps only 6 h, so the frames come from DWD's own YW 5-min archive,
   as in berlin-2025-06-26: the same point, window and crop, and the same frames, byte for byte. The
   replay serves observed frames as the 2-hour nowcast: at every frame, the "forecast" is what
   actually happened next.
6. **City.** The reverse geocode is not stored. The replay answers it in ArcGIS's shape from the
   manifest's `place` record (city Berlin, region Berlin, DEU). The district is left empty on
   purpose (the owner's call, 2026-10-05), so the City slot reads "Berlin".

## Known caveats

- **The forecast is what happened.** At every frame One Call's forecast is the history that
  followed, not what was forecast at the time: the graph shows the weather that came.
- **The storm in two sources.** The graph, the gusts and the alerts read OpenWeather's history: rain
  from 18 to 23 h on 06-26 (5.7 mm) and its 103 km/h gust at 18–19 h, coded as rain with no
  thunderstorm code. The radar, which no frame shows, has rain at the point only from 18:15 to
  18:25. berlin-2025-06-26 reads the same hour from the Tempelhof station via Bright Sky, with
  94.0 km/h.
- **Rain bars without radar rain on 06-29.** OpenWeather's history has 1.4 mm of rain from 10 to
  15 h, so the graph draws rain bars there, but the radar has no rain at the point that day and
  berlin-2025-06-26's stations stayed dry. ECMWF's chance of rain is 100 % at
  11–14 h.
- **The chance of rain and UV are model output.** The chance is ECMWF's and UV is GFS's, while
  temperature, cloud, wind and rain are OpenWeather's history, so they need not agree hour by hour.
- **Gusts from two sources.** 44 of the 217 gusts are Open-Meteo's model gusts, and in one of those
  hours the gust is below the history's own wind speed. The fill does not clamp it: it is left as
  recorded. The storm's 103 km/h is the history's own.
- **City slot reads "Berlin", not the live answer.** ArcGIS names the point's district, "Mitte",
  and the app shows `District || City || Region`. This record leaves the district empty so the slot
  names the city; berlin-2025-06-26 keeps "Mitte".
- **Radar time stamp, ±5 min.** A YW stamp is read as the end of its 5 minutes, as in
  berlin-2025-06-26 (see its caveats): if it is the start, every radar time moves 5 min later.
- **No sky rows.** The radar row draws no radar chart, so the app does not ask for the sky rows
  (Open-Meteo `minutely_15`), and the snapshot holds none.

## Verification

Checked on 2026-10-05 by the recorder (no separate adversarial pass).

- Recording: 217 timemachine calls in two runs (169, then 48), one per hour; every answer holds the
  hour asked for (`record-owm.js` refuses one that does not). The key never reaches a file: every
  logged URL carries `appid=REDACTED`, and `test/promo-owm.test.js` fails on any other value of
  `appid` in this directory.
- Extension: against the three-day snapshot, kept aside for the check, the 169 records of the first
  run, their filled values, the Open-Meteo and AQI values on the hours both hold and the first cut's
  937 radar frames are all unchanged.
- Manifest: `build_manifest.js --check` reports the machine parts current, and the entry ids are the
  ones the app's URL builders give (`owmEntries`, with the radar entry since the file is here).
- Fills: `pop`, `uvi` and `wind_gust` are on all 217 hours (the test checks it). `withCityName`
  reads "Berlin", DEU.
- Radar: all 1513 frames are identical to berlin-2025-06-26's at the same stamps (its PROVENANCE.md
  has the decoding checks).
- Timeline: `test/promo-owm.test.js` builds the planner's timeline on this snapshot at the
  timelapse's UV levels (5/7) and the default gust levels (65/90). Its events read Days 'today', so
  the gust danger starts at 00:00 on 06-26 there; its rain alert, which the timelapse turns off,
  comes on at 17:15 that day. The
  same rules with the timelapse's Days "Today + tomorrow" (`metricState`'s `alertAhead`) give the
  alert times above.
- Requests: `enumerate.js` at the first and the last capture (04:00 CEST on 06-25, 23:00 CEST on
  06-29) on emery with the plan's resolved settings: 0 misses. One Call (rebuilt), AQI, the radar
  (a full 24-frame window) and the reverse geocode are answered from this directory. The only 404s
  are the boot-only Supabase news and Nager.Date requests, which are not weather (`not_recorded`).
- Capture: the promo build on basalt, emery and flint, 116 captures each. Every replay answered 200
  (per platform: One Call 228, AQI 228, radar 116 with no partial window, reverse geocode 116), with
  no misses. The weather message was acknowledged on every capture, and the status line carries
  "Berlin".
- Coverage: the planner plans all three platforms with the coverage guard on (`--coverage fail`).
