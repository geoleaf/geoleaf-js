/**
 * @fileoverview ESM tests for capabilities/legend/legend-seam.ts branch coverage.
 * Uses static ESM import for Istanbul instrumentation.
 *
 * Covers the two FALSE branches of the method-presence checks (loadLayerLegend /
 * setLayerVisibility missing) AND the readiness conjunct of `isAvailable()`.
 *
 * ⚠️ The `isAvailable` cases here used to assert that a Legend merely CARRYING
 * `loadLayerLegend` was "available". That was the defect, not the contract: the facade
 * carries its methods from `registerGlobals` onward, long before `Legend.init` binds a
 * map, so the kernel callers were waved through during the theme apply and each one
 * logged "[Legend] Module not initialized". The cases were relaxed, not dropped — both
 * conjuncts are now exercised independently.
 */

vi.mock("../../src/api/geoleaf.legend.js", () => ({
    Legend: {
        loadLayerLegend: vi.fn(),
        setLayerVisibility: vi.fn(),
    },
}));

// The seam reads the METHODS off the facade and the READINESS off the implementation
// (the B.28 direction), so the two modules are mocked separately.
vi.mock("../../src/capabilities/legend/legend.js", () => ({
    Legend: {},
    isLegendInitialized: vi.fn(() => true),
}));

import { LegendContract } from "../../src/capabilities/legend/legend-seam.js";
import { Legend } from "../../src/api/geoleaf.legend.js";
import { isLegendInitialized } from "../../src/capabilities/legend/legend.js";

describe("legend.contract — ESM (branch coverage)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore functions by default
        Legend.loadLayerLegend = vi.fn();
        Legend.setLayerVisibility = vi.fn();
        isLegendInitialized.mockReturnValue(true);
    });

    // ── isAvailable ──────────────────────────────────────────────────────────

    it("isAvailable returns true when Legend has loadLayerLegend AND is initialized", () => {
        expect(LegendContract.isAvailable()).toBe(true);
    });

    it("isAvailable returns false when Legend.loadLayerLegend is not a function", () => {
        Legend.loadLayerLegend = null;
        expect(LegendContract.isAvailable()).toBe(false);
    });

    it("isAvailable returns false BEFORE init, even though the methods are all there", () => {
        // The boot-time shape: the facade is fully populated, `Legend.init` has not run.
        // A presence-only guard returned true here — that is the regression this locks.
        isLegendInitialized.mockReturnValue(false);
        expect(typeof Legend.loadLayerLegend).toBe("function");
        expect(LegendContract.isAvailable()).toBe(false);
    });

    it("isAvailable follows the readiness predicate across a mount/teardown cycle", () => {
        isLegendInitialized.mockReturnValue(false);
        expect(LegendContract.isAvailable()).toBe(false);
        isLegendInitialized.mockReturnValue(true);
        expect(LegendContract.isAvailable()).toBe(true);
        // `_reset()` sets `_map` back to null — availability must fall with it.
        isLegendInitialized.mockReturnValue(false);
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
