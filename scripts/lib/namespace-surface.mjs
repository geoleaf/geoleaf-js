/*!
 * GeoLeaf — namespace surface, single source
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */

/**
 * The ONE description of the `globalThis.GeoLeaf` surface, and the one walk that measures it.
 *
 * ## Why this file exists
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
 * `Object.defineProperty(gl, "_APIController", { get })` (`kernel/api/controller.ts`), and
 * reading it constructs an `APIController`, whose `init()` → `_setupModuleAccess()` →
 * `_scanExistingModules()` re-reads `_APIController` **while it is still being built**. That
 * re-entrancy blew the stack in a browser for real; it is held back only by the instance
 * parking of `controller.ts`. A walk that touched `.value` — or worse, descended — would
 * replay it during the very measurement that is supposed to observe the namespace, not change
 * it. `getOwnPropertyDescriptor` does not fire the accessor; that is why it is used.
 *
 * @param {object} root - the namespace object (`globalThis.GeoLeaf`).
 * @param {{ descend?: string[] }} [opts] - `descend` opts INTO depth 2, façade by façade.
 * @returns {{ keys: string[], kinds: Record<string,string>, members: Record<string,string[]> }}
 */
export function walkNamespace(root, opts) {
    const descend = (opts && opts.descend) || [];
    const keys = Object.keys(root).sort();
    const kinds = {};
    const members = {};

    // Depth-2 member names: own enumerable keys PLUS prototype methods (a façade may be a class
    // instance), minus `constructor` and minus anything `_`-prefixed. Read by descriptor too:
    // a getter at depth 2 is recorded by name, never invoked.
    const memberNames = function (value) {
        const found = {};
        let obj = value;
        while (obj && obj !== Object.prototype && obj !== Function.prototype) {
            const own = Object.getOwnPropertyNames(obj);
            for (let i = 0; i < own.length; i++) {
                const n = own[i];
                if (n === "constructor" || n.charAt(0) === "_") continue;
                const d = Object.getOwnPropertyDescriptor(obj, n);
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

    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const d = Object.getOwnPropertyDescriptor(root, k);
        if (d && typeof d.get === "function") {
            kinds[k] = "getter";
            continue; // never .value, never d.get(), never descend
        }
        const v = d ? d.value : undefined;
        kinds[k] =
            typeof v === "function"
                ? "function"
                : v && typeof v === "object"
                  ? "object"
                  : "primitive";
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
 * 64 keys — the pre-boot surface as the lazy phase left it (only `globals.core.ts` ran its
 *           setups at import; the other five were lazy, and the rustine compensated).
 * S6 Lot 2: 88 keys — phase A restored. Measured diff on the built bundle: +24, **-0**.
 *           Nothing was lost — this is the fix, not drift.
 * KERNEL S6: 87 keys — `_StyleUtils` removed (sole member `normalizeStyle`, no production
 *           reader). Internal `_`-prefixed surface → not a breaking change.
 * Moved here verbatim from `bundle-boot-contract.test.js`.
 * 78 → 65 — the 13 readerless `_` keys leave the namespace.
 *
 * ── 🛑 WHAT THIS LIST DOES NOT COVER — AND IT IS NOT AN OVERSIGHT ───────────
 *
 * Its perimeter is the `globals/` chain, imported directly by the test. A member mounted
 * **elsewhere** in the graph pulled by `bundle-esm-entry.ts` is therefore INVISIBLE to
 * this oracle, whatever it does — and the oracle is an **EXACT equality**
 * (`expect(importSurface).toEqual([...IMPORT_SURFACE].sort())`, `bundle-boot-contract.test.js`),
 * not an inclusion: such a member cannot enter it without being added HERE, by hand.
 *
 * **The complete census, measured on 2026-08-16** — every mount outside `globals/`:
 *
 *   ```bash
 *   grep -rnE "_g\.GeoLeaf\.[A-Za-z_]+\s*=" packages/core/src --include=*.ts | grep -v "/globals/"
 *   ```
 *
 *   | File                                     | Member(s)                                              | In the list?    |
 *   | ---------------------------------------- | ------------------------------------------------------ | --------------- |
 *   | `kernel/storage/facade.ts`               | `Storage`                                              | ✅ yes          |
 *   | `kernel/ui/ui-api.ts`                    | `UI`                                                   | ✅ yes          |
 *   | `utils/performance/runtime-metrics.ts`   | `getPerformanceMetrics`, `getRuntimeMetrics`, `resetRuntimeMetrics` | ❌ **no** |
 *
 * The pool is thus **exactly three members**, and no more — what the founding note
 * suspected without having established it. `Storage` and `UI` are mounted outside
 * `globals/` too, but they are in the list: they do not belong to the class.
 *
 * ⚠️ **TWO statements of the original note are FALSE, and correcting them changes the move.**
 *   ① "covered by the artifact tier (`bundle-boot-contract.test.js`, 88 keys)" — no: the
 *      test names them nowhere, and its oracle is this very list. They are outside BOTH
 *      tiers.
 *   ② "mounted **unconditionally**" — no: `runtime-metrics.ts` mounts them under
 *      `if (_g.GeoLeaf) { … }`. A boot where the namespace does not exist yet does not
 *      mount them.
 *
 * **Decision (2026-08-16): write this perimeter down, do NOT extend the list.** Adding
 * them would freeze three members into a surface oracle — an irreversible commitment —
 * for a defect that is one of **visibility**, not of contract. What was missing was not
 * coverage; it was that nobody had written where the oracle stops.
 */
export const IMPORT_SURFACE = [
    "API",
    "BaseLayers",
    "Baselayers",
    "CONSTANTS",
    // `GeoLeaf.Capabilities` is set by `globals.api.ts`, hence at IMPORT time and not at
    // boot: a host can subscribe before `GeoLeaf.boot()`, which is exactly the case it
    // must cover — facts declared during boot would otherwise be inaudible to it.
    "Capabilities",
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
 * 103 → 102, `Filters` removed with the plural namespace and its route engine.
 * 102 → 89 — 13 `_` keys removed. None had a reader, and none was declared in
 *           `GeoLeafGlobal` (HOST-02 indifferent).
 */
export const EXPECTED_FACADE_KEYS = [
    "API",
    "BaseLayers",
    "Baselayers",
    "Branding",
    "CONSTANTS",
    // 2026-08-24 — `GeoLeaf.Capabilities`, the channel through which a capability's
    // absence becomes a FACT observable by the host. BRAND-NEW public namespace on a
    // published `3.0.0`: its shape is frozen from the first publication.
    "Capabilities",
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
    // `language-switcher` capability.
    "LanguageSwitcher",
    "LayerManager",
    "Layers",
    "Legend",
    "Log",
    "NotificationSystem",
    "Notifications",
    "PWA",
    "Permalink",
    // `profile-switcher` capability.
    "ProfileSwitcher",
    "Scale",
    "Security",
    "Share",
    "Storage",
    "Sync",
    "Taxonomy",
    "ThemeCache",
    // `theme-palette` capability.
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
 * ## Widened from 8 to 23 on 2026-08-10 — the reverse contract
 *
 * Until that date, `GeoLeaf.UI` (23 members), `Storage` (25), `Utils` (31), `plugins`
 * (17), `Legend`, `Labels`, `Taxonomy`, `Filter`, `Baselayers`, `ThemeSelector`,
 * `Introspection`, `FeatureInfo`, `LayerManager` and `events` could lose their members
 * **one by one** without any gate turning red — exactly the defect the
 * `EXPECTED_FACADE_MEMBERS` header recounts for `Events.on`. The 14 added keys close that
 * hole **for everyone**, not just for the consumer that motivated the work.
 *
 * **Two waves, two rationales, and the order matters for re-reading**:
 *   ① the 8 facades named for the internal gain (`UI`, `Legend`, `Labels`, `Storage`,
 *      `Introspection`, `Filter`, `Taxonomy`, `plugins`);
 *   ② the 6 the consumer manifest's `required.public` paths make necessary (`events`,
 *      `Baselayers`, `LayerManager`, `Utils`, `ThemeSelector`, `FeatureInfo`) — without
 *      them, CC-01 would exit `2` on 12 paths it cannot read, which CC-06 mandates rather
 *      than greening them in silence.
 *
 * **Admission criterion, applied and not assumed**: a facade only enters if `members` and
 * `membersAgain` (30 ms apart, `boot-golden-master.test.js`) coincide. The 2026-08-10
 * measurement covered **the oracle's 92 keys**, not just the 22 candidates — measuring
 * wide is what allows stating that **zero** keys are unstable, where a measurement bounded
 * to the candidates could only have stated "none of the candidates". Explicit refusal of
 * the fallback "add it anyway and see": an intermittent test always ends up `skip`ped.
 *
 * ⚠️ **`BaseLayers` (upper case) does NOT enter, and it is no oversight.** It and
 * `Baselayers` measure the **same 11 members** — the same object under two keys. Freezing
 * both would pin the same thing twice; `Baselayers` is the one kept because it is the name
 * the downstream manifest calls. A `BaseLayers.*` path written some day will thus fall in
 * the uncovered scope, and **CC-06 will name it** instead of greening it.
 *
 * ⚠️ `registry`, `_registry` and `_app` are **excluded on purpose**. `GeoLeaf.registry` and
 * `GeoLeaf._registry` are the same `ModuleRegistry` instance, whose `private readonly _modules`,
 * `_initOrder` and `_initialized` (`app/module-registry.ts`) are `private` only to the
 * compiler — at runtime `Object.getOwnPropertyNames` hands them over. Freezing them would make
 * the oracle red on the first internal refactor, and the human reaction to that is to
 * rubber-stamp the baseline, which kills the oracle. (The `_`-prefix filter in `walkNamespace`
 * already drops them; this list is the second lock.)
 *
 * ⚠️ Accepted consequence of this exclusion, not to be silenced: `_app.initApp`, which
 * the downstream manifest carries as `private_tolerated`, **will never be verifiable at
 * depth 2**. The CC-02 code of `verify-consumer-contract.cjs` SAYS so, with this
 * rationale, rather than greening it.
 *
 * 🛑 **`_LabelButtonManager` is the ONLY `_` in this list, and that is a decision, not
 * an accident.** The objection written just above targets `registry` / `_registry` /
 * `_app` for a PRECISE reason — those are `ModuleRegistry` instances whose `private`
 * fields are erased at runtime, so the oracle would redden at the first internal
 * refactor. That reason does not apply here, and two measurements say so: the facade
 * returns **3 stable members** (`createButton`, `removeButtons`, `syncImmediate`), and
 * **the downstream depends on one of them** — `syncImmediate` is called by
 * `geoleaf_core/mixin_symbols_labels.js`, a `private_tolerated` entry of the manifest. A
 * member a consumer depends on is precisely what gets frozen; freezing it elsewhere would
 * be zeal, not freezing it here would be letting it go the way of the nine keys that
 * produced this work.
 *
 * ⚠️ **And `_GeoJSONLoader` does NOT enter, for a measured reason and not by symmetry.**
 * The downstream entry is `_GeoJSONLoader._loadSingleLayer`, whose member is
 * `_`-prefixed: `walkNamespace` filters it at depth 2 **by construction**. 2026-08-10
 * measurement — the descent returns `loadAllLayersConfigsForLayerManager` and
 * `loadFromActiveProfile`, not `_loadSingleLayer`. Adding it to this list would thus make
 * nothing verifiable: it would be freezing that guards nothing while looking like it
 * does. The manifest's three other `_` entries (`_LayerVisibilityManager`,
 * `_GeoJSONLayerConfig`, `_GeoJSONLayerManager`) are named at **depth 1** by the
 * downstream, so the head oracle suffices — descending would add internal-refactor red
 * without adding a guard.
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
 * ⚠️ **This number was 83 until 2026-08-10** (8 facades). It is **derived**, not copied
 * — and the command is below, because a count written in prose next to the list it counts
 * is a count that will diverge:
 *
 *     node -e 'import("./scripts/lib/namespace-surface.mjs").then(m => console.log(
 *       Object.values(m.EXPECTED_FACADE_MEMBERS).reduce((a, b) => a + b.length, 0)))'
 *
 * ⚠️ **`Utils.performanceProfiler` is absent from `Utils`, and that is by construction**:
 * it is a **non-enumerable** accessor, which `walkNamespace` records by name only when it
 * is reachable through `getOwnPropertyNames` on the prototype chain — not the case here.
 * The `PerformanceProfiler` class (capitalized) IS there. The two are not the same
 * symbol, and conflating them would lead to hand-adding a line the golden master would
 * immediately turn red as `d.missing`.
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
    Baselayers: [
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
    Config: [
        "clearThemesCache",
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
    Core: [
        "destroy",
        "getAdapter",
        "getMap",
        "getTheme",
        "hasMap",
        "init",
        "isAttached",
        "listMaps",
        "reattach",
        "setTheme",
    ],
    Events: ["off", "on", "once"],
    FeatureInfo: ["close", "getConfig", "isEnabled", "openPopup", "openSidePanel"],
    Filter: [
        "applyFilter",
        "applyNow",
        "getActiveFilter",
        "getConfig",
        "hasActiveFilters",
        "isEnabled",
        "proximity",
        "reset",
    ],
    GeoJSON: [
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
    I18n: ["getActiveLang", "getLabel", "registerDict", "t"],
    Introspection: [
        "getActiveModules",
        "getAllCapabilities",
        "getCapabilitySchema",
        "getCapabilityStatus",
        "getModuleSchema",
    ],
    Labels: [
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
    // ⚠️ Only 2 members, and that is the measurement. A short facade is the case where
    // one is tempted to conclude "the descent read nothing": telling it apart from an
    // empty descent is exactly what the `LayerManager` key of `DEPTH2_FACADES` makes
    // verifiable.
    LayerManager: ["init", "refresh"],
    Layers: [
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
    Legend: [
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
    Notifications: [
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
    // ⚠️ `Cache` / `cache`, `CacheManager` / `cacheManager`, `DB` / `db`: the pairs are
    // NOT census duplicates, they really are six distinct members on the facade — the
    // capitalized forms are the constructors, the lowercase ones the instances. Writing
    // them all is what makes removing either half turn red.
    Storage: [
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
    Sync: ["getHandler", "registerHandler"],
    Taxonomy: [
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
    ThemeSelector: [
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
    // ⚠️ `BUILD`, `VERSION` and `Notifications` are members of `UI` in the walk's sense:
    // they are not methods, but they are enumerable and their disappearance would be a
    // break for whoever reads them. The list freezes a SURFACE, not a set of calls.
    UI: [
        "BUILD",
        "Notifications",
        "VERSION",
        "activateDesktopPanel",
        "applyTheme",
        "cleanup",
        "clearNotifications",
        "closePane",
        "closePanel",
        "destroyDesktopPanel",
        "getCurrentTheme",
        "getModuleStatus",
        "getOpenPanel",
        "init",
        "initAutoTheme",
        "initDesktopPanel",
        "initMobileToolbar",
        "initThemeToggle",
        "isImmersive",
        "notify",
        "openPane",
        "openPanel",
        "registerPanelPane",
        "setImmersive",
        "setTheme",
        "showError",
        "showInfo",
        "showNotification",
        "showSuccess",
        "showWarning",
        "toggleTheme",
    ],
    Utils: [
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
    // The only `_` facade frozen at depth 2 — rationale written on `DEPTH2_FACADES`: the
    // downstream calls `syncImmediate`, and that is the only thing justifying a descent
    // here.
    _LabelButtonManager: ["createButton", "removeButtons", "syncImmediate"],
    // `events` and `Events` measure the same 3 members — the same facade under two keys,
    // and both are frozen because the downstream manifest calls `events.on` /
    // `events.off` while the `GeoLeafHost` contract names `Events`. Freezing only one
    // would let the other route empty out unwitnessed.
    events: ["off", "on", "once"],
    plugins: [
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
