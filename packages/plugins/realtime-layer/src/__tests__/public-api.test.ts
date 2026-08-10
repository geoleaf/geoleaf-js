/**
 * public-api.test.ts — tests the GeoLeaf.RealtimeLayer namespace builder.
 */
import { describe, it, expect } from "vitest";
import { buildPublicApi } from "../public-api.js";

describe("buildPublicApi", () => {
    it("exposes the full realtime-layer public surface", () => {
        const api = buildPublicApi();
        expect(typeof api.start).toBe("function");
        expect(typeof api.stop).toBe("function");
        expect(typeof api.stopAll).toBe("function");
        expect(typeof api.getStatus).toBe("function");
        expect(typeof api.registerDecoder).toBe("function");
        expect(typeof api.registerStaleAction).toBe("function");
        expect(api).toHaveProperty("version");
    });
});
