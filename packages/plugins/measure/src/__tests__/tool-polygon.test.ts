/**
 * Tests for tool-polygon.ts — step-by-step polygon surface tool.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import {
    initEngine,
    clearEngineCollection,
    getEngineCollection,
    getSession,
} from "../measure-engine.js";
import { activatePolygon, deactivatePolygon } from "../tools/tool-polygon.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLngLat(lng: number, lat: number) {
    return { lng, lat, toArray: () => [lng, lat] as [number, number] };
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
    deactivatePolygon();
    clearEngineCollection();
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// activatePolygon
// ---------------------------------------------------------------------------

describe("activatePolygon", () => {
    it("registers click, mousemove and dblclick on the map", () => {
        activatePolygon(map);
        const events = (map.on as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(events).toContain("click");
        expect(events).toContain("mousemove");
        expect(events).toContain("dblclick");
    });

    it("sets cursor to crosshair", () => {
        activatePolygon(map);
        expect(map.getCanvas().style.cursor).toBe("crosshair");
    });

    it("is idempotent (safe to call twice)", () => {
        activatePolygon(map);
        const countBefore = (map.on as ReturnType<typeof vi.fn>).mock.calls.length;
        activatePolygon(map);
        expect((map.on as ReturnType<typeof vi.fn>).mock.calls.length).toBe(countBefore);
    });
});

// ---------------------------------------------------------------------------
// click → addVertex (no snap with <3 vertices)
// ---------------------------------------------------------------------------

describe("click events", () => {
    it("adds vertices on successive clicks (no snap below 3 verts)", () => {
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });
        expect(getSession()?.vertices).toHaveLength(3);
    });

    it("does nothing if tool is not active", () => {
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        expect(getSession()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// mousemove events
// ---------------------------------------------------------------------------

describe("mousemove events", () => {
    it("does nothing if tool is not active", () => {
        map._fireEvent("mousemove", { lngLat: makeLngLat(2.3, 48.85) });
        expect(getSession()).toBeNull();
    });

    it("no preview update when no vertices yet", () => {
        activatePolygon(map);
        // 0 vertices — mousemove should not update preview
        expect(() =>
            map._fireEvent("mousemove", { lngLat: makeLngLat(2.35, 48.85) })
        ).not.toThrow();
    });

    it("updates preview and sets crosshair cursor when < 3 vertices (no snap)", async () => {
        vi.spyOn(map, "project").mockImplementation((ll: any) => ({
            x: ll.lng * 1000,
            y: ll.lat * 100,
        }));
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("mousemove", { lngLat: makeLngLat(2.4, 48.85) });
        await new Promise((r) => requestAnimationFrame(r));
        expect(map.getCanvas().style.cursor).toBe("crosshair");
    });

    it("sets pointer cursor when ≥ 3 vertices and snap active (default mock)", async () => {
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });
        // default project mock returns {x:100,y:100} → dist=0 → always snapping
        map._fireEvent("mousemove", { lngLat: makeLngLat(2.3, 48.85) });
        await new Promise((r) => requestAnimationFrame(r));
        expect(map.getCanvas().style.cursor).toBe("pointer");
    });
});

// ---------------------------------------------------------------------------
// snap → close (default mock: all lngLat → {x:100,y:100} → dist=0 → always snapping)
// ---------------------------------------------------------------------------

describe("snap close", () => {
    it("closes the polygon when 4th click snaps onto first vertex (default mock)", () => {
        // Default map.project always returns {x:100,y:100}  →  _pixelDist always 0  →  snap active once verts≥3
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });
        // 4th click: verts.length == 3 → _isSnapping returns true → finishSession
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });

        expect(getEngineCollection().features).toHaveLength(1);
        expect(getSession()).toBeNull();
    });

    it("does NOT snap when fewer than 3 vertices exist", () => {
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.9) }); // different coord, <3 verts → no snap
        expect(getSession()?.vertices).toHaveLength(2);
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// dblclick → close
// ---------------------------------------------------------------------------

describe("dblclick events", () => {
    it("closes the polygon on dblclick with ≥3 vertices", () => {
        // Disable snap so plain clicks add verts without auto-closing
        vi.spyOn(map, "project").mockImplementation((ll: any) => ({
            x: ll.lng * 1000,
            y: ll.lat * 100,
        }));
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });

        const mockEvent = { preventDefault: vi.fn(), lngLat: makeLngLat(2.35, 48.9) };
        map._fireEvent("dblclick", mockEvent);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(getEngineCollection().features).toHaveLength(1);
    });

    it("does NOT close with fewer than 3 vertices", () => {
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        const mockEvent = { preventDefault: vi.fn(), lngLat: makeLngLat(2.4, 48.85) };
        map._fireEvent("dblclick", mockEvent);
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// keydown C → close
// ---------------------------------------------------------------------------

describe("keydown C", () => {
    it("closes the polygon when C is pressed with ≥3 vertices", () => {
        vi.spyOn(map, "project").mockImplementation((ll: any) => ({
            x: ll.lng * 1000,
            y: ll.lat * 100,
        }));
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));

        expect(getEngineCollection().features).toHaveLength(1);
    });

    it("does not close with fewer than 3 vertices", () => {
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "C" }));
        expect(getEngineCollection().features).toHaveLength(0);
    });

    it("does nothing if tool is not active", () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// deactivatePolygon
// ---------------------------------------------------------------------------

describe("deactivatePolygon", () => {
    it("calls map.off for all registered events", () => {
        activatePolygon(map);
        deactivatePolygon();
        const offCalls = (map.off as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(offCalls).toContain("click");
        expect(offCalls).toContain("mousemove");
        expect(offCalls).toContain("dblclick");
    });

    it("restores default cursor", () => {
        activatePolygon(map);
        deactivatePolygon();
        expect(map.getCanvas().style.cursor).toBe("grab");
    });

    it("cancels an open session", () => {
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        deactivatePolygon();
        expect(getSession()).toBeNull();
    });

    it("is safe to call when tool is not active", () => {
        expect(() => deactivatePolygon()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// DOM capture — container-level click / dblclick handlers
// ---------------------------------------------------------------------------

describe("DOM capture handlers", () => {
    it("container click on canvas adds a vertex via unproject", () => {
        vi.spyOn(map, "project").mockImplementation((ll: any) => ({
            x: ll.lng * 1000,
            y: ll.lat * 100,
        }));
        activatePolygon(map);
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(getSession()?.vertices).toHaveLength(1);
    });

    it("container click is ignored when target is not the canvas", () => {
        activatePolygon(map);
        const container = map.getContainer() as HTMLElement;
        const inner = document.createElement("div");
        container.appendChild(inner);
        inner.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(getSession()?.vertices).toHaveLength(0);
        container.removeChild(inner);
    });

    it("container click closes polygon on snap (≥3 vertices, default project mock)", () => {
        // Default project always returns {x:100,y:100} → pixelDist=0 → snapping
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });
        // Container click at same projected point → snap → close
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(getEngineCollection().features).toHaveLength(1);
    });

    it("container click skips duplicate coord", () => {
        vi.spyOn(map, "project").mockImplementation((ll: any) => ({
            x: ll.lng * 1000,
            y: ll.lat * 100,
        }));
        activatePolygon(map);
        const canvas = map.getCanvas() as HTMLCanvasElement;
        // Both clicks resolve to the same coord from unproject mock
        canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(getSession()?.vertices).toHaveLength(1);
    });

    it("container dblclick closes polygon with ≥3 vertices", () => {
        vi.spyOn(map, "project").mockImplementation((ll: any) => ({
            x: ll.lng * 1000,
            y: ll.lat * 100,
        }));
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        expect(getEngineCollection().features).toHaveLength(1);
    });

    it("container dblclick does nothing with fewer than 3 vertices", () => {
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Cursor guard (MutationObserver) — polygon
// ---------------------------------------------------------------------------

describe("cursor guard", () => {
    it("restores crosshair when canvas style is changed externally", async () => {
        vi.spyOn(map, "project").mockImplementation((ll: any) => ({
            x: ll.lng * 1000,
            y: ll.lat * 100,
        }));
        activatePolygon(map);
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.style.cursor = "default"; // external change
        await new Promise((r) => setTimeout(r, 0));
        expect(canvas.style.cursor).toBe("crosshair");
    });

    it("restores pointer cursor when snapping and style is changed externally", async () => {
        activatePolygon(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });
        map._fireEvent("mousemove", { lngLat: makeLngLat(2.3, 48.85) }); // triggers snapping
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.style.cursor = "default"; // external change
        await new Promise((r) => setTimeout(r, 0));
        expect(canvas.style.cursor).toBe("pointer");
    });
});

// ---------------------------------------------------------------------------
// Cumulative measurements
// ---------------------------------------------------------------------------

describe("cumulative measurements", () => {
    it("accumulates two successive polygon sessions", () => {
        vi.useFakeTimers();
        vi.spyOn(map, "project").mockImplementation((ll: any) => ({
            x: ll.lng * 1000,
            y: ll.lat * 100,
        }));
        activatePolygon(map);

        // Session 1: 3 verts + dblclick
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.9) });
        map._fireEvent("dblclick", { preventDefault: vi.fn(), lngLat: makeLngLat(2.35, 48.9) });

        vi.advanceTimersByTime(100);

        // Session 2: 3 verts + C
        map._fireEvent("click", { lngLat: makeLngLat(2.5, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.6, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.55, 48.9) });
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));

        expect(getEngineCollection().features).toHaveLength(2);

        vi.useRealTimers();
    });
});
