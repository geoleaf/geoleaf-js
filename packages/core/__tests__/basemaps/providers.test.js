/**
 */
/* Phase 5.27 — src/kernel/basemaps/providers.ts */

import {
    DEFAULT_BASELAYERS,
    normalizeTilesArray,
    applyLibertyFilters,
} from "../../src/kernel/basemaps/providers.ts";

describe("basemaps/providers (Phase 5.27)", () => {
    it("DEFAULT_BASELAYERS has street, topo, satellite", () => {
        expect(DEFAULT_BASELAYERS.street).toBeDefined();
        expect(DEFAULT_BASELAYERS.street.label).toBe("Street");
        expect(DEFAULT_BASELAYERS.street.url).toContain("openstreetmap");
        expect(DEFAULT_BASELAYERS.topo).toBeDefined();
        expect(DEFAULT_BASELAYERS.satellite).toBeDefined();
    });

    it("DEFAULT_BASELAYERS entries include a tiles array", () => {
        expect(Array.isArray(DEFAULT_BASELAYERS.street.tiles)).toBe(true);
        expect(DEFAULT_BASELAYERS.street.tiles.length).toBeGreaterThan(0);
        expect(Array.isArray(DEFAULT_BASELAYERS.topo.tiles)).toBe(true);
        expect(Array.isArray(DEFAULT_BASELAYERS.satellite.tiles)).toBe(true);
        // Tiles must not contain {s} placeholder
        DEFAULT_BASELAYERS.street.tiles.forEach((t) => expect(t).not.toContain("{s}"));
    });

    it("applyLibertyFilters does not throw when glMap null", () => {
        expect(() => applyLibertyFilters(null)).not.toThrow();
    });

    it("applyLibertyFilters patches layer filters when glMap has getLayer getFilter setFilter", () => {
        const setFilter = vi.fn();
        const glMap = {
            getLayer: vi.fn((id) =>
                id === "road_motorway_link" || id === "label_city" ? {} : null
            ),
            getFilter: vi.fn(() => ["get", "ramp"]),
            setFilter,
        };
        applyLibertyFilters(glMap);
        expect(setFilter).toHaveBeenCalled();
    });

    it("applyLibertyFilters skips layer when getFilter returns null", () => {
        const setFilter = vi.fn();
        const glMap = {
            getLayer: vi.fn(() => ({})),
            getFilter: vi.fn(() => null),
            setFilter,
        };
        applyLibertyFilters(glMap);
        expect(setFilter).not.toHaveBeenCalled();
    });

    it("applyLibertyFilters handles non-array filter (patchExpr identity)", () => {
        const setFilter = vi.fn();
        const glMap = {
            getLayer: vi.fn(() => ({})),
            getFilter: vi.fn(() => "all"),
            setFilter,
        };
        applyLibertyFilters(glMap);
        expect(setFilter).toHaveBeenCalledWith(expect.any(String), "all");
    });

    it("applyLibertyFilters handles nested array filter (patchExpr recursive)", () => {
        const setFilter = vi.fn();
        const glMap = {
            getLayer: vi.fn((id) => (id === "road_motorway_link" ? {} : null)),
            getFilter: vi.fn(() => ["all", ["has", "ramp"], ["==", "type", "link"]]),
            setFilter,
        };
        applyLibertyFilters(glMap);
        expect(setFilter).toHaveBeenCalled();
    });
});

describe("normalizeTilesArray", () => {
    it("returns tiles array when definition.tiles is present", () => {
        const tiles = ["https://a.tile.example/{z}/{x}/{y}.png"];
        expect(normalizeTilesArray({ tiles })).toEqual(tiles);
    });

    it("tiles array takes priority over url", () => {
        const tiles = ["https://a.tile.example/{z}/{x}/{y}.png"];
        const result = normalizeTilesArray({
            tiles,
            url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        });
        expect(result).toEqual(tiles);
    });

    it("expands {s} template using subdomains string", () => {
        const result = normalizeTilesArray({
            url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            subdomains: "ab",
        });
        expect(result).toEqual([
            "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
            "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        ]);
    });

    it("expands {s} template using subdomains array", () => {
        const result = normalizeTilesArray({
            url: "https://{s}.tile.example/{z}/{x}/{y}.png",
            subdomains: ["x", "y", "z"],
        });
        expect(result).toEqual([
            "https://x.tile.example/{z}/{x}/{y}.png",
            "https://y.tile.example/{z}/{x}/{y}.png",
            "https://z.tile.example/{z}/{x}/{y}.png",
        ]);
    });

    it("defaults subdomains to [a, b, c] when {s} present and no subdomains given", () => {
        const result = normalizeTilesArray({
            url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        });
        expect(result).toEqual([
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ]);
    });

    it("returns single-element array for url without {s}", () => {
        const url = "https://server.arcgisonline.com/.../MapServer/tile/{z}/{y}/{x}";
        expect(normalizeTilesArray({ url })).toEqual([url]);
    });

    it("does not expand pmtiles:// URLs — returns as single-element array", () => {
        const url = "pmtiles://https://example.com/tiles.pmtiles";
        expect(normalizeTilesArray({ url })).toEqual([url]);
    });

    it("returns empty array when neither tiles nor url is provided", () => {
        expect(normalizeTilesArray({})).toEqual([]);
        expect(normalizeTilesArray({ label: "No tiles" })).toEqual([]);
    });
});
