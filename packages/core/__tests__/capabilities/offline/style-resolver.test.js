/**
 * Unit tests — StyleResolver (S3 vector offline)
 * Covers: style fetch → vector source/TileJSON resolution → .pbf enumeration,
 *         overzoom maxzoom clamp, glyph fontstack×range enumeration, sprite set.
 */

import { StyleResolver } from "../../../src/capabilities/offline/cache/style-resolver.js";

const STYLE_URL =
    "https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json";
const METADATA_URL = "https://data.geopf.fr/tms/1.0.0/PLAN.IGN/metadata.json";
const TILE_TEMPLATE = "https://data.geopf.fr/tms/1.0.0/PLAN.IGN/{z}/{x}/{y}.pbf";

const STYLE = {
    version: 8,
    sources: {
        plan_ign: { type: "vector", url: METADATA_URL },
    },
    glyphs: "https://data.geopf.fr/annexes/ressources/vectorTiles/fonts/{fontstack}/{range}.pbf",
    sprite: "https://data.geopf.fr/annexes/ressources/vectorTiles/sprites/PLAN.IGN/standard",
    layers: [
        { id: "background", type: "background" },
        { id: "labels", type: "symbol", layout: { "text-font": ["Noto Sans Regular"] } },
        { id: "labels-bold", type: "symbol", layout: { "text-font": ["Noto Sans Bold"] } },
        // Duplicate fontstack — must be de-duplicated.
        { id: "labels-2", type: "symbol", layout: { "text-font": ["Noto Sans Regular"] } },
    ],
};

// Source maxzoom 14 — lower than the requested ceiling, exercising the clamp.
const TILEJSON = { tiles: [TILE_TEMPLATE], maxzoom: 14 };

function jsonResponse(obj) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });
}

describe("StyleResolver", () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn((url) => {
            if (url === STYLE_URL) return jsonResponse(STYLE);
            if (url === METADATA_URL) return jsonResponse(TILEJSON);
            return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    // Small bbox (central Paris), ceiling 16 → must clamp to source maxzoom 14.
    const zone = {
        bounds: { north: 48.861, south: 48.853, east: 2.359, west: 2.341 },
        cacheMinZoom: 12,
        cacheMaxZoom: 16,
    };

    test("includes the style JSON itself", async () => {
        const resources = await StyleResolver.enumerate(STYLE_URL, zone);
        const style = resources.find((r) => r.type === "style");
        expect(style).toBeDefined();
        expect(style.url).toBe(STYLE_URL);
    });

    test("enumerates vector .pbf tiles clamped to the source maxzoom", async () => {
        const resources = await StyleResolver.enumerate(STYLE_URL, zone);
        const tiles = resources.filter((r) => r.type === "tile");

        expect(tiles.length).toBeGreaterThan(0);
        for (const tile of tiles) {
            expect(tile.url.endsWith(".pbf")).toBe(true);
            expect(tile.url.startsWith("https://data.geopf.fr/tms/")).toBe(true);
        }
        // Ceiling was 16 but source maxzoom is 14 → no tile beyond z14, and z14 present.
        const maxZ = Math.max(...tiles.map((t) => t.z));
        const minZ = Math.min(...tiles.map((t) => t.z));
        expect(maxZ).toBe(14);
        expect(minZ).toBe(12);
    });

    test("enumerates glyph ranges per unique fontstack", async () => {
        const resources = await StyleResolver.enumerate(STYLE_URL, zone);
        const glyphs = resources.filter((r) => r.type === "glyph");

        // 2 unique fontstacks × 3 ranges.
        expect(glyphs.length).toBe(2 * StyleResolver.GLYPH_RANGES.length);
        expect(glyphs.every((g) => g.url.endsWith(".pbf"))).toBe(true);
        // Fontstack is URL-encoded; ranges from GLYPH_RANGES.
        expect(glyphs.some((g) => g.url.includes("Noto%20Sans%20Regular/0-255.pbf"))).toBe(true);
        expect(glyphs.some((g) => g.url.includes("Noto%20Sans%20Bold/768-1023.pbf"))).toBe(true);
    });

    test("enumerates sprite .json/.png plus optional @2x variants", async () => {
        const resources = await StyleResolver.enumerate(STYLE_URL, zone);
        const base = STYLE.sprite;
        const byUrl = Object.fromEntries(resources.map((r) => [r.url, r]));

        expect(byUrl[`${base}.json`]?.type).toBe("sprite-json");
        expect(byUrl[`${base}.png`]?.type).toBe("sprite-image");
        expect(byUrl[`${base}@2x.json`]?.optional).toBe(true);
        expect(byUrl[`${base}@2x.png`]?.optional).toBe(true);
    });

    test("without a zone, caches style/glyphs/sprite but no tiles", async () => {
        const resources = await StyleResolver.enumerate(STYLE_URL, null);
        expect(resources.some((r) => r.type === "style")).toBe(true);
        expect(resources.some((r) => r.type === "glyph")).toBe(true);
        expect(resources.filter((r) => r.type === "tile").length).toBe(0);
    });

    test("returns empty when the style cannot be fetched", async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
        const resources = await StyleResolver.enumerate(STYLE_URL, zone);
        expect(resources).toEqual([]);
    });
});
