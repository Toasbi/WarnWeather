# Architecture rules: domain contexts first, lightweight hexagonal where the rules live

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

The code grew feature by feature, so files sit where they were first written: `src/pkjs/` holds
dozens of files side by side, `src/pkjs/settings/` about seventy, `src/c/appendix/` mixes chart,
radar, status and theme code. Business rules (which hour a provider's condition belongs to, when
an alert replaces a slot, how a stored setting upgrades) sit next to HTTP calls, `localStorage`
and `Pebble.*` calls in the same functions, so they are tested through stubs of the runtime.

This ADR fixes which architecture rules apply to which part of WarnWeather, so later changes
move every part toward one shape instead of each feature choosing its own.

## Decision

### 1. Group by domain first, then by role

Code that belongs to one domain context sits in one folder. Inside a context, files are grouped
by role (`domain`, `application`, `adapter`), never the other way round: there is no global
`domain/` or `adapter/` folder holding every context. A folder that grows past about 15 to 20
files is split by sub-area. Tests mirror the source layout, so a context's tests sit together.
Moves land in commits of their own, separate from edits.

### 2. The domain contexts

A context is the unit every rule below is decided for. Each context names its sub-areas and the
deployables it spans; `CONTEXT.md` (Context map) shows how they connect.

| Context | Sub-areas | Business logic? | Pattern |
| --- | --- | --- | --- |
| Weather data | providers, weather condition, hourly series, forecast span, radar, air quality and pollen, sun events | yes: each provider's data mapped to one model, the hour each value belongs to, radar coverage | lightweight hexagonal |
| Forecast graphs | graph styles, line styles, axes, night shading, rain bars | yes: what each line draws from, scales and thresholds | lightweight hexagonal |
| Status bars | slots and slot text, status lines, On demand, rebake, phone battery | yes: what a slot shows, what fits, when a line is baked again | lightweight hexagonal |
| Alerts | weather alerts, rain alert, metric alert levels | yes: when an alert fires and what it replaces | lightweight hexagonal |
| Screens and layout | screens, view specs, flick cycle, presets, stack layout | yes: what a screen shows and what fits on it | lightweight hexagonal |
| Calendar | date formats, public holidays | yes: holiday rules per country, date formatting | lightweight hexagonal |
| Theme | palettes, theme schedule, night light | some: when the theme flips | layered |
| Settings | stored settings, migrations, the Clay payload | yes: migrations upgrade stored values by rule | lightweight hexagonal |
| Settings page | schema, pages, previews, wizard, key checks | presentation of the settings context | layered |
| Wire transport | outbox, change detector, channel scheduler, packing | no: transport only | layered |
| App notices | release notification, news, update check | no | layered |
| Telemetry | snapshot, ingest | no | layered |
| Watchface | windows, layers, appendix, services | rendering, little logic | layered |
| Rainbow nowcast (edge) | keys, budgets, router, upstream | yes: per-key budgets and limits | lightweight hexagonal |
| Telemetry ingest, news (edge) | handler, schema | no | layered |

The watchface's own grouping follows the same contexts where its code has them: chart and graph,
radar and rain, status row, calendar, palette and theme.

### 3. Lightweight hexagonal for contexts with business logic

A context passes the business-logic test when it makes decisions beyond field and format
checks, holds state whose changes follow rules, or encodes rules the owner decides as product
questions. Those contexts use **lightweight hexagonal**:

- **The domain is free of the runtime.** Domain code never calls `XMLHttpRequest`, `fetch`,
  `localStorage`, `Pebble.*`, `navigator`, `Date.now()` or `new Date()` without an argument.
  It takes data and the current time as arguments and returns values.
- **Ports only at real seams:** weather and radar HTTP, storage, AppMessage (the outbox stays the
  only sender), geolocation, the clock and notifications. A port is a plain ES5 object passed in;
  there is no framework and no container. Collaborators inside a context stay direct calls.
- **Dependencies point inward:** `adapter` may require `application` and `domain`;
  `application` may require `domain`; `domain` requires only `domain` (its own and other
  contexts' domain modules). No cycles.
- **Contexts talk through their public modules**, not each other's internals.

The command/query modelling and one-inbound-port-per-use-case that full hexagonal asks for do
not apply: the phone app has one caller (its own event handlers), and a use-case interface per
action would add a file per function without a second implementation behind it.

### 4. Layered for transport, presentation and existing systems

Contexts without business logic, and the watchface, keep a layered shape and write it down:

- **Watchface:** `windows` → `layers` → `appendix` and `services`. A layer does not include a
  window (the status bar and status row still do, and the include test lists them until they
  are fixed); HealthService calls stay in `services/health.c`; no include cycles. Aplite twins
  and contract files follow ADR 0001 unchanged.
- **Settings page:** `config-ui/lib` is the engine (rendering, show-when, controls) and knows
  nothing of WarnWeather's settings; `settings/` holds the schema, pages and previews that use
  it. Previews compute what the watch would draw from the phone app's domain modules rather
  than copying their rules.
- **Wire transport, app notices, telemetry, theme** and the edge functions without business
  logic: adapters at the edge, plain modules behind them.

### 5. Errors

Expected failures are values, not exceptions: a provider that answers with an error, a refused
API key, no location, an out-of-coverage radar. Asynchronous code reports them through its
failure callback as a `{stage, code}` value (`weather/http.js` `failure`); synchronous code
returns `null` or a failure value. A thrown exception means a bug or a broken runtime, and
nothing catches one to steer normal flow. Edge functions answer expected failures with a status
code and a JSON error body, and catch everything else as `unhandled`.

### 6. Validation at the edge, once

Input is checked once, where it enters a context: weather API responses in the provider
adapter (mapped into one model, `weather/provider.js` `adoptMapped`), stored settings when they
are read and migrated, AppMessage tuples by the watch's wire readers, request bodies in the edge
functions (unknown fields rejected). Code behind that edge trusts its input and does not check
it again.

### 7. Names

`CONTEXT.md` is the binding glossary: code, tests, docs and ADRs use its terms, and a new term is
added there before it is used. Domain names are English, the language of the product, its users
and its docs.

### 8. Architecture tests

The rules above are checked by tests, not by review alone:

- a Node test over the `require()` graph of `src/pkjs`: domain modules require no adapter and
  touch no runtime global; no cycles;
- the same over the watchface's `#include` graph: layers never include windows, HealthService
  only in `services/health.c`, no cycles;
- the edge functions reach Supabase and upstream HTTP only through their store and upstream
  modules.

A test starts with an allow-list of today's violations, which only shrinks.

### 9. Quality goals and REST

`docs/quality-goals.md` lists the quality goals that differ from the norm, each with the check
that guards it. The edge functions follow the usual REST rules for status codes and error bodies.

### 10. What does not apply

| Rule area | Why not |
| --- | --- |
| Domain events, transactional outbox and inbox, messaging | No message broker. The phone app's `outbox.js` is a send queue for the AppMessage channel, not a transactional outbox. |
| CQRS, audit trail | No database aggregates on the phone; the only server database holds telemetry and news. |
| Invocation context | No authenticated users or tenants to carry through calls. |
| GraphQL | WarnWeather provides no GraphQL API; it only calls Yandex's as a client. |
| Frontend framework selection | The settings page stays plain ES5 with its own engine: the Pebble app opens it in old Android webviews that a framework's output does not run on. The ES5 test (`test/config-es5.test.js`) and the page's tests are its guardrails. |

### Exceptions and when they are looked at again

| Exception | Look again when |
| --- | --- |
| Lightweight instead of full hexagonal | a context gets a second caller (a plugin or another app sharing its domain code) |
| Settings page without a framework | the oldest webview the Pebble app supports runs ES2015 |
| Watchface layered, not hexagonal | the watch starts making decisions the phone does not bake for it |
| Theme, app notices, telemetry layered | one of them gains rules the owner decides as product questions |

The owner of the repository owns these exceptions.

## Consequences

- Phase by phase, files move into context folders (`src/pkjs/<context>/…`, `src/c/<area>/…`,
  tests alongside), each move in a commit of its own with no other change.
- New code goes into its context's folder from the start, and domain code takes the time and its
  data as arguments.
- The architecture tests fail on a new violation; their allow-lists shrink as contexts move and
  are never extended.
- Wire formats, persist keys, stored settings and the inbox budgets do not change for this
  restructuring.
- Weather plugins are released on their own and are not part of this restructuring.

| Name | Architecture rules |
| --- | --- |
| Short Description | Domain contexts first; lightweight hexagonal where business logic lives, layered elsewhere; errors as values; validation at the edge; rules checked by tests |
| Updated on | 2026-11-14 |
| Person responsable | Repository owner |
| Status | `ACCEPTED` |
| Approved by | Repository owner |
