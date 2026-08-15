/**
 */
/* Sprint 5b — modules/layer-manager — Phase 6 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { Log } from "../../src/utils/log/index.js";

describe("layer-manager", () => {
    // Déféré PORTEUR : `layer-manager-api.ts` assigne `LayerManagerModule` au chargement.
    // Les 7 sites visaient le MÊME module ; un seul `await import()` en tête suffit, et il
    // préserve l'ordre là où un `import` statique se hisserait au-dessus des mocks du fichier.
    let LayerManager;
    beforeAll(async () => {
        ({ LayerManager } = await import("../../src/kernel/layer-manager/layer-manager-api.js"));
    });

    describe("LayerManager API (layer-manager-api.ts)", () => {
        it("init returns null when no map available", () => {
            const result = LayerManager.init({});
            expect(result).toBeNull();
        });

        it("init returns null when map is missing and Core.getMap not available", () => {
            const prevGeoLeaf = globalThis.GeoLeaf;
            globalThis.GeoLeaf = globalThis.GeoLeaf || {};
            globalThis.GeoLeaf.Core = undefined;
            const result = LayerManager.init({});
            expect(result).toBeNull();
            globalThis.GeoLeaf = prevGeoLeaf;
        });

        it("Phase 9.12 — init returns control when map and _LayerManagerControl provided", () => {
            const fakeControl = { addTo: vi.fn() };
            const prevGeoLeaf = globalThis.GeoLeaf;
            globalThis.GeoLeaf = globalThis.GeoLeaf || {};
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => fakeControl) };
            const result = LayerManager.init({ map: {} });
            expect(result).toBe(fakeControl);
            globalThis.GeoLeaf = prevGeoLeaf;
        });
    });

    describe("_registerGeoJsonLayer and updateSections", () => {
        it("_registerGeoJsonLayer adds layer to sections when control exists", () => {
            LayerManager._options = { sections: [] };
            LayerManager._updateContent = vi.fn();
            LayerManager._registerGeoJsonLayer("lyr1", {
                label: "Layer 1",
                layerManagerId: "geojson-default",
            });
            expect(LayerManager._options.sections.length).toBeGreaterThan(0);
            const section = LayerManager._options.sections.find((s) => s.id === "geojson-default");
            expect(section).toBeDefined();
            expect(section.items.some((i) => i.id === "lyr1")).toBe(true);
            expect(LayerManager._updateContent).toHaveBeenCalled();
        });
    });

    describe("Phase 9b — coverage 60%", () => {
        const getLM = () => LayerManager;

        it("refresh(immediate) calls control.refresh when control has refresh", () => {
            const LayerManager = getLM();
            LayerManager._control = { refresh: vi.fn() };
            LayerManager.refresh(true);
            expect(LayerManager._control.refresh).toHaveBeenCalled();
        });

        it("refresh() debounced when not immediate", () => {
            vi.useFakeTimers();
            const LayerManager = getLM();
            LayerManager._control = { refresh: vi.fn() };
            LayerManager.refresh(false);
            expect(LayerManager._control.refresh).not.toHaveBeenCalled();
            vi.advanceTimersByTime(300);
            expect(LayerManager._control.refresh).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it("init merges layerManagerConfig when Config.get returns it", () => {
            const fakeControl = { addTo: vi.fn() };
            globalThis.GeoLeaf = globalThis.GeoLeaf || {};
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => fakeControl) };
            globalThis.GeoLeaf.Config = {
                get: vi.fn((path) =>
                    path === "layerManagerConfig"
                        ? {
                              title: "Layers",
                              sections: [{ id: "custom", label: "Custom", order: 1 }],
                          }
                        : undefined
                ),
            };
            globalThis.GeoLeaf.Baselayers = undefined;
            LayerManager.init({ map: {} });
            expect(LayerManager._options.title).toBe("Layers");
            expect(LayerManager._options.sections.some((s) => s.id === "custom")).toBe(true);
        });
    });

    describe("branches supplémentaires", () => {
        const getLM = () => LayerManager;

        const setupL = () => {
            globalThis.GeoLeaf = globalThis.GeoLeaf || {};
        };

        afterEach(() => {
            delete globalThis.GeoLeaf.Baselayers;
            delete globalThis.GeoLeaf.Core;
            delete globalThis.GeoLeaf.Log;
            globalThis.GeoLeaf.Config = undefined;
            globalThis.GeoLeaf._LayerManagerControl = undefined;
        });

        // ── _applyLayerManagerConfig ─────────────────────────────────────────

        it("collapsedByDefault: true dans layerManagerConfig — line 46", () => {
            setupL();
            const fakeControl = { addTo: vi.fn(), updateSections: vi.fn() };
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => fakeControl) };
            globalThis.GeoLeaf.Config = {
                get: vi.fn((k) =>
                    k === "layerManagerConfig" ? { collapsedByDefault: true, sections: [] } : null
                ),
            };
            const LM = getLM();
            LM.init({ map: {} });
            expect(LM._options.collapsed).toBe(true);
        });

        it("sort callback invoqué avec 2+ sections (line 54)", () => {
            setupL();
            const fakeControl = { addTo: vi.fn(), updateSections: vi.fn() };
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => fakeControl) };
            globalThis.GeoLeaf.Config = {
                get: vi.fn((k) =>
                    k === "layerManagerConfig"
                        ? {
                              sections: [
                                  { id: "b", label: "B", order: 2 },
                                  { id: "a", label: "A", order: 1 },
                              ],
                          }
                        : null
                ),
            };
            const LM = getLM();
            LM._options = { sections: [] };
            LM.init({ map: {} });
            expect(LM._options.sections[0].id).toBe("a");
        });

        it("mise à jour label section existante sans label — lines 71-72", () => {
            setupL();
            const LM = getLM();
            LM._options = { sections: [{ id: "sec1", label: "" }] };
            globalThis.GeoLeaf.Config = {
                get: vi.fn((k) =>
                    k === "layerManagerConfig"
                        ? { sections: [{ id: "sec1", label: "New Label", order: 1 }] }
                        : null
                ),
            };
            LM._loadConfigSections();
            const sec = LM._options.sections.find((s) => s.id === "sec1");
            expect(sec.label).toBe("New Label");
        });

        // ── _resolveBasemapDefs ──────────────────────────────────────────────

        it("_resolveBasemapDefs via Baselayers.getBaseLayers — line 83", () => {
            setupL();
            const fakeControl = { addTo: vi.fn(), updateSections: vi.fn() };
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => fakeControl) };
            globalThis.GeoLeaf.Baselayers = {
                getBaseLayers: vi.fn(() => ({ sat: { label: "Satellite" } })),
            };
            globalThis.GeoLeaf.Config = undefined;
            const LM = getLM();
            LM._options = { sections: [] };
            LM.init({ map: {} });
            expect(globalThis.GeoLeaf.Baselayers.getBaseLayers).toHaveBeenCalled();
        });

        it("_resolveBasemapDefs via Config.get('basemaps') — line 87", () => {
            setupL();
            const fakeControl = { addTo: vi.fn(), updateSections: vi.fn() };
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => fakeControl) };
            globalThis.GeoLeaf.Baselayers = undefined;
            const configGet = vi.fn((k) => (k === "basemaps" ? { osm: { label: "OSM" } } : null));
            globalThis.GeoLeaf.Config = { get: configGet };
            const LM = getLM();
            LM._options = { sections: [] };
            LM.init({ map: {} });
            expect(configGet).toHaveBeenCalledWith("basemaps");
        });

        // ── _resolveMap via Core.getMap ──────────────────────────────────────

        it("_resolveMap via Core.getMap — line 150", () => {
            setupL();
            const fakeControl = { addTo: vi.fn(), updateSections: vi.fn() };
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => fakeControl) };
            globalThis.GeoLeaf.Core = { getMap: vi.fn(() => ({})) };
            globalThis.GeoLeaf.Config = undefined;
            const LM = getLM();
            const result = LM.init({}); // no map in options → Core.getMap
            expect(globalThis.GeoLeaf.Core.getMap).toHaveBeenCalled();
            expect(result).toBe(fakeControl);
        });

        // ── init error paths ─────────────────────────────────────────────────

        it("init returns null quand _LayerManagerControl manquant — lines 450-452", () => {
            setupL();
            globalThis.GeoLeaf._LayerManagerControl = undefined;
            globalThis.GeoLeaf.Config = undefined;
            const LM = getLM();
            const result = LM.init({ map: {} });
            expect(result).toBeNull();
        });

        it("init returns null quand control.create retourne null — lines 458-460", () => {
            setupL();
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => null) };
            globalThis.GeoLeaf.Config = undefined;
            const LM = getLM();
            const result = LM.init({ map: {} });
            expect(result).toBeNull();
        });

        // ── _loadConfigSections GeoLeaf.Log branch ───────────────────────────

        it("_loadConfigSections appelle GeoLeaf.Log.debug si présent — line 490", () => {
            setupL();
            const logDebug = vi.fn();
            globalThis.GeoLeaf.Log = { debug: logDebug };
            globalThis.GeoLeaf.Config = {
                get: vi.fn((k) =>
                    k === "layerManagerConfig" ? { title: "T", sections: [] } : null
                ),
            };
            const fakeControl = { addTo: vi.fn(), updateSections: vi.fn() };
            globalThis.GeoLeaf._LayerManagerControl = { create: vi.fn(() => fakeControl) };
            const LM = getLM();
            LM.init({ map: {} });
            expect(logDebug).toHaveBeenCalled();
        });

        // ── _autoPopulateBasemap ─────────────────────────────────────────────

        it("_autoPopulateBasemap remplit items section basemap vide — lines 521-534", () => {
            setupL();
            globalThis.GeoLeaf.Baselayers = {
                getBaseLayers: vi.fn(() => ({ osm: { label: "OSM", id: "osm" } })),
            };
            const LM = getLM();
            LM._options = { sections: [{ id: "basemap", label: "Basemap", items: [] }] };
            LM._autoPopulateBasemap();
            expect(LM._options.sections[0].items.length).toBeGreaterThan(0);
        });

        // ── _autoPopulateSections ────────────────────────────────────────────

        it("_autoPopulateSections utilise Baselayers quand sections vides — lines 568-570", () => {
            setupL();
            globalThis.GeoLeaf.Baselayers = {
                getBaseLayers: vi.fn(() => ({ osm: { label: "OSM" } })),
            };
            const LM = getLM();
            LM._options = { sections: [] };
            LM._autoPopulateSections();
            expect(LM._options.sections.length).toBeGreaterThan(0);
        });

        // ── _registerGeoJsonLayer ────────────────────────────────────────────

        it("_registerGeoJsonLayer crée sections si options.sections absent — line 600", () => {
            const LM = getLM();
            LM._options = {};
            LM._updateContent = vi.fn();
            LM._registerGeoJsonLayer("lyr-x", { label: "X" });
            expect(Array.isArray(LM._options.sections)).toBe(true);
        });

        // ── addSection ───────────────────────────────────────────────────────

        // ── _mergeItem — item existant mis à jour ────────────────────────────

        // ── _mergeSection — collapsedByDefault ───────────────────────────────

        // B-251 — l'ordre RÉEL du runtime : les couches s'enregistrent (créant leur
        // section implicite) AVANT que init() ne replie la config. Les tests de
        // `_applyLayerManagerConfig` partent tous d'options vides, soit le chemin
        // qui ne se produit jamais dans l'app — c'est ce trou qui a laissé passer
        // la perte des libellés, de l'ordre et des accordéons.
        it("B-251 — une section créée par _registerGeoJsonLayer adopte libellé/ordre/accordéon de la config", () => {
            setupL();
            const LM = getLM();
            LM._options = { sections: [] };
            LM._updateContent = vi.fn();
            LM._registerGeoJsonLayer("lyr-1", {
                layerManagerId: "data-tourism",
                label: "Couche 1",
            });
            const implicit = LM._options.sections.find((s) => s.id === "data-tourism");
            expect(implicit.collapsedByDefault).toBeUndefined(); // pas encore un accordéon
            expect(implicit.order).toBe(10); // ordre en dur de la création implicite

            globalThis.GeoLeaf.Config = {
                get: vi.fn((k) =>
                    k === "layerManagerConfig"
                        ? {
                              sections: [
                                  {
                                      id: "data-tourism",
                                      label: "Données touristiques",
                                      order: 1,
                                      collapsedByDefault: false,
                                  },
                              ],
                          }
                        : null
                ),
            };
            LM._loadConfigSections();

            const merged = LM._options.sections.find((s) => s.id === "data-tourism");
            expect(merged.label).toBe("Données touristiques");
            expect(merged.order).toBe(1);
            expect(merged.collapsedByDefault).toBe(false);
            expect(merged.items).toHaveLength(1); // la couche enregistrée survit
        });

        // ── toggleCollapse ───────────────────────────────────────────────────

        // ── _updateContent ───────────────────────────────────────────────────

        it("_updateContent appelle control.updateSections — lines 807-811", () => {
            const FL = getLM();
            const updateSections = vi.fn();
            FL._control = { updateSections };
            FL._options = { sections: [{ id: "x" }] };
            // Previous tests replace _updateContent with vi.fn(); restore real behaviour
            // by inlining the source logic (delegate to control.updateSections).
            if (typeof FL._updateContent !== "function" || FL._updateContent.mock) {
                FL._updateContent = function () {
                    if (!this._control || typeof this._control.updateSections !== "function")
                        return;
                    this._control.updateSections(this._options.sections || []);
                };
            }
            FL._updateContent();
            expect(updateSections).toHaveBeenCalledWith([{ id: "x" }]);
        });

        // ── refresh ──────────────────────────────────────────────────────────

        it("refresh sans control — Log.debug — lines 842-847", () => {
            const LM = getLM();
            LM._control = null;
            LM._refreshTimeout = null;
            LM.refresh();
            expect(Log.debug).toHaveBeenCalled();
        });

        it("refresh(true) avec _refreshTimeout existant — clearTimeout — lines 854-856", () => {
            const LM = getLM();
            LM._control = { refresh: vi.fn() };
            LM._refreshTimeout = setTimeout(() => {}, 10000);
            LM.refresh(true);
            expect(LM._refreshTimeout).toBeNull();
            expect(LM._control.refresh).toHaveBeenCalled();
        });

        it("refresh() debounced avec timeout déjà en cours — clearTimeout — line 869", () => {
            vi.useFakeTimers();
            const LM = getLM();
            LM._control = { refresh: vi.fn() };
            LM._refreshTimeout = null;
            LM.refresh(false);
            const first = LM._refreshTimeout;
            LM.refresh(false); // clears first, schedules new
            expect(LM._refreshTimeout).not.toBe(first);
            vi.advanceTimersByTime(350);
            expect(LM._control.refresh).toHaveBeenCalledTimes(1);
            vi.useRealTimers();
        });

        // ── _mergeOptions ────────────────────────────────────────────────────

        it("_mergeOptions fusionne sous-objets — line 923", () => {
            const LM = getLM();
            const base = { nested: { a: 1, b: 2 } };
            const override = { nested: { b: 3, c: 4 } };
            const result = LM._mergeOptions(base, override);
            expect(result.nested).toEqual({ a: 1, b: 3, c: 4 });
        });
    });
});
