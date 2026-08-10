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
