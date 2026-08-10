/**
 * Tests for tool-distance.ts — polyline distance tool.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import * as drawLayers from "../draw-layers.js";
import {
    initEngine,
    clearEngineCollection,
    getEngineCollection,
    getSession,
} from "../measure-engine.js";
import { activateDistance, deactivateDistance } from "../tools/tool-distance.js";

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
    deactivateDistance();
    clearEngineCollection();
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// activateDistance
// ---------------------------------------------------------------------------

describe("activateDistance", () => {
    it("registers map event listeners", () => {
        activateDistance(map);
        // on() should have been called for click, mousemove, dblclick
        const calls = (map.on as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(calls).toContain("click");
        expect(calls).toContain("mousemove");
        expect(calls).toContain("dblclick");
    });

    it("sets cursor to crosshair", () => {
        activateDistance(map);
        expect(map.getCanvas().style.cursor).toBe("crosshair");
    });

    it("is idempotent (safe to call twice)", () => {
        activateDistance(map);
        const countBefore = (map.on as ReturnType<typeof vi.fn>).mock.calls.length;
        activateDistance(map);
        expect((map.on as ReturnType<typeof vi.fn>).mock.calls.length).toBe(countBefore);
    });
});

// ---------------------------------------------------------------------------
// click → addVertex
// ---------------------------------------------------------------------------

describe("click events", () => {
    it("adds a vertex on each click", () => {
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        expect(getSession()?.vertices).toHaveLength(2);
    });

    it("does nothing if tool not active", () => {
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        expect(getSession()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// mousemove → updatePreview
// ---------------------------------------------------------------------------

describe("mousemove events", () => {
    it("calls updatePreview on the draw-layers module", () => {
        const spy = vi.spyOn(drawLayers, "updatePreview");
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("mousemove", { lngLat: makeLngLat(2.4, 48.85) });
        expect(spy).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// dblclick → finish
// ---------------------------------------------------------------------------

describe("dblclick events", () => {
    it("finishes the session after ≥2 vertices", async () => {
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        const mockEvent = { preventDefault: vi.fn(), lngLat: makeLngLat(2.4, 48.85) };
        map._fireEvent("dblclick", mockEvent);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
        // After finish, a new session starts — collection should have one feature
        // (the 50ms timeout hasn't fired yet, but the finish has)
        expect(getEngineCollection().features).toHaveLength(1);
    });

    it("does NOT finish with fewer than 2 vertices", () => {
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        const mockEvent = { preventDefault: vi.fn(), lngLat: makeLngLat(2.3, 48.85) };
        map._fireEvent("dblclick", mockEvent);
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// keydown Space → finish
// ---------------------------------------------------------------------------

describe("keydown Space", () => {
    it("finishes the session when Space is pressed with ≥2 vertices", () => {
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });

        const ev = new KeyboardEvent("keydown", { key: " ", code: "Space" });
        document.dispatchEvent(ev);

        expect(getEngineCollection().features).toHaveLength(1);
    });

    it("does not finish with fewer than 2 vertices", () => {
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
        expect(getEngineCollection().features).toHaveLength(0);
    });

    it("does nothing if tool is not active", () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// deactivateDistance
// ---------------------------------------------------------------------------

describe("deactivateDistance", () => {
    it("calls map.off for all registered events", () => {
        activateDistance(map);
        deactivateDistance();
        const offCalls = (map.off as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(offCalls).toContain("click");
        expect(offCalls).toContain("mousemove");
        expect(offCalls).toContain("dblclick");
    });

    it("restores default cursor", () => {
        activateDistance(map);
        deactivateDistance();
        expect(map.getCanvas().style.cursor).toBe("grab");
    });

    it("cancels an open session", () => {
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        deactivateDistance();
        expect(getSession()).toBeNull();
    });

    it("is safe to call when tool is not active", () => {
        expect(() => deactivateDistance()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// DOM capture — container-level click / dblclick handlers
// ---------------------------------------------------------------------------

describe("DOM capture handlers", () => {
    it("container click on canvas adds a vertex via unproject", () => {
        activateDistance(map);
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(getSession()?.vertices).toHaveLength(1);
        // coord comes from map.unproject mock → [2.35, 48.85]
        expect(getSession()?.vertices[0]).toEqual([2.35, 48.85]);
    });

    it("container click is ignored when target is not the canvas", () => {
        activateDistance(map);
        const container = map.getContainer() as HTMLElement;
        // Dispatch on a child div that is NOT the canvas
        const inner = document.createElement("div");
        container.appendChild(inner);
        inner.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(getSession()?.vertices).toHaveLength(0);
        container.removeChild(inner);
    });

    it("container click skips duplicate coord", () => {
        activateDistance(map);
        const canvas = map.getCanvas() as HTMLCanvasElement;
        // Both clicks resolve to the same coord from unproject mock
        canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(getSession()?.vertices).toHaveLength(1);
    });

    it("container dblclick finishes session with ≥2 vertices", () => {
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.86) });
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        expect(getEngineCollection().features).toHaveLength(1);
    });

    it("container dblclick does nothing with fewer than 2 vertices", () => {
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        expect(getEngineCollection().features).toHaveLength(0);
    });

    it("container click is ignored when _justFinished (post-dblclick window)", () => {
        vi.useFakeTimers();
        activateDistance(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.86) });
        // Trigger finish via MapLibre dblclick → _justFinished = true
        map._fireEvent("dblclick", { preventDefault: vi.fn(), lngLat: makeLngLat(2.4, 48.86) });
        // Container click during the 50ms window should be ignored
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        // Still only 1 feature (the finished one), no new vertex added
        expect(getEngineCollection().features).toHaveLength(1);
        vi.useRealTimers();
    });
});

// ---------------------------------------------------------------------------
// Cursor guard (MutationObserver)
// ---------------------------------------------------------------------------

describe("cursor guard", () => {
    it("restores crosshair when canvas style is changed externally", async () => {
        activateDistance(map);
        const canvas = map.getCanvas() as HTMLCanvasElement;
        canvas.style.cursor = "default"; // external change
        await new Promise((r) => setTimeout(r, 0)); // flush MutationObserver microtask
        expect(canvas.style.cursor).toBe("crosshair");
    });
});

// ---------------------------------------------------------------------------
// Cumulative measurements
// ---------------------------------------------------------------------------

describe("cumulative measurements", () => {
    it("accumulates two successive sessions in the collection", () => {
        vi.useFakeTimers();
        activateDistance(map);

        // Session 1: click click dblclick
        map._fireEvent("click", { lngLat: makeLngLat(2.3, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.4, 48.85) });
        map._fireEvent("dblclick", { preventDefault: vi.fn(), lngLat: makeLngLat(2.4, 48.85) });

        // Advance past the 50ms _justFinished guard — new session starts
        vi.advanceTimersByTime(100);

        // Session 2: click click Space
        map._fireEvent("click", { lngLat: makeLngLat(2.5, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.6, 48.85) });
        document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));

        expect(getEngineCollection().features).toHaveLength(2);

        vi.useRealTimers();
    });
});
