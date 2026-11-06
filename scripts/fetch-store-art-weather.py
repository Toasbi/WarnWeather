#!/usr/bin/env python3
"""Fetch the store art's weather: two real days in Berlin, from the app's own sources.

scripts/gen-store-art-fixtures.js builds every store art screen from what this writes to
fixtures/data/berlin-2025-05.json, and fills in nothing by hand:

- DWD's hourly records for Berlin, as Bright Sky serves them (the app's DWD source): the
  temperature, rain, wind and gusts, cloud cover, dew point and pressure of the station
  nearest the city centre, from 30 April to 7 May 2025.
- The UV index the way the app's DWD provider takes it: Open-Meteo's GFS UV
  (src/pkjs/weather/openmeteo.js buildUvUrl), here from its archive of past forecasts.
- Germany's public holidays of 2025 from Nager.Date (the app's holiday source).

DWD's records carry no chance of rain (only its forecasts do), so the file has none. Run it
by hand, with network: python3 -I scripts/fetch-store-art-weather.py
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'fixtures', 'data', 'berlin-2025-05.json')
LAT, LON = 52.52, 13.405
FIRST, LAST = '2025-04-30', '2025-05-07'
TZ = 'Europe/Berlin'
RECORDS = ('temperature', 'precipitation', 'wind_speed', 'wind_gust_speed', 'wind_direction',
           'cloud_cover', 'dew_point', 'relative_humidity', 'pressure_msl', 'condition')


def get(url):
    """A JSON answer, or SystemExit naming the source."""
    req = urllib.request.Request(url, headers={'User-Agent': 'warnweather-store-art'})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except Exception as exc:  # noqa: BLE001 - one message per source is all a hand run needs
        raise SystemExit('%s: %s' % (urllib.parse.urlsplit(url).netloc, exc))


def records():
    """Bright Sky's hourly records for the days, one list per field, and the station's name."""
    url = 'https://api.brightsky.dev/weather?' + urllib.parse.urlencode(
        {'lat': LAT, 'lon': LON, 'date': FIRST, 'last_date': LAST, 'tz': TZ})
    data = get(url)
    hours = data['weather']
    stations = {s['id']: s for s in data['sources']}
    used = sorted({h['source_id'] for h in hours})
    if len(used) != 1:
        raise SystemExit('Bright Sky: the hours come from %d stations, not one' % len(used))
    station = stations[used[0]]
    for i, h in enumerate(hours):
        for key in RECORDS:
            if h.get(key) is None:
                raise SystemExit('Bright Sky: no %s at %s' % (key, h['timestamp']))
        if i and h['timestamp'] <= hours[i - 1]['timestamp']:
            raise SystemExit('Bright Sky: the hours are out of order at %s' % h['timestamp'])
    return {
        'source': url,
        'station': '%s (DWD %s)' % (station['station_name'], station['dwd_station_id']),
        'start': hours[0]['timestamp'],
        'hours': {key: [h[key] for h in hours] for key in RECORDS},
    }, [h['timestamp'] for h in hours]


def uv(stamps):
    """Open-Meteo's archived GFS UV, one value per record hour: the bucket stamped at that hour
    (GFS UV is the mean of the hour ending at its stamp; the generator reads it the way
    openmeteo.js mapUv does). None where the archive has no value; None for the whole block
    when Open-Meteo can't be reached (its daily limit), with a warning."""
    url = 'https://historical-forecast-api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(
        {'latitude': LAT, 'longitude': LON, 'start_date': FIRST, 'end_date': LAST,
         'hourly': 'uv_index', 'models': 'gfs_global', 'timezone': TZ, 'timeformat': 'unixtime'})
    try:
        data = get(url)
    except SystemExit as exc:
        print('warning: no UV (%s)' % exc, file=sys.stderr)
        return None
    by_time = dict(zip(data['hourly']['time'], data['hourly']['uv_index']))
    epochs = [int(datetime.datetime.fromisoformat(t).timestamp()) for t in stamps]
    return {'source': url, 'hours': [by_time.get(t) for t in epochs]}


def holidays():
    """Nager.Date's 2025 holidays for Germany, as [date, null or [regions]]."""
    url = 'https://date.nager.at/api/v3/PublicHolidays/2025/DE'
    return {'source': url, 'days': [[h['date'], None if h['global'] else h['counties'], h['localName']]
                                    for h in get(url)]}


def main():
    rec, stamps = records()
    out = {
        '_comment': 'Real weather for the store art (scripts/fetch-store-art-weather.py): DWD\'s hourly '
                    'records for Berlin, Open-Meteo\'s archived GFS UV, Germany\'s holidays of 2025. '
                    'Units as served: °C, mm, km/h, %, hPa. No chance of rain: DWD\'s records carry none.',
        'records': rec,
        'uv': uv(stamps),
        'holidays': holidays(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fp:
        json.dump(out, fp, indent=1, ensure_ascii=False)
        fp.write('\n')
    print('wrote %s: %d hours from %s' % (os.path.relpath(OUT, ROOT), len(stamps), rec['start']))


if __name__ == '__main__':
    sys.exit(main())
