/**
 * Unit tests — `adapters/maplibre/maplibre-layer-order.ts`, the engine side of
 * `IMapAdapter.setLayerZIndex`: a registered layer changes rank in place.
 *
 * A rank is about ORDER, so these tests run on a map that keeps one — and that moves a layer the
 * way MapLibre does. The shared MapLibre mock's `moveLayer` is a bare spy that ignores the
 * anchor: it can count calls, it cannot tell a layer placed right from one that vanished.
 *
 * Every case marked 🔴 was seen red under the mutation its comment names.
 */

import { describe, expect, it, vi } from "vitest";
import { applyLayerZIndex } from "../../src/adapters/maplibre/maplibre-layer-order.js";
import {
    MaplibreLayerRegistry,
    SENTINEL_POI,
    type SubLayerType,
} from "../../src/adapters/maplibre/maplibre-layer-registry.js";

/**
 * A map that keeps the ORDER of its layers, bottom first.
 *
 * `moveLayer` follows the engine's `Style.moveLayer` (MapLibre 6.7.0) step for step: the layer
 * is taken out of the order BEFORE the anchor is looked up, and a missing anchor returns without
 * putting it back. That is the behaviour the anchor guard exists for.
 */
function makeOrderedMap() {
    const order: string[] = [SENTINEL_POI];
    return {
        order,
        getLayer: vi.fn((id: string) => (order.includes(id) ? { id } : undefined)),
        addLayer: vi.fn((spec: { id: string }, beforeId?: string) => {
            const at = beforeId === undefined ? -1 : order.indexOf(beforeId);
            if (at === -1) order.push(spec.id);
            else order.splice(at, 0, spec.id);
        }),
        moveLayer: vi.fn((id: string, before?: string) => {
            if (!order.includes(id)) return;
            if (id === before) return;
            order.splice(order.indexOf(id), 1);
            const at = before ? order.indexOf(before) : order.length;
            if (before && at === -1) return;
            order.splice(at, 0, id);
        }),
        setLayoutProperty: vi.fn(),
    };
}

type OrderedMap = ReturnType<typeof makeOrderedMap>;

/** The engine map as the module takes it — the double stands in for the three members it calls. */
const engine = (map: OrderedMap) => map as unknown as Parameters<typeof applyLayerZIndex>[0];

/** What the GeoJSON builder does with a rank: anchor from the registry, add, then register. */
function addLayer(
    map: OrderedMap,
    registry: MaplibreLayerRegistry,
    id: string,
    zIndex: number,
    types: SubLayerType[] = ["fill", "line"]
): void {
    const anchor = registry.getInsertBeforeId(zIndex);
    const before = map.getLayer(anchor) ? anchor : undefined;
    for (const type of types) map.addLayer({ id: `gl-${id}-${type}` }, before);
    registry.register(id, types, zIndex);
}

function setup() {
    const map = makeOrderedMap();
    const registry = new MaplibreLayerRegistry();
    const rank = (id: string, zIndex: number) =>
        applyLayerZIndex(engine(map), registry, id, zIndex);
    return { map, registry, rank };
}

describe("applyLayerZIndex — where the layer lands", () => {
    it("goes up under the lowest layer of strictly higher rank", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10);
        addLayer(map, registry, "b", 20);
        addLayer(map, registry, "c", 30);

        expect(rank("a", 25)).toBe(true);

        expect(map.order).toEqual([
            "gl-b-fill",
            "gl-b-line",
            "gl-a-fill",
            "gl-a-line",
            "gl-c-fill",
            "gl-c-line",
            SENTINEL_POI,
        ]);
        expect(registry.get("a")?.zIndex).toBe(25);
    });

    it("goes to the top of the ranked layers, under the sentinel, when nothing ranks above", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10);
        addLayer(map, registry, "b", 20);

        expect(rank("a", 99)).toBe(true);

        expect(map.order).toEqual([
            "gl-b-fill",
            "gl-b-line",
            "gl-a-fill",
            "gl-a-line",
            SENTINEL_POI,
        ]);
    });

    it("lands above the layers already holding the rank it takes", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10, ["fill"]);
        addLayer(map, registry, "b", 20, ["fill"]);
        addLayer(map, registry, "c", 20, ["fill"]);
        addLayer(map, registry, "d", 30, ["fill"]);

        expect(rank("a", 20)).toBe(true);

        expect(map.order).toEqual([
            "gl-b-fill",
            "gl-c-fill",
            "gl-a-fill",
            "gl-d-fill",
            SENTINEL_POI,
        ]);
    });

    // 🔴 The anchor no longer excludes the layer itself: going down with no layer in between,
    // it anchors on its own fill, and the outline ends under it.
    it("keeps the fill under the outline when going down next to its own place", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 50);
        addLayer(map, registry, "b", 60);

        expect(rank("a", 40)).toBe(true);

        expect(map.order).toEqual([
            "gl-a-fill",
            "gl-a-line",
            "gl-b-fill",
            "gl-b-line",
            SENTINEL_POI,
        ]);
    });

    it("goes down under a layer of lower rank than the one it leaves", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10);
        addLayer(map, registry, "b", 20);
        addLayer(map, registry, "c", 30);

        expect(rank("c", 5)).toBe(true);

        expect(map.order).toEqual([
            "gl-c-fill",
            "gl-c-line",
            "gl-a-fill",
            "gl-a-line",
            "gl-b-fill",
            "gl-b-line",
            SENTINEL_POI,
        ]);
    });

    // 🔴 The registry rewrites the rank without re-inserting the entry: the re-ranked layer
    // stays first of its rank while drawn on top of it, and the next insertion anchors on it.
    it("leaves the registry able to place the next insertion", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10, ["fill"]);
        addLayer(map, registry, "b", 30, ["fill"]);

        expect(rank("a", 30)).toBe(true);
        addLayer(map, registry, "c", 20, ["fill"]);

        expect(map.order).toEqual(["gl-c-fill", "gl-b-fill", "gl-a-fill", SENTINEL_POI]);
    });

    it("accepts a fractional rank, and orders by it", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 50.01, ["fill"]);
        addLayer(map, registry, "b", 50.02, ["fill"]);
        addLayer(map, registry, "c", 50.03, ["fill"]);

        expect(rank("a", 50.025)).toBe(true);

        expect(map.order).toEqual(["gl-b-fill", "gl-a-fill", "gl-c-fill", SENTINEL_POI]);
    });
});

describe("applyLayerZIndex — what it keeps", () => {
    // 🔴 A hidden layer is skipped — or shown again — by the move.
    it("re-ranks a hidden layer, and leaves it hidden", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10, ["fill"]);
        addLayer(map, registry, "b", 20, ["fill"]);
        registry.setVisible("a", false);

        expect(rank("a", 30)).toBe(true);

        expect(map.order).toEqual(["gl-b-fill", "gl-a-fill", SENTINEL_POI]);
        expect(registry.get("a")?.visible).toBe(false);
        expect(map.setLayoutProperty).not.toHaveBeenCalled();
    });

    it("moves only the sub-layers the style still holds, and never adds one", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10);
        addLayer(map, registry, "b", 20, ["fill"]);
        map.order.splice(map.order.indexOf("gl-a-line"), 1);

        expect(rank("a", 30)).toBe(true);

        expect(map.order).toEqual(["gl-b-fill", "gl-a-fill", SENTINEL_POI]);
        expect(map.addLayer).toHaveBeenCalledTimes(3);
    });
});

describe("applyLayerZIndex — when it refuses", () => {
    it("refuses an unknown layer", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10);
        const before = [...map.order];

        expect(rank("ghost", 20)).toBe(false);

        expect(map.order).toEqual(before);
        expect(map.moveLayer).not.toHaveBeenCalled();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        "refuses the rank %s, and records nothing",
        (zIndex) => {
            const { map, registry, rank } = setup();
            addLayer(map, registry, "a", 10);
            addLayer(map, registry, "b", 20);

            expect(rank("a", zIndex)).toBe(false);

            expect(map.moveLayer).not.toHaveBeenCalled();
            expect(registry.get("a")?.zIndex).toBe(10);
        }
    );

    // 🔴 The vector-tile refusal is removed: the layer is moved like a GeoJSON one.
    it("refuses a vector-tile layer", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10, ["fill"]);
        map.addLayer({ id: "gl-vt-fill" }, SENTINEL_POI);
        registry.register("vt", ["fill"], 20, { isVectorTile: true, sourceLayer: "x" });
        const before = [...map.order];

        expect(rank("vt", 5)).toBe(false);

        expect(map.order).toEqual(before);
        expect(map.moveLayer).not.toHaveBeenCalled();
        expect(registry.get("vt")?.zIndex).toBe(20);
    });

    it("refuses a layer none of whose sub-layers is in the style", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10, ["fill"]);
        registry.register("gone", ["fill", "line"], 20);

        expect(rank("gone", 5)).toBe(false);

        expect(map.moveLayer).not.toHaveBeenCalled();
        expect(registry.get("gone")?.zIndex).toBe(20);
    });

    // 🔴 The anchor guard is removed: the engine takes the layer out of the order, finds no
    // anchor, and leaves it out.
    it("refuses when the layer it should go under is not in the style — and the layer stays", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10);
        addLayer(map, registry, "b", 20);
        // The anchor's entry is registered, its sub-layers are gone from the style.
        map.order.splice(map.order.indexOf("gl-b-fill"), 2);
        const before = [...map.order];

        expect(rank("a", 15)).toBe(false);

        expect(map.order).toEqual(before);
        expect(map.moveLayer).not.toHaveBeenCalled();
        expect(registry.get("a")?.zIndex).toBe(10);
    });

    it("refuses when the sentinel it should go under is not in the style", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 10, ["fill"]);
        addLayer(map, registry, "b", 20, ["fill"]);
        map.order.splice(map.order.indexOf(SENTINEL_POI), 1);
        const before = [...map.order];

        expect(rank("a", 30)).toBe(false);

        expect(map.order).toEqual(before);
        expect(map.moveLayer).not.toHaveBeenCalled();
        expect(registry.get("a")?.zIndex).toBe(10);
    });
});

describe("applyLayerZIndex — the rank the layer already holds", () => {
    // 🔴 The same-rank shortcut is removed: the engine is called, and the layer is lifted above
    // the layers sharing its rank.
    it("answers true without calling the engine, and does not lift the layer above its equals", () => {
        const { map, registry, rank } = setup();
        addLayer(map, registry, "a", 20, ["fill"]);
        addLayer(map, registry, "b", 20, ["fill"]);
        const before = [...map.order];

        expect(rank("a", 20)).toBe(true);

        expect(map.moveLayer).not.toHaveBeenCalled();
        expect(map.order).toEqual(before);
        expect(registry.getAllLayerIds()).toEqual(["a", "b"]);
    });
});
