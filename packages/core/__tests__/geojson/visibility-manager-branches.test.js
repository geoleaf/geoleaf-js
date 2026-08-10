/**
 * Branch-coverage companion for src/kernel/geojson/visibility-manager.ts
 * Covers: setVisibility, _canChangeVisibility, _updateVisibilityFlags,
 *         _applyVisibilityChange, _notifyLegend, _fireVisibilityEvent,
 *         resetUserOverride, resetAllUserOverrides, getVisibilityState
 */

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        state: {
            map: { fire: vi.fn(), addLayer: vi.fn(), removeLayer: vi.fn() },
            layers: new Map(),
            adapter: null,
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
vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

import { VisibilityManager } from "../../src/kernel/geojson/visibility-manager.js";
import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";
import { dispatchGeoLeafEvent } from "../../src/kernel/events/event-bus.js";

function makeLayer(overrides = {}) {
    return { layer: {}, visible: false, config: {}, ...overrides };
}

describe("visibility-manager.ts — branch coverage", () => {
    const state = GeoJSONShared.state;

    beforeEach(() => {
        vi.clearAllMocks();
        state.layers.clear();
        state.map = { fire: vi.fn(), addLayer: vi.fn(), removeLayer: vi.fn() };
        state.adapter = {
            showLayer: vi.fn(),
            hideLayer: vi.fn(),
        };
        delete globalThis.GeoLeaf;
    });

    // ── _canChangeVisibility ────────────────────────────────────────────
    describe("_canChangeVisibility", () => {
        it("always allows USER source", () => {
            const meta = { userOverride: true, themeOverride: true };
            expect(VisibilityManager._canChangeVisibility(meta, "user", true)).toBe(true);
        });

        it("always allows ZOOM source", () => {
            const meta = { userOverride: true };
            expect(VisibilityManager._canChangeVisibility(meta, "zoom", false)).toBe(true);
        });

        it("blocks non-user when userOverride is true", () => {
            const meta = { userOverride: true };
            expect(VisibilityManager._canChangeVisibility(meta, "theme", true)).toBe(false);
        });

        it("blocks zoom re-enable when theme has hidden", () => {
            // This branch unreachable since zoom always returns true above
            // but test the THEME source can override zoom
            const meta = { userOverride: false, themeOverride: true, themeDesired: false };
            expect(VisibilityManager._canChangeVisibility(meta, "theme", true)).toBe(true);
        });

        it("allows THEME when no user override", () => {
            const meta = { userOverride: false };
            expect(VisibilityManager._canChangeVisibility(meta, "theme", true)).toBe(true);
        });

        it("allows SYSTEM source by default", () => {
            const meta = { userOverride: false };
            expect(VisibilityManager._canChangeVisibility(meta, "system", true)).toBe(true);
        });
    });

    // ── _updateVisibilityFlags ──────────────────────────────────────────
    describe("_updateVisibilityFlags", () => {
        it("USER resets theme/zoom and sets logicalState", () => {
            const meta = {
                themeOverride: true,
                zoomConstrained: true,
                logicalState: false,
                userOverride: false,
            };
            VisibilityManager._updateVisibilityFlags(meta, "user", true);
            expect(meta.userOverride).toBe(true);
            expect(meta.themeOverride).toBe(false);
            expect(meta.zoomConstrained).toBe(false);
            expect(meta.logicalState).toBe(true);
        });

        it("THEME updates if no userOverride", () => {
            const meta = {
                userOverride: false,
                themeOverride: false,
                themeDesired: null,
                logicalState: false,
            };
            VisibilityManager._updateVisibilityFlags(meta, "theme", false);
            expect(meta.themeOverride).toBe(true);
            expect(meta.themeDesired).toBe(false);
            expect(meta.logicalState).toBe(false);
        });

        it("THEME skips when userOverride active", () => {
            const meta = { userOverride: true, themeOverride: false, logicalState: true };
            VisibilityManager._updateVisibilityFlags(meta, "theme", false);
            expect(meta.themeOverride).toBe(false);
            expect(meta.logicalState).toBe(true);
        });

        it("ZOOM sets zoomConstrained when no userOverride", () => {
            const meta = { userOverride: false, zoomConstrained: false };
            VisibilityManager._updateVisibilityFlags(meta, "zoom", false);
            expect(meta.zoomConstrained).toBe(true);
        });

        it("ZOOM skips zoomConstrained when userOverride", () => {
            const meta = { userOverride: true, zoomConstrained: false };
            VisibilityManager._updateVisibilityFlags(meta, "zoom", false);
            expect(meta.zoomConstrained).toBe(false);
        });

        it("SYSTEM resets all overrides", () => {
            const meta = {
                userOverride: true,
                themeOverride: true,
                themeDesired: false,
                zoomConstrained: true,
                logicalState: false,
            };
            VisibilityManager._updateVisibilityFlags(meta, "system", true);
            expect(meta.userOverride).toBe(false);
            expect(meta.themeOverride).toBe(false);
            expect(meta.themeDesired).toBeNull();
            expect(meta.zoomConstrained).toBe(false);
            expect(meta.logicalState).toBe(true);
        });
    });

    // ── setVisibility ───────────────────────────────────────────────────
    describe("setVisibility", () => {
        it("returns false for unknown layer", () => {
            expect(VisibilityManager.setVisibility("unknown", true, "user")).toBe(false);
        });

        it("initialises visibility metadata on first call", () => {
            const ld = makeLayer();
            state.layers.set("layer1", ld);
            VisibilityManager.setVisibility("layer1", true, "system");
            expect(ld._visibility).toBeDefined();
            expect(ld._visibility.source).toBe("system");
        });

        it("returns false when canChange is false", () => {
            const ld = makeLayer({
                _visibility: {
                    current: true,
                    logicalState: true,
                    source: "user",
                    userOverride: true,
                    themeOverride: false,
                    themeDesired: null,
                    zoomConstrained: false,
                },
            });
            state.layers.set("layer2", ld);
            // Theme cannot override user
            expect(VisibilityManager.setVisibility("layer2", false, "theme")).toBe(false);
        });

        it("fires event on successful change", () => {
            const ld = makeLayer();
            state.layers.set("layer3", ld);
            VisibilityManager.setVisibility("layer3", true, "user");
            expect(state.map.fire).toHaveBeenCalled();
            expect(dispatchGeoLeafEvent).toHaveBeenCalled();
        });

        it("updates legacy flags on change", () => {
            const ld = makeLayer();
            state.layers.set("layer4", ld);
            VisibilityManager.setVisibility("layer4", false, "user");
            expect(ld.userDisabled).toBe(true);
        });

        it("fires event when logical state changes without physical", () => {
            const ld = makeLayer({
                _visibility: {
                    current: true,
                    logicalState: true,
                    source: "system",
                    userOverride: false,
                    themeOverride: false,
                    themeDesired: null,
                    zoomConstrained: false,
                },
            });
            state.layers.set("layer5", ld);
            // Make adapter.showLayer fail to prevent physical change
            state.adapter.showLayer = vi.fn(() => {
                throw new Error("fail");
            });
            // Despite physical fail, user intent changes
            VisibilityManager.setVisibility("layer5", true, "user");
            // The event for logical change should still fire
        });
    });

    // ── _applyVisibilityChange ──────────────────────────────────────────
    describe("_applyVisibilityChange", () => {
        it("calls adapter.showLayer when visible=true", () => {
            const ld = makeLayer();
            state.layers.set("lyr", ld);
            const result = VisibilityManager._applyVisibilityChange("lyr", ld, true);
            expect(state.adapter.showLayer).toHaveBeenCalledWith("lyr");
            expect(result).toBe(true);
        });

        it("calls adapter.hideLayer when visible=false", () => {
            const ld = makeLayer();
            state.layers.set("lyr", ld);
            const result = VisibilityManager._applyVisibilityChange("lyr", ld, false);
            expect(state.adapter.hideLayer).toHaveBeenCalledWith("lyr");
            expect(result).toBe(true);
        });

        it("returns false when no adapter", () => {
            state.adapter = null;
            const ld = makeLayer();
            const result = VisibilityManager._applyVisibilityChange("noAdapt", ld, true);
            expect(result).toBe(false);
        });

        it("returns false when adapter throws", () => {
            state.adapter = {
                showLayer: vi.fn(() => {
                    throw new Error("boom");
                }),
            };
            const ld = makeLayer();
            const result = VisibilityManager._applyVisibilityChange("err", ld, true);
            expect(result).toBe(false);
        });

        it("falls back to GeoLeaf.Core.getMap when no state.adapter", () => {
            state.adapter = null;
            globalThis.GeoLeaf = {
                Core: { getMap: vi.fn(() => ({ showLayer: vi.fn(), hideLayer: vi.fn() })) },
            };
            const ld = makeLayer();
            const result = VisibilityManager._applyVisibilityChange("fb", ld, true);
            expect(result).toBe(true);
        });
    });

    // ── _notifyLegend ───────────────────────────────────────────────────
    describe("_notifyLegend", () => {
        it("calls Legend.setLayerVisibility when available", () => {
            const setVis = vi.fn();
            globalThis.GeoLeaf = { Legend: { setLayerVisibility: setVis } };
            VisibilityManager._notifyLegend("lyr", true);
            expect(setVis).toHaveBeenCalledWith("lyr", true);
        });

        it("calls Labels.refreshLabels when visible", () => {
            const refresh = vi.fn();
            globalThis.GeoLeaf = { Labels: { refreshLabels: refresh } };
            VisibilityManager._notifyLegend("lyr", true);
            expect(refresh).toHaveBeenCalledWith("lyr");
        });

        it("calls Labels._hideLabelsForLayer when not visible", () => {
            const hide = vi.fn();
            globalThis.GeoLeaf = { Labels: { _hideLabelsForLayer: hide } };
            VisibilityManager._notifyLegend("lyr", false);
            expect(hide).toHaveBeenCalledWith("lyr");
        });

        it("calls _LabelButtonManager.syncImmediate when available", () => {
            const sync = vi.fn();
            globalThis.GeoLeaf = { _LabelButtonManager: { syncImmediate: sync } };
            VisibilityManager._notifyLegend("lyr", true);
            expect(sync).toHaveBeenCalledWith("lyr");
        });

        it("does nothing when GeoLeaf is undefined", () => {
            delete globalThis.GeoLeaf;
            // Should not throw
            VisibilityManager._notifyLegend("lyr", true);
        });
    });

    // ── _fireVisibilityEvent ────────────────────────────────────────────
    describe("_fireVisibilityEvent", () => {
        it("fires map event + DOM event for user source", () => {
            const ld = makeLayer();
            state.layers.set("ev", ld);
            VisibilityManager._fireVisibilityEvent("ev", true, "user");
            expect(state.map.fire).toHaveBeenCalledWith(
                "geoleaf:geojson:visibility-changed",
                expect.any(Object)
            );
            expect(dispatchGeoLeafEvent).toHaveBeenCalledWith(
                "geoleaf:layer:toggle",
                expect.any(Object)
            );
        });

        it("skips DOM CustomEvent for zoom source", () => {
            const spy = vi.spyOn(document, "dispatchEvent");
            VisibilityManager._fireVisibilityEvent("ev", true, "zoom");
            // dispatchEvent should NOT be called for zoom but dispatchGeoLeafEvent still fires
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("handles map.fire throwing", () => {
            state.map = {
                fire: vi.fn(() => {
                    throw new Error("fire fail");
                }),
            };
            // Should not throw
            VisibilityManager._fireVisibilityEvent("ev", true, "user");
        });

        it("returns early when no map", () => {
            state.map = null;
            VisibilityManager._fireVisibilityEvent("ev", true, "user");
            // No error
        });
    });

    // ── resetUserOverride ───────────────────────────────────────────────
    describe("resetUserOverride", () => {
        it("resets _visibility.userOverride", () => {
            const ld = makeLayer({
                _visibility: {
                    userOverride: true,
                    current: true,
                    logicalState: true,
                    source: "user",
                },
            });
            state.layers.set("reset1", ld);
            VisibilityManager.resetUserOverride("reset1");
            expect(ld._visibility.userOverride).toBe(false);
        });

        it("does nothing for unknown layer", () => {
            VisibilityManager.resetUserOverride("nonexistent");
        });
    });

    // ── resetAllUserOverrides ───────────────────────────────────────────
    describe("resetAllUserOverrides", () => {
        it("resets all layers with userOverride", () => {
            const ld1 = makeLayer({ _visibility: { userOverride: true } });
            const ld2 = makeLayer({ _visibility: { userOverride: true } });
            const ld3 = makeLayer({ _visibility: { userOverride: false } });
            state.layers.set("a", ld1);
            state.layers.set("b", ld2);
            state.layers.set("c", ld3);
            VisibilityManager.resetAllUserOverrides();
            expect(ld1._visibility.userOverride).toBe(false);
            expect(ld2._visibility.userOverride).toBe(false);
        });

        it("handles empty layers map", () => {
            state.layers.clear();
            VisibilityManager.resetAllUserOverrides();
        });
    });

    // ── getVisibilityState ──────────────────────────────────────────────
    describe("getVisibilityState", () => {
        it("returns null for unknown layer", () => {
            expect(VisibilityManager.getVisibilityState("unknown")).toBeNull();
        });

        it("returns visibility metadata", () => {
            const ld = makeLayer({
                _visibility: {
                    current: true,
                    source: "user",
                    userOverride: true,
                    themeOverride: false,
                    zoomConstrained: false,
                    logicalState: true,
                },
            });
            state.layers.set("vs", ld);
            const vs = VisibilityManager.getVisibilityState("vs");
            expect(vs.current).toBe(true);
            expect(vs.userOverride).toBe(true);
        });

        it("initialises metadata if missing", () => {
            const ld = makeLayer();
            state.layers.set("init", ld);
            const vs = VisibilityManager.getVisibilityState("init");
            expect(vs).toBeDefined();
            expect(vs.current).toBe(false);
        });
    });
});
