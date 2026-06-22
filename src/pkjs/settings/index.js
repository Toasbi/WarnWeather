// src/pkjs/settings/index.js — ES5, PKJS-parsed. WarnWeather's createConfig instance.
module.exports = require('../config-ui').createConfig({
  schema: require('./schema.js'),
  page: require('./page.generated.js'),
  // In the emulator, route the config page through the hosted gh-pages helper so a desktop
  // browser can render it (it can't navigate the top frame to a data: URL). No-op on device.
  options: { emulatorConfigUrl: 'https://Toasbi.github.io/WarnWeather/clay/emulator.html' }
});
