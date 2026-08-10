/*!
 * Tests — tâche 5.1-e : l'export de la session
 *
 * ⚠️ Le double de `Layers` REPRODUIT la contrainte : une couche déclarée mais jamais chargée
 * **jette** au lieu de rendre `[]` — c'est ce que fait le core, et l'export ne doit pas devenir
 * aveugle sur les autres couches à cause d'une seule.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const _download = vi.fn();
vi.mock("@geoleaf/host-runtime", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    downloadBlob: (b: Blob, n: string) => _download(b, n),
}));

const {
    trackSessionFeature,
    renameSessionFeature,
    sessionFeatureCount,
    resetSessionTracking,
    collectSessionFeatures,
    exportSessionFeatures,
} = await import("../persistence/session-export.js");

function mountLayers(map: Record<string, unknown[]>, throwing: string[] = []) {
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Layers: {
            listLayerIds: () => [...Object.keys(map), ...throwing],
            getFeatures: (id: string) => {
                if (throwing.includes(id)) throw new Error("layer not loaded");
                return map[id] ?? [];
            },
        },
    };
}

function feat(id: string, props: Record<string, unknown> = {}) {
    return { id, geometry: { type: "Point", coordinates: [1, 2] }, properties: props };
}

beforeEach(() => {
    resetSessionTracking();
    _download.mockReset();
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
});

// --- le suivi --------------------------------------------------------------------

describe("Le suivi de session", () => {
    it("compte les entités créées", () => {
        trackSessionFeature("a");
        trackSessionFeature("b");
        expect(sessionFeatureCount()).toBe(2);
    });

    it("ne compte pas deux fois le même identifiant", () => {
        trackSessionFeature("a");
        trackSessionFeature("a");
        expect(sessionFeatureCount()).toBe(1);
    });

    it("ignore un identifiant vide", () => {
        trackSessionFeature("");
        expect(sessionFeatureCount()).toBe(0);
    });

    it("🛑 la réconciliation d'identifiant garde l'entité DANS l'export", () => {
        // Sans elle, une entité créée hors réseau puis synchronisée serait suivie sous son
        // identifiant local — que la couche hôte ne porte plus. Elle sortirait de l'export
        // en silence, au moment précis où l'utilisateur veut la récupérer.
        trackSessionFeature("local-1");
        renameSessionFeature("local-1", "srv-42");
        expect(sessionFeatureCount()).toBe(1);

        mountLayers({ l1: [feat("srv-42"), feat("autre")] });
        expect(collectSessionFeatures().map((f) => f.id)).toEqual(["srv-42"]);
    });

    it("une réconciliation d'un identifiant non suivi ne crée rien", () => {
        renameSessionFeature("jamais-vu", "srv-1");
        expect(sessionFeatureCount()).toBe(0);
    });
});

// --- la collecte -----------------------------------------------------------------

describe("collectSessionFeatures — ce qui part dans le fichier", () => {
    it("ne retient QUE les entités de la session", () => {
        trackSessionFeature("a");
        mountLayers({ l1: [feat("a"), feat("b")], l2: [feat("c")] });
        expect(collectSessionFeatures().map((f) => f.id)).toEqual(["a"]);
    });

    it("balaie TOUTES les couches", () => {
        trackSessionFeature("a");
        trackSessionFeature("c");
        mountLayers({ l1: [feat("a")], l2: [feat("c")] });
        expect(collectSessionFeatures()).toHaveLength(2);
    });

    it("🛑 RETIRE les propriétés internes", () => {
        trackSessionFeature("a");
        mountLayers({
            l1: [feat("a", { titre: "Poste 12", _layerConfig: {}, _syncStatus: "pending" })],
        });
        const props = collectSessionFeatures()[0].properties as Record<string, unknown>;
        expect(props).toEqual({ titre: "Poste 12" });
    });

    it("se rabat sur properties.id quand l'entité n'a pas d'id propre", () => {
        trackSessionFeature("p-7");
        mountLayers({ l1: [{ geometry: {}, properties: { id: "p-7" } }] });
        expect(collectSessionFeatures()).toHaveLength(1);
    });

    it("🛑 une couche ILLISIBLE n'aveugle pas les autres", () => {
        trackSessionFeature("a");
        mountLayers({ l1: [feat("a")] }, ["jamais-chargee"]);
        expect(collectSessionFeatures().map((f) => f.id)).toEqual(["a"]);
    });

    it("rend une liste vide sans seam Layers", () => {
        trackSessionFeature("a");
        (globalThis as Record<string, unknown>).GeoLeaf = {};
        expect(collectSessionFeatures()).toEqual([]);
    });
});

// --- le téléchargement -----------------------------------------------------------

describe("exportSessionFeatures — le fichier", () => {
    it("télécharge un GeoJSON nommé et rend le décompte", async () => {
        trackSessionFeature("a");
        mountLayers({ l1: [feat("a", { titre: "X" })] });

        await expect(exportSessionFeatures()).resolves.toBe(1);
        expect(_download).toHaveBeenCalledTimes(1);
        const [blob, name] = _download.mock.calls[0] as [Blob, string];
        expect(name).toMatch(/^geoleaf-session-\d{4}-\d{2}-\d{2}\.geojson$/);
        expect(blob.type).toBe("application/geo+json");
        const parsed = JSON.parse(await blob.text()) as {
            type: string;
            features: { id: string }[];
        };
        expect(parsed.type).toBe("FeatureCollection");
        expect(parsed.features.map((f) => f.id)).toEqual(["a"]);
    });

    it("🛑 NE TÉLÉCHARGE RIEN quand la session est vide — pas un fichier à zéro entité", async () => {
        mountLayers({ l1: [feat("a")] });
        await expect(exportSessionFeatures()).resolves.toBe(0);
        expect(_download).not.toHaveBeenCalled();
    });

    it("resetSessionTracking vide le suivi", async () => {
        trackSessionFeature("a");
        mountLayers({ l1: [feat("a")] });
        resetSessionTracking();
        await expect(exportSessionFeatures()).resolves.toBe(0);
    });
});
