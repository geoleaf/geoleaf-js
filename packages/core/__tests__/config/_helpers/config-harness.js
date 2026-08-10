/**
 * Config-contract Phase C — shared mutation/observation harness (sprint S10+).
 *
 * Two observation surfaces, mirroring how the code actually reads config:
 *
 *  1. Global `GeoLeaf.Config.get(path)` consumers (clustering, poi,
 *     branding…) — `installConfig(partial)` seeds ConfigStore AND exposes
 *     `globalThis.GeoLeaf.Config.get` bound to it, exactly the path the code
 *     reads (e.g. geojson/clustering.ts:85 → `_g.GeoLeaf.Config.get`).
 *
 *  2. `map.*` resolution — observed at the `GeoLeaf.init()` seam in
 *     CoreMapModule/SharedModule/UIModule (formerly orchestrated by the legacy
 *     app/init.ts facade, removed — roadmap nettoyage Sprint 3 / A-1):
 *     each test file mocks globals/feature-modules/map-container (vi.mock must be
 *     file-local because it is hoisted) and reuses `makeFakeMap()` +
 *     `populateInitGeoLeaf()` from here to drive the module sequence directly,
 *     then asserts on `GeoLeaf.init.mock.calls`.
 *
 * Single source of truth = profiles/_reference (the test-only fixture). Tests
 * import its profile.json / features.json so the fixture and the assertions
 * cannot drift apart.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

import { ConfigStore } from "../../../src/kernel/config/storage.ts";

// _helpers → config → __tests__ → core → packages → <repo root>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
function readJson(rel) {
    return JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
}

/**
 * The reference fixture — exhaustive on B1 (root/profile) + B2 (features) +
 * B3 (ui) + B4 (basemaps/themes) + B5 (layers.json + {id}_config.json).
 * Each file mirrors its schema leaf-by-leaf so the fixture and the per-value
 * assertions cannot drift apart.
 */
export const REFERENCE_PROFILE = readJson("profiles/_reference/profile.json");
export const REFERENCE_FEATURES = readJson("profiles/_reference/config/core/features.json");
export const REFERENCE_UI = readJson("profiles/_reference/config/core/ui.json");
export const REFERENCE_BASEMAPS = readJson("profiles/_reference/config/core/basemaps.json");
export const REFERENCE_THEMES = readJson("profiles/_reference/config/core/themes.json");
export const REFERENCE_LAYERS = readJson("profiles/_reference/config/core/layers.json");
export const REFERENCE_LAYER_CONFIG = readJson(
    "profiles/_reference/layers/reference-points/reference-points_config.json"
);
/** B6 style fixtures (sprint S14): defaut = point (label STRING branch), alt = surface/line (label OBJECT branch). */
export const REFERENCE_STYLE = readJson(
    "profiles/_reference/layers/reference-points/styles/defaut.json"
);
export const REFERENCE_STYLE_ALT = readJson(
    "profiles/_reference/layers/reference-points/styles/alt.json"
);
/**
 * B7 plugin/module fixtures (sprint S15). modules.<id> blocks have NO schema
 * (profile.schema.json declares them additionalProperties:true → validated by
 * the plugin, skipped by validate-profiles), so these are plain config-shaped
 * fixtures carrying the keys the CORE reads. REFERENCE_MAPPING IS schema-driven
 * (mapping.schema.json) — it is a multi-source config with one named block
 * `reference` whose `mapping` is flat (string→string), so it drives
 * Normalization.normalizePoiWithMapping deterministically (single block → auto-resolved).
 */
export const REFERENCE_MAPPING = readJson("profiles/_reference/config/core/mapping.json");
export const REFERENCE_MODULE_OFFLINE = readJson("profiles/_reference/config/plugins/offline.json");
export const REFERENCE_MODULE_LEGEND = readJson("profiles/_reference/config/plugins/legend.json");

/** Structured deep clone via JSON (config is plain JSON, no functions/dates). */
export const clone = (value) => JSON.parse(JSON.stringify(value));

/** Recursive deep-merge of plain objects (arrays/scalars replace, not merge). */
export function deepMerge(base, override) {
    const out = clone(base);
    if (!override || typeof override !== "object" || Array.isArray(override)) return out;
    for (const key of Object.keys(override)) {
        const src = override[key];
        const tgt = out[key];
        if (
            src &&
            typeof src === "object" &&
            !Array.isArray(src) &&
            tgt &&
            typeof tgt === "object" &&
            !Array.isArray(tgt)
        ) {
            out[key] = deepMerge(tgt, src);
        } else {
            out[key] = src === undefined ? tgt : clone(src);
        }
    }
    return out;
}

/**
 * Seed the consolidated config and expose `globalThis.GeoLeaf.Config.get`
 * bound to ConfigStore (the real read path of global consumers).
 * @returns {object} ConfigStore
 */
export function installConfig(partial = {}) {
    ConfigStore.init(clone(partial));
    const g = globalThis;
    g.GeoLeaf = g.GeoLeaf || {};
    g.GeoLeaf.Config = g.GeoLeaf.Config || {};
    g.GeoLeaf.Config.get = (path, dflt) => ConfigStore.get(path, dflt);
    return ConfigStore;
}

/**
 * Seed config from the reference features.json (spread at the merged profile
 * root, exactly like the loader) with optional per-test overrides.
 * @returns {object} ConfigStore
 */
export function installFeatures(override = {}) {
    return installConfig(deepMerge(REFERENCE_FEATURES, override));
}

/**
 * Seed config from the reference ui.json (its top-level keys — ui,
 * layerManagerConfig, scaleConfig — are spread at the merged profile root by the
 * loader, exactly how the code reads them) with optional per-test overrides.
 * (The legend config moved to modules.legend — see REFERENCE_MODULE_LEGEND, S10 F2.)
 * @returns {object} ConfigStore
 */
export function installUI(override = {}) {
    return installConfig(deepMerge(REFERENCE_UI, override));
}

/** Tear down config + the global Config stub. Call from afterEach(). */
export function resetConfig() {
    ConfigStore._config = null;
    const g = globalThis;
    if (g.GeoLeaf && g.GeoLeaf.Config) delete g.GeoLeaf.Config.get;
}

/** Minimal fake map matching what app/init.ts expects after GeoLeaf.init(). */
export function makeFakeMap() {
    return {
        fitBounds: vi.fn(),
        on: vi.fn(),
        getNativeMap: vi.fn().mockReturnValue({ resize: vi.fn() }),
        options: {},
    };
}

/**
 * Populate the (vi.mock'd) GeoLeaf namespace with the full set of UI/module
 * stubs CoreMapModule/SharedModule/UIModule touch, so the boot module sequence
 * runs all branches without throwing. `GeoLeaf.init` is set to return `fakeMap`
 * (override via opts.init).
 */
export function populateInitGeoLeaf(GeoLeaf, fakeMap, overrides = {}) {
    GeoLeaf.init = vi.fn().mockReturnValue(fakeMap);
    GeoLeaf._SWRegister = { register: vi.fn().mockResolvedValue({}) };
    GeoLeaf.setTheme = vi.fn();
    GeoLeaf.UI = {
        init: vi.fn(),
        buildFilterPanelFromActiveProfile: vi.fn(),
        initFilterToggle: vi.fn(),
        initProximityFilter: vi.fn(),
        Branding: { init: vi.fn() },
        CoordinatesDisplay: { init: vi.fn() },
        CacheButton: { init: vi.fn() },
    };
    GeoLeaf.Legend = { init: vi.fn() };
    GeoLeaf.LayerManager = { init: vi.fn() };
    GeoLeaf.initScaleControl = vi.fn();
    GeoLeaf.Labels = { init: vi.fn() };
    GeoLeaf._version = "1.2.0";
    GeoLeaf._UINotifications = { dismiss: vi.fn(), info: vi.fn() };
    GeoLeaf.Storage = null;
    GeoLeaf._OfflineDetector = null;
    Object.assign(GeoLeaf, overrides);
    return GeoLeaf;
}

/**
 * happy-dom's Event constructor calls performance.now(); stub it so event
 * creation inside the boot module sequence does not throw. Call from beforeEach().
 */
export function stubPerformance() {
    if (typeof performance !== "undefined") {
        vi.stubGlobal("performance", {
            now: vi.fn(() => 0),
            mark: vi.fn(),
            measure: vi.fn(),
            getEntriesByName: vi.fn().mockReturnValue([{ duration: 100 }]),
        });
    }
}
