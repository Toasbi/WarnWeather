'use strict';
// The watchface's network permissions (package.json pebble.usesPermissions, manifest version 2:
// SDK 4.44's default). The phone app lets a version 2 app's PebbleKit JS reach only the domains its
// Internet permission lists, each covering its subdomains. package.template.json lists every
// API host the code requests (test/uses-permissions.test.js keeps the list and the code in
// step); the hosts of the three endpoints scripts/prepare-package.sh injects from the build's
// environment (telemetry, the Rainbow radar proxy and news, the project's Supabase functions)
// are known only at build time, so prepare-package.sh adds them through addEndpointHosts.

/**
 * The hostname of an http(s) URL.
 * @param {string} url A URL, or '' for an endpoint the build leaves empty.
 * @returns {?string} The lower-case hostname, or null for anything else.
 */
function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || '').trim());
  return m ? m[1].toLowerCase().replace(/\.$/, '') : null;
}

/**
 * Whether a declared domain covers a host: itself and its subdomains.
 * @param {string} host A hostname.
 * @param {string[]} domains Declared domains.
 * @returns {boolean}
 */
function covered(host, domains) {
  return domains.some((d) => {
    const domain = String(d).toLowerCase().replace(/^\./, '').replace(/\.$/, '');
    return host === domain || host.endsWith('.' + domain);
  });
}

/**
 * Add the hosts of the build's endpoints to the Internet permission's domains, once each, in
 * place. An empty endpoint (a dev build without it) adds nothing.
 * @param {Object} pebble package.json's "pebble" object, holding usesPermissions.
 * @param {string[]} endpoints The endpoint URLs.
 * @returns {string[]} The hosts added.
 */
function addEndpointHosts(pebble, endpoints) {
  const uses = pebble.usesPermissions || [];
  const internet = uses.find((p) => p && typeof p === 'object' && p.name === 'Internet' && !p.plugin);
  if (!internet) {
    throw new Error('package.template.json declares no Internet permission to add the endpoint hosts to');
  }
  internet.parameters = internet.parameters || {};
  const domains = internet.parameters.domains = internet.parameters.domains || [];
  const added = [];
  endpoints.map(hostOf).forEach((host) => {
    if (host && !covered(host, domains)) {
      domains.push(host);
      added.push(host);
    }
  });
  return added;
}

module.exports = { hostOf, covered, addEndpointHosts };
