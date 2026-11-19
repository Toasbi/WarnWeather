# Status icons draw faded pixels

The colour watches draw a status icon's faded pixels: single pixels beside its ink, or on it,
drawn a third or two thirds of the way from what is behind the icon to its ink. They soften an
outline's steps and its small dots as smoothing softens a slanted line. The icon creator sets them
(its ADR 0024 and ADR 0029). The black and white watches draw none.

## Context

- The icon creator gives a drawing faded pixels by a rule (Fade) and by hand (touch-ups). Its
  export left them out, and only its watch test drew them, in a test app of its own.
- The owner applied Fade's Room to every icon and asked for it on the watch (2026-11-19): the
  status icons alone, not the settings page's pictures.
- A status icon is a PDC drawing. The watch paints it in the theme's foreground when it loads,
  and repaints it while it draws it in a filled highlight box (`status_highlight.c`).

## Decision

- **The file keeps them as rows.** A size's `faded` in `resources/pixel-icons.json` is rows over
  the ink the colour watches draw (its kept lines' box, else its pixels') and a pixel round it:
  `1` a third, `2` two thirds, `.` none. `gen_watch_icons.js` checks the rows against that box.
- **They are commands after the drawing's own.** Each shade's pixels are 1 px paths, joined end
  to end where they touch, as the drawing's lines are. A path's fill marks it: a colour with no
  alpha, which draws nothing, its thirds in the low two bits (`0x01`, `0x02`). Its stroke is the
  shade the dark theme draws it in.
- **The colour watches shade them whenever they paint the drawing.** `status_row_icons_paint`
  strokes the drawing's own paths in the ink and each faded one in
  `faded_pixel_shade(ink, paper, thirds)`: per colour channel,
  `(thirds × ink + (3 − thirds) × paper + 1) / 3` (`faded_pixel.h`). The paper is what is behind
  the icon (`StatusPaint`): the theme's background, a filled highlight box's colour, and under the
  Bluetooth icon's blue or red ink the bar's paper.
- **The black and white watches hide them.** The paint hides a faded path there. A pixel drawing
  stays one resource for basalt, diorite and flint; a drawing in lines keeps its `_BW` file,
  which never has them.
- **Pebble Classic and Steel draw their masks**, which have none: the build refuses faded pixels
  on a mask.

Considered and not chosen:

- **A file of its own for the black and white watches for every drawing with faded pixels.**
  They would not hold the hidden paths on their heap, but every such pixel drawing would be built
  twice.
- **The mark in the stroke**, as the creator's test app first had it. The paint sets every stroke
  when the drawing loads and again in a highlight box, so the mark would be gone after the first
  paint. The fill is never painted.
- **A list of `[x, y, thirds]`** in the file. Written with the file's indent, every number takes a
  line of its own: some 10,000 lines for the owner's 2,021 faded pixels. The rows take as many
  lines as the drawing has, and show where the pixels sit.

## Consequences

- An export of the owner's icons as they stood on 2026-11-19 gives 89 sizes 2,021 faded pixels
  (22 a size at the median, 56 at most). The drawing files grow by about 8 bytes a faded pixel, 17 KB in all, at most 505
  bytes for one drawing; the pbw by 26 KB, to 3.5 MB (the store takes up to 4.5 MB).
- A loaded icon holds its faded paths on the heap, on the black and white watches too. On the
  `box-audit` fixture's screen (five icons of box 11, in the top bar and a 14 px bar) the lowest
  free heap went from 6,952 to 6,544 bytes on basalt and from 9,100 to 8,692 on diorite. The
  twelve heaviest basalt drawings together would hold 2.7 KB more.
- The emulators read back pixel for pixel: on basalt and emery every faded pixel in the shade the
  mix gives, on the bar and in white highlight boxes, and no other pixel changed; diorite the same
  as without them.
- A faded pixel can sit a pixel outside the ink's box. Where a bar has no room for it, the bar
  clips it.
- The settings page's pictures of the watch draw the drawings without their faded pixels
  (`status-pixels.generated.js`).
- `test/pixel-icons.test.js` holds the files to the rows, and `test/c/faded_pixel_test.c` the mix.
