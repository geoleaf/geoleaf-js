/**
 * R5 — Tests app/init-features.ts (initBasemaps, initGeoJSON).
 */
"use strict";

import { initBasemaps, initGeoJSON } from "../../src/app/init-features.js";

describe("app/init-features (R5)", () => {
    const AppLog = {
        log: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    };
    const map = { fitBounds: vi.fn(), on: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("initBasemaps", () => {
        it("ne fait rien si BaseLayers absent", () => {
            initBasemaps({ GeoLeaf: {}, cfg: {}, map, AppLog });
            expect(AppLog.warn).toHaveBeenCalledWith("BaseLayers module not found.");
        });
        it("calls baseLayersModule.init avec basemaps du cfg", () => {
            const initFn = vi.fn();
            const GeoLeaf = { BaseLayers: { init: initFn } };
            const cfg = {
                basemaps: {
                    street: {
                        id: "street",
                        label: "Street",
                        url: "https://tile.example/{z}/{x}/{y}.png",
                        defaultBasemap: true,
                    },
                },
                ui: {},
            };
            initBasemaps({ GeoLeaf, cfg, map, AppLog });
            expect(initFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    map,
                    activeKey: "street",
                    baselayers: expect.any(Object),
                })
            );
        });
    });

    describe("initGeoJSON", () => {
        // F0/S8: GeoLeaf.GeoJSON.init() + loadFromActiveProfile were moved to
        // GeoJSONModule.init() (see geojson-module.test.js). initGeoJSON now only wires
        // the boot toast + the ThemeSelector / LayerManager pipeline.
        it("enregistre map.on geoleaf:geojson:layers-loaded et showNotification", () => {
            const initFn = vi.fn();
            const onFn = vi.fn();
            const mapWithOn = { ...map, on: onFn };
            const showNotification = vi.fn();
            const GeoLeaf = { GeoJSON: { init: initFn } };
            initGeoJSON({ GeoLeaf, _cfg: {}, map: mapWithOn, AppLog, _app: { showNotification } });
            expect(onFn).toHaveBeenCalledWith(
                "geoleaf:geojson:layers-loaded",
                expect.any(Function)
            );
            const handler = onFn.mock.calls[0][1];
            handler({ detail: { count: 2 } });
            expect(showNotification).toHaveBeenCalledWith("2 GeoJSON layers loaded", 3000);
        });
    });

    describe("initBasemaps — branches supplémentaires", () => {
        it("utilise GeoLeaf.Baselayers (lowercase b) si BaseLayers absent", () => {
            const initFn = vi.fn();
            const GeoLeaf = { Baselayers: { init: initFn } };
            initBasemaps({ GeoLeaf, cfg: {}, map, AppLog });
            expect(initFn).toHaveBeenCalled();
        });
        it("propage type, style, attribution, minZoom, maxZoom dans baselayers", () => {
            const initFn = vi.fn();
            const GeoLeaf = { BaseLayers: { init: initFn } };
            const cfg = {
                basemaps: {
                    vector: {
                        id: "vector",
                        label: "Vector",
                        url: "u",
                        type: "vector",
                        style: "maplibre://s",
                        attribution: "© maps",
                        minZoom: 2,
                        maxZoom: 18,
                        defaultBasemap: true,
                    },
                },
            };
            initBasemaps({ GeoLeaf, cfg, map, AppLog });
            const entry = initFn.mock.calls[0][0].baselayers.vector;
            expect(entry.type).toBe("vector");
            expect(entry.style).toBe("maplibre://s");
            expect(entry.attribution).toBe("© maps");
            expect(entry.minZoom).toBe(2);
            expect(entry.maxZoom).toBe(18);
        });
        it("warn si BaseLayers.init throw", () => {
            const GeoLeaf = {
                BaseLayers: {
                    init: vi.fn().mockImplementation(() => {
                        throw new Error("boom");
                    }),
                },
            };
            initBasemaps({ GeoLeaf, cfg: { basemaps: {} }, map, AppLog });
            expect(AppLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("BaseLayers.init threw"),
                expect.any(Error)
            );
        });
    });

    describe("initGeoJSON — branches supplémentaires", () => {
        it("count === 1 → message '1 GeoJSON layer loaded'", () => {
            const onFn = vi.fn();
            const mapWithOn = { ...map, on: onFn };
            const showNotification = vi.fn();
            const GeoLeaf = { GeoJSON: { init: vi.fn() } };
            initGeoJSON({ GeoLeaf, _cfg: {}, map: mapWithOn, AppLog, _app: { showNotification } });
            const handler = onFn.mock.calls[0][1];
            handler({ detail: { count: 1 } });
            expect(showNotification).toHaveBeenCalledWith("1 GeoJSON layer loaded", 3000);
        });
        it("handler sans count valide — showNotification pas appelé", () => {
            const onFn = vi.fn();
            const mapWithOn = { ...map, on: onFn };
            const showNotification = vi.fn();
            const GeoLeaf = { GeoJSON: { init: vi.fn() } };
            initGeoJSON({ GeoLeaf, _cfg: {}, map: mapWithOn, AppLog, _app: { showNotification } });
            const handler = onFn.mock.calls[0][1];
            handler({ detail: {} });
            expect(showNotification).not.toHaveBeenCalled();
        });
        // F2/S8: the ThemeSelector.init pipeline (warn-if-absent, containers guard, init
        // call, init catch) moved from initGeoJSON to the theme-selector capability
        // lifecycle — covered by __tests__/capabilities/theme-selector/lifecycle.test.js.
        it("buildLoadAllConfigsPromise avec GeoJSONLoader et activeProfile", async () => {
            const loadAll = vi.fn().mockResolvedValue([]);
            const GeoLeaf = {
                GeoJSON: { init: vi.fn() },
                _GeoJSONLoader: { loadAllLayersConfigsForLayerManager: loadAll },
                Config: {
                    getActiveProfile: vi.fn().mockReturnValue({ id: "p1" }),
                    getActiveProfileId: vi.fn().mockReturnValue("p1"),
                },
                ThemeSelector: null,
            };
            initGeoJSON({ GeoLeaf, _cfg: {}, map, AppLog, _app: {} });
            await new Promise((r) => setTimeout(r, 0));
            expect(loadAll).toHaveBeenCalledWith({ id: "p1" });
        });
        it("buildLoadAllConfigsPromise catch → AppLog.warn sur erreur chargement", async () => {
            const loadAll = vi.fn().mockRejectedValue(new Error("load error"));
            const GeoLeaf = {
                GeoJSON: { init: vi.fn() },
                _GeoJSONLoader: { loadAllLayersConfigsForLayerManager: loadAll },
                Config: {
                    getActiveProfile: vi.fn().mockReturnValue({ id: "p1" }),
                    getActiveProfileId: vi.fn().mockReturnValue("p1"),
                },
                ThemeSelector: null,
            };
            initGeoJSON({ GeoLeaf, _cfg: {}, map, AppLog, _app: {} });
            await new Promise((r) => setTimeout(r, 50));
            expect(AppLog.warn).toHaveBeenCalledWith(
                "Error loading layer configs:",
                expect.any(Error)
            );
        });
        it("geoleaf:theme:applied event → populateLayerManagerWithAllConfigs", async () => {
            const populateLayerManagerWithAllConfigs = vi.fn();
            const GeoLeaf = {
                GeoJSON: { init: vi.fn() },
                Config: {
                    getActiveProfile: vi.fn().mockReturnValue(null),
                    getActiveProfileId: vi.fn().mockReturnValue("p1"),
                },
                _GeoJSONLayerManager: { populateLayerManagerWithAllConfigs },
            };
            const primary = document.createElement("div");
            primary.id = "gl-theme-primary-container";
            const secondary = document.createElement("div");
            secondary.id = "gl-theme-secondary-container";
            document.body.appendChild(primary);
            document.body.appendChild(secondary);

            initGeoJSON({ GeoLeaf, _cfg: {}, map, AppLog, _app: {} });
            await new Promise((r) => setTimeout(r, 50));

            populateLayerManagerWithAllConfigs.mockClear();
            document.dispatchEvent(new Event("geoleaf:theme:applied"));
            expect(populateLayerManagerWithAllConfigs).toHaveBeenCalledWith(null);

            primary.remove();
            secondary.remove();
        });
    });
});
