// Where each phone-app and settings-page file belongs (docs/adr/0005-architecture-rules.md):
// its domain context and its role. A file's path gives its home once it sits in its folder:
//
//   src/pkjs/<context>/<role>/…   that context, role domain, application or adapter
//   src/pkjs/page/<context>/…     that context's part of the settings page (role page)
//   src/pkjs/config-ui/…          the settings page's engine (role page-engine)
//   src/pkjs/lib/…                the shared library (role lib)
//   src/pkjs/shell/…              the composition root, with src/pkjs/index.js (role shell)
//
// This table holds the few files whose path does not give their home: the entry point, the
// platform table the page engine owns but the phone app's settings read, and generated files
// a pipeline still writes into settings/. The test fails on an entry for a file that no longer
// exists.
//
// Contexts: weather, forecast-graphs, status-bars, alerts, layout, calendar, theme, health,
// settings, wire, notices, telemetry. Two homes are not contexts: shell (the composition root)
// and lib (generic helpers). A file that mixes rules with runtime calls is filed as domain and
// listed in the test's allow-list, so the split it needs stays visible.

const HOMES = {
  'shell': ['index.js'],
  // which watch has which capability, so which settings it gets
  'settings/domain': ['config-ui/lib/platform.js'],
  // the icon pipeline's generated glyphs, moved once that work is on main
  'weather/page': ['settings/condition-glyphs.generated.js', 'settings/condition-pixels.generated.js'],
};

const CONTEXTS = ['weather', 'forecast-graphs', 'status-bars', 'alerts', 'layout', 'calendar',
  'theme', 'health', 'settings', 'wire', 'notices', 'telemetry'];
const ROLES = ['domain', 'application', 'adapter'];

const BY_FILE = {};
Object.keys(HOMES).forEach((home) => {
  HOMES[home].forEach((f) => {
    if (BY_FILE[f]) { throw new Error(`${f} has two homes: ${BY_FILE[f]} and ${home}`); }
    BY_FILE[f] = home;
  });
});

/**
 * A file's home: its table entry, else what its path says (see the header).
 * @param {string} rel path relative to src/pkjs, with forward slashes
 * @returns {?{context: string, role: string}} null when the file has no home
 */
function homeOf(rel) {
  const listed = BY_FILE[rel];
  if (listed) {
    const [context, role] = listed.split('/');
    return { context, role: role || context };
  }
  const p = rel.split('/');
  if (p[0] === 'lib' && p.length > 1) { return { context: 'lib', role: 'lib' }; }
  if (p[0] === 'shell' && p.length > 1) { return { context: 'shell', role: 'shell' }; }
  if (p[0] === 'config-ui') { return { context: 'page-engine', role: 'page-engine' }; }
  if (p[0] === 'page' && CONTEXTS.indexOf(p[1]) !== -1 && p.length > 2) {
    return { context: p[1], role: 'page' };
  }
  if (CONTEXTS.indexOf(p[0]) !== -1 && ROLES.indexOf(p[1]) !== -1 && p.length > 2) {
    return { context: p[0], role: p[1] };
  }
  return null;
}

module.exports = { HOMES, CONTEXTS, ROLES, homeOf };
