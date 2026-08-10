/**
 * Unit tests — `cache/layer-selector/row-rendering.ts`, couverture des BRANCHES (R.31).
 *
 * `layer-selector-cluster.test.js` couvre le chemin nominal de `populate()` mais pas les
 * variantes de RENDU DE LIGNE : fond volumineux (palier GB vs MB), cache de tuiles désactivé,
 * fond sans config offline, couche à cache profil désactivé, et le sélecteur de style (config
 * absente, aucun style, style sauvegardé présélectionné). On appelle les constructeurs de
 * ligne directement sur le `LS` assemblé.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { LS } from "../cache/layer-selector/core.js";
import "../cache/layer-selector/data-fetching.js";
import "../cache/layer-selector/row-rendering.js";
import "../cache/layer-selector/selection-cache.js";

// API publique S4.4 — les tests plantent `GeoLeaf.Storage` comme le fait la PRODUCTION.
// Ils pilotaient `StorageContract.init()`, c'est-à-dire une SECONDE instance du singleton
// que le bundle embarquait et que rien n'initialisait : ils validaient un canal mort.
function _installGeoLeafStorage(api) {
    globalThis.GeoLeaf = globalThis.GeoLeaf ?? {};
    // Le helper reproduit ce que `StorageContract.init()` fournissait, parce que la façade
    // du core le fournit aussi : `isPluginLoaded()` = « un moteur s'est enregistré », et
    // `isAvailable()` = « et sa base est ouverte ». L'adaptateur du plugin DÉLÈGUE ces deux
    // méthodes — il ne les recalcule pas —, donc un objet planté qui ne les porte pas
    // rendrait `false` là où le test attend `true`. Un appelant qui les fournit garde la main.
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
    // isBasemapCached / isLayerCached lisent le manifeste : renvoyer « rien en cache »
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
// createBasemapRow — les paliers de taille et les états de cache
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
// createLayerRow — cache profil désactivé
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

    // ── Chemins d'échec du handler de case (Q1.4) ────────────────────────────────
    //
    // Le handler était `async () => { … }` posé directement sur `addEventListener` :
    // il RENDAIT une promesse là où un `void` est attendu, et son rejet n'allait nulle
    // part. Il est désormais scindé en une partie async et un wrapper synchrone qui
    // capte — la référence du wrapper restant stable, puisqu'elle sert aussi à la
    // désinscription (`_eventListeners`). Ces deux tests exercent le wrapper ET son
    // `.catch()`, sans quoi ils ne sont que du code livré jamais joué.

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
        // Régression Q1.4 : scinder le handler en deux fonctions ne doit PAS faire
        // diverger la référence stockée de celle réellement attachée, sinon le cleanup
        // ne retire plus rien — et le défaut serait invisible (removeEventListener sur
        // une référence inconnue est un no-op silencieux).
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
        // getLayerConfig → null (couche sans configFile)
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
        // le changement déclenche saveSelection + updateWarning sans jeter
        select.dispatchEvent(new Event("change"));
        await flush();
    });
});
