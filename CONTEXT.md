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
| App notices | release toast | news, update check, feature tips | news panel, new-features card | `news` |
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
the layout module reads them. On the watch the struct and its tier vocabulary live in
`src/c/appendix/view_spec.h`, below the layers that read them too; the decode and the geometry
are `src/c/windows/layout.c`.

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
(the `CORE_KEY_LIST` rows in `src/c/appendix/config_wire.c`). The chain is the category detector: it tells a
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
config-close chaining, the day-change resend and the minute tick. The tick resends a
NACKed settings message after 1, 2, then every 4 minutes until a settings ACK, so settings
saved while the watch was out of reach arrive at most 4 minutes after it answers again. A
NACKed status re-send is owed again and backs off the same way (`nack-backoff.js`). The
outbox decides what is sent (dedupe, one-message bundling, ACK-gated cache commit).
_Avoid_: send queue.

**Ride-along (outbox)**:
Fresher values a weather message takes along once it goes out anyway, for bytes and never
a wake-up of their own (`outbox.js` setRideAlong). The phone battery's is its exact
reading (`phone-battery.js` statusRideAlong).

**Shown reading (phone battery)**:
The phone's charge as the watch was last sent it: what a weather fetch's bake shows, so
the charge drifting inside its 5-point bucket changes nothing by itself. A bucket move and the
ride-along make the exact reading the shown one; so does the first reading after a PKJS restart
when it lands in another bucket (`phone-battery.js` readShown). The reading comes from the Pebble
app's Phone plugin, or from the Android WebView's battery API where the app has no plugins.

**Look (battery slots)**:
How a battery slot draws, the first row of the dialog its slot's Edit button opens
(`slot-text.js` batteryLook, phoneBatteryLook). The Watch battery's has the weather
condition's three options: the battery the watch draws and its charge as text after it
(Icon + text), the text alone (Text) or the battery alone (Icon). The Phone battery's has two:
the phone's icon before its charge (Icon + text), or the charge alone (Text). The Phone
battery's Look is each slot's own setting, like a countdown's date, so two slots can differ,
and each slot opens a Phone battery dialog of its own (`status-line-catalog.js`
phoneBatterySheet); the Watch battery's Look is the item's, so every slot that holds it shows
it alike, at an edge slot's bytes (the watch keeps one mark of its days). One slot
item each: the bake picks the wire kind or the icon id by the Look (`status-lines.js`
packLine, iconFor; the Watch battery's Icon + text is its text's kind with the id of the
battery the watch draws, `status_line.h` STATUS_ICON_DRAWN_BATTERY).
_Avoid_: battery percentage slot, phone battery (no icon), which were items of their own
until 3.3.0.

**Plugin read**:
Reading a value another app's plugin serves for a status slot: the watch battery's days left
and the Plugin value. Once at a time, never subscribed, since the Pebble app would run the
plugin's script again at every refresh interval for as long as anything were, and every run
brings back the permissions that app asked for and the user has not answered. Each slot's
reader says when the next read is due; the rest is one schedule (`plugin-read-schedule.js`):
the record of the last read, stamped as the read starts and kept in storage, so neither a
restart nor a settings save reads again before the next is due, though a save after the first
read that failed does; a read at once when another source is picked or a value no slot wanted
is wanted again, though a Plugin value whose bar the watch is not sent keeps its read and its
value while a slot picks it; one read at a time; inside the Night battery saver's window only the read a save asks
for, with none before it or after the first that failed; sooner after a failure, and at the
next tick, once, after a save's read that timed out or failed without a reason; and the value
last heard, kept, with the watch owed a status send when what the slot shows of it changes and
at a start while it shows one. The next tick pays it; when a save asked for the read, two
seconds after the answer, inside the Night battery saver's window too. A read takes the first
answer that brings the value asked for; one without it is the answer only after a few seconds
without a fuller one, since a built-in plugin of the Pebble app answers with what the phone
knows at once and with the rest as it comes in (`plugin-reader.js` readOnce).
_Avoid_: poll, fetch (a fetch is the weather's).

**Days left (watch battery)**:
What the Watch battery's text (its Text and Icon + text looks) can show in place of the
percentage, or beside it: the days the watch has left, an estimate the Muninn app makes at
its watch app's wakeups, every 6 hours, and serves as a plugin of the Pebble app.
`battery-estimate.js` reads each estimate once (a plugin read), about 20 minutes after the
wakeup that makes it, worked out from the time Muninn stamped on the estimate before
(`estimate-reads.js`): about four reads a day. Never more, since every read runs Muninn's
plugin script, and while it runs the Pebble app brings back the permissions Muninn asked for
that the user has not answered. Switching the days on reads at once; a restart or a settings
save reads nothing before the next read is due. The phone bakes Muninn's figure into the
slot as it was made and drops it once it is a day old (`battery-days.js`, the one live kind
that carries text). It never counts the figure down, since the watch takes any change of the
text for a new estimate. Beside the percentage it bakes the pair's separator and the place
of the percentage too (the percentage mark), since only the watch knows its charge of the
moment. The watch shows the days only while they can be current: the phone in reach, the
watch not charging, and not charged since the days arrived (`status_row.c`
shows_battery_days). Otherwise the slot shows the percentage alone. For the last of the
three the watch keeps a mark of the carried text and the lowest charge since it arrived
(`status_line.h` StatusBatteryDaysMark): an estimate from before a charge stays hidden until
another one arrives, after Muninn's next wakeup and the read that follows it, up to about six
and a half hours (longer when that read falls in the Night battery saver's window). A new
estimate is owed to the watch, not sent at once: the re-bake's next tick sends it
(`status-rebake.js` oweStatus).

**Plugin value (status slot)**:
A slot item that shows one value another app's plugin serves, such as the Phone plugin's
network type. Each slot that holds it has a dialog of its own, which picks the plugin, which of
its values and how often it is read (`plugin-values.js` pickOf, sourceOf, everyMs), so each slot
can show another value; the slots that pick one source share its read
(`plugin-value-source.js`). The dialog lists what the phone's plugins serve, from
`Pebble.enumeratePlugins()`, which runs no plugin (`plugin-value-list.js` listOf): each
property a source declares as a text, a timestamp, a number or a boolean, of a source this app
may read without being asked for a permission it never declared (judged by the Pebble app's
keys: Internet for each domain on its own, and never a permission another app's plugin defines:
`plugin-reads.js` declares) and that does nothing when it is read (Find My Phone rings the
phone: `plugin-reads.js` actsWhenRead), of any plugin but this app's own. The Pebble app's
Preferences plugin is listed as Complications, right after None, with the user's complications
in place of values of its own (Complication). The value is a plugin read, after each Updates
interval or once the plugin's own word on when it has something new runs out
(`plugin-value-source.js`, `plugin-value-reads.js`); picking a source reads at once. What a read
brings is the value's reading: the shapes the plugin answers in that the slot prints, a short
text, a moment, a number with its unit, a state and a long text, each of them or none
(`plugin-reader.js` readingOf). The moment is a timestamp's, or a number's whose name says it
is one (ends in At, Time, _at or _time) and that counts epoch seconds or milliseconds, as
Muninn's updatedAt does (`plugin-value-reads.js` momentOf). The slot's Look (its dialog's Look
row) prints the text alone, where a slot starts, with an icon id that loads no drawing
(`status_line.h` STATUS_ICON_PLUGIN_TEXT); the text after the icon its Icon row picks (Icon +
text); or that icon alone (Icon), which only a value the phone lists as on or off can take
(`plugin-value-list.js` onOff). Switch, Wi-Fi and Bluetooth turn with such a value and show
their off form while it is off, too old or not read; Plug, Phone and Calendar stay the same
(`plugin-values.js` iconId). With no value to show, every Look prints -- (`slotTextOf`). The text is the reading's short
text, else its moment as a clock time in the user's 12/24 h setting, as the sun slot prints
sunrise, with its date after it on another day than the one the slot is baked for ("23:10 24
Nov"; the date alone where the slot has no room for both, `slot-text.js` momentText), else its
number with its unit where the slot has room, else its state, on or off, else its long text
(`plugin-values.js` textFor). A value shows for three Updates intervals, three hours at least,
or while the plugin says it holds, twelve hours at most; then the slot shows -- (shownReading).
Not on aplite, and only where the Pebble app runs plugins.
_Avoid_: custom slot; complication, which is one of the user's in the Pebble app.

**Complication**:
One of the readings the user picks in the Pebble app for every watchface to show (its Settings
› Plugins › Complications), in five places, which the Pebble app's Preferences plugin serves
(`preferences/complications`): each place that holds one names a property of a source, and
which of its instances, read from whichever plugin the Pebble app picks for that source
(`complications.js`). The Plugin value can show one by its place. Its dialog lists the
Preferences plugin as Complications, right after None, with the complications in place of values
of its own, each by its place and what it shows ("1 · Temperature (weather)"), and one this app
may not read greyed out with why
(`plugin-value-list.js` complicationsFor): its source would ask for a permission this app never
declared, or reading it does something. None of the Preferences plugin's own readings, which
this app never reads (`plugin-reads.js` neverRead): its units are plumbing, and its weather
locations' coordinates are the user's position; a pick of one from before the complications
shows --. The phone watches the list where the slot is offered, a built-in source that sends
each change by itself, and keeps it in storage for the settings page (`complication-list.js`).
The slot reads the reading the complication at its place names: a new one there is read as the
list changes, a value of the reading the place named before is never shown for it, on the watch
or in the dialog, and an empty place shows -- (`plugin-value-source.js`).
_Avoid_: slot, for a complication's place (a slot is a status bar's).

**Short form (status slot)**:
The shorter text a slot draws where its bar has no room for its own. Two items have one. The
weather condition's is its code ("PCLDY" for Partly cloudy), which the phone bakes after the
name (`status_line.h` STATUS_TEXT_ALT_SEP). The date's is the shorter format of the list its
format falls back to, which the watch formats with the date (`date_format.h` date_format_slot):
the month names drop the year ("Nov 2026" to "Nov"), the numeric month and year take the
two-digit year ("11.2026" to "11.26"), the numeric full dates take the day and month alone
("21.11.26" and "2026-11-21" to "21.11.") and the written-out date drops its year ("21. Nov
2026" to "21 Nov"). A format with none shorter has none, and no short form is a bare day. The
row swaps a short form in before it cuts a text with an ellipsis (`status_row_layout.h`
status_row_swap_short_forms): a side slot's condition gives way as soon as any text in its row
is cut, while the date gives way only where its own text is cut, so a side slot's date keeps
its width as every side slot does. On demand takes the short form as the slot's first short
member (`status_short_text.h`), and the settings page's pictures swap in the same ones
(`preview-watch.js` swapShortForms). The Classic's lean row swaps in none: the phone sends it
the condition's code alone, and it cuts the date.
_Avoid_: abbreviation.

**Feature tip**:
One entry of the settings page's "New in this update" card: a feature the user has to switch
on, how to do it, and the dialog or tab its Show me opens (`notices/domain/feature-tips.js`).
An install is shown the tips it has not seen, kept by id (`feature-tips-seen.js`), until the
card's Got it is saved. A fresh install has seen them all.
_Avoid_: news (the server's changelog rows behind the bell), release toast (the watch's
notification after an update).

**Battery saver**:
The night window (`sleepStartHour` to `sleepEndHour`) in which the phone fetches no weather and
sends the watch no phone-battery updates and no sunrise or sunset re-bakes, so the Bluetooth
link stays quiet; what it held back goes out once the window ends, with the fetch due then
when there is one. The watch is told through `IS_SLEEPING`. It shares the Nighttime card's hours with the night theme and the
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
edge or past it, so there is no blank tail; every pitch is whole px, so every bar
and every gap is one width, and the hours past the edge are cut. How many hours show for each class,
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
`MAPPED_KEYS` (weather/domain/forecast-model.js). The adapter hands it to `adoptMapped`, which applies the
fetch options' gates and the one missing-value convention per field and writes
the instance. An adapter only maps; only adopt decides.
_Avoid_: normalized provider fields, provider instance shape.

**Reading**:
One of the fourteen parts a forecast is made of, each the mapped key one provider fills: the
three of the moment (the temperature, the feels-like and the weather condition now), then the
hourly temperature, feels-like, dew point, rain chance, rain amount, wind speed, wind gusts,
wind direction, UV, cloud cover and air pressure. Each provider computes its own feels-like
from its own hours. `src/pkjs/weather/domain/provider-readings.js` lists them, and per provider
which readings it sends (Yandex sends no dew point, wind direction, cloud cover or air
pressure; DWD no UV), the setting that holds its key, the area it covers and the requests one
fetch makes. Air quality, pollen and the rain radar are no readings: each has its own source.
_Avoid_: metric (a metric is what a graph line or slot draws), field.

**Source plan**:
What one fetch asks for, in order (`src/pkjs/weather/domain/source-plan.js`): its steps. The
Provider (the Weather dialog's first picker) is the fetch's anchor: its instance holds every reading at the end,
and the rest of the fetch (the sun events, air quality, pollen, the day records, the payload)
reads it. Its own forecast is the first step, and a fetch without it fails; it serves the
readings it sends, and a reading it lacks is a fill: it comes from Open-Meteo while the watch
draws it (a drawn reading). DWD's UV comes by Open-Meteo's UV-only request, Yandex's dew point,
wind direction, cloud cover and air pressure by one request for all four.
`src/pkjs/weather/application/fetch-sources.js` runs the steps through the source ports. The
plan also counts the calls a day it comes to while no provider fails (`callsPerDay`: each
update's requests, outside the Battery saver's window, and the UV-only fill once its answer
stops serving), which the settings page shows under the Provider and at the end of Setup › Data
sources, and the tomorrow.io budget counts its share by.
_Avoid_: provider chain, fallback provider.

**Reading pick**:
A reading's provider of its own: its row in the Weather dialog's Other sources list
(Setup › Data sources › Weather; `weatherSource<Reading>`, '' for the Provider's), where that
provider sends the reading, has its key and covers the place (`source-plan.js`
feedsOf). The list holds only the readings with a pick; Use another source adds one. A new
Provider takes back the values picked to it or left at the old one.
The Provider always serves the forecast and stays the fetch's anchor; each other provider a pick names is asked
once for its whole forecast, and the readings picked to it are laid on by time (a part:
`partSteps`, `forecast-model.js` adoptReadings). A part that fails, or whose hours do not line
up, leaves its readings the Provider's. The anchor's `feeds` name the provider each
reading came from, which the day records follow.
_Avoid_: Per reading, mixed mode, custom sources, override.

**Drawn reading**:
A reading only some screens draw that the watch draws now
(`src/pkjs/weather/domain/drawn-readings.js`): UV, the dew point, the cloud cover and the air
pressure on a forecast line the watch draws, in a status slot or as a placed alert, and the
wind direction as the wind and gust slots' arrow. The fetch asks for UV, and fills a reading
the provider lacks, only while it is drawn; the settings page names the fills by the same rule.
_Avoid_: wanted reading, used metric.

**Source ports**:
What a fetch's source plan runs through (`src/pkjs/weather/adapter/source-ports.js`): the
requests to providers other than the Provider and to Open-Meteo's fills, the forecast
snapshots, the clock and the update interval. Where the weather comes from (the reading picks,
the stored keys) rides the fetch options instead
(`source-plan.js` sourcesOf). The fetch cycle builds a set for each fetch (`shell/fetch-cycle.js`
prepareFetch) and hands it to `fetchWithCoordinates`.
_Avoid_: sources (the radar, air quality and plugins have sources of their own).

**Forecast snapshot**:
What a provider answered, kept so a fetch soon after (a start-up, a settings save) asks nobody
again (`src/pkjs/weather/domain/forecast-snapshot.js`, stored by
`src/pkjs/weather/adapter/forecast-snapshots.js`). It holds what its kind keeps of a valid
answer (a provider's whole forecast, a UV fill, or the fill of the other readings a provider
lacks), the place, the time and what the request asked for (the hours, the day maxima, the
optional series, the feels-like formula, the key's fingerprint). It keeps one per provider and
kind. A fetch reuses it for the same request at a place close by while its kind serves it: a
forecast or the other readings' fill as it was kept, for the rest of its refresh slot within
the hour it was kept in; the UV fill for a few hours, re-anchored to the hour the new forecast
starts at.
Force weather fetch drops them, and a fetch on its way then keeps nothing it asked for before.
_Avoid_: forecast cache (the Weather tab has a cache of its own), response cache.

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

**Sky rows (radar)**:
The radar graph's two thin stripes under its time axis, cloud and sun, with lightning
bolts, one cell per quarter hour (`weather/domain/radar/radar-sky.js`; Open-Meteo,
whatever the radar source). The phone asks for them once per UTC half hour, the fetches
in between re-serve that half hour's answer (after a move within the half hour, the rows
show the old place until the next one), and each sky carries ten quarter hours, one
past the window's nine, so the one the watch holds covers the window until the next
request: the outbox sends one per request at most. Only the radar graph draws them.
