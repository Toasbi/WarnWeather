# The graph's colours are derived built-ins with per-polarity overrides

Every colour the forecast graph paints (the two metric lines, the area fill and the four night
colours) is resolved by `src/pkjs/forecast-graphs/domain/line-style.js` from the settings blob alone, packed into one
Clay tuple, and read back by `src/c/layers/forecast_layer.c`. This document is the design log
for that model.

The code keeps only the invariants an editor must not break. This document holds the reasoning:
why the built-ins are derived instead of listed, why the night tint cascades at resolve time,
and which trade-offs were accepted without a fix.

## Decision

- A graph colour is stored per (scope, role, polarity) under a concrete key. There is no "auto"
  sentinel.
- The built-in for every key is derived from the three colour resolvers the renderer already
  uses. It is never transcribed into a second table.
- Whether the user has moved a colour off its built-in is answered by comparing against the
  derived built-in. No stored marker value says so.
- The night fill tint cascades from the metric's fill colour at resolve time. The settings page
  never writes one key on behalf of another.

## 1. The key vocabulary

`gc` + metric slug + role + polarity: `gcPrecipLineDark`, `gcNightHatchLight`. Built by
`graphColorKey(scope, role, suffix)`.

- scope: a metric id from `GRAPH_METRICS`, or the pseudo-scope `'night'` for the full-height
  band.
- role: `Line` / `Fill` / `Night` for a metric; `Hatch` / `Boundary` for `'night'`. `Night` is
  the night fill tint, the base of the area pair.
- polarity: `Dark` / `Light`, read off the folded theme so an aplite install never looks up a
  Light colour it cannot paint.

Slugs exist because the ids are snake_case wire values and `gcPrecip_probLineDark` reads badly.

There are 42 keys: six metrics × three roles × two polarities, `feels`' Line pair, and the night
band's two pairs. `feels` is Line-only. It never fills (§6), so a Fill or tint row would offer a
colour nothing can paint.

Both polarities are stored independently and reset together. Leaving the hidden one tuned would
bring old picks back on the next theme switch.

## 2. Why there is no sentinel

Using `''` to mean "auto" is rejected because the settings page has nowhere to show an absent
value: `hydrate()` seeds every schema key and the save flattens the whole blob, so "unset" does
not survive a save anyway. A concrete stored value with a derived comparison is the model that
matches this config UI.

The cost is that a colour deliberately picked equal to its built-in reads as untouched. That is
accepted: the two paint identically, so nothing is visibly wrong, and the only consumers of the
distinction are the wire's opt-in bit (§4) and telemetry's `default` vs `#RRGGBB` report.

## 3. Built-ins are derived, never transcribed

`graphColorDefault(scope, role, suffix, settings)` asks:

| role | source |
|---|---|
| `night` / `Hatch`, `Boundary` | `NIGHT_HATCH_DEFAULT`, `NIGHT_DAY_LINE_DEFAULT` |
| metric / `Night` | `nightAreaColorsFor(scope, null).base` |
| metric / `Fill` | `fillColorFor(scope, true, theme)` |
| anything else | `lineColorFor(scope, settings, true, theme)` |

A literal table of built-ins beside these resolvers is rejected. It would be a second source of
truth for values the module computes, and a test comparing each cell against the resolver that
produced it reduces to `assert.equal(f(x), f(x))`, which cannot fail.

The appearance contract lives in the test, as 40 literal expected constants
(`test/line-style.test.js`). There a literal table does its job, which is to fail when a
built-in moves. It does not belong in production, where its only job would be to agree with
code twenty lines away.

`suffix` alone names the theme because this is the colour arm: `renderContextFor` reports
`isColor` true only for `dark` and `light`, so `Dark ↔ 'dark'` exactly.

### Totality

`graphColorDefault` is total over scopes and roles. An unknown scope (`thirdLine`'s `'off'`, or
a blob with no `secondaryLine`) falls through to `lineColorFor`, which answers the theme
foreground. No caller needs a `||` fallback, which matters because `GColorBlack` is `0x000000`
and therefore falsy. Prefer `hasOwnProperty` over truthiness when testing for a light-theme
override.

Known hole, unreached: the `LINE_COLORS` / `FILL_COLORS` / `NIGHT_AREA_COLORS` lookups are bare
object literals, so an `Object.prototype` name (`'toString'`, `'constructor'`) answers truthy and
resolves to `undefined`. No code reaches it: every scope comes from `GRAPH_METRICS`, `'night'`,
or a metric picker. Closing it means own-key guards in all three lookups.

## 4. The night tint cascades at resolve time

The watch paints the night band opaquely over the filled area (`chart.c`'s `has_underlay` loop
strokes from the curve down to the axis), so the tint replaces the day fill for the night hours
instead of shading it. A tint left on its built-in while the fill moved would paint over a
colour the user chose with one they never chose.

Solving that in the settings page, by copying each new fill colour into the sibling tint key, is
rejected. A page-side write makes a carried tint and a deliberately chosen one the same bytes,
so nothing downstream can tell them apart. A tint picked equal to its fill would read as
untouched: on the light polarity the night re-shade would be silently skipped, and telemetry
would report `default` for a colour the user had chosen.

The cascade lives in `graphNightTint(settings, metric, suffix)`:

```
claimed  — the tint key is off its built-in        -> that colour
carried  — the tint is built-in but the fill isn't -> the fill's colour
built-in — neither has moved                       -> null
```

It returns `null` instead of the base on purpose: `nightAreaColorsFor` answers `null` with the
hand-tuned pair verbatim, while a concrete base runs the derive recipe (§5).

A stored tint means exactly one thing, that someone picked it, so `graphColorIsPicked` is
`!graphColorIsDefault`, and the settings page is a pure editor.

### The upgrade migration

A stored blob can hold carried bytes: a tint key equal to its fill, written by a page-side copy.
Read as a pick, they would flip the wire bit and freeze the cascade on a stale colour.
`migrateCarriedGraphNightTints` (`src/pkjs/settings/domain/migrations/graph-colors.js`, marker
`v1.15.1_carried_graph_night_tint_migration`) clears a stored tint that still equals its stored
fill; the resolver then re-derives the triple with the flag clear.

Two accepted imprecisions:

- A tint set equal to its fill by hand is cleared too. The two cases cannot be told apart, and
  they paint identically, so clearing preserves appearance.
- A carried fill equal to the metric's own built-in fill colour sits in the tint key, where it is
  not that metric's night built-in, so it derives a lightened triple. With the tint cleared, the
  hand-tuned triple stands instead. The flag stays 0 and the result is what a fresh install with
  those settings paints.

### Re-tuning a built-in needs a migration of its own

Concrete storage (§2) has a cost that is easy to miss: **moving a built-in reaches nobody who is
already installed.** `seedDefaults` writes a real colour into every key, so after a re-tune the
stored value is the old default, which does not equal the new one. `graphColorIsDefault` calls it
a pick and the old colour keeps winning until every row is reset by hand.

`migrateLightGraphColorRetune` (`src/pkjs/settings/domain/migrations/light-theme.js`, marker
`v1.16.0_light_graph_color_retune_migration`) rewrites, cell by cell, each cell still holding the
value the page seeded for a superseded light built-in, so a colour that is neither the old
default nor the new one (someone's actual choice) survives. Its `SUPERSEDED_LIGHT_GRAPH_COLORS`
is a frozen record and must never be re-derived from `line-style.js`, because the built-ins have
moved away from it. Any future re-tune needs its own frozen table and its own marker.

Two rules the code carries comments about:

- It runs after `migrateCarriedGraphNightTints`. A carried tint holds the fill's colour, so the
  release detects it by `night === fill`. The re-tune rewrites the Fill cell but not the Night
  cell, which breaks that equality. Run second, the release cannot see the carry, and the stale
  colour survives as a fake pick.
- It always asks for the Clay resend and never marks itself done; the marker rides the ACK.
  "Nothing left to rewrite, so mark done" cannot be told apart from "saved, then NACKed", and
  that shortcut strands the install on the old colours until someone opens and saves the
  settings page.

## 5. The night area pair

For the dark polarity: hand-tuned `{base, hatch}` pairs, keyed by metric (`NIGHT_AREA_COLORS`).
Keying on the day fill colour with `gcolor_equal` would send an unlisted metric, and every custom
fill pick, down a fall-through that renders precip-blue.

For an arbitrary pick the pairs cannot cover, `nightAreaColorsFor` derives one with
`deriveNightPair`: the hatch one Pebble level above its base (`lighten`). The built-ins were not
made with this recipe. Feed their bases back through it and precip, wind, uv and pressure come
out different (they keep a saturated channel at `0x00` instead of lifting it). The built-ins stay
verbatim; the recipe exists only for picks, where a plausible member of the same family beats a
matching one.

For the light polarity: a base per metric (`NIGHT_AREA_LIGHT_BASE`), whose hatch comes from
`deriveNightPair`. The asymmetry is deliberate and comes from how the light bases were made. The
five light bases were tuned on hardware in the light theme by picking them in the settings sheet,
as stored tints, which is the path that derives. Deriving therefore reproduces what was signed
off; a hand-written pair here would repaint it. A metric absent from the light table (only
`feels`, which never fills) keeps its dark pair in both polarities.

Both tables are read through the same `nightAreaColorsFor(metric, tint, theme)`, and the "tint
equals the built-in base" short-circuit compares against the base of the polarity in hand.
`NIGHT_AREA_COLORS` entries are handed back by reference, so they are kept as pure pairs: an
extra key on one would ride out into a caller's result.

`colorPick` snaps every stored value onto the Pebble-64 grid at the parse boundary, so
`lighten`'s level arithmetic is exact. The snap changes no pixel (`rgbToGColor8` reduces both
forms to the same `>> 6` level); it only affects the numbers this module reasons over.

## 6. Per-metric colour choices

Line colours claim distinct hues so two lines never read as one: precip owns blue, uv magenta,
wind yellow, pressure orange, gust the greys, cloud a grey-blue.

- uv on the light polarity is Purple, not ImperialPurple. ImperialPurple is one Pebble level per
  channel off black, and the light theme's solid rain bars paint `GColorDarkGray`
  (rain-tier.js), so a near-black line crossing dark grey bars puts two dark values side by side.
  Purple keeps the same hue at a level the bars cannot swallow. It also widens the gap from
  precip, which owns the neighbouring blue and is the other half of the default line pair.
- gust takes the achromatic slot so it never reads as a rain bar. That makes it the one built-in
  that depends on another live setting: it must dodge whichever grey the bars use, so
  `lineColorFor` reads `rainBarColor`. `graphColorIsDefault` therefore accepts either grey (White
  with multicolour bars, LightGray with solid white ones) as still the built-in, so a solid-bar
  install seeded with White keeps resolving through `rainBarColor` instead of painting white on
  white. The cost: this one row cannot be deliberately pinned.
- feels shadows the 3px temp curve, so it stays achromatic and dimmer than any hue: LightGray on
  dark, Black on light (a grey at 1px on white is barely visible, and DarkGray is what the
  white-bar mode paints its bars in a light theme). It never fills. Every other metric maps
  `0..max`, so the area under the line is the area above a real zero, while feels rides the
  temp∪feels band, whose floor is just the coldest value on the plot. A fill there would flood
  the plot and swallow the temp curve feels is meant to be compared against.
  `resolveGraphColors` is the authoritative gate, so a stored fill toggle for feels still cannot
  turn it on.
- pressure's orange reads close to wind's yellow at 1px on dark. It is also the one metric with
  no light line variant: Orange holds on white as it is.
- cloud sits between precip's blue and the greys: BabyBlueEyes on dark, Liberty on light, so a
  cloud line next to a rain-chance line still reads as two. Its dark night pair (OxfordBlue /
  Liberty) happens to be the derive recipe's own output, so a pick of its base reproduces it
  exactly. Its most common use is the stripe style. A stripe cell's tint blends from the
  background toward the line colour per 2-bit channel (`chart_stripe.h`), and with only four
  levels per channel, neighbouring tints can round to the same colour (a light ground toward a
  dark line) or alternate hue (grey vs. blue). So the level is carried by full-colour vertical
  lines over the tint, every 5th, 3rd and 2nd pixel column, then solid, which stay distinct on
  any colour whatever the tints round to. Level 1 also drops the tint (background only), so it
  stands clearly apart from level 2.
- Light-theme variants: fills and night bases take a brighter tint of the hue (the dark shades
  read too heavy on white), and lines take a darker step. That is the shape the values have, not
  a formula. Every light cell was tuned metric by metric on hardware in the light (alpha) theme,
  and they do not sit at a uniform distance from their dark counterparts. Do not "restore
  symmetry" with a dark neighbour or re-derive one from a recipe. Note that `0x55FFFF` is
  `GColorElectricBlue`; the constant named `GColorCyan` is `0x00FFFF` and is precip's light night
  base.

## 7. The wire

Fourteen bytes on `CLAY_LINE_STYLE_UINT8` (the head and night tail below, then the blocks in
"The style tail and Draw from"), on the Clay settings message. These values are settings-derived,
never weather-derived, so under `AGENTS.md`'s message-boundary rule they must not ride every
weather send. One array tuple is also the cheap shape: four scalar tuples would cost 44 B.

```
[0] main line   [1] area fill   [2] second line   [3] line flags (bit 0 = fill on)
[4] night hatch [5] day line    [6] area base     [7] area hatch
```

Bytes `[4..7]` are byte-for-byte the watch's `NIGHT_COLORS` persist blob (`persist.h`,
`NIGHT_COLOR_BYTES = 4`); `app_message.c` stores the tail straight through with no repacking.

Growing the tuple: `LINE_STYLE_BYTES` is a minimum length. Append a new block with its own
`length >= offset + size` check; widening the minimum would start rejecting shorter tuples.
Removing a byte moves the blocks after it, which is safe only because the phone and watch ship
in one `.pbw`.

The tuple carries no "tint is a pick" flag. Nothing on the watch needs one, since light has its
own tuned arm (§5). Telemetry takes "is this a pick?" from `graphColorIsPicked` directly. A
six-byte `NIGHT_COLORS` blob stored by an older build still reads: its first four bytes are this
layout.

### No B&W arm in the night tail

Every one of these bytes reaches the render through `theme_pick(colour_arm, bw_arm)`, and the
underlay through `has_underlay = !theme_is_bw()`. A B&W watch or a bw/bw-light theme discards all
four and paints `theme_fg()` over a LightGray underlay from its own constants. A "B&W-honest" set
would be bytes no watch reads.

Accepted consequence: on a bw theme these bytes carry whatever the user picked for that
polarity. That is expected: they describe colours this render mode ignores.

### The style tail and Draw from

Two more tail blocks follow, each behind its own length check as the growth rule above asks:
`[8]` the third-metric line colour, `[9..11]` the per-line style bytes (byte-for-byte the watch's
`LINE_STYLES` persist blob), `[12]` the fourth-metric line colour and `[13]` its style byte
(`FIFTH_LINE_STYLE`). `buildLineStyleBytes` (`forecast-graphs/domain/graph-wire.js`, the phone-only packer of
the graph's Clay tuples) carries the full layout, and `persist.h`'s `LINE_STYLES` comment the
canonical layout of a style byte. The watch parses `[8..13]` only under `WW_LINE_STYLE`, so
aplite ignores them.

A style byte packs `kind | (field << 2)`: the kind (0 to 3) in bits 0 to 1, the field (a solid
line's width, a stripe's edge) in bits 2 to 4. The encoder never reaches bit 5 (its largest bytes
are `0x0C`, bold, and `0x07`, stripeTop), so Draw from: Top rides there. Bit 5 (`0x20`;
`graph-wire.js` `LINE_BIT`, `persist.h` `LINE_STYLE_FROM_TOP`) of `[9]`, `[10]`, `[11]` and
`[13]` says that line hangs from the plot's top: its stroke or marks and, for the Main metric,
its Area fill with it. Bit 6 (`FLOAT_BIT`, `persist.h` `LINE_STYLE_FLOATING`) marks a drawn line
that anchors no edge (pressure, feels-like, dew point); bit 7 is reserved at 0. `draw-from.js` is
the reading behind both bits.

- The decode is kind-aware (`line_style_top_edge`). A stripe keeps its own edge in the field's
  low bit, bit 2; every other kind reads bit 5. Bit 2 is a solid line's width (`0x04` thin,
  `0x0C` bold), so reusing the stripe decode would hang every solid line. The phone never sets
  bit 5 on a stripe byte, or for aplite (`computeEnv` → `lineStyles: false`), whatever is
  stored.
- No storage of its own. `[9..11]` are stored verbatim and `[13]` as an int, so a flip changes
  the stored value, dirties the forecast and repaints it.

**Bars from: Top cannot ride in this tuple.** `handle_line_style` dirties only the forecast, so a
radar flag here would not repaint the radar. Each chart's bar flag sits in its own palette blob
instead, `BAR_PALETTE_UINT8` and `RADAR_PALETTE_UINT8` (3 B per stop, `[from_lo, from_hi,
GColor8]`, `rain-tier.js` `packPalette`): bit 7 (`0x80`; `graph-wire.js` `PALETTE_BIT`) of byte
`[1]`, stop 0's `from_hi`. Every palette starts at `from = 0`, so that byte is otherwise always 0.
The flag turns stop 0's threshold negative, which the watch reads as `palette_from_top()`
(`stops[0].from < 0`): no mask, no persist key, and the palette's own change compare dirties
exactly the chart the flag belongs to.

This is the one implicit coupling of the feature. Every reader of `ChartColorStop.from` clamps a
stop below the floor, so a reader that ignores the flag (an older watch build, say) still draws
the bars standing; a new consumer of `.from` must clamp too. `palette.h`, `chart.h` and
`rain-tier.js` say so, and `test/c/chart_flip_test.c` pins the flag.

Both flags are settings-derived and leave the weather bake alone, so the six Draw from / Bars
from keys (`draw-from.js`) stay out of `renderSignature`: a flip is a Clay-only resend. With
every key on Bottom, absent, or on aplite whatever is stored, no flag bit is set in any of the
three tuples. The flags take no bytes of their own, so they cost the Clay budget nothing.

## 8. One render context, three consumers

`renderContextFor(settings, caps)` is the single authority on what this watch is actually
rendering. Derived separately, the wire packer and the telemetry snapshot diverge: a telemetry
copy of the theme fold without the colour-platform half reports a diorite install's picks that
the wire resolves away to white.

- `theme` is the folded theme. aplite has the light polarity compiled out (`theme.h` pins
  `theme_is_light()` false), so resolving off `settings.theme` would send black lines to a black
  background.
- `isColor` is the effective colour flag: colour hardware renders as colour only when the theme
  isn't Black & White.
- `suffix` is the polarity half of every key name, derived from the folded theme so the pick
  that is read is the pick that is painted.

Every caller describes the target by its capabilities. The phone passes config-ui's
`computeEnv(watchInfo)` for the connected watch: `forecast-graphs/domain/graph-wire.js` packs
`resolveGraphColors`' answer and telemetry reads `renderContextFor`'s. The settings page passes
the env of the platform it previews. The preview and the wire run one resolution, and no adapter
stands between a watchInfo and it.

This is also why `line-style.js` is dual-context: a CommonJS module on the phone and in the
tests, and a plain concatenated `<script>` in the settings-page webview, which has no
`require()`. `pebble-colors.js` and `resolve-ink.js` must precede it in the bundle. The wire half
(the packing, `rain-tier.js`' `GColor8` conversion and the platform table) stays out of it, in
the phone-only `forecast-graphs/domain/graph-wire.js`, so the page bundle carries no code it cannot run.

## 9. Displaying a derived value

Because the tint cascades at resolve time, its stored key sits on the built-in while the graph
paints the fill's colour. The settings page must show what is painted, or the picker
contradicts the watch.

`engine.js`' `displayFrom` / `PConf.displayResolvers` does this: an item paints what its named
resolver returns while storing under its own key. Writes are untouched, so picking the shown
colour pins it, which is the right meaning for that gesture. The row badge dot uses the same
helper.
