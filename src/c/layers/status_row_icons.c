#include "status_row_icons.h"
#include "faded_pixel.h"

// Not built on aplite: its lean status row (status_row_aplite.c) draws bit masks.
#if !defined(PBL_PLATFORM_APLITE)

#include "status_pixel_icons.generated.h"

// Every status icon is drawn once for every height a bar draws it at (scripts/pixel-icons/README.md),
// and built in its version: the pixel drawing, 1 px lines through pixel centres that stay crisp
// under antialiasing, or the old icon or a line drawing, whose slanted lines antialiasing smooths
// with grey pixels on the colour watches (the black and white ones draw the old icon as it is and
// a line drawing's pixels). Drawn 1:1, nothing is scaled; each drawing carries its size and seat
// (status_icon_size.h). Its faded pixels are commands marked by their fill (faded_pixel.h), in
// whatever order costs the file fewest bytes: each command is painted by its own mark.

// The drawing's own lines in the ink; a faded pixel shaded between the paper and the ink on the
// colour watches, hidden on the black and white ones.
static bool paint_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    const StatusPaint *paint = context;
    const int thirds = faded_pixel_thirds(gdraw_command_get_fill_color(command));
#if defined(PBL_COLOR)
    gdraw_command_set_stroke_color(command,
        thirds ? faded_pixel_shade(paint->ink, paint->paper, thirds) : paint->ink);
#else
    gdraw_command_set_stroke_color(command, paint->ink);
    if (thirds) { gdraw_command_set_hidden(command, true); }
#endif
    return true;
}

static void paint_drawing(GDrawCommandImage *image, StatusPaint paint) {
    gdraw_command_list_iterate(gdraw_command_image_get_command_list(image), paint_cb, &paint);
}

// A pixel drawing painted in the theme's paint. Its bounds are one less than its box, the
// convention the seat (status_icon_size.h status_icon_top_y) and the text gap are built on; the
// generator writes the box, as wide as the ink, as the image's own bounds.
static GDrawCommandImage *icon_load_pixels(uint16_t resource_id) {
    if (resource_id == 0) { return NULL; }
    GDrawCommandImage *image = gdraw_command_image_create_with_resource(resource_id);
    if (!image) { return NULL; }
    paint_drawing(image, status_paint_theme());
    GSize size = gdraw_command_image_get_bounds_size(image);
    gdraw_command_image_set_bounds_size(image, GSize(size.w - 1, size.h - 1));
    return image;
}

GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h) {
    if (target_h <= 0) { return NULL; }
    return icon_load_pixels(status_icon_drawing(s_status_pixel_icons, STATUS_PIXEL_ICON_COUNT, icon_id,
                                                status_icon_rows(target_h)));
}

void status_row_icons_draw(GContext *ctx, GDrawCommandImage *image, int16_t x, int16_t cap_cy,
                           StatusPaint paint) {
    const StatusPaint theme = status_paint_theme();
    const bool repaint = !gcolor_equal(paint.ink, theme.ink) || !gcolor_equal(paint.paper, theme.paper);
    if (repaint) { paint_drawing(image, paint); }
    GSize size = gdraw_command_image_get_bounds_size(image);
    gdraw_command_image_draw(ctx, image, GPoint(x, status_icon_top_y(cap_cy, size.h)));
    if (repaint) { paint_drawing(image, theme); }
}

void status_row_icons_destroy(GDrawCommandImage *image) {
    if (image) { gdraw_command_image_destroy(image); }
}

#endif
