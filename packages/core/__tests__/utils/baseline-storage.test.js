/**
 * Tests pour baseline-storage — Phase 1 step 1.8 (25% → 60%)
 */
import {
    loadBaselineFromStorage,
    saveBaselineToStorage,
} from "../../src/utils/performance/baseline-storage.js";

describe("utils/performance/baseline-storage", () => {
    const key = "geoleaf_performance_baseline";

    beforeEach(() => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
    });

    describe("loadBaselineFromStorage", () => {
        it("returns null when nothing stored", () => {
            expect(loadBaselineFromStorage("sessionStorage")).toBeNull();
            expect(loadBaselineFromStorage("localStorage")).toBeNull();
        });
        it("returns parsed object from sessionStorage", () => {
            const baseline = { timestamp: "2026-01-01", memory: {} };
            sessionStorage.setItem(key, JSON.stringify(baseline));
            expect(loadBaselineFromStorage("sessionStorage")).toEqual(baseline);
        });
        it("returns parsed object from localStorage", () => {
            const baseline = { timestamp: "2026-01-01" };
            localStorage.setItem(key, JSON.stringify(baseline));
            expect(loadBaselineFromStorage("localStorage")).toEqual(baseline);
        });
        it("returns null for invalid JSON", () => {
            sessionStorage.setItem(key, "not json {");
            expect(loadBaselineFromStorage("sessionStorage")).toBeNull();
        });
    });

    describe("saveBaselineToStorage", () => {
        it("saves to sessionStorage and can be loaded", () => {
            const baseline = { timestamp: "2026-01-01", memory: { used: 1 } };
            saveBaselineToStorage(baseline, "sessionStorage");
            expect(loadBaselineFromStorage("sessionStorage")).toEqual(baseline);
        });
        it("saves to localStorage and can be loaded", () => {
            const baseline = { timestamp: "2026-01-01" };
            saveBaselineToStorage(baseline, "localStorage");
            expect(loadBaselineFromStorage("localStorage")).toEqual(baseline);
        });
    });
});
