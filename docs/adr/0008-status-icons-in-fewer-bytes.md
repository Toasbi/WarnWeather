# Status icons in fewer bytes

The watch holds a shown status icon's PDC file on its heap, so the build writes every drawing in as
few bytes as it finds. The black and white watches get files without the faded pixels they cannot
draw. This replaces two parts of [ADR 0007](0007-status-icons-draw-faded-pixels.md): a pixel
drawing's faded pixels no longer come after its own lines, and the black and white watches no
longer load them to hide them.

## Context

- A command costs 9 bytes and each of its points 4. The build drew the ink, then each shade of
  faded pixel, as greedy runs over that class's own pixels, joined where two runs shared an end.
- On basalt the heaviest run (`fixtures/heap-heaviest.json`) left 3,776 bytes of heap at its
  lowest, 832 short of the 4.5 KB floor (`scripts/check-64k-size.sh`). The redrawn icons and their
  faded pixels made 612 bytes of that peak.
- The black and white watches loaded every faded path and hid it: 7,186 bytes for the 22 basalt
  pixel drawings with faded pixels, whose ink alone takes 3,109.

## Decision

- **A path may cross the pixels a later class paints over.** Each pixel of a drawing has a class:
  its ink, or a faded pixel's thirds. The classes are drawn one after another, and a path may cross
  pixels of its own class and of the classes after it. A blank pixel, or one an earlier class
  painted, it never crosses.
- **The build tries every order of the classes** and two ways of picking runs (as long as the
  pixels let a run go, or cut to the pixels still to draw), and keeps the cheapest.
- **Paths are merged** where a straight run, or one or two corners, joins one path's end to
  another's start over pixels both may cross, the merge that saves most first, while one saves
  any. A command less saves 9 bytes and a shared end 4; each corner costs a point.
- **The build checks its result.** Drawn in order, a drawing's commands must paint exactly its
  pixels and faded pixels, or the build stops (`scripts/pixel-icons/pixel-paths.js`).
  `test/pixel-icons.test.js` reads every committed file back and paints it.
- **Kept lines that light exact pixels are written as those pixels.** An old or drawing version
  whose lines are all level, upright or at 45 degrees through pixel centres draws the same pixels
  with smoothing on or off, so the build writes it like a pixel drawing: 41 of the 85 such sizes.
  One with a sloped line keeps its lines first, as they are, and only its faded pixels are written
  this way, after them: a smoothed line's grey pixels depend on what is under them.
- **The black and white watches get a file of their own (`_BW`) where theirs differs:** a drawing
  with faded pixels, without them, and a line drawing's pixels, as before. A drawing without
  either stays one file for basalt, diorite and flint.
- **The watch does not change.** It paints each command by its own fill mark, whatever their
  order, and still hides a faded command on the black and white watches.

Considered and not chosen:

- **Sloped lines for the black and white watches.** They draw without smoothing, so one line of
  any slope lights a staircase, and fewer points would do. Their heap has room (5,836 bytes at its
  lowest on flint), and the build would have to match the firmware's line pixel for pixel. The
  colour watches smooth a sloped line, so theirs stay level, upright and at 45 degrees.
- **More ways to pick runs** (four scan orders): 88 bytes less over all drawings for four times
  the build time.
- **Painting a pixel back to the paper**, so paths could cross blank pixels: the paper differs per
  bar and in a highlight box, and the watch would need a mark it does not know.

## Consequences

- The drawings each watch holds, all sizes together: basalt 14,897 → 11,196 bytes, the Pebble
  Time 2 31,579 → 23,235, diorite and flint 14,018 → 7,536. On the colour watches the 68 pixel
  drawings went from 24,203 to 17,542 bytes, and the 41 kept drawings in exact lines from 16,594
  to 11,210. The resource packs: basalt 23,610 → 19,973 bytes, emery 43,889 → 35,545, diorite and
  flint 18,104 → 11,745.
- On the heaviest run the lowest free heap rose from 3,776 to 4,448 bytes on basalt, still 160
  short of the floor; from 5,948 to 6,972 on diorite and from 5,836 to 6,860 on flint. Every
  screenshot of those runs matches the run before the change pixel for pixel, apart from the step
  count on flint, which its emulator left at 0.
- 35 more files, 42 `_BW` drawings in all: every drawing with faded pixels on basalt has one.
  Every watch still loads one file per drawing.
- The build writes all drawings in about a second.
- A drawing's commands are no longer in class order: a faded pixel's path may come before the ink,
  and the ink may cross a faded pixel. Whatever reads the files paints them in order, as the
  watch does.
