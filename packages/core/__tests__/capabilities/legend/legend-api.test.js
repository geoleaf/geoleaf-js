/**
 */
/* Phase 5.20 - modules/legend/legend-api */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// D2: legend-api requests sprite injection from the MapLibre adapter (not the
// former `GeoLeaf._POIMarkers` global). Mock the adapter to spy on the call.
const mockEnsureSprite = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../../src/utils/loaders/profile-sprite-loader.js", () => ({
    ensureProfileSpriteInjectedSync: mockEnsureSprite,
    isProfileSpriteReady: () =>
        document.querySelector('svg[data-geoleaf-sprite="profile"]') !== null,
    registerSpriteIcons: vi.fn(() => Promise.resolve()),
    hasProfileSprite: vi.fn(() => false),
}));

// --- Phase 5.20: modules/legend/legend-api (Legend module) ---
describe("Legend API (modules/legend/legend-api)", () => {
    let LegendAPI;
    const mockConfigGet = vi.fn();
    const mockConfigGetActiveProfile = vi.fn();
    const mockConfigGetAll = vi.fn(() => ({}));
    const mockControlCreate = vi.fn(() => ({
        _container: document.createElement("div"),
        hide: vi.fn(),
        updateMultiLayerContent: vi.fn(),
    }));

    beforeAll(async () => {
        globalThis.GeoLeaf = globalThis.GeoLeaf || {};
        globalThis.GeoLeaf.Config = {
            get: mockConfigGet,
            getActiveProfile: mockConfigGetActiveProfile,
            getAll: mockConfigGetAll,
        };
        globalThis.GeoLeaf._LegendControl = { create: mockControlCreate };
        globalThis.GeoLeaf._LegendGenerator = null;
        globalThis.GeoLeaf._LayerVisibilityManager = null;
        globalThis.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
        );
        LegendAPI = (await import("../../../src/capabilities/legend/public-api.js")).Legend;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockConfigGet.mockImplementation((key) => {
            if (key === "data") return { profilesBasePath: "profiles" };
            return null;
        });
        mockConfigGetActiveProfile.mockReturnValue({
            id: "test-profile",
            layers: [{ id: "layer1", configFile: "layer1.json" }],
        });
    });

    describe("init", () => {
        it("returns false when map is null", () => {
            const result = LegendAPI.init(null);
            expect(result).toBe(false);
        });

        it("returns true when map provided and Config available", () => {
            const map = {};
            const result = LegendAPI.init(map, { title: "Custom" });
            expect(result).toBe(true);
        });

        it("uses getAll when getActiveProfile not a function", () => {
            const prev = globalThis.GeoLeaf.Config.getActiveProfile;
            delete globalThis.GeoLeaf.Config.getActiveProfile;
            mockConfigGetAll.mockReturnValue({
                id: "fallback",
                layers: [{ id: "ly1", configFile: "c.json" }],
            });
            const cfgMap = {
                id: "fallback",
                layers: [{ id: "ly1" }],
                data: { profilesBasePath: "profiles" },
            };
            mockConfigGet.mockImplementation((k) => cfgMap[k] ?? null);
            const result = LegendAPI.init({});
            globalThis.GeoLeaf.Config.getActiveProfile = prev;
            expect(result).toBe(true);
            expect(LegendAPI.getAllLayers().has("ly1")).toBe(true);
        });
    });

    describe("getAllLayers", () => {
        it("returns a Map", () => {
            LegendAPI.init({});
            const layers = LegendAPI.getAllLayers();
            expect(layers).toBeInstanceOf(Map);
        });
    });

    describe("setLayerVisibility", () => {
        it("updates visibility for known layer", () => {
            LegendAPI.init({});
            LegendAPI.setLayerVisibility("layer1", true);
            const layers = LegendAPI.getAllLayers();
            expect(layers.get("layer1")).toBeDefined();
            expect(layers.get("layer1").visible).toBe(true);
        });
    });

    describe("removeLegend", () => {
        it("runs without throwing; removes control when it was attached (debounced rebuild)", () => {
            const map = { removeControl: vi.fn(), addControl: vi.fn() };
            LegendAPI.init(map);
            expect(() => LegendAPI.removeLegend()).not.toThrow();
            expect(LegendAPI.isLegendVisible()).toBe(false);
        });
    });

    describe("isLegendVisible", () => {
        it("returns false when no control attached", () => {
            LegendAPI.init({});
            LegendAPI.removeLegend();
            expect(LegendAPI.isLegendVisible()).toBe(false);
        });
    });

    describe("loadLayerLegend", () => {
        it("returns early when layerId not in profile", () => {
            LegendAPI.init({});
            fetch.mockClear();
            LegendAPI.loadLayerLegend("unknown-layer", "default", {
                label: "Other",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            expect(fetch).not.toHaveBeenCalled();
        });

        it("returns early when styles.directory missing", () => {
            LegendAPI.init({});
            fetch.mockClear();
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "Layer 1",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: { available: [{ id: "default", file: "default.json" }] },
            });
            expect(fetch).not.toHaveBeenCalled();
        });

        it("loads layer legend when map and layer in profile and fetch resolves", async () => {
            LegendAPI.init({});
            const mockGenerate = vi.fn(() => ({ sections: [] }));
            globalThis.GeoLeaf._LegendGenerator = { generateLegendFromStyle: mockGenerate };
            globalThis.fetch = vi.fn((url) => {
                if (url?.includes("taxonomy"))
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ fill: "#333" }) });
            });
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "Layer 1",
                geometryType: "point",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await new Promise((r) => setTimeout(r, 50));
            expect(mockGenerate).toHaveBeenCalled();
        });

        it("handles fetch reject in loadLayerLegend", async () => {
            LegendAPI.init({});
            globalThis.fetch = vi.fn((url) => {
                if (url?.includes("taxonomy"))
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                return Promise.reject(new Error("network error"));
            });
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "Layer 1",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await new Promise((r) => setTimeout(r, 30));
            expect(fetch).toHaveBeenCalled();
        });
    });

    describe("init with empty profile layers", () => {
        it("initializes without adding layers when profile has empty layers array", () => {
            mockConfigGetActiveProfile.mockReturnValue({ id: "empty-profile", layers: [] });
            const sizeBefore = LegendAPI.getAllLayers().size;
            const result = LegendAPI.init({});
            expect(result).toBe(true);
            expect(LegendAPI.getAllLayers().size).toBe(sizeBefore);
        });
    });

    describe("hideLegend", () => {
        it("calls control.hide when control exists", async () => {
            const map = { removeControl: vi.fn(), addControl: vi.fn() };
            const controlInstance = {
                _container: document.createElement("div"),
                hide: vi.fn(),
                updateMultiLayerContent: vi.fn(),
            };
            mockControlCreate.mockReturnValue(controlInstance);
            LegendAPI.init(map);
            const mockGenerate = vi.fn(() => ({ sections: [] }));
            globalThis.GeoLeaf._LegendGenerator = { generateLegendFromStyle: mockGenerate };
            globalThis.fetch = vi.fn((url) => {
                if (url?.includes("taxonomy"))
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ fill: "#333" }) });
            });
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "Layer 1",
                geometryType: "point",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await new Promise((r) => setTimeout(r, 200));
            LegendAPI.hideLegend();
            expect(controlInstance.hide).toHaveBeenCalled();
        });
    });

    describe("showLoadingOverlay and hideLoadingOverlay", () => {
        it("call through without throwing", async () => {
            const map = { removeControl: vi.fn(), addControl: vi.fn() };
            LegendAPI.init(map);
            const mockGenerate = vi.fn(() => ({ sections: [] }));
            globalThis.GeoLeaf._LegendGenerator = { generateLegendFromStyle: mockGenerate };
            globalThis.fetch = vi.fn((url) => {
                if (url?.includes("taxonomy"))
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ fill: "#333" }) });
            });
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "Layer 1",
                geometryType: "point",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await new Promise((r) => setTimeout(r, 200));
            expect(() => LegendAPI.showLoadingOverlay()).not.toThrow();
            expect(() => LegendAPI.hideLoadingOverlay()).not.toThrow();
        });
    });

    describe("branches supplémentaires", () => {
        const g = globalThis;

        beforeEach(() => {
            vi.clearAllMocks();
            mockConfigGet.mockImplementation((key) => {
                if (key === "data") return { profilesBasePath: "profiles" };
                return null;
            });
            mockConfigGetActiveProfile.mockReturnValue({
                id: "test-profile",
                layers: [{ id: "layer1", configFile: "layer1.json" }],
            });
            globalThis.fetch = vi.fn((url) => {
                if (url?.includes("taxonomy"))
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ fill: "#333" }) });
            });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("init sans Config.get — branche else (options par défaut)", () => {
            const savedConfig = g.GeoLeaf.Config;
            g.GeoLeaf.Config = null;
            const result = LegendAPI.init({});
            g.GeoLeaf.Config = savedConfig;
            expect(result).toBe(true);
        });

        // S10 F5: the legacy `_loadTaxonomy` fetch/profileId branches were removed
        // (it now reads `GeoLeaf.Taxonomy.getCategories` synchronously) — covered in
        // `legend-api-branches.test.js`.

        it("Generator absent — Log.error dans _applyStyleToLegend", async () => {
            const { Log } = await import("../../../src/utils/log/index.js");
            const savedGen = g.GeoLeaf._LegendGenerator;
            g.GeoLeaf._LegendGenerator = null;
            LegendAPI.init({});
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "L1",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await new Promise((r) => setTimeout(r, 30));
            expect(Log.error).toHaveBeenCalledWith("[Legend] LegendGenerator non disponible");
            g.GeoLeaf._LegendGenerator = savedGen;
        });

        it("showIconsOnMap — branche POIShared temporaire couverte", async () => {
            const mockGenerate = vi.fn(() => ({ sections: [] }));
            g.GeoLeaf._LegendGenerator = { generateLegendFromStyle: mockGenerate };
            LegendAPI.init({});
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "L1",
                geometryType: "point",
                showIconsOnMap: true,
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await new Promise((r) => setTimeout(r, 30));
            expect(mockGenerate).toHaveBeenCalled();
        });

        it("sprite injection requested via the adapter on loadLayerLegend", () => {
            mockEnsureSprite.mockClear();
            LegendAPI.init({});
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "L1",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            expect(mockEnsureSprite).toHaveBeenCalled();
        });

        // vi.isolateModules shim does not fully re-load module state in
        // Jest CJS mode. Depending on test execution order, _map may or may not be
        // set. Verify loadLayerLegend triggers an early-return warning in either case.
        it("loadLayerLegend with empty config — Log.warn (module isolé)", async () => {
            vi.resetModules();
            const { Legend: FreshLegend } =
                await import("../../../src/capabilities/legend/public-api.js");
            const { Log: FreshLog } = await import("../../../src/utils/log/index.js");
            FreshLegend.loadLayerLegend("layer1", "default", {});
            // Either "Module not initialized" (_map null) or "styles manquante pour layer1"
            expect(FreshLog.warn).toHaveBeenCalled();
        });

        it("_rebuildDisplay avec _allLayers vide — retour immédiat (module isolé)", async () => {
            vi.resetModules();
            mockConfigGetActiveProfile.mockReturnValueOnce({ id: "empty-p", layers: [] });
            const { Legend: FreshLegend } =
                await import("../../../src/capabilities/legend/public-api.js");
            const map = { addControl: vi.fn(), removeControl: vi.fn() };
            FreshLegend.init(map);
            // _allLayers is empty → _rebuildDisplay hits size===0 branch
            expect(() => FreshLegend._rebuildDisplay()).not.toThrow();
        });

        it("removeLegend avec _control et _map — remove() appelé sur le control", async () => {
            // Reset module _control state from previous tests before enabling fake timers
            LegendAPI.removeLegend();
            vi.useFakeTimers();
            const controlRemoveFn = vi.fn();
            const map = { removeControl: vi.fn(), addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const controlInstance = {
                _container: document.createElement("div"),
                hide: vi.fn(),
                updateMultiLayerContent: vi.fn(),
                addTo: vi.fn(),
                remove: controlRemoveFn,
            };
            mockControlCreate.mockReturnValueOnce(controlInstance);
            const mockGenerate = vi.fn(() => ({ sections: [] }));
            g.GeoLeaf._LegendGenerator = { generateLegendFromStyle: mockGenerate };
            LegendAPI.init(map);
            LegendAPI.setLayerVisibility("layer1", true);
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "L1",
                geometryType: "point",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            vi.runAllTimers();
            LegendAPI.removeLegend();
            expect(controlRemoveFn).toHaveBeenCalled();
        });

        it("hasIcons=true dans sections sans sprite — Log.info Icons detected", async () => {
            document
                .querySelectorAll('svg[data-geoleaf-sprite="profile"]')
                .forEach((el) => el.remove());

            const { Log } = await import("../../../src/utils/log/index.js");
            const map = { removeControl: vi.fn(), addControl: vi.fn() };
            mockControlCreate.mockReturnValue({
                _container: document.createElement("div"),
                hide: vi.fn(),
                updateMultiLayerContent: vi.fn(),
            });
            const mockGenerate = vi.fn(() => ({
                sections: [{ items: [{ icon: "my-icon" }] }],
            }));
            g.GeoLeaf._LegendGenerator = { generateLegendFromStyle: mockGenerate };
            LegendAPI.init(map);
            LegendAPI.setLayerVisibility("layer1", true);
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "L1",
                geometryType: "point",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await new Promise((r) => setTimeout(r, 200));
            expect(mockGenerate).toHaveBeenCalled();
            expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("Icons detected"));
        });

        it("layer non visible — filtré dans _updateLegendContent (line 245)", async () => {
            const map = { removeControl: vi.fn(), addControl: vi.fn() };
            mockControlCreate.mockReturnValue({
                _container: document.createElement("div"),
                hide: vi.fn(),
                updateMultiLayerContent: vi.fn(),
            });
            const mockGenerate = vi.fn(() => ({ sections: [] }));
            g.GeoLeaf._LegendGenerator = { generateLegendFromStyle: mockGenerate };
            LegendAPI.init(map);
            // layer1 starts as visible=false after init (reset by _initializeAllLayers)
            LegendAPI.loadLayerLegend("layer1", "default", {
                label: "L1",
                geometryType: "point",
                _profileId: "test-profile",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "default", file: "default.json" }],
                },
            });
            await new Promise((r) => setTimeout(r, 200));
            // layer not visible → filtered out; _applyStyleToLegend still ran
            expect(mockGenerate).toHaveBeenCalled();
        });

        it("_showLoadingOverlay timeout 12s — _hideLoadingOverlay déclenché", () => {
            vi.useFakeTimers();
            const map = { removeControl: vi.fn(), addControl: vi.fn() };
            const controlInst = {
                _container: document.createElement("div"),
                hide: vi.fn(),
                updateMultiLayerContent: vi.fn(),
            };
            mockControlCreate.mockReturnValue(controlInst);
            LegendAPI.init(map);
            LegendAPI._rebuildDisplay();
            LegendAPI.showLoadingOverlay();
            vi.advanceTimersByTime(13000);
            expect(controlInst._container.hasAttribute("aria-busy")).toBe(false);
        });
    });
});
