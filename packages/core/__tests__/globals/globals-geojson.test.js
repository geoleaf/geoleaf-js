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
// ⚠️ `LayerManagerStore` est importé par le module sous test. Le mock vide rendait
// `undefined` via le shim `require()` de `setup.js` ; le mocker natif refuse un export non
// déclaré. Déclaré avec sa valeur de fait : l'intention du mock vide est de neutraliser,
// pas de fournir un double.
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
// ⚠️ Mocks PARTIELS : ils déclaraient le `setup*Deps` dont le test se sert, mais pas les
// autres exports que le module sous test importe. Le shim `require()` les rendait
// `undefined` sans rien dire ; le mocker natif jette. Complétés avec leur valeur de fait.
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
        // `_GeoJSONShared` a quitté le namespace à l'API S4.3 (aucun lecteur).
        expect(globalThis.GeoLeaf._GeoJSONShared).toBeUndefined();
    });
});
