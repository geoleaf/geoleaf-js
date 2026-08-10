import { describe, it, expect } from "vitest";
import { buildPublicApi } from "../../../src/capabilities/feature-info/public-api.js";
describe("@geoleaf-plugins/feature-info public API", () => {
    it("builds an object with the documented 5-method surface (v2.0.0)", () => {
        const api = buildPublicApi();
        expect(typeof api).toBe("object");
        expect(typeof api.isEnabled).toBe("function");
        expect(typeof api.close).toBe("function");
        expect(typeof api.openPopup).toBe("function");
        expect(typeof api.openSidePanel).toBe("function");
        expect(typeof api.getConfig).toBe("function");
    });
    it("isEnabled returns boolean (defaults to true when no core config)", () => {
        const api = buildPublicApi();
        expect(typeof api.isEnabled()).toBe("boolean");
    });
});
