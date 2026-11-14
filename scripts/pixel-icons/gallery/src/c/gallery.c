// The icon gallery (build_picker.py): every drawing of a batch at 1:1, page by page, on the
// watch's own renderer, for the picker's pictures. A drawing is drawn the way the watchface
// draws a status icon: its strokes recoloured to the ink, smoothing on, at a whole pixel.
// Pages show their cells in the dark theme (white on black) or the light one (black on white).
// SELECT turns the page; each page logs "drawn <n>" once it is on screen.
#include <pebble.h>
#include "cells.h"   // generated: PAGE_COUNT, s_page_light[], CELL_COUNT, s_cells[]

static Window *s_window;
static Layer *s_layer;
static int s_page;

static bool recolour(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    gdraw_command_set_stroke_color(command, *(GColor *) context);
    return true;
}

static void update_proc(Layer *layer, GContext *ctx) {
    bool light = s_page_light[s_page];
    GColor ink = light ? GColorBlack : GColorWhite;
    graphics_context_set_antialiased(ctx, true);
    graphics_context_set_fill_color(ctx, light ? GColorWhite : GColorBlack);
    graphics_fill_rect(ctx, layer_get_bounds(layer), 0, GCornerNone);
    for (int i = 0; i < CELL_COUNT; i++) {
        if (s_cells[i].page != s_page) { continue; }
        GDrawCommandImage *img = gdraw_command_image_create_with_resource(s_cells[i].res);
        if (!img) { continue; }
        gdraw_command_list_iterate(gdraw_command_image_get_command_list(img), recolour, &ink);
        gdraw_command_image_draw(ctx, img, GPoint(s_cells[i].x, s_cells[i].y));
        gdraw_command_image_destroy(img);
    }
    APP_LOG(APP_LOG_LEVEL_INFO, "drawn %d", s_page);
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
    (void) recognizer;
    (void) context;
    s_page = (s_page + 1) % PAGE_COUNT;
    layer_mark_dirty(s_layer);
}

static void click_config(void *context) {
    (void) context;
    window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

static void window_load(Window *window) {
    Layer *root = window_get_root_layer(window);
    s_layer = layer_create(layer_get_bounds(root));
    layer_set_update_proc(s_layer, update_proc);
    layer_add_child(root, s_layer);
}

static void window_unload(Window *window) {
    (void) window;
    layer_destroy(s_layer);
}

int main(void) {
    s_window = window_create();
    window_set_click_config_provider(s_window, click_config);
    window_set_window_handlers(s_window, (WindowHandlers) { .load = window_load, .unload = window_unload });
    window_stack_push(s_window, false);
    app_event_loop();
    window_destroy(s_window);
    return 0;
}
