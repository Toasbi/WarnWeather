// src/pkjs/settings/wizard-forecast.js — ES5, WebView. The setup wizard's forecast step, as data:
// its looks for the forecast graph, how a graph reads as one of them, its length (emery) and its
// preview. Pure: the settings, the watch and the defaults come in as arguments; wizard.js does the
// DOM and the writes.
//
// THE LOOKS (LOOKS, the owner's graph looks) are the settings page's templates too: New graph
// starts a graph from one of them (graph-styles-page.js), and a screen preset brings a graph that
// is one (screen-presets.js). LOOKS is their one definition. Setup's picker offers the three
// marked `setup` (Classic, Clean, Stripes: its picker is one row, setupLooks); the others,
// which show what else the graph can draw (the owner's asks, 2026-11-09 and 2026-11-10: better too
// many than too few), are Add a screen's and New graph's. Each look is a full set of the graph
// settings it governs (governed): the four lines' metrics and styles, the Main metric's fill, the
// rain bars and their colour, every Draw from key, Day / night shading, and on emery where the
// high and low go. Each lays its own values over the graph's defaults as the theme starts them
// (engine themedDefaults), and each has the night shading on. Every word the page says about a
// look is written from its values (THE WORDS), so a look changes in LOOKS alone. A graph that is
// none of them when setup opens is kept as one more record, "Your own", first. The 144 px watches
// keep the left axis in every look (the owner's, 2026-11-07: emery's numbers On graph do not fit
// their image), so only emery's words say where the high and low go.
//
// THE WORDS. Setup's sentence under the picker (describe) and the short line under a template in
// New graph's sheet (summary) name what a look draws, from its values: the temperature and the
// lines a look draws as lines, a shaded area, dots, × marks or stripes, then the rain bars (Solid
// on a colour watch, hanging from the top), and on emery where the high and low go. A look's
// `like` names the watchface it draws like (Classic: ForecasWatch2). Add a screen shows a legend
// of what a screen draws instead (screen-legend.js), read off the graph a look makes.
//
// THE LENGTH (emery, the one watch with a Forecast length). Each look starts on a length of its
// own (LOOKS span: Classic and Stripes 24 hours, Clean the long span, Rain 12 hours), which the step's
// Forecast length picker then changes (the owner's, 2026-11-07). "Your own" keeps the length it
// was set up with. The length is no part of a look: any length reads as the look its graph is,
// but for a look with `short` values, which it draws on 12 and 24 hours only (overAt: Outdoor's
// feels-like line, the owner's, 2026-11-09).
//
// THE KEYS are the graph styles' (graph-styles.js GOVERNED, one list) less the length, which the
// step's own picker sets, and the lines' Visible values and the graph colours, which a look
// leaves as they are.
//
// HOW A GRAPH READS. Through the readings the watch's own modules give (reading): a line's style
// only while the line draws, a Draw from key only while a drawn line reads it (draw-from.js
// rowLine; a dormant Top is kept and never compared), the bars' edge only while they draw, and
// the bars' colour, the fill and the Left axis values as the wire reads them. A look writes the
// Draw from keys only of the lines it draws, so trying one never drops a dormant Top.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after every module it binds below and ahead of
// wizard.js), which has no require().
(function () {
    // Dual-context (see line-style.js): CommonJS modules under Node, the window globals of the files
    // concatenated ahead of this one in the page.
    var node = typeof require !== 'undefined';
    var lineStyle = node ? require('../line-style.js') : window.LineStyle;
    var drawFrom = node ? require('../draw-from.js') : window.DrawFrom;
    var forecastAxis = node ? require('../forecast-axis.js') : window.ForecastAxis;
    var resolveInk = node ? require('../resolve-ink.js') : window.ResolveInk;
    var themeFlip = node ? require('../theme-flip.js') : window.ThemeFlip;
    var graphStyles = node ? require('../graph-styles.js') : window.GraphStyles;
    var spanHours = node ? require('../forecast-span-hours.js') : window.ForecastSpanHours;
    var forecastSample = node ? require('./forecast-sample.js') : window.ForecastSample;
    var previewForecast = node ? require('./preview-forecast.js') : window.PreviewForecast;
    var svgLib = node ? require('./preview-svg.js') : window.PreviewSvg;
    var screenFrame = node ? require('./screen-frame.js') : window.ScreenFrame;
    // A metric as a sentence names it (forecast-metrics.js, the metrics' one table).
    var metrics = node ? require('./forecast-metrics.js') : window.ForecastMetrics;
    // The lines' Visible values (line-alert.js), which a look leaves as they are.
    var lineAlert = node ? require('../line-alert.js') : window.LineAlert;
    // Names as a sentence lists them, a sentence's capital (config-ui/lib/html.js, concatenated
    // ahead of every app file).
    var html = node ? require('../config-ui/lib/html.js') : window.PConf.html;

    // The governed keys, named by the modules that own them.
    var FILL = 'secondaryLineFill';
    var BARS = 'barSource';
    var BAR_COLOR = 'rainBarColor';
    var BAR_FROM = drawFrom.BAR_KEYS.rain;
    var AXIS_NUMBERS = forecastAxis.KEYS.numbers;
    var FROM_KEYS = drawFrom.ROWS.map(function (row) { return row.key; });
    // A line's style key -> its metric key.
    var LINE_OF_STYLE = {};
    lineStyle.FORECAST_LINES.forEach(function (line) { LINE_OF_STYLE[line.styleKey] = line.key; });
    // The graph styles' governed keys (THE KEYS above) less the length, the Visible values and the
    // colours.
    var LEFT_AS_THEY_ARE = lineStyle.graphColorKeys().concat(lineAlert.METRIC_IDS.map(lineAlert.settingKey));
    var KEYS = graphStyles.GOVERNED.filter(function (k) {
        return k !== 'forecastHours' && LEFT_AS_THEY_ARE.indexOf(k) === -1;
    });

    // What every look sets: the rain chance as a thin line over a shaded area, the other lines
    // off, the rain bars and the night shading.
    var BASE = { secondaryLine: 'precip_prob', secondaryLineStyle: 'line', secondaryLineFill: true,
        thirdLine: 'off', fourthLine: 'off', fifthLine: 'off', barSource: 'rain', dayNightShading: true };
    /**
     * A look's values: BASE with its own over it.
     * @param {Object<string, *>} own The look's own values.
     * @returns {Object<string, *>}
     */
    function lookValues(own) { return Object.assign({}, BASE, own); }
    // In the pickers' order, Add a screen's roll's (screens-page.js rollItems): setup's three and
    // Simple, then rain and clouds, outdoors, wind and pressure. `span` is the Forecast length a look starts
    // on (emery): '48' is the long span's stored option ("66 h" with the high and low on the graph).
    // `setup`: setup's picker offers it; `short`: values it draws on 12 and 24 hours only (THE
    // LENGTH). Only the rain chance fills its area: the watch paints an area solid (it has no
    // alpha), so a metric that sits high for hours, as the clouds, gusts or UV index do, covered
    // the whole graph; theirs draw as a thick line or a stripe (the owner's, 2026-11-10).
    var LOOKS = [
        // The ForecasWatch2 graph: the rain chance as a thin line over a shaded area, the rain bars
        // in the colour the theme starts them on (Multicolor on a dark theme, Solid on a light one,
        // as 2.6's Classic), the high and low beside the axis.
        { id: 'classic', label: 'Classic', span: '24', like: 'ForecasWatch2', setup: true,
            over: lookValues({ forecastAxisNumbers: 'axis' }) },
        // The rain chance alone, Solid bars in every theme, the high and low on the graph (no cloud
        // cover: the owner's, 2026-11-09, a user adds it): the graph of the Clean and Weathergraph
        // screens (screen-presets.js), and the look a fresh install's setup starts on where its graph
        // is none of them (FIRST_RUN).
        { id: 'clean', label: 'Clean', span: '48', setup: true, over: lookValues({ rainBarColor: 'white',
            forecastAxisNumbers: 'graph' }) },
        // The clouds and the rain chance as stripes along the top (the rain chance moves from its
        // line into its stripe: a metric shows once per graph), Solid bars hanging from the top
        // (the owner's, 2026-11-09), the feels-like temperature as a thin line and the high and low
        // on the graph (the owner's, 2026-11-09).
        { id: 'stripes', label: 'Stripes', span: '24', setup: true, over: lookValues({ secondaryLine: 'cloud',
            secondaryLineStyle: 'stripeTop', thirdLine: 'precip_prob', thirdLineStyle: 'stripeTop', fourthLine: 'feels',
            fourthLineStyle: 'line', rainBarColor: 'white', rainBarFrom: drawFrom.TOP, forecastAxisNumbers: 'graph' }) },
        // The temperature and the rain chance as a thin line, no bars and no shaded area: the
        // plainest graph (the owner's ask, 2026-11-10: better too many presets than too few).
        { id: 'simple', label: 'Simple', span: '24', over: lookValues({ secondaryLineFill: false, barSource: 'off',
            forecastAxisNumbers: 'graph' }) },
        // The next 12 hours of rain, as rain apps show them (the rain chance as a stripe along the top,
        // the rain bars in the colours of how hard it rains: Multicolor on a dark theme).
        { id: 'rain', label: 'Rain', span: '12', over: lookValues({ secondaryLineStyle: 'stripeTop',
            forecastAxisNumbers: 'graph' }) },
        // The cloud cover as a stripe along the top, the sky over the graph, and the rain chance as
        // a thin line, Solid bars: the day's sky over 24 hours (Clouds shows the nights, over the
        // long span).
        { id: 'sky', label: 'Sky', span: '24', over: lookValues({ secondaryLine: 'cloud', secondaryLineStyle: 'stripeTop',
            secondaryLineFill: false, thirdLine: 'precip_prob', thirdLineStyle: 'line', rainBarColor: 'white',
            forecastAxisNumbers: 'graph' }) },
        // The cloud cover as a thick line over the long span, the nights shaded, Solid bars:
        // whether the next nights stay clear, as stargazing forecasts show it (Clear Outside).
        { id: 'clouds', label: 'Clouds', span: '48', over: lookValues({ secondaryLine: 'cloud', secondaryLineStyle: 'bold',
            secondaryLineFill: false, rainBarColor: 'white', forecastAxisNumbers: 'graph' }) },
        // Clean with its Solid bars hanging from the top and the UV index as a thin line from the
        // bottom; on 12 and 24 hours the feels-like temperature as a thin line too (the owner's,
        // 2026-11-09: rain from above, sun from below, for a day outside).
        { id: 'outdoor', label: 'Outdoor', span: '48', over: lookValues({ thirdLine: 'uv', thirdLineStyle: 'line',
            rainBarColor: 'white', rainBarFrom: drawFrom.TOP, forecastAxisNumbers: 'graph' }),
            short: { fourthLine: 'feels', fourthLineStyle: 'line' } },
        // The UV index as a thick line and the clouds as a stripe along the top, Solid bars: when
        // the sun is strong, as UV forecasts chart it.
        { id: 'sun', label: 'Sun', span: '24', over: lookValues({ secondaryLine: 'uv', secondaryLineStyle: 'bold',
            secondaryLineFill: false, thirdLine: 'cloud', thirdLineStyle: 'stripeTop', rainBarColor: 'white',
            forecastAxisNumbers: 'graph' }) },
        // The feels-like temperature as a thin line and the dew point as × marks beside the
        // temperature (Apple Weather's Feels Like and Humidity charts): how muggy or raw the day feels.
        { id: 'comfort', label: 'Comfort', span: '24', over: lookValues({ thirdLine: 'feels', thirdLineStyle: 'line',
            fourthLine: 'dew', fourthLineStyle: 'x', forecastAxisNumbers: 'graph' }) },
        // The wind speed as a thick line and the gusts as dots over it, as wind forecasts chart
        // them (Windfinder, Apple Weather).
        { id: 'wind', label: 'Wind', span: '24', over: lookValues({ secondaryLine: 'wind', secondaryLineStyle: 'bold',
            secondaryLineFill: false, thirdLine: 'gust', thirdLineStyle: 'dots', forecastAxisNumbers: 'graph' }) },
        // The gusts as a thick line, the air pressure as a thin line and the rain chance as a
        // stripe along the top over the rain bars: a storm coming in.
        { id: 'storm', label: 'Storm', span: '24', over: lookValues({ secondaryLine: 'gust', secondaryLineStyle: 'bold',
            secondaryLineFill: false, thirdLine: 'pressure', thirdLineStyle: 'line', fourthLine: 'precip_prob',
            fourthLineStyle: 'stripeTop', forecastAxisNumbers: 'graph' }) },
        // Clean with the air pressure as a thin line over the long span: a front coming in (a thin
        // line: a thick one would read as the temperature's, in much the same red).
        { id: 'pressure', label: 'Pressure', span: '48', over: lookValues({ thirdLine: 'pressure', thirdLineStyle: 'line',
            rainBarColor: 'white', forecastAxisNumbers: 'graph' }) },
        // A meteogram, as weather services draw one (Yr, meteoblue, Windy): the clouds as a stripe
        // along the top, the air pressure as a thin line and the wind as dots over the rain bars,
        // over the long span (the owner's ask, 2026-11-10: presets from the common ways to show
        // the weather).
        { id: 'meteogram', label: 'Meteogram', span: '48', over: lookValues({ secondaryLine: 'cloud',
            secondaryLineStyle: 'stripeTop', thirdLine: 'pressure', thirdLineStyle: 'line', fourthLine: 'wind',
            fourthLineStyle: 'dots', forecastAxisNumbers: 'graph' }) }
    ];
    // The long span's stored option (forecast-span-hours.js CHOICES): a look's `short` values are
    // for every other length.
    var LONG = '48';
    // The look a fresh install's setup starts on where its graph, the defaults, is none of them
    // (wizard.js openWizard).
    var FIRST_RUN = 'clean';
    var OWN = { id: 'own', label: 'Your own' };

    // Forecast length (emery only): the schema's Other row of a graph's dialog (Graphs › Forecast). Setup shows its
    // hints, the long span's shortened to this.
    var SPAN_DESC = {
        '48': 'Shows as many hours as your weather service forecasts and the graph can fit, in narrow columns.'
    };

    // ── THE WORDS ───────────────────────────────────────────────────────────

    // How a line draws, in the order the words name them: [one, several] for the sentence
    // (long) and, where it says it shorter, the short line. The sentence's lines start with the
    // temperature, which every graph draws as a line: alone it needs no "as lines".
    var HOW = [
        { id: 'line', long: ['', ' as lines'], short: [' as a line', ' as lines'] },
        { id: 'bold', long: [' as a thick line', ' as thick lines'] },
        { id: 'area', long: [' as a shaded area', ' as shaded areas'] },
        { id: 'dots', long: [' as dots', ' as dots'] },
        { id: 'x', long: [' as \u00d7 marks', ' as \u00d7 marks'] },
        { id: 'stripeTop', long: [' as a stripe along the top', ' as stripes along the top'],
            short: [' as a stripe', ' as stripes'] },
        { id: 'stripeBottom', long: [' as a stripe along the bottom', ' as stripes along the bottom'],
            short: [' as a stripe at the bottom', ' as stripes at the bottom'] }
    ];

    // The two ways the words name a look: setup's sentence (describe) names the temperature
    // first and puts "the" before a metric; the template pickers' short line (summary) leaves
    // both out and says less.
    var SENTENCE = { seed: ['the temperature'], article: 'the ', form: 'long', barsTop: ' that hang from the top' };
    var SHORT = { seed: null, article: '', form: 'short', barsTop: ' from the top' };

    /**
     * How a line of a look draws on this watch (HOW's ids), as the watch reads it: its style
     * (line-style.js lineStyleValue: a stripe on a metric that can't be one draws as a line),
     * a thin line on a watch without line styles, and the Main metric's thin or thick line as a
     * shaded area where the watch fills it (line-style.js mainLineFills).
     * @param {Object<string, *>} over A look's values.
     * @param {{key: string, styleKey: string}} line A line (line-style.js FORECAST_LINES).
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function howOf(over, line, env) {
        var style = drawFrom.capable(env) ? lineStyle.lineStyleValue(over, line.styleKey) : 'line';
        var solid = style === 'line' || style === 'bold';
        return solid && line.key === 'secondaryLine' && lineStyle.mainLineFills(over, env) ? 'area' : style;
    }

    /**
     * What a look draws on this watch, in these words (SENTENCE or SHORT): the series its lines
     * draw (graph-styles.js seriesOf: each line's effective metric, the lines the watch draws)
     * grouped by how they draw (HOW), then its rain bars.
     * @param {Object<string, *>} over A look's values.
     * @param {?Object} env Platform env.
     * @param {Object} words SENTENCE or SHORT.
     * @returns {string[]} One phrase per way of drawing, then the bars'.
     */
    function drawnPhrases(over, env, words) {
        var groups = words.seed ? { line: words.seed.slice() } : {};
        graphStyles.seriesOf(over, env).forEach(function (series, i) {
            if (!series) { return; }
            var how = howOf(over, lineStyle.FORECAST_LINES[i], env);
            (groups[how] = groups[how] || []).push(words.article + metrics.words(series.metric));
        });
        var out = [];
        HOW.forEach(function (h) {
            var names = groups[h.id];
            if (names) { out.push(html.andList(names) + (h[words.form] || h.long)[names.length > 1 ? 1 : 0]); }
        });
        if (over[BARS] === 'rain') {
            out.push((over[BAR_COLOR] === 'white' && env && env.color ? 'solid ' : '') + 'rain bars'
                + (drawFrom.barsFromTop(over, 'rain', env) ? words.barsTop : ''));
        }
        return out;
    }

    /**
     * A look by its id.
     * @param {string} id A look's id.
     * @returns {?Object} The LOOKS entry, or null.
     */
    function lookOf(id) {
        return LOOKS.filter(function (look) { return look.id === id; })[0] || null;
    }

    /**
     * What a graph draws on this watch as setup's sentence lists it (THE WORDS: SENTENCE), the last
     * phrase after ", and", the sentence's own rhythm as setup has always said it: "the temperature
     * and the UV index as lines, the rain chance as a shaded area, and solid rain bars that hang
     * from the top". Solid bars are solid only where the watch colours them: a black-and-white
     * watch outlines its bars.
     * @param {Object<string, *>} values A look's values, or a graph's settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function drawnList(values, env) {
        var phrases = drawnPhrases(values, env, SENTENCE);
        return phrases.length < 2 ? phrases.join('')
            : phrases.slice(0, -1).join(', ') + ', and ' + phrases[phrases.length - 1];
    }

    /**
     * Where a graph puts the high and low, as a sentence after its list says it: on emery only
     * (the 144 px watches keep the left axis in every look).
     * @param {Object<string, *>} values A look's values, or a graph's settings.
     * @param {?Object} env Platform env.
     * @returns {string} ' The high and low go on the graph.'; '' off emery
     */
    function highLowWords(values, env) {
        var numbers = forecastAxis.numbers(values);
        return !forecastAxis.isEmery(env) ? ''
            : numbers === forecastAxis.OFF ? ' The graph shows no high and low.'
            : ' The high and low go ' + (numbers === forecastAxis.GRAPH ? 'on the graph.' : 'beside the axis.');
    }

    /**
     * A look's description (THE WORDS), under setup's picker: one sentence on what it draws on its
     * own length (overAt), and on emery a second on where the high and low go.
     * @param {string} id A look's id, or 'own'.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function describe(id, env) {
        var look = lookOf(id);
        if (!look) { return 'Keeps your graph as it is now.'; }
        var over = overAt(look);
        return (look.like ? 'Draws the graph the way ' + look.like + ' does: ' : 'Shows ') + drawnList(over, env) + '.'
            + highLowWords(over, env);
    }

    /**
     * The length a look starts on, or another length of its graph, as the Forecast length picker
     * names it on these settings (forecast-span-hours.js spanLabel): "24 h", or the long span by
     * the hours it shows for the user's weather service and the look's Left axis values ("66 h",
     * "47 h" with OpenWeatherMap). On a watch with a Forecast length (emery) only.
     * @param {string} id A look's id.
     * @param {?Object} env Platform env.
     * @param {?Object} S The user's settings (the weather service and the layout).
     * @param {string} [span] A length ('12' | '24' | '48'); the look's own without.
     * @returns {string} '' for no such look, or a watch without the length
     */
    function spanLabel(id, env, S, span) {
        var look = lookOf(id);
        if (!look || !(env && env.forecastSpan)) { return ''; }
        return spanHours.spanLabel(Object.assign({}, S, look.over, { forecastHours: span || look.span }));
    }

    /**
     * A look's graph's lengths as the Forecast length picker names them on these settings
     * (forecast-span-hours.js spanOptions: the long span by the hours the look shows): Add a
     * screen's Forecast length. On a watch with a Forecast length (emery) only.
     * @param {string} id A look's id.
     * @param {?Object} env Platform env.
     * @param {?Object} S The user's settings.
     * @returns {Array<Array<string>>} [label, value] pairs; none for no such look or watch
     */
    function lookSpanOptions(id, env, S) {
        var look = lookOf(id);
        if (!look || !(env && env.forecastSpan)) { return []; }
        return spanHours.spanOptions(Object.assign({}, S, look.over));
    }

    /**
     * A look's short line (THE WORDS: the New graph sheet's line under a template, after its
     * length): what it draws, without the temperature every graph draws.
     * @param {string} id A look's id.
     * @param {?Object} env Platform env.
     * @returns {string} "Clouds and rain chance as stripes, solid rain bars from the top"; '' for no
     *   such look
     */
    function summary(id, env) {
        var look = lookOf(id);
        if (!look) { return ''; }
        return html.capitalize(drawnPhrases(look.over, env, SHORT).join(', '));
    }

    // The preview's frame height in viewBox units: the tallest legend's (two rows: the
    // temperature, four lines and the rain bars), so a look never moves the controls under it.
    var FRAME_H = 128;

    /**
     * The keys the looks govern on this watch: not where the high and low go off emery, nor the
     * bars' colour on a black-and-white watch, which outlines its bars. Each is dormant there.
     * @param {?Object} env Platform env.
     * @returns {string[]}
     */
    function governed(env) {
        return KEYS.filter(function (k) {
            if (k === AXIS_NUMBERS) { return forecastAxis.isEmery(env); }
            if (k === BAR_COLOR) { return Boolean(env && env.color); }
            return true;
        });
    }

    /**
     * One governed setting as the watch reads it from `s` ('' for one that reads nothing there).
     * @param {string} k A governed key.
     * @param {Object} s Settings.
     * @param {?Object} env Platform env.
     * @returns {*}
     */
    function reading(k, s, env) {
        if (LINE_OF_STYLE[k]) {
            return lineStyle.effectiveLineMetric(s, LINE_OF_STYLE[k]) ? lineStyle.lineStyleValue(s, k) : '';
        }
        if (FROM_KEYS.indexOf(k) !== -1) { return drawFrom.rowLine(s, k, env) ? drawFrom.value(s[k]) : ''; }
        if (k === BAR_FROM) { return s[BARS] === 'rain' ? drawFrom.value(s[k]) : ''; }
        if (k === FILL) { return Boolean(s[k]); }
        if (k === AXIS_NUMBERS) { return forecastAxis.numbers(s); }
        if (k === BAR_COLOR) { return resolveInk.barColorMode(s[k], s.theme); }
        return s[k];
    }

    /**
     * Whether the settings draw the graph a set of values stands for: every key in it read alike.
     * @param {Object} S Settings.
     * @param {Object<string, *>} values A look's values.
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function same(S, values, env) {
        var target = Object.assign({}, S, values);
        return Object.keys(values).every(function (k) { return reading(k, S, env) === reading(k, target, env); });
    }

    /**
     * A look's own values at a length (THE LENGTH): its `over`, with its `short` values over them
     * on any length but the long span.
     * @param {{over: Object, short: (Object|undefined), span: string}} look A LOOKS entry.
     * @param {string} [span] '12' | '24' | '48'; the look's own without.
     * @returns {Object<string, *>}
     */
    function overAt(look, span) {
        return look.short && String(span || look.span) !== LONG ? Object.assign({}, look.over, look.short) : look.over;
    }

    /**
     * The settings a look writes at a length: the defaults of every governed key with the look's
     * own values there (overAt) over them, less the Draw from keys none of its drawn lines reads.
     * @param {{over: Object}} look A LOOKS entry.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} defaults The defaults as the theme starts them (engine themedDefaults).
     * @param {string} [span] The length; the look's own without.
     * @returns {Object<string, *>}
     */
    function valuesOf(look, S, env, defaults, span) {
        var out = {}, over = overAt(look, span);
        governed(env).forEach(function (k) {
            out[k] = Object.prototype.hasOwnProperty.call(over, k) ? over[k] : defaults[k];
        });
        var drawn = Object.assign({}, S, out);
        FROM_KEYS.forEach(function (k) {
            if (!drawFrom.rowLine(drawn, k, env)) { delete out[k]; }
        });
        return out;
    }

    /**
     * The graph as the settings hold it: its governed settings and its Forecast length (spanOf).
     * Setup keeps the one it opened on as "Your own" when it is none of the looks.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {{values: Object<string, *>, span: string}}
     */
    function state(S, env) {
        var values = {};
        governed(env).forEach(function (k) { values[k] = S[k]; });
        return { values: values, span: spanOf(S) };
    }

    /**
     * The step's looks as records the picker lists: "Your own" first when there is one. Each
     * carries the Forecast length it starts on (span), which only emery has (wizard.js pickLook).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} defaults The defaults as the theme starts them.
     * @param {?{values: Object<string, *>, span: string}} own "Your own" (state() when setup
     *   opened), or null.
     * @returns {Array.<{id: string, label: string, desc: string, values: Object, span: string}>}
     */
    function looks(S, env, defaults, own) {
        var out = LOOKS.map(function (look) {
            return { id: look.id, label: look.label, desc: describe(look.id, env), values: valuesOf(look, S, env, defaults),
                span: look.span || defaults.forecastHours };
        });
        if (own) {
            out.unshift({ id: OWN.id, label: OWN.label, desc: describe(OWN.id, env), values: own.values, span: own.span });
        }
        return out;
    }

    /**
     * Setup's picker's records (looks): "Your own" when there is one, and the looks marked
     * `setup`. A graph that reads as another template is "Your own" there.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} defaults The defaults as the theme starts them.
     * @param {?{values: Object<string, *>, span: string}} own "Your own", or null.
     * @returns {Array.<{id: string, label: string, desc: string, values: Object, span: string}>}
     */
    function setupLooks(S, env, defaults, own) {
        return looks(S, env, defaults, own).filter(function (r) {
            var look = lookOf(r.id);
            return !look || Boolean(look.setup);
        });
    }

    /**
     * The settings a template writes at a length (valuesOf): what a graph made from it at that
     * length draws, and what a graph of yours must read as to be it (graph-styles-page.js).
     * @param {string} id A look's id.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} defaults The defaults as the theme starts them.
     * @param {string} [span] The length; the look's own without.
     * @returns {?Object<string, *>} null for no such look
     */
    function valuesAt(id, S, env, defaults, span) {
        var look = lookOf(id);
        return look ? valuesOf(look, S, env, defaults, span) : null;
    }

    /**
     * The Forecast length the settings hold, as the picker's value: '12', '24' or '48' (an absent
     * or unknown value reads '24', as the phone reads it).
     * @param {Object} S Settings.
     * @returns {string}
     */
    function spanOf(S) {
        return String(spanHours.storedHours(S));
    }

    /**
     * The record the settings draw now.
     * @param {Object} S Settings.
     * @param {Array.<Object>} records looks().
     * @param {?Object} env Platform env.
     * @returns {?Object} The record, or null.
     */
    function current(S, records, env) {
        for (var i = 0; i < records.length; i += 1) {
            if (same(S, records[i].values, env)) { return records[i]; }
        }
        return null;
    }

    /**
     * Convert "Your own"'s values the way a theme pick converts the settings (theme-flip.js, which
     * leaves keys a partial blob lacks alone), so it stays the graph it was.
     * @param {Object} own "Your own"'s values; changed in place.
     * @param {string} oldTheme The theme before.
     * @param {string} newTheme The theme picked.
     * @returns {void}
     */
    function followTheme(own, oldTheme, newTheme) {
        themeFlip.applyThemeConvert(own, oldTheme, newTheme);
    }

    /**
     * The preview: the settings page's forecast graph, drawn from the sample weather over the
     * hours the watch shows (a span of N hours, N + 1 points), at one frame height, in the frame
     * every screen picture shares (screen-frame.js): a margin of the graph's own ground all round,
     * so its card's round corners clip none of it. A bare one draws no legend, its frame ending
     * under the hour labels, every bare frame one height already.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette snapshot).
     * @param {{bare: boolean}} [opts] `bare`: no legend (Add a screen's roll, whose legend is the
     *   one under the row).
     * @returns {string} SVG markup.
     */
    function previewSvg(S, env, userData, opts) {
        var hours = spanHours.shownHours(S, env), bare = Boolean(opts && opts.bare);
        var drawn = previewForecast.forecastPreview(S, env, userData, {
            sample: forecastSample.sample(hours + 1, S.temperatureUnits), minHeight: bare ? 0 : FRAME_H, bleed: false,
            bare: bare });
        var body = svgLib.unframe(drawn);
        // The graph's ground is the one its own background rect paints (preview-forecast.js
        // forecastPreview: the picked theme's, a light one white).
        return body ? screenFrame.svg(200, body.h, svgLib.previewInk(S.theme || 'dark').bg, body.inner, 'wiz-graph-scr')
            : drawn;
    }

    var api = {
        KEYS: KEYS,
        LOOKS: LOOKS,
        FIRST_RUN: FIRST_RUN,
        SPAN_DESC: SPAN_DESC,
        FRAME_H: FRAME_H,
        describe: describe,
        summary: summary,
        spanLabel: spanLabel,
        lookOf: lookOf,
        governed: governed,
        same: same,
        state: state,
        looks: looks,
        setupLooks: setupLooks,
        valuesAt: valuesAt,
        spanOf: spanOf,
        spanOptions: spanHours.spanOptions,
        lookSpanOptions: lookSpanOptions,
        current: current,
        followTheme: followTheme,
        previewSvg: previewSvg
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WizardForecast = api;
    }
})();
