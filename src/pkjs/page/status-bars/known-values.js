// src/pkjs/page/status-bars/known-values.js — ES5. The plugin values WarnWeather knows, by the
// vocabulary's 'category/item/property', which every plugin that serves a source shares (the
// weather plugins all serve weather/location): each one's name in the Plugin value dialog's Value
// row. plugin-value-page.js labelOf names every other value after its property.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings
// page (scripts/build-config-page.js APP_FILES, ahead of plugin-value-page.js, which binds it
// while its body runs; window.KnownValues). A leaf: it binds nothing.
(function () {
    /**
     * The known values, by 'category/item/property': each one's name, where the property's own
     * says too little ('Cell', 'High') or names it wrongly ('Precipitation', a chance).
     */
    var KNOWN = {
        'phone/phone_state/wifi': { name: 'Wi-Fi' },
        'phone/phone_state/mobile_data': { name: 'Mobile data' },
        'phone/phone_state/cell': { name: 'Mobile network' },
        'weather/location/high': { name: 'Today\'s high' },
        'weather/location/low': { name: 'Today\'s low' },
        'weather/location/humidity': { name: 'Humidity' },
        'weather/location/precipitation': { name: 'Chance of precipitation' },
        'weather/location/cloud_cover': { name: 'Cloud cover' },
        'weather/location/precipitation_amount': { name: 'Precipitation amount' },
        'calendar/event/name': { name: 'Next event' },
        'calendar/event/starts_at': { name: 'Next event\'s start' },
        'muninn/stats/daysRemaining': { name: 'Days left' },
        'muninn/stats/batteryLife': { name: 'Days per charge' },
        'muninn/stats/lastWeekRate': { name: 'Drain per day' },
        'home/home_lights/on': { name: 'Any light on' },
        'home/room_lights/on': { name: 'Room lights on' },
        'home/light/on': { name: 'Light on' },
        'home/device/on': { name: 'Device on' },
        'home/device/locked': { name: 'Device locked' },
        'home/device/ambient_temperature': { name: 'Room temperature' },
        'home/device/setpoint': { name: 'Thermostat setting' }
    };

    /**
     * @param {string} category A value's source's category.
     * @param {string} item Its item.
     * @param {string} property Its property.
     * @returns {?Object} The known value under them (KNOWN), or null.
     */
    function knownOf(category, item, property) {
        var key = category + '/' + item + '/' + property;
        return Object.prototype.hasOwnProperty.call(KNOWN, key) ? KNOWN[key] : null;
    }

    /**
     * @param {string} category A value's source's category.
     * @param {string} item Its item.
     * @param {string} property Its property.
     * @returns {?string} Its name, where WarnWeather knows it (KNOWN), or null.
     */
    function nameOf(category, item, property) {
        var known = knownOf(category, item, property);
        return known ? known.name : null;
    }

    var api = { nameOf: nameOf };

    // Dual-context export, the tail of status-line-catalog.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.KnownValues = api;
    }
})();
