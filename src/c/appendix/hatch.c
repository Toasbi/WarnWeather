#include "hatch.h"
#include "theme.h"

// The one dot loop behind both entry points: every column's hatch dots inside `rect`,
// each over a bg backing run when `backing` (hatch_fill_rect's B&W case).
static void hatch_fill(GContext *ctx, GRect rect, GColor color, int stride, bool backing)
{
    if (stride <= 0 || rect.size.w <= 0 || rect.size.h <= 0)
    {
        return;
    }

    graphics_context_set_stroke_color(ctx, color);
    if (backing)
    {
        graphics_context_set_fill_color(ctx, theme_bg());
    }

    const int16_t x_end = rect.origin.x + rect.size.w;
    const int16_t y_end = rect.origin.y + rect.size.h;
    for (int16_t x = rect.origin.x; x < x_end; ++x)
    {
        int16_t hatch_y = hatch_first_y(x, rect.origin.y, (int16_t)stride);
        for (int16_t y = hatch_y; y < y_end; y += stride)
        {
            if (backing)
            {
                graphics_fill_rect(ctx, GRect(x, y - 1, 1, 3), 0, GCornerNone);
            }
            graphics_draw_pixel(ctx, GPoint(x, y));
        }
    }
}

// Only chart.c's line-style extension and its colour-only area dither call the bare
// emitter; elsewhere (aplite) hatch_fill keeps its one caller and folds `backing`.
#if defined(PBL_COLOR) || defined(WW_LINE_STYLE)
void hatch_fill_rect_raw(GContext *ctx, GRect rect, GColor color, int stride)
{
    hatch_fill(ctx, rect, color, stride, false);
}
#endif

void hatch_fill_rect(GContext *ctx, GRect rect, GColor color, int stride)
{
    // theme_is_bw() is constant-true on B&W hardware builds (no PBL_COLOR needed to
    // gate it — see theme.h): a night-hatch/radar-hatch dot is equally hard to read
    // over an underlying fill or bar on REAL B&W hardware as it is on a color build's
    // bw theme, so this backing is not a color-only concern (unlike chart_render_area's
    // checkerboard dither, which real hardware already gets for free from its own
    // dithering and must not double up on).
    //
    // Fix 3's neutrality argument applies here too: a bg backing over an
    // already-bg pixel (background, or a bar/fill that happens to be bg-colored)
    // is a no-op; it only matters where the fg dot would otherwise land on fg
    // territory (an area fill, a colored bar) and vanish.
    //
    // The backing is a 1px-wide VERTICAL run (x, y-1..y+1), NOT a 3x3 square. The
    // hatch is a diagonal (dots at (x+y)%stride==0, so a dot's up-right neighbour
    // sits one column over and one row up), and columns paint left-to-right: a
    // square backing's +1 horizontal spill would repaint bg over the neighbouring
    // column's dot that was drawn a moment earlier, erasing all but the top/right
    // fringe of the diagonal (and spilling past the band's x edges too). Keeping
    // the run to the dot's own column removes both hazards while still giving the
    // dot a bg channel above/below so it reads over a fill/bar.
    hatch_fill(ctx, rect, color, stride, theme_is_bw());
}
