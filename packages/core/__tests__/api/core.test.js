/**
 * Covers the core shim that re-exports { Core } from src/api/geoleaf.core.ts
 */
import { Core } from "../../src/api/geoleaf.core.js";

describe("api/core (step 1.1)", () => {
    it("exporte Core depuis le barrel core", () => {
        expect(Core).toBeDefined();
        expect(typeof Core).toBe("object");
    });
});
