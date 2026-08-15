/**
 * Tests for the TOUCH path of `createDragTool` — the shared circle/rect drag lifecycle.
 *
 * Written against the factory rather than through `tool-circle` / `tool-rect`: both tools
 * are the same lifecycle with a different validity threshold, so driving a stub spec keeps
 * the geometry out of the way and lets the gesture itself be asserted.
 *
 * 🛑 Why this file exists at all: until 14/08/2026 the factory listened to `mousedown` /
 * `mousemove` / `mouseup` only. A finger drag emits NO compatibility mouse events, and the
 * `originalEvent.button !== 0` guard rejected anything without a button anyway — so circle
 * and rect were simply unusable on a phone, and the type (`originalEvent?: MouseEvent`)
 * said so without anybody reading it that way.
 *
 * The browser-side proof is `e2e/33-measure-drag.touch.spec.js` (project `chromium-touch`,
 * drag through CDP). These tests hold the branches happy-dom CAN reach: the single-finger
 * guard, the anchor lifecycle, and the cancel path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import * as drawLayers from "../draw-layers.js";
import { initEngine, clearEngineCollection } from "../measure-engine.js";
import { createDragTool } from "../tools/tool-shared.js";
import type { MeasureMap } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLngLat(lng: number, lat: number) {
    return { lng, lat, toArray: () => [lng, lat] as [number, number] };
}

/** Minimal spec: records what the lifecycle asked of it, validates on a distance. */
function makeSpec(minSpan = 0.001) {
    const commits: Array<[number, number][]> = [];
    return {
        commits,
        spec: {
            start: (coord: [number, number]) => [coord] as [number, number][],
            move: (state: [number, number][], coord: [number, number]) =>
                [state[0]!, coord] as [number, number][],
            isValid: (state: [number, number][]) =>
                state.length === 2 && Math.abs(state[1]![0] - state[0]![0]) >= minSpan,
            commit: (state: [number, number][]) => {
                commits.push(state);
            },
        },
    };
}

let map: ReturnType<typeof makeMockMaplibreMap>;

beforeEach(() => {
    const gl = installMockGeoLeaf();
    map = gl._nativeMap as ReturnType<typeof makeMockMaplibreMap>;
    initLayers(map);
    initEngine(getMeasureConfig());
});

afterEach(() => {
    clearEngineCollection();
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The gesture
// ---------------------------------------------------------------------------

describe("createDragTool — touch path", () => {
    it("a one-finger drag commits, exactly like a mouse drag", () => {
        const { spec, commits } = makeSpec();
        const tool = createDragTool(spec);
        tool.activate(map as unknown as MeasureMap);

        map._fireEvent("touchstart", { lngLat: makeLngLat(1, 1), points: [{ x: 10, y: 10 }] });
        map._fireEvent("touchmove", { lngLat: makeLngLat(2, 1) });
        document.dispatchEvent(new Event("touchend"));

        expect(commits).toHaveLength(1);
        expect(commits[0]).toEqual([
            [1, 1],
            [2, 1],
        ]);
        tool.deactivate();
    });

    it("🛑 IGNORES a two-finger press — a pinch must stay MapLibre's, not become a botched draw", () => {
        const { spec, commits } = makeSpec();
        const tool = createDragTool(spec);
        tool.activate(map as unknown as MeasureMap);

        map._fireEvent("touchstart", {
            lngLat: makeLngLat(1, 1),
            points: [
                { x: 10, y: 10 },
                { x: 90, y: 90 },
            ],
        });
        map._fireEvent("touchmove", { lngLat: makeLngLat(2, 1) });
        document.dispatchEvent(new Event("touchend"));

        expect(commits).toHaveLength(0);
        tool.deactivate();
    });

    it("does nothing once the tool is disarmed", () => {
        const { spec, commits } = makeSpec();
        const tool = createDragTool(spec);
        tool.activate(map as unknown as MeasureMap);
        tool.deactivate();

        // The mock's `off` is a no-op, so the listener is still registered — which is
        // exactly the case the `if (!active) return` guard exists for, and the only way to
        // exercise it. Arming then disarming is therefore the setup, not a shortcut.
        map._fireEvent("touchstart", { lngLat: makeLngLat(1, 1), points: [{ x: 1, y: 1 }] });
        map._fireEvent("touchmove", { lngLat: makeLngLat(2, 1) });
        document.dispatchEvent(new Event("touchend"));

        expect(commits).toHaveLength(0);
    });

    it("a drag below the tool's own threshold commits nothing", () => {
        const { spec, commits } = makeSpec(10);
        const tool = createDragTool(spec);
        tool.activate(map as unknown as MeasureMap);

        map._fireEvent("touchstart", { lngLat: makeLngLat(1, 1), points: [{ x: 10, y: 10 }] });
        map._fireEvent("touchmove", { lngLat: makeLngLat(1.001, 1) });
        document.dispatchEvent(new Event("touchend"));

        expect(commits).toHaveLength(0);
        tool.deactivate();
    });
});

// ---------------------------------------------------------------------------
// The anchor — the half of the report that was NOT about touch
// ---------------------------------------------------------------------------

describe("createDragTool — anchor vertex", () => {
    it("paints the press point immediately, and clears it on release", () => {
        const spy = vi.spyOn(drawLayers, "updateVertices");
        const { spec } = makeSpec();
        const tool = createDragTool(spec);
        tool.activate(map as unknown as MeasureMap);

        map._fireEvent("touchstart", { lngLat: makeLngLat(1, 1), points: [{ x: 10, y: 10 }] });
        // The whole point of the bug report: nothing else is drawn yet — the circle needs a
        // metre of radius and the rect two points — so this IS the only feedback the user
        // gets at the moment of the press.
        expect(spy).toHaveBeenCalledWith([[1, 1]]);

        map._fireEvent("touchmove", { lngLat: makeLngLat(2, 1) });
        document.dispatchEvent(new Event("touchend"));

        // ⚠️ `clearPreview()` empties the PREVIEW source only — the anchor would survive the
        // gesture that drew it if nothing cleared it explicitly.
        expect(spy).toHaveBeenLastCalledWith([]);
        tool.deactivate();
    });

    it("is cleared by deactivate() even when no gesture ever ran", () => {
        const spy = vi.spyOn(drawLayers, "updateVertices");
        const tool = createDragTool(makeSpec().spec);
        tool.activate(map as unknown as MeasureMap);
        tool.deactivate();
        expect(spy).toHaveBeenLastCalledWith([]);
    });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe("createDragTool — touchcancel", () => {
    it("🛑 ABANDONS instead of committing — the gesture was taken away, not finished", () => {
        const { spec, commits } = makeSpec();
        const tool = createDragTool(spec);
        tool.activate(map as unknown as MeasureMap);

        map._fireEvent("touchstart", { lngLat: makeLngLat(1, 1), points: [{ x: 10, y: 10 }] });
        map._fireEvent("touchmove", { lngLat: makeLngLat(2, 1) });
        // Same state a `touchend` would have committed — only the ending differs.
        document.dispatchEvent(new Event("touchcancel"));

        expect(commits).toHaveLength(0);
        tool.deactivate();
    });

    it("restores map panning, so an interrupted gesture does not freeze the map", () => {
        const { spec } = makeSpec();
        const tool = createDragTool(spec);
        tool.activate(map as unknown as MeasureMap);

        map._fireEvent("touchstart", { lngLat: makeLngLat(1, 1), points: [{ x: 10, y: 10 }] });
        expect(map.dragPan.disable).toHaveBeenCalled();

        document.dispatchEvent(new Event("touchcancel"));
        expect(map.dragPan.enable).toHaveBeenCalled();
        tool.deactivate();
    });
});
