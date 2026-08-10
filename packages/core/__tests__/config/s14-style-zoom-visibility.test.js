/**
 * Config-contract Phase C / C5 — B6 styles/{style}.json scaleConfig + labelScale visibility.
 *
 * Both are LIVE scale-range mechanisms expressed in SCALE DENOMINATORS (1:X) and read by
 * the pure `isScaleInRange` (utils/general/scale-utils): `scaleConfig` gates the layer
 * (visibility.ts, via layerData.currentStyle), `labelScale` gates its labels (labels.ts).
 * Same unit, different target — not duplicates.
 *
 * `scaleConfig` replaced `zoomConfig` in S5 (N-1): the old minZoom/maxZoom naming invited
 * zoom levels into a denominator field. Schema/validator rejection of the retired name is
 * locked in s14-styles-anomalies-lock.test.js + validators/style-validator-rules.test.js.
 *
 * Consumer: scale-utils.ts (pure) + geojson/layers/visibility.ts. Inventory B6.
 */

import {
    isScaleInRange,
    calculateMapScale,
    clearScaleCache,
} from "../../src/utils/general/scale-utils.js";
import { REFERENCE_STYLE } from "./_helpers/config-harness.js";

describe("config B6 — labelScale.{minScale,maxScale} → isScaleInRange (scale denominators)", () => {
    const { minScale, maxScale } = REFERENCE_STYLE.labelScale; // { 50000, 1000 }

    it("fixture range: a scale inside [maxScale ; minScale] is visible", () => {
        expect(isScaleInRange(20000, minScale, maxScale)).toBe(true);
    });
    it("currentScale > minScale → invisible (too zoomed out)", () => {
        expect(isScaleInRange(80000, minScale, maxScale)).toBe(false);
    });
    it("currentScale < maxScale → invisible (too zoomed in)", () => {
        expect(isScaleInRange(500, minScale, maxScale)).toBe(false);
    });
    it("boundaries are inclusive", () => {
        expect(isScaleInRange(minScale, minScale, maxScale)).toBe(true);
        expect(isScaleInRange(maxScale, minScale, maxScale)).toBe(true);
    });
    it("null / 0 bounds disable the constraint (always visible)", () => {
        expect(isScaleInRange(123456, null, null)).toBe(true);
        expect(isScaleInRange(123456, 0, 0)).toBe(true);
    });
    it("only a min bound: hides when too zoomed out", () => {
        expect(isScaleInRange(60000, 50000, null)).toBe(false);
        expect(isScaleInRange(40000, 50000, null)).toBe(true);
    });
});

describe("config B6 — calculateMapScale (zoom + latitude → 1:X denominator)", () => {
    beforeEach(() => clearScaleCache());

    it("null map → 0", () => expect(calculateMapScale(null)).toBe(0));
    it("map without center/zoom → 0", () => expect(calculateMapScale({})).toBe(0));
    it("a real zoom/lat yields a positive denominator", () => {
        const map = { getCenter: () => ({ lat: 0 }), getZoom: () => 10 };
        expect(calculateMapScale(map, { force: true })).toBeGreaterThan(0);
    });
    it("scale shrinks (more zoomed in) as zoom increases", () => {
        const at8 = calculateMapScale(
            { getCenter: () => ({ lat: 0 }), getZoom: () => 8 },
            { force: true }
        );
        const at14 = calculateMapScale(
            { getCenter: () => ({ lat: 0 }), getZoom: () => 14 },
            { force: true }
        );
        expect(at14).toBeLessThan(at8);
    });
});

/**
 * N-1 regression lock (S5). These were three `it.todo`s, and that gap is exactly how the
 * bug survived ~3 months: `zoomConfig.minZoom` was named like a zoom level but fed to
 * `isScaleInRange` as a scale denominator, so 18 layers across 3 profiles were hidden at
 * EVERY zoom. Nothing asserted the config→visibility link end to end.
 *
 * These tests run the real `calculateMapScale` against the real post-migration values of
 * `profiles/guyane-biodiversite` (lat ~4°N), so they fail if the conversion drifts or if
 * a zoom level creeps back into the field.
 */
describe("config B6 — scaleConfig.{minScale,maxScale} → layer visibility (N-1 regression)", () => {
    beforeEach(() => clearScaleCache());

    // profiles/guyane-biodiversite/layers/cours_eau/styles/defaut.json, post-migration.
    // Was `{minZoom: 6, maxZoom: 18}` — zoom levels, read as denominators.
    const GUYANE = { minScale: 9222148, maxScale: 2252 };
    const scaleAtZoom = (zoom) =>
        calculateMapScale({ getCenter: () => ({ lat: 4 }), getZoom: () => zoom }, { force: true });

    const visibleAtZoom = (zoom, bounds = GUYANE) =>
        isScaleInRange(scaleAtZoom(zoom), bounds.minScale, bounds.maxScale);

    it("visible across its intended zoom window (6 → 18)", () => {
        expect(visibleAtZoom(6)).toBe(true);
        expect(visibleAtZoom(10)).toBe(true);
        expect(visibleAtZoom(14)).toBe(true);
        expect(visibleAtZoom(18)).toBe(true);
    });

    it("hidden when zoomed further out than its window", () => {
        expect(visibleAtZoom(5)).toBe(false);
        expect(visibleAtZoom(0)).toBe(false);
    });

    it("hidden when zoomed further in than its window", () => {
        expect(visibleAtZoom(19)).toBe(false);
        expect(visibleAtZoom(22)).toBe(false);
    });

    it("the pre-migration values would have been invisible at EVERY zoom — the bug itself", () => {
        // `{minZoom: 6, maxZoom: 18}` landing in the denominator slots: reaching 1:6 needs
        // roughly zoom 27, past MapLibre's ceiling. This is what shipped for ~3 months.
        const BUGGY = { minScale: 6, maxScale: 18 };
        for (const zoom of [0, 4, 6, 10, 14, 18, 22]) {
            expect(visibleAtZoom(zoom, BUGGY)).toBe(false);
        }
    });
});
