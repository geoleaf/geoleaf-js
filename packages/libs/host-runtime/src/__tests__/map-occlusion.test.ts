// @vitest-environment happy-dom
/*!
 * @geoleaf/host-runtime — what covers the map, edge by edge
 * © 2026 Mattieu Pottier — MIT License
 *
 * Each surface is ranked on ONE edge. The cases below are the shapes the application actually lays
 * over the map: a full-height side panel, a full-width bottom sheet, a corner credit, a floating
 * window — and the padding a fit derives from them.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { coveredInsets, paddingClearOf } from "../ui/map-occlusion.js";

const rect = (l: number, t: number, w: number, h: number) =>
    ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t }) as DOMRect;

/** A container of `w × h`, at the origin. */
function container(w: number, h: number): HTMLElement {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => rect(0, 0, w, h);
    document.body.append(el);
    return el;
}

/** A shown surface with the given box. */
function surface(attrs: { id?: string; className?: string }, box: DOMRect): HTMLElement {
    const el = document.createElement("div");
    if (attrs.id) el.id = attrs.id;
    if (attrs.className) el.className = attrs.className;
    el.getBoundingClientRect = () => box;
    el.getClientRects = () => [box] as unknown as DOMRectList;
    document.body.append(el);
    return el;
}

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("coveredInsets", () => {
    it("is all zero when nothing covers the map", () => {
        expect(coveredInsets(container(1440, 900))).toEqual({
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
        });
    });

    it("ranks a full-height side panel on the right, not the top it also touches", () => {
        const map = container(1440, 900);
        surface({ id: "gl-right-panel" }, rect(1084, 0, 356, 900));
        expect(coveredInsets(map)).toMatchObject({ right: 356, top: 0 });
    });

    it("ranks a full-width sheet hugging the bottom on the bottom, not a side", () => {
        const map = container(412, 915);
        surface({ className: "gl-sheet-panel" }, rect(0, 412, 412, 503));
        expect(coveredInsets(map)).toEqual({ top: 0, right: 0, bottom: 503, left: 0 });
    });

    it("counts the phone's expanded credit, floating 10 px off the edges, on the bottom", () => {
        const map = container(412, 915);
        surface({ className: "maplibregl-ctrl-attrib" }, rect(10, 861, 392, 44));
        expect(coveredInsets(map)).toMatchObject({ bottom: 54, left: 0, right: 0 });
    });

    it("ranks a corner credit on the edge it covers least deeply", () => {
        const map = container(1440, 900);
        surface({ className: "maplibregl-ctrl-attrib" }, rect(1130, 870, 300, 20));
        expect(coveredInsets(map)).toMatchObject({ bottom: 30, right: 0 });
    });

    it("counts the toolbar column on the left", () => {
        const map = container(412, 915);
        surface({ className: "gl-map-toolbar" }, rect(8, 200, 44, 400));
        expect(coveredInsets(map)).toMatchObject({ left: 52, top: 0, bottom: 0 });
    });

    it("counts a caller's own surface only when it names it", () => {
        const map = container(1440, 900);
        surface({ className: "my-window" }, rect(60, 80, 320, 500));
        expect(coveredInsets(map).left).toBe(0);
        expect(coveredInsets(map, [".my-window"]).left).toBe(380);
    });

    it("ranks a wide, low floating window on the top, even 12 px off the right edge", () => {
        // The phone's reduced isochrone window: it nearly spans the width, it is a band, not a column.
        const map = container(412, 839);
        surface({ className: "my-window" }, rect(72, 224, 328, 76));
        expect(coveredInsets(map, [".my-window"])).toEqual({
            top: 300,
            right: 0,
            bottom: 0,
            left: 0,
        });
    });

    it("ignores a surface off the container — the closed sheet, slid below it", () => {
        const map = container(412, 915);
        surface({ className: "gl-sheet-panel" }, rect(0, 915, 412, 503));
        expect(coveredInsets(map).bottom).toBe(0);
    });
});

describe("paddingClearOf", () => {
    it("adds the margin to every edge", () => {
        const map = container(1440, 900);
        expect(paddingClearOf(map, { top: 0, right: 356, bottom: 0, left: 0 }, 48)).toEqual({
            top: 48,
            right: 404,
            bottom: 48,
            left: 48,
        });
    });

    it("gives up when the covered edges leave no room", () => {
        const map = container(412, 915);
        expect(paddingClearOf(map, { top: 0, right: 0, bottom: 0, left: 412 }, 48)).toBeNull();
        expect(paddingClearOf(map, { top: 400, right: 0, bottom: 400, left: 0 }, 48)).toBeNull();
    });
});
