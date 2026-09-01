/**
 * Phase 60 — Step 1.7: src/globals/globals.geojson.ts (0% → 60%)
 */
const stub = vi.hoisted(() => ({}));
const fn = vi.hoisted(() => () => {});
vi.mock("../../src/kernel/geojson/shared.ts", () => ({ GeoJSONShared: stub }));
vi.mock("../../src/kernel/geojson/feature-validator.ts", () => ({
    FeatureValidator: stub,
}));
vi.mock("../../src/kernel/geojson/style-resolver.ts", () => ({
    GeoJSONStyleResolver: stub,
}));
// S5: no vector-tiles mock — globals.geojson.ts no longer imports it (it is a capability).
vi.mock("../../src/kernel/geojson/visibility-manager.ts", () => ({
    VisibilityManager: stub,
}));
vi.mock("../../src/kernel/geojson/worker-manager.ts", () => ({ WorkerManager: stub }));
vi.mock("../../src/kernel/geojson/layer-config-manager.ts", () => ({
    LayerConfigManager: { resolveDataFilePath: fn },
}));
vi.mock("../../src/kernel/geojson/popup-tooltip.ts", () => ({
    PopupTooltip: stub,
    setupPopupTooltipDeps: vi.fn(),
}));
// ⚠️ `LayerManagerStore` is imported by the module under test. The empty
// mock returned `undefined` through `setup.js`'s `require()` shim; the
// native mocker refuses an undeclared export. Declared with its de-facto
// value: the empty mock's intent is to neutralise, not to provide a double.
vi.mock("../../src/kernel/geojson/layers/store.ts", () => ({
    LayerManagerStore: undefined,
}));
vi.mock("../../src/kernel/geojson/layers/visibility.ts", () => ({
    LayerManagerVisibility: undefined,
}));
vi.mock("../../src/kernel/geojson/layers/style.ts", () => ({
    LayerManagerStyle: undefined,
}));
vi.mock("../../src/kernel/geojson/layers/integration.ts", () => ({
    LayerManagerIntegration: undefined,
}));
// ⚠️ PARTIAL mocks: they declared the `setup*Deps` the test uses, but not
// the other exports the module under test imports. The `require()` shim
// returned them `undefined` without a word; the native mocker throws.
// Completed with their de-facto value.
vi.mock("../../src/kernel/geojson/loader/profile.ts", () => ({
    setupProfileDeps: vi.fn(),
    LoaderProfile: undefined,
}));
vi.mock("../../src/kernel/geojson/loader/single-layer.ts", () => ({
    setupSingleLayerDeps: vi.fn(),
    LoaderSingleLayer: undefined,
    applyOgcRefreshedData: undefined,
}));
vi.mock("../../src/kernel/geojson/core.ts", () => ({ GeoJSONCore: stub }));

import "../../src/globals/globals.geojson.js";

describe("globals/globals.geojson (step 1.7)", () => {
    it("attache GeoJSON au namespace", () => {
        expect(globalThis.GeoLeaf).toBeDefined();
        expect(globalThis.GeoLeaf.GeoJSON).toBe(stub);
        expect(globalThis.GeoLeaf._GeoJSONLayerManager).toBeDefined();
        // `_GeoJSONShared` left the namespace (no reader).
        expect(globalThis.GeoLeaf._GeoJSONShared).toBeUndefined();
    });
});
