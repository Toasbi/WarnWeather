// src/pkjs/status-bars/domain/known-values.js — ES5. The plugin values WarnWeather knows, by the
// vocabulary's 'category/item/property', which every plugin that serves a source shares (the
// weather plugins all serve weather/location): each one's name in the Plugin value dialog's Value
// row, and the ones it supports (SUPPORTED), which the row lists first, with the Look and the icon
// a slot starts on for each. plugin-value-page.js labelOf names every other value after its
// property, and the row lists those as raw values: the plugin's own, as it sends them.
//
// A value is supported where WarnWeather has checked what it prints, and it says something the
// watchface shows nowhere else that changes slowly enough for the slot's Updates (every 15 minutes
// at most). So not the weather WarnWeather draws itself (the forecast's temperature, condition, UV
// index, wind and sun; a weather station's own readings are not that), nor a value that changes
// by the minute (the phone's battery, the song playing), nor Muninn's days left, which the Watch
// battery slot shows. A share price is the owner's call: it shows as of the slot's last read.
//
// Dual-context: a CommonJS module on the phone (plugin-value-list.js keeps the values it supports
// ahead of the dialog's cap) and in the tests, a plain concatenated <script> in the settings page
// (scripts/build-config-page.js APP_FILES, after plugin-values.js, which it binds while its body
// runs, and ahead of plugin-value-page.js, which binds it; window.KnownValues).
(function () {
    var pluginValues = typeof require !== 'undefined' ? require('./plugin-values.js')
        : window.PluginValues;

    /**
     * The values WarnWeather supports, by 'category/item/property': each one's name, and the Look
     * and the icon a slot starts on for it (plugin-values.js LOOKS and ICON_FORMS) where they are
     * not where any slot starts (the text alone). One that is on or off and says it in words that
     * mean nothing beside the other slots ('On', 'Yes') starts on an icon that turns.
     */
    var SUPPORTED = {
        'phone/phone_state/wifi': { name: 'Wi-Fi', look: 'icon', icon: 'wifi' },
        'phone/phone_state/mobile_data': { name: 'Mobile data', look: 'both', icon: 'phone' },
        'phone/phone_state/cell': { name: 'Network type' },
        'weather/location/high': { name: 'Today\'s high' },
        'weather/location/low': { name: 'Today\'s low' },
        'weather/location/humidity': { name: 'Humidity' },
        'weather/location/precipitation': { name: 'Chance of precipitation' },
        'weather/location/cloud_cover': { name: 'Cloud cover' },
        'weather/location/precipitation_amount': { name: 'Precipitation amount' },
        'calendar/event/name': { name: 'Next event', look: 'both', icon: 'calendar' },
        'calendar/event/starts_at': { name: 'Next event\'s start', look: 'both', icon: 'calendar' },
        'muninn/stats/batteryLife': { name: 'Days per charge' },
        'muninn/stats/lastWeekRate': { name: 'Drain per day' },
        'home/home_lights/on': { name: 'Any light on', look: 'icon', icon: 'switch' },
        'home/room_lights/on': { name: 'Room lights on', look: 'icon', icon: 'switch' },
        'home/light/on': { name: 'Light on', look: 'icon', icon: 'switch' },
        'home/device/on': { name: 'Device on', look: 'icon', icon: 'switch' },
        'home/device/locked': { name: 'Device locked', look: 'icon', icon: 'switch' },
        'home/device/ambient_temperature': { name: 'Room temperature' },
        'home/device/setpoint': { name: 'Thermostat setting' },
        'weather/netatmo/temperature': { name: 'Temperature' },
        'weather/netatmo/humidity': { name: 'Humidity' },
        'weather/netatmo/co2': { name: 'CO\u2082' },
        'weather/netatmo/pressure': { name: 'Air pressure' },
        'weather/netatmo/rain_1h': { name: 'Rain in the last hour' },
        'weather/netatmo/rain_today': { name: 'Rain today' },
        'weather/netatmo/high': { name: 'Today\'s high' },
        'weather/netatmo/low': { name: 'Today\'s low' },
        'finance/stock/price': { name: 'Share price' },
        'finance/stock/day_change_percent': { name: 'Today\'s change in %' },
        // Tide works its times out itself, from the spot and the date, and its own faces mark them
        // as estimates.
        'tide/spot/next_high': { name: 'Next high tide (estimate)', look: 'both', icon: 'tide' },
        'tide/spot/next_low': { name: 'Next low tide (estimate)', look: 'both', icon: 'tide' },
        'tide/spot/state': { name: 'Tide rising or falling', look: 'both', icon: 'tide' }
    };

    /**
     * The names of the raw values WarnWeather knows, by 'category/item/property', where the
     * property's own says too little.
     */
    var RAW_NAMES = {
        'muninn/stats/daysRemaining': 'Days left',
        'weather/netatmo/battery': 'Module battery',
        'weather/netatmo/reachable': 'Module online',
        'weather/netatmo/updated': 'Measured at',
        'finance/stock/day_change': 'Today\'s change',
        'tide/spot/level': 'Tide level'
    };


    /**
     * @param {Object} table A table (SUPPORTED, RAW_NAMES).
     * @param {string} key A value's id (plugin-values.js valueId).
     * @returns {*} The table's entry for it, or null.
     */
    function entryIn(table, key) {
        return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
    }

    /**
     * @param {string} category A value's source's category.
     * @param {string} item Its item.
     * @param {string} property Its property.
     * @returns {?string} Its name, where WarnWeather knows it (SUPPORTED, RAW_NAMES), or null.
     */
    function nameOf(category, item, property) {
        var key = pluginValues.valueId(category, item, property);
        var value = entryIn(SUPPORTED, key);
        return value ? value.name : entryIn(RAW_NAMES, key);
    }

    /**
     * @param {string} category A value's source's category.
     * @param {string} item Its item.
     * @param {string} property Its property.
     * @returns {boolean} Whether WarnWeather supports it (SUPPORTED).
     */
    function supports(category, item, property) {
        return entryIn(SUPPORTED, pluginValues.valueId(category, item, property)) !== null;
    }

    /**
     * @param {string} category A value's source's category.
     * @param {string} item Its item.
     * @param {string} property Its property.
     * @returns {?{look: (string|undefined), icon: (string|undefined)}} The Look and the icon a
     *   slot starts on for a value WarnWeather supports, each where it is not where any slot
     *   starts; null for any other value.
     */
    function startOf(category, item, property) {
        var value = entryIn(SUPPORTED, pluginValues.valueId(category, item, property));
        return value ? { look: value.look, icon: value.icon } : null;
    }

    var api = { SUPPORTED: SUPPORTED, nameOf: nameOf, supports: supports, startOf: startOf };

    // Dual-context export, the tail of status-line-catalog.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.KnownValues = api;
    }
})();
