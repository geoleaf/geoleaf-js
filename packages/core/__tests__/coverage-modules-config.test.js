/**
 * Campagne tests unitaires — config (ConfigLoader)
 */

import { ConfigLoader } from "../src/kernel/config/loader.js";
import { getDebugMode } from "../src/kernel/config/debug-flag.js";
import { ConfigNormalizer } from "../src/kernel/config/normalization.js";

vi.mock("../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Complete by construction: the `security` barrel exposes 17 values
// (escapeHtml, createSafeElement, validateUrl…) and this mock only provided
// one. The spread keeps the `Security` override while leaving the other
// exports real.
vi.mock("../src/kernel/security/index.js", async (importActual) => ({
    ...(await importActual()),
    Security: {
        validateUrl: vi.fn((url) => url),
    },
}));

describe("Coverage — config/loader", () => {
    beforeEach(() => {
        global.fetch = vi.fn();
    });

    it("loadUrl returns empty object for empty url", async () => {
        const result = await ConfigLoader.loadUrl("");
        expect(result).toEqual({});
    });

    it("loadUrl with relative URL fetches and returns JSON", async () => {
        const cfg = { map: { center: [0, 0] } };
        global.fetch.mockResolvedValueOnce({
            ok: true,
            headers: { get: () => "application/json" },
            json: () => Promise.resolve(cfg),
        });
        const result = await ConfigLoader.loadUrl("/api/config.json");
        expect(result).toEqual(cfg);
        expect(global.fetch).toHaveBeenCalledWith(
            "/api/config.json",
            expect.objectContaining({ method: "GET" })
        );
    });

    it("loadUrl rejects when response not ok", async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            headers: { get: () => null },
        });
        await expect(ConfigLoader.loadUrl("/api/config.json")).rejects.toThrow(/HTTP 404/);
    });
});

describe("Coverage — config/debug-flag", () => {
    it("getDebugMode returns false when GeoLeaf.DEBUG not set", () => {
        const prev = globalThis.GeoLeaf?.DEBUG;
        delete globalThis.GeoLeaf?.DEBUG;
        expect(getDebugMode()).toBe(false);
        if (globalThis.GeoLeaf) globalThis.GeoLeaf.DEBUG = prev;
    });
    it("getDebugMode returns true when GeoLeaf.DEBUG is true", () => {
        globalThis.GeoLeaf = globalThis.GeoLeaf || {};
        globalThis.GeoLeaf.DEBUG = true;
        expect(getDebugMode()).toBe(true);
        globalThis.GeoLeaf.DEBUG = false;
    });
});

describe("Coverage — config/normalization", () => {
    it("isPoiStructNormalized returns false for null or non-object", () => {
        expect(ConfigNormalizer.isPoiStructNormalized(null)).toBe(false);
        expect(ConfigNormalizer.isPoiStructNormalized(undefined)).toBe(false);
        expect(ConfigNormalizer.isPoiStructNormalized("")).toBe(false);
    });
    it("isPoiStructNormalized returns false when id missing or empty", () => {
        expect(ConfigNormalizer.isPoiStructNormalized({ title: "A", latlng: [0, 0] })).toBe(false);
    });
    it("isPoiStructNormalized returns false when no title/label", () => {
        expect(ConfigNormalizer.isPoiStructNormalized({ id: "x", latlng: [0, 0] })).toBe(false);
    });
    it("isPoiStructNormalized returns true for normalized POI with latlng", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({
                id: "p1",
                title: "POI 1",
                latlng: [48.8, 2.3],
            })
        ).toBe(true);
    });
    it("isPoiStructNormalized returns true for normalized POI with label", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({
                id: "p2",
                label: "POI 2",
                latlng: [48.8, 2.3],
            })
        ).toBe(true);
    });
});
