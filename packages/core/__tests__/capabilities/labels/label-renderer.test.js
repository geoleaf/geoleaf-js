/**
 * Label symbol-layer layout — the point→pixel conversion in particular.
 *
 * Profiles author label sizes in POINTS (`font.sizePt`), but MapLibre's
 * `text-size` is in CSS PIXELS. Nothing asserted that conversion before, so the
 * factor could have been changed silently.
 */

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
let addedLayer;

const nativeMap = {
    getSource: () => ({}),
    getLayer: () => null,
    removeLayer: vi.fn(),
    addLayer: (spec) => {
        addedLayer = spec;
    },
    getStyle: () => ({ layers: [] }),
};
const mapAdapter = {
    getNativeMap: () => nativeMap,
    getLayerRegistry: () => ({ getSourceId: (id) => `gl-src-${id}` }),
};

vi.mock("../../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../../src/api/geoleaf.core.js", () => ({
    Core: { getMap: vi.fn(() => mapAdapter) },
}));

import { LabelRenderer } from "../../../src/capabilities/labels/label-renderer.js";

/** Builds a symbol layer for the given style and returns its `text-size`. */
function textSizeFor(style) {
    addedLayer = undefined;
    LabelRenderer.createSymbolLayerForMapLibre("ly1", { labelId: "name" }, style, new Map());
    return addedLayer?.layout?.["text-size"];
}

/** Builds a symbol layer for the given style and returns its whole `layout`. */
function layoutFor(style) {
    addedLayer = undefined;
    LabelRenderer.createSymbolLayerForMapLibre("ly1", { labelId: "name" }, style, new Map());
    return addedLayer?.layout;
}

/** The five layout keys a centred label has always emitted, and must keep emitting. */
const CENTRED_KEYS = [
    "text-field",
    "text-size",
    "text-allow-overlap",
    "text-ignore-placement",
    "text-font",
];

describe("label symbol layout — point→pixel conversion", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("converts points to CSS pixels at the 96/72 ratio", () => {
        // 12 pt is the canonical body size: 12 × 96/72 = 16 px.
        expect(textSizeFor({ font: { sizePt: 12 } })).toBe(16);
        expect(textSizeFor({ font: { sizePt: 9 } })).toBe(12);
        expect(textSizeFor({ font: { sizePt: 18 } })).toBe(24);
    });

    it("rounds to a whole pixel", () => {
        // 10 pt → 13.33 px → 13.
        expect(textSizeFor({ font: { sizePt: 10 } })).toBe(13);
        expect(textSizeFor({ font: { sizePt: 11 } })).toBe(15);
    });

    it("falls back to the default size when no point size is authored", () => {
        expect(textSizeFor({ font: {} })).toBe(12);
        expect(textSizeFor({})).toBe(12);
    });
});

/**
 * `label.offset` — the placement pair, and above all what must NOT be emitted.
 *
 * Two properties are load-bearing here. The first is that a label with no placement emits
 * exactly the keys it emitted before the feature existed: every shipped profile depends on it,
 * and asserting values would not catch a key that appears with a harmless-looking default. The
 * second is the direction: MapLibre's `text-anchor` names the edge of the TEXT pinned to the
 * point, so it reads inverted, and a future "fix" of that table would flip every label in the
 * repo. Hence assertions on the anchor NAME, not on a round-trip through the engine.
 */
describe("label symbol layout — label.offset placement", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("emits exactly the five centred keys when no offset is authored", () => {
        expect(Object.keys(layoutFor({ font: { sizePt: 12 } })).sort()).toEqual(
            [...CENTRED_KEYS].sort()
        );
    });

    it("emits nothing extra for the centred / zero / unknown cases", () => {
        const cases = [
            { placement: "center", distancePx: 20 },
            // The shape `enableLabels()` always materialises — testing `style.offset` for
            // truthiness instead of `distancePx` would offset every layer on that path.
            { distancePx: 0 },
            { placement: "top", distancePx: 0 },
            { placement: "top", distancePx: -5 },
            { placement: "sideways", distancePx: 12 },
            // Prototype-chain keys must not resolve to an anchor.
            { placement: "constructor", distancePx: 12 },
            { placement: "toString", distancePx: 12 },
        ];
        for (const offset of cases) {
            expect(Object.keys(layoutFor({ font: { sizePt: 12 }, offset })).sort()).toEqual(
                [...CENTRED_KEYS].sort()
            );
        }
    });

    it("maps each placement to the INVERTED anchor", () => {
        // A label sitting above its feature is anchored by its bottom edge. This table is the
        // one thing that must not be "corrected" into the identity.
        const expected = {
            top: "bottom",
            bottom: "top",
            left: "right",
            right: "left",
            "top-left": "bottom-right",
            "top-right": "bottom-left",
            "bottom-left": "top-right",
            "bottom-right": "top-left",
        };
        for (const [placement, anchor] of Object.entries(expected)) {
            const layout = layoutFor({ font: { sizePt: 12 }, offset: { placement } });
            expect(layout["text-anchor"]).toBe(anchor);
        }
    });

    it("converts the pixel gap into ems of text-size", () => {
        // 9 pt → 12 px, so a 24 px gap is 2 em.
        const layout = layoutFor({
            font: { sizePt: 9 },
            offset: { placement: "right", distancePx: 24 },
        });
        expect(layout["text-radial-offset"]).toBe(2);
        // 12 pt → 16 px.
        expect(
            layoutFor({ font: { sizePt: 12 }, offset: { placement: "right", distancePx: 8 } })[
                "text-radial-offset"
            ]
        ).toBe(0.5);
    });

    it("applies the documented default gap when only a placement is authored", () => {
        // 12 px over a 16 px text size. The default is also declared in style.schema.json;
        // the two must not drift apart.
        const layout = layoutFor({ font: { sizePt: 12 }, offset: { placement: "top" } });
        expect(layout["text-radial-offset"]).toBe(12 / 16);
    });

    it("never emits text-offset, which the spec makes exclusive with the radial one", () => {
        const layout = layoutFor({
            font: { sizePt: 12 },
            offset: { placement: "bottom-left", distancePx: 10 },
        });
        expect(layout["text-offset"]).toBeUndefined();
    });

    it("stays centred rather than emitting NaN or Infinity on an unusable text size", () => {
        // `sizePt` reaches the inline enableLabels() path unvalidated: a sub-pixel size rounds
        // to 0 and a string yields NaN. Both would divide into a poisoned radial offset.
        for (const sizePt of [0.2, "12pt"]) {
            const layout = layoutFor({
                font: { sizePt },
                offset: { placement: "top", distancePx: 12 },
            });
            expect(Object.keys(layout).sort()).toEqual([...CENTRED_KEYS].sort());
        }
    });

    it("offsets normally when sizePt is NaN, because that falls back to the default size", () => {
        // Not a hole in the guard above: `NaN` is FALSY, so the size resolution never divides
        // by it — it takes the 12 px default branch and the offset is computed against that.
        const layout = layoutFor({
            font: { sizePt: Number.NaN },
            offset: { placement: "top", distancePx: 12 },
        });
        expect(layout["text-size"]).toBe(12);
        expect(layout["text-radial-offset"]).toBe(1);
    });

    it("stays centred on a non-numeric distance", () => {
        const layout = layoutFor({
            font: { sizePt: 12 },
            offset: { placement: "top", distancePx: "14px" },
        });
        expect(Object.keys(layout).sort()).toEqual([...CENTRED_KEYS].sort());
    });
});
