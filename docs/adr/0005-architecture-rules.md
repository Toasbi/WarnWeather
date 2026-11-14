# Architecture rules: domain contexts first, the domain free of the runtime

## Context

WarnWeather is one repository with five deployables that talk to each other only through wire
contracts:

| Deployable | Runs on | Language |
| --- | --- | --- |
| Watchface | the watch (aplite, basalt, diorite, emery, flint) | C, Pebble SDK |
| Phone app (PKJS) | the Pebble phone app's JavaScript runtime | ES5 JavaScript |
| Settings page | the phone's webview, opened from the Pebble app | ES5 JavaScript, HTML |
| Edge functions | Supabase (`rainbow-nowcast`, `telemetry-ingest`, `news`) | TypeScript on Deno |
| Weather plugins | the Pebble app's plugin engine | JavaScript (ES2017) |

The product's rules (which hour a provider's condition belongs to, when an alert replaces a
slot, how a stored setting upgrades) are business logic that must be testable without a watch,
a phone or a network. The runtime (HTTP, `localStorage`, `Pebble.*`, the clock) is what makes
them hard to test when the two share a function.

This ADR sets where code belongs and which way its dependencies point.

## Decision

### 1. Group by domain context first, then by role

Code that belongs to one domain context sits in one folder per deployable. Inside a context,
files are grouped by role (`domain`, `application`, `adapter`), never the other way round: there
is no global `domain/` or `adapter/` folder holding every context. A folder that grows past
about 15 to 20 files is split by sub-area. Tests mirror the source layout. Moves land in commits
of their own, separate from edits.

### 2. The domain contexts

| Context | Sub-areas |
| --- | --- |
| Weather data | providers and their keys, weather condition, hourly series, forecast span, radar, air quality and pollen, sun events, the weather tab |
| Forecast graphs | graph styles, line styles, axes, rain bars, stripes |
| Status bars | slots and slot text, status lines, On demand, rebake, city and phone battery |
| Alerts | weather alerts, rain alert, metric alert thresholds |
| Screens and layout | screens, view specs, flick cycle, presets, stack layout |
| Calendar | date formats, public holidays |
| Theme | palettes and inks, theme schedule, night light |
| Health | sleep window, steps and heart rate |
| Settings | stored settings, migrations, the settings message |
| Wire transport | outbox, change detector, channel scheduler, packing and units |
| App notices | release notification, news, update check, watch notifications |
| Telemetry | snapshot, upload, ingest, diagnostics |

Two homes are not contexts:

- **App shell** (`src/pkjs/index.js` and the fetch cycle): the composition root. It creates the
  adapters, passes them in, and wires the Pebble events to the contexts. It holds no rules.
- **Shared library** (`src/pkjs/lib/`): generic helpers with no domain word in them (polyfills,
  UTF-8, integer packing). Anything that names a context's concept belongs to that context.

`CONTEXT.md` (Context map) shows which deployable holds which part of each context.

### 3. Phone app and edge functions: the domain is free of the runtime

Every phone-app context has the same shape (lightweight hexagonal):

- **`domain/`** holds the rules. It never calls `XMLHttpRequest`, `fetch`, `localStorage`,
  `Pebble.*`, `navigator`, `Date.now()` or `new Date()` without an argument. It takes data and
  the current time as arguments and returns values. It requires only domain modules (its own
  context's, or another context's public ones) and the shared library.
- **`application/`** runs a use: it loads what it needs through ports, calls the domain, and
  hands the result to a port.
- **`adapter/`** is the only place that touches the runtime. Ports are plain ES5 objects passed
  in, only at real seams: weather and radar HTTP, storage, AppMessage (the outbox stays the only
  sender), geolocation, the clock and notifications. Collaborators inside a context stay direct
  calls; there is no framework and no container.
- Dependencies point inward (`adapter` → `application` → `domain`), with no cycles. A context
  without rules of its own (wire transport, app notices, telemetry) has no `domain/` folder.

Full hexagonal's command and query objects and one inbound port per use case do not apply: the
phone app has one caller, its own event handlers, and an interface per action would have no
second implementation behind it.

The edge functions follow the same rule inside each function: Supabase, upstream HTTP and logs
are reached only through their own modules (`supabase-store.ts`, `upstream.ts`, `log.ts`), and
the handler's rules take their inputs as arguments.

### 4. Watchface and settings page: layered

- **Watchface:** `windows` → `layers` → `appendix` and `services`; a lower layer never includes
  a higher one. Types that several layers share (the view spec, the layout tiers) live below
  the layers, not in `windows/`. HealthService calls stay in `services/health.c`. No include
  cycles. Aplite twins and contract files follow ADR 0001. Inside each layer, files group by
  domain context where the code has one (chart and graph, radar and rain, status row, calendar,
  palette and theme).
- **Settings page:** `config-ui/lib` is the engine (rendering, show-when, controls) and knows
  nothing of WarnWeather's settings; `settings/` holds the schema, pages and previews that use
  it, grouped by context. Previews draw what the watch would draw by calling the phone app's
  domain modules, never by copying their rules. It stays plain ES5 without a framework: the
  Pebble app opens it in old Android webviews that a framework's output does not run on.

### 5. Errors are values

Expected failures are values, not exceptions: a provider that answers with an error, a refused
API key, no location, an out-of-coverage radar. Asynchronous code reports them through its
failure callback as a `{stage, code}` value (`weather/http.js` `failure`); synchronous code
returns `null` or a failure value. A thrown exception means a bug or a broken runtime, and
nothing catches one to steer normal flow. Edge functions answer expected failures with a status
code and a JSON error body, and catch everything else as `unhandled`.

### 6. Validation at the edge, once

Input is checked once, where it enters:

| Input | Checked in |
| --- | --- |
| Weather and radar API responses | the provider's adapter, which maps them into one model (`weather/provider.js` `adoptMapped`) |
| Stored settings | the settings read and its migrations |
| The settings page's return | the settings context, as it stores them |
| AppMessage tuples | the watch's wire readers (`appendix/status_line.c`, `config_wire.c`, …) |
| Request bodies | each edge function's body schema, unknown fields rejected |

Code behind that edge trusts its input and does not check it again.

### 7. Contracts between deployables

| Contract | Between | Shape | Guarded by |
| --- | --- | --- | --- |
| AppMessage | phone app → watchface | the message keys in `package.template.json`, packed by the wire modules; one weather and one settings message, each within the watch's inbox | `test/inbox-size.test.js`, the C host tests of the wire readers |
| Settings return | settings page → phone app | the page's JSON of stored values | the schema golden file, the migration tests |
| Telemetry, news, radar | phone app → edge functions | JSON over HTTPS POST | each function's body schema and Deno tests |
| Weather APIs | weather services → phone app | each service's own format; the phone conforms and maps it in its provider adapter | the provider tests and fixtures |
| Plugin manifest | weather plugins → Pebble app | the shapes a plugin declares (`plugins/lib/vocabulary.js`) | `plugins/test/manifest.test.js` |

No contract changes for a restructuring: wire formats, persist keys, stored settings and the
inbox budgets stay as they are.

### 8. Names

`CONTEXT.md` is the binding glossary: code, tests, docs and ADRs use its terms, and a new term is
added there before it is used. Domain names are English, the language of the product, its users
and its docs.

### 9. Checked by tests

Each rule above that a machine can check gets an architecture test: the phone app's `require()`
graph (domain purity, direction, no cycles, every file in a context or the shell or the shared
library), the watchface's `#include` graph (direction, HealthService, no cycles) and the edge
functions' imports. A test may start with an allow-list of the violations it finds; the list only
shrinks. A rule without its test yet is checked in review.

`docs/quality-goals.md` lists the quality goals that differ from the norm, each with its check.

### 10. What does not apply, and when to look again

| Not adopted | Why | Look again when |
| --- | --- | --- |
| Full hexagonal (commands, queries, one port per use case) | one caller per context | a context gets a second caller, such as a plugin sharing its domain code |
| Hexagonal on the watch | the phone bakes the decisions; the watch renders | the watch starts deciding what the phone does not bake for it |
| A framework for the settings page | old Android webviews | the oldest webview the Pebble app supports runs ES2015 |
| Domain events, outbox and inbox tables, messaging, CQRS, audit trail | no message broker, no database aggregates; the phone app's `outbox.js` is a send queue, not a transactional outbox | a second backend service consumes the app's data |
| GraphQL rules | WarnWeather serves no GraphQL; it only calls Yandex's | – |

## Consequences

- Files outside their context folder move there, each move in a commit of its own with no other
  change; new code starts in its context's folder.
- Domain code takes the time and its data as arguments, so its tests need no runtime stubs.
- Shared watchface types move out of `windows/` so layers no longer include it.
- The architecture tests fail on a new violation.

| Name | Architecture rules |
| --- | --- |
| Short Description | Domain contexts first; the domain free of the runtime; layered watchface and settings page; errors as values; validation at the edge; rules checked by tests |
| Updated on | 2026-11-14 |
| Person responsible | Repository owner |
| Status | `ACCEPTED` |
| Approved by | Repository owner |
