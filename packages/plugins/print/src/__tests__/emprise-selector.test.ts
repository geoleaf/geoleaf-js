/**
 * Tests for `emprise-selector.ts` — the print-area overlay.
 *
 * 🛑 THIS FILE IS A NET, WRITTEN BEFORE THE REFACTOR IT PROTECTS.
 *
 * `emprise-selector.ts` had NO test and sits in the package's
 * `coverageExclude` (stale motive). Blindly rewriting a working mouse path to
 * add touch to it was the wrong bet: the mouse cases below are therefore laid
 * down FIRST, and the refactor must not move them an inch.
 *
 * The coverage exclusion is not removed here: the file weighs ~130
 * executable lines and ~60 branches, and counting it without a complete suite
 * would drop the package BELOW its branch threshold. These tests assert the
 * behaviour even off the books — removing the exclusion is a separate act,
 * once the suite is fleshed out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEmpriseSelector } from "../emprise-selector.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const RECT = { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 };

let container: HTMLElement;
let onValidate: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;

function setup() {
    container = document.createElement("div");
    container.getBoundingClientRect = () => RECT as DOMRect;
    document.body.appendChild(container);
    onValidate = vi.fn();
    onCancel = vi.fn();
    const sel = createEmpriseSelector(container, onValidate, onCancel);
    sel.activate();
    return { sel, overlay: container.querySelector(".gl-emprise-overlay") as HTMLElement };
}

/** Reads the rectangle back from the DOM, in the same px frame the handlers use. */
function readRect(): { x: number; y: number; w: number; h: number } {
    const el = container.querySelector(".gl-emprise-rect") as HTMLElement;
    return {
        x: parseFloat(el.style.left || "0"),
        y: parseFloat(el.style.top || "0"),
        w: parseFloat(el.style.width || "0"),
        h: parseFloat(el.style.height || "0"),
    };
}

function mouse(type: string, target: EventTarget, clientX: number, clientY: number, button = 0) {
    target.dispatchEvent(new MouseEvent(type, { clientX, clientY, button, bubbles: true }));
}

/** Draws a rectangle with the mouse and leaves the selector in the `drawn` phase. */
function drawWithMouse(overlay: HTMLElement) {
    mouse("mousedown", overlay, 50, 50);
    mouse("mousemove", document, 250, 200);
    mouse("mouseup", document, 250, 200);
}

beforeEach(() => {
    vi.restoreAllMocks();
});

afterEach(() => {
    container.remove();
});

// ---------------------------------------------------------------------------
// Mouse — the behaviour the refactor must not move
// ---------------------------------------------------------------------------

describe("emprise-selector — mouse (non-regression net)", () => {
    it("draws a rectangle and reveals the handles and the OK button", () => {
        const { overlay } = setup();
        const okBtn = container.querySelector(".gl-emprise-ok") as HTMLElement;
        expect(okBtn.style.display).toBe("none");

        drawWithMouse(overlay);

        expect(readRect()).toEqual({ x: 50, y: 50, w: 200, h: 150 });
        expect(okBtn.style.display).toBe("block");
        const handle = container.querySelector(".gl-emprise-handle--br") as HTMLElement;
        expect(handle.style.display).toBe("block");
    });

    it("discards a rectangle smaller than the minimum instead of keeping a sliver", () => {
        const { overlay } = setup();
        mouse("mousedown", overlay, 50, 50);
        mouse("mousemove", document, 53, 52);
        mouse("mouseup", document, 53, 52);

        const okBtn = container.querySelector(".gl-emprise-ok") as HTMLElement;
        expect(okBtn.style.display).toBe("none");
    });

    it("a right button does not start a drawing", () => {
        const { overlay } = setup();
        mouse("mousedown", overlay, 50, 50, 2);
        mouse("mousemove", document, 250, 200);
        mouse("mouseup", document, 250, 200);

        const okBtn = container.querySelector(".gl-emprise-ok") as HTMLElement;
        expect(okBtn.style.display).toBe("none");
    });

    it("resizes from a corner handle once drawn", () => {
        const { overlay } = setup();
        drawWithMouse(overlay);
        const br = container.querySelector(".gl-emprise-handle--br") as HTMLElement;

        mouse("mousedown", br, 250, 200);
        mouse("mousemove", document, 300, 250);
        mouse("mouseup", document, 300, 250);

        // The bottom-right corner follows the pointer; the origin does not move.
        expect(readRect()).toEqual({ x: 50, y: 50, w: 250, h: 200 });
    });

    it("moves the whole rectangle when dragging its interior", () => {
        const { overlay } = setup();
        drawWithMouse(overlay);
        const rect = container.querySelector(".gl-emprise-rect") as HTMLElement;

        mouse("mousedown", rect, 100, 100);
        mouse("mousemove", document, 130, 120);
        mouse("mouseup", document, 130, 120);

        // Translated by (+30, +20), same size.
        expect(readRect()).toEqual({ x: 80, y: 70, w: 200, h: 150 });
    });

    it("🛑 pressing OK does NOT start a new drawing — the click must reach the button", () => {
        const { overlay } = setup();
        drawWithMouse(overlay);
        const okBtn = container.querySelector(".gl-emprise-ok") as HTMLElement;

        mouse("mousedown", okBtn, 260, 210);

        // Still `drawn`: the rectangle is untouched and the button is still offered.
        expect(readRect()).toEqual({ x: 50, y: 50, w: 200, h: 150 });
        expect(okBtn.style.display).toBe("block");
    });

    it("Escape cancels", () => {
        setup();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onCancel).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Touch — drawing already worked; everything else was INERT
// ---------------------------------------------------------------------------

/** Fires a TouchEvent with a single finger at (cx, cy). */
function touch(type: string, target: EventTarget, cx: number, cy: number) {
    target.dispatchEvent(
        new TouchEvent(type, {
            touches: type === "touchend" ? [] : ([{ clientX: cx, clientY: cy }] as never),
            bubbles: true,
            cancelable: true,
        })
    );
}

/** Draws a rectangle with a finger and leaves the selector in the `drawn` phase. */
function drawWithTouch(overlay: HTMLElement) {
    touch("touchstart", overlay, 50, 50);
    touch("touchmove", overlay, 250, 200);
    touch("touchend", overlay, 250, 200);
}

describe("emprise-selector — touch", () => {
    it("draws a rectangle with a finger (this part already worked)", () => {
        const { overlay } = setup();
        drawWithTouch(overlay);
        expect(readRect()).toEqual({ x: 50, y: 50, w: 200, h: 150 });
        expect((container.querySelector(".gl-emprise-ok") as HTMLElement).style.display).toBe(
            "block"
        );
    });

    it("🛑 resizes from a corner handle — the branch that was unreachable with a finger", () => {
        const { overlay } = setup();
        drawWithTouch(overlay);
        const br = container.querySelector(".gl-emprise-handle--br") as HTMLElement;

        // Before the fix, `_onTouchStart` bailed on `phase !== "drawn"` and
        // `_onTouchMove` on `phase === "drawing"`: these two lines did NOTHING.
        touch("touchstart", br, 250, 200);
        touch("touchmove", overlay, 300, 250);
        touch("touchend", overlay, 300, 250);

        expect(readRect()).toEqual({ x: 50, y: 50, w: 250, h: 200 });
    });

    it("🛑 moves the whole rectangle — the other branch that was unreachable", () => {
        const { overlay } = setup();
        drawWithTouch(overlay);
        const rect = container.querySelector(".gl-emprise-rect") as HTMLElement;

        touch("touchstart", rect, 100, 100);
        touch("touchmove", overlay, 130, 120);
        touch("touchend", overlay, 130, 120);

        expect(readRect()).toEqual({ x: 80, y: 70, w: 200, h: 150 });
    });

    it("ignores a two-finger press so the map keeps its pinch", () => {
        const { overlay } = setup();
        overlay.dispatchEvent(
            new TouchEvent("touchstart", {
                touches: [
                    { clientX: 50, clientY: 50 },
                    { clientX: 200, clientY: 200 },
                ] as never,
                bubbles: true,
                cancelable: true,
            })
        );
        touch("touchmove", overlay, 250, 200);
        touch("touchend", overlay, 250, 200);

        expect((container.querySelector(".gl-emprise-ok") as HTMLElement).style.display).toBe(
            "none"
        );
    });

    it("🛑 `touchcancel` releases the gesture — otherwise it stayed armed for good", () => {
        const { overlay } = setup();
        drawWithTouch(overlay);
        const br = container.querySelector(".gl-emprise-handle--br") as HTMLElement;

        touch("touchstart", br, 250, 200);
        overlay.dispatchEvent(new TouchEvent("touchcancel", { touches: [], bubbles: true }));

        // The gesture is released: a later movement no longer resizes anything.
        mouse("mousemove", document, 350, 290);
        expect(readRect()).toEqual({ x: 50, y: 50, w: 200, h: 150 });
    });
});
