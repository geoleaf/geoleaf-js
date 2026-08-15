/**
 * Tests for tool-circle.ts — drag-based circle surface tool.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import * as drawLayers from "../draw-layers.js";
import { initEngine, clearEngineCollection, getEngineCollection } from "../measure-engine.js";
import { activateCircle, deactivateCircle } from "../tools/tool-circle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLngLat(lng: number, lat: number) {
    return { lng, lat, toArray: () => [lng, lat] as [number, number] };
}

/**
 * Fires a full drag: mousedown (center) → mousemove (edge) → mouseup.
 * anchor and cursor must be ≥ 1 m apart in real geography for MIN_RADIUS_M check.
 */
function fireDrag(
    map: ReturnType<typeof makeMockMaplibreMap>,
    center: ReturnType<typeof makeLngLat>,
    edge: ReturnType<typeof makeLngLat>
): void {
    map._fireEvent("mousedown", { lngLat: center, originalEvent: { button: 0 } });
    map._fireEvent("mousemove", { lngLat: edge });
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function setup() {
    const gl = installMockGeoLeaf();
    const map = gl._nativeMap as ReturnType<typeof makeMockMaplibreMap>;
    initLayers(map);
    initEngine(getMeasureConfig());
    return { gl, map };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let map: ReturnType<typeof makeMockMaplibreMap>;

beforeEach(() => {
    ({ map } = setup());
});

afterEach(() => {
    deactivateCircle();
    clearEngineCollection();
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// activateCircle
// ---------------------------------------------------------------------------

describe("activateCircle", () => {
    it("registers mousedown on the map", () => {
        activateCircle(map);
        const events = (map.on as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(events).toContain("mousedown");
    });

    it("sets cursor to crosshair", () => {
        activateCircle(map);
        expect(map.getCanvas().style.cursor).toBe("crosshair");
    });

    it("is idempotent (safe to call twice)", () => {
        activateCircle(map);
        const countBefore = (map.on as ReturnType<typeof vi.fn>).mock.calls.length;
        activateCircle(map);
        expect((map.on as ReturnType<typeof vi.fn>).mock.calls.length).toBe(countBefore);
    });
});

// ---------------------------------------------------------------------------
// Drag sequence → feature created
// ---------------------------------------------------------------------------

describe("drag sequence", () => {
    it("creates a circle feature after a valid drag (radius > 1 m)", () => {
        activateCircle(map);
        // ~3.6 km radius — well above MIN_RADIUS_M (1 m)
        fireDrag(map, makeLngLat(2.3, 48.85), makeLngLat(2.4, 48.85));

        const features = getEngineCollection().features;
        expect(features).toHaveLength(1);
        expect(features[0].properties?.measureType).toBe("circle");
    });

    it("stores radiusM, areaM2, and perimeterM in feature properties", () => {
        activateCircle(map);
        fireDrag(map, makeLngLat(2.3, 48.85), makeLngLat(2.4, 48.85));

        const props = getEngineCollection().features[0].properties!;
        expect(props.radiusM).toBeGreaterThan(0);
        expect(props.areaM2).toBeGreaterThan(0);
        expect(props.perimeterM).toBeGreaterThan(0);
    });

    it("creates a Polygon geometry", () => {
        activateCircle(map);
        fireDrag(map, makeLngLat(2.3, 48.85), makeLngLat(2.4, 48.85));
        expect(getEngineCollection().features[0].geometry.type).toBe("Polygon");
    });

    it("calls updatePreview during mousemove", () => {
        const spy = vi.spyOn(drawLayers, "updatePreview");
        activateCircle(map);
        map._fireEvent("mousedown", {
            lngLat: makeLngLat(2.3, 48.85),
            originalEvent: { button: 0 },
        });
        map._fireEvent("mousemove", { lngLat: makeLngLat(2.4, 48.85) });
        expect(spy).toHaveBeenCalled();
    });

    it("ignores non-left-button mousedown", () => {
        activateCircle(map);
        map._fireEvent("mousedown", {
            lngLat: makeLngLat(2.3, 48.85),
            originalEvent: { button: 2 },
        });
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Drag below radius threshold → no feature
// ---------------------------------------------------------------------------

describe("drag below radius threshold", () => {
    it("does not create a feature when drag is below MIN_RADIUS_M (1 m)", () => {
        activateCircle(map);
        // Same coordinate = radius 0 m
        fireDrag(map, makeLngLat(2.35, 48.85), makeLngLat(2.35, 48.85));
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// deactivateCircle
// ---------------------------------------------------------------------------

describe("deactivateCircle", () => {
    it("calls map.off for mousedown", () => {
        activateCircle(map);
        deactivateCircle();
        const offCalls = (map.off as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(offCalls).toContain("mousedown");
    });

    it("restores default cursor", () => {
        activateCircle(map);
        deactivateCircle();
        expect(map.getCanvas().style.cursor).toBe("grab");
    });

    it("re-enables dragPan", () => {
        activateCircle(map);
        map._fireEvent("mousedown", {
            lngLat: makeLngLat(2.3, 48.85),
            originalEvent: { button: 0 },
        });
        deactivateCircle();
        expect(map.dragPan.enable).toHaveBeenCalled();
    });

    it("is safe to call when tool is not active", () => {
        expect(() => deactivateCircle()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Cumulative measurements
// ---------------------------------------------------------------------------

describe("cumulative measurements", () => {
    it("accumulates two successive circle drags", () => {
        activateCircle(map);
        fireDrag(map, makeLngLat(2.3, 48.85), makeLngLat(2.4, 48.85));
        fireDrag(map, makeLngLat(2.5, 48.85), makeLngLat(2.6, 48.85));
        expect(getEngineCollection().features).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Cursor guard (MutationObserver)
// ---------------------------------------------------------------------------
//
// The drag tools had NO guard until 14/08/2026, while the click tools have had one since
// S5 — the whole difference between "the crosshair comes back" and "it is gone for good".
// The core's POI and cluster hover handlers write `canvas.style.cursor` directly; the first
// mouseleave over a POI wiped the crosshair and nothing put it back.

describe("cursor guard", () => {
    it("restores crosshair when the canvas style is changed externally", async () => {
        activateCircle(map);
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.style.cursor = ""; // exactly what a POI mouseleave writes
        await new Promise((r) => setTimeout(r, 0)); // flush the MutationObserver microtask
        expect(canvas.style.cursor).toBe("crosshair");
    });

    it("stops enforcing once the tool is disarmed", async () => {
        activateCircle(map);
        deactivateCircle();
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.style.cursor = "pointer";
        await new Promise((r) => setTimeout(r, 0));
        expect(canvas.style.cursor).toBe("pointer");
    });
});
