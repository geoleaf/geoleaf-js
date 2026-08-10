/**
 * __PLUGIN_PKG__ — smoke test
 * Confirms the public API builds and mounts. Replace with real coverage.
 */
import { describe, it, expect } from "vitest";
import { buildPublicApi } from "../public-api.js";

describe("__PLUGIN_PKG__ public API", () => {
    it("builds an object with the documented surface", () => {
        const api = buildPublicApi();
        expect(typeof api).toBe("object");
        expect(typeof api.open).toBe("function");
    });
});
