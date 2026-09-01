import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// config.ts reads the typed core Config (`modules.feature-info` gate) — mock it.
const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));

import { FeatureInfoLifecycle } from "../../../src/capabilities/feature-info/lifecycle.js";
class FakePopup {
    node = null;
    setLngLat() {
        return this;
    }
    setDOMContent(n) {
        this.node = n;
        return this;
    }
    addTo() {
        if (this.node) document.body.appendChild(this.node);
        return this;
    }
    remove() {
        this.node?.remove?.();
        return this;
    }
    on() {
        return this;
    }
}
function dispatchFeatureClick(layerId = "l1") {
    document.dispatchEvent(
        new CustomEvent("geoleaf:feature:click", {
            detail: {
                layerId,
                featureId: "f1",
                properties: { name: "Test" },
                geometry: null,
                lngLat: { lat: 0, lng: 0 },
                point: { x: 10, y: 20 },
            },
        })
    );
}
function dispatchFeatureHover(phase = "move", layerId = "l1") {
    document.dispatchEvent(
        new CustomEvent("geoleaf:feature:hover", {
            detail: {
                layerId,
                featureId: "f1",
                properties: { name: "Test" },
                lngLat: { lat: 0, lng: 0 },
                point: { x: 10, y: 20 },
                zIndex: 0,
                phase,
            },
        })
    );
}
describe("FeatureInfoLifecycle", () => {
    beforeEach(() => {
        FeatureInfoLifecycle._reset();
        // Default: capability enabled (absent config → getFeatureInfoConfig default enabled:true).
        configGet.mockImplementation((_k, d) => d);
        globalThis.maplibregl = { Popup: FakePopup };
        globalThis.GeoLeaf = {
            Core: {
                getMap: () => ({ getNativeMap: () => ({ getContainer: () => document.body }) }),
            },
            // ⚠️ The layer declares its reading. This stub had NO `GeoJSON`
            // seam and both render cases leaned on the implicit fallback,
            // since removed — what is tested here is the WIRING of the
            // kernel's two signals, not field resolution.
            GeoJSON: {
                getLayerConfig: (id) =>
                    id === "l1"
                        ? {
                              capabilities: {
                                  "feature-info": {
                                      tooltip: [{ field: "name" }],
                                      popup: [{ field: "name" }],
                                  },
                              },
                          }
                        : null,
            },
        };
    });
    afterEach(() => {
        FeatureInfoLifecycle._reset();
        configGet.mockReset();
        delete globalThis.GeoLeaf;
        delete globalThis.maplibregl;
    });
    it("init() is idempotent \u2014 calling twice does not double-register", () => {
        FeatureInfoLifecycle.init();
        FeatureInfoLifecycle.init();
        dispatchFeatureClick();
        const popups = document.querySelectorAll(".gl-poi-popup");
        expect(popups.length).toBeLessThanOrEqual(1);
    });
    it("does NOT handle events before init()", () => {
        dispatchFeatureClick();
        expect(document.querySelectorAll(".gl-poi-popup").length).toBe(0);
    });
    it("handles geoleaf:feature:click after init() \u2014 popup appears", () => {
        FeatureInfoLifecycle.init();
        dispatchFeatureClick();
        expect(document.querySelector(".gl-poi-popup")).not.toBeNull();
    });
    it("handles geoleaf:feature:hover move \u2014 tooltip appears", () => {
        FeatureInfoLifecycle.init();
        dispatchFeatureHover("move");
        expect(document.querySelector(".gl-fi-tooltip")).not.toBeNull();
    });
    it("handles geoleaf:feature:hover leave \u2014 tooltip hidden", () => {
        FeatureInfoLifecycle.init();
        dispatchFeatureHover("move");
        dispatchFeatureHover("leave");
        const tt = document.querySelector(".gl-fi-tooltip");
        if (tt) expect(tt.style.display).toBe("none");
    });
    it("_reset() removes event listeners \u2014 no popup after reset", () => {
        FeatureInfoLifecycle.init();
        FeatureInfoLifecycle._reset();
        dispatchFeatureClick();
        expect(document.querySelectorAll(".gl-poi-popup").length).toBe(0);
    });
    it("respects capability disabled state (enabled: false)", () => {
        configGet.mockImplementation((k) =>
            k === "modules.feature-info" ? { enabled: false } : undefined
        );
        FeatureInfoLifecycle.init();
        dispatchFeatureClick();
        expect(document.querySelectorAll(".gl-poi-popup").length).toBe(0);
    });
});
