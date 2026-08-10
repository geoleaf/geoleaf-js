// @vitest-environment happy-dom
/*!
 * @geoleaf/host-runtime — mouse drag tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * The touch counterpart is coverage-excluded (touch events are not exercisable in
 * happy-dom), but the geometry both paths share lives here and IS covered.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { wireDrag, readDragOffset, applyDragOffset } from "../ui/drag.js";

let handle: HTMLElement;
let container: HTMLElement;
let root: HTMLElement;

/** Container is 500×400; the root is 100×50, so the drag is clamped to 400×350. */
function sizeStub(el: HTMLElement, width: number, height: number): void {
    el.getBoundingClientRect = () => ({ width, height, top: 0, left: 0 }) as DOMRect;
    Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: height, configurable: true });
}

beforeEach(() => {
    // rAF runs the callback synchronously so assertions do not need to await a frame.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    document.body.innerHTML = "";
    handle = document.createElement("div");
    container = document.createElement("div");
    root = document.createElement("div");
    sizeStub(container, 500, 400);
    sizeStub(root, 100, 50);
    document.body.append(handle, container, root);
});

afterEach(() => {
    // An in-flight drag keeps mousemove/mouseup bound to `document`, which outlives the
    // per-test elements. Ending the drag runs the handler's own cleanup, so a case that
    // never released the button cannot write into the next case's root.
    document.dispatchEvent(new MouseEvent("mouseup"));
    vi.unstubAllGlobals();
});

const mouseDown = (x: number, y: number, button = 0): void => {
    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: x, clientY: y, button }));
};
const mouseMove = (x: number, y: number): void => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
};

describe("readDragOffset", () => {
    it("defaults to 10px on both axes when unset", () => {
        expect(readDragOffset(root, "editor")).toEqual({ left: 10, top: 10 });
    });

    it("reads the prefixed custom properties", () => {
        root.style.setProperty("--gl-editor-left", "42px");
        root.style.setProperty("--gl-editor-top", "24px");
        expect(readDragOffset(root, "editor")).toEqual({ left: 42, top: 24 });
    });

    it("keeps prefixes independent — measure does not read editor's vars", () => {
        root.style.setProperty("--gl-editor-left", "42px");
        expect(readDragOffset(root, "measure")).toEqual({ left: 10, top: 10 });
    });
});

describe("applyDragOffset", () => {
    it("writes the prefixed custom properties", () => {
        applyDragOffset(root, container, "measure", 10, 10, 30, 20);
        expect(root.style.getPropertyValue("--gl-measure-left")).toBe("40px");
        expect(root.style.getPropertyValue("--gl-measure-top")).toBe("30px");
    });

    it("clamps to the container's far edge, accounting for the root's size", () => {
        applyDragOffset(root, container, "editor", 10, 10, 9999, 9999);
        // 500 − 100 = 400 ; 400 − 50 = 350
        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("400px");
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe("350px");
    });

    it("clamps to zero rather than going negative", () => {
        applyDragOffset(root, container, "editor", 10, 10, -9999, -9999);
        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("0px");
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe("0px");
    });
});

describe("wireDrag", () => {
    it("repositions the root as the mouse moves", () => {
        wireDrag(handle, container, () => root, "editor");
        mouseDown(100, 100);
        mouseMove(130, 120);

        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("40px");
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe("30px");
    });

    it("honours the CSS var prefix it was given", () => {
        wireDrag(handle, container, () => root, "measure");
        mouseDown(0, 0);
        mouseMove(5, 5);

        expect(root.style.getPropertyValue("--gl-measure-left")).toBe("15px");
        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("");
    });

    it("ignores non-left buttons", () => {
        wireDrag(handle, container, () => root, "editor");
        mouseDown(100, 100, 2);
        mouseMove(130, 120);

        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("");
    });

    it("is inert while the root is absent", () => {
        wireDrag(handle, container, () => null, "editor");
        expect(() => {
            mouseDown(100, 100);
            mouseMove(130, 120);
        }).not.toThrow();
    });

    it("resolves the root at event time, so a rebuilt menu is picked up", () => {
        let current: HTMLElement | null = root;
        wireDrag(handle, container, () => current, "editor");

        const rebuilt = document.createElement("div");
        sizeStub(rebuilt, 100, 50);
        current = rebuilt;

        mouseDown(0, 0);
        mouseMove(20, 10);

        expect(rebuilt.style.getPropertyValue("--gl-editor-left")).toBe("30px");
        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("");
    });

    it("stops tracking after mouseup", () => {
        wireDrag(handle, container, () => root, "editor");
        mouseDown(0, 0);
        mouseMove(20, 20);
        document.dispatchEvent(new MouseEvent("mouseup"));
        mouseMove(200, 200);

        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("30px");
    });

    it("starts from the root's current offset rather than from zero", () => {
        root.style.setProperty("--gl-editor-left", "100px");
        root.style.setProperty("--gl-editor-top", "50px");
        wireDrag(handle, container, () => root, "editor");
        mouseDown(0, 0);
        mouseMove(10, 10);

        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("110px");
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe("60px");
    });
});
