// src/pkjs/config-ui/test/emulator-url.test.js
// generateUrl emulator-helper branch: in the emulator (Pebble.platform === 'pypkjs',
// or no Pebble), and when options.emulatorConfigUrl is set, generateUrl returns the
// hosted helper URL (page in the #hash) with a $$RETURN_TO$$ placeholder the helper
// substitutes — sidestepping the browser's "navigate top frame to data: URL" block.
// On a real device it keeps the data: URL + pebblejs://close#.
const test = require('node:test');
const assert = require('node:assert/strict');
const configUi = require('../index.js');

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
  { type: 'radio', messageKey: 'provider', defaultValue: 'dwd', options: [['D', 'dwd']] }
] } ] } ] };
const PAGE = '<html><script>var INJECTED_SCHEMA=null,INJECTED_CFG=null,INJECTED_ENV=null,INJECTED_USERDATA=null,INJECTED_RETURN=null;/*__PCONF_INJECT__*/\n/*__PCONF_CONCAT__*/</script></html>';
const EMU = 'https://Toasbi.github.io/WarnWeather/clay/emulator.html';

test('emulator (no Pebble global): emulatorConfigUrl set -> helper URL with $$RETURN_TO$$ placeholder', () => {
  // Node has no Pebble global, so isEmulator() is true.
  const inst = configUi.createConfig({ schema: SCHEMA, page: PAGE, options: { emulatorConfigUrl: EMU } });
  const url = inst.generateUrl({ values: inst.getDefaults(), watchInfo: { platform: 'basalt' } });
  assert.equal(url.indexOf(EMU + '#'), 0, 'returns the hosted helper URL with the page in the hash');
  assert.equal(url.indexOf('data:'), -1, 'not a data: URL in the emulator');
  const decoded = decodeURIComponent(url.slice((EMU + '#').length));
  assert.ok(decoded.indexOf('INJECTED_RETURN="$$RETURN_TO$$"') !== -1, 'return target is the helper placeholder');
  // the schema/values still get injected into the hosted page
  assert.ok(decoded.indexOf('"messageKey":"provider"') !== -1, 'schema injected into the helper page');
});

test('emulator: Pebble.platform === "pypkjs" triggers the helper path', () => {
  global.Pebble = { platform: 'pypkjs' };
  try {
    const inst = configUi.createConfig({ schema: SCHEMA, page: PAGE, options: { emulatorConfigUrl: EMU } });
    const url = inst.generateUrl({ values: inst.getDefaults() });
    assert.equal(url.indexOf(EMU + '#'), 0, 'pypkjs platform uses the helper URL');
  } finally { delete global.Pebble; }
});

test('device: a real platform keeps the data: URL + pebblejs://close#, even with emulatorConfigUrl set', () => {
  global.Pebble = { platform: 'basalt' };  // not pypkjs -> not the emulator
  try {
    const inst = configUi.createConfig({ schema: SCHEMA, page: PAGE, options: { emulatorConfigUrl: EMU } });
    const url = inst.generateUrl({ values: inst.getDefaults(), watchInfo: { platform: 'basalt' } });
    assert.equal(url.indexOf('data:text/html;charset=utf-8,'), 0, 'device gets a data: URL');
    const decoded = decodeURIComponent(url);
    assert.ok(decoded.indexOf('INJECTED_RETURN="pebblejs://close#"') !== -1, 'device return target unchanged');
  } finally { delete global.Pebble; }
});

test('no emulatorConfigUrl: always a data: URL (the helper is opt-in)', () => {
  // No Pebble global (would read as emulator) but no emulatorConfigUrl -> still data:.
  const inst = configUi.createConfig({ schema: SCHEMA, page: PAGE, options: {} });
  const url = inst.generateUrl({ values: inst.getDefaults(), watchInfo: { platform: 'basalt' } });
  assert.equal(url.indexOf('data:text/html;charset=utf-8,'), 0, 'no helper URL without emulatorConfigUrl');
});

test('explicit opts.returnTo overrides the default in the emulator', () => {
  const inst = configUi.createConfig({ schema: SCHEMA, page: PAGE, options: { emulatorConfigUrl: EMU } });
  const url = inst.generateUrl({ values: inst.getDefaults(), returnTo: 'pebblejs://close#' });
  // still the helper URL (emulator), but the caller's explicit returnTo is honored
  assert.equal(url.indexOf(EMU + '#'), 0);
  const decoded = decodeURIComponent(url.slice((EMU + '#').length));
  assert.ok(decoded.indexOf('INJECTED_RETURN="pebblejs://close#"') !== -1, 'explicit returnTo wins');
});
