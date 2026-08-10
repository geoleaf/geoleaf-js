/**
 * GARDE B-152 — une couche à `inlineConfig` doit valoir une couche à `configFile`.
 *
 * 🛑 CE QUE CETTE GARDE EXISTE POUR EMPÊCHER. La tâche 8.9 a réparé le RAPATRIEMENT des
 * couches templatées : `resolveProfileLayers` passe par `expandLayerTemplates`, et
 * `resource-enumerator` a gagné sa branche `inlineConfig`. Mais `expandLayerTemplates` pose
 * `inlineConfig` et **jamais `configFile`**, alors que les trois sites du sélecteur
 * branchaient tous sur `configFile` seul. Mesuré en navigateur sur `tourism` le 07/08/2026 :
 * les 42 couches apparaissaient bien, mais les **24 templatées** s'y rendaient en identifiant
 * brut, géométrie `-`, style `-`, sans sélecteur de style — et leur état de cache était
 * **toujours faux**, parce que `searchUrls` restait vide.
 *
 * ⚠️ ANCRÉE SUR LE MÉCANISME, PAS SUR `tourism`. Aucune assertion ne cite `pluviometrie_*`
 * ni le profil de démo : la propriété gardée est « porter sa config en ligne plutôt qu'en
 * fichier ne change RIEN à ce que le sélecteur sait faire de la couche ». Un test qui
 * nommerait les 24 couches se périmerait au premier profil réécrit (c'est B-154), et
 * n'affirmerait rien du mécanisme.
 *
 * ⚠️ CHAQUE ASSERTION A SON TÉMOIN DIRECT. Les deux couches sont déclarées avec la MÊME
 * config utile — l'une par fichier, l'autre en ligne. Sans ce témoin, la garde passerait
 * en rendant `null` des deux côtés : c'est exactement l'état d'avant le correctif.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { LS } from "../cache/layer-selector/core.js";
import "../cache/layer-selector/data-fetching.js";
import "../cache/layer-selector/row-rendering.js";
import "../cache/layer-selector/selection-cache.js";
import { getLayerConfig, beginCacheStatusPass } from "../cache/layer-selector/config-cache.js";
import type { LayerLike } from "../cache/layer-selector/layer-selector-types.js";

// La config utile, IDENTIQUE des deux côtés — c'est ce qui rend la comparaison probante.
const SHARED_CONFIG = {
    label: "Pluviométrie – Janvier",
    geometryType: "Polygon",
    styles: { available: [{ id: "defaut", label: "Défaut" }], default: "defaut" },
};

/** Couche TÉMOIN : sa config vit dans un fichier, comme les 18 couches directes. */
const DIRECT_LAYER: LayerLike = {
    id: "direct_layer",
    configFile: "layers/direct_layer/direct_layer_config.json",
};

/**
 * Couche SUJET de B-161 : elle déclare `geometry` **seul**, la forme majoritaire du dépôt
 * (18 configs sur 24 ; **aucune** ne déclare `geometryType` seul). Le schéma pose les deux
 * comme alias — `layer-config.schema.json:42` : « Root-level alias of `geometry` ».
 */
const ALIAS_LAYER: LayerLike = {
    id: "alias_layer",
    configFile: "layers/alias_layer/alias_layer_config.json",
};
const ALIAS_CONFIG = {
    label: "Couche à clé alias",
    geometry: "point", // ← et PAS `geometryType` ; différente du témoin, exprès
    styles: { available: [{ id: "defaut", label: "Défaut" }], default: "defaut" },
};

/**
 * Le fichier de couches servi au sélecteur — DIRECTE + alias + un `layerTemplates`.
 *
 * ⚠️ LA COUCHE TEMPLATÉE N'EST PAS ÉCRITE À LA MAIN, ET C'EST LE POINT LE PLUS IMPORTANT DE
 * CE HARNAIS. Une première version de cette garde posait un `inlineConfig` en dur ; elle
 * serait restée VERTE si le core cessait de normaliser `dataFile`, puisque le fixture
 * portait déjà la forme normalisée. Ici c'est le VRAI `expandLayerTemplates` qui la produit,
 * appelé par le vrai `resolveProfileLayers` que `populate()` emprunte : la garde tient donc
 * les deux moitiés du seam — ce que le core émet, et ce que le plugin en fait.
 */
const LAYERS_FILE = {
    layers: [DIRECT_LAYER, ALIAS_LAYER],
    layerTemplates: [
        {
            templateId: "pluvio",
            layerManagerId: "geojson-default",
            template: { ...SHARED_CONFIG, data: { directory: "data" } },
            instances: [
                {
                    id: "templated_layer",
                    label: SHARED_CONFIG.label,
                    dataFile: "templated_layer.geojson",
                },
            ],
        },
    ],
};

/** Le profil ne porte PAS `layers` : il pointe son fichier, comme les profils réels. */
const PROFILE = { Files: { layersFile: "config/core/layers.json" } };

/** Le chemin que `resource-enumerator` met RÉELLEMENT en cache pour une couche en ligne. */
const CACHED_URL = (profileId: string): string =>
    `profiles/${profileId}/layers/templated_layer/data/templated_layer.geojson`;

let CONFIG: Record<string, unknown> = {};
let container: HTMLElement;
let seq = 0;
let profileId = "";

function setConfig(overrides: Record<string, unknown> = {}): void {
    CONFIG = {
        "data.profilesBasePath": "profiles",
        "data.activeProfile": profileId,
        "modules.offline.cache.enableProfileCache": true,
        "modules.offline.cache.enableTileCache": true,
        basemaps: {},
        ...overrides,
    };
    const g = globalThis as unknown as { GeoLeaf?: Record<string, unknown> };
    g.GeoLeaf = g.GeoLeaf ?? {};
    g.GeoLeaf["Config"] = {
        get: (key: string, fallback: unknown) => (key in CONFIG ? CONFIG[key] : fallback),
    };
}

function installStorage(cacheResources: Array<{ url: string }> = []): void {
    const g = globalThis as unknown as { GeoLeaf?: Record<string, unknown> };
    g.GeoLeaf = g.GeoLeaf ?? {};
    g.GeoLeaf["Storage"] = {
        isPluginLoaded: () => true,
        isAvailable: () => true,
        Cache: {
            Storage: {
                loadLayerSelection: vi.fn(async () => null),
                saveLayerSelection: vi.fn(async () => {}),
            },
        },
        CacheManager: { getCacheStatus: vi.fn(async () => ({ resources: cacheResources })) },
    };
}

/** profile.json → pointeur · layers.json → directe + template · config → SHARED · HEAD → taille. */
function installFetch(): void {
    globalThis.fetch = vi.fn(async (url: unknown, opts?: { method?: string }) => {
        if ((opts?.method ?? "GET") === "HEAD") {
            return {
                ok: true,
                headers: { get: (h: string) => (h === "content-length" ? "1024" : null) },
            };
        }
        const u = String(url);
        if (u.endsWith("profile.json")) {
            return { ok: true, status: 200, json: async () => PROFILE };
        }
        if (u.endsWith("config/core/layers.json")) {
            return { ok: true, status: 200, json: async () => LAYERS_FILE };
        }
        if (u.includes("alias_layer")) {
            return { ok: true, status: 200, json: async () => ({ ...ALIAS_CONFIG }) };
        }
        return { ok: true, status: 200, json: async () => ({ ...SHARED_CONFIG }) };
    }) as unknown as typeof fetch;
}

/** La couche templatée telle que le CORE la produit — jamais construite ici. */
async function templatedLayerFromCore(): Promise<LayerLike> {
    await LS.populate();
    await flush();
    const found = LS._layers.find((l) => l.id === "templated_layer");
    expect(found).toBeDefined();
    return found as LayerLike;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(() => r(), 0));

beforeEach(() => {
    seq += 1;
    // Profil distinct par test : `_configCache` est un memo de MODULE, il survit au test.
    profileId = `guard-b152-${seq}`;
    setConfig();
    beginCacheStatusPass();
    installStorage();
    installFetch();

    container = document.createElement("div");
    document.body.appendChild(container);
    LS._layers = [];
    LS._basemaps = [];
    LS._eventListeners = [];
    LS._selectAllCheckbox = null;
    LS.init({}, container);
});

afterEach(() => {
    container?.remove();
    document.getElementById("gl-cache-warning")?.remove();
    document.getElementById("gl-cache-download")?.remove();
    vi.restoreAllMocks();
});

describe("B-152 — site 1 : la config d'une couche en ligne est RÉSOLUE", () => {
    test("getLayerConfig rend la config d'une couche `inlineConfig`, comme pour un `configFile`", async () => {
        const layer = await templatedLayerFromCore();

        // Témoin : le chemin `configFile` marche, donc un `null` côté sujet est bien un défaut
        // du sujet et non du harnais.
        const direct = await getLayerConfig({ ...DIRECT_LAYER });
        expect(direct?.label).toBe(SHARED_CONFIG.label);

        const templated = await getLayerConfig(layer);
        expect(templated).not.toBeNull();
        expect(templated?.label).toBe(SHARED_CONFIG.label);
        expect(templated?.geometryType).toBe(SHARED_CONFIG.geometryType);
        expect(templated?.styles?.available).toHaveLength(1);
    });

    test("elle est résolue SANS requête réseau — la config est déjà en mémoire", async () => {
        const layer = await templatedLayerFromCore();
        const calls = (): number =>
            (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

        const before = calls();
        await getLayerConfig(layer);
        expect(calls()).toBe(before);
    });
});

describe("B-152 — site 2 : `layerDir` et `dataFile` sont DÉRIVÉS", () => {
    test("populate() dérive les deux champs sur une couche en ligne", async () => {
        const templated = await templatedLayerFromCore();
        // La convention du core : `layers/<id>` (`resource-enumerator._addInlineConfigResource`).
        expect(templated.layerDir).toBe("layers/templated_layer");
        // Normalisé par `expandLayerTemplates` via `layerDataPath` — pas dérivé ici.
        expect(templated.dataFile).toBe("data/templated_layer.geojson");
    });

    test("la ligne rendue porte le libellé HUMAIN, pas l'identifiant technique", async () => {
        await LS.populate();
        await flush();

        const rows = [...container.querySelectorAll("tbody tr")];
        expect(rows).toHaveLength(3);

        const cellsOf = (tr: Element): string[] =>
            [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim());

        // Les lignes sortent dans l'ordre de `LS._layers` — c'est la même boucle.
        const idx = (id: string): number => LS._layers.findIndex((l) => l.id === id);
        const directCells = cellsOf(rows[idx("direct_layer")]!);
        const templatedCells = cellsOf(rows[idx("templated_layer")]!);
        expect(templatedCells[1]).toBe(SHARED_CONFIG.label);
        expect(templatedCells[1]).toBe(directCells[1]);
        expect(templatedCells[1]).not.toBe("templated_layer");
    });

    test("la ligne d'une couche en ligne porte un sélecteur de style, comme la directe", async () => {
        await LS.populate();
        await flush();

        const selects = [...container.querySelectorAll("tbody tr")].map(
            (tr) => tr.querySelector("select") !== null
        );
        expect(selects).toEqual([true, true, true]);
    });
});

describe("B-152 — site 3 : l'état de cache est OBSERVABLE", () => {
    test("isLayerCached reconnaît l'URL que le core met réellement en cache", async () => {
        // Le manifeste porte exactement ce que `resource-enumerator` écrit pour une couche
        // en ligne — pas une URL fabriquée pour l'occasion.
        installStorage([{ url: CACHED_URL(profileId) }]);
        beginCacheStatusPass();

        const templated = await templatedLayerFromCore();
        await expect(LS.isLayerCached(templated)).resolves.toBe(true);
    });

    test("et il reste FAUX quand rien n'est en cache — la garde ne rend pas `true` par défaut", async () => {
        installStorage([]);
        beginCacheStatusPass();

        const templated = await templatedLayerFromCore();
        await expect(LS.isLayerCached(templated)).resolves.toBe(false);
    });
});

describe("B-161 — la géométrie se lit sur `geometry` COMME sur `geometryType`", () => {
    /**
     * 🛑 Le schéma pose les deux comme le MÊME champ — `layer-config.schema.json:42` :
     * « Root-level alias of `geometry`. Canonical form READ BY THE CODE (…) — do NOT migrate
     * (ANO-007) ». Le code lisait pourtant `geometryType` **seul**, la clé que **0 config sur
     * 24** déclare sans l'autre, pendant que **18** ne déclarent que `geometry`. Mesuré en
     * navigateur : 38 des 42 lignes du sélecteur de `tourism` rendaient `-`, dont 14 couches
     * DIRECTES — c'est cette symétrie qui prouve que la cause n'est pas l'`inlineConfig`.
     */
    test("une couche qui ne déclare que `geometry` rend sa géométrie, pas `-`", async () => {
        await LS.populate();
        await flush();

        const alias = LS._layers.find((l) => l.id === "alias_layer");
        expect(alias).toBeDefined();
        await expect(LS.getLayerGeometryType(alias as LayerLike)).resolves.toBe(
            ALIAS_CONFIG.geometry
        );
    });

    test("et la colonne de sa ligne l'affiche, comme celle d'une couche à `geometryType`", async () => {
        await LS.populate();
        await flush();

        const rows = [...container.querySelectorAll("tbody tr")];
        const cell = (id: string): string => {
            const i = LS._layers.findIndex((l) => l.id === id);
            return ([...rows[i]!.querySelectorAll("td")][2]?.textContent ?? "").trim();
        };
        // La cellule porte la clé i18n de la géométrie, pas la valeur brute — on compare
        // donc au niveau où le rendu opère. Les deux géométries DIFFÈRENT : une ligne qui
        // rendrait celle de l'autre ne passerait pas.
        // Témoin : la couche à `geometryType` affiche déjà la sienne.
        expect(cell("direct_layer")).toBe("storage.geometry.polygon");
        expect(cell("alias_layer")).toBe("storage.geometry.point");
        expect(cell("alias_layer")).not.toBe("-");
    });

    test("aucune des deux clés déclarée ⟹ `null`, pas une valeur inventée", async () => {
        await expect(
            LS.getLayerGeometryType({ id: "x", inlineConfig: { label: "sans géométrie" } })
        ).resolves.toBeNull();
    });
});
