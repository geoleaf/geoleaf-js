/**
 * GUARD — an `inlineConfig` layer must be worth a `configFile` layer.
 *
 * 🛑 WHAT THIS GUARD EXISTS TO PREVENT. The PULL of templated layers was
 * repaired: `resolveProfileLayers` goes through `expandLayerTemplates`, and
 * `resource-enumerator` gained its `inlineConfig` branch. But
 * `expandLayerTemplates` sets `inlineConfig` and **never `configFile`**, while
 * the selector's three sites all branched on `configFile` alone. Measured in a
 * browser on `tourism` on 07/08/2026: all 42 layers did appear, but the **24
 * templated ones** rendered as raw identifiers, geometry `-`, style `-`, no
 * style selector — and their cache state was **always false**, because
 * `searchUrls` stayed empty.
 *
 * ⚠️ ANCHORED ON THE MECHANISM, NOT ON `tourism`. No assertion cites
 * `pluviometrie_*` nor the demo profile: the guarded property is "carrying its
 * config inline rather than in a file changes NOTHING about what the selector
 * can do with the layer". A test naming the 24 layers would expire at the first
 * rewritten profile, and would assert nothing about the mechanism.
 *
 * ⚠️ EACH ASSERTION HAS ITS DIRECT WITNESS. Both layers are declared with the
 * SAME useful config — one by file, the other inline. Without that witness, the
 * guard would pass by returning `null` on both sides: exactly the pre-fix
 * state.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { LS } from "../cache/layer-selector/core.js";
import "../cache/layer-selector/data-fetching.js";
import "../cache/layer-selector/row-rendering.js";
import "../cache/layer-selector/selection-cache.js";
import { getLayerConfig, beginCacheStatusPass } from "../cache/layer-selector/config-cache.js";
import type { LayerLike } from "../cache/layer-selector/layer-selector-types.js";

// The useful config, IDENTICAL on both sides — what makes the comparison probing.
const SHARED_CONFIG = {
    label: "Pluviométrie – Janvier",
    geometryType: "Polygon",
    styles: { available: [{ id: "defaut", label: "Défaut" }], default: "defaut" },
};

/** WITNESS layer: its config lives in a file, like the 18 direct layers. */
const DIRECT_LAYER: LayerLike = {
    id: "direct_layer",
    configFile: "layers/direct_layer/direct_layer_config.json",
};

/**
 * SUBJECT layer of the `geometry`/`geometryType` alias: it declares `geometry`
 * **alone**, the repo's majority form (18 configs out of 24; **none** declares
 * `geometryType` alone). The schema sets both as aliases —
 * `layer-config.schema.json:42`: "Root-level alias of `geometry`".
 */
const ALIAS_LAYER: LayerLike = {
    id: "alias_layer",
    configFile: "layers/alias_layer/alias_layer_config.json",
};
const ALIAS_CONFIG = {
    label: "Couche à clé alias",
    geometry: "point", // ← and NOT `geometryType`; differs from the witness, on purpose
    styles: { available: [{ id: "defaut", label: "Défaut" }], default: "defaut" },
};

/**
 * The layers file served to the selector — DIRECT + alias + one `layerTemplates`.
 *
 * ⚠️ THE TEMPLATED LAYER IS NOT HAND-WRITTEN, AND IT IS THIS HARNESS'S MOST
 * IMPORTANT POINT. A first version of this guard set a hard-coded
 * `inlineConfig`; it would have stayed GREEN if the core stopped normalising
 * `dataFile`, since the fixture already carried the normalised form. Here the
 * REAL `expandLayerTemplates` produces it, called by the real
 * `resolveProfileLayers` that `populate()` takes: the guard thus holds both
 * halves of the seam — what the core emits, and what the plugin does with it.
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

/** The profile does NOT carry `layers`: it points at its file, like real profiles. */
const PROFILE = { Files: { layersFile: "config/core/layers.json" } };

/** The path `resource-enumerator` REALLY caches for an inline layer. */
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

/** The templated layer as the CORE produces it — never built here. */
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
    // Distinct profile per test: `_configCache` is a MODULE memo, it outlives the test.
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

describe("couche en ligne — site 1 : la config est RÉSOLUE", () => {
    test("getLayerConfig rend la config d'une couche `inlineConfig`, comme pour un `configFile`", async () => {
        const layer = await templatedLayerFromCore();

        // Witness: the `configFile` path works, so a `null` on the subject side
        // really is the subject's defect and not the harness's.
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

describe("couche en ligne — site 2 : `layerDir` et `dataFile` sont DÉRIVÉS", () => {
    test("populate() dérive les deux champs sur une couche en ligne", async () => {
        const templated = await templatedLayerFromCore();
        // The core's convention: `layers/<id>` (`resource-enumerator._addInlineConfigResource`).
        expect(templated.layerDir).toBe("layers/templated_layer");
        // Normalised by `expandLayerTemplates` via `layerDataPath` — not derived here.
        expect(templated.dataFile).toBe("data/templated_layer.geojson");
    });

    test("la ligne rendue porte le libellé HUMAIN, pas l'identifiant technique", async () => {
        await LS.populate();
        await flush();

        const rows = [...container.querySelectorAll("tbody tr")];
        expect(rows).toHaveLength(3);

        const cellsOf = (tr: Element): string[] =>
            [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim());

        // Rows come out in `LS._layers` order — it is the same loop.
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

describe("couche en ligne — site 3 : l'état de cache est OBSERVABLE", () => {
    test("isLayerCached reconnaît l'URL que le core met réellement en cache", async () => {
        // The manifest carries exactly what `resource-enumerator` writes for an
        // inline layer — not a URL fabricated for the occasion.
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

describe("la géométrie se lit sur `geometry` COMME sur `geometryType`", () => {
    /**
     * 🛑 The schema sets both as the SAME field — `layer-config.schema.json:42`:
     * "Root-level alias of `geometry`. Canonical form READ BY THE CODE (…) — do
     * NOT migrate (ANO-007)". The code nonetheless read `geometryType` **alone**,
     * the key **0 configs out of 24** declare without the other, while **18**
     * declare only `geometry`. Measured in a browser: 38 of `tourism`'s 42
     * selector rows rendered `-`, including 14 DIRECT layers — that symmetry is
     * what proves the cause is not the `inlineConfig`.
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
        // The cell carries the geometry's i18n key, not the raw value — so we
        // compare at the level where rendering operates. The two geometries
        // DIFFER: a row rendering the other's would not pass.
        // Witness: the `geometryType` layer already displays its own.
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
