/**
 * Unit tests — `GeoLeaf.Layers.search`: finding a feature by its reference in the layers the
 * map holds, with no network.
 *
 * What the search reads is the in-memory layer store — the collection each layer's source was
 * last fed — and nothing else. A layer the loader read from the device store is in it; a
 * layer never loaded is not, and is not found (named in the contract, not guessed here).
 *
 * 🛑 THE FRESHNESS CASES ARE THE POINT OF THIS FILE. The search keeps a normalized index per
 * layer, so that a keystroke over 30 000 features does not re-normalize 30 000 strings. An
 * index is a second copy of the data, and a second copy goes stale the moment one writer
 * forgets it. Each write path the store knows is therefore played here — whole collection,
 * unit mutation, and the SILENT property patch that bypasses both — and the search must see
 * each one at once. A stale index would find a feature under its old name, or miss it under
 * its new one, and nothing else in the suite would notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayerDataApi } from "../../src/contracts/layer-data.contract.js";

const { buildLayersPublicApi } = await import("../../src/kernel/geojson/layers-public-api.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");

let api: LayerDataApi;

/** A point feature carrying its id on `properties.id`, as the loader leaves it. */
function pt(id: string, lng: number, lat: number, props: Record<string, unknown> = {}) {
    return {
        type: "Feature" as const,
        id,
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
        properties: { id, ...props },
    };
}

/** Seeds a layer through the production write path, with the given layer config. */
function seed(layerId: string, config: Record<string, unknown>, features: GeoJSON.Feature[]) {
    GeoJSONShared.state.layers.set(layerId, {
        id: layerId,
        label: `Label ${layerId}`,
        config: config as never,
        geometryType: "point",
    });
    api.setData(layerId, features);
}

beforeEach(() => {
    GeoJSONShared.reset();
    GeoJSONShared.state.adapter = {
        updateLayerData: vi.fn(),
        applyDataDiff: vi.fn(() => true),
        setFeatureState: vi.fn(),
        setLayerFilter: vi.fn(),
    } as never;
    api = buildLayersPublicApi();
});

afterEach(() => {
    GeoJSONShared.reset();
    vi.restoreAllMocks();
});

describe("what is searched", () => {
    it("finds a feature by its exact id, first, before the ones that merely contain it", () => {
        seed("assets", { searchable: { fields: ["name"] } }, [
            pt("PT-44720", 1, 1, { name: "Autre" }),
            pt("PT-4472", 2, 2, { name: "Pompe" }),
            pt("X-1", 3, 3, { name: "voir PT-4472" }),
        ]);
        const hits = api.search("PT-4472");
        expect(hits[0]).toMatchObject({ layerId: "assets", featureId: "PT-4472" });
        expect(hits.map((h) => h.featureId)).toEqual(["PT-4472", "PT-44720", "X-1"]);
    });

    it("ignores accents, case and word order, with the filter's own rule", () => {
        seed("sites", { searchable: { fields: ["name"] } }, [
            pt("s1", 0, 0, { name: "Le Récif — Saint-Gilles" }),
            pt("s2", 0, 0, { name: "Le Port" }),
        ]);
        expect(api.search("gilles RECIF").map((h) => h.featureId)).toEqual(["s1"]);
    });

    it("searches only the layers that declare `searchable`, and only their declared fields", () => {
        seed("declared", { searchable: { fields: ["ref"] } }, [
            pt("a", 0, 0, { ref: "R-1", note: "cachée" }),
        ]);
        seed("silent", {}, [pt("b", 0, 0, { ref: "R-1" })]);
        expect(api.search("R-1").map((h) => h.layerId)).toEqual(["declared"]);
        expect(api.search("cachée")).toEqual([]);
    });

    it("reads a field under `properties` whether it is written bare or dotted", () => {
        seed("bare", { searchable: { fields: ["ref"] } }, [pt("a", 0, 0, { ref: "Q-7" })]);
        seed("dotted", { searchable: { fields: ["properties.ref"] } }, [
            pt("b", 0, 0, { ref: "Q-7" }),
        ]);
        expect(
            api
                .search("q-7")
                .map((h) => h.layerId)
                .sort()
        ).toEqual(["bare", "dotted"]);
    });

    it("returns nothing for a blank query, and honours `limit` and `layerIds`", () => {
        seed(
            "many",
            { searchable: { fields: ["name"] } },
            Array.from({ length: 30 }, (_, i) => pt(`m${i}`, 0, 0, { name: `borne ${i}` }))
        );
        seed("other", { searchable: { fields: ["name"] } }, [pt("o", 0, 0, { name: "borne" })]);
        expect(api.search("   ")).toEqual([]);
        expect(api.search("borne", { limit: 4 })).toHaveLength(4);
        expect(api.search("borne", { layerIds: ["other"] }).map((h) => h.featureId)).toEqual(["o"]);
    });
});

describe("what a match carries", () => {
    it("is a geocoding-shaped result — label, lat, lng — plus the feature's identity", () => {
        seed("assets", { searchable: { fields: ["ref", "name"] } }, [
            pt("a1", 5.5, 45.25, { ref: "PT-1", name: "Pompe" }),
        ]);
        const [hit] = api.search("pt-1");
        expect(hit).toEqual({
            label: "PT-1",
            lat: 45.25,
            lng: 5.5,
            layerId: "assets",
            layerLabel: "Label assets",
            featureId: "a1",
        });
    });

    it("gives a line or a polygon its bounds, so the view can frame it", () => {
        GeoJSONShared.state.layers.set("zones", {
            id: "zones",
            config: { searchable: { fields: ["name"] } } as never,
            geometryType: "polygon",
        });
        api.setData("zones", [
            {
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [1, 2],
                            [3, 2],
                            [3, 6],
                            [1, 6],
                            [1, 2],
                        ],
                    ],
                },
                properties: { id: "z1", name: "Secteur nord" },
            },
        ]);
        const [hit] = api.search("secteur");
        expect(hit?.bounds).toEqual({ north: 6, south: 2, east: 3, west: 1 });
        expect(hit?.lat).toBe(4);
        expect(hit?.lng).toBe(2);
    });

    it("finds a feature with no id, and says it has none rather than inventing one", () => {
        seed("anon", { searchable: { fields: ["name"] } }, [
            {
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "Sans identifiant" },
            },
        ]);
        expect(api.search("identifiant")[0]?.featureId).toBeNull();
    });
});

describe("freshness — the search sees every write at once", () => {
    const CFG = { searchable: { fields: ["name"] } };

    it("after a whole-collection write", () => {
        seed("l", CFG, [pt("a", 0, 0, { name: "ancien" })]);
        expect(api.search("ancien")).toHaveLength(1);
        api.setData("l", [pt("a", 0, 0, { name: "nouveau" })]);
        expect(api.search("ancien")).toEqual([]);
        expect(api.search("nouveau")).toHaveLength(1);
    });

    it("after a unit addition and a unit removal", () => {
        seed("l", CFG, [pt("a", 0, 0, { name: "alpha" })]);
        expect(api.search("beta")).toEqual([]);
        api.addFeature("l", pt("b", 0, 0, { name: "beta" }));
        expect(api.search("beta")).toHaveLength(1);
        api.removeFeature("l", "a");
        expect(api.search("alpha")).toEqual([]);
    });

    it("after a SILENT property patch, which rebuilds nothing", () => {
        seed("l", CFG, [pt("a", 0, 0, { name: "avant" })]);
        expect(api.search("avant")).toHaveLength(1);
        api.patchFeature("l", "a", { name: "apres" });
        expect(api.search("avant")).toEqual([]);
        expect(api.search("apres")).toHaveLength(1);
    });

    it("after a feature is re-keyed in place — same array, same length", () => {
        seed("l", CFG, [pt("tmp-1", 0, 0, { name: "saisie" })]);
        // Built BEFORE the write: an index first built after it would prove nothing.
        expect(api.search("tmp-1")[0]?.featureId).toBe("tmp-1");
        api.updateFeatureId("l", "tmp-1", "srv-9");
        expect(api.search("tmp-1")).toEqual([]);
        expect(api.search("srv-9")[0]?.featureId).toBe("srv-9");
    });

    it("after a re-rendered patch, which reaches the source as a diff", () => {
        seed("l", CFG, [pt("a", 0, 0, { name: "avant" })]);
        expect(api.search("avant")).toHaveLength(1);
        api.patchFeature("l", "a", { name: "apres" }, { rerender: true });
        expect(api.search("avant")).toEqual([]);
        expect(api.search("apres")).toHaveLength(1);
    });

    it("after a whole-collection write of the SAME array, edited in place", () => {
        // A feature addressable by its top-level `id` but carrying no `properties.id` cannot
        // be diffed: a re-rendered patch re-feeds the store's own array, same reference,
        // same length. Only the store's writer can tell the index it changed.
        seed("l", CFG, [
            {
                type: "Feature",
                id: "a",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "avant" },
            },
        ]);
        expect(api.search("avant")).toHaveLength(1);
        api.patchFeature("l", "a", { name: "apres" }, { rerender: true });
        expect(api.search("avant")).toEqual([]);
        expect(api.search("apres")).toHaveLength(1);
    });
});
