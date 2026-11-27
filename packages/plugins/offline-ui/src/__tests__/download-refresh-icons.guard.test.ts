/**
 * GUARD — after a download from the full window, the « Cache » column turns ✓ without reopening.
 *
 * 🛑 WHAT THIS GUARD EXISTS TO PREVENT. The handler refreshed the icons through
 * `StorageContract.Cache.LayerSelector` — a member the core NEVER fills: its offline engine wires
 * `cache: { Storage }` alone, the layer selector living in this plugin. The refresh was skipped
 * without a word, every row stayed ✗ until the window was reopened. The unit suites did not see
 * it: their storage doubles planted a `LayerSelector` the real core does not carry.
 *
 * Second half of the same symptom: the refresh re-read the RAW layer list, without the
 * `layerDir` / `dataFile` that `populate()` derives for a templated (`inlineConfig`) layer, so
 * such a row stayed ✗ even once the refresh ran.
 *
 * ⚠️ THE STORAGE DOUBLE HAS THE CORE'S SHAPE, and that is the harness's point: `Cache` carries
 * `Storage` and nothing else. Each assertion has its witness — the same rows read ✗ before the
 * download, so a ✓ after it is the refresh's doing, not the fixture's.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { LS } from "../cache/layer-selector/core.js";
import "../cache/layer-selector/data-fetching.js";
import "../cache/layer-selector/row-rendering.js";
import "../cache/layer-selector/selection-cache.js";
import { beginCacheStatusPass } from "../cache/layer-selector/config-cache.js";
import { DownloadHandler } from "../cache/download-handler.js";

const G = globalThis as unknown as { GeoLeaf?: Record<string, unknown> };

const LAYER_CONFIG = {
    label: "Couche",
    geometryType: "Point",
    data: { file: "data.geojson" },
    styles: { available: [{ id: "defaut", label: "Défaut" }], default: "defaut" },
};

/** One layer by file, one expanded by the REAL `expandLayerTemplates` (`inlineConfig`). */
const LAYERS_FILE = {
    layers: [{ id: "direct_layer", configFile: "layers/direct_layer/direct_layer_config.json" }],
    layerTemplates: [
        {
            templateId: "tpl",
            layerManagerId: "geojson-default",
            template: { ...LAYER_CONFIG, data: { directory: "data" } },
            instances: [{ id: "templated_layer", label: "Gabarit", dataFile: "templated.geojson" }],
        },
    ],
};

/** What the core's enumerator writes to the manifest for these two layers. */
const MANIFEST = (profileId: string): Array<{ url: string }> => [
    { url: `profiles/${profileId}/layers/direct_layer/direct_layer_config.json` },
    { url: `profiles/${profileId}/layers/direct_layer/data.geojson` },
    { url: `profiles/${profileId}/layers/templated_layer/data/templated.geojson` },
];

let seq = 0;
let profileId = "";
let manifest: Array<{ url: string }> = [];
let container: HTMLElement;

function install(): void {
    const cfg: Record<string, unknown> = {
        "data.profilesBasePath": "profiles",
        "data.activeProfile": profileId,
        "modules.offline.enabled": true,
        "modules.pwa.enabled": true,
        "modules.offline.cache.enableProfileCache": true,
        "modules.offline.cache.enableTileCache": true,
        basemaps: {},
    };
    G.GeoLeaf = G.GeoLeaf ?? {};
    G.GeoLeaf["Config"] = { get: (k: string, fb: unknown) => (k in cfg ? cfg[k] : fb) };
    // The core's DOM clearing: without it the plugin's wrapper is a no-op, and a refreshed cell
    // would keep its former glyph beside the new one.
    const clear = (el: HTMLElement): void => el.replaceChildren();
    G.GeoLeaf["Utils"] = { DOMSecurity: { clearElement: clear, clearElementFast: clear } };
    G.GeoLeaf["_UINotifications"] = {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
    };
    // The core's shape: `Cache` = `{ Storage }` (`offline-engine-entry.ts`), no `LayerSelector`.
    G.GeoLeaf["Storage"] = {
        isPluginLoaded: () => true,
        isAvailable: () => true,
        Cache: {
            Storage: {
                loadLayerSelection: vi.fn(async () => ({ totalEstimatedSize: 1024 })),
                saveLayerSelection: vi.fn(async () => {}),
            },
        },
        CacheManager: {
            getCacheStatus: vi.fn(async () => ({ resources: manifest })),
            cacheProfile: vi.fn(async () => {
                manifest = MANIFEST(profileId);
                return { resourcesCount: manifest.length, totalSize: 4096 };
            }),
        },
    };
    globalThis.fetch = vi.fn(async (url: unknown, opts?: { method?: string }) => {
        if ((opts?.method ?? "GET") === "HEAD") {
            return { ok: true, headers: { get: () => "1024" } };
        }
        const u = String(url);
        if (u.endsWith("profile.json")) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ Files: { layersFile: "config/core/layers.json" } }),
            };
        }
        if (u.endsWith("config/core/layers.json")) {
            return { ok: true, status: 200, json: async () => LAYERS_FILE };
        }
        return { ok: true, status: 200, json: async () => ({ ...LAYER_CONFIG }) };
    }) as unknown as typeof fetch;
}

/** The cache state each row's cell shows, by layer id. */
function cacheStates(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of container.querySelectorAll(".gl-cache-layers__row")) {
        const id = row.querySelector<HTMLInputElement>("input[data-layer-id]")?.dataset.layerId;
        const status = row.querySelector(".gl-cache-layers__td-cache .gl-cache-layers__status");
        if (!id) continue;
        out[id] = status?.classList.contains("gl-cache-layers__status--cached")
            ? "cached"
            : status?.classList.contains("gl-cache-layers__status--missing")
              ? "missing"
              : "none";
    }
    return out;
}

beforeEach(() => {
    seq += 1;
    // Distinct profile per test: the layer-config memo outlives a test.
    profileId = `guard-refresh-${seq}`;
    manifest = [];
    install();
    beginCacheStatusPass();
    container = document.createElement("div");
    document.body.appendChild(container);
    LS._layers = [];
    LS._basemaps = [];
    LS._eventListeners = [];
    LS._selectAllCheckbox = null;
    LS.init({}, container);
});

afterEach(() => {
    vi.useRealTimers();
    container?.remove();
    vi.restoreAllMocks();
    if (G.GeoLeaf) {
        G.GeoLeaf["Storage"] = undefined;
        G.GeoLeaf["_UINotifications"] = undefined;
        G.GeoLeaf["Utils"] = undefined;
    }
});

describe("téléchargement depuis la fenêtre complète — la colonne « Cache » suit", () => {
    test("chaque couche passe de ✗ à ✓ sans rouvrir la fenêtre", async () => {
        await LS.populate();
        // Witness: nothing cached yet, every row reads ✗.
        expect(cacheStates()).toEqual({ direct_layer: "missing", templated_layer: "missing" });

        const btn = document.createElement("button");
        DownloadHandler.init(
            { _updateStatus: vi.fn(async () => {}) },
            {
                progressEl: document.createElement("div"),
                progressFill: document.createElement("div"),
                progressText: document.createElement("div"),
                downloadBtn: btn,
                clearBtn: null,
            }
        );
        vi.useFakeTimers();
        const done = DownloadHandler.handleDownload();
        await vi.runAllTimersAsync();
        await done;

        expect(cacheStates()).toEqual({ direct_layer: "cached", templated_layer: "cached" });
    });
});
