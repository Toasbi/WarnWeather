'use strict';
// The watchface's permissions (package.json pebble.usesPermissions, manifest version 2: SDK 4.44's
// default). With the Pebble app's permissions preview on (Settings › Plugins, to be on for everyone
// in a later release), a version 2 app's PebbleKit JS and settings page reach only the domains its
// Internet entries list, each covering its subdomains, and the app asks before anything else it
// declares (Location, ShowNotifications). Since app 1.18.0.1 each entry carries a `reason` (one
// short sentence the user reads wherever they decide) and `required` (installing waits for an
// answer on the required ones; the others are asked about when the app first uses them). One
// entry's reason and required cover all its domains, so the template groups the hosts by what
// they are for: https://developer.repebble.com/guides/plugins/preview/ (Declaring).
//
// package.template.json lists every API host the code requests (test/uses-permissions.test.js
// keeps the list and the code in step); the hosts of the three endpoints
// scripts/prepare-package.sh injects from the build's environment (telemetry, the Rainbow radar
// proxy and news, the project's Supabase functions) are known only at build time, so
// prepare-package.sh adds them, as an entry of their own, through addEndpointHosts.

// The injected endpoints' entry: the default radar outside Germany and the Nordics (the Rainbow
// proxy), the settings page's news and the telemetry, which is on unless the user turns it off.
// Required: a fresh install shows the radar, and the page's domains are fixed when it opens.
const ENDPOINTS_REASON = 'To show the rain radar and the news, and to share anonymous telemetry';

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
 * The app's own Internet entries (not another plugin's permission of that name).
 * @param {Array<string|Object>} uses usesPermissions.
 * @returns {Object[]} The entries, in order.
 */
function internetEntries(uses) {
  return (uses || []).filter((p) => p && typeof p === 'object' && p.name === 'Internet' && !p.plugin);
}

/**
 * Every domain the Internet entries list, in entry order.
 * @param {Array<string|Object>} uses usesPermissions.
 * @returns {string[]}
 */
function declaredDomains(uses) {
  return internetEntries(uses).reduce((all, p) => all.concat((p.parameters && p.parameters.domains) || []), []);
}

/**
 * Declare the hosts of the build's endpoints, in place: an Internet entry of their own
 * (ENDPOINTS_REASON, required), after the last required Internet entry, for every host no
 * required entry covers yet, once each (an optional entry covering one would leave the app's
 * own backend to a question the user may decline). An empty endpoint (a dev build without it)
 * adds nothing, and with nothing to add no entry is made: an Internet entry without domains
 * would reach every site.
 * @param {Object} pebble package.json's "pebble" object, holding usesPermissions.
 * @param {string[]} endpoints The endpoint URLs.
 * @returns {string[]} The hosts added.
 */
function addEndpointHosts(pebble, endpoints) {
  const uses = pebble.usesPermissions || [];
  const entries = internetEntries(uses);
  if (!entries.length) {
    throw new Error('package.template.json declares no Internet permission to add the endpoint hosts to');
  }
  const required = entries.filter((p) => p.required === true);
  const requiredDomains = declaredDomains(required);
  const added = [];
  endpoints.map(hostOf).forEach((host) => {
    if (host && !covered(host, requiredDomains.concat(added))) { added.push(host); }
  });
  if (!added.length) { return added; }
  const after = uses.indexOf(required.length ? required[required.length - 1] : entries[entries.length - 1]);
  uses.splice(after + 1, 0, {
    name: 'Internet',
    parameters: { domains: added.slice() },
    reason: ENDPOINTS_REASON,
    required: true
  });
  return added;
}

module.exports = { ENDPOINTS_REASON, hostOf, covered, internetEntries, declaredDomains, addEndpointHosts };
