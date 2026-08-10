/*!
 * GeoLeaf — namespace surface, single source
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */

/**
 * The ONE description of the `globalThis.GeoLeaf` surface, and the one walk that measures it.
 *
 * ## Why this file exists (API publique S4.1)
 *
 * The surface used to be described in three hand-written lists that nothing related, plus a
 * fourth consumer that read one of them **by regex**:
 *
 *   1. `packages/core/__tests__/bundle-boot-contract.test.js`  — pre-boot, built artefact
 *   2. `scripts/probe-boot-contract.mjs`                       — pre-boot, real Chromium
 *   3. `packages/core/__tests__/app/boot-golden-master.test.js` — post-boot, Node
 *   4. `scripts/verify-host-contract-sync.cjs`                  — read (3) as TEXT
 *
 * They drifted, and the drift was invisible by construction. `requireMap` stayed in list (2)
 * for eleven days after leaving list (1) — which means the probe failed for anyone who ran it,
 * and nobody ran it. Consumer (4) was worse: its regex bounded on `];` while the array closes
 * on `].sort();`, so it swallowed everything up to the next `];` in the file and read **104
 * keys for a 103-key array**. Any string literal written after the array — a comment included —
 * became a valid namespace key, silently loosening HOST-01/HOST-02.
 *
 * Now: one array per tier, all three here, and the inclusion `MIN ⊆ IMPORT ⊆ POST` is
 * **asserted** rather than asked for in a comment. Consumer (4) reads this file's AST.
 *
 * ## The arrays are hand-written, and must stay so
 *
 * They are NOT snapshots. `vitest -u` must not be able to rubber-stamp a regression. Update by
 * hand, having read the diff — `diffSurface()` exists to make that diff readable.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The walk
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Measures a namespace object's surface, WITHOUT invoking anything.
 *
 * ⚠️ **Self-sufficient on purpose — no free references, no imports, no closure.** The probe
 * ships this function into Chromium as source text (`walkNamespace.toString()` fed to
 * `new Function`), so any reference to an outer binding would throw a `ReferenceError` in the
 * page instead of measuring. `namespace-surface.selfcontained.test.js` asserts this.
 *
 * ⚠️ **Accessors are recorded by NAME and never read.** `GeoLeaf._APIController` is defined via
 * `Object.defineProperty(gl, "_APIController", { get })` (`kernel/api/controller.ts:354`), and
 * reading it constructs an `APIController`, whose `init()` → `_setupModuleAccess()` →
 * `_scanExistingModules()` re-reads `_APIController` **while it is still being built**. That
 * re-entrancy blew the stack in a browser for real; it is held back only by the instance
 * parking of `controller.ts:340`. A walk that touched `.value` — or worse, descended — would
 * replay it during the very measurement that is supposed to observe the namespace, not change
 * it. `getOwnPropertyDescriptor` does not fire the accessor; that is why it is used.
 *
 * @param {object} root - the namespace object (`globalThis.GeoLeaf`).
 * @param {{ descend?: string[] }} [opts] - `descend` opts INTO depth 2, façade by façade.
 * @returns {{ keys: string[], kinds: Record<string,string>, members: Record<string,string[]> }}
 */
export function walkNamespace(root, opts) {
    var descend = (opts && opts.descend) || [];
    var keys = Object.keys(root).sort();
    var kinds = {};
    var members = {};

    // Depth-2 member names: own enumerable keys PLUS prototype methods (a façade may be a class
    // instance), minus `constructor` and minus anything `_`-prefixed. Read by descriptor too:
    // a getter at depth 2 is recorded by name, never invoked.
    var memberNames = function (value) {
        var found = {};
        var obj = value;
        while (obj && obj !== Object.prototype && obj !== Function.prototype) {
            var own = Object.getOwnPropertyNames(obj);
            for (var i = 0; i < own.length; i++) {
                var n = own[i];
                if (n === "constructor" || n.charAt(0) === "_") continue;
                var d = Object.getOwnPropertyDescriptor(obj, n);
                if (!d || d.enumerable === false) {
                    // Prototype methods are non-enumerable — keep those, drop the rest.
                    if (obj === value) continue;
                }
                found[n] = true;
            }
            obj = Object.getPrototypeOf(obj);
        }
        return Object.keys(found).sort();
    };

    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var d = Object.getOwnPropertyDescriptor(root, k);
        if (d && typeof d.get === "function") {
            kinds[k] = "getter";
            continue; // never .value, never d.get(), never descend
        }
        var v = d ? d.value : undefined;
        kinds[k] = typeof v === "function" ? "function" : v && typeof v === "object" ? "object" : "primitive";
        if (descend.indexOf(k) !== -1 && v && (typeof v === "object" || typeof v === "function")) {
            members[k] = memberNames(v);
        }
    }
    return { keys: keys, kinds: kinds, members: members };
}

/**
 * Names what changed between an expected surface and a measured one.
 *
 * A bare `toEqual` on two 102-element arrays says "array differs at index 11". The tests keep
 * the strict equality as their final net, but assert this first so the failure NAMES the key.
 *
 * @param {string[]} expected
 * @param {string[]} actual
 * @returns {{ missing: string[], extra: string[] }} `missing` = expected but absent.
 */
export function diffSurface(expected, actual) {
    const e = new Set(expected);
    const a = new Set(actual);
    return {
        missing: expected.filter((k) => !a.has(k)).sort(),
        extra: actual.filter((k) => !e.has(k)).sort(),
    };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tier 1 — PRE-BOOT, measured on the built bundle
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The pre-boot façade surface of the built artefact.
 *
 * Distinct from the post-boot surface below. Only the post-boot one was ever frozen — which is
 * exactly how `46cd88dc` shipped "golden-master byte-identical" while having removed
 * `GeoLeaf.I18n` from this very surface.
 *
 * A key LEAVING this list is a breaking change for every eager plugin. `d3477c2f` left the
 * generalised risk explicitly open ("any eager plugin calling GeoLeaf.notify()/
 * GeoLeaf.Utils.* at top-level could suffer the same silence — NOT audited"). Freezing the
 * whole surface closes it.
 *
 * ── Baseline history ──────────────────────────────────────────────────────────────────────
 * S6 Lot 0: 64 keys — the pre-boot surface as S1.3 left it (only `globals.core.ts` ran its
 *           setups at import; the other five were lazy, and the rustine compensated).
 * S6 Lot 2: 88 keys — phase A restored. Measured diff on the built bundle: +24, **-0**.
 *           Nothing was lost — this is the fix, not drift.
 * KERNEL S6: 87 keys — `_StyleUtils` removed (sole member `normalizeStyle`, no production
 *           reader). Internal `_`-prefixed surface → not a breaking change.
 * API S4.1: moved here verbatim from `bundle-boot-contract.test.js`.
 * API S4.3: 78 → 65 — les 13 clés `_` sans lecteur quittent le namespace.
 */
export const IMPORT_SURFACE = [
    "API",
    "BaseLayers",
    "Baselayers",
    "CONSTANTS",
    "Config",
    "Core",
    "DOMSecurity",
    "Errors",
    "Events",
    "GeoJSON",
    "Helpers",
    "I18n",
    "Introspection",
    "LayerManager",
    "Layers",
    "Log",
    "Security",
    "Storage",
    "Sync",
    "ThemeCache",
    "UI",
    "Utils",
    "Validators",
    "_APIController",
    "_ConfigLoader",
    "_DataConverter",
    "_GeoJSONLayerConfig",
    "_GeoJSONLayerManager",
    "_GeoJSONLoader",
    "_LayerManagerControl",
    "_LayerManagerStyleSelector",
    "_LayerVisibilityManager",
    "_OfflineDetector",
    "_UIComponents",
    "_UIEventDelegation",
    "_UITheme",
    "_Validators",
    "_app",
    "_registry",
    "_version",
    "boot",
    "bootInfo",
    "createMap",
    "establishBaseline",
    "events",
    "fetch",
    "get",
    "getAllMaps",
    "getHealth",
    "getMap",
    "getMetrics",
    "getModule",
    "getNamespace",
    "getPerformanceReport",
    "hasModule",
    "init",
    "loadConfig",
    "mark",
    "measure",
    "notify",
    "plugins",
    "post",
    "registry",
    "setTheme",
    "version",
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tier 2 — PRE-BOOT, measured in a real browser (SUPERSET assertion)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The floor the real browser must clear before boot.
 *
 * Asserted as a SUPERSET, not an equality: `deploy-core/init.js` legitimately mounts plugin
 * namespaces on top before boot, so the page surface is legitimately WIDER.
 *
 * ⚠️ `requireMap` was REMOVED from this list on 24/07/2026 (backlog R.10) — a correction of the
 * probe, not of the code. `GeoLeaf.requireMap` went away at S13 with `utils/general/map-helpers.ts`
 * (0 callers, 0 `global.d.ts` entry, 0 documentation) and is mounted nowhere. The artefact tier
 * had followed; this list had not. **They diverged for eleven days** although the comment then
 * sitting here required them to stay in sync — which is to say the probe failed for anyone who
 * ran it, and nobody ran it. A check never run checks nothing.
 *
 * That class of drift is now mechanised: `MIN ⊆ IMPORT ⊆ POST` is asserted, in the static tier,
 * so it cannot wait for someone to launch a browser.
 */
export const IMPORT_SURFACE_MIN = [
    "API",
    "CONSTANTS",
    "Config",
    "Core",
    "DOMSecurity",
    "Errors",
    "Helpers",
    "I18n",
    "Introspection",
    "LayerManager",
    "Log",
    "Security",
    "Storage",
    "UI",
    "Utils",
    "Validators",
    "_APIController",
    "_registry",
    "_version",
    "boot",
    "fetch",
    "get",
    "getHealth",
    "getMap",
    "loadConfig",
    "mark",
    "measure",
    "notify",
    "plugins",
    "post",
    "registry",
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tier 3 — POST-BOOT, measured under Node after a real `startApp()`
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The frozen post-boot namespace surface — the 0-regression oracle.
 *
 * **Load-bearing for four things**: the golden-master test, the `MIN ⊆ IMPORT ⊆ POST` chain,
 * and gates HOST-01/HOST-02 of `verify-host-contract-sync.cjs`, which reads this array's AST.
 * Loosen it and all four loosen with it.
 *
 * API S4.5: 103 → 102, `Filters` removed with the plural namespace and its route engine.
 * API S4.3: 102 → 89 — 13 clés `_` retirées. Aucune n'avait de lecteur, et aucune n'était
 *           déclarée dans `GeoLeafGlobal` (HOST-02 indifférent).
 */
export const EXPECTED_FACADE_KEYS = [
    "API",
    "BaseLayers",
    "Baselayers",
    "Branding",
    "CONSTANTS",
    "Cluster",
    "Config",
    "Coordinates",
    "Core",
    "DOMSecurity",
    "Errors",
    "Events",
    "FeatureInfo",
    "Filter",
    "GeoJSON",
    "Geolocation",
    "Helpers",
    "I18n",
    "Introspection",
    "Labels",
    // S2 de `roadmap_feature-selecteurs-ui` — capacité `language-switcher`.
    "LanguageSwitcher",
    "LayerManager",
    "Layers",
    "Legend",
    "Log",
    "NotificationSystem",
    "Notifications",
    "PWA",
    "Permalink",
    // S1 de `roadmap_feature-selecteurs-ui` — capacité `profile-switcher`.
    "ProfileSwitcher",
    "Scale",
    "Security",
    "Share",
    "Storage",
    "Sync",
    "Taxonomy",
    "ThemeCache",
    // S3 de `roadmap_feature-selecteurs-ui` — capacité `theme-palette`.
    "ThemePalette",
    "ThemeSelector",
    "ThemeToggle",
    "UI",
    "Utils",
    "Validators",
    "_APIController",
    "_Cluster",
    "_ConfigLoader",
    "_DataConverter",
    "_GeoJSONLayerConfig",
    "_GeoJSONLayerManager",
    "_GeoJSONLoader",
    "_LabelButtonManager",
    "_LabelRenderer",
    "_LayerManagerControl",
    "_LayerManagerStyleSelector",
    "_LayerVisibilityManager",
    "_LegendControl",
    "_LegendGenerator",
    "_OfflineDetector",
    "_UIComponents",
    "_UIEventDelegation",
    "_UINotifications",
    "_UITheme",
    "_Validators",
    "_VectorTiles",
    "_app",
    "_registry",
    "_version",
    "boot",
    "bootInfo",
    "createMap",
    "establishBaseline",
    "events",
    "fetch",
    "get",
    "getAllMaps",
    "getHealth",
    "getMap",
    "getMetrics",
    "getModule",
    "getNamespace",
    "getPerformanceReport",
    "hasModule",
    "init",
    "loadConfig",
    "mark",
    "measure",
    "notify",
    "plugins",
    "post",
    "registry",
    "setTheme",
    "version",
];

/**
 * Façades opted INTO depth-2 measurement.
 *
 * Deliberately the intersection with `GeoLeafHost`: those are the members a plugin actually
 * calls, so freezing `Events.on` rather than merely `Events` is where the value is.
 *
 * ## Élargie de 8 à 23 le 10/08/2026 — contrat inverse, tâches 1.4 / 1.5
 *
 * Jusqu'à cette date, `GeoLeaf.UI` (23 membres), `Storage` (25), `Utils` (31), `plugins` (17),
 * `Legend`, `Labels`, `Taxonomy`, `Filter`, `Baselayers`, `ThemeSelector`, `Introspection`,
 * `FeatureInfo`, `LayerManager` et `events` pouvaient perdre leurs membres **un par un** sans
 * qu'aucune gate ne rougisse — exactement le défaut que l'en-tête d'`EXPECTED_FACADE_MEMBERS`
 * raconte pour `Events.on`. Les 14 clés ajoutées ferment ce trou **pour tout le monde**, pas
 * seulement pour le consommateur qui a motivé le sprint.
 *
 * **Deux vagues, deux motifs, et l'ordre compte pour la relecture** :
 *   ① les 8 façades que la roadmap nomme au titre du gain interne (`UI`, `Legend`, `Labels`,
 *      `Storage`, `Introspection`, `Filter`, `Taxonomy`, `plugins`) ;
 *   ② les 6 que les chemins `required.public` du manifeste de consommation rendent
 *      nécessaires (`events`, `Baselayers`, `LayerManager`, `Utils`, `ThemeSelector`,
 *      `FeatureInfo`) — sans elles, CC-01 sortirait en `exit 2` sur 12 chemins qu'il ne peut
 *      pas lire, ce que CC-06 impose plutôt que de les rendre verts en silence.
 *
 * **Critère d'admission, appliqué et non supposé** : une façade n'entre que si `members` et
 * `membersAgain` (30 ms d'écart, `boot-golden-master.test.js`) coïncident. La mesure du
 * 10/08/2026 a porté sur **les 92 clés de l'oracle**, pas seulement sur les 22 candidates —
 * mesurer large est ce qui permet d'affirmer que **zéro** clé est instable, là où une mesure
 * bornée aux candidates n'aurait pu affirmer que « aucune des candidates ». Refus explicite du
 * repli « on la met quand même et on verra » : un test intermittent finit toujours `skip`é.
 *
 * ⚠️ **`BaseLayers` (casse haute) n'entre PAS, et ce n'est pas un oubli.** Elle et `Baselayers`
 * mesurent les **11 mêmes membres** — c'est le même objet sous deux clés. Geler les deux
 * figerait deux fois la même chose ; c'est `Baselayers` qui est retenue parce que c'est le nom
 * que le manifeste aval appelle. Un chemin `BaseLayers.*` écrit un jour tombera donc dans la
 * portée non couverte, et **CC-06 le nommera** au lieu de le rendre vert.
 *
 * ⚠️ `registry`, `_registry` and `_app` are **excluded on purpose**. `GeoLeaf.registry` and
 * `GeoLeaf._registry` are the same `ModuleRegistry` instance, whose `private readonly _modules`,
 * `_initOrder` and `_initialized` (`app/module-registry.ts:48-54`) are `private` only to the
 * compiler — at runtime `Object.getOwnPropertyNames` hands them over. Freezing them would make
 * the oracle red on the first internal refactor, and the human reaction to that is to
 * rubber-stamp the baseline, which kills the oracle. (The `_`-prefix filter in `walkNamespace`
 * already drops them; this list is the second lock.)
 *
 * ⚠️ Conséquence assumée de cette exclusion, à ne pas taire : `_app.initApp`, que le manifeste
 * aval porte en `private_tolerated`, **ne sera jamais vérifiable en profondeur 2**. Le code
 * CC-02 de `verify-consumer-contract.cjs` le DIT, avec ce motif, plutôt que de le rendre vert.
 *
 * 🛑 **`_LabelButtonManager` est le SEUL `_` de cette liste, et c'est une décision, pas un
 * accident.** L'objection écrite juste au-dessus vise `registry` / `_registry` / `_app` pour un
 * motif PRÉCIS — ce sont des instances de `ModuleRegistry` dont les champs `private` sont
 * effacés au runtime, donc l'oracle rougirait au premier refactor interne. Ce motif ne
 * s'applique pas ici, et deux mesures le disent : la façade rend **3 membres stables**
 * (`createButton`, `removeButtons`, `syncImmediate`), et **l'aval dépend de l'un d'eux** —
 * `syncImmediate` est appelé par `geoleaf_core/mixin_symbols_labels.js`, entrée
 * `private_tolerated` du manifeste. Un membre dont un consommateur dépend est précisément ce
 * qu'on gèle ; le geler ailleurs serait du zèle, ne pas le geler ici serait le laisser partir
 * comme les neuf clés qui ont produit ce sprint.
 *
 * ⚠️ **Et `_GeoJSONLoader` n'y entre PAS, pour une raison mesurée et non par symétrie.**
 * L'entrée aval est `_GeoJSONLoader._loadSingleLayer`, dont le membre est `_`-préfixé :
 * `walkNamespace` le filtre à la profondeur 2 **par construction**. Mesure du 10/08/2026 —
 * la descente rend `loadAllLayersConfigsForLayerManager` et `loadFromActiveProfile`, pas
 * `_loadSingleLayer`. L'ajouter à cette liste ne rendrait donc rien vérifiable : ce serait
 * du gel qui ne garde rien, et il aurait l'air d'en garder. Les trois autres `_` du manifeste
 * (`_LayerVisibilityManager`, `_GeoJSONLayerConfig`, `_GeoJSONLayerManager`) sont nommés en
 * **profondeur 1** par l'aval, donc l'oracle de tête suffit — descendre y ajouterait du rouge
 * de refactor interne sans ajouter de garde.
 */
export const DEPTH2_FACADES = [
    "Baselayers",
    "Config",
    "Core",
    "Events",
    "FeatureInfo",
    "Filter",
    "GeoJSON",
    "I18n",
    "Introspection",
    "Labels",
    "LayerManager",
    "Layers",
    "Legend",
    "Notifications",
    "Storage",
    "Sync",
    "Taxonomy",
    "ThemeSelector",
    "UI",
    "Utils",
    "_LabelButtonManager",
    "events",
    "plugins",
];

/**
 * Depth-2 membership of the façades listed in {@link DEPTH2_FACADES} — 258 members.
 *
 * ⚠️ **Ce nombre était 83 jusqu'au 10/08/2026** (8 façades). Il se **dérive**, il ne se
 * recopie pas — et la commande est ci-dessous, parce qu'un compte écrit en prose à côté de
 * la liste qu'il compte est un compte qui divergera :
 *
 *     node -e 'import("./scripts/lib/namespace-surface.mjs").then(m => console.log(
 *       Object.values(m.EXPECTED_FACADE_MEMBERS).reduce((a, b) => a + b.length, 0)))'
 *
 * ⚠️ **`Utils.performanceProfiler` est absent de `Utils`, et c'est par construction** : c'est
 * un accesseur **non énumérable**, que `walkNamespace` enregistre par son nom uniquement quand
 * il est atteignable par `getOwnPropertyNames` sur la chaîne de prototypes — ce qui n'est pas
 * le cas ici. La classe `PerformanceProfiler` (majuscule), elle, y est. Les deux ne sont pas
 * le même symbole, et confondre les deux ferait ajouter à la main une ligne que le golden
 * master rendrait immédiatement rouge en `d.missing`.
 *
 * ## Why depth 2 is where the value is
 *
 * The three tiers above freeze \`GeoLeaf.Events\`. What a plugin actually calls is
 * \`GeoLeaf.Events.on\`. Commenting out \`on\` in \`kernel/events/facade.ts\` left every
 * surface test GREEN until this list existed: the key was still there, holding an object
 * that had lost the only method anyone uses.
 *
 * ## What is NOT in here, and why
 *
 * Members prefixed \`_\` are filtered by \`walkNamespace\` itself. \`registry\` / \`_registry\` /
 * \`_app\` are excluded from \`DEPTH2_FACADES\` (a test locks that): they are the same
 * \`ModuleRegistry\` instance, whose \`private\` fields are erased at runtime and would make
 * this list red on the first internal refactor.
 *
 * Measured after a real \`startApp()\` under Node with MapLibre mocked, then measured AGAIN
 * 30 ms later — the golden master asserts the two agree. Unlike depth 1, this surface depends
 * on how far the module \`init()\`s got, and a list that shifts between two reads is the start
 * of an intermittent test. An intermittent test ends up skipped.
 */
export const EXPECTED_FACADE_MEMBERS = {
    "Baselayers": [
        "destroy",
        "getActiveId",
        "getActiveKey",
        "getActiveLayer",
        "getBaseLayers",
        "init",
        "refreshBasemap",
        "registerBaseLayer",
        "registerBaseLayers",
        "setActive",
        "setBaseLayer",
    ],
    "Config": [
        "get",
        "getActiveProfile",
        "getActiveProfileId",
        "getActiveProfileMapping",
        "getAll",
        "getModuleConfig",
        "getSection",
        "getSource",
        "init",
        "isLoaded",
        "isProfilePoiMappingEnabled",
        "loadActiveProfileResources",
        "loadUrl",
        "set",
    ],
    "Core": [
        "destroy",
        "getAdapter",
        "getMap",
        "getTheme",
        "hasMap",
        "init",
        "listMaps",
        "setTheme",
    ],
    "Events": [
        "off",
        "on",
        "once",
    ],
    "FeatureInfo": [
        "close",
        "getConfig",
        "isEnabled",
        "openPopup",
        "openSidePanel",
    ],
    "Filter": [
        "applyFilter",
        "applyNow",
        "getActiveFilter",
        "getConfig",
        "hasActiveFilters",
        "isEnabled",
        "proximity",
        "reset",
    ],
    "GeoJSON": [
        "DEFAULT_STYLES",
        "STYLE_OPERATORS",
        "calculateBounds",
        "clearFeatureFilter",
        "evaluateStyleCondition",
        "extractCoordinates",
        "filterFeatures",
        "getAllLayers",
        "getFeatureProperty",
        "getFeatures",
        "getGeometryType",
        "getLayerById",
        "getLayerConfig",
        "getLayerData",
        "hideLayer",
        "init",
        "isLineGeometry",
        "isPointGeometry",
        "isPolygonGeometry",
        "loadFromActiveProfile",
        "removeLayer",
        "setLayerStyle",
        "showLayer",
        "toggleLayer",
        "updateLayerData",
        "validateFeature",
        "validateFeatureCollection",
    ],
    "I18n": [
        "getActiveLang",
        "getLabel",
        "registerDict",
        "t",
    ],
    "Introspection": [
        "getActiveModules",
        "getAllCapabilities",
        "getCapabilitySchema",
        "getCapabilityStatus",
        "getModuleSchema",
    ],
    "Labels": [
        "areLabelsEnabled",
        "destroy",
        "disableLabels",
        "enableLabels",
        "getConfig",
        "hasLabelConfig",
        "init",
        "initializeLayerLabels",
        "isEnabled",
        "refreshLabels",
        "toggleLabels",
    ],
    // ⚠️ 2 membres seulement, et c'est la mesure. Une façade courte est le cas où l'on est
    // tenté de conclure « la descente n'a rien lu » : la distinguer d'une descente vide est
    // exactement ce que la clé `LayerManager` de `DEPTH2_FACADES` rend vérifiable.
    "LayerManager": [
        "init",
        "refresh",
    ],
    "Layers": [
        "addFeature",
        "clear",
        "clearVisibleSubset",
        "getFeatureById",
        "getFeatureCount",
        "getFeatures",
        "hasLayer",
        "listLayerIds",
        "mergeFeatures",
        "patchFeature",
        "removeFeature",
        "setData",
        "setFeatureState",
        "setVisibleSubset",
        "updateFeatureId",
    ],
    "Legend": [
        "getAllLayers",
        "hideLegend",
        "hideLoadingOverlay",
        "init",
        "isLegendVisible",
        "loadLayerLegend",
        "removeLegend",
        "setLayerVisibility",
        "showLoadingOverlay",
        "toggleAccordion",
    ],
    "Notifications": [
        "clearAll",
        "dismiss",
        "error",
        "getStatus",
        "info",
        "notify",
        "show",
        "success",
        "warning",
    ],
    // ⚠️ `Cache` / `cache`, `CacheManager` / `cacheManager`, `DB` / `db` : les paires ne sont
    // PAS des doublons de relevé, ce sont bien six membres distincts sur la façade — les
    // formes capitalisées sont les constructeurs, les minuscules les instances. Les écrire
    // toutes est ce qui fait rougir le retrait de l'une des deux moitiés.
    "Storage": [
        "Cache",
        "CacheManager",
        "DB",
        "OfflineDetector",
        "applyEdit",
        "cache",
        "cacheManager",
        "clearAll",
        "close",
        "db",
        "discardQuarantined",
        "getOfflineProfiles",
        "getStats",
        "getSyncReport",
        "init",
        "isAvailable",
        "isOffline",
        "isPluginLoaded",
        "isProfileAvailableOffline",
        "mayEdit",
        "pullLayer",
        "pushOutbox",
        "requeueQuarantined",
        "whenReady",
        "wireModules",
    ],
    "Sync": [
        "getHandler",
        "getHandlers",
        "registerHandler",
    ],
    "Taxonomy": [
        "ensureSprite",
        "getCategories",
        "getFieldMappings",
        "getIconVariants",
        "getIcons",
        "getLayerCategories",
        "isEnabled",
        "resolveBadgeStyle",
        "resolveMarkerPaint",
        "resolvePoiIcon",
        "resolveTitleIcon",
    ],
    "ThemeSelector": [
        "destroy",
        "getCurrentTheme",
        "getPrimaryThemes",
        "getSecondaryThemes",
        "getThemes",
        "init",
        "isInitialized",
        "nextTheme",
        "previousTheme",
        "setTheme",
    ],
    // ⚠️ `BUILD`, `VERSION` et `Notifications` sont des membres de `UI` au sens de la marche :
    // ce ne sont pas des méthodes, mais ils sont énumérables et leur disparition serait une
    // rupture pour qui les lit. La liste gèle une SURFACE, pas un ensemble d'appels.
    "UI": [
        "BUILD",
        "Notifications",
        "VERSION",
        "activateDesktopPanel",
        "applyTheme",
        "cleanup",
        "clearNotifications",
        "destroyDesktopPanel",
        "getCurrentTheme",
        "getModuleStatus",
        "init",
        "initAutoTheme",
        "initDesktopPanel",
        "initMobileToolbar",
        "initThemeToggle",
        "notify",
        "setTheme",
        "showError",
        "showInfo",
        "showNotification",
        "showSuccess",
        "showWarning",
        "toggleTheme",
    ],
    "Utils": [
        "DOMSecurity",
        "ErrorLogger",
        "EventListenerManager",
        "FetchError",
        "FetchHelper",
        "Formatters",
        "ObjectUtils",
        "PerformanceProfiler",
        "ScaleUtils",
        "TimerManager",
        "applyCssText",
        "compareByOrder",
        "createElement",
        "debounce",
        "deepMerge",
        "ensureMap",
        "events",
        "fireMapEvent",
        "getActiveProfile",
        "getDistance",
        "getLog",
        "getNestedValue",
        "globalEventManager",
        "hasNestedPath",
        "mergeOptions",
        "poiToFeature",
        "resolveField",
        "setNestedValue",
        "throttle",
        "validateUrl",
        "wktToGeoJSON",
    ],
    // Seule façade `_` gelée en profondeur 2 — motif écrit sur `DEPTH2_FACADES` : l'aval
    // appelle `syncImmediate`, et c'est la seule chose qui justifie de descendre ici.
    "_LabelButtonManager": [
        "createButton",
        "removeButtons",
        "syncImmediate",
    ],
    // `events` et `Events` mesurent les 3 mêmes membres — c'est la même façade sous deux clés,
    // et les deux sont gelées parce que le manifeste aval appelle `events.on` / `events.off`
    // tandis que le contrat `GeoLeafHost` nomme `Events`. Geler une seule des deux laisserait
    // l'autre route se vider sans témoin.
    "events": [
        "off",
        "on",
        "once",
    ],
    "plugins": [
        "canActivate",
        "ensureLoadedForAction",
        "getAvailableModules",
        "getInfo",
        "getLayerLoader",
        "getLazyUISlots",
        "getLoadedPlugins",
        "isLazyAction",
        "isLazyAvailable",
        "isLoaded",
        "load",
        "register",
        "registerCapability",
        "registerLayerLoader",
        "registerLazy",
        "registerLazyForAction",
        "reportPlugins",
    ],
};
