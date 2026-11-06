# Plugin test fixtures

Real answers recorded on 2026-11-06 for Freiburg im Breisgau (47.99, 7.85), a rainy week, with the
plugins' own request URLs (`forecastUrl`/`uvUrl` in open-meteo/src/open-meteo.js, `weatherUrl`/
`currentUrl` in dwd/src/bright-sky.js) as of 09:30 CET:

- `open-meteo-freiburg-forecast.json`, `open-meteo-freiburg-uv.json`: Open-Meteo, as answered.
  Weather data by Open-Meteo.com, CC BY 4.0.
- `bright-sky-freiburg-weather.json`, `bright-sky-freiburg-current.json`: Bright Sky, with each
  record cut to the fields the plugin reads. Source: Deutscher Wetterdienst.

To record new ones, fetch the URLs those functions build and keep the shape; the tests pin their
clock to the recording's local morning.
