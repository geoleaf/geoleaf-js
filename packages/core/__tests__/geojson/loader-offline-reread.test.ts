/**
 * THE RE-READ — a displayed layer is given what its offline store holds NOW.
 *
 * A layer declaring `offline.enabled` reads its store once, when it loads
 * (`loader-offline-read.test.js`). A pull rewrites that store afterwards, and nothing told the
 * layer: an entity the server had deleted left the device and stayed drawn until the next page
 * load. `rereadOfflineLayer` is what the pull calls when it ends.
 *
 * What is proven here, through the REAL shared state (its writer announces, and the announcement
 * is part of the subject):
 *
 *   1. a displayed, offline-reading layer → the store is read, the SOURCE and the layer STATE get
 *      the collection, and `geoleaf:layer:updated` leaves once;
 *   2. the collection goes the way a first load takes — symbol ids included;
 *   3. a layer that is not loaded, or does not read offline → nothing is read;
 *   4. a store that answers nothing (no pull ever concluded) → what is drawn stays;
 *   5. a layer removed while the store was being read → nothing is written.
 *
 * ⚠️ The store is reached through `StorageContract.DB`, as the loader does: the CONTRACT is what
 * is mocked, not IndexedDB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    rereadOfflineLayer,
    setupSingleLayerDeps,
} from "../../src/kernel/geojson/loader/single-layer.js";
import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";
import { StorageContract } from "../../src/kernel/shared/index.js";

const LAYER = "sites";

const STORED = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            id: "srv:1",
            geometry: { type: "Point", coordinates: [-60.65, -32.94] },
            properties: { id: "srv:1", title: "Renommée côté serveur" },
        },
    ],
};

const DRAWN = [
    {
        type: "Feature",
        id: "old-1",
        geometry: { type: "Point", coordinates: [1, 1] },
        properties: { id: "old-1", title: "Avant le rapatriement" },
    },
    {
        type: "Feature",
        id: "old-2",
        geometry: { type: "Point", coordinates: [2, 2] },
        properties: { id: "old-2", title: "Supprimée côté serveur" },
    },
];

type Reader = (id: string) => Promise<unknown>;

/** Mounts a minimal storage facade behind the contract. */
function mountStorage(read: Reader | null): void {
    StorageContract.init({ DB: read ? { getLayerFeatureCollection: read } : null } as never);
}

/** Puts a loaded layer in the shared state, as a first load leaves it. */
function loadLayer(config: Record<string, unknown>): void {
    GeoJSONShared.state.layers.set(LAYER, {
        id: LAYER,
        config: { id: LAYER, ...config },
        features: structuredClone(DRAWN),
    } as never);
}

/** The titles the layer state holds. */
function heldTitles(): string[] {
    const features = GeoJSONShared.getLayerById(LAYER)?.features ?? [];
    return features.map((f) => String((f.properties as { title?: unknown })?.title));
}

describe("la relecture d'une couche affichée après un rapatriement", () => {
    const updateLayerData = vi.fn();
    const announced = vi.fn();
    const resolveIcon = vi.fn(() => ({ useIcon: true, symbolId: "poi-musee" }));

    beforeEach(() => {
        updateLayerData.mockClear();
        announced.mockClear();
        resolveIcon.mockClear();
        GeoJSONShared.state.layers = new Map();
        (GeoJSONShared.state as { adapter: unknown }).adapter = { updateLayerData };
        setupSingleLayerDeps({
            getConfig: () => ({ getActiveProfileMapping: () => null }),
            getDataConverter: () => undefined,
            getCore: () => undefined,
            getTaxonomyResolvePoiIcon: () => resolveIcon,
        } as never);
        document.addEventListener("geoleaf:layer:updated", announced);
    });

    afterEach(() => {
        document.removeEventListener("geoleaf:layer:updated", announced);
        mountStorage(null);
    });

    it("🛑 donne à la source ET à l'état ce que le magasin tient, et l'annonce une fois", async () => {
        loadLayer({ offline: { enabled: true } });
        const read = vi.fn<Reader>().mockResolvedValue(structuredClone(STORED));
        mountStorage(read);

        expect(await rereadOfflineLayer(LAYER)).toBe(true);

        expect(read).toHaveBeenCalledWith(LAYER);
        expect(updateLayerData).toHaveBeenCalledTimes(1);
        const [id, pushed] = updateLayerData.mock.calls[0] ?? [];
        expect(id).toBe(LAYER);
        expect((pushed as typeof STORED).features.map((f) => f.properties.title)).toEqual([
            "Renommée côté serveur",
        ]);
        expect(heldTitles()).toEqual(["Renommée côté serveur"]);
        expect(announced).toHaveBeenCalledTimes(1);
        expect((announced.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ layerId: LAYER });
    });

    it("prépare la collection comme un premier chargement — l'identifiant de symbole y est", async () => {
        loadLayer({ offline: { enabled: true }, showIconsOnMap: true });
        mountStorage(vi.fn<Reader>().mockResolvedValue(structuredClone(STORED)));

        expect(await rereadOfflineLayer(LAYER)).toBe(true);

        expect(resolveIcon).toHaveBeenCalled();
        const pushed = updateLayerData.mock.calls[0]?.[1] as typeof STORED;
        expect((pushed.features[0]?.properties as Record<string, unknown>)["symbolId"]).toBe(
            "poi-musee"
        );
    });

    it("ne lit rien pour une couche qui n'est pas chargée", async () => {
        const read = vi.fn<Reader>().mockResolvedValue(structuredClone(STORED));
        mountStorage(read);

        expect(await rereadOfflineLayer(LAYER)).toBe(false);

        expect(read).not.toHaveBeenCalled();
        expect(updateLayerData).not.toHaveBeenCalled();
    });

    it("🛑 ne lit rien pour une couche qui ne DÉCLARE pas la lecture locale", async () => {
        loadLayer({});
        const read = vi.fn<Reader>().mockResolvedValue(structuredClone(STORED));
        mountStorage(read);

        expect(await rereadOfflineLayer(LAYER)).toBe(false);

        expect(read).not.toHaveBeenCalled();
        expect(heldTitles()).toEqual(["Avant le rapatriement", "Supprimée côté serveur"]);
    });

    it("garde ce qui est dessiné quand le magasin ne répond rien", async () => {
        loadLayer({ offline: { enabled: true } });
        mountStorage(vi.fn<Reader>().mockResolvedValue(null));

        expect(await rereadOfflineLayer(LAYER)).toBe(false);

        expect(updateLayerData).not.toHaveBeenCalled();
        expect(announced).not.toHaveBeenCalled();
        expect(heldTitles()).toEqual(["Avant le rapatriement", "Supprimée côté serveur"]);
    });

    it("une collection VIDE est une réponse : la couche est vidée", async () => {
        loadLayer({ offline: { enabled: true } });
        mountStorage(
            vi.fn<Reader>().mockResolvedValue({ type: "FeatureCollection", features: [] })
        );

        expect(await rereadOfflineLayer(LAYER)).toBe(true);

        expect(heldTitles()).toEqual([]);
    });

    it("🛑 garde le liseré « en attente » d'une entité encore due — il n'est pas au magasin", async () => {
        // The badge is baked on the LAYER's copy (`_syncStatus`), by whoever knows the queue. The
        // store's collection carries none: fed as read, every entity still owed to the server
        // would stop saying so at the first pull.
        loadLayer({ offline: { enabled: true } });
        const entry = GeoJSONShared.getLayerById(LAYER);
        if (!entry) throw new Error("la couche du test n'est pas chargée");
        entry.features = [
            {
                type: "Feature",
                id: "loc:7",
                geometry: { type: "Point", coordinates: [3, 3] },
                properties: { id: "loc:7", title: "Saisie en attente", _syncStatus: "pending" },
            },
            {
                type: "Feature",
                geometry: { type: "Point", coordinates: [4, 4] },
                // Named by its property alone, as a network-loaded entity may be.
                properties: { id: "srv:9", title: "Modifiée en attente", _syncStatus: "pending" },
            },
            {
                type: "Feature",
                id: "srv:4",
                geometry: { type: "Point", coordinates: [5, 5] },
                properties: { id: "srv:4", title: "Partie du serveur", _syncStatus: "pending" },
            },
        ] as never;
        const plain = (id: string, title: string) => ({
            type: "Feature",
            id,
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id, title },
        });
        mountStorage(
            vi.fn<Reader>().mockResolvedValue({
                type: "FeatureCollection",
                features: [
                    plain("loc:7", "Saisie en attente"),
                    plain("srv:9", "Modifiée en attente"),
                    plain("srv:1", "Jamais touchée"),
                ],
            })
        );

        expect(await rereadOfflineLayer(LAYER)).toBe(true);

        const badges = Object.fromEntries(
            (GeoJSONShared.getLayerById(LAYER)?.features ?? []).map((f) => {
                const props = f.properties as Record<string, unknown>;
                return [String(props["id"]), props["_syncStatus"] ?? null];
            })
        );
        // `srv:4` left with the store's answer, and its badge with it.
        expect(badges).toEqual({ "loc:7": "pending", "srv:9": "pending", "srv:1": null });
    });

    it("n'écrit rien si la couche a été retirée pendant la lecture", async () => {
        loadLayer({ offline: { enabled: true } });
        mountStorage(
            vi.fn<Reader>().mockImplementation(async () => {
                GeoJSONShared.state.layers.delete(LAYER);
                return structuredClone(STORED);
            })
        );

        expect(await rereadOfflineLayer(LAYER)).toBe(false);

        expect(updateLayerData).not.toHaveBeenCalled();
        expect(announced).not.toHaveBeenCalled();
    });
});
