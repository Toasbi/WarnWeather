# WarnWeather

WarnWeather is a Pebble weather watchface: a C watchface (`src/c/`) driven by
phone-side PebbleKit JS (`src/pkjs/`), with a Clay config UI and a Supabase
telemetry backend. This file is its glossary: the canonical vocabulary, with pointers to
where each term lives in the code.

## Context map

The domain contexts, and which deployable holds which part of each. The rules each context follows
and the contracts between the deployables are in [ADR 0005](./docs/adr/0005-architecture-rules.md).

**Domain context**:
A part of the product with its own model and words: weather data, forecast graphs, status bars,
alerts, screens and layout, calendar, theme, health, settings, wire transport, app notices,
telemetry.
Its code sits in one folder per deployable, grouped by role inside (in the phone app,
`src/pkjs/<context>/<role>/`).
_Avoid_: module, feature (for the whole context).

| Context | Watchface (C) | Phone app (PKJS) | Settings page | Edge functions |
| --- | --- | --- | --- | --- |
| Weather data | draws what it is sent | fetches, maps and bakes it | previews it | `rainbow-nowcast` (radar) |
| Forecast graphs | draws the graphs | packs series and line styles | previews and edits styles | – |
| Status bars | draws the bars, makes room | bakes each bar's line | previews and edits slots | – |
| Alerts | draws them, replaces slots | decides when one fires | edits thresholds | – |
| Screens and layout | lays out each view | compiles screens to view specs | edits screens | – |
| Calendar | draws the calendar | packs the holiday mask | edits formats | – |
| Theme | palettes, night light | theme schedule | previews colours | – |
| Settings | reads the settings message | stores, migrates, sends them | the schema and pages | – |
| Wire transport | AppMessage inbox, persist | outbox, change detector, scheduler, battery saver | – | – |
| App notices | release toast | news, update check | news panel | `news` |
| Health | reads the watch's health data | – | previews it | – |
| Telemetry | – | snapshot and upload | – | `telemetry-ingest` |

**Outbox (phone app)**:
The phone app's one sender to the watch. It bundles what changed into one message and counts it
as sent once the watch acknowledges it. It is a send queue; the term does not mean a
transactional outbox.

## Platform divergence

How aplite stays within its fixed 24 KB budget while the other platforms grow
(see [ADR 0001](./docs/adr/0001-aplite-frozen-lean-fork.md)).

**Lean twin**:
An aplite-only `foo_aplite.c` that implements the same declared interface as the
shared `foo.c`, cheaply and without color code. It is used only when aplite callers
must still call the interface, so the twin substitutes for `foo.c`.
_Avoid_: aplite variant, aplite fork (say "lean twin").

**Exclusion**:
A feature aplite does without. It lives in its own leaf file whose entry points are
guarded, so nothing on aplite references it and `--gc-sections` removes all of it.
It has no twin and no duplicate.
_Avoid_: aplite-disabled, stubbed-out.

**Shared contract file**:
A file whose wire format, on-flash format or config schema must stay identical
across platforms (`app_message.c`, `persist.c`, `config.c`). It is never forked.

**Frozen (of a lean twin)**:
Feature-frozen: a twin never gains new features, but it still receives
hand-ported bugfixes and interface updates.

## Layout

**View spec**:
The small struct that describes what is on screen: top-band content, calendar
rows, body, status row(s), font tier and band size weights. Geometry and layer
visibility both derive from it. The phone compiles view specs (`view-cycle.js`)
from the layout preset or, with the custom layout, from the user's screens, and sends them;
the layout module reads them.

**Preset (layout)**:
A named built-in view spec, keyed by the `layoutPreset` setting: `fullCal`,
`compactCal`, `compactDense` (which stays dense, with health and radar status paired,
even without a body) or `noCal`. Presets are compiled to view specs and have no
code path of their own.

**Stop (flick)**:
One position in the wrist-flick cycle: a view spec shown when the user flicks.
A layout preset sets its stops; the custom layout's stops are the user's screens, in
their order. Aplite has no flick cycle. With *Double flick* on, the cursor advances only on the
second accepted flick within the pairing window (layout.h `view_flick_accept`).

**Screen (settings page)**:
One view of the flick cycle as the settings page edits it: a list of rows, top to bottom
(`src/pkjs/layout/domain/screens.js`), compiled to the custom layout's per-view keys. Its name belongs to the
page (`viewName{i}`: never compiled, sent or in telemetry) and moves with the screen; '' reads
as its place: Default, Flick 1 or Flick 2. The top screen is the Default, the one the watch
returns to, and it always shows the clock. A screen moved there gets the clock, or stays where
it was when the clock does not fit (`src/pkjs/page/layout/screens-page.js` moveScreen).
_Avoid_: view (the watch's word for what it draws).

**Status bar (named)**:
One of the bars a screen can show besides the Watch bar ("your bars"): the Forecast, Radar and
Health bars (`on-demand.js` BARS, `STATUS_LINE_1`/`_2`/`_4`), and on emery bars 4 to 6 once New
bar made them (`STATUS_LINE_5..7`). Each holds what its three slots hold, whatever its kind. Its
name belongs to the page (`<prefix>Name`: never compiled, sent or in telemetry); '' reads as its
kind's name (`screens.js` barName). The Watch bar keeps its name. Any screen can show any of
them, and the watch draws each without radar or health data (`layout.c` view_spec_resolve).
On a custom layout the radar and health modes therefore follow what the shown bars hold, and
which bar is shown does not matter (`screens.js` deriveModes). A bar no screen shows costs
nothing: the phone sends it no line and fetches nothing for its slots (`status-line-catalog.js`
bakedLines), and the watch never reads it (`status_bar.c` status_bar_set_in_use). The Watch
bar's line is always sent, because a Timeline Quick View peek shows the strip on every screen.
_Avoid_: naming a bar by its source ("the radar row") where its name is meant.

**Made bar (bars 4 to 6)**:
One of emery's three extra bars (`view-cycle.js` EXTRA_BARS: `bar4`..`bar6`, prefixes
`statusBar4`..`6`). It exists from New bar (`<prefix>Made` true, `view-cycle.js` barMade;
`screens.js` makeBar makes an empty bar with its slots off, named for its kind unless another
bar has that name) until Delete bar (`screens.js` unmakeBar turns off every screen's row that
names it). The phone bakes its line while a screen shows it and sends its On demand cells
(`CLAY_OD_EXTRA_UINT8`) to a known emery only. A screen row names it with an ext bit over the
first three bars' sources (`view-cycle.js` packExt, `layout.h` VIEW_EXT_UPPER_BAR_HI), and every
other watch, an unknown one included, turns such a row off.
_Avoid_: calling bars 4 to 6 "custom bars" or "user bars"; they are your bars like the first three.

**Screen preset**:
A screen that Add screen offers after Blank (the Watch bar and the clock): Classic, Weathergraph,
Clean, Stripes, Health + calendar and Health (`src/pkjs/page/layout/screen-presets.js`), each only where the
watch can draw it. On emery a forecast preset brings a graph: one of yours that reads as its
template, or else a new one made from the template. A screen preset is one screen, while a
layout preset (`layoutPreset`) is a whole cycle.
_Avoid_: calling it a layout preset, or a template (a template is where a graph starts).

**Tier push**:
Per-view layout facts (calendar rows, the date slot's full-date mode, graph gap,
status tier and line id) flow one way: view spec → window → owning layer →
consumed state (a layer static or a per-instance row field). Layers never read
tier facts from config; config's `top_view_mode` exists only for wire and flash compatibility.

## Settings pipeline

**Clay bundle**:
The settings AppMessage on the wire: all watch-bound settings keys
(`CLAY_*`, the packed holidays and the palettes) sent atomically in one message.
`sendClay` never splits it. The weather message is different: it is split per category.

**Guarded key (of the Clay bundle)**:
A key in `config_parse_wire`'s all-or-nothing presence chain
(`src/c/appendix/config_wire.c`). The chain is the category detector: it tells a
message that carries no config (normal for weather messages) from one that carries
config. Holidays and palettes are left unguarded on purpose. They have their own
handlers and dirty flags, so a parse problem there cannot take the whole config down.

**Graph-options word (emery)**:
The `CLAY_LARGE_GRAPH_FONT` int read as bits on emery: bit 0 is *Larger graph
fonts*, and bits 2, 3 and 5 are the forecast's left axis options (Graphs › Forecast ›
Left axis): high/low numbers on the graph, numbers off, and numbers naming the
temperature scale. Bits 1 and 4 are reserved: the axis line is drawn exactly
when the numbers are on the axis, and their outline exactly when they are on the graph. The
layout is `config.h`'s `GRAPH_OPT_*`, kept in lockstep with `src/pkjs/forecast-graphs/domain/forecast-axis.js` `BIT`,
and the watch keeps bits 1-7 in `Config.forecast_axis`. The phone packs a dormant option as its
default, so the axis bits are all zero exactly when every axis option is at its
default. While they are zero the tuple is a bare boolean, and a known non-emery
watch never gets more than that. Emery and an unknown watch get the number once an axis
option leaves its default. The scale option is the only one that also touches the weather
message: on a known emery, `TEMP_MIN`/`TEMP_MAX` carry the scale's ends instead of the air's.
_Avoid_: a new message key per graph option.

## Channel

**Half-duplex channel**:
The phone↔watch AppMessage link. It carries one message at a time: a second
send issued before the ACK collides and is dropped. Every send-ordering rule
on the phone side follows from this.

**Channel scheduler**:
The module that decides when anything is sent over the channel: the startup handshake,
config-close chaining, the day-change resend and the minute tick. The outbox decides
what is sent (dedupe, one-message bundling, ACK-gated cache commit).
_Avoid_: send queue.

**Battery saver**:
The night window (`sleepStartHour` to `sleepEndHour`) in which the phone fetches no weather and
sends the watch no phone-battery updates, so the Bluetooth link stays quiet. The watch is told
through `IS_SLEEPING`. It shares the Nighttime card's hours with the night theme and the
backlight dim, but owns its own pair.
_Avoid_: sleep window, sleep mode (the stored keys keep the sleep names).

**Fetch cycle**:
The module that runs one weather fetch from trigger to record
(`src/pkjs/shell/fetch-cycle.js`): the refresh gates (marker, slot, sleep pause,
failure backoff), the single-flight rule and its queued force, the watchdog and
late-completion guard, the attempt counter, the sleep commit and the
success and failure records. The scheduler asks it two things, `shouldFetchNow`
and `start(force)`, and everything it depends on (clock, timer, provider,
settings, outbox) is injected.
_Avoid_: fetch orchestrator, refresh loop.

## Weather

**Fetch options**:
The one per-fetch value that every adapter and auxiliary fetch reads its settings from
(`provider.options`, built by `weather/domain/fetch-options.js` from the settings):
which optional series are wanted (UV, AQI, pollen, feels), the feels formula,
the day-max codes, the wind unit, the AQI scale, source and token, and the forecast
span (hours, emery only). Every default lives there, and nothing downstream has
a fallback of its own.
_Avoid_: provider flags, per-fetch knobs.

**Graph style**:
A named set of the forecast graph's settings on emery: its four lines (metric,
style, Draw from, Visible values), the main metric's fill, the rain bars, Day / night shading,
Forecast length, Left axis values and the graph colors (`src/pkjs/forecast-graphs/domain/graph-styles.js`
GOVERNED). There are up to three. The first is the flat settings keys; the others live in
the `graphStyles` item. Each screen's forecast graph names its style
(`viewStyle{i}`). The settings that shape the data the phone bakes stay one setting for
every style (SHARED). All the styles the screens show draw at most five series
together, which is the weather message's five trend rows. A series is a metric, its
stripe or line and its Visible values, so a wind line drawn All on one graph
and Alert on another takes two rows. There is one row per line, plus a spare row
that is none of a style's own lines (a style keeps its four lines; the spare has no
picker, `src/pkjs/forecast-graphs/domain/line-style.js` SPARE_LINE). A new style starts from one of Setup's
forecast looks (Classic, Clean, Stripes: `src/pkjs/page/settings/wizard/wizard-forecast.js` LOOKS).
The settings page calls a style a graph ("Your graphs"; "Graph 2" until it is renamed)
and calls the look it starts from a template. A template never changes and is never one
of the graphs (`src/pkjs/page/forecast-graphs/graph-styles-page.js`).
_Avoid_: graph profile; calling a look a style (a look is where a style starts).

**Forecast span**:
The forecast graph's Forecast length option. On emery it is 12 h, 24 h or the long span
(Graphs › Forecast › Other › Forecast length; stored as '12' / '24' / '48'. '48' is the long
span's token, and its label is the whole hours the watch will show for the provider's
feed and the layout: `src/pkjs/weather/domain/forecast-span-hours.js`). Everywhere else, and on an unknown
watch, it is 24 h (`src/pkjs/weather/domain/forecast-span.js`). The phone decides how many hours it sends
for it: 14, 24 or 68, and 26 for 24 h when the graph has no left axis (the high/low numbers
On graph or Off on a known emery) (`hours()`; `WeatherProvider#payloadEntries`, fewer when a
feed is shorter). The watch fits its grid to the count it receives (`NUM_ENTRIES`,
`src/c/appendix/forecast_span.h`: 2..14 the 12 h grid, 15..26 the 24 h grid, 27..68 the long
one) and to its own plot width. Each graph style has its own span: the phone sends the hours
needed by the longest style that a shown screen uses, and each screen draws its own style's
hours of them. See `docs/adr/0004-forecast-span-is-the-data.md`.
_Avoid_: a watch-side forecast hours setting; calling the sent hours the span.

**Visible hours**:
The hours the emery forecast draws on screen: those of the n hours sent whose tick column
lies on the plot of width W, through the one slot→x mapping
(`src/c/appendix/slot_x.h`, in 1/256 px: min(n, ceil(W · 256 / pitch_q))). W
runs from the plot's left edge to the screen's right edge, so the label strip
(or its absence, with no left axis) sets it. Every grid runs the data to the right
edge or past it, so there is no blank tail; the long grid's fractional pitch puts
the last hour's point on the plot's last column. How many hours show for each class,
feed and layout is set by the rule in `src/c/appendix/forecast_span.h` (see
`docs/adr/0004-forecast-span-is-the-data.md`). The settings page labels the long
option with the whole hours (`forecast_span_whole`, mirrored by
`src/pkjs/weather/domain/forecast-span-hours.js`).
The temperature scale and the hi/lo labels fit the visible hours, and ignore the other
hours sent (`forecast_layer.c` fit_entries, `forecast_numbers.h`
forecast_numbers_relabel). The stripe bands and the curve's anchored edges
read the hours whose bar starts on screen. The hour axis labels only what fits whole on
screen: a label that either edge would cut is dropped (its tick stays), and with no left
axis the current hour (slot 0) is never labelled. Each label names its slot's own local
hour, across a daylight-saving change too. The long grid marks the clock: a label every 6
hours, every 3 once 3 hours span 18 px, and a small tick on the other 3-hour marks.
_Avoid_: forecast span (that is the option).

**Mapped forecast**:
The plain object an adapter's `withProviderData` produces from its API
response(s): the series, scalars and feels inputs named by
`WeatherProvider.MAPPED_KEYS`. The adapter hands it to `adoptMapped`, which applies the
fetch options' gates and the one missing-value convention per field and writes
the instance. An adapter only maps; only adopt decides.
_Avoid_: normalized provider fields, provider instance shape.

## Radar

**Radar source**:
The user-selected origin of the short-term rain nowcast, chosen independently of the
weather provider: DWD (best radar in Germany, exact spot and nearby area), Met.no (best
radar in the Nordics, exact spot), Rainbow (global satellite and radar nowcast, exact spot,
worldwide) or Tomorrow.io (ML nowcast on the user's own key, exact spot, worldwide). Every
source answers the same interface, and "off" is itself a source whose tuples clear the radar.
Rainbow is two sources, and the Radar provider picker (Graphs tab › Rain radar) offers both.
"Rainbow (limited)" (id `rainbow`) is shared Rainbow: it goes through the project's proxy
on the project's key and its monthly allowance, so it refreshes at most every
30 minutes. That is one request per UTC-aligned half-hour slot, wherever the watch is:
after a move within the slot, the watch keeps the slot's answer until the next slot. "Rainbow
(own key)" (id `rainbowkey`) fetches the same nowcast directly on the user's
own key at every update. On that key the first 5,000 calls a month are free
(Rainbow asks for a credit card and bills calls past that). Both ids are
stored `radarProvider` values; a settings migration turns a stored `rainbow` plus a
`rainbowOwnKey` switch into `rainbowkey`.
Picked without a key, the own-key source clears the radar. Where the own key
can't be set, Rainbow is the limited source.
_Avoid_: radar provider in prose (the wire key `radarProvider` keeps its name).

**Radar tuples**:
The wire triplet every radar source produces: the exact-spot trend, the nearby-area
trend and the slot-0 start epoch. Empty trends with a zero start mean "clear
the radar on the watch".

**Radar limit notice**:
The third radar answer, besides a window and the clear: the source is up but
refuses us because a request limit is reached (HTTP 429 from the shared
Rainbow proxy, Rainbow on the user's own key or Tomorrow.io). It is sent alone as
`RAIN_RADAR_LIMITED`, the phone's line ("Radar limit reached"), never with the
radar tuples. The watch keeps its window and, where that window shows no rain,
shows that line instead of the no-rain line. With no window yet (a fresh
install, or right after a clear) the radar view still shows, with only the
notice. The next radar tuples (a window or the clear) end it.
_Avoid_: calling it transient (a transient failure sends no radar keys at all).

**Out of coverage (radar)**:
A place outside a regional radar source's area: DWD's composite around Germany or
Met.no's Nordic nowcast (weather/domain/radar/radar-coverage.js; Rainbow and Tomorrow.io
are worldwide). No request goes out. The answer is the clear, with the
source's line in `RAIN_RADAR_LIMITED` ("DWD radar: Germany only"), so the
watch's radar says why it is empty, and the settings show an amber note under
the Radar provider row that names a source covering the place.
_Avoid_: sending flat zeros for it, which draws a made-up "no rain".

**Slot (radar)**:
One five-minute bucket of the two-hour nowcast window. Slot 0 is pinned to the
most recent wall-clock five-minute boundary. Because slots are aligned, the
dedupe can treat a time-shifted but otherwise identical radar as unchanged.
