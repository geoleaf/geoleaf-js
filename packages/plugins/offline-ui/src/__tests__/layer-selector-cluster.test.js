/**
 * Unit tests — the LayerSelector (LS) cluster, real coverage.
 *
 * `cache/layer-selector/{core,data-fetching,row-rendering,selection-cache}.ts`
 * measured between 1.7% and 24%: a single test cited its SHAPE (`init` exists),
 * none RAN `populate()` — the binder that builds the table, rows, sizes, cache
 * icons and saves the selection. Yet it needs no real map: DOM + `fetch` +
 * `Config.get` + the `StorageContract` singleton, all controllable.
 *
 * We assemble the real `LS` (the 4 modules `Object.assign` the same singleton
 * imported from `core.js`), inject storage via `_installGeoLeafStorage()`, and
 * drive first `populate()`'s nominal path — which alone crosses the 6 files —
 * then the branches it does not reach (warning steps, vector zone, errors).
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { LS } from "../cache/layer-selector/core.js";
import "../cache/layer-selector/data-fetching.js";
import "../cache/layer-selector/row-rendering.js";
import "../cache/layer-selector/selection-cache.js";
import { renderCacheCell } from "../cache/layer-selector/cache-cell.js";

// The tests plant `GeoLeaf.Storage` the way PRODUCTION does. They used to drive
// `StorageContract.init()`, i.e. a SECOND instance of the singleton the bundle
// embedded and nothing initialised: they validated a dead channel.
function _installGeoLeafStorage(api) {
    globalThis.GeoLeaf = globalThis.GeoLeaf ?? {};
    // The helper reproduces what `StorageContract.init()` provided, because the
    // core's facade provides it too: `isPluginLoaded()` = "an engine registered",
    // and `isAvailable()` = "and its database is open". The plugin's adapter
    // DELEGATES these two methods — it does not recompute them — so a planted
    // object not carrying them would return `false` where the test expects
    // `true`. A caller providing them keeps the hand.
    globalThis.GeoLeaf.Storage =
        api === null || api === undefined
            ? null
            : {
                  isPluginLoaded: () => true,
                  isAvailable: () => !!api.DB,
                  ...api,
              };
    return api;
}
import {
    getLayerConfig,
    getCacheStatusOnce,
    beginCacheStatusPass,
} from "../cache/layer-selector/config-cache.js";

// ── Configuration control (coreConfigGet reads globalThis.GeoLeaf.Config.get) ──
let CONFIG = {};
function setConfig(overrides = {}) {
    CONFIG = {
        "data.profilesBasePath": "profiles",
        "modules.offline.cache.enableProfileCache": true,
        "modules.offline.cache.enableTileCache": true,
        basemaps: {},
        ...overrides,
    };
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    globalThis.GeoLeaf.Config = {
        get: (key, fallback) => (key in CONFIG ? CONFIG[key] : fallback),
    };
}

// ── Storage injected into the StorageContract singleton ─────────────────────────────
function installStorage({ cacheResources = [], savedSelection = null } = {}) {
    const saveLayerSelection = vi.fn(async () => {});
    const loadLayerSelection = vi.fn(async () => savedSelection);
    const getCacheStatus = vi.fn(async () => ({ resources: cacheResources }));
    const storage = {
        isAvailable: () => true,
        Cache: { Storage: { loadLayerSelection, saveLayerSelection } },
        CacheManager: { getCacheStatus },
    };
    _installGeoLeafStorage(storage);
    return { storage, saveLayerSelection, loadLayerSelection, getCacheStatus };
}

// ── Routeur fetch : profile.json (GET) · config de couche (GET) · taille (HEAD) ─────
function installFetch({ profile, layerConfig, headSize = "2097152", profileOk = true } = {}) {
    const fetchMock = vi.fn(async (url, opts) => {
        const method = opts?.method || "GET";
        if (method === "HEAD") {
            return {
                ok: true,
                headers: { get: (h) => (h === "content-length" ? headSize : null) },
            };
        }
        if (String(url).endsWith("profile.json")) {
            return { ok: profileOk, status: profileOk ? 200 : 404, json: async () => profile };
        }
        // Everything else = a layer's JSON config.
        return { ok: true, status: 200, json: async () => layerConfig };
    });
    globalThis.fetch = fetchMock;
    return fetchMock;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let seq = 0;
let container;

beforeEach(() => {
    seq += 1;
    // One profile per test: the config paths feed a module memo (`_configCache`)
    // that lives beyond the test; a distinct id avoids any carry-over.
    setConfig({ "data.activeProfile": `prof-${seq}` });
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
    container?.remove();
    document.getElementById("gl-cache-warning")?.remove();
    document.getElementById("gl-cache-download")?.remove();
    vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════════
// populate() — the nominal path crosses the cluster's 6 files
// ════════════════════════════════════════════════════════════════════════════════════

describe("populate — nominal (1 couche + 1 fond)", () => {
    const LAYER = { id: "roads", configFile: "layers/roads/layer.json" };
    const LAYER_CONFIG = {
        label: "Routes",
        geometryType: "LineString",
        dataFile: "roads.geojson",
        styles: {
            available: [
                { id: "default", label: "Défaut" },
                { id: "night", label: "Nuit" },
            ],
            default: "default",
        },
    };
    const BASEMAP = {
        id: "sat",
        label: "Satellite",
        offline: true,
        offlineBounds: { north: 48.9, south: 48.8, east: 2.4, west: 2.3 },
        cacheMinZoom: 10,
        cacheMaxZoom: 12,
    };

    function arrange(over = {}) {
        setConfig({ "data.activeProfile": `prof-${seq}`, basemaps: { sat: BASEMAP }, ...over });
        const store = installStorage({ cacheResources: [] });
        const fetchMock = installFetch({
            profile: { layers: [{ ...LAYER }], Files: {} },
            layerConfig: LAYER_CONFIG,
        });
        return { store, fetchMock };
    }

    test("bâtit la table : en-tête, une ligne de couche, une ligne de fond", async () => {
        arrange();
        await LS.populate();
        await flush();

        expect(container.querySelector("table.gl-cache-layers__table")).toBeTruthy();
        expect(container.querySelector("thead")).toBeTruthy();
        // 6 header columns (checkbox, name, geometry, style, size, cache)
        expect(container.querySelectorAll("thead th").length).toBe(6);
        // 2 lignes de corps (couche + fond)
        expect(container.querySelectorAll("tbody .gl-cache-layers__row").length).toBe(2);
        // the "select all" checkbox was set
        expect(LS._selectAllCheckbox).toBeTruthy();
        // the state arrays are populated
        expect(LS._layers).toHaveLength(1);
        expect(LS._basemaps).toHaveLength(1);
    });

    test("remplit le libellé, la géométrie et la taille (promesses flottantes)", async () => {
        arrange();
        await LS.populate();
        await flush();

        const nameCell = container.querySelector(".gl-cache-layers__name");
        expect(nameCell.textContent).toBe("Routes");

        const geomCell = container.querySelector(".gl-cache-layers__td-geometry");
        // LineString → "ligne" label (i18n key, falls back to the key)
        expect(geomCell.textContent).not.toBe("~");

        const sizeCell = container.querySelector(".gl-cache-layers__td-size");
        // 2 097 152 octets = 2 MB, rendu "… MB"
        expect(sizeCell.textContent).toContain("MB");
    });

    test("construit le sélecteur de style à partir de styles.available", async () => {
        arrange();
        await LS.populate();
        await flush();

        const select = container.querySelector(".gl-cache-layers__style-select");
        expect(select).toBeTruthy();
        expect(select.querySelectorAll("option").length).toBe(2);
        // the "default" option is preselected
        expect(select.value).toBe("default");
    });

    test("sauve la sélection initiale quand aucune n'est enregistrée", async () => {
        const { store } = arrange();
        await LS.populate();
        await flush();

        expect(store.saveLayerSelection).toHaveBeenCalledTimes(1);
        const [profileId, selection] = store.saveLayerSelection.mock.calls[0];
        expect(profileId).toBe(`prof-${seq}`);
        // layer + basemap checked by default (no saved selection)
        expect(selection.layers).toContain("roads");
        expect(selection.basemaps).toContain("sat");
    });

    test("pose l'icône de cache manquant quand rien n'est en cache", async () => {
        arrange();
        await LS.populate();
        await flush();

        const status = container.querySelector(".gl-cache-layers__status");
        expect(status).toBeTruthy();
        expect(status.className).toContain("gl-cache-layers__status--missing");
    });

    test("respecte une sélection sauvegardée (couche décochée)", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}`, basemaps: {} });
        installStorage({
            savedSelection: { layers: [], basemaps: [], styles: {} },
        });
        installFetch({ profile: { layers: [{ ...LAYER }], Files: {} }, layerConfig: LAYER_CONFIG });

        await LS.populate();
        await flush();

        const cb = container.querySelector('input[data-layer-id="roads"]');
        expect(cb.checked).toBe(false);
    });
});

describe("populate — gardes et erreurs", () => {
    test("sans profil actif, ne fait rien", async () => {
        setConfig({ "data.activeProfile": "" });
        const fetchMock = installFetch({ profile: {}, layerConfig: {} });
        await LS.populate();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(container.querySelector("table")).toBeNull();
    });

    test("sans conteneur de couches, ne fait rien", async () => {
        LS._layersContent = null;
        const fetchMock = installFetch({ profile: {}, layerConfig: {} });
        await LS.populate();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("profile.json en échec (404) : sort sans bâtir de table", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage();
        installFetch({ profile: {}, layerConfig: {}, profileOk: false });
        await LS.populate();
        expect(container.querySelector("table")).toBeNull();
    });

    test("fetch qui jette : rend le div d'erreur", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage();
        globalThis.fetch = vi.fn(async () => {
            throw new Error("réseau coupé");
        });
        await LS.populate();
        expect(container.querySelector(".gl-cache-layers__error")).toBeTruthy();
    });

    test("couche sans configFile ni layerDir : ligne créée, style '-'", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}`, basemaps: {} });
        installStorage();
        installFetch({
            profile: { layers: [{ id: "inline" }], Files: {} },
            layerConfig: {},
        });
        await LS.populate();
        await flush();

        const styleCell = container.querySelector(".gl-cache-layers__td-style");
        expect(styleCell.textContent).toBe("-");
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// saveSelection — rebuilds the selection from the DOM
// ════════════════════════════════════════════════════════════════════════════════════

describe("saveSelection", () => {
    /** Mounts a row container with checkboxes + style selectors. */
    function buildRows({ layerChecked = true, basemapChecked = true, withStyle = false } = {}) {
        container.innerHTML = "";
        const mkRow = () => {
            const row = document.createElement("div");
            row.className = "gl-cache-layers__row";
            container.appendChild(row);
            return row;
        };

        const layerRow = mkRow();
        const layerCb = document.createElement("input");
        layerCb.type = "checkbox";
        layerCb.dataset.layerId = "roads";
        layerCb.checked = layerChecked;
        layerRow.appendChild(layerCb);
        if (withStyle) {
            const sel = document.createElement("select");
            sel.className = "gl-cache-layers__style-select";
            const opt = document.createElement("option");
            opt.value = "night";
            opt.selected = true;
            sel.appendChild(opt);
            layerRow.appendChild(sel);
        }

        const bmRow = mkRow();
        const bmCb = document.createElement("input");
        bmCb.type = "checkbox";
        bmCb.dataset.basemapId = "sat";
        bmCb.checked = basemapChecked;
        bmRow.appendChild(bmCb);
    }

    test("sans profil actif, ne sauve rien", async () => {
        setConfig({ "data.activeProfile": "" });
        const { saveLayerSelection } = installStorage();
        buildRows();
        await LS.saveSelection();
        expect(saveLayerSelection).not.toHaveBeenCalled();
    });

    test("collecte couches, fonds et styles cochés", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        const { saveLayerSelection } = installStorage();
        installFetch({ profile: {}, layerConfig: {} });
        LS._layers = [{ id: "roads", url: "http://x/roads.geojson" }];
        LS._basemaps = [];
        buildRows({ withStyle: true });

        await LS.saveSelection();

        expect(saveLayerSelection).toHaveBeenCalledTimes(1);
        const selection = saveLayerSelection.mock.calls[0][1];
        expect(selection.layers).toEqual(["roads"]);
        expect(selection.basemaps).toEqual(["sat"]);
        expect(selection.styles).toEqual({ roads: "night" });
        expect(selection.totalEstimatedSize).toBeGreaterThan(0);
    });

    test("cases décochées : sélection vide, taille nulle", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        const { saveLayerSelection } = installStorage();
        buildRows({ layerChecked: false, basemapChecked: false });

        await LS.saveSelection();

        const selection = saveLayerSelection.mock.calls[0][1];
        expect(selection.layers).toEqual([]);
        expect(selection.basemaps).toEqual([]);
        expect(selection.totalEstimatedSize).toBe(0);
    });

    test("préserve la zone vectorielle et l'ajoute au total pour un fond vectoriel", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        const vectorZone = {
            bounds: { north: 48.9, south: 48.8, east: 2.4, west: 2.3 },
            cacheMinZoom: 10,
            cacheMaxZoom: 14,
        };
        const { saveLayerSelection } = installStorage({
            savedSelection: { vectorZone },
        });
        LS._basemaps = [{ id: "sat", type: "maplibre" }];
        buildRows({ layerChecked: false });

        await LS.saveSelection();

        const selection = saveLayerSelection.mock.calls[0][1];
        expect(selection.vectorZone).toEqual(vectorZone);
        // estimateVectorZone(zone).bytes > 0 → added to the total
        expect(selection.totalEstimatedSize).toBeGreaterThan(0);
    });

    test("erreur de Storage.saveLayerSelection : capturée, ne jette pas", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        const storage = {
            isAvailable: () => true,
            Cache: {
                Storage: {
                    loadLayerSelection: vi.fn(async () => null),
                    saveLayerSelection: vi.fn(async () => {
                        throw new Error("quota");
                    }),
                },
            },
            CacheManager: { getCacheStatus: vi.fn() },
        };
        _installGeoLeafStorage(storage);
        buildRows({ layerChecked: false, basemapChecked: false });

        await expect(LS.saveSelection()).resolves.toBeUndefined();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// handleSelectAllChange / updateSelectAllCheckbox
// ════════════════════════════════════════════════════════════════════════════════════

describe("select-all", () => {
    function buildCheckboxes(states) {
        container.innerHTML = "";
        const all = document.createElement("input");
        all.type = "checkbox";
        all.className = "gl-cache-layers__select-all";
        container.appendChild(all);
        LS._selectAllCheckbox = all;

        states.forEach((checked, i) => {
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.dataset.layerId = `l${i}`;
            cb.checked = checked;
            container.appendChild(cb);
        });
        return all;
    }

    test("handleSelectAllChange propage l'état à toutes les cases et sauve", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        const { saveLayerSelection } = installStorage();
        installFetch({ profile: {}, layerConfig: {} });
        const all = buildCheckboxes([false, false]);
        all.checked = true;

        await LS.handleSelectAllChange();

        const boxes = container.querySelectorAll("input[data-layer-id]");
        expect([...boxes].every((cb) => cb.checked)).toBe(true);
        expect(saveLayerSelection).toHaveBeenCalled();
    });

    test("handleSelectAllChange sort si l'infra n'est pas montée", async () => {
        LS._selectAllCheckbox = null;
        await expect(LS.handleSelectAllChange()).resolves.toBeUndefined();
    });

    test("updateSelectAllCheckbox — tout coché → checked, non indéterminé", () => {
        buildCheckboxes([true, true]);
        LS.updateSelectAllCheckbox();
        expect(LS._selectAllCheckbox.checked).toBe(true);
        expect(LS._selectAllCheckbox.indeterminate).toBe(false);
    });

    test("updateSelectAllCheckbox — partiel → indéterminé", () => {
        buildCheckboxes([true, false]);
        LS.updateSelectAllCheckbox();
        expect(LS._selectAllCheckbox.checked).toBe(false);
        expect(LS._selectAllCheckbox.indeterminate).toBe(true);
    });

    test("updateSelectAllCheckbox — rien coché → non checked, non indéterminé", () => {
        buildCheckboxes([false, false]);
        LS.updateSelectAllCheckbox();
        expect(LS._selectAllCheckbox.checked).toBe(false);
        expect(LS._selectAllCheckbox.indeterminate).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// updateWarning — the warning steps
// ════════════════════════════════════════════════════════════════════════════════════

describe("updateWarning", () => {
    let warningEl;
    let downloadBtn;

    beforeEach(() => {
        warningEl = document.createElement("div");
        warningEl.id = "gl-cache-warning";
        downloadBtn = document.createElement("button");
        downloadBtn.id = "gl-cache-download";
        document.body.append(warningEl, downloadBtn);
        // no quota by default
        delete navigator.storage;
    });

    function withSelection(totalEstimatedSize) {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage({ savedSelection: { totalEstimatedSize } });
    }

    test("aucun profil → bannière masquée", async () => {
        setConfig({ "data.activeProfile": "" });
        installStorage();
        await LS.updateWarning();
        expect(warningEl.style.display).toBe("none");
    });

    test("aucune sélection → bannière masquée", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage({ savedSelection: null });
        await LS.updateWarning();
        expect(warningEl.style.display).toBe("none");
    });

    test("petite taille → masquée, bouton actif", async () => {
        withSelection(10 * 1024 * 1024); // 10 MB
        await LS.updateWarning();
        expect(warningEl.style.display).toBe("none");
        expect(downloadBtn.disabled).toBe(false);
    });

    test("taille > 300 MB → palier 'attention'", async () => {
        withSelection(400 * 1024 * 1024);
        await LS.updateWarning();
        expect(warningEl.style.display).toBe("block");
        expect(warningEl.querySelector(".gl-cache-warning__warning")).toBeTruthy();
    });

    test("taille > 1 GB → palier 'critique'", async () => {
        withSelection(2 * 1024 * 1024 * 1024);
        await LS.updateWarning();
        expect(warningEl.querySelector(".gl-cache-warning__critical")).toBeTruthy();
    });

    test("stockage insuffisant → palier 'erreur', bouton bloqué", async () => {
        withSelection(5 * 1024 * 1024 * 1024);
        navigator.storage = {
            estimate: vi.fn(async () => ({ quota: 1 * 1024 * 1024 * 1024, usage: 0 })),
        };
        await LS.updateWarning();
        expect(warningEl.querySelector(".gl-cache-warning__error")).toBeTruthy();
        expect(downloadBtn.disabled).toBe(true);
        expect(downloadBtn.style.cursor).toBe("not-allowed");
    });

    test("sans les éléments DOM, sort proprement", async () => {
        warningEl.remove();
        downloadBtn.remove();
        withSelection(10);
        await expect(LS.updateWarning()).resolves.toBeUndefined();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// isLayerCached / isBasemapCached / refreshCacheIcons
// ════════════════════════════════════════════════════════════════════════════════════

describe("isLayerCached", () => {
    const LAYER = { id: "roads", layerDir: "layers/roads", dataFile: "roads.geojson" };

    test("sans profil → false", async () => {
        setConfig({ "data.activeProfile": "" });
        installStorage();
        expect(await LS.isLayerCached(LAYER)).toBe(false);
    });

    test("manifeste vide → false", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage({ cacheResources: [] });
        expect(await LS.isLayerCached(LAYER)).toBe(false);
    });

    test("URL présente dans le manifeste → true", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage({
            cacheResources: [{ url: `profiles/prof-${seq}/layers/roads/roads.geojson` }],
        });
        expect(await LS.isLayerCached(LAYER)).toBe(true);
    });

    test("couche sans URL de recherche → false", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage({ cacheResources: [{ url: "x" }] });
        expect(await LS.isLayerCached({ id: "bare" })).toBe(false);
    });

    test("getCacheStatus qui jette → false (capturé)", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        const storage = {
            isAvailable: () => true,
            CacheManager: {
                getCacheStatus: vi.fn(async () => {
                    throw new Error("boom");
                }),
            },
            Cache: { Storage: {} },
        };
        _installGeoLeafStorage(storage);
        beginCacheStatusPass();
        expect(await LS.isLayerCached(LAYER)).toBe(false);
    });
});

describe("isBasemapCached", () => {
    test("sans profil → false", async () => {
        setConfig({ "data.activeProfile": "" });
        installStorage();
        expect(await LS.isBasemapCached({ id: "sat" })).toBe(false);
    });

    test("fond sans url ni style (aucun préfixe) → false", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage({ cacheResources: [{ url: "x" }] });
        expect(await LS.isBasemapCached({ id: "sat" })).toBe(false);
    });

    test("préfixe d'URL présent dans le manifeste → true", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage({
            cacheResources: [{ url: "https://tiles.example/sat/10/1/1.png" }],
        });
        expect(
            await LS.isBasemapCached({
                id: "sat",
                url: "https://tiles.example/sat/{z}/{x}/{y}.png",
            })
        ).toBe(true);
    });
});

describe("refreshCacheIcons", () => {
    test("re-rend les cellules de cache des lignes présentes", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        installStorage({ cacheResources: [] });
        installFetch({
            profile: { layers: [{ id: "roads", layerDir: "layers/roads", dataFile: "r.geojson" }] },
            layerConfig: {},
        });

        // A pre-existing row with its checkbox + cache cell.
        const row = document.createElement("div");
        row.className = "gl-cache-layers__row";
        const cb = document.createElement("input");
        cb.dataset.layerId = "roads";
        row.appendChild(cb);
        const cell = document.createElement("td");
        cell.className = "gl-cache-layers__td-cache";
        row.appendChild(cell);
        container.appendChild(row);

        await LS.refreshCacheIcons();
        await flush();

        expect(cell.querySelector(".gl-cache-layers__status")).toBeTruthy();
    });

    test("sans conteneur, sort proprement", async () => {
        LS._layersContent = null;
        await expect(LS.refreshCacheIcons()).resolves.toBeUndefined();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// data-fetching : tailles, tuiles, projection
// ════════════════════════════════════════════════════════════════════════════════════

describe("estimateLayerSize", () => {
    beforeEach(() => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
    });

    test("layerDir + dataFile → HEAD, lit content-length", async () => {
        installFetch({ profile: {}, layerConfig: {}, headSize: "1048576" });
        const size = await LS.estimateLayerSize({
            id: "a",
            layerDir: "d",
            dataFile: "a.geojson",
        });
        expect(size).toBe(1048576);
    });

    test("dataFile seul → construit l'URL sans layerDir", async () => {
        const f = installFetch({ profile: {}, layerConfig: {}, headSize: "42" });
        const size = await LS.estimateLayerSize({ id: "a", dataFile: "a.geojson" });
        expect(size).toBe(42);
        // ⚠️ The init now carries a `signal` (the request is BOUNDED), so strict
        // object equality no longer holds. What this test verifies is the BUILT
        // URL, not the init's shape: we assert the URL and method, and
        // additionally check the deadline is there — one more guarantee, not
        // less.
        expect(f).toHaveBeenCalledWith(
            expect.stringContaining("a.geojson"),
            expect.objectContaining({ method: "HEAD", signal: expect.anything() })
        );
    });

    test("url absolue → utilisée telle quelle", async () => {
        installFetch({ profile: {}, layerConfig: {}, headSize: "7" });
        const size = await LS.estimateLayerSize({ id: "a", url: "http://x/a.json" });
        expect(size).toBe(7);
    });

    test("aucune source → 0 sans fetch", async () => {
        const f = installFetch({ profile: {}, layerConfig: {} });
        const size = await LS.estimateLayerSize({ id: "a" });
        expect(size).toBe(0);
        expect(f).not.toHaveBeenCalled();
    });

    test("sans profil → 0", async () => {
        setConfig({ "data.activeProfile": "" });
        const size = await LS.estimateLayerSize({ id: "a", url: "http://x" });
        expect(size).toBe(0);
    });

    test("HEAD non ok → 0", async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false }));
        const size = await LS.estimateLayerSize({ id: "a", url: "http://x" });
        expect(size).toBe(0);
    });

    test("sans content-length → 0", async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, headers: { get: () => null } }));
        const size = await LS.estimateLayerSize({ id: "a", url: "http://x" });
        expect(size).toBe(0);
    });

    test("fetch qui jette → 0", async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error("net");
        });
        const size = await LS.estimateLayerSize({ id: "a", url: "http://x" });
        expect(size).toBe(0);
    });
});

describe("estimateBasemapSize / latLngToTile", () => {
    test("bornes + zoom → compte des tuiles > 0", () => {
        const est = LS.estimateBasemapSize({
            id: "sat",
            offlineBounds: { north: 48.9, south: 48.8, east: 2.4, west: 2.3 },
            cacheMinZoom: 10,
            cacheMaxZoom: 12,
        });
        expect(est.tileCount).toBeGreaterThan(0);
        expect(est.estimatedSize).toBe(est.tileCount * 25 * 1024);
    });

    test("bornes manquantes → 0", () => {
        const est = LS.estimateBasemapSize({ id: "sat" });
        expect(est).toEqual({ tileCount: 0, estimatedSize: 0 });
    });

    test("latLngToTile borne la latitude et la longitude", () => {
        const clamped = LS.latLngToTile(95, 200, 3);
        const maxT = LS.latLngToTile(85.051129, 180, 3);
        expect(clamped.x).toBe(maxT.x);
        expect(clamped.y).toBe(maxT.y);
        expect(Number.isInteger(clamped.x)).toBe(true);
    });
});

describe("getLayerLabel / getLayerGeometryType", () => {
    beforeEach(() => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
    });

    test("libellé et géométrie lus depuis la config", async () => {
        installFetch({
            profile: {},
            layerConfig: { label: "Routes", geometryType: "Point" },
        });
        const layer = { id: "roads", configFile: "layers/roads.json" };
        expect(await LS.getLayerLabel(layer)).toBe("Routes");
        expect(await LS.getLayerGeometryType(layer)).toBe("Point");
    });

    test("sans config (couche sans configFile) → null", async () => {
        installFetch({ profile: {}, layerConfig: {} });
        expect(await LS.getLayerLabel({ id: "x" })).toBeNull();
        expect(await LS.getLayerGeometryType({ id: "x" })).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// config-cache : memos de config et de statut
// ════════════════════════════════════════════════════════════════════════════════════

describe("config-cache", () => {
    test("getLayerConfig → null sans configFile", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        expect(await getLayerConfig({ id: "x" })).toBeNull();
    });

    test("getLayerConfig → null sans profil actif", async () => {
        setConfig({ "data.activeProfile": "" });
        expect(await getLayerConfig({ id: "x", configFile: "c.json" })).toBeNull();
    });

    test("getLayerConfig mémorise : un seul fetch pour deux appels", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        const f = installFetch({ profile: {}, layerConfig: { label: "A" } });
        const layer = { id: "a", configFile: "layers/a.json" };
        const [c1, c2] = await Promise.all([getLayerConfig(layer), getLayerConfig(layer)]);
        expect(c1).toEqual({ label: "A" });
        expect(c2).toBe(c1);
        expect(f).toHaveBeenCalledTimes(1);
    });

    test("un fetch en échec n'est pas mémorisé (retry possible)", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        let ok = false;
        globalThis.fetch = vi.fn(async () =>
            ok ? { ok: true, json: async () => ({ label: "B" }) } : { ok: false, status: 500 }
        );
        const layer = { id: "b", configFile: "layers/b.json" };

        expect(await getLayerConfig(layer)).toBeNull();
        // the null entry was purged → a second call redoes the fetch
        ok = true;
        expect(await getLayerConfig(layer)).toEqual({ label: "B" });
    });

    test("getCacheStatusOnce mémorise par passe, beginCacheStatusPass ré-arme", async () => {
        setConfig({ "data.activeProfile": `prof-${seq}` });
        const { getCacheStatus } = installStorage({ cacheResources: [{ url: "x" }] });
        beginCacheStatusPass();

        await getCacheStatusOnce(`prof-${seq}`);
        await getCacheStatusOnce(`prof-${seq}`);
        expect(getCacheStatus).toHaveBeenCalledTimes(1);

        beginCacheStatusPass();
        await getCacheStatusOnce(`prof-${seq}`);
        expect(getCacheStatus).toHaveBeenCalledTimes(2);
    });

    test("getCacheStatusOnce → null quand le plugin n'est pas chargé", async () => {
        _installGeoLeafStorage(null);
        beginCacheStatusPass();
        expect(await getCacheStatusOnce("p")).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// cache-cell: the state glyph
// ════════════════════════════════════════════════════════════════════════════════════

describe("renderCacheCell", () => {
    test.each([
        ["cached", "✓", "--cached"],
        ["missing", "✗", "--missing"],
        ["none", "-", "--none"],
    ])("état %s → glyphe et classe", (state, glyph, classFrag) => {
        const cell = document.createElement("td");
        renderCacheCell(cell, state, `titre-${state}`);
        const span = cell.querySelector("span");
        expect(span.textContent).toBe(glyph);
        expect(span.className).toContain(classFrag);
        expect(cell.title).toBe(`titre-${state}`);
    });
});

describe("cleanup", () => {
    test("retire les écouteurs enregistrés et vide la liste", () => {
        const el = document.createElement("input");
        const handler = () => {};
        el.addEventListener("change", handler);
        LS._eventListeners = [{ element: el, event: "change", handler }];
        LS.cleanup();
        expect(LS._eventListeners).toHaveLength(0);
    });

    test("sans écouteurs, ne jette pas", () => {
        LS._eventListeners = null;
        expect(() => LS.cleanup()).not.toThrow();
    });
});
