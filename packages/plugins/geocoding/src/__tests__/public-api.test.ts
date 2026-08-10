/**
 * Tests for public-api.ts — Public Geocoding facade.
 *
 * Ported from the core suite (`__tests__/geocoding/geocoding-facade.test.js`).
 * Plugin adaptations:
 *  - the facade is built by `buildPublicApi()` (the core exported a `Geocoding`
 *    singleton from `geoleaf.geocoding.ts`);
 *  - the `GeoLeaf.Geocoding` global assignment now happens in `entry.ts`
 *    (covered by `entry.test.ts`), so this suite only asserts delegation;
 *  - the facade gained an `open()` method for the mobile toolbar toggle.
 *
 * `public-api.ts` is excluded from coverage (a thin façade) — this suite
 * guards behaviour, not the coverage threshold.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    isEnabled: vi.fn(() => false),
    search: vi.fn(async () => []),
    selectResult: vi.fn(),
    open: vi.fn(),
    destroy: vi.fn(),
}));

vi.mock("../registry.js", () => ({
    GeocodingRegistry: {
        isEnabled: mocks.isEnabled,
        search: mocks.search,
        selectResult: mocks.selectResult,
        open: mocks.open,
        destroy: mocks.destroy,
    },
}));

import { buildPublicApi } from "../public-api.js";

describe("public-api — facade", () => {
    let api;

    beforeEach(() => {
        vi.clearAllMocks();
        api = buildPublicApi();
    });

    it("builds an object with the documented surface", () => {
        expect(typeof api).toBe("object");
        for (const method of ["isEnabled", "search", "selectResult", "open", "destroy"]) {
            expect(typeof api[method]).toBe("function");
        }
    });

    it("isEnabled delegates to GeocodingRegistry.isEnabled", () => {
        mocks.isEnabled.mockReturnValueOnce(true);
        expect(api.isEnabled()).toBe(true);
        expect(mocks.isEnabled).toHaveBeenCalled();
    });

    it("search delegates to GeocodingRegistry.search", async () => {
        const fakeResults = [{ label: "Paris", lat: 48.8, lng: 2.3 }];
        mocks.search.mockResolvedValueOnce(fakeResults);
        const res = await api.search("Paris", 3);
        expect(res).toBe(fakeResults);
        expect(mocks.search).toHaveBeenCalledWith("Paris", 3);
    });

    it("selectResult delegates to GeocodingRegistry.selectResult", () => {
        const result = { label: "Lyon", lat: 45.7, lng: 4.8 };
        api.selectResult(result);
        expect(mocks.selectResult).toHaveBeenCalledWith(result);
    });

    it("open delegates to GeocodingRegistry.open", () => {
        const button = document.createElement("button");
        api.open(button);
        expect(mocks.open).toHaveBeenCalledWith(button);
    });

    it("destroy delegates to GeocodingRegistry.destroy", () => {
        api.destroy();
        expect(mocks.destroy).toHaveBeenCalled();
    });
});
