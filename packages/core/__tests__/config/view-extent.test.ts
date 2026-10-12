/**
 * The view a theme declares — read once, for the boot and for a theme switch.
 *
 * `kernel/config/view-extent.ts` is what both readers share: the boot, which starts the map on
 * the view of the theme the profile starts on, and the theme engine, which frames the map when a
 * theme is activated. What is pinned here is the READING — which declarations are a view, in
 * which form, and which are refused rather than guessed.
 */

import { describe, it, expect } from "vitest";
import {
    readStartThemeView,
    readThemeView,
    resolveThemeView,
    resolveViewPadding,
    themeViewsOutside,
} from "../../src/kernel/config/view-extent.js";

const BOUNDS = [
    [43.2, 1.2],
    [43.6, 1.6],
];

describe("readThemeView — the two forms a view takes", () => {
    it("reads `bounds` as [[south, west], [north, east]]", () => {
        expect(readThemeView({ bounds: BOUNDS })).toEqual({ bounds: BOUNDS });
    });

    it("reads `center` with `zoom`", () => {
        expect(readThemeView({ center: [43.7, 1.7], zoom: 11 })).toEqual({
            center: [43.7, 1.7],
            zoom: 11,
        });
    });

    it("keeps `bounds` alone when both forms are declared — the form that applies", () => {
        expect(readThemeView({ bounds: BOUNDS, center: [43.7, 1.7], zoom: 11 })).toEqual({
            bounds: BOUNDS,
        });
    });

    it("falls back to `center` with `zoom` when `bounds` cannot be used", () => {
        expect(readThemeView({ bounds: "nowhere", center: [43.7, 1.7], zoom: 11 })).toEqual({
            center: [43.7, 1.7],
            zoom: 11,
        });
    });

    it("drops what the declaration carries beside the view (a `_comment`)", () => {
        expect(readThemeView({ _comment: "north sector", bounds: BOUNDS })).toEqual({
            bounds: BOUNDS,
        });
    });
});

describe("readThemeView — what is refused rather than guessed", () => {
    it.each([
        ["nothing", undefined],
        ["null", null],
        ["an array", [BOUNDS]],
        ["an empty object", {}],
        ["a centre without its zoom", { center: [43.7, 1.7] }],
        ["a zoom without its centre", { zoom: 11 }],
        ["a negative zoom", { center: [43.7, 1.7], zoom: -1 }],
        ["a zoom that is not a number", { center: [43.7, 1.7], zoom: "11" }],
        ["a centre of three values", { center: [43.7, 1.7, 0], zoom: 11 }],
        ["a centre whose first value cannot be a latitude", { center: [143.7, 1.7], zoom: 11 }],
        ["one corner", { bounds: [[43.2, 1.2]] }],
        [
            "a corner of strings",
            {
                bounds: [
                    ["43.2", "1.2"],
                    [43.6, 1.6],
                ],
            },
        ],
        [
            "a corner that is not finite",
            {
                bounds: [
                    [43.2, Number.NaN],
                    [43.6, 1.6],
                ],
            },
        ],
        [
            "corners written north-east first",
            {
                bounds: [
                    [43.6, 1.6],
                    [43.2, 1.2],
                ],
            },
        ],
        [
            "an extent without an inside",
            {
                bounds: [
                    [43.2, 1.2],
                    [43.2, 1.6],
                ],
            },
        ],
    ])("%s", (_label, declaration) => {
        expect(readThemeView(declaration)).toBeNull();
    });
});

describe("resolveThemeView — what the camera is asked", () => {
    it("turns `bounds` into the extent the adapter fits", () => {
        const view = readThemeView({ bounds: BOUNDS });
        expect(view && resolveThemeView(view)).toEqual({
            bounds: { south: 43.2, west: 1.2, north: 43.6, east: 1.6 },
        });
    });

    it("turns `center` and `zoom` into the point the adapter stands on", () => {
        const view = readThemeView({ center: [43.7, 1.7], zoom: 11 });
        expect(view && resolveThemeView(view)).toEqual({
            center: { lat: 43.7, lng: 1.7 },
            zoom: 11,
        });
    });
});

describe("readStartThemeView — the view of the theme a profile starts on", () => {
    const framed = { id: "north", view: { bounds: BOUNDS } };
    const unframed = { id: "general" };

    it("is the declared default theme's view", () => {
        expect(readStartThemeView({ defaultTheme: "north", themes: [unframed, framed] })).toEqual({
            bounds: BOUNDS,
        });
    });

    it("is the first theme's view when no default is declared", () => {
        expect(readStartThemeView({ themes: [framed, unframed] })).toEqual({ bounds: BOUNDS });
    });

    it("honours the legacy `config.defautTheme`, like every other reader of the start theme", () => {
        expect(
            readStartThemeView({ config: { defautTheme: "north" }, themes: [unframed, framed] })
        ).toEqual({ bounds: BOUNDS });
    });

    it("is null when the start theme declares no view — another theme's view does not count", () => {
        expect(
            readStartThemeView({ defaultTheme: "general", themes: [unframed, framed] })
        ).toBeNull();
    });

    it("is null when the start theme's view cannot be used", () => {
        expect(readStartThemeView({ themes: [{ id: "north", view: { zoom: 11 } }] })).toBeNull();
    });

    it.each([
        ["no themes block", undefined],
        ["an empty block", {}],
        ["an empty list", { themes: [] }],
    ])("is null for a profile with %s", (_label, themes) => {
        expect(readStartThemeView(themes)).toBeNull();
    });
});

describe("themeViewsOutside — the views an extent would cut short", () => {
    const EXTENT = { south: 43, west: 1, north: 44, east: 2 };

    it("names no theme when every view is inside, edges included", () => {
        const themes = {
            themes: [
                { id: "inside", view: { bounds: BOUNDS } },
                {
                    id: "whole",
                    view: {
                        bounds: [
                            [43, 1],
                            [44, 2],
                        ],
                    },
                },
                { id: "point", view: { center: [43.7, 1.7], zoom: 11 } },
                { id: "unframed" },
            ],
        };
        expect(themeViewsOutside(themes, EXTENT)).toEqual([]);
    });

    it("names a theme whose extent reaches outside, on any edge", () => {
        const themes = {
            themes: [
                {
                    id: "too-far-north",
                    view: {
                        bounds: [
                            [43.5, 1.5],
                            [44.5, 1.8],
                        ],
                    },
                },
                { id: "inside", view: { bounds: BOUNDS } },
            ],
        };
        expect(themeViewsOutside(themes, EXTENT)).toEqual(["too-far-north"]);
    });

    it("names a theme whose centre stands outside", () => {
        expect(
            themeViewsOutside(
                { themes: [{ id: "elsewhere", view: { center: [48.8, 2.3], zoom: 11 } }] },
                EXTENT
            )
        ).toEqual(["elsewhere"]);
    });

    it("lists neither a theme without an id nor one whose view cannot be used", () => {
        const themes = {
            themes: [{ view: { center: [48.8, 2.3], zoom: 11 } }, { id: "broken", view: {} }],
        };
        expect(themeViewsOutside(themes, EXTENT)).toEqual([]);
    });
});

describe("resolveViewPadding — the room kept around a framed extent", () => {
    it("reads an array as [horizontal, vertical], like the boot", () => {
        expect(resolveViewPadding([40, 60])).toEqual({
            top: 60,
            bottom: 60,
            left: 40,
            right: 40,
            x: 40,
            y: 60,
        });
    });

    it("gives each edge an object names, and 0 for the others", () => {
        expect(resolveViewPadding({ top: 40, bottom: 120, left: 40, right: 40 })).toMatchObject({
            top: 40,
            bottom: 120,
            left: 40,
            right: 40,
        });
        expect(resolveViewPadding({ bottom: 120 })).toMatchObject({
            top: 0,
            bottom: 120,
            left: 0,
            right: 0,
        });
    });

    it("carries the symmetric padding that covers the edges — what the adapter contract knows", () => {
        const padding = resolveViewPadding({ top: 40, bottom: 120, left: 10, right: 30 });
        expect(padding.x).toBe(30);
        expect(padding.y).toBe(120);
    });

    it.each([
        ["nothing", undefined],
        ["null", null],
        ["a number", 24],
    ])("keeps 50 pixels on every edge when the profile declares %s", (_label, declared) => {
        expect(resolveViewPadding(declared)).toEqual({
            top: 50,
            bottom: 50,
            left: 50,
            right: 50,
            x: 50,
            y: 50,
        });
    });

    it("gives 50 to an array entry that is missing", () => {
        expect(resolveViewPadding([40])).toMatchObject({
            left: 40,
            right: 40,
            top: 50,
            bottom: 50,
        });
    });
});
