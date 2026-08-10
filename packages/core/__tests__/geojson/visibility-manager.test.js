/**
 */
/* Phase 7: state via _getTestState because GeoJSONShared can be undefined (Jest module resolution) */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
// Force GeoJSONShared.state to null so VisibilityManager falls back to _defaultState
// (the same object returned by _getTestState), ensuring test state and module state are shared
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: { state: null, reset: vi.fn() },
}));

import { VisibilityManager } from "../../src/kernel/geojson/visibility-manager.js";

const getState = () => (VisibilityManager._getTestState ? VisibilityManager._getTestState() : null);

describe("geojson/visibility-manager", () => {
    beforeEach(() => {
        const state = getState();
        if (state) {
            state.layers.clear();
            state.map = null;
        }
    });

    it("getVisibilityState returns null when layer not found", () => {
        expect(VisibilityManager.getVisibilityState("missing")).toBeNull();
    });

    it("getVisibilityState returns metadata when layer exists", () => {
        getState().layers.set("lyr1", { id: "lyr1" });
        const s = VisibilityManager.getVisibilityState("lyr1");
        expect(s).not.toBeNull();
        expect(s.current).toBe(false);
        expect(s.source).toBe("system");
    });

    it("_canChangeVisibility allows USER source", () => {
        expect(VisibilityManager._canChangeVisibility({ userOverride: true }, "user", true)).toBe(
            true
        );
    });

    it("_canChangeVisibility denies THEME when userOverride true", () => {
        expect(VisibilityManager._canChangeVisibility({ userOverride: true }, "theme", true)).toBe(
            false
        );
    });

    it("_updateVisibilityFlags USER sets userOverride", () => {
        const meta = { userOverride: false, themeOverride: true };
        VisibilityManager._updateVisibilityFlags(meta, "user", true);
        expect(meta.userOverride).toBe(true);
        expect(meta.themeOverride).toBe(false);
    });

    it("setVisibility returns false when layer not found", () => {
        expect(VisibilityManager.setVisibility("missing", true, "user")).toBe(false);
    });

    it("resetUserOverride clears userOverride", () => {
        const layerData = { _visibility: { userOverride: true } };
        getState().layers.set("lyr1", layerData);
        VisibilityManager.resetUserOverride("lyr1");
        expect(layerData._visibility.userOverride).toBe(false);
    });

    it("resetAllUserOverrides clears all", () => {
        const a = { _visibility: { userOverride: true } };
        getState().layers.set("a", a);
        VisibilityManager.resetAllUserOverrides();
        expect(a._visibility.userOverride).toBe(false);
    });

    it("_applyVisibilityChange shows layer via adapter when visible", () => {
        const showLayer = vi.fn();
        const hideLayer = vi.fn();
        getState().adapter = { showLayer, hideLayer };
        const layer = {};
        getState().layers.set("lyr1", { id: "lyr1", layer, visible: false });
        const layerData = getState().layers.get("lyr1");
        const result = VisibilityManager._applyVisibilityChange("lyr1", layerData, true);
        expect(result).toBe(true);
        expect(showLayer).toHaveBeenCalledWith("lyr1");
    });

    // ─── N-1b : le moteur est seul maître du rendu de la fenêtre d'échelle ────
    // Depuis S5, chaque sous-couche porte `minzoom`/`maxzoom` dérivés de `scaleConfig` :
    // MapLibre masque en continu pendant le zoom, au lieu d'attendre `zoomend`. Écrire
    // aussi `visibility: none` ici donnerait DEUX maîtres à la même décision — et ils
    // divergent dès qu'ils évaluent à des latitudes différentes.
    it("_applyVisibilityChange ne touche PAS la carte pour la source ZOOM", () => {
        const showLayer = vi.fn();
        const hideLayer = vi.fn();
        getState().adapter = { showLayer, hideLayer };
        getState().layers.set("lyr1", { id: "lyr1", layer: {} });
        const layerData = getState().layers.get("lyr1");

        const result = VisibilityManager._applyVisibilityChange("lyr1", layerData, false, "zoom");

        expect(result).toBe(true); // l'état rapporté change bien
        expect(hideLayer).not.toHaveBeenCalled(); // mais le rendu reste au moteur
        expect(showLayer).not.toHaveBeenCalled();
    });

    it("_applyVisibilityChange pilote toujours la carte pour les autres sources", () => {
        const showLayer = vi.fn();
        const hideLayer = vi.fn();
        getState().adapter = { showLayer, hideLayer };
        getState().layers.set("lyr1", { id: "lyr1", layer: {} });
        const layerData = getState().layers.get("lyr1");

        VisibilityManager._applyVisibilityChange("lyr1", layerData, false, "user");
        expect(hideLayer).toHaveBeenCalledWith("lyr1");
    });

    it("_applyVisibilityChange hides layer via adapter when not visible", () => {
        const showLayer = vi.fn();
        const hideLayer = vi.fn();
        getState().adapter = { showLayer, hideLayer };
        const layer = {};
        getState().layers.set("lyr1", { id: "lyr1", layer });
        const layerData = getState().layers.get("lyr1");
        const result = VisibilityManager._applyVisibilityChange("lyr1", layerData, false);
        expect(result).toBe(true);
        expect(hideLayer).toHaveBeenCalledWith("lyr1");
    });

    it("_applyVisibilityChange returns false when no adapter available", () => {
        getState().adapter = undefined;
        const result = VisibilityManager._applyVisibilityChange("lyr1", { layer: null }, true);
        expect(result).toBe(false);
    });

    it("setVisibility calls _applyVisibilityChange via adapter when layer exists", () => {
        const showLayer = vi.fn();
        const hideLayer = vi.fn();
        getState().adapter = { showLayer, hideLayer };
        const layer = {};
        getState().layers.set("lyr1", {
            id: "lyr1",
            layer,
            _visibility: { userOverride: false },
            visible: false,
        });
        const result = VisibilityManager.setVisibility("lyr1", true, "user");
        expect(result).toBe(true);
        expect(showLayer).toHaveBeenCalledWith("lyr1");
    });

    it("_notifyLegend calls Legend.setLayerVisibility when available", () => {
        const setLayerVisibility = vi.fn();
        globalThis.GeoLeaf = { Legend: { setLayerVisibility } };
        VisibilityManager._notifyLegend("lyr1", true);
        expect(setLayerVisibility).toHaveBeenCalledWith("lyr1", true);
        globalThis.GeoLeaf = undefined;
    });

    it("_notifyLegend calls Labels.refreshLabels when visible", () => {
        const refreshLabels = vi.fn();
        globalThis.GeoLeaf = { Legend: {}, Labels: { refreshLabels } };
        VisibilityManager._notifyLegend("lyr1", true);
        expect(refreshLabels).toHaveBeenCalledWith("lyr1");
        globalThis.GeoLeaf = undefined;
    });

    it("_notifyLegend calls Labels._hideLabelsForLayer when not visible", () => {
        const _hideLabelsForLayer = vi.fn();
        globalThis.GeoLeaf = { Legend: {}, Labels: { _hideLabelsForLayer } };
        VisibilityManager._notifyLegend("lyr1", false);
        expect(_hideLabelsForLayer).toHaveBeenCalledWith("lyr1");
        globalThis.GeoLeaf = undefined;
    });

    it("_applyVisibilityChange shows layer via adapter (clusterGroup handled natively)", () => {
        const showLayer = vi.fn();
        const hideLayer = vi.fn();
        getState().adapter = { showLayer, hideLayer };
        const layer = {};
        const clusterGroup = {};
        getState().layers.set("lyr1", { id: "lyr1", layer, clusterGroup, useSharedCluster: false });
        const layerData = getState().layers.get("lyr1");
        const result = VisibilityManager._applyVisibilityChange("lyr1", layerData, true);
        expect(result).toBe(true);
        expect(showLayer).toHaveBeenCalledWith("lyr1");
    });

    it("_applyVisibilityChange shows layer via adapter (useSharedCluster)", () => {
        const showLayer = vi.fn();
        const hideLayer = vi.fn();
        getState().adapter = { showLayer, hideLayer };
        const layer = {};
        const clusterGroup = { addLayer: vi.fn() };
        getState().layers.set("lyr1", { id: "lyr1", layer, clusterGroup, useSharedCluster: true });
        const layerData = getState().layers.get("lyr1");
        const result = VisibilityManager._applyVisibilityChange("lyr1", layerData, true);
        expect(result).toBe(true);
        expect(showLayer).toHaveBeenCalledWith("lyr1");
    });

    it("_applyVisibilityChange hides layer via adapter (clusterGroup)", () => {
        const showLayer = vi.fn();
        const hideLayer = vi.fn();
        getState().adapter = { showLayer, hideLayer };
        const layer = {};
        const clusterGroup = {};
        getState().layers.set("lyr1", { id: "lyr1", layer, clusterGroup, useSharedCluster: false });
        const layerData = getState().layers.get("lyr1");
        const result = VisibilityManager._applyVisibilityChange("lyr1", layerData, false);
        expect(result).toBe(true);
        expect(hideLayer).toHaveBeenCalledWith("lyr1");
    });
});

// ── T22 — geojson/visibility-manager.ts branch coverage ──────────────────────
describe("geojson/visibility-manager — T22 branch coverage", () => {
    beforeEach(() => {
        const state = getState();
        if (state) {
            state.layers.clear();
            state.map = null;
        }
        delete globalThis.GeoLeaf;
    });

    // ── _canChangeVisibility: ZOOM and THEME source (branches 11.0, 15.0) ────

    it("_canChangeVisibility returns true for ZOOM source (branch 11.0)", () => {
        expect(VisibilityManager._canChangeVisibility({ userOverride: false }, "zoom", true)).toBe(
            true
        );
    });

    it("_canChangeVisibility returns true for THEME source when userOverride false (branch 15.0)", () => {
        expect(VisibilityManager._canChangeVisibility({ userOverride: false }, "theme", true)).toBe(
            true
        );
    });

    // ── setVisibility: canChange=false (branch 6.0) ───────────────────────────

    it("setVisibility returns false when source=theme and userOverride=true (branch 6.0)", () => {
        getState().layers.set("lyr1", {
            id: "lyr1",
            layer: {},
            _visibility: {
                userOverride: true,
                themeOverride: false,
                zoomConstrained: false,
                current: false,
                source: "system",
                logicalState: false,
                themeDesired: null,
            },
        });
        const result = VisibilityManager.setVisibility("lyr1", true, "theme");
        expect(result).toBe(false);
    });

    // ── _updateVisibilityFlags: THEME, ZOOM, SYSTEM cases ────────────────────

    it("_updateVisibilityFlags THEME sets themeOverride when userOverride false (branches 16.1, 17.0)", () => {
        const meta = {
            userOverride: false,
            themeOverride: false,
            zoomConstrained: false,
            logicalState: false,
        };
        VisibilityManager._updateVisibilityFlags(meta, "theme", true);
        expect(meta.themeOverride).toBe(true);
        expect(meta.themeDesired).toBe(true);
        expect(meta.logicalState).toBe(true);
    });

    it("_updateVisibilityFlags THEME skips body when userOverride true (branch 17.1)", () => {
        const meta = { userOverride: true, themeOverride: false };
        VisibilityManager._updateVisibilityFlags(meta, "theme", true);
        expect(meta.themeOverride).toBe(false);
    });

    it("_updateVisibilityFlags ZOOM sets zoomConstrained when userOverride false (branches 16.2, 18.0)", () => {
        const meta = { userOverride: false, zoomConstrained: false };
        VisibilityManager._updateVisibilityFlags(meta, "zoom", false);
        expect(meta.zoomConstrained).toBe(true);
    });

    it("_updateVisibilityFlags SYSTEM resets all overrides (branch 16.3)", () => {
        const meta = {
            userOverride: true,
            themeOverride: true,
            themeDesired: true,
            zoomConstrained: true,
            logicalState: true,
        };
        VisibilityManager._updateVisibilityFlags(meta, "system", false);
        expect(meta.userOverride).toBe(false);
        expect(meta.themeOverride).toBe(false);
        expect(meta.zoomConstrained).toBe(false);
        expect(meta.logicalState).toBe(false);
    });

    // ── setVisibility source=system: meta.userOverride=false path (branch 9.1) ──

    it("setVisibility source=system covers meta.userOverride=false branch at line 119 (branch 9.1)", () => {
        getState().adapter = { showLayer: vi.fn(), hideLayer: vi.fn() };
        const layer = {};
        getState().layers.set("lyr2", { id: "lyr2", layer, visible: false });
        const result = VisibilityManager.setVisibility("lyr2", true, "system");
        expect(result).toBe(true);
        expect(getState().adapter.showLayer).toHaveBeenCalledWith("lyr2");
    });

    // ── setVisibility source=theme: meta.themeOverride=true evaluates !visible (branch 9 right) ──

    it("setVisibility source=theme evaluates themeHidden (meta.themeOverride=true, branch 9 right)", () => {
        getState().adapter = { showLayer: vi.fn(), hideLayer: vi.fn() };
        const layer = {};
        getState().layers.set("lyr3", { id: "lyr3", layer, visible: false });
        const result = VisibilityManager.setVisibility("lyr3", true, "theme");
        expect(result).toBe(true);
        expect(getState().adapter.showLayer).toHaveBeenCalledWith("lyr3");
    });

    // ── _applyVisibilityChange: early returns (branches 43.0, 45.0) ───────────

    it("_applyVisibilityChange returns true when adapter is available", () => {
        getState().adapter = { showLayer: vi.fn(), hideLayer: vi.fn() };
        const layer = {};
        const result = VisibilityManager._applyVisibilityChange(
            "lyr1",
            { id: "lyr1", layer },
            true
        );
        expect(result).toBe(true);
    });

    it("_applyVisibilityChange returns false when no adapter (branch 45.0)", () => {
        getState().adapter = undefined;
        const layer = {};
        const result = VisibilityManager._applyVisibilityChange(
            "lyr1",
            { id: "lyr1", layer },
            false
        );
        expect(result).toBe(false);
    });

    // ── _syncVisibilityUI: LayerManager.refresh + _LabelButtonManager (branches 36-39) ──

    it("_syncVisibilityUI is called when visibility change via adapter succeeds (branches 36-39)", () => {
        getState().adapter = { showLayer: vi.fn(), hideLayer: vi.fn() };
        const layer = {};
        getState().layers.set("lyr1", { id: "lyr1", layer, visible: false });
        const result = VisibilityManager.setVisibility("lyr1", true, "user");
        expect(result).toBe(true);
        expect(getState().adapter.showLayer).toHaveBeenCalledWith("lyr1");
    });

    // ── _notifyLegend: _LabelButtonManager.syncImmediate (branches 57-58) ─────

    it("_notifyLegend calls _LabelButtonManager.syncImmediate when available (branches 57-58)", () => {
        const syncImmediate = vi.fn();
        globalThis.GeoLeaf = {
            Legend: {},
            _LabelButtonManager: { syncImmediate },
        };
        VisibilityManager._notifyLegend("lyr1", true);
        expect(syncImmediate).toHaveBeenCalledWith("lyr1");
    });

    // ── _fireVisibilityEvent: no map early return (branch 59.0) ──────────────

    it("_fireVisibilityEvent returns early when no map (branch 59.0)", () => {
        expect(() => VisibilityManager._fireVisibilityEvent("lyr1", true, "user")).not.toThrow();
    });

    // ── _applyVisibilityChange: useSharedCluster + clusterGroup via adapter (branch 32.0) ──

    it("_applyVisibilityChange hides via adapter when useSharedCluster=true (branch 32.0)", () => {
        getState().adapter = { showLayer: vi.fn(), hideLayer: vi.fn() };
        const layer = {};
        const clusterGroup = { removeLayer: vi.fn() };
        getState().layers.set("lyr1", {
            id: "lyr1",
            layer,
            clusterGroup,
            useSharedCluster: true,
        });
        const layerData = getState().layers.get("lyr1");
        const result = VisibilityManager._applyVisibilityChange("lyr1", layerData, false);
        expect(result).toBe(true);
        expect(getState().adapter.hideLayer).toHaveBeenCalledWith("lyr1");
    });

    // ── _reFilterChildLayers: inner callback branches (22-27) ────────────────

    // _reFilterChildLayers removed in Sprint 9 — MapLibre handles filtering natively
    it("_applyVisibilityChange delegates to adapter.showLayer (replaces eachLayer filter path)", () => {
        getState().adapter = { showLayer: vi.fn(), hideLayer: vi.fn() };
        const layer = {};
        getState().layers.set("lyr1", { id: "lyr1", layer });
        const result = VisibilityManager._applyVisibilityChange(
            "lyr1",
            getState().layers.get("lyr1"),
            true
        );
        expect(result).toBe(true);
        expect(getState().adapter.showLayer).toHaveBeenCalledWith("lyr1");
    });
});
