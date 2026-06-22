// src/pkjs/config-ui/test/create-config.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const configUi = require('../index.js');

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
  { type: 'radio', messageKey: 'provider', defaultValue: 'dwd', options: [['D','dwd'],['O','owm']] },
  { type: 'color', messageKey: 'tint', defaultValue: 0xFF0055 }
] } ] } ] };
const PAGE = '<html><script>var INJECTED_SCHEMA=null,INJECTED_CFG=null,INJECTED_ENV=null,INJECTED_USERDATA=null,INJECTED_RETURN=null;/*__PCONF_INJECT__*/\n/*__PCONF_CONCAT__*/</script></html>';

test('re-exports pure helpers', () => {
  assert.equal(configUi.isColorPlatform('flint'), false);
  assert.equal(configUi.intToHex(0), '#000000');
});

test('createConfig instance: defaults, isColorKey, parseResponse', () => {
  const inst = configUi.createConfig({ schema: SCHEMA, page: PAGE });
  assert.deepEqual(inst.getDefaults(), { provider: 'dwd', tint: 0xFF0055 });
  assert.equal(inst.isColorKey('tint'), true);
  assert.equal(inst.isColorKey('provider'), false);
  const blob = inst.parseResponse(encodeURIComponent(JSON.stringify({ provider: 'owm', tint: '#0055AA' })));
  assert.equal(blob.provider, 'owm');
  assert.equal(blob.tint, 0x0055AA);
});

test('generateUrl: data URL, colors int->hex, env from watchInfo, markers handled', () => {
  const inst = configUi.createConfig({ schema: SCHEMA, page: PAGE });
  const url = inst.generateUrl({ values: inst.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
  assert.equal(url.indexOf('data:text/html;charset=utf-8,'), 0);
  const decoded = decodeURIComponent(url);
  assert.equal(decoded.indexOf('/*__PCONF_INJECT__*/'), -1, 'inject marker consumed');
  assert.ok(decoded.indexOf('/*__PCONF_CONCAT__*/') !== -1, 'concat marker preserved');
  assert.ok(decoded.indexOf('"tint":"#FF0055"') !== -1, 'color injected as hex');
  assert.ok(decoded.indexOf('"color":true') !== -1, 'env: basalt = color');
  assert.ok(decoded.indexOf('"messageKey":"provider"') !== -1, 'schema injected');
});

test('Layer-1 Clay-compat: getSettings persists, setSettings RMW, meta.userData + no-arg generateUrl', () => {
  const store = (function () { var m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; })();
  const inst = configUi.createConfig({ schema: SCHEMA, page: PAGE, options: { storage: store, storageKey: 'clay-settings' } });
  // getSettings parses + persists (colors hex->int) and returns the blob
  const blob = inst.getSettings(encodeURIComponent(JSON.stringify({ provider: 'owm', tint: '#0055AA' })));
  assert.equal(blob.tint, 0x0055AA);
  assert.equal(JSON.parse(store.getItem('clay-settings')).provider, 'owm');
  // setSettings(key,val) read-modify-writes
  inst.setSettings('provider', 'dwd');
  assert.equal(JSON.parse(store.getItem('clay-settings')).provider, 'dwd');
  // no-arg generateUrl reads values from storage + userData from meta.userData
  inst.meta.userData = { lastFetchSuccess: 'X' };
  const decoded = decodeURIComponent(inst.generateUrl({ watchInfo: { platform: 'basalt' } }));
  assert.ok(decoded.indexOf('"provider":"dwd"') !== -1, 'values pulled from storage');
  assert.ok(decoded.indexOf('"lastFetchSuccess":"X"') !== -1, 'userData pulled from meta');
});
