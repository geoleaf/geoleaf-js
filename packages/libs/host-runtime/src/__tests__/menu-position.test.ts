// @vitest-environment happy-dom
/*!
 * @geoleaf/host-runtime — floating sub-menu anchoring tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at PLUGINS S5 from plugin-editor and plugin-measure. Both plugins keep
 * their own binding tests (they check the CSS variables actually written on their root);
 * these cover the geometry itself, including the arms neither plugin exercises — a
 * custom gap and a zero-height menu.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { positionMenuNear } from "../ui/menu-position.js";

let mapEl: HTMLElement;
let placed: { top: number; left: number } | null;

/** Fixes an element's getBoundingClientRect (happy-dom returns zeroes). */
function rect(el: Element, r: Partial<DOMRect>): void {
    const full = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...r };
    (el as HTMLElement).getBoundingClientRect = () => full as DOMRect;
}

/** A button inside a `.gl-map-toolbar` bar; only the bar carries a real rect. */
function pill(barRect: Partial<DOMRect>, barClass = "gl-map-toolbar"): Element {
    const bar = document.createElement("div");
    bar.className = barClass;
    const btn = document.createElement("button");
    bar.appendChild(btn);
    mapEl.appendChild(bar);
    rect(bar, barRect);
    rect(btn, { top: 0, left: 0, right: 0, bottom: 0 });
    return btn;
}

function place(pillEl: Element, menuHeight: number, gap?: number): void {
    positionMenuNear(pillEl, mapEl, {
        menuHeight,
        gap,
        setPosition: (top, left) => {
            placed = { top, left };
        },
    });
}

beforeEach(() => {
    document.body.innerHTML = "";
    mapEl = document.createElement("div");
    document.body.appendChild(mapEl);
    rect(mapEl, { top: 0, left: 0, right: 1000, bottom: 800 });
    placed = null;
});

describe("positionMenuNear — horizontal placement", () => {
    it("drops the menu to the right of the bar with the default 10px gap", () => {
        place(pill({ top: 300, right: 60, height: 40 }), 100);
        expect(placed!.left).toBe(70);
    });

    it("honours an explicit gap", () => {
        place(pill({ top: 300, right: 60, height: 40 }), 100, 25);
        expect(placed!.left).toBe(85);
    });

    it("clamps the left so 64px of menu stay inside the map", () => {
        place(pill({ top: 300, right: 990, height: 40 }), 100);
        expect(placed!.left).toBe(936); // 1000 - 64
    });
});

describe("positionMenuNear — vertical centring", () => {
    it("centres the menu on the bar", () => {
        // Bar spans 300→340, centre 320; a 100px menu starts at 270.
        place(pill({ top: 300, right: 60, height: 40 }), 100);
        expect(placed!.top).toBe(270);
    });

    it("clamps the top to a 4px inset from the map's upper edge", () => {
        place(pill({ top: 0, right: 60, height: 0 }), 200);
        expect(placed!.top).toBe(4);
    });

    it("clamps the bottom so the menu fits above the map's lower edge", () => {
        // Centring a 200px menu on a bar at 780 would start at 780; the floor is
        // 800 - 200 - 4.
        place(pill({ top: 780, right: 60, height: 0 }), 200);
        expect(placed!.top).toBe(596);
    });

    it("a zero-height menu still lands on the bar centre", () => {
        place(pill({ top: 300, right: 60, height: 40 }), 0);
        expect(placed!.top).toBe(320);
    });
});

describe("positionMenuNear — anchor resolution", () => {
    it("prefers the .gl-map-toolbar-wrapper ancestor", () => {
        place(pill({ top: 300, right: 120, height: 40 }, "gl-map-toolbar-wrapper"), 100);
        expect(placed!.left).toBe(130);
    });

    it("anchors on the bar, not on the clicked button", () => {
        // The button's own rect is all zeroes; reading it would give left: 10.
        place(pill({ top: 300, right: 200, height: 40 }), 100);
        expect(placed!.left).toBe(210);
    });

    it("falls back to the parent element when no toolbar ancestor exists", () => {
        const parent = document.createElement("div");
        const btn = document.createElement("button");
        parent.appendChild(btn);
        mapEl.appendChild(parent);
        rect(parent, { top: 100, right: 50, height: 20 });
        rect(btn, { top: 0, left: 0, right: 0, bottom: 0 });
        place(btn, 100);
        expect(placed!.left).toBe(60);
    });

    it("falls back to the element itself when it has no parent", () => {
        const orphan = document.createElement("button");
        rect(orphan, { top: 200, right: 30, height: 10 });
        place(orphan, 100);
        expect(placed!.left).toBe(40);
    });
});
