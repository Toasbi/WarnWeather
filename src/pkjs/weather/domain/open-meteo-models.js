// src/pkjs/weather/domain/open-meteo-models.js — ES5, watch runtime and settings page.
//
// The weather models the Open-Meteo Provider can use (the openMeteoModel setting, the Model row
// under the Provider on Setup › Data sources › Weather): the default, ECMWF IFS at 25 km, the
// other worldwide models, then the national ones by country. A model applies only while
// Open-Meteo is the Provider (modelOf): as a source of single readings Open-Meteo answers with the
// default, and its fills, its UV and its gusts keep their own models
// (weather/adapter/providers/openmeteo.js).
//
// Per model: its name, the area it is made for and its grid, and where its precipitation chance
// comes from (`chance`): 'own', its own ensemble, which matches its amounts; 'borrowed', ECMWF's
// ensemble; 'coarser', a coarser ensemble of its family's; 'none', no chance at all, so a fetch
// asks ECMWF's beside it (weather/adapter/providers/openmeteo.js). Only a model whose chance is
// its own brings a precipitation amount: an amount beside a chance from another model comes and
// goes against it, as the rain bars did under best_match's mix, which is why the default is
// pinned. `chanceHours`, the hours one value of its chance covers (the default's ensemble has
// 3-hour steps; 1 where the chance is hourly; null for a model with no chance, whose fetch reads
// the default's: chanceRow). `covers`, where a model answers only inside its
// area: Open-Meteo answers HTTP 400 elsewhere, and the fetch takes the default there.
//
// Dual-context like provider-readings.js: a CommonJS module on the phone and in the tests, a
// plain <script> on the settings page (window.OpenMeteoModels).
(function () {
    // The provider the models are for (provider-readings.js PROVIDERS).
    var PROVIDER = 'openmeteo';
    var DEFAULT = 'ecmwf_ifs025';
    var WORLDWIDE = 'Worldwide';
    var MODELS = [
        { id: 'ecmwf_ifs025', name: 'ECMWF IFS', area: WORLDWIDE, grid: '25 km', chance: 'own' },
        { id: 'ecmwf_ifs', name: 'ECMWF IFS HRES', area: WORLDWIDE, grid: '9 km', chance: 'own' },
        { id: 'ncep_gfs_global', name: 'NOAA GFS', area: WORLDWIDE, grid: '13 km', chance: 'own' },
        { id: 'geosphere_seamless', name: 'GeoSphere C-LAEF', area: 'Austria', grid: '1 km', chance: 'borrowed' },
        { id: 'cmc_gem_seamless', name: 'Environment Canada GEM', area: 'Canada', grid: '2.5 km', chance: 'coarser' },
        { id: 'chmi_aladin_seamless', name: 'ČHMÚ ALADIN', area: 'Czechia', grid: '1 km', chance: 'borrowed',
            covers: 'Central Europe' },
        { id: 'dmi_seamless', name: 'DMI HARMONIE', area: 'Denmark', grid: '2 km', chance: 'borrowed' },
        { id: 'meteofrance_seamless', name: 'Météo-France AROME', area: 'France', grid: '1.5 km', chance: 'none' },
        // ICON-EU-EPS's chance is hourly for the first two days.
        { id: 'dwd_icon_seamless', name: 'DWD ICON', area: 'Germany', grid: '2 km', chance: 'coarser',
            chanceHours: 1 },
        { id: 'jma_seamless', name: 'JMA MSM', area: 'Japan', grid: '5 km', chance: 'none' },
        { id: 'knmi_seamless', name: 'KNMI HARMONIE', area: 'Netherlands', grid: '2 km', chance: 'borrowed' },
        { id: 'meteoswiss_icon_seamless', name: 'MeteoSwiss ICON', area: 'Switzerland', grid: '1 km', chance: 'own',
            chanceHours: 1, covers: 'the Alps' },
        // MOGREPS-UK, the UKV's ensemble, is hourly.
        { id: 'ukmo_seamless', name: 'Met Office UKV', area: 'UK and Ireland', grid: '2 km', chance: 'own',
            chanceHours: 1 }
    ];
    MODELS.forEach(function (model) {
        model.worldwide = model.area === WORLDWIDE;
        model.chanceHours = model.chance === 'none' ? null : model.chanceHours || 3;
        model.covers = model.covers || null;
    });
    var IDS = MODELS.map(function (model) { return model.id; });

    /**
     * A model's row, by its id; none for an id the table does not hold (a model Open-Meteo
     * retired, or a stored value like 'constructor').
     * @param {*} id A model id.
     * @returns {?Object} Its MODELS row.
     */
    function rowOf(id) {
        var at = typeof id === 'string' ? IDS.indexOf(id) : -1;
        return at === -1 ? null : MODELS[at];
    }

    /**
     * The model the settings have the Provider use: the stored one while the Provider is
     * Open-Meteo and the table holds it, else the default.
     * @param {?Object} settings Clay settings.
     * @returns {string} A model id.
     */
    function modelOf(settings) {
        var id = settings && settings.provider === PROVIDER ? settings.openMeteoModel : null;
        return rowOf(id) ? id : DEFAULT;
    }

    /**
     * A model's row, the default's for an id the table does not hold.
     * @param {*} id A model id.
     * @returns {Object} A MODELS row.
     */
    function modelRow(id) {
        return rowOf(id) || rowOf(DEFAULT);
    }

    /**
     * Whether a model brings a precipitation amount: its chance is its own.
     * @param {*} id A model id; an unknown one is the default.
     * @returns {boolean}
     */
    function bringsAmount(id) {
        return modelRow(id).chance === 'own';
    }

    /**
     * Whether a fetch with a model asks ECMWF for the chance: the model has none.
     * @param {*} id A model id; an unknown one is the default.
     * @returns {boolean}
     */
    function asksChance(id) {
        return modelRow(id).chance === 'none';
    }

    /**
     * The model a fetch with a model reads the precipitation chance from: the model itself, whose
     * answer holds its chance (its own, ECMWF's or a coarser model's), or the default for a model
     * with none, whose answer is asked beside it (asksChance).
     * @param {*} id A model id; an unknown one is the default.
     * @returns {Object} A MODELS row: its id is the model asked, its chanceHours the chance's step.
     */
    function chanceRow(id) {
        return asksChance(id) ? rowOf(DEFAULT) : modelRow(id);
    }

    var api = { PROVIDER: PROVIDER, DEFAULT: DEFAULT, MODELS: MODELS, IDS: IDS, rowOf: rowOf, modelRow: modelRow,
        modelOf: modelOf, bringsAmount: bringsAmount, asksChance: asksChance, chanceRow: chanceRow };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.OpenMeteoModels = api; }
})();
