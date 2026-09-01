/**
 * globals.geojson.ts branch coverage (B5 — full build)
 *
 * Targets:
 *   - All _g.GeoLeaf.* assignments: _GeoJSONShared, GeoJSON,
 *     _GeoJSONLayerManager (Object.assign), _GeoJSONLoader (Object.assign + special delegation),
 *     _GeoJSONStyleResolver, _StyleRules,
 *     _LayerVisibilityManager, _WorkerManager, _GeoJSONLayerConfig, _GeoJSONPopupTooltip,
 *   - Special: _GeoJSONLoader._resolveDataFilePath delegation to LayerConfigManager
 *
 * S5 (presets build): `_VectorTiles` is NO LONGER assigned here — vector-tiles became a
 * capability, and this file is kernel. What remains to test is the seam: `getVectorTiles()`
 * reads the global lazily, so it resolves whether the capability was embarked or not.
 *
 * Strategy: vi.hoisted() + vi.mock() on all imported modules. ESM static import
 * ensures Istanbul instruments globals.geojson.ts (no require() bypass).
 */

const mocks = vi.hoisted(() => {
    const GeoJSONShared = { STYLE_OPERATORS: { eq: "==" } };
    const FeatureValidator = { validate: vi.fn() };
    const GeoJSONStyleResolver = {
        evaluateStyleRules: vi.fn(),
        getNestedValue: vi.fn(),
    };
    const VectorTiles = { addTiles: vi.fn() };
    const LayerVisibilityManager = { toggle: vi.fn() };
    const WorkerManager = { spawn: vi.fn() };
    const resolveDataFilePath = vi.fn((p) => p);
    const LayerConfigManager = { resolveDataFilePath };
    const PopupTooltip = { show: vi.fn() };
    const LayerManagerStore = { add: vi.fn() };
    const LayerManagerVisibility = { show: vi.fn() };
    const LayerManagerStyle = { apply: vi.fn() };
    const LayerManagerIntegration = { wire: vi.fn() };
    // ⚠️ These two doubles carried `loadProfile` and `loadLayer` — two names
    // no facade carries. `LoaderProfile` (= `Loader`, profile.ts)
    // exposes `loadFromActiveProfile`, `_loadLayersByBatch`,
    // `_getDefaultThemeLayerIds`, `_loadLayersInIdle` and
    // `loadAllLayersConfigsForLayerManager`; `LoaderSingleLayer` exposes
    // `_loadSingleLayer`. The merge assertion thus compared the fixture to
    // itself, on BOTH sides of the `toBe`.
    // 🛑 `loadLayer` escaped the MDS detector while `loadProfile` fell into
    // it: the name does exist in source, but as a LOCAL VARIABLE
    // (`profile.ts`,
    // `const loadLayer = _deps?.getLoader()?._loadSingleLayer`). The floor
    // the guard documents — "the name appears somewhere" is not "the
    // carrier carries it" — seen here on the twin of a flagged symbol, in
    // the same assertion.
    const LoaderProfile = { loadFromActiveProfile: vi.fn() };
    const LoaderSingleLayer = { _loadSingleLayer: vi.fn() };
    const GeoJSONCore = class GeoJSONCore {};
    const captured = { loaderDeps: null };
    const setupProfileDeps = vi.fn((d) => {
        captured.loaderDeps = d;
    });
    const setupSingleLayerDeps = vi.fn();
    const setupPopupTooltipDeps = vi.fn();

    return {
        GeoJSONShared,
        FeatureValidator,
        GeoJSONStyleResolver,
        VectorTiles,
        LayerVisibilityManager,
        WorkerManager,
        LayerConfigManager,
        resolveDataFilePath,
        PopupTooltip,
        LayerManagerStore,
        LayerManagerVisibility,
        LayerManagerStyle,
        LayerManagerIntegration,
        LoaderProfile,
        LoaderSingleLayer,
        GeoJSONCore,
        setupProfileDeps,
        setupSingleLayerDeps,
        setupPopupTooltipDeps,
        captured,
    };
});

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: mocks.GeoJSONShared,
}));
vi.mock("../../src/kernel/geojson/feature-validator.js", () => ({
    FeatureValidator: mocks.FeatureValidator,
}));
vi.mock("../../src/kernel/geojson/style-resolver.js", () => ({
    GeoJSONStyleResolver: mocks.GeoJSONStyleResolver,
}));
vi.mock("../../src/kernel/geojson/visibility-manager.js", () => ({
    VisibilityManager: mocks.LayerVisibilityManager,
}));
vi.mock("../../src/kernel/geojson/worker-manager.js", () => ({
    WorkerManager: mocks.WorkerManager,
}));
vi.mock("../../src/kernel/geojson/layer-config-manager.js", () => ({
    LayerConfigManager: mocks.LayerConfigManager,
}));
vi.mock("../../src/kernel/geojson/popup-tooltip.js", () => ({
    PopupTooltip: mocks.PopupTooltip,
    setupPopupTooltipDeps: mocks.setupPopupTooltipDeps,
}));
vi.mock("../../src/kernel/geojson/layers/store.js", () => ({
    LayerManagerStore: mocks.LayerManagerStore,
}));
vi.mock("../../src/kernel/geojson/layers/visibility.js", () => ({
    LayerManagerVisibility: mocks.LayerManagerVisibility,
}));
vi.mock("../../src/kernel/geojson/layers/style.js", () => ({
    LayerManagerStyle: mocks.LayerManagerStyle,
}));
vi.mock("../../src/kernel/geojson/layers/integration.js", () => ({
    LayerManagerIntegration: mocks.LayerManagerIntegration,
}));
vi.mock("../../src/kernel/geojson/loader/profile.js", () => ({
    LoaderProfile: mocks.LoaderProfile,
    setupProfileDeps: mocks.setupProfileDeps,
}));
vi.mock("../../src/kernel/geojson/loader/single-layer.js", () => ({
    LoaderSingleLayer: mocks.LoaderSingleLayer,
    setupSingleLayerDeps: mocks.setupSingleLayerDeps,
}));
vi.mock("../../src/kernel/geojson/core.js", () => ({ GeoJSONCore: mocks.GeoJSONCore }));

// Side-effect import: triggers all B5 assignments
import "../../src/globals/globals.geojson.ts";
import {
    getAllLayerConfigs,
    setAllLayerConfigs,
} from "../../src/kernel/shared/layer-configs-state.js";
// Trigger explicitly (ESM import — same module instance as globals.geojson.ts).

const GL = globalThis.GeoLeaf;

describe("globals.geojson.ts — B5 registrations (full build)", () => {
    // ── Core GeoJSON ──────────────────────────────────────────────────────────

    it("registers GeoLeaf.GeoJSON public class", () => {
        expect(GL.GeoJSON).toBe(mocks.GeoJSONCore);
    });

    // ── Style ─────────────────────────────────────────────────────────────────

    // ── Managers ──────────────────────────────────────────────────────────────

    it("does NOT register GeoLeaf._VectorTiles (S5 — it is a capability, not kernel)", () => {
        // The kernel must not pull `capabilities/vector-tiles` into its static closure.
        // The write now belongs to VECTOR_TILES_INSTALLER.registerGlobals().
        expect(GL._VectorTiles).toBeUndefined();
    });

    it("registers GeoLeaf._LayerVisibilityManager", () => {
        expect(GL._LayerVisibilityManager).toBe(mocks.LayerVisibilityManager);
    });

    it("registers GeoLeaf._GeoJSONLayerConfig", () => {
        expect(GL._GeoJSONLayerConfig).toBe(mocks.LayerConfigManager);
    });

    // ── LayerManager (Object.assign of 4 sub-modules) ─────────────────────────

    it("registers GeoLeaf._GeoJSONLayerManager with all 4 sub-module properties merged", () => {
        expect(GL._GeoJSONLayerManager).toBeDefined();
        expect(GL._GeoJSONLayerManager.add).toBe(mocks.LayerManagerStore.add);
        expect(GL._GeoJSONLayerManager.show).toBe(mocks.LayerManagerVisibility.show);
        expect(GL._GeoJSONLayerManager.apply).toBe(mocks.LayerManagerStyle.apply);
        expect(GL._GeoJSONLayerManager.wire).toBe(mocks.LayerManagerIntegration.wire);
    });

    // ── Loader (Object.assign + special delegation) ───────────────────────────

    it("registers GeoLeaf._GeoJSONLoader with all loader sub-module properties merged", () => {
        expect(GL._GeoJSONLoader).toBeDefined();
        expect(GL._GeoJSONLoader.loadFromActiveProfile).toBe(
            mocks.LoaderProfile.loadFromActiveProfile
        );
        expect(GL._GeoJSONLoader._loadSingleLayer).toBe(mocks.LoaderSingleLayer._loadSingleLayer);
    });

    it("registers GeoLeaf._GeoJSONLoader._resolveDataFilePath delegating to LayerConfigManager", () => {
        expect(typeof GL._GeoJSONLoader._resolveDataFilePath).toBe("function");
        GL._GeoJSONLoader._resolveDataFilePath("/data/test.json");
        expect(mocks.resolveDataFilePath).toHaveBeenCalledWith("/data/test.json");
    });
});

// ── Phase 10-F — _loaderDeps service locator coverage ─────────────────────────

describe("globals.geojson.ts — Phase 10-F _loaderDeps service locator", () => {
    // _loaderDeps captured via setupProfileDeps mock implementation
    // (Vitest forks clears mock.calls between tests — use captured ref instead)
    const deps = mocks.captured.loaderDeps;

    it("setupProfileDeps received _loaderDeps object", () => {
        expect(deps).not.toBeNull();
        expect(deps).toBeTypeOf("object");
    });

    it("getLayerManager returns _GeoJSONLayerManager", () => {
        expect(deps.getLayerManager()).toBe(GL._GeoJSONLayerManager);
    });

    it("getLoader returns _GeoJSONLoader", () => {
        expect(deps.getLoader()).toBe(GL._GeoJSONLoader);
    });

    it("getFeatureValidator returns FeatureValidator", () => {
        expect(deps.getFeatureValidator()).toBe(mocks.FeatureValidator);
    });

    it("getLayerConfig returns LayerConfigManager", () => {
        expect(deps.getLayerConfig()).toBe(mocks.LayerConfigManager);
    });

    // S5 — the seam that makes vector-tiles droppable. The kernel no longer holds a static
    // reference: it reads the global the capability's installer wrote. Both branches matter —
    // an entry that omits the capability has NO writer, and the loader must see `undefined`
    // (`single-layer.ts`: `if (VT && VT.shouldUseVectorTiles(def))` → plain GeoJSON).
    it("getVectorTiles returns undefined when the capability is not embarked", () => {
        delete GL._VectorTiles;
        expect(deps.getVectorTiles()).toBeUndefined();
    });

    it("getVectorTiles reads GeoLeaf._VectorTiles lazily once the installer has written it", () => {
        GL._VectorTiles = mocks.VectorTiles;
        expect(deps.getVectorTiles()).toBe(mocks.VectorTiles);
        delete GL._VectorTiles;
    });

    it("getWorkerManager returns WorkerManager", () => {
        expect(deps.getWorkerManager()).toBe(mocks.WorkerManager);
    });

    it("getConfig returns _g.GeoLeaf.Config (optional chain)", () => {
        const conf = { test: true };
        GL.Config = conf;
        expect(deps.getConfig()).toBe(conf);
        delete GL.Config;
    });

    it("getUtils returns _g.GeoLeaf.Utils (optional chain)", () => {
        const utils = { debounce: vi.fn() };
        GL.Utils = utils;
        expect(deps.getUtils()).toBe(utils);
        delete GL.Utils;
    });

    it("getCore returns _g.GeoLeaf.Core (optional chain)", () => {
        const core = { getMap: vi.fn() };
        GL.Core = core;
        expect(deps.getCore()).toBe(core);
        delete GL.Core;
    });

    it("getLabels returns _g.GeoLeaf.Labels (optional chain)", () => {
        const labels = { init: vi.fn() };
        GL.Labels = labels;
        expect(deps.getLabels()).toBe(labels);
        delete GL.Labels;
    });

    it("getDataConverter returns _g.GeoLeaf._DataConverter (optional chain)", () => {
        const dc = { convert: vi.fn() };
        GL._DataConverter = dc;
        expect(deps.getDataConverter()).toBe(dc);
        delete GL._DataConverter;
    });

    // The seam no longer goes through `_g.GeoLeaf._allLayerConfigs` but
    // through the `kernel/shared/layer-configs-state` store. The state was
    // not a facade: nothing public exposed it, no plugin read it, and it was
    // OUTSIDE the three oracles — hence renameable with no gate flinching.
    // These two tests follow the seam, not the channel.
    it("getAllLayerConfigs lit le store partagé", () => {
        const configs = [{ id: "layer1" }];
        setAllLayerConfigs(configs);
        expect(deps.getAllLayerConfigs()).toBe(configs);
        setAllLayerConfigs(undefined);
    });

    it("setAllLayerConfigs écrit dans le store partagé", () => {
        const configs = [{ id: "layer2" }];
        deps.setAllLayerConfigs(configs);
        expect(getAllLayerConfigs()).toBe(configs);
        setAllLayerConfigs(undefined);
    });
});
