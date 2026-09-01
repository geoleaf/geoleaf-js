/**
 * S0 characterization — format fallbacks, since REMOVED.
 *
 * These tests originally pinned two legacy format fallbacks; S3 removed them.
 * They now pin the canonical-only behaviour (the breaking removal landed):
 *   - `sizePx` is no longer aliased to `radius` in `normalizeToFlat()`
 *   - `vectorTiles.url` is no longer honoured; `tilesUrl` is the sole canonical key
 */

import { normalizeToFlat } from "../../src/adapters/maplibre/maplibre-style-converter.js";
import { VectorTiles } from "../../src/capabilities/vector-tiles/vector-tiles.js";

describe("S3 — sizePx → radius alias removed", () => {
    it("no longer maps legacy sizePx to radius (alias removed)", () => {
        expect(normalizeToFlat({ sizePx: 8 }).radius).toBeUndefined();
    });

    it("keeps an explicit radius", () => {
        expect(normalizeToFlat({ sizePx: 8, radius: 3 }).radius).toBe(3);
    });

    it("leaves radius undefined when neither key is present", () => {
        expect(normalizeToFlat({ fillColor: "#fff" }).radius).toBeUndefined();
    });
});

describe("S3 — vectorTiles url fallback removed (tilesUrl canonical)", () => {
    it("honors the canonical tilesUrl key with an absolute URL", () => {
        const def = {
            vectorTiles: { enabled: true, tilesUrl: "https://tiles.example/{z}/{x}/{y}.pbf" },
        };
        expect(VectorTiles.shouldUseVectorTiles(def)).toBe(true);
    });

    it("no longer honors the legacy url key", () => {
        const def = {
            vectorTiles: { enabled: true, url: "https://tiles.example/{z}/{x}/{y}.pbf" },
        };
        expect(VectorTiles.shouldUseVectorTiles(def)).toBe(false);
    });

    it("rejects a relative tile URL (falls back to GeoJSON)", () => {
        const def = { vectorTiles: { enabled: true, tilesUrl: "data/tiles/{z}/{x}/{y}.pbf" } };
        expect(VectorTiles.shouldUseVectorTiles(def)).toBe(false);
    });

    it("rejects when the VT block is disabled", () => {
        const def = {
            vectorTiles: { enabled: false, tilesUrl: "https://tiles.example/{z}/{x}/{y}.pbf" },
        };
        expect(VectorTiles.shouldUseVectorTiles(def)).toBe(false);
    });

    it("rejects when no tilesUrl is configured", () => {
        const def = { vectorTiles: { enabled: true } };
        expect(VectorTiles.shouldUseVectorTiles(def)).toBe(false);
    });
});
