/**
 * Tests for provider.ts — Provider implementations and factory.
 * Covers: createProvider(), AddokProvider, NominatimProvider, PhotonProvider,
 *         CustomProvider, _parseGeoJSON edge cases.
 *
 * Ported from the core suite (`__tests__/geocoding/geocoding-provider.test.js`)
 * during the geocoding extraction (Plugin Contract v1). Logic is identical;
 * only the import path changed (`built-in/geocoding/geocoding-provider` → `../provider`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    createProvider,
    AddokProvider,
    NominatimProvider,
    PhotonProvider,
    CustomProvider,
} from "../provider.js";

// ── Shared helpers ────────────────────────────────────────────────────────────

function _makeFeatureCollection(features) {
    return { type: "FeatureCollection", features };
}

function _makeFeature(lng, lat, props = {}, bbox) {
    const f = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: props,
    };
    if (bbox) f.bbox = bbox;
    return f;
}

// ── createProvider factory ────────────────────────────────────────────────────

describe("createProvider", () => {
    it("returns AddokProvider for config.provider = 'addok'", () => {
        expect(createProvider({ provider: "addok" })).toBeInstanceOf(AddokProvider);
    });

    it("returns AddokProvider when provider is undefined", () => {
        expect(createProvider({})).toBeInstanceOf(AddokProvider);
    });

    it("returns NominatimProvider for 'nominatim'", () => {
        expect(createProvider({ provider: "nominatim" })).toBeInstanceOf(NominatimProvider);
    });

    it("returns PhotonProvider for 'photon'", () => {
        expect(createProvider({ provider: "photon" })).toBeInstanceOf(PhotonProvider);
    });

    it("returns CustomProvider for an HTTPS URL string", () => {
        const p = createProvider({ provider: "https://my-geocoder.example.com/search" });
        expect(p).toBeInstanceOf(CustomProvider);
    });

    it("falls back to AddokProvider for unknown strings without https://", () => {
        expect(createProvider({ provider: "http://insecure.example.com" })).toBeInstanceOf(
            AddokProvider
        );
    });

    it("falls back to AddokProvider for non-string unknown values", () => {
        // Intentionally pass a non-string to exercise the safe fallback.
        expect(createProvider({ provider: 42 as unknown as string })).toBeInstanceOf(AddokProvider);
    });
});

// ── AddokProvider ─────────────────────────────────────────────────────────────

describe("AddokProvider", () => {
    it("returns parsed results on successful fetch", async () => {
        const fc = _makeFeatureCollection([_makeFeature(2.3, 48.8, { label: "Paris" })]);
        const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => fc });
        vi.stubGlobal("fetch", fetchMock);

        const provider = new AddokProvider();
        const results = await provider.search("Paris", 5);
        expect(results).toHaveLength(1);
        expect(results[0].label).toBe("Paris");
        expect(results[0].lat).toBe(48.8);
        expect(results[0].lng).toBe(2.3);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("api-adresse.data.gouv.fr/search/?q=Paris&limit=5")
        );

        vi.unstubAllGlobals();
    });

    it("returns [] when fetch fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Network")));
        const results = await new AddokProvider().search("fail", 5);
        expect(results).toEqual([]);
        vi.unstubAllGlobals();
    });

    it("returns [] when response is not ok", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false }));
        const results = await new AddokProvider().search("fail", 5);
        expect(results).toEqual([]);
        vi.unstubAllGlobals();
    });

    it("biases Addok results with bbox centroid (lat/lon)", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: async () => _makeFeatureCollection([]) });
        vi.stubGlobal("fetch", fetchMock);

        await new AddokProvider({ bbox: [-5, 41, 10, 51] }).search("x", 5);
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain("lat=46.00000");
        expect(url).toContain("lon=2.50000");

        vi.unstubAllGlobals();
    });
});

// ── NominatimProvider ─────────────────────────────────────────────────────────

describe("NominatimProvider", () => {
    it("returns parsed results with Accept-Language header", async () => {
        const fc = _makeFeatureCollection([_makeFeature(4.8, 45.7, { label: "Lyon" })]);
        const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => fc });
        vi.stubGlobal("fetch", fetchMock);

        const results = await new NominatimProvider().search("Lyon", 3);
        expect(results).toHaveLength(1);
        expect(results[0].label).toBe("Lyon");

        const callArgs = fetchMock.mock.calls[0];
        expect(callArgs[0]).toContain("nominatim.openstreetmap.org");
        expect(callArgs[1].headers["User-Agent"]).toContain("GeoLeaf");

        vi.unstubAllGlobals();
    });

    it("applies countrycodes and bbox viewbox", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: async () => _makeFeatureCollection([]) });
        vi.stubGlobal("fetch", fetchMock);

        await new NominatimProvider({ countrycodes: "fr", bbox: [-5, 41, 10, 51] }).search("x", 5);
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain("countrycodes=fr");
        expect(url).toContain("viewbox=-5,51,10,41");
        expect(url).toContain("bounded=1");

        vi.unstubAllGlobals();
    });

    it("returns [] on fetch error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Network")));
        const results = await new NominatimProvider().search("fail", 3);
        expect(results).toEqual([]);
        vi.unstubAllGlobals();
    });

    it("returns [] on non-ok response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false }));
        const results = await new NominatimProvider().search("fail", 3);
        expect(results).toEqual([]);
        vi.unstubAllGlobals();
    });
});

// ── PhotonProvider ────────────────────────────────────────────────────────────

describe("PhotonProvider", () => {
    it("returns parsed results from photon.komoot.io", async () => {
        const fc = _makeFeatureCollection([_makeFeature(13.3, 52.5, { name: "Berlin" })]);
        const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => fc });
        vi.stubGlobal("fetch", fetchMock);

        const results = await new PhotonProvider().search("Berlin", 5);
        expect(results).toHaveLength(1);
        expect(results[0].label).toBe("Berlin");
        expect(fetchMock.mock.calls[0][0]).toContain("photon.komoot.io");

        vi.unstubAllGlobals();
    });

    it("applies bbox=west,south,east,north", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: async () => _makeFeatureCollection([]) });
        vi.stubGlobal("fetch", fetchMock);

        await new PhotonProvider({ bbox: [-5, 41, 10, 51] }).search("x", 5);
        expect(fetchMock.mock.calls[0][0]).toContain("bbox=-5,41,10,51");

        vi.unstubAllGlobals();
    });

    it("returns [] on network error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
        const results = await new PhotonProvider().search("fail", 5);
        expect(results).toEqual([]);
        vi.unstubAllGlobals();
    });
});

// ── CustomProvider ────────────────────────────────────────────────────────────

describe("CustomProvider", () => {
    it("appends q= and limit= to the custom URL with ?", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: async () => _makeFeatureCollection([]) });
        vi.stubGlobal("fetch", fetchMock);

        await new CustomProvider("https://example.com/geo").search("test", 3);
        expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/geo?q=test&limit=3");

        vi.unstubAllGlobals();
    });

    it("uses & separator when base URL already has query params", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: async () => _makeFeatureCollection([]) });
        vi.stubGlobal("fetch", fetchMock);

        await new CustomProvider("https://example.com/geo?key=abc").search("test", 3);
        expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/geo?key=abc&q=test&limit=3");

        vi.unstubAllGlobals();
    });
});

// ── _parseGeoJSON edge cases (tested via AddokProvider.search) ────────────────

describe("_parseGeoJSON edge cases", () => {
    let fetchMock;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns [] for null data", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => null });
        expect(await new AddokProvider().search("x", 5)).toEqual([]);
    });

    it("returns [] for non-object data", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => "string" });
        expect(await new AddokProvider().search("x", 5)).toEqual([]);
    });

    it("returns [] when features is not an array", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ features: "not-array" }),
        });
        expect(await new AddokProvider().search("x", 5)).toEqual([]);
    });

    it("skips features without type=Feature", async () => {
        const fc = { features: [{ type: "Polygon", geometry: { coordinates: [0, 0] } }] };
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        expect(await new AddokProvider().search("x", 5)).toEqual([]);
    });

    it("skips features with missing coordinates", async () => {
        const fc = { features: [{ type: "Feature", geometry: {}, properties: {} }] };
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        expect(await new AddokProvider().search("x", 5)).toEqual([]);
    });

    it("skips features with non-finite coordinates", async () => {
        const fc = _makeFeatureCollection([
            {
                type: "Feature",
                geometry: { type: "Point", coordinates: [NaN, 48] },
                properties: {},
            },
        ]);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        expect(await new AddokProvider().search("x", 5)).toEqual([]);
    });

    it("generates fallback label from coordinates when no label/name", async () => {
        const fc = _makeFeatureCollection([_makeFeature(2.12345, 48.6789, {})]);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        const results = await new AddokProvider().search("x", 5);
        expect(results[0].label).toBe("48.67890, 2.12345");
    });

    it("uses display_name as fallback label", async () => {
        const fc = _makeFeatureCollection([
            _makeFeature(2.3, 48.8, { display_name: "Paris, France" }),
        ]);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        const results = await new AddokProvider().search("x", 5);
        expect(results[0].label).toBe("Paris, France");
    });

    it("truncates labels at 200 characters", async () => {
        const longLabel = "A".repeat(300);
        const fc = _makeFeatureCollection([_makeFeature(2.3, 48.8, { label: longLabel })]);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        const results = await new AddokProvider().search("x", 5);
        expect(results[0].label).toHaveLength(200);
    });

    it("parses bbox into bounds when valid", async () => {
        const fc = _makeFeatureCollection([
            _makeFeature(2.3, 48.8, { label: "IDF" }, [-0.5, 47.0, 4.0, 49.5]),
        ]);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        const results = await new AddokProvider().search("x", 5);
        expect(results[0].bounds).toEqual({
            north: 49.5,
            south: 47.0,
            east: 4.0,
            west: -0.5,
        });
    });

    it("ignores bbox with non-finite values", async () => {
        const fc = _makeFeatureCollection([
            _makeFeature(2.3, 48.8, { label: "bad" }, [NaN, 47, 4, 49]),
        ]);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        const results = await new AddokProvider().search("x", 5);
        expect(results[0].bounds).toBeUndefined();
    });

    it("ignores bbox with wrong length", async () => {
        const fc = _makeFeatureCollection([_makeFeature(2.3, 48.8, { label: "short" }, [1, 2])]);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        const results = await new AddokProvider().search("x", 5);
        expect(results[0].bounds).toBeUndefined();
    });

    it("stores raw feature in result.raw", async () => {
        const feature = _makeFeature(2.3, 48.8, { label: "P" });
        const fc = _makeFeatureCollection([feature]);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fc });
        const results = await new AddokProvider().search("x", 5);
        expect(results[0].raw).toEqual(feature);
    });
});
