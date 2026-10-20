/**
 * Tests for tool-annotation.ts — tooltip annotation tool.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    installMockGeoLeaf,
    uninstallMockGeoLeaf,
    makeMockMaplibreMap,
    type MockGeoLeaf,
} from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import * as drawLayers from "../draw-layers.js";
import { initAnnotationOverlays, clearAllOverlays } from "../annotation-overlays.js";
import { activateAnnotationTooltip, deactivateAnnotation } from "../tools/tool-annotation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let map: ReturnType<typeof makeMockMaplibreMap>;
let gl: MockGeoLeaf;
let container: HTMLElement;
let canvas: HTMLCanvasElement;

function setup() {
    gl = installMockGeoLeaf();
    map = gl._nativeMap;
    container = map.getContainer();
    canvas = map.getCanvas();
    initLayers(map);
    const cfg = getMeasureConfig();
    initAnnotationOverlays(map, cfg, {
        onCreated: vi.fn(),
        onMutated: vi.fn(),
        onRemoved: vi.fn(),
    });
}

beforeEach(() => {
    setup();
});

afterEach(() => {
    deactivateAnnotation();
    clearAllOverlays();
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("activateAnnotationTooltip", () => {
    it("🔴 enters exclusive mode on the adapter, and leaves the native map unwritten", () => {
        activateAnnotationTooltip(map);
        expect(gl.exclusive.held).toBe(true);
        expect((map as any).__geoleafExclusiveMode).toBeUndefined();
    });

    it("sets cursor to crosshair", () => {
        const spy = vi.spyOn(drawLayers, "setCursor");
        activateAnnotationTooltip(map);
        expect(spy).toHaveBeenCalledWith("crosshair");
    });

    it("calling activate while already active first deactivates then re-activates", () => {
        activateAnnotationTooltip(map);
        const spy = vi.spyOn(drawLayers, "setCursor");
        activateAnnotationTooltip(map); // should deactivate first
        expect(spy).toHaveBeenCalledWith(""); // deactivation clears the inline cursor
        expect(gl.exclusive.held).toBe(true);
    });
});

describe("deactivateAnnotation", () => {
    it("🔴 exits exclusive mode on the adapter", () => {
        activateAnnotationTooltip(map);
        deactivateAnnotation();
        expect(gl.exclusive.held).toBe(false);
    });

    it("clears the inline cursor, so the engine CSS paints grab/grabbing again", () => {
        activateAnnotationTooltip(map);
        const spy = vi.spyOn(drawLayers, "setCursor");
        deactivateAnnotation();
        expect(spy).toHaveBeenCalledWith("");
    });

    it("is safe to call when not active (no-op)", () => {
        expect(() => deactivateAnnotation()).not.toThrow();
    });
});

describe("canvas click — tooltip tool", () => {
    it("creates a tooltip overlay when canvas is clicked", () => {
        activateAnnotationTooltip(map);
        const evt = new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 });
        Object.defineProperty(evt, "target", { value: canvas });
        container.dispatchEvent(evt);
        expect(container.querySelector(".gl-measure-annot-tooltip")).not.toBeNull();
    });

    it("ignores click when target is not the canvas", () => {
        activateAnnotationTooltip(map);
        const otherEl = document.createElement("div");
        container.appendChild(otherEl);
        const evt = new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 });
        Object.defineProperty(evt, "target", { value: otherEl });
        container.dispatchEvent(evt);
        expect(container.querySelector(".gl-measure-annot-tooltip")).toBeNull();
    });

    it("does nothing after deactivation", () => {
        activateAnnotationTooltip(map);
        deactivateAnnotation();
        const evt = new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 });
        Object.defineProperty(evt, "target", { value: canvas });
        container.dispatchEvent(evt);
        expect(container.querySelector(".gl-measure-annot-tooltip")).toBeNull();
    });
});
