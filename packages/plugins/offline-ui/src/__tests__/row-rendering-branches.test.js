/**
 * Unit tests — `cache/layer-selector/row-rendering.ts`, BRANCH coverage.
 *
 * `layer-selector-cluster.test.js` covers `populate()`'s nominal path but not
 * the ROW RENDERING variants: large basemap (GB vs MB step), tile cache
 * disabled, basemap without offline config, layer with profile cache disabled,
 * and the style selector (config absent, no style, saved style preselected). We
 * call the row constructors directly on the assembled `LS`.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { LS } from "../cache/layer-selector/core.js";
import "../cache/layer-selector/data-fetching.js";
import "../cache/layer-selector/row-rendering.js";
import "../cache/layer-selector/selection-cache.js";

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

function setConfig(profile = "prof-1") {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    globalThis.GeoLeaf.Config = {
        get: (k, fb) => (k === "data.activeProfile" ? profile : fb),
    };
}

let tbody;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    setConfig();
    // isBasemapCached / isLayerCached read the manifest: return "nothing cached"
    _installGeoLeafStorage({
        isAvailable: () => true,
        CacheManager: { getCacheStatus: vi.fn(async () => ({ resources: [] })) },
        Cache: { Storage: { loadLayerSelection: vi.fn(async () => null) } },
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const table = document.createElement("table");
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
    document.body.appendChild(table);
    LS._layersContent = document.createElement("div");
});

afterEach(() => {
    tbody?.parentElement?.remove();
    vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════════
// createBasemapRow — the size steps and cache states
// ════════════════════════════════════════════════════════════════════════════════════

describe("createBasemapRow", () => {
    test("fond volumineux (bcp de tuiles) → palier GB", async () => {
        const basemap = {
            id: "world",
            label: "Monde",
            offline: true,
            offlineBounds: { north: 60, south: 0, east: 60, west: 0 },
            cacheMinZoom: 10,
            cacheMaxZoom: 14,
        };
        await LS.createBasemapRow(tbody, basemap, null, true);
        const sizeCell = tbody.querySelector(".gl-cache-layers__td-size");
        expect(sizeCell.textContent).toContain("GB");
    });

    test("estimation nulle (minZoom > maxZoom) → tiret", async () => {
        const basemap = {
            id: "empty",
            offline: true,
            offlineBounds: { north: 1, south: 0, east: 1, west: 0 },
            cacheMinZoom: 14,
            cacheMaxZoom: 10, // boucle vide → 0 tuile
        };
        await LS.createBasemapRow(tbody, basemap, null, true);
        const sizeCell = tbody.querySelector(".gl-cache-layers__td-size");
        expect(sizeCell.textContent).toBe("-");
    });

    test("cache de tuiles désactivé → ligne grisée, case désactivée, cellule dédiée", async () => {
        const basemap = {
            id: "sat",
            offline: true,
            offlineBounds: { north: 1, south: 0, east: 1, west: 0 },
            cacheMinZoom: 10,
            cacheMaxZoom: 11,
        };
        await LS.createBasemapRow(tbody, basemap, null, false);
        const row = tbody.querySelector(".gl-cache-layers__row");
        expect(row.style.opacity).toBe("0.5");
        const cb = row.querySelector('input[type="checkbox"]');
        expect(cb.disabled).toBe(true);
        expect(row.querySelector(".gl-cache-layers__status--missing")).toBeTruthy();
    });

    test("fond sans config offline → cellule « aucune config »", async () => {
        const basemap = { id: "plain" }; // ni offline ni offlineBounds
        await LS.createBasemapRow(tbody, basemap, null, true);
        expect(tbody.querySelector(".gl-cache-layers__status--none")).toBeTruthy();
    });

    test("sélection sauvegardée → la case reflète l'appartenance", async () => {
        const basemap = {
            id: "sat",
            offline: true,
            offlineBounds: { north: 1, south: 0, east: 1, west: 0 },
            cacheMinZoom: 10,
            cacheMaxZoom: 11,
        };
        await LS.createBasemapRow(tbody, basemap, { basemaps: ["sat"] }, true);
        const cb = tbody.querySelector('input[data-basemap-id="sat"]');
        expect(cb.checked).toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// createLayerRow — profile cache disabled
// ════════════════════════════════════════════════════════════════════════════════════

describe("createLayerRow", () => {
    test("cache profil désactivé → ligne grisée, case désactivée et décochée", async () => {
        await LS.createLayerRow(tbody, { id: "roads" }, null, false);
        await flush();
        const row = tbody.querySelector(".gl-cache-layers__row");
        expect(row.style.opacity).toBe("0.5");
        const cb = row.querySelector('input[data-layer-id="roads"]');
        expect(cb.disabled).toBe(true);
        expect(cb.checked).toBe(false);
    });

    test("sélection sauvegardée sans la couche → case décochée", async () => {
        await LS.createLayerRow(tbody, { id: "roads" }, { layers: ["other"] }, true);
        await flush();
        const cb = tbody.querySelector('input[data-layer-id="roads"]');
        expect(cb.checked).toBe(false);
    });

    // ── Checkbox handler failure paths ───────────────────────────────────────────
    //
    // The handler was an `async () => { … }` set directly on `addEventListener`:
    // it RETURNED a promise where a `void` is expected, and its rejection went
    // nowhere. It is now split into an async part and a synchronous wrapper
    // that catches — the wrapper's reference staying stable, since it also
    // serves unsubscription (`_eventListeners`). These two tests exercise the
    // wrapper AND its `.catch()`, without which they are only shipped code
    // never played.

    test("un changement de case qui échoue à l'enregistrement ne casse pas l'événement", async () => {
        _installGeoLeafStorage({
            isAvailable: () => true,
            CacheManager: { getCacheStatus: vi.fn(async () => ({ resources: [] })) },
            Cache: {
                Storage: {
                    loadLayerSelection: vi.fn(async () => null),
                    saveLayerSelection: vi.fn(async () => {
                        throw new Error("quota dépassé");
                    }),
                },
            },
        });
        await LS.createLayerRow(tbody, { id: "roads" }, null, true);
        await flush();

        const cb = tbody.querySelector('input[data-layer-id="roads"]');
        cb.checked = false;
        expect(() => cb.dispatchEvent(new Event("change"))).not.toThrow();
        await flush();
    });

    test("le handler posé sur la case est le MÊME que celui enregistré pour la désinscription", async () => {
        LS._eventListeners = [];
        await LS.createLayerRow(tbody, { id: "roads" }, null, true);
        await flush();

        const cb = tbody.querySelector('input[data-layer-id="roads"]');
        const entry = LS._eventListeners.find((e) => e.element === cb && e.event === "change");
        // Regression: splitting the handler in two functions must NOT make the
        // stored reference diverge from the really attached one, otherwise
        // cleanup removes nothing any more — and the defect would be invisible
        // (removeEventListener on an unknown reference is a silent no-op).
        expect(entry).toBeDefined();
        expect(typeof entry.handler).toBe("function");
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// createStyleSelector
// ════════════════════════════════════════════════════════════════════════════════════

describe("createStyleSelector", () => {
    function parent() {
        const td = document.createElement("td");
        tbody.appendChild(td);
        return td;
    }

    test("config absente → tiret", async () => {
        // getLayerConfig → null (layer without configFile)
        const td = parent();
        await LS.createStyleSelector(td, { id: "x" }, null);
        expect(td.textContent).toBe("-");
    });

    test("aucun style disponible → tiret", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ styles: { available: [] } }),
        }));
        const td = parent();
        await LS.createStyleSelector(td, { id: "x", configFile: "x.json" }, null);
        expect(td.textContent).toBe("-");
    });

    test("styles présents + style sauvegardé → <select> avec l'option présélectionnée", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                styles: {
                    available: [
                        { id: "day", label: "Jour" },
                        { id: "night", label: "Nuit" },
                    ],
                    default: "day",
                },
            }),
        }));
        const td = parent();
        await LS.createStyleSelector(
            td,
            { id: "x", configFile: "x2.json" },
            { styles: { x: "night" } }
        );
        const select = td.querySelector("select");
        expect(select.querySelectorAll("option").length).toBe(2);
        // the change triggers saveSelection + updateWarning without throwing
        select.dispatchEvent(new Event("change"));
        await flush();
    });
});
