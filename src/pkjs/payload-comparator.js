/**
 * Compares a candidate AppMessage payload against the last-sent
 * serializations cached in localStorage, one entry per category. The result
 * object is the single source for everything downstream in the outbox: the
 * outgoing AppMessage (changed subsets), the ACK-time cache writes
 * (changed {cacheKey, serialized}), and the dev-stats event descriptor.
 */

/**
 * Extract the subset of `payload` belonging to a category, in the category's
 * fixed key order so the serialization is stable across calls.
 *
 * @param {Object} payload Full candidate payload.
 * @param {Object} category Category descriptor ({name, cacheKey, keys}).
 * @returns {Object|null} Subset object, or null when none of the keys are present.
 */
function categorySubset(payload, category) {
    var subset = {};
    var present = false;
    category.keys.forEach(function(key) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
            subset[key] = payload[key];
            present = true;
        }
    });
    return present ? subset : null;
}

/**
 * @param {Object[]} categories Category descriptors ({name, cacheKey, keys}).
 * @constructor
 */
function PayloadComparator(categories) {
    this.categories = categories;
}

/**
 * Compare a payload against the last-sent cache of every category.
 *
 * @param {Object} payload Full candidate payload.
 * @returns {{categories: Array<{name: string, cacheKey: string, subset: Object, serialized: string, changed: boolean}>}}
 *     One entry per category present in the payload; `changed` is true when
 *     the serialized subset differs from the last ACKed send.
 */
PayloadComparator.prototype.compare = function(payload) {
    var entries = [];
    this.categories.forEach(function(category) {
        var subset = categorySubset(payload, category);
        var serialized;
        if (subset === null) {
            return;  // Category absent from this payload.
        }
        serialized = JSON.stringify(subset);
        entries.push({
            name: category.name,
            cacheKey: category.cacheKey,
            subset: subset,
            serialized: serialized,
            changed: serialized !== localStorage.getItem(category.cacheKey)
        });
    });
    return { categories: entries };
};

module.exports = PayloadComparator;
