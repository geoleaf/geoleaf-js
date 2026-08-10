/**
 * R3 — Tests des contrats (0 exclusion, ≥ 60 % coverage).
 * Each contract is an interface to a lazy module ; we mock the dependencies.
 */
vi.mock("../../src/api/geoleaf.legend.js", () => ({
    Legend: {
        loadLayerLegend: vi.fn(),
        setLayerVisibility: vi.fn(),
    },
}));
import { LegendContract } from "../../src/capabilities/legend/legend-seam.ts";

describe("contracts (R3)", () => {
    describe("LegendContract", () => {
        it("expose isAvailable, loadLayerLegend, setLayerVisibility", () => {
            expect(typeof LegendContract.isAvailable).toBe("function");
            expect(typeof LegendContract.loadLayerLegend).toBe("function");
            expect(typeof LegendContract.setLayerVisibility).toBe("function");
        });
        it("isAvailable returns un boolean", () => {
            expect(typeof LegendContract.isAvailable()).toBe("boolean");
        });
        it("loadLayerLegend et setLayerVisibility ne throwent pas", () => {
            expect(() => LegendContract.loadLayerLegend("L1", "s1", {})).not.toThrow();
            expect(() => LegendContract.setLayerVisibility("L1", true)).not.toThrow();
        });
    });
});
