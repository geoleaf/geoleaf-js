/**
 * Config-contract Phase C / C5 — B6 styles/{style}.json → MapLibre paint/layout.
 *
 * Per-value contract: every flat-style leaf declared in style.schema.json is mapped
 * to its MapLibre paint key by the PURE converter `adapters/maplibre/maplibre-style-converter`.
 * Anchored on the reference fixtures (defaut = point, alt = surface/line) so the fixture
 * and the assertions cannot drift. Confirms by test the resolved contract (ANO-059 style.paint
 * now merged, ANO-062 line* aliases removed) and the remaining legacy (ANO-063 shape circle-only,
 * ANO-069 sizePx→radius alias, ANO-070 expressionPaint wired).
 *
 * Consumer: packages/core/src/adapters/maplibre/maplibre-style-converter.ts. Inventory B6,
 * registre ANO-059→075. (Generic happy-path coverage lives in __tests__/adapters/
 * maplibre-style-converter.test.js — this file is the config-contract framing.)
 */

import {
    normalizeToFlat,
    parseDashArray,
    toFillPaint,
    toLinePaint,
    toCirclePaint,
    toFillExtrusionPaint,
    toCasingPaint,
    collectHatchPatterns,
} from "../../src/adapters/maplibre/maplibre-style-converter.js";
import { REFERENCE_STYLE, REFERENCE_STYLE_ALT, clone } from "./_helpers/config-harness.js";

const POINT = REFERENCE_STYLE.style;
const SURFACE = REFERENCE_STYLE_ALT.style;

describe("config B6 — point style → circle paint (toCirclePaint, fixture defaut.json)", () => {
    const paint = toCirclePaint(normalizeToFlat(POINT));

    it("fillColor → circle-color", () => expect(paint["circle-color"]).toBe("#9b2226"));
    it("fillOpacity → circle-opacity", () => expect(paint["circle-opacity"]).toBe(0.9));
    it("radius → circle-radius", () => expect(paint["circle-radius"]).toBe(8));
    it("color → circle-stroke-color", () => expect(paint["circle-stroke-color"]).toBe("#ffffff"));
    it("weight → circle-stroke-width", () => expect(paint["circle-stroke-width"]).toBe(2));

    it("@anomaly ANO-070 — expressionPaint merged last (circle-blur passthrough)", () => {
        expect(paint["circle-blur"]).toBe(0.3);
    });

    it("@anomaly ANO-063 — shape is ignored: 'square' still yields circle paint only", () => {
        const square = toCirclePaint(normalizeToFlat({ ...POINT, shape: "square" }));
        expect(square["circle-radius"]).toBe(8);
        expect(square.shape).toBeUndefined();
        expect(square["fill-pattern"]).toBeUndefined();
    });
});

describe("config B6 — surface style → fill paint (toFillPaint, fixture alt.json)", () => {
    const paint = toFillPaint(normalizeToFlat(SURFACE), "reference-points");

    it("fillColor → fill-color", () => expect(paint["fill-color"]).toBe("#386641"));
    it("fillOpacity → fill-opacity", () => expect(paint["fill-opacity"]).toBe(0.5));
    it("color → fill-outline-color", () => expect(paint["fill-outline-color"]).toBe("#283618"));
    it("hatch.enabled + layerId → fill-pattern id", () => {
        expect(typeof paint["fill-pattern"]).toBe("string");
        expect(paint["fill-pattern"].length).toBeGreaterThan(0);
    });

    it("ANO-059 RÉSOLU — style.paint is now merged into the layer paint (like expressionPaint)", () => {
        // alt.json carries style.paint { "fill-antialias": true } — now passed through (Archi S2).
        expect(SURFACE.paint).toMatchObject({ "fill-antialias": true });
        expect(paint["fill-antialias"]).toBe(true);
    });

    it("hatch.renderMode 'pattern_only' forces transparent fill (overlay leaves color)", () => {
        const overlay = toFillPaint(normalizeToFlat(SURFACE), "lyr");
        expect(overlay["fill-color"]).toBe("#386641"); // overlay
        const patternOnly = toFillPaint(
            normalizeToFlat({
                ...SURFACE,
                hatch: { ...SURFACE.hatch, renderMode: "pattern_only" },
            }),
            "lyr"
        );
        expect(patternOnly["fill-color"]).toBe("transparent");
        expect(patternOnly["fill-opacity"]).toBe(1);
    });
});

describe("config B6 — line leaves → line paint (toLinePaint, fixture alt.json)", () => {
    const paint = toLinePaint(normalizeToFlat(SURFACE));

    it("color → line-color", () => expect(paint["line-color"]).toBe("#283618"));
    it("weight → line-width", () => expect(paint["line-width"]).toBe(1.5));
    it("opacity → line-opacity", () => expect(paint["line-opacity"]).toBe(1));
    it("dashArray → line-dasharray (parsed)", () =>
        expect(paint["line-dasharray"]).toEqual([4, 2]));
    it("lineCap → line-cap", () => expect(paint["line-cap"]).toBe("round"));
    it("lineJoin → line-join", () => expect(paint["line-join"]).toBe("miter"));

    // ANO-062 RÉSOLU (Archi S2) — lineColor/lineOpacity/lineWidth retirés du schéma et migrés
    // vers color/opacity/weight (calé sur tourism). Les clés mortes n'existent plus → l'ancien
    // lock @anomaly est supprimé ; le rejet AJV est verrouillé dans s14-styles-anomalies-lock.
    it("canonical color/opacity/weight drive the line paint (no legacy line* aliases remain)", () => {
        expect(SURFACE.lineColor).toBeUndefined();
        expect(paint["line-color"]).toBe("#283618"); // from `color`
        expect(paint["line-opacity"]).toBe(1); // from `opacity`
        expect(paint["line-width"]).toBe(1.5); // from `weight`
    });
});

describe("config B6 — fillExtrusion 3D → fill-extrusion paint (toFillExtrusionPaint)", () => {
    const paint = toFillExtrusionPaint(normalizeToFlat(SURFACE));

    it("fillExtrusionColor → fill-extrusion-color", () =>
        expect(paint["fill-extrusion-color"]).toBe("#6a994e"));
    it("fillExtrusionOpacity → fill-extrusion-opacity", () =>
        expect(paint["fill-extrusion-opacity"]).toBe(0.9));
    it("string height → ['coalesce', ['get', field], 0] expression", () =>
        expect(paint["fill-extrusion-height"]).toEqual([
            "coalesce",
            ["get", "properties.height"],
            0,
        ]));
    it("numeric base → direct value", () => expect(paint["fill-extrusion-base"]).toBe(0));
    it("missing opacity defaults to 1.0", () =>
        expect(toFillExtrusionPaint({})["fill-extrusion-opacity"]).toBe(1.0));
});

describe("config B6 — casing → casing line paint (toCasingPaint, fixture alt.json)", () => {
    const casing = SURFACE.casing;
    const paint = toCasingPaint(casing, SURFACE.weight);

    it("color → line-color", () => expect(paint["line-color"]).toBe("#000000"));
    it("widthPx → main weight + 2×widthPx", () =>
        expect(paint["line-width"]).toBe(SURFACE.weight + casing.widthPx * 2)); // 1.5 + 2 = 3.5
    it("opacity → line-opacity", () => expect(paint["line-opacity"]).toBe(0.8));
    it("missing color → #000000 default", () =>
        expect(toCasingPaint({ enabled: true }, 2)["line-color"]).toBe("#000000"));
});

describe("config B6 — normalizeToFlat + parseDashArray + collectHatchPatterns", () => {
    it("ANO-069 — legacy sizePx alias removed in S3 (no longer maps to radius)", () => {
        expect(normalizeToFlat({ sizePx: 5 }).radius).toBeUndefined();
    });
    it("explicit radius wins over sizePx", () => {
        expect(normalizeToFlat({ sizePx: 5, radius: 9 }).radius).toBe(9);
    });
    it("prototype-polluting keys are never copied", () => {
        const flat = normalizeToFlat(JSON.parse('{"__proto__":{"polluted":1},"radius":3}'));
        expect(flat.radius).toBe(3);
        expect({}.polluted).toBeUndefined();
    });
    it("parseDashArray splits on whitespace/commas, drops invalid", () => {
        expect(parseDashArray("4 2")).toEqual([4, 2]);
        expect(parseDashArray("5, 10")).toEqual([5, 10]);
        expect(parseDashArray("")).toBeUndefined();
    });
    it("collectHatchPatterns returns one entry for an enabled default hatch", () => {
        const patterns = collectHatchPatterns(
            normalizeToFlat(SURFACE),
            clone(REFERENCE_STYLE_ALT.styleRules),
            "reference-points"
        );
        expect(patterns).toHaveLength(1);
        expect(patterns[0]).toHaveProperty("patternId");
        expect(patterns[0].hatchConfig.enabled).toBe(true);
    });
});
