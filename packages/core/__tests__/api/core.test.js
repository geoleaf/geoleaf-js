/**
 * Phase 60 — Step 1.1: src/api/geoleaf.core.ts (0% → 60%)
 * Couvre le shim core qui re-exporte { Core } depuis src/api/geoleaf.core.ts
 */
import { Core } from "../../src/api/geoleaf.core.js";

describe("api/core (step 1.1)", () => {
    it("exporte Core depuis le barrel core", () => {
        expect(Core).toBeDefined();
        expect(typeof Core).toBe("object");
    });
});
