// ES5-safe polyfills for the PKJS runtime.
//
// aplite (Pebble Classic / Steel) runs an old JavaScriptCore that predates
// ES6, so Object.assign and several Array.prototype methods are undefined.
// The bundle calls Object.assign on the weather-fetch path; on aplite that
// threw "undefined is not a function" and aborted every fetch silently.
//
// This module installs the missing methods as a side effect of being
// required, so requiring it FIRST in the entry file makes the whole bundle
// ES5-safe before any other code runs. Each polyfill is guarded so modern
// platforms (basalt/chalk/diorite/emery) keep their faster native versions.
// install() is also exported so tests can re-run it against a stripped-down
// runtime.

/**
 * Define a method on a prototype the way the engine defines natives:
 * non-enumerable so it never leaks into `for...in`, but writable/configurable.
 *
 * @param {Object} proto - The prototype to extend.
 * @param {string} name - Method name.
 * @param {Function} fn - Method implementation.
 * @returns {void}
 */
function defineMethod(proto, name, fn) {
    Object.defineProperty(proto, name, {
        value: fn,
        configurable: true,
        writable: true,
        enumerable: false
    });
}

/**
 * Install ES5-safe polyfills for ES6 methods missing on the aplite runtime.
 * Idempotent and guarded: native implementations are left untouched.
 *
 * @returns {void}
 */
function install() {
    if (!Object.assign) {
        // Non-enumerable to match the native static method shape.
        defineMethod(Object, 'assign', function (target) {
            if (target === null || target === undefined) {
                throw new TypeError('Cannot convert undefined or null to object');
            }
            var to = Object(target);
            for (var i = 1; i < arguments.length; i++) {
                var src = arguments[i];
                if (src === null || src === undefined) {
                    continue;
                }
                for (var key in src) {
                    if (Object.prototype.hasOwnProperty.call(src, key)) {
                        to[key] = src[key];
                    }
                }
            }
            return to;
        });
    }

    if (!Array.prototype.find) {
        defineMethod(Array.prototype, 'find', function (predicate, thisArg) {
            for (var i = 0; i < this.length; i++) {
                if (predicate.call(thisArg, this[i], i, this)) {
                    return this[i];
                }
            }
            return undefined;
        });
    }

    if (!Array.prototype.findIndex) {
        defineMethod(Array.prototype, 'findIndex', function (predicate, thisArg) {
            for (var i = 0; i < this.length; i++) {
                if (predicate.call(thisArg, this[i], i, this)) {
                    return i;
                }
            }
            return -1;
        });
    }

    if (!Array.prototype.includes) {
        defineMethod(Array.prototype, 'includes', function (value) {
            for (var i = 0; i < this.length; i++) {
                var item = this[i];
                // SameValueZero: treat NaN as equal to NaN (unlike indexOf).
                if (item === value || (value !== value && item !== item)) {
                    return true;
                }
            }
            return false;
        });
    }
}

// Install on require so the entry file only needs `require('./polyfills.js')`.
install();

module.exports = install;
