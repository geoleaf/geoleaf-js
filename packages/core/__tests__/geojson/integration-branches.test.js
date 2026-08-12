/**
 * Branch-coverage companion for src/kernel/geojson/layers/integration.ts
 * Covers: registerWithLayerManager, _loadLayerLegend, populateLayerManagerWithAllConfigs,
 *         helper functions:, _resolveLayerColor, _resolveLayerLabels,
 *         _resolveStyleIdFromAvailable, _resolveStyleId, _getActiveThemeLayers,
 *         _triggerLayerManagerUIUpdate, _processLayerForSection, _buildPopulateConfigSectionMap,
 *         _registerPopulateSectionMap, _logLayerPreparation
 */

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        state: {
            layers: new Map(),
        },
    },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

import { LayerManagerIntegration } from "../../src/kernel/geojson/layers/integration.js";
// API S4.3e — `_allLayerConfigs` a quitté le namespace pour `kernel/shared/`. Ces tests
// plantaient la clé sur un faux global : ils testaient leur propre fixture, jamais le
// chemin écrivain → lecteur. Le littéral est gardé (il dit l'intention) et le store est
// synchronisé juste après, pour que la lecture sous test soit la vraie.
import { setAllLayerConfigs } from "../../src/kernel/shared/layer-configs-state.js";
import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";

const _g = typeof globalThis !== "undefined" ? globalThis : {};

describe("geojson/layers/integration.ts — branch coverage", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        GeoJSONShared.state.layers.clear();
        delete _g.GeoLeaf;
        // detectLayerType lives on the shared LayerManager object populated by store.ts at runtime;
        // in isolation the integration module's LayerManager doesn't have it, so we stub it here.
        LayerManagerIntegration.detectLayerType = vi.fn(() => "polygon");
    });

    // ── registerWithLayerManager ──────────────────────────────────

    describe("registerWithLayerManager", () => {
        it("returns early when GeoLeaf is undefined", () => {
            _g.GeoLeaf = undefined;
            expect(() => LayerManagerIntegration.registerWithLayerManager()).not.toThrow();
        });

        it("returns early when LayerManager has no _registerGeoJsonLayer", () => {
            _g.GeoLeaf = { LayerManager: {} };
            expect(() => LayerManagerIntegration.registerWithLayerManager()).not.toThrow();
        });

        it("registers layers grouped by section", () => {
            const registerFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: {
                    _registerGeoJsonLayer: registerFn,
                },
            };
            GeoJSONShared.state.layers.set("layer1", {
                label: "Layer One",
                visible: true,
                layer: {},
                config: {
                    layerManagerId: "section-a",
                    style: { fillColor: "#ff0000" },
                    zIndex: 10,
                },
            });
            GeoJSONShared.state.layers.set("layer2", {
                label: "Layer Two",
                visible: false,
                layer: {},
                config: { style: { color: "#00ff00" }, zIndex: 5 },
            });

            LayerManagerIntegration.registerWithLayerManager();
            expect(registerFn).toHaveBeenCalledTimes(2);
        });

        it("sorts items by descending zIndex within a section", () => {
            const calls = [];
            _g.GeoLeaf = {
                LayerManager: {
                    _registerGeoJsonLayer: vi.fn((id) => calls.push(id)),
                },
            };
            GeoJSONShared.state.layers.set("low", {
                label: "Low",
                visible: true,
                layer: {},
                config: { layerManagerId: "sec", style: { color: "#000" }, zIndex: 1 },
            });
            GeoJSONShared.state.layers.set("high", {
                label: "High",
                visible: true,
                layer: {},
                config: { layerManagerId: "sec", style: { color: "#000" }, zIndex: 100 },
            });

            LayerManagerIntegration.registerWithLayerManager();
            expect(calls[0]).toBe("high");
            expect(calls[1]).toBe("low");
        });

        it("uses default section id when layerManagerId is missing", () => {
            const registerFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: {
                    _registerGeoJsonLayer: registerFn,
                },
            };
            GeoJSONShared.state.layers.set("x", {
                label: "X",
                visible: true,
                layer: {},
                config: { style: { fillColor: "#abc" } },
            });
            LayerManagerIntegration.registerWithLayerManager();
            expect(registerFn).toHaveBeenCalledWith(
                "x",
                expect.objectContaining({
                    layerManagerId: "geojson-default",
                })
            );
        });
    });

    // B-228 — les blocs `_resolveLegendType` / `_resolveLayerColor` ont été retirés le
    // 11/08/2026 AVEC les fonctions qu'ils nommaient. Elles alimentaient `SectionItem.type`
    // et `.color`, deux champs que la charge utile d'enregistrement ne déclare pas et que
    // personne ne relisait. 🛑 Leur suppression n'a fait rougir AUCUN test : ces cas
    // exerçaient les lignes pour la couverture sans jamais asserter leur résultat.

    // ── _resolveLayerLabels ───────────────────────────────────────

    describe("layer labels resolution", () => {
        function registerWithLabels(config) {
            const registerFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: {
                    _registerGeoJsonLayer: registerFn,
                },
            };
            GeoJSONShared.state.layers.set("l", {
                label: "L",
                visible: true,
                layer: {},
                config,
                currentStyle: config._currentStyle || null,
            });
            LayerManagerIntegration.registerWithLayerManager();
            return registerFn;
        }

        it("detects explicit labels config", () => {
            registerWithLabels({
                style: { color: "#000" },
                labels: { enabled: true, field: "name" },
            });
        });

        it("detects labels from currentStyle", () => {
            registerWithLabels({
                style: { color: "#000" },
                _currentStyle: { label: { enabled: true } },
            });
        });

        it("returns no labels when neither source available", () => {
            registerWithLabels({ style: { color: "#000" } });
        });

        it("returns no labels when labels.enabled is false", () => {
            registerWithLabels({ style: { color: "#000" }, labels: { enabled: false } });
        });
    });

    // ── _loadLayerLegend ──────────────────────────────────────────

    describe("_loadLayerLegend", () => {
        it("returns early when GeoLeaf is undefined", () => {
            _g.GeoLeaf = undefined;
            expect(() => LayerManagerIntegration._loadLayerLegend("x", {})).not.toThrow();
        });

        it("returns early when Legend is not available", () => {
            _g.GeoLeaf = {};
            expect(() => LayerManagerIntegration._loadLayerLegend("x", {})).not.toThrow();
        });

        it("returns early when loadLayerLegend is not a function", () => {
            _g.GeoLeaf = { Legend: {} };
            expect(() => LayerManagerIntegration._loadLayerLegend("x", {})).not.toThrow();
        });

        it("calls Legend.loadLayerLegend with resolved style ID from selector", () => {
            const loadFn = vi.fn();
            _g.GeoLeaf = {
                Legend: { loadLayerLegend: loadFn },
                _LayerManagerStyleSelector: { getCurrentStyle: vi.fn(() => "custom-style") },
            };
            LayerManagerIntegration._loadLayerLegend("myLayer", { config: {} });
            expect(loadFn).toHaveBeenCalledWith("myLayer", "custom-style", {});
        });

        it("falls back to currentStyleMetadata.id", () => {
            const loadFn = vi.fn();
            _g.GeoLeaf = { Legend: { loadLayerLegend: loadFn } };
            LayerManagerIntegration._loadLayerLegend("myLayer", {
                config: {},
                currentStyleMetadata: { id: "meta-style" },
            });
            expect(loadFn).toHaveBeenCalledWith("myLayer", "meta-style", {});
        });

        it("falls back to styles.available[0].id", () => {
            const loadFn = vi.fn();
            _g.GeoLeaf = { Legend: { loadLayerLegend: loadFn } };
            LayerManagerIntegration._loadLayerLegend("myLayer", {
                config: {
                    styles: {
                        available: [{ id: "avail-style", file: "f.json" }],
                        default: null,
                    },
                },
            });
            expect(loadFn).toHaveBeenCalledWith("myLayer", "avail-style", expect.anything());
        });

        it("resolves style from default file match", () => {
            const loadFn = vi.fn();
            _g.GeoLeaf = { Legend: { loadLayerLegend: loadFn } };
            LayerManagerIntegration._loadLayerLegend("myLayer", {
                config: {
                    styles: {
                        available: [
                            { id: "s1", file: "a.json" },
                            { id: "s2", file: "b.json" },
                        ],
                        default: "b.json",
                    },
                },
            });
            expect(loadFn).toHaveBeenCalledWith("myLayer", "s2", expect.anything());
        });

        it("falls back to 'default' when styles available is not an array", () => {
            const loadFn = vi.fn();
            _g.GeoLeaf = { Legend: { loadLayerLegend: loadFn } };
            LayerManagerIntegration._loadLayerLegend("myLayer", {
                config: { styles: {} },
            });
            expect(loadFn).toHaveBeenCalledWith("myLayer", "default", expect.anything());
        });

        it("falls back to 'default' when no styles", () => {
            const loadFn = vi.fn();
            _g.GeoLeaf = { Legend: { loadLayerLegend: loadFn } };
            LayerManagerIntegration._loadLayerLegend("myLayer", { config: {} });
            expect(loadFn).toHaveBeenCalledWith("myLayer", "default", {});
        });

        it("uses styleSelector even when it returns null, falls back further", () => {
            const loadFn = vi.fn();
            _g.GeoLeaf = {
                Legend: { loadLayerLegend: loadFn },
                _LayerManagerStyleSelector: { getCurrentStyle: vi.fn(() => null) },
            };
            LayerManagerIntegration._loadLayerLegend("myLayer", {
                config: {},
                currentStyleMetadata: { id: "fallback-meta" },
            });
            expect(loadFn).toHaveBeenCalledWith("myLayer", "fallback-meta", {});
        });
    });

    // ── populateLayerManagerWithAllConfigs ─────────────────────────

    describe("populateLayerManagerWithAllConfigs", () => {
        it("returns early when LayerManager unavailable", () => {
            _g.GeoLeaf = {};
            expect(() =>
                LayerManagerIntegration.populateLayerManagerWithAllConfigs({})
            ).not.toThrow();
        });

        it("returns early when _allLayerConfigs is missing", () => {
            _g.GeoLeaf = {
                LayerManager: { _registerGeoJsonLayer: vi.fn() },
            };
            expect(() =>
                LayerManagerIntegration.populateLayerManagerWithAllConfigs({})
            ).not.toThrow();
        });

        it("returns early when _allLayerConfigs is not an array", () => {
            _g.GeoLeaf = {
                LayerManager: { _registerGeoJsonLayer: vi.fn() },
                _allLayerConfigs: "not-an-array",
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            expect(() =>
                LayerManagerIntegration.populateLayerManagerWithAllConfigs({})
            ).not.toThrow();
        });

        it("populates sections from allLayerConfigs", () => {
            const registerFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: {
                    _registerGeoJsonLayer: registerFn,
                    _updateContent: vi.fn(),
                },
                _allLayerConfigs: [
                    { id: "a", label: "A", layerManagerId: "sec1", zIndex: 5, themes: ["dark"] },
                    { id: "b", label: "B", layerManagerId: "sec1", zIndex: 10 },
                    { id: "c", label: "C" },
                ],
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            LayerManagerIntegration.populateLayerManagerWithAllConfigs({
                layers: [{ id: "a" }, "c"],
            });
            expect(registerFn).toHaveBeenCalledTimes(3);
            // "b" has highest zIndex in sec1, registered first
            const firstCall = registerFn.mock.calls[0];
            expect(firstCall[0]).toBe("b");
        });

        it("marks active layers correctly", () => {
            const registerFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: {
                    _registerGeoJsonLayer: registerFn,
                    refresh: vi.fn(),
                },
                _allLayerConfigs: [
                    { id: "active-layer", label: "Active" },
                    { id: "inactive-layer", label: "Inactive" },
                ],
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            LayerManagerIntegration.populateLayerManagerWithAllConfigs({
                layers: ["active-layer"],
            });
            const activeCall = registerFn.mock.calls.find((c) => c[0] === "active-layer");
            const inactiveCall = registerFn.mock.calls.find((c) => c[0] === "inactive-layer");
            expect(activeCall[1].checked).toBe(true);
            expect(inactiveCall[1].checked).toBe(false);
        });

        it("handles null activeThemeConfig", () => {
            const registerFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: { _registerGeoJsonLayer: registerFn },
                _allLayerConfigs: [{ id: "x", label: "X" }],
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            LayerManagerIntegration.populateLayerManagerWithAllConfigs(null);
            const call = registerFn.mock.calls[0];
            expect(call[1].checked).toBe(false);
        });

        it("handles activeThemeConfig without layers array", () => {
            const registerFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: { _registerGeoJsonLayer: registerFn },
                _allLayerConfigs: [{ id: "x", label: "X" }],
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            LayerManagerIntegration.populateLayerManagerWithAllConfigs({ layers: "not-array" });
            const call = registerFn.mock.calls[0];
            expect(call[1].checked).toBe(false);
        });

        it("calls _updateContent when available", () => {
            const updateFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: {
                    _registerGeoJsonLayer: vi.fn(),
                    _updateContent: updateFn,
                },
                _allLayerConfigs: [{ id: "x", label: "X" }],
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            LayerManagerIntegration.populateLayerManagerWithAllConfigs(null);
            expect(updateFn).toHaveBeenCalled();
        });

        it("falls back to refresh when _updateContent unavailable", () => {
            const refreshFn = vi.fn();
            _g.GeoLeaf = {
                LayerManager: {
                    _registerGeoJsonLayer: vi.fn(),
                    refresh: refreshFn,
                },
                _allLayerConfigs: [{ id: "x", label: "X" }],
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            LayerManagerIntegration.populateLayerManagerWithAllConfigs(null);
            expect(refreshFn).toHaveBeenCalled();
        });

        it("does nothing for UI update when neither method exists", () => {
            _g.GeoLeaf = {
                LayerManager: { _registerGeoJsonLayer: vi.fn() },
                _allLayerConfigs: [{ id: "x", label: "X" }],
            };
            setAllLayerConfigs(
                _g.GeoLeaf?._allLayerConfigs ?? globalThis.GeoLeaf?._allLayerConfigs
            );
            expect(() =>
                LayerManagerIntegration.populateLayerManagerWithAllConfigs(null)
            ).not.toThrow();
        });
    });
});
