/**
 * @geoleaf-plugins/isochrone — the map binding
 *
 * Held on a fake adapter that keeps a drawing order: what is drawn, with which style, and in
 * which order — through the in-place re-rank and through its fallback, which must stay as
 * right as the main path, or it becomes the only path without anyone seeing it.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
    drawZone,
    eraseZone,
    getMapAdapter,
    rerankZones,
    restyleZone,
    showZone,
} from "../map-binding.js";
import type { IsochroneGeometry, IsochroneLayer } from "../model.js";
import { createFakeMap, type FakeMap } from "./fake-map.js";

const AREA: IsochroneGeometry = {
    type: "Polygon",
    coordinates: [
        [
            [55, -21],
            [56, -21],
            [56, -20],
            [55, -21],
        ],
    ],
};

/**
 * A zone with only what a test names set.
 *
 * @param id Its identifier.
 * @param extra Members to override.
 * @returns The zone.
 */
function zone(id: string, extra: Partial<IsochroneLayer> = {}): IsochroneLayer {
    return {
        id,
        origin: [55.45, -20.88],
        mode: "car",
        minutes: 10,
        color: "#3987e5",
        opacity: 0.25,
        visible: true,
        attribution: "© Test data",
        ...extra,
    };
}

/**
 * Draws zones at the ranks given, bottom first.
 *
 * @param map The fake.
 * @param ranks Pairs of id and rank.
 * @returns The zones by id.
 */
function drawAll(map: FakeMap, ranks: [string, number][]): Map<string, IsochroneLayer> {
    const zones = new Map<string, IsochroneLayer>();
    for (const [id, z] of ranks) {
        const layer = zone(id);
        zones.set(id, layer);
        drawZone(map, layer, AREA, z);
    }
    return zones;
}

const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;
afterEach(() => {
    host.GeoLeaf = previous;
});

describe("getMapAdapter", () => {
    it("answers the mounted map's adapter", () => {
        const map = createFakeMap();
        host.GeoLeaf = { Core: { getMap: () => map } };
        expect(getMapAdapter()).toBe(map);
    });

    it("answers the adapter of a core too old to re-rank in place", () => {
        const map = createFakeMap({ rerank: "absent" });
        host.GeoLeaf = { Core: { getMap: () => map } };
        expect(getMapAdapter()).toBe(map);
    });

    it("answers null with no map, and with an adapter lacking a member this package calls", () => {
        host.GeoLeaf = { Core: { getMap: () => null } };
        expect(getMapAdapter()).toBeNull();
        const partial: Record<string, unknown> = { ...createFakeMap() };
        delete partial.removeMarker;
        host.GeoLeaf = { Core: { getMap: () => partial } };
        expect(getMapAdapter()).toBeNull();
    });
});

describe("drawZone and its style", () => {
    it("draws the zone with its COMPLETE style, its rank and its visibility", () => {
        const map = createFakeMap();
        drawZone(map, zone("a", { color: "#d95926", opacity: 0.4, visible: false }), AREA, 50.01);
        expect(map.layers[0]?.options).toEqual({
            color: "#d95926",
            weight: 2,
            opacity: 1,
            fillColor: "#d95926",
            fillOpacity: 0.4,
            zIndex: 50.01,
            visible: false,
        });
        expect(map.layers[0]?.data).toEqual({
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: { minutes: 10 }, geometry: AREA }],
        });
    });

    it("restyles with the whole style, never a part of it", () => {
        const map = createFakeMap();
        drawZone(map, zone("a"), AREA, 50.01);
        restyleZone(map, zone("a", { opacity: 0.8 }));
        expect(map.layers[0]?.style).toEqual({
            color: "#3987e5",
            weight: 2,
            opacity: 1,
            fillColor: "#3987e5",
            fillOpacity: 0.8,
        });
    });

    it("hides and shows a zone", () => {
        const map = createFakeMap();
        drawZone(map, zone("a"), AREA, 50.01);
        showZone(map, "a", false);
        expect(map.layers[0]?.visible).toBe(false);
        showZone(map, "a", true);
        expect(map.layers[0]?.visible).toBe(true);
    });

    it("erases a zone, and tolerates one already gone", () => {
        const map = createFakeMap();
        drawZone(map, zone("a"), AREA, 50.01);
        eraseZone(map, "a");
        expect(() => eraseZone(map, "a")).not.toThrow();
        expect(map.layers).toEqual([]);
        expect(map.calls.filter((c) => c === "removeLayer")).toHaveLength(1);
    });
});

describe("rerankZones", () => {
    const moves = [
        { id: "c", zIndex: 50.03 },
        { id: "a", zIndex: 50.02 },
        { id: "b", zIndex: 50.01 },
    ];

    it("moves in place, without rebuilding anything", () => {
        const map = createFakeMap();
        const zones = drawAll(map, [
            ["c", 50.01],
            ["b", 50.02],
            ["a", 50.03],
        ]);
        map.calls.length = 0;
        rerankZones(map, moves, (id) => {
            const layer = zones.get(id);
            return layer ? { layer, geometry: AREA } : null;
        });
        expect(map.topFirst()).toEqual(["c", "a", "b"]);
        expect(map.calls).toEqual(["setLayerZIndex", "setLayerZIndex", "setLayerZIndex"]);
    });

    it.each([["absent" as const], ["refuses" as const]])(
        "rebuilds each zone at its rank when re-ranking is %s, keeping its look",
        (rerank) => {
            const map = createFakeMap({ rerank });
            const zones = drawAll(map, [
                ["c", 50.01],
                ["b", 50.02],
                ["a", 50.03],
            ]);
            zones.set("a", zone("a", { visible: false, color: "#199e70" }));
            rerankZones(map, moves, (id) => {
                const layer = zones.get(id);
                return layer ? { layer, geometry: AREA } : null;
            });
            expect(map.topFirst()).toEqual(["c", "a", "b"]);
            const a = map.layers.find((l) => l.id === "a");
            expect(a?.visible).toBe(false);
            expect(a?.style.fillColor).toBe("#199e70");
            expect(a?.data).toMatchObject({ features: [{ geometry: AREA }] });
        }
    );

    it("leaves a zone it cannot find as it is", () => {
        const map = createFakeMap({ rerank: "refuses" });
        drawAll(map, [["a", 50.01]]);
        rerankZones(map, [{ id: "a", zIndex: 50.02 }], () => null);
        expect(map.layers.map((l) => [l.id, l.zIndex])).toEqual([["a", 50.01]]);
    });
});
