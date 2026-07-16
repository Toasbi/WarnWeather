#include "hatch.h"
#include "theme.h"

// Returns the first y >= y_start in column x where (x + y) % spacing == 0.
// Handles negative modulo so the pattern is correct for negative coordinates.
static int16_t aligned_hatch_start_y(int16_t x, int16_t y_start, int16_t spacing)
{
    int16_t modulo = (x + y_start) % spacing;
    if (modulo < 0)
    {
        modulo += spacing;
    }

    if (modulo == 0)
    {
        return y_start;
    }

    return y_start + (spacing - modulo);
}

void hatch_fill_rect_raw(GContext *ctx, GRect rect, GColor color, int stride)
{
    if (stride <= 0 || rect.size.w <= 0 || rect.size.h <= 0)
    {
        return;
    }

    graphics_context_set_stroke_color(ctx, color);

    const int16_t x_end = rect.origin.x + rect.size.w;
    const int16_t y_end = rect.origin.y + rect.size.h;
    for (int16_t x = rect.origin.x; x < x_end; ++x)
    {
        int16_t hatch_y = aligned_hatch_start_y(x, rect.origin.y, (int16_t)stride);
        for (int16_t y = hatch_y; y < y_end; y += stride)
        {
            graphics_draw_pixel(ctx, GPoint(x, y));
        }
    }
}

void hatch_fill_rect(GContext *ctx, GRect rect, GColor color, int stride)
{
    // theme_is_bw() is constant-true on B&W hardware builds (no PBL_COLOR needed to
    // gate it — see theme.h): a night-hatch/radar-hatch dot is equally hard to read
    // over an underlying fill or bar on REAL B&W hardware as it is on a color build's
    // bw theme, so this backing is not a color-only concern (unlike chart_render_area's
    // checkerboard dither, which real hardware already gets for free from its own
    // dithering and must not double up on).
    if (!theme_is_bw())
    {
        hatch_fill_rect_raw(ctx, rect, color, stride);
        return;
    }

    if (stride <= 0 || rect.size.w <= 0 || rect.size.h <= 0)
    {
        return;
    }

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
    graphics_context_set_stroke_color(ctx, color);
    graphics_context_set_fill_color(ctx, theme_bg());

    const int16_t x_end = rect.origin.x + rect.size.w;
    const int16_t y_end = rect.origin.y + rect.size.h;
    for (int16_t x = rect.origin.x; x < x_end; ++x)
    {
        int16_t hatch_y = aligned_hatch_start_y(x, rect.origin.y, (int16_t)stride);
        for (int16_t y = hatch_y; y < y_end; y += stride)
        {
            graphics_fill_rect(ctx, GRect(x, y - 1, 1, 3), 0, GCornerNone);
            graphics_draw_pixel(ctx, GPoint(x, y));
        }
    }
}
