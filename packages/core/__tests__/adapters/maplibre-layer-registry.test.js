/**
 * Unit tests for MaplibreLayerRegistry — pure data structure.
 *
 * Covers helper functions, constants, and all registry methods including
 * edge cases (empty registry, duplicate registration, non-existent entries).
 */

import {
    SOURCE_PREFIX,
    LAYER_PREFIX,
    SENTINEL_POI,
    toSourceId,
    toSubLayerId,
    MaplibreLayerRegistry,
} from "../../src/adapters/maplibre/maplibre-layer-registry.js";

// ── Constants ────────────────────────────────────────────────────────────────

describe("Constants", () => {
    it("SOURCE_PREFIX equals 'gl-src-'", () => {
        expect(SOURCE_PREFIX).toBe("gl-src-");
    });

    it("LAYER_PREFIX equals 'gl-'", () => {
        expect(LAYER_PREFIX).toBe("gl-");
    });

    it("SENTINEL_POI equals 'gl-sentinel-poi'", () => {
        expect(SENTINEL_POI).toBe("gl-sentinel-poi");
    });
});

// ── Helper functions ─────────────────────────────────────────────────────────

describe("toSourceId", () => {
    it("prepends SOURCE_PREFIX to the layer ID", () => {
        expect(toSourceId("rivers")).toBe("gl-src-rivers");
    });

    it("handles compound layer IDs", () => {
        expect(toSourceId("my-layer-123")).toBe("gl-src-my-layer-123");
    });
});

describe("toSubLayerId", () => {
    it("builds sub-layer ID for fill type", () => {
        expect(toSubLayerId("rivers", "fill")).toBe("gl-rivers-fill");
    });

    it("builds sub-layer ID for line type", () => {
        expect(toSubLayerId("rivers", "line")).toBe("gl-rivers-line");
    });

    it("builds sub-layer ID for circle type", () => {
        expect(toSubLayerId("poi", "circle")).toBe("gl-poi-circle");
    });

    it("builds sub-layer ID for symbol type", () => {
        expect(toSubLayerId("labels", "symbol")).toBe("gl-labels-symbol");
    });

    it("builds sub-layer ID for casing type", () => {
        expect(toSubLayerId("roads", "casing")).toBe("gl-roads-casing");
    });
});

// Note: allSubLayerIds() was an orphan export removed in b2b2e599
// ("chore(cleanup): B2 — retirer exports orphelins P1"); its tests were left
// behind and are removed here so the suite matches the current API surface.

// ── MaplibreLayerRegistry ────────────────────────────────────────────────────

describe("MaplibreLayerRegistry", () => {
    /** @type {MaplibreLayerRegistry} */
    let registry;

    beforeEach(() => {
        registry = new MaplibreLayerRegistry();
    });

    // ── Empty registry ──────────────────────────────────────────────────────

    describe("empty registry", () => {
        it("has size 0", () => {
            expect(registry.size).toBe(0);
        });

        it("has() returns false for any key", () => {
            expect(registry.has("nonexistent")).toBe(false);
        });

        it("get() returns undefined for any key", () => {
            expect(registry.get("nonexistent")).toBeUndefined();
        });

        it("getSubLayerIds() returns empty array for unknown layer", () => {
            expect(registry.getSubLayerIds("unknown")).toEqual([]);
        });

        it("getSourceId() falls back to toSourceId() for unregistered layer", () => {
            expect(registry.getSourceId("rivers")).toBe("gl-src-rivers");
        });

        it("getAllLayerIds() returns empty array", () => {
            expect(registry.getAllLayerIds()).toEqual([]);
        });

        it("getInsertBeforeId() returns SENTINEL_POI when no entries exist", () => {
            expect(registry.getInsertBeforeId(5)).toBe(SENTINEL_POI);
        });
    });

    // ── register ────────────────────────────────────────────────────────────

    describe("register", () => {
        it("creates an entry with auto-generated source and sub-layer IDs", () => {
            const entry = registry.register("rivers", ["fill", "line"], 10);

            expect(entry.sourceId).toBe("gl-src-rivers");
            expect(entry.subLayerIds).toEqual(["gl-rivers-fill", "gl-rivers-line"]);
            expect(entry.zIndex).toBe(10);
            expect(entry.visible).toBe(true);
            expect(entry.isVectorTile).toBe(false);
            expect(entry.subLayerTypes).toEqual(new Set(["fill", "line"]));
        });

        it("uses customSourceId when provided", () => {
            const entry = registry.register("rivers", ["fill"], 5, {
                customSourceId: "my-custom-source",
            });
            expect(entry.sourceId).toBe("my-custom-source");
        });

        it("uses customSubLayerIds when provided", () => {
            const entry = registry.register("clusters", ["circle", "symbol"], 20, {
                customSubLayerIds: ["cluster-circles", "cluster-labels"],
            });
            expect(entry.subLayerIds).toEqual(["cluster-circles", "cluster-labels"]);
        });

        it("sets isVectorTile and sourceLayer from options", () => {
            const entry = registry.register("mvt-layer", ["fill", "line"], 15, {
                isVectorTile: true,
                sourceLayer: "buildings",
            });
            expect(entry.isVectorTile).toBe(true);
            expect(entry.sourceLayer).toBe("buildings");
        });

        it("overwrites existing entry on duplicate registration", () => {
            registry.register("rivers", ["fill"], 5);
            const entry = registry.register("rivers", ["line", "circle"], 20);

            expect(registry.size).toBe(1);
            expect(entry.subLayerIds).toEqual(["gl-rivers-line", "gl-rivers-circle"]);
            expect(entry.zIndex).toBe(20);
        });

        it("increments size for new layers", () => {
            registry.register("a", ["fill"], 1);
            registry.register("b", ["line"], 2);
            expect(registry.size).toBe(2);
        });
    });

    // ── has / get / query ───────────────────────────────────────────────────

    describe("has / get / query methods", () => {
        beforeEach(() => {
            registry.register("rivers", ["fill", "line"], 10);
            registry.register("roads", ["line", "casing"], 20);
        });

        it("has() returns true for registered layers", () => {
            expect(registry.has("rivers")).toBe(true);
            expect(registry.has("roads")).toBe(true);
        });

        it("get() returns the entry for registered layers", () => {
            const entry = registry.get("rivers");
            expect(entry).toBeDefined();
            expect(entry.sourceId).toBe("gl-src-rivers");
        });

        it("getSubLayerIds() returns sub-layer IDs for registered layers", () => {
            expect(registry.getSubLayerIds("roads")).toEqual(["gl-roads-line", "gl-roads-casing"]);
        });

        it("getSourceId() returns source ID for registered layers", () => {
            expect(registry.getSourceId("rivers")).toBe("gl-src-rivers");
        });

        it("getAllLayerIds() returns all registered IDs", () => {
            const ids = registry.getAllLayerIds();
            expect(ids).toContain("rivers");
            expect(ids).toContain("roads");
            expect(ids).toHaveLength(2);
        });
    });

    // ── unregister ──────────────────────────────────────────────────────────

    describe("unregister", () => {
        it("removes an existing entry and returns true", () => {
            registry.register("rivers", ["fill"], 10);
            expect(registry.unregister("rivers")).toBe(true);
            expect(registry.has("rivers")).toBe(false);
            expect(registry.size).toBe(0);
        });

        it("returns false when unregistering a non-existent layer", () => {
            expect(registry.unregister("nonexistent")).toBe(false);
        });
    });

    // ── setVisible ──────────────────────────────────────────────────────────

    describe("setVisible", () => {
        it("sets visibility to false", () => {
            registry.register("rivers", ["fill"], 10);
            registry.setVisible("rivers", false);
            expect(registry.get("rivers").visible).toBe(false);
        });

        it("sets visibility back to true", () => {
            registry.register("rivers", ["fill"], 10);
            registry.setVisible("rivers", false);
            registry.setVisible("rivers", true);
            expect(registry.get("rivers").visible).toBe(true);
        });

        it("does nothing for a non-existent layer (no error)", () => {
            expect(() => registry.setVisible("ghost", false)).not.toThrow();
        });
    });

    // ── getInsertBeforeId ───────────────────────────────────────────────────

    describe("getInsertBeforeId", () => {
        it("returns first sub-layer of the entry with next-higher zIndex", () => {
            registry.register("bottom", ["fill"], 5);
            registry.register("top", ["line", "circle"], 15);

            // Inserting at zIndex 10 should go before "top" (zIndex 15)
            expect(registry.getInsertBeforeId(10)).toBe("gl-top-line");
        });

        it("returns SENTINEL_POI when no entry has a higher zIndex", () => {
            registry.register("bottom", ["fill"], 5);
            registry.register("top", ["line"], 15);

            expect(registry.getInsertBeforeId(20)).toBe(SENTINEL_POI);
        });

        it("returns SENTINEL_POI when zIndex equals the highest entry", () => {
            registry.register("only", ["fill"], 10);
            expect(registry.getInsertBeforeId(10)).toBe(SENTINEL_POI);
        });

        it("picks the closest higher zIndex, not just any higher", () => {
            registry.register("low", ["fill"], 5);
            registry.register("mid", ["line"], 15);
            registry.register("high", ["circle"], 25);

            // zIndex 10 → should pick "mid" (15), not "high" (25)
            expect(registry.getInsertBeforeId(10)).toBe("gl-mid-line");
        });

        it("leaves the excluded layer out of the search", () => {
            registry.register("moving", ["fill", "line"], 50);
            registry.register("above", ["fill"], 60);

            // Unexcluded, a layer going from 50 to 40 would anchor on its own fill.
            expect(registry.getInsertBeforeId(40)).toBe("gl-moving-fill");
            expect(registry.getInsertBeforeId(40, "moving")).toBe("gl-above-fill");
            expect(registry.getInsertBeforeId(60, "above")).toBe(SENTINEL_POI);
        });
    });

    // ── setZIndex ───────────────────────────────────────────────────────────

    describe("setZIndex", () => {
        it("rewrites the rank of a registered layer, and keeps the rest of its entry", () => {
            registry.register("a", ["fill", "line"], 10, { geometryTypes: new Set(["Polygon"]) });
            registry.setVisible("a", false);
            const entry = registry.get("a");

            expect(registry.setZIndex("a", 42.5)).toBe(true);

            expect(registry.get("a")).toBe(entry);
            expect(entry.zIndex).toBe(42.5);
            expect(entry.visible).toBe(false);
            expect(entry.subLayerIds).toEqual(["gl-a-fill", "gl-a-line"]);
        });

        it("returns false for an unknown layer, and changes nothing", () => {
            registry.register("a", ["fill"], 10);

            expect(registry.setZIndex("ghost", 20)).toBe(false);

            expect(registry.getAllLayerIds()).toEqual(["a"]);
            expect(registry.get("a").zIndex).toBe(10);
        });

        // Seen red with the rank rewritten where the entry stood: `a`, registered first, then
        // answered for rank 30 while drawn above `b`.
        it("moves the entry to the end, so the first entry of a rank stays the bottom of its group", () => {
            registry.register("a", ["fill"], 10);
            registry.register("b", ["fill"], 30);

            registry.setZIndex("a", 30);

            expect(registry.getAllLayerIds()).toEqual(["b", "a"]);
            // A layer inserted at rank 20 goes under the BOTTOM of rank 30, which is `b`.
            expect(registry.getInsertBeforeId(20)).toBe("gl-b-fill");
        });
    });

    // ── clear ───────────────────────────────────────────────────────────────

    describe("clear", () => {
        it("removes all entries", () => {
            registry.register("a", ["fill"], 1);
            registry.register("b", ["line"], 2);
            registry.register("c", ["circle"], 3);

            registry.clear();

            expect(registry.size).toBe(0);
            expect(registry.getAllLayerIds()).toEqual([]);
            expect(registry.has("a")).toBe(false);
        });

        it("is safe to call on an empty registry", () => {
            expect(() => registry.clear()).not.toThrow();
            expect(registry.size).toBe(0);
        });
    });
});
