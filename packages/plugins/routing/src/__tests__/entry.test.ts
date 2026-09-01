/**
 * @geoleaf-plugins/routing — smoke test
 * Confirms the public API builds and mounts. Replace with real coverage.
 */
import { describe, it, expect } from "vitest";
import { buildPublicApi } from "../public-api.js";

describe("@geoleaf-plugins/routing public API", () => {
    it("builds an object with the documented surface", () => {
        const api = buildPublicApi();
        expect(typeof api).toBe("object");
        // The template's facade exposed `open()`, an empty body
        // `check-facade-purity` refuses. It now exposes what really exists —
        // and the test follows the facade, it does not force it to keep a dead
        // method to stay green.
        expect(typeof api.getConfig).toBe("function");
    });
});
