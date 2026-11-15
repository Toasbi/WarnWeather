#include "status_row_icons.h"
#include "../appendix/theme.h"

// Not built on aplite: its lean status row (status_row_aplite.c) draws bit masks.
#if !defined(PBL_PLATFORM_APLITE)

#include "status_pixel_icons.generated.h"

// Every status icon is drawn once for every height a bar draws it at (scripts/pixel-icons/README.md),
// and built in its version: the pixel drawing, 1 px lines through pixel centres that stay crisp
// under antialiasing, or the old icon or a line drawing, whose slanted lines antialiasing smooths
// with grey pixels on the colour watches (the black and white ones draw the old icon as it is and
// a line drawing's pixels). Drawn 1:1, nothing is scaled; each drawing carries its size and seat
// (status_icon_size.h).

static bool pixel_ink_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    gdraw_command_set_stroke_color(command, *(const GColor *)context);
    gdraw_command_set_fill_color(command, GColorClear);
    return true;
}

// A pixel drawing in `ink`. Its bounds are one less than its box, the convention the seat
// (status_icon_size.h status_icon_top_y) and the text gap are built on; the generator writes the
// box, as wide as the ink, as the image's own bounds.
static GDrawCommandImage *icon_load_pixels(uint16_t resource_id, GColor ink) {
    if (resource_id == 0) { return NULL; }
    GDrawCommandImage *image = gdraw_command_image_create_with_resource(resource_id);
    if (!image) { return NULL; }
    gdraw_command_list_iterate(gdraw_command_image_get_command_list(image), pixel_ink_cb, &ink);
    GSize size = gdraw_command_image_get_bounds_size(image);
    gdraw_command_image_set_bounds_size(image, GSize(size.w - 1, size.h - 1));
    return image;
}

GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h) {
    if (target_h <= 0) { return NULL; }
    return icon_load_pixels(status_icon_drawing(s_status_pixel_icons, STATUS_PIXEL_ICON_COUNT, icon_id,
                                                status_icon_rows(target_h)),
                            theme_fg());
}

void status_row_icons_destroy(GDrawCommandImage *image) {
    if (image) { gdraw_command_image_destroy(image); }
}

#endif
