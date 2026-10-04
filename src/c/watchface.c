#include <pebble.h>
#include "windows/main_window.h"
#include "appendix/app_message.h"
#include "appendix/config.h"
#include "appendix/memory_log.h"
#include "appendix/persist.h"
#include "appendix/rain_countdown.h"
#include "services/watch_services.h"


static void init() {
    persist_migrate_trend_encoding();
    persist_migrate_status_line_encoding();
    MEMORY_LOG_HEAP("boot");
    app_message_init();
    config_load();
    // Prime the rain countdown's segment cache from the persisted radar before the
    // window loads, so every status row's first refresh finds it: each bar's Rain item
    // reads that cache, and after boot only a radar payload rescans it (app_message.c).
    // Only where the Rain item is built (WW_ON_DEMAND: not aplite), the same guard as
    // that rescan.
#if defined(WW_ON_DEMAND)
    rain_countdown_refresh(watch_services_now());
#endif
    main_window_create();
    MEMORY_LOG_HEAP("after_main_window_create");
}

static void deinit() {
    MEMORY_LOG_HEAP("before_teardown");
    config_unload();
    main_window_destroy();
    MEMORY_LOG_HEAP("after_teardown");
}

int main(void) {
    init();
    app_event_loop();
    deinit();
}
