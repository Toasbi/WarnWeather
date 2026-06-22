// src/pkjs/settings/schema.js — ES5, PKJS-parsed. WarnWeather's settings SoT.
var meta = require('../../../package.json');
var versionLabel = 'v' + meta.version + (meta.buildProfile === 'dev' ? ' (dev)' : '');
var HOURS = (function () { var o = [], h; for (h = 0; h < 24; h += 1) { o.push([(h < 10 ? '0' + h : String(h)) + ':00', String(h)]); } return o; })();
var COLOR_LEGEND = 'Bar height grows with the rain rate; the fill steps up through colors as it climbs (mm/h):'
  + '<span style="display:inline-flex;gap:7px;margin-top:6px;align-items:flex-end;">'
  + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#AAAAAA;margin-bottom:3px;"></span>0</span>'
  + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#55FFFF;margin-bottom:3px;"></span>0.1</span>'
  + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#00FF00;margin-bottom:3px;"></span>0.5</span>'
  + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FFFF00;margin-bottom:3px;"></span>2</span>'
  + '<span style="text-align:center;font-size:10px;color:#8A92A0;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FF5555;margin-bottom:3px;"></span>10+</span>'
  + '</span><br><span style="color:#6E7787;">The scale is compressed, not linear — each color marks roughly a five-fold jump in rate (0.1, 0.5, 2, 10 mm/h) and a full bar is a 40 mm/h downpour, so light drizzle still shows while heavy rain has room to climb. White mode draws one solid bar instead.</span>';
// B/W watches hide the color picker (no colors to choose), so this stands in for COLOR_LEGEND
// there: text-only, since height is the only encoding (no color steps to show).
var BW_LEGEND = 'Bar height grows with the rain rate (mm/h) — taller bars mean heavier rain. The scale is compressed, not linear: each step up the bar is roughly a five-fold jump in rate (0.1, 0.5, 2, 10) and a full bar is a 40 mm/h downpour, so light drizzle stays visible while heavy rain has room to climb.';
module.exports = {
  appName: 'WarnWeather',
  versionLabel: versionLabel + ' <a href="https://github.com/Toasbi/WarnWeather">GitHub source</a>',
  tabs: [{
    id: 'general', label: 'General', sections: [{
      title: 'General', items: [{
        type: 'segmented',
        messageKey: 'temperatureUnits',
        label: 'Temperature units',
        defaultValue: 'c',
        options: [['°F', 'f'], ['°C', 'c']]
      }, {
        type: 'select', messageKey: 'fetchIntervalMin', label: 'Update interval', defaultValue: '15',
          hint: 'Updates only send what actually changed (deltas), so short intervals like 5 min stay battery friendly.',
          options: [['5 minutes','5'],['10 minutes','10'],['15 minutes','15'],['30 minutes','30'],['1 hour','60']] }, {
        type: 'toggle',
        messageKey: 'sleepNightEnabled',
        label: 'Pause weather at night',
        defaultValue: false,
        hint: 'Stop fetching weather between the hours below to save battery.'
      }, {
        type: 'select',
        messageKey: 'sleepStartHour',
        label: 'From',
        defaultValue: '22',
        options: HOURS,
        showWhen: {key: 'sleepNightEnabled', eq: true}
      }, {
        type: 'select',
        messageKey: 'sleepEndHour',
        label: 'To',
        defaultValue: '7',
        options: HOURS,
        showWhen: {key: 'sleepNightEnabled', eq: true}
      },
        { type: 'radio', messageKey: 'provider', label: 'Provider', defaultValue: 'wunderground',
          hintByValue: { wunderground: 'No API key needed.', openweathermap: 'Requires an API key — enter it below.', dwd: 'Germany only · no API key needed.', openmeteo: 'Global · no API key needed.' },
          options: [['Weather Underground','wunderground'],['OpenWeatherMap','openweathermap'],['Deutscher Wetterdienst (Germany only)','dwd'],['Open-Meteo','openmeteo']] },
        { type: 'text', messageKey: 'owmApiKey', label: 'OpenWeatherMap API key', defaultValue: '',
          hint: '<a href=\'https://openweathermap.org/\'>Register an OpenWeatherMap account</a> and paste your API key here. The key must be subscribed to the <a href=\'https://openweathermap.org/api/one-call-3\'>One Call API 3.0</a> plan, or fetches fail with a 401 error.',
          showWhen: { key: 'provider', eq: 'openweathermap' } },
        { type: 'segmented', messageKey: 'locationMode', label: 'Location', defaultValue: 'gps',
          hintByValue: { gps: 'Detect your location automatically via phone GPS.', manual: 'Enter a city or address below.' },
          options: [['GPS','gps'],['Manual','manual']] },
        { type: 'text', messageKey: 'location', label: 'Manual location', defaultValue: '',
          attributes: { placeholder: 'e.g. Manhattan' }, hint: 'Example: "Manhattan" or "123 Oak St Plainsville KY".',
          showWhen: {key: 'locationMode', eq: 'manual'}
        }
      ] }]
    }, {
      id: 'forecast', label: 'Forecast', sections: [{
        title: 'Forecast',
        caption: 'Temp · Precip % · Rain bars',
        intro: 'The forecast graph is the hourly prediction — looking up to 24 hours ahead, it shows temperature plus the chance of rain each hour. ' + 'It\'s a model forecast, good for "will it rain this afternoon?" For "is it about to rain on me right now?", check the Radar tab.',
      items: [
        { type: 'segmented', messageKey: 'secondaryLine', label: 'Secondary line', defaultValue: 'precip_prob',
          hintByValue: {
            precip_prob: 'Chance of rain each hour<br>— half-height = 50% rain chance<br>— full-height = 100% rain chance',
            wind: 'Wind speed + dotted gust line drawn above it.',
            off: 'Temperature only.'
          }, options: [['Precip', 'precip_prob'], ['Wind', 'wind'], ['Off', 'off']], blockBefore: 'forecastPreview'
        },
        { type: 'toggle', messageKey: 'secondaryLineFill', label: 'Secondary line fill', defaultValue: true, hint: 'Fills the area beneath the curve.', showWhen: { key: 'secondaryLine', eq: 'precip_prob' } },
        { type: 'segmented', messageKey: 'windScale', label: 'Wind graph scale', defaultValue: 'mid',
          hintByValue: {
            low: 'Tops out at 30 km/h (19 mph) — emphasizes light, gentle winds.',
            mid: 'Tops out at 50 km/h (31 mph) — general use; gusts visible, typical winds sit mid-graph.',
            high: 'Tops out at 70 km/h (43 mph) — keeps strong gusts from flattening against the top.'
          },
          options: [['Low','low'],['Mid','mid'],['High','high']], showWhen: { key: 'secondaryLine', eq: 'wind' } },
        { type: 'segmented', messageKey: 'barSource', label: 'Bars', defaultValue: 'rain', options: [['Rain','rain'],['Off','off']] },
          {
            type: 'segmented',
            messageKey: 'rainBarColor',
            label: 'Bar color',
            defaultValue: 'multicolor',
            hint: COLOR_LEGEND,
            capabilities: ['COLOR'],
            options: [['Multicolor', 'multicolor'], ['White', 'white']],
            showWhen: {key: 'barSource', eq: 'rain'}
          }, {
            type: 'staticText',
            text: BW_LEGEND,
            showWhen: {all: [{not: {env: 'color'}}, {key: 'barSource', eq: 'rain'}]}
          },
        { type: 'toggle', messageKey: 'dayNightShading', label: 'Day / night shading', defaultValue: true, hint: 'Show hatch shading between sunset and sunrise to distinguish day and night on the forecast graph.' }
      ] }
    ] },
    { id: 'radar', label: 'Radar', sections: [
      { title: 'Rain radar', block: 'radarPreview', caption: 'Solid = at you · Outline = within 2 km',
        intro: 'Rain radar appears as a second screen revealed with a wrist flick, and only when radar data is available.<br>' +
            'Unlike the forecast graph\'s hourly prediction, the radar is short-term and based on actual radar measurements moving toward you. ' +
            'It turns the next 2 hours into a bar graph, each bar one 5-minute frame whose height is the rain amount. ' +
            'Solid bars are rain at your exact location; the hatched outline behind them is the strongest rain anywhere ' +
            'within 2 km — an early warning that rain is nearby even when it isn\'t directly overhead yet.',
        items: [
          {
            type: 'segmented',
            messageKey: 'radarProvider',
            label: 'Radar provider',
            defaultValue: 'disabled',
            options: [['DWD', 'dwd'], ['Off', 'disabled']]
          }, {
            type: 'segmented',
            messageKey: 'radarColor',
            label: 'Radar color',
            defaultValue: 'multicolor',
            hint: COLOR_LEGEND,
            capabilities: ['COLOR'],
            options: [['Multicolor', 'multicolor'], ['White', 'white']],
            showWhen: {key: 'radarProvider', ne: 'disabled'}
          }, {
            type: 'staticText',
            text: BW_LEGEND,
            showWhen: {all: [{not: {env: 'color'}}, {key: 'radarProvider', ne: 'disabled'}]}
          }
      ] }
    ] },
    { id: 'watch', label: 'Watch', sections: [
      { title: 'Time', items: [
        { type: 'toggle', messageKey: 'timeLeadingZero', label: 'Leading zero', defaultValue: false },
        { type: 'toggle', messageKey: 'timeShowAmPm', label: 'Show AM / PM', defaultValue: false },
        { type: 'segmented', messageKey: 'axisTimeFormat', label: 'Axis time format', defaultValue: '24h', hint: 'Tip: Settings &gt; Date &amp; Time &gt; Time Format changes the main time format.', options: [['12h','12h'],['24h','24h']] },
        { type: 'segmented', messageKey: 'timeFont', label: 'Main time font', defaultValue: 'roboto', options: [['Roboto','roboto'],['Leco','leco'],['Bitham','bitham']] },
        { type: 'color', messageKey: 'colorTime', label: 'Main time color', defaultValue: 0xFFFFFF, capabilities: ['COLOR'] }
      ] },
      { title: 'Calendar', items: [
        { type: 'segmented', messageKey: 'weekStartDay', label: 'Start week on', defaultValue: 'sun', options: [['Sun','sun'],['Mon','mon']] },
        { type: 'segmented', messageKey: 'firstWeek', label: 'First week to display', defaultValue: 'prev', options: [['Prev','prev'],['Curr','curr']] },
        { type: 'color', messageKey: 'colorToday', label: 'Today highlight', defaultValue: 0, capabilities: ['COLOR'], hint: 'Black (default) means match date color; any other value overrides it.' },
        { type: 'color', messageKey: 'colorSunday', label: 'Sunday color', defaultValue: 0xFF0055, capabilities: ['COLOR'] },
        { type: 'color', messageKey: 'colorSaturday', label: 'Saturday color', defaultValue: 0xFF0055, capabilities: ['COLOR'] },
        { type: 'color', messageKey: 'colorUSFederal', label: 'US federal holidays color', defaultValue: 0xFF0055, capabilities: ['COLOR'], hint: 'White means disable.' }
      ] }
    ] },
    { id: 'more', label: 'More', sections: [
      { title: 'Misc', items: [{
          type: 'staticText',
          text: '<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;">' + '<span style="font-size:14.5px;font-weight:600;">Help</span>' + '<a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a></div>'
        },
        { type: 'toggle', messageKey: 'showQt', label: 'Show quiet time icon', defaultValue: true },
        { type: 'toggle', messageKey: 'vibe', label: 'Vibrate on bluetooth disconnect', defaultValue: false },
        { type: 'select', messageKey: 'btIcons', label: 'Show icon for bluetooth', defaultValue: 'both', options: [['Disconnected','disconnected'],['Connected','connected'],['Both','both'],['None','none']] },
        { type: 'toggle', messageKey: 'telemetryEnabled', label: 'Share anonymous telemetry', defaultValue: true,
          hint: 'Share privacy-respecting weather telemetry to improve reliability and understand usage patterns. Learn more about what gets sent in the <a href="https://github.com/Toasbi/WarnWeather#telemetry">Telemetry section</a>.'
        }
        ]
      }, {
          title: 'Advanced', collapsible: true, items: [{
            type: 'toggle',
            messageKey: 'fetch',
            label: 'Force weather fetch',
            defaultValue: false,
            hint: 'Re-fetch the weather the moment you save.',
            block: 'lastFetch'
          },
        { type: 'toggle', messageKey: 'devStatsEnabled', label: 'Enable connection stats', defaultValue: false, hint: 'Locally records connection events sent to the watch. Events older than 7 days are deleted.' },
        { type: 'toggle', messageKey: 'devStatsClear', label: 'Clear connection stats', defaultValue: false, showWhen: { key: 'devStatsEnabled', eq: true } }
      ] },
      { title: 'Connection stats', collapsible: true, block: 'devStats', items: [] }
    ] }
  ]
};
