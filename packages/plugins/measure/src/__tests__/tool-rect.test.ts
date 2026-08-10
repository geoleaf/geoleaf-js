/**
 * Tests for tool-rect.ts — drag-based rectangle surface tool.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import * as drawLayers from "../draw-layers.js";
import { initEngine, clearEngineCollection, getEngineCollection } from "../measure-engine.js";
import { activateRect, deactivateRect } from "../tools/tool-rect.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLngLat(lng: number, lat: number) {
    return { lng, lat, toArray: () => [lng, lat] as [number, number] };
}

/** Fires a full drag sequence: mousedown → mousemove → mouseup. */
function fireDrag(
    map: ReturnType<typeof makeMockMaplibreMap>,
    anchor: ReturnType<typeof makeLngLat>,
    cursor: ReturnType<typeof makeLngLat>
): void {
    map._fireEvent("mousedown", { lngLat: anchor, originalEvent: { button: 0 } });
    map._fireEvent("mousemove", { lngLat: cursor });
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
    // Make project return distinct pixels so _pixelDist > MIN_DRAG_PX (5 px).
    vi.spyOn(map, "project").mockImplementation((ll: any) => ({
        x: ll.lng < 2.37 ? 0 : 200,
        y: ll.lat < 48.87 ? 0 : 200,
    }));
});

afterEach(() => {
    deactivateRect();
    clearEngineCollection();
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// activateRect
// ---------------------------------------------------------------------------

describe("activateRect", () => {
    it("registers mousedown on the map", () => {
        activateRect(map);
        const events = (map.on as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(events).toContain("mousedown");
    });

    it("sets cursor to crosshair", () => {
        activateRect(map);
        expect(map.getCanvas().style.cursor).toBe("crosshair");
    });

    it("is idempotent (safe to call twice)", () => {
        activateRect(map);
        const countBefore = (map.on as ReturnType<typeof vi.fn>).mock.calls.length;
        activateRect(map);
        expect((map.on as ReturnType<typeof vi.fn>).mock.calls.length).toBe(countBefore);
    });
});

// ---------------------------------------------------------------------------
// Drag sequence → feature created
// ---------------------------------------------------------------------------

describe("drag sequence", () => {
    it("creates a rect feature after a valid drag", () => {
        activateRect(map);
        fireDrag(map, makeLngLat(2.3, 48.8), makeLngLat(2.4, 48.9));

        const features = getEngineCollection().features;
        expect(features).toHaveLength(1);
        expect(features[0].properties?.measureType).toBe("rect");
    });

    it("stores areaM2 and perimeterM in feature properties", () => {
        activateRect(map);
        fireDrag(map, makeLngLat(2.3, 48.8), makeLngLat(2.4, 48.9));

        const props = getEngineCollection().features[0].properties!;
        expect(props.areaM2).toBeGreaterThan(0);
        expect(props.perimeterM).toBeGreaterThan(0);
    });

    it("creates a Polygon geometry", () => {
        activateRect(map);
        fireDrag(map, makeLngLat(2.3, 48.8), makeLngLat(2.4, 48.9));

        expect(getEngineCollection().features[0].geometry.type).toBe("Polygon");
    });

    it("calls updatePreview during mousemove", () => {
        const spy = vi.spyOn(drawLayers, "updatePreview");
        activateRect(map);
        map._fireEvent("mousedown", {
            lngLat: makeLngLat(2.3, 48.8),
            originalEvent: { button: 0 },
        });
        map._fireEvent("mousemove", { lngLat: makeLngLat(2.4, 48.9) });
        expect(spy).toHaveBeenCalled();
    });

    it("ignores non-left-button mousedown", () => {
        activateRect(map);
        map._fireEvent("mousedown", {
            lngLat: makeLngLat(2.3, 48.8),
            originalEvent: { button: 2 },
        });
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Drag below pixel threshold → no feature
// ---------------------------------------------------------------------------

describe("drag below threshold", () => {
    it("does not create a feature when drag is below MIN_DRAG_PX", () => {
        // Override project so all coords map to the same pixel → dist = 0
        vi.spyOn(map, "project").mockReturnValue({ x: 100, y: 100 });
        activateRect(map);
        fireDrag(map, makeLngLat(2.35, 48.85), makeLngLat(2.35, 48.85));
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// deactivateRect
// ---------------------------------------------------------------------------

describe("deactivateRect", () => {
    it("calls map.off for mousedown", () => {
        activateRect(map);
        deactivateRect();
        const offCalls = (map.off as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(offCalls).toContain("mousedown");
    });

    it("restores default cursor", () => {
        activateRect(map);
        deactivateRect();
        expect(map.getCanvas().style.cursor).toBe("grab");
    });

    it("re-enables dragPan", () => {
        activateRect(map);
        map._fireEvent("mousedown", {
            lngLat: makeLngLat(2.3, 48.8),
            originalEvent: { button: 0 },
        });
        deactivateRect();
        expect(map.dragPan.enable).toHaveBeenCalled();
    });

    it("is safe to call when tool is not active", () => {
        expect(() => deactivateRect()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Cumulative measurements
// ---------------------------------------------------------------------------

describe("cumulative measurements", () => {
    it("accumulates two successive rect drags", () => {
        activateRect(map);
        fireDrag(map, makeLngLat(2.3, 48.8), makeLngLat(2.4, 48.9));
        fireDrag(map, makeLngLat(2.5, 48.8), makeLngLat(2.6, 48.9));
        expect(getEngineCollection().features).toHaveLength(2);
    });
});
