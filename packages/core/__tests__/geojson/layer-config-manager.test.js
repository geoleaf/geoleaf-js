/**
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() }),
}));

import { LayerConfigManager } from "../../src/kernel/geojson/layer-config-manager.js";
import { styleCache } from "../../src/utils/loaders/style-cache.js";
import { loadAndValidateStyle } from "../../src/utils/loaders/style-loader-core.js";

describe("geojson/layer-config-manager", () => {
    const g = globalThis;

    afterEach(() => {
        delete g.GeoLeaf;
        // S5.2 — `loadDefaultStyle` now goes through the shared style cache, which is
        // module-global and outlives a test. Without this, a case that seeds `p1:lyr1:def`
        // makes the next one pass on the cache instead of on the behaviour it asserts.
        styleCache.clear();
    });

    describe("resolveDataFilePath", () => {
        it("resolves ../ path with profile and data config", () => {
            g.GeoLeaf = {
                Config: {
                    get: vi.fn((path) =>
                        path === "data"
                            ? { profilesBasePath: "profiles", activeProfile: "tourism" }
                            : null
                    ),
                },
            };
            const r = LayerConfigManager.resolveDataFilePath("../raw/file.json", { id: "tourism" });
            expect(r).toBe("profiles/tourism/raw/file.json");
        });

        it("returns absolute path when dataFile starts with /", () => {
            const r = LayerConfigManager.resolveDataFilePath(
                "/absolute/path.json",
                { id: "x" },
                "layerDir"
            );
            expect(r).toBe("/absolute/path.json");
        });

        it("resolves relative to layerDirectory when provided", () => {
            g.GeoLeaf = {
                Config: {
                    get: vi.fn((path) =>
                        path === "data"
                            ? { profilesBasePath: "profiles", activeProfile: "p1" }
                            : null
                    ),
                },
            };
            const r = LayerConfigManager.resolveDataFilePath(
                "data.json",
                { id: "p1" },
                "layers/poi"
            );
            expect(r).toBe("profiles/p1/layers/poi/data.json");
        });

        it("fallback relative to profile when no layerDirectory", () => {
            g.GeoLeaf = {
                Config: {
                    get: vi.fn((path) =>
                        path === "data"
                            ? { profilesBasePath: "profiles", activeProfile: "p1" }
                            : null
                    ),
                },
            };
            const r = LayerConfigManager.resolveDataFilePath("file.json", { id: "p1" });
            expect(r).toBe("profiles/p1/file.json");
        });
    });

    describe("inferGeometryType", () => {
        it("returns def.geometryType when string", () => {
            expect(LayerConfigManager.inferGeometryType({ geometryType: "line" }, {})).toBe("line");
        });

        it("returns point when first feature has Point", () => {
            const data = { features: [{ geometry: { type: "Point" } }] };
            expect(LayerConfigManager.inferGeometryType({}, data)).toBe("point");
        });

        it("returns line when first feature has LineString", () => {
            const data = { features: [{ geometry: { type: "LineString" } }] };
            expect(LayerConfigManager.inferGeometryType({}, data)).toBe("line");
        });

        it("returns polygon when first feature has Polygon", () => {
            const data = { features: [{ geometry: { type: "Polygon" } }] };
            expect(LayerConfigManager.inferGeometryType({}, data)).toBe("polygon");
        });

        it("returns unknown when no features", () => {
            expect(LayerConfigManager.inferGeometryType({}, { features: [] })).toBe("unknown");
            expect(LayerConfigManager.inferGeometryType({}, null)).toBe("unknown");
        });
        it("returns unknown when features has no geometry", () => {
            expect(LayerConfigManager.inferGeometryType({}, { features: [{}] })).toBe("unknown");
        });
    });

    describe("loadLayerLegend", () => {
        it("returns early when layerDef is null", () => {
            expect(() => LayerConfigManager.loadLayerLegend({ id: "p1" }, null)).not.toThrow();
        });

        it("returns early when layerDef has no legends config", () => {
            expect(() =>
                LayerConfigManager.loadLayerLegend({ id: "p1" }, { id: "lyr1" })
            ).not.toThrow();
        });

        it("calls GeoLeaf.Legend.loadLayerLegend when Legend available", () => {
            const loadLayerLegendFn = vi.fn();
            g.GeoLeaf = { Legend: { loadLayerLegend: loadLayerLegendFn } };
            LayerConfigManager.loadLayerLegend(
                { id: "tourism", basePath: "../profiles/tourism" },
                {
                    id: "poi_all",
                    style: "default",
                    legends: { directory: "legends", default: "default.legend.json" },
                }
            );
            expect(loadLayerLegendFn).toHaveBeenCalledWith(
                "poi_all",
                "default",
                expect.any(Object)
            );
            g.GeoLeaf = undefined;
        });
    });

    describe("loadDefaultStyle", () => {
        it("throws when layerDef.styles.default is missing", async () => {
            await expect(
                LayerConfigManager.loadDefaultStyle("lyr1", { styles: {} })
            ).rejects.toThrow("No default style defined");
        });

        it("throws when _profileId or _layerDirectory missing", async () => {
            await expect(
                LayerConfigManager.loadDefaultStyle("lyr1", {
                    styles: { default: "def.json" },
                })
            ).rejects.toThrow("Missing metadata");
        });

        it("returns style JSON when fetch succeeds", async () => {
            // ⚠️ This fixture was `{ color: "#f00", weight: 2 }` until S5.2. That is not a style
            // this codebase can consume: `_applyPreloadedStyle` reads `defaultStyle` or `style`,
            // and would have found neither. The test asserted the pass-through of a shape
            // production cannot use — which is precisely why it never noticed that this path
            // skipped validation entirely.
            const styleData = { style: { color: "#ff0000", weight: 2 } };
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(styleData),
                })
            );
            g.GeoLeaf = { Config: { get: () => ({ profilesBasePath: "profiles" }) } };
            const result = await LayerConfigManager.loadDefaultStyle("lyr1", {
                styles: { default: "def.json" },
                _profileId: "p1",
                _layerDirectory: "layers/lyr1",
            });
            expect(result).toEqual(styleData);
            g.GeoLeaf = undefined;
        });

        it("throws on HTTP error", async () => {
            globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
            g.GeoLeaf = { Config: { get: () => ({ profilesBasePath: "profiles" }) } };
            await expect(
                LayerConfigManager.loadDefaultStyle("lyr1", {
                    styles: { default: "def.json" },
                    _profileId: "p1",
                    _layerDirectory: "layers/lyr1",
                })
            ).rejects.toThrow("HTTP 404");
            g.GeoLeaf = undefined;
        });
    });

    /**
     * S5.2 — the boot path fetches each style ONCE.
     *
     * Two independent paths ask for the same style file at boot: the loader preloads it
     * (`_preloadStyle` → `loadDefaultStyle`) and the theme engine applies it
     * (`visibility.ts` → `loadAndValidateStyle`). They fetched the same URL twice — measured
     * at 16 requests for the 8 layers of the active profile's default theme.
     *
     * ⚠️ What makes them share is that both resolve to the SAME cache key
     * `profileId:layerId:styleId`, and the two derive `profileId` from different accessors
     * (`Config.get("data").activeProfile` here, `Config.getActiveProfile().id` there) and
     * `styleId` from different sources (a FILE name here, an ID there). Any drift between
     * those silently restores the double fetch without failing anything — which is exactly
     * what this test exists to catch.
     */
    describe("style fetch is shared with the theme path (S5.2)", () => {
        const styleFile = { style: { color: "#ff0000", weight: 2 } };
        const layerDef = {
            styles: {
                default: "defaut.json",
                available: [{ id: "defaut", label: "défaut", file: "defaut.json" }],
            },
            _profileId: "p1",
            _layerDirectory: "layers/lyr1",
        };

        beforeEach(() => {
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(styleFile) })
            );
            g.GeoLeaf = {
                Config: { get: () => ({ profilesBasePath: "profiles", activeProfile: "p1" }) },
            };
        });

        it("serves the theme path from the preload's cache entry — one fetch, not two", async () => {
            await LayerConfigManager.loadDefaultStyle("lyr1", layerDef);
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);

            // Exactly what `theme-applier/visibility.ts` issues for this layer.
            await loadAndValidateStyle("p1", "lyr1", "defaut", "defaut.json", "layers/lyr1");
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });

        it("resolves the style id from `available`, not from the file name", async () => {
            await LayerConfigManager.loadDefaultStyle("lyr1", {
                ...layerDef,
                styles: {
                    default: "defaut.json",
                    available: [{ id: "un-autre-id", label: "x", file: "defaut.json" }],
                },
            });
            // Keyed on the declared id, so the theme path — which only ever knows ids — hits it.
            await loadAndValidateStyle("p1", "lyr1", "un-autre-id", "defaut.json", "layers/lyr1");
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });

        it("honours `styles.directory` instead of assuming 'styles'", async () => {
            await LayerConfigManager.loadDefaultStyle("lyr1", {
                ...layerDef,
                styles: { ...layerDef.styles, directory: "themes-alt" },
            });
            expect(globalThis.fetch).toHaveBeenCalledWith(
                "profiles/p1/layers/lyr1/themes-alt/defaut.json"
            );
        });
    });
});

// ── T22 — geojson/layer-config-manager.ts branch coverage ─────────────────────
describe("geojson/layer-config-manager — T22 branch coverage", () => {
    afterEach(() => {
        delete globalThis.GeoLeaf;
        delete globalThis.L;
    });

    it("loadLayerLegend uses 'legends' fallback when legendsConfig has no directory (branch 55.1)", () => {
        const loadLayerLegendFn = vi.fn();
        globalThis.GeoLeaf = { Legend: { loadLayerLegend: loadLayerLegendFn } };
        LayerConfigManager.loadLayerLegend(
            { id: "tourism", basePath: "../profiles/tourism" },
            { id: "poi_all", style: "default", legends: { default: "default.legend.json" } }
        );
        expect(loadLayerLegendFn).toHaveBeenCalled();
    });

    it("loadLayerLegend uses activeStyle.legend.json when style is not 'default' (branch 56.1)", () => {
        const loadLayerLegendFn = vi.fn();
        globalThis.GeoLeaf = { Legend: { loadLayerLegend: loadLayerLegendFn } };
        LayerConfigManager.loadLayerLegend(
            { id: "tourism", basePath: "../profiles/tourism" },
            { id: "poi_all", style: "dark", legends: { directory: "legends" } }
        );
        expect(loadLayerLegendFn).toHaveBeenCalledWith("poi_all", "dark", expect.any(Object));
    });

    it("loadLayerLegend uses './profiles/id' fallback when profile has no basePath (branch 58.1)", () => {
        const loadLayerLegendFn = vi.fn();
        globalThis.GeoLeaf = { Legend: { loadLayerLegend: loadLayerLegendFn } };
        LayerConfigManager.loadLayerLegend(
            { id: "tourism" },
            { id: "poi_all", legends: { directory: "legends" } }
        );
        expect(loadLayerLegendFn).toHaveBeenCalled();
    });

    it("loadLayerLegend uses 'layers/id' fallback when layerDef has no _layerDirectory (branch 60.1)", () => {
        const loadLayerLegendFn = vi.fn();
        globalThis.GeoLeaf = { Legend: { loadLayerLegend: loadLayerLegendFn } };
        LayerConfigManager.loadLayerLegend(
            { id: "tourism", basePath: "../profiles/tourism" },
            { id: "poi_all", legends: { directory: "legends" } }
        );
        expect(loadLayerLegendFn).toHaveBeenCalled();
    });

    it("_invokeLegendModule catch branch when loadLayerLegend throws (branch 63.0)", () => {
        globalThis.GeoLeaf = {
            Legend: {
                loadLayerLegend: vi.fn(() => {
                    throw new Error("legend error");
                }),
            },
        };
        expect(() =>
            LayerConfigManager.loadLayerLegend(
                { id: "tourism", basePath: "./profiles/tourism" },
                { id: "poi_all", legends: { directory: "legends" } }
            )
        ).not.toThrow();
    });

    it("_invokeLegendModule else branch when Legend module unavailable (branch 64.0)", () => {
        globalThis.GeoLeaf = {};
        expect(() =>
            LayerConfigManager.loadLayerLegend(
                { id: "tourism", basePath: "./profiles/tourism" },
                { id: "poi_all", legends: { directory: "legends" } }
            )
        ).not.toThrow();
    });

    it("loadLayerLegend uses 'default' style fallback when layerDef has no style (branch 71.1)", () => {
        const loadLayerLegendFn = vi.fn();
        globalThis.GeoLeaf = { Legend: { loadLayerLegend: loadLayerLegendFn } };
        LayerConfigManager.loadLayerLegend(
            { id: "tourism", basePath: "./profiles/tourism" },
            { id: "poi_all", legends: { directory: "legends", default: "default.legend.json" } }
        );
        expect(loadLayerLegendFn).toHaveBeenCalledWith("poi_all", "default", expect.any(Object));
    });
});
