/**
 * @fileoverview ESM tests for capabilities/legend/legend-seam.ts branch coverage.
 * Uses static ESM import for Istanbul instrumentation.
 *
 * Covers L45 FALSE (loadLayerLegend method missing) and
 * L56 FALSE (setLayerVisibility method missing).
 */

vi.mock("../../src/api/geoleaf.legend.js", () => ({
    Legend: {
        loadLayerLegend: vi.fn(),
        setLayerVisibility: vi.fn(),
    },
}));

import { LegendContract } from "../../src/capabilities/legend/legend-seam.js";
import { Legend } from "../../src/api/geoleaf.legend.js";

describe("legend.contract — ESM (branch coverage)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore functions by default
        Legend.loadLayerLegend = vi.fn();
        Legend.setLayerVisibility = vi.fn();
    });

    // ── isAvailable ──────────────────────────────────────────────────────────

    it("isAvailable returns true when Legend has loadLayerLegend", () => {
        expect(LegendContract.isAvailable()).toBe(true);
    });

    it("isAvailable returns false when Legend.loadLayerLegend is not a function", () => {
        Legend.loadLayerLegend = null;
        expect(LegendContract.isAvailable()).toBe(false);
    });

    // ── loadLayerLegend ──────────────────────────────────────────────────────

    it("calls Legend.loadLayerLegend when it is a function (L45 TRUE branch)", () => {
        LegendContract.loadLayerLegend("layer1", "style1", {});
        expect(Legend.loadLayerLegend).toHaveBeenCalledWith("layer1", "style1", {});
    });

    it("does not throw when Legend.loadLayerLegend is not a function (L45 FALSE branch)", () => {
        // Set to a non-function to trigger the FALSE branch of "typeof Legend.loadLayerLegend === 'function'"
        Legend.loadLayerLegend = null;
        expect(() => LegendContract.loadLayerLegend("layer1", "style1", {})).not.toThrow();
    });

    // ── setLayerVisibility ───────────────────────────────────────────────────

    it("calls Legend.setLayerVisibility when it is a function (L56 TRUE branch)", () => {
        LegendContract.setLayerVisibility("layer1", true);
        expect(Legend.setLayerVisibility).toHaveBeenCalledWith("layer1", true);
    });

    it("does not throw when Legend.setLayerVisibility is not a function (L56 FALSE branch)", () => {
        Legend.setLayerVisibility = null;
        expect(() => LegendContract.setLayerVisibility("layer1", false)).not.toThrow();
    });
});
