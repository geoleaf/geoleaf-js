/**
 * Phase 60 — Step 1.9: src/globals/globals.storage.ts (0% → 60%)
 */
vi.mock("../../src/kernel/storage/offline-detector.ts", () => ({
    OfflineDetector: {},
}));
vi.mock("../../src/kernel/storage/sw-register.ts", () => ({
    SWRegister: {},
}));

import "../../src/globals/globals.storage.js";

describe("globals/globals.storage (step 1.9)", () => {
    it("attache _OfflineDetector et Storage au namespace GeoLeaf", () => {
        expect(globalThis.GeoLeaf).toBeDefined();
        expect(globalThis.GeoLeaf._OfflineDetector).toBeDefined();
        expect(globalThis.GeoLeaf.Storage).toBeDefined();
        expect(typeof globalThis.GeoLeaf.Storage).toBe("object");
    });
});
