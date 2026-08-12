/**
 */
const state = vi.hoisted(() => ({ layers: new Map() }));
const logMock = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
vi.mock("../../src/kernel/geojson/shared.js", () => ({ GeoJSONShared: { state } }));
vi.mock("../../src/utils/general/di-accessors.js", () => ({ getLog: () => logMock }));
import { LayerManagerIntegration } from "../../src/kernel/geojson/layers/integration.js";
// API S4.3e — `_allLayerConfigs` a quitté le namespace pour `kernel/shared/`. Ces tests
// plantaient la clé sur un faux global : ils testaient leur propre fixture, jamais le
// chemin écrivain → lecteur. Le littéral est gardé (il dit l'intention) et le store est
// synchronisé juste après, pour que la lecture sous test soit la vraie.
import { setAllLayerConfigs } from "../../src/kernel/shared/layer-configs-state.js";

const _g = globalThis;

describe("geojson/layers/integration", () => {
    afterEach(() => {
        state.layers.clear();
        _g.GeoLeaf = undefined;
        logMock.warn.mockClear();
    });

    describe("registerWithLayerManager", () => {
        it("warns and returns when LayerManager not available", () => {
            _g.GeoLeaf = {};
            LayerManagerIntegration.registerWithLayerManager();
            expect(logMock.warn).toHaveBeenCalled();
        });

        it("warns when LayerManager exists but has no _registerGeoJsonLayer", () => {
            _g.GeoLeaf = { LayerManager: {} };
            state.layers.set("lyr1", {
                layer: {},
                label: "L1",
                visible: true,
                config: { zIndex: 10 },
            });
            LayerManagerIntegration.registerWithLayerManager();
            expect(logMock.warn).toHaveBeenCalled();
        });

        it("Phase 9.10 — registers layers when _registerGeoJsonLayer exists", () => {
            LayerManagerIntegration.detectLayerType = () => "fill";
            const _registerGeoJsonLayer = vi.fn();
            _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
            state.layers.set("lyr1", {
                layer: {},
                label: "Layer 1",
                visible: true,
                config: { layerManagerId: "section-a", zIndex: 5, style: { fillColor: "#3388ff" } },
            });
            state.layers.set("lyr2", {
                layer: {},
                label: "Layer 2",
                visible: false,
                config: { zIndex: 10 },
            });
            LayerManagerIntegration.registerWithLayerManager();
            expect(_registerGeoJsonLayer).toHaveBeenCalled();
        });
    });

    describe("populateLayerManagerWithAllConfigs", () => {
        it("Phase 9.10 — warns when LayerManager or _registerGeoJsonLayer missing", () => {
            _g.GeoLeaf = {};
            LayerManagerIntegration.populateLayerManagerWithAllConfigs({});
            expect(logMock.warn).toHaveBeenCalled();
        });

        it("Phase 9.10 — populates when _allLayerConfigs and _registerGeoJsonLayer exist", () => {
            const _registerGeoJsonLayer = vi.fn();
            const _updateContent = vi.fn();
            _g.GeoLeaf = {
                LayerManager: { _registerGeoJsonLayer, _updateContent },
                _allLayerConfigs: [
                    { id: "c1", label: "Config 1", layerManagerId: "sec1", zIndex: 1 },
                ],
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            LayerManagerIntegration.populateLayerManagerWithAllConfigs({ layers: [{ id: "c1" }] });
            expect(_registerGeoJsonLayer).toHaveBeenCalledWith("c1", expect.any(Object));
            expect(_updateContent).toHaveBeenCalled();
        });
    });

    describe("_loadLayerLegend", () => {
        it("calls Legend.loadLayerLegend when Legend and styleId available", () => {
            const loadLayerLegend = vi.fn();
            _g.GeoLeaf = {
                Legend: { loadLayerLegend },
                _LayerManagerStyleSelector: { getCurrentStyle: vi.fn(() => "style-1") },
            };
            const layerData = { config: { id: "ly1" }, currentStyleMetadata: null };
            LayerManagerIntegration._loadLayerLegend("ly1", layerData);
            expect(loadLayerLegend).toHaveBeenCalledWith("ly1", "style-1", expect.any(Object));
        });
        it("uses currentStyleMetadata.id when styleSelector returns null", () => {
            const loadLayerLegend = vi.fn();
            _g.GeoLeaf = {
                Legend: { loadLayerLegend },
                _LayerManagerStyleSelector: { getCurrentStyle: vi.fn(() => null) },
            };
            const layerData = { config: {}, currentStyleMetadata: { id: "meta-style" } };
            LayerManagerIntegration._loadLayerLegend("ly1", layerData);
            expect(loadLayerLegend).toHaveBeenCalledWith("ly1", "meta-style", expect.any(Object));
        });
        it("uses config.styles.available[0].id when no styleSelector or metadata", () => {
            const loadLayerLegend = vi.fn();
            _g.GeoLeaf = {
                Legend: { loadLayerLegend },
                _LayerManagerStyleSelector: null,
            };
            const layerData = {
                config: {
                    styles: {
                        default: "default.json",
                        available: [{ id: "s1", file: "default.json" }],
                    },
                },
                currentStyleMetadata: null,
            };
            LayerManagerIntegration._loadLayerLegend("ly1", layerData);
            expect(loadLayerLegend).toHaveBeenCalledWith("ly1", "s1", expect.any(Object));
        });

        it("does nothing when Legend not available", () => {
            _g.GeoLeaf = {};
            expect(() =>
                LayerManagerIntegration._loadLayerLegend("ly1", {
                    config: {},
                    currentStyleMetadata: null,
                })
            ).not.toThrow();
        });

        it("does nothing when loadLayerLegend function missing on Legend", () => {
            _g.GeoLeaf = { Legend: {} };
            expect(() =>
                LayerManagerIntegration._loadLayerLegend("ly1", {
                    config: {},
                    currentStyleMetadata: null,
                })
            ).not.toThrow();
        });
    });

    describe("registerWithLayerManager edge cases", () => {
        it("skips layers with empty config when registering", () => {
            const _registerGeoJsonLayer = vi.fn();
            _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
            state.layers.set("noconf", { layer: {}, label: "X", visible: true, config: {} });
            LayerManagerIntegration.registerWithLayerManager();
            _g.GeoLeaf = undefined;
        });

        it("handles layer with layerManagerId and zIndex from config", () => {
            LayerManagerIntegration.detectLayerType = () => "line";
            const _registerGeoJsonLayer = vi.fn();
            _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
            state.layers.set("lyrZ", {
                layer: {},
                label: "LyrZ",
                visible: true,
                config: { layerManagerId: "sec-z", zIndex: 100, style: {} },
            });
            LayerManagerIntegration.registerWithLayerManager();
            expect(_registerGeoJsonLayer).toHaveBeenCalled();
        });
    });

    describe("populateLayerManagerWithAllConfigs edge cases", () => {
        it("skips when LayerManager has no _registerGeoJsonLayer", () => {
            _g.GeoLeaf = { LayerManager: {}, _allLayerConfigs: [{ id: "c1" }] };
            expect(() =>
                LayerManagerIntegration.populateLayerManagerWithAllConfigs({ layers: [] })
            ).not.toThrow();
        });

        it("works with empty allLayerConfigs", () => {
            const _registerGeoJsonLayer = vi.fn();
            _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
            setAllLayerConfigs([]);
            LayerManagerIntegration.populateLayerManagerWithAllConfigs({ layers: [] });
            expect(_registerGeoJsonLayer).not.toHaveBeenCalled();
        });
    });
});

// ── T22 — geojson/layers/integration.ts branch coverage ────────────────
describe("geojson/layers/integration — T22 branch coverage", () => {
    afterEach(() => {
        state.layers.clear();
        _g.GeoLeaf = undefined;
        logMock.warn.mockClear();
    });

    // B-228 — les blocs `_resolveLegendType` / `_resolveLayerColor` ont été retirés le
    // 11/08/2026 AVEC les fonctions qu'ils nommaient. Elles alimentaient `SectionItem.type`
    // et `.color`, deux champs que la charge utile d'enregistrement ne déclare pas et que
    // personne ne relisait. 🛑 Leur suppression n'a fait rougir AUCUN test : ces cas
    // exerçaient les lignes pour la couverture sans jamais asserter leur résultat.

    // B-225 — `pointStyle` a été RETIRÉ du résolveur au S3 (`e17e41a6`, « retrait des
    // fallbacks de format legacy », BREAKING v3.0.0). Les deux cas nommés « uses
    // pointStyle.fillColor » exerçaient une branche disparue et n'assertaient que
    // « la fonction a été appelée » : ils passaient quoi qu'il arrive.
    it("ignore une clé de style héritée (`pointStyle`, retirée en 3.0.0) sans casser l'enregistrement", () => {
        LayerManagerIntegration.detectLayerType = () => "fill";
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
        state.layers.set("lps1", {
            layer: {},
            label: "PS1",
            visible: true,
            config: { pointStyle: { fillColor: "#abc" } },
        });
        LayerManagerIntegration.registerWithLayerManager();
        expect(_registerGeoJsonLayer).toHaveBeenCalledWith(
            "lps1",
            expect.objectContaining({ label: "PS1" })
        );
    });

    it("_resolveLayerLabels returns hasLabels true when config.labels.enabled (branch 10.0, line 36)", () => {
        LayerManagerIntegration.detectLayerType = () => "fill";
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
        state.layers.set("llbl", {
            layer: {},
            label: "Label Layer",
            visible: true,
            config: { labels: { enabled: true } },
        });
        LayerManagerIntegration.registerWithLayerManager();
        expect(_registerGeoJsonLayer).toHaveBeenCalled();
    });

    it("_resolveLayerLabels uses currentStyle.label.enabled (branch 11.0, line 39)", () => {
        LayerManagerIntegration.detectLayerType = () => "fill";
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
        state.layers.set("lcs", {
            layer: {},
            label: "CS",
            visible: true,
            config: {},
            currentStyle: { label: { enabled: true } },
        });
        LayerManagerIntegration.registerWithLayerManager();
        expect(_registerGeoJsonLayer).toHaveBeenCalled();
    });

    it("sort comparator runs when multiple layers in same section (branches 24.x, 25.x)", () => {
        LayerManagerIntegration.detectLayerType = () => "fill";
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
        state.layers.set("sx1", {
            layer: {},
            label: "S1",
            visible: true,
            config: { layerManagerId: "sec-x", zIndex: 5 },
        });
        state.layers.set("sx2", {
            layer: {},
            label: "S2",
            visible: true,
            config: { layerManagerId: "sec-x", zIndex: 10 },
        });
        LayerManagerIntegration.registerWithLayerManager();
        expect(_registerGeoJsonLayer).toHaveBeenCalledTimes(2);
    });

    it("populateLayerManagerWithAllConfigs warns when _allLayerConfigs not an array (lines 267-270)", () => {
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
        setAllLayerConfigs("not-array");
        LayerManagerIntegration.populateLayerManagerWithAllConfigs({});
        expect(logMock.warn).toHaveBeenCalled();
    });

    it("_resolveStyleIdFromAvailable uses available[0].id when no defaultFile match (lines 150-151)", () => {
        const loadLayerLegend = vi.fn();
        _g.GeoLeaf = {
            Legend: { loadLayerLegend },
            _LayerManagerStyleSelector: null,
        };
        const layerData = {
            config: {
                styles: {
                    default: "other.json",
                    available: [{ id: "first-style", file: "default.json" }],
                },
            },
            currentStyleMetadata: null,
        };
        LayerManagerIntegration._loadLayerLegend("ly1", layerData);
        expect(loadLayerLegend).toHaveBeenCalledWith("ly1", "first-style", expect.any(Object));
    });

    it("_getActiveThemeLayers with null activeThemeConfig returns [] (branch 26.0)", () => {
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = {
            LayerManager: { _registerGeoJsonLayer },
            _allLayerConfigs: [{ id: "c1", label: "L1" }],
        };
        setAllLayerConfigs(_g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs);
        LayerManagerIntegration.populateLayerManagerWithAllConfigs(null);
        expect(_registerGeoJsonLayer).toHaveBeenCalled();
    });

    it("_getActiveThemeLayers when activeThemeConfig.layers is not an array (branch 27.0)", () => {
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = {
            LayerManager: { _registerGeoJsonLayer },
            _allLayerConfigs: [{ id: "c1", label: "L1" }],
        };
        setAllLayerConfigs(_g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs);
        LayerManagerIntegration.populateLayerManagerWithAllConfigs({ layers: "not-array" });
        expect(_registerGeoJsonLayer).toHaveBeenCalled();
    });

    it("_triggerLayerManagerUIUpdate skips when _updateUI is not a function (branch 31.0)", () => {
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = {
            LayerManager: { _registerGeoJsonLayer, _updateUI: "not-a-function" },
            _allLayerConfigs: [{ id: "c1", label: "L1" }],
        };
        setAllLayerConfigs(_g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs);
        expect(() =>
            LayerManagerIntegration.populateLayerManagerWithAllConfigs({ layers: [] })
        ).not.toThrow();
    });
});

// ── RM-P2 #5 — section item type resolves from geometryType (no detectLayerType) ──────
// The former `LayerManager.detectLayerType` is undefined on the integration slice
// (it lives on the store slice), so registering a real layer threw. Resolve the type
// from the cached `geometryType` instead — no detectLayerType dependency, no crash.
describe("geojson/layers/integration — RM-P2 #5 (latent detectLayerType crash)", () => {
    afterEach(() => {
        state.layers.clear();
        _g.GeoLeaf = undefined;
        logMock.warn.mockClear();
    });

    it("registers a layer WITHOUT a patched detectLayerType (resolves type from geometryType)", () => {
        // Simulate production: detectLayerType is not present on the integration slice.
        delete LayerManagerIntegration.detectLayerType;
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
        state.layers.set("pts", {
            layer: null,
            label: "Points",
            visible: true,
            geometryType: "point",
            config: { layerManagerId: "sec" },
        });
        // Before the fix this threw: `LayerManager.detectLayerType` is undefined here.
        expect(() => LayerManagerIntegration.registerWithLayerManager()).not.toThrow();
        expect(_registerGeoJsonLayer).toHaveBeenCalled();
    });

    it("handles point / line / polygon geometryType without throwing", () => {
        delete LayerManagerIntegration.detectLayerType;
        const _registerGeoJsonLayer = vi.fn();
        _g.GeoLeaf = { LayerManager: { _registerGeoJsonLayer } };
        state.layers.set("l1", {
            layer: null,
            label: "L",
            visible: true,
            geometryType: "linestring",
            config: { layerManagerId: "sec" },
        });
        state.layers.set("p1", {
            layer: null,
            label: "P",
            visible: true,
            geometryType: "polygon",
            config: { layerManagerId: "sec" },
        });
        state.layers.set("pt", {
            layer: null,
            label: "Pt",
            visible: true,
            geometryType: "point",
            config: { layerManagerId: "sec" },
        });
        expect(() => LayerManagerIntegration.registerWithLayerManager()).not.toThrow();
        expect(_registerGeoJsonLayer).toHaveBeenCalledTimes(3);
    });
});
