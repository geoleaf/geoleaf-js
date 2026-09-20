/**
 * Unit tests — `cache/cache-control-zone.ts`, branch coverage.
 *
 * File measured at 50% lines but 12.8% BRANCHES: the "zone" accordion (view
 * bbox or profile zone + zoom ceiling, persisted as `vectorZone`). Everything
 * drives without a real map: `buildZoneSelectionSection` wires the buttons, we
 * click them and observe persistence via `StorageContract.Cache.Storage`. We
 * cover both bound shapes (`LngLatBounds` with methods vs flat `{north,…}`),
 * both sources (view/profile), the ceiling change, hydrating a saved zone and
 * the no-profile guards.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { buildZoneSelectionSection } from "../cache/cache-control-zone.js";
import { LS } from "../cache/layer-selector/core.js";
// `saveSelection` is mixed into `LS` here, not in `core.js`.
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

function installStorage({ selection = null, withLayerSelector = true, loadThrows = false } = {}) {
    const saveLayerSelection = vi.fn(async () => {});
    const loadLayerSelection = vi.fn(async () => {
        if (loadThrows) throw new Error("DB");
        return selection;
    });
    const saveSelection = vi.fn(async () => {});
    const updateWarning = vi.fn(async () => {});
    _installGeoLeafStorage({
        isAvailable: () => true,
        Cache: {
            Storage: { loadLayerSelection, saveLayerSelection },
            LayerSelector: withLayerSelector ? { saveSelection, updateWarning } : undefined,
        },
    });
    return { saveLayerSelection, loadLayerSelection, saveSelection, updateWarning };
}

/** Map with "method" bounds (LngLatBounds). */
function methodMap() {
    return {
        getBounds: () => ({
            getNorth: () => 48.9,
            getSouth: () => 48.8,
            getEast: () => 2.4,
            getWest: () => 2.3,
        }),
        getZoom: () => 11,
        getMaxBounds: () => null,
    };
}

/** Map with "flat" bounds and a profile max zone. */
function plainMap() {
    return {
        getBounds: () => ({ north: 1, south: 0, east: 1, west: 0 }),
        getZoom: () => 9,
        getMaxBounds: () => ({ north: 2, south: -1, east: 2, west: -1 }),
    };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let self;
let parent;

beforeEach(() => {
    setConfig();
    self = { _map: methodMap() };
    parent = document.createElement("div");
    document.body.appendChild(parent);
});

afterEach(() => {
    parent?.remove();
    vi.restoreAllMocks();
});

function zoneButtons() {
    return parent.querySelectorAll(".gl-cache-zone__buttons .gl-btn");
}

describe("buildZoneSelectionSection", () => {
    test("bâtit l'accordéon : en-tête, 3 boutons de zone, sélecteur de zoom, résumé, estimation", async () => {
        // ⚠️ TWO before the itinerary corridor. The assertion stays EXACT rather
        // than "at least two": it is what would catch a fourth button appearing
        // by accident, and loosening it would make invisible exactly what it
        // guards.
        //
        // ⛔ The three COEXIST: the corridor adds, it does not replace the bbox.
        // On an axis-aligned line, the bbox stays cheaper at all zooms
        // (measured).
        installStorage();
        buildZoneSelectionSection(self, parent);
        await flush();

        expect(parent.querySelector(".gl-cache-zone")).toBeTruthy();
        expect(zoneButtons().length).toBe(3);
        const select = parent.querySelector(".gl-cache-zone__zoom-select");
        expect(select.querySelectorAll("option").length).toBe(5); // 12..16
        // the selector is wired on the state (self._zoomCeilingSelect)
        expect(self._zoomCeilingSelect).toBe(select);
        expect(self._zoneSummaryEl.textContent).toContain(""); // "noZone" au départ
        expect(self._zoneEstimateEl).toBeTruthy();
    });

    test("le chevron replie puis déploie le contenu", () => {
        installStorage();
        buildZoneSelectionSection(self, parent);
        const toggle = parent.querySelector(".gl-cache-zone__toggle");
        const content = self._zoneContent;

        toggle.click();
        expect(content.classList.contains("gl-cache-collapsible--collapsed")).toBe(true);
        expect(toggle.textContent).toBe("▲");

        toggle.click();
        expect(content.classList.contains("gl-cache-collapsible--collapsed")).toBe(false);
        expect(toggle.textContent).toBe("▼");
    });
});

describe("applyZone — capture bbox", () => {
    test("« vue courante » (bornes méthode) → persiste la zone et rend résumé + estimation", async () => {
        const store = installStorage();
        buildZoneSelectionSection(self, parent);
        await flush();

        zoneButtons()[0].click(); // vue
        await flush();

        expect(store.saveLayerSelection).toHaveBeenCalled();
        const saved = store.saveLayerSelection.mock.calls.at(-1)[1];
        expect(saved.vectorZone.source).toBe("view");
        expect(saved.vectorZone.bounds.north).toBeCloseTo(48.9);
        expect(self._zoneSummaryEl.textContent).toContain("z");
        expect(self._zoneEstimateEl.textContent).toContain("tiles");
        // totals refreshed
        expect(store.saveSelection).toHaveBeenCalled();
        expect(store.updateWarning).toHaveBeenCalled();
    });

    test("« zone du profil » (getMaxBounds plat) → borne plate lue, minZoom plafonné", async () => {
        self._map = plainMap();
        const store = installStorage();
        buildZoneSelectionSection(self, parent);
        await flush();

        zoneButtons()[1].click(); // profil
        await flush();

        const saved = store.saveLayerSelection.mock.calls.at(-1)[1];
        expect(saved.vectorZone.source).toBe("profile");
        expect(saved.vectorZone.bounds.north).toBe(2); // maxBounds
    });

    test("« zone du profil » sans getMaxBounds → repli sur getBounds", async () => {
        self._map = {
            getBounds: () => ({ north: 5, south: 4, east: 5, west: 4 }),
            getZoom: () => 8,
        };
        const store = installStorage();
        buildZoneSelectionSection(self, parent);
        await flush();

        zoneButtons()[1].click();
        await flush();

        const saved = store.saveLayerSelection.mock.calls.at(-1)[1];
        expect(saved.vectorZone.bounds.north).toBe(5);
    });

    // Red on the shipped bundle's shape before the fix: the adapter the control receives has
    // NO `getMaxBounds` (measured: `typeof map.getMaxBounds === "undefined"`), so this button
    // fell back to `getBounds()` — the current VIEW — and the profile's declared extent was
    // never offered.
    test("« zone du profil » sur l'adaptateur, sans getMaxBounds → l'emprise DÉCLARÉE du profil", async () => {
        self._map = {
            getBounds: () => ({ north: 19.3, south: -52.2, east: -6.7, west: -120.3 }),
            getZoom: () => 4,
        };
        globalThis.GeoLeaf.Config = {
            get: (k, fb) => {
                if (k === "data.activeProfile") return "prof-1";
                if (k === "map.bounds")
                    return [
                        [-55, -73.5],
                        [-21.78, -53.5],
                    ];
                return fb;
            },
        };
        const store = installStorage();
        buildZoneSelectionSection(self, parent);
        await flush();

        zoneButtons()[1].click(); // profil
        await flush();

        const saved = store.saveLayerSelection.mock.calls.at(-1)[1];
        expect(saved.vectorZone.source).toBe("profile");
        expect(saved.vectorZone.bounds).toEqual({
            south: -55,
            west: -73.5,
            north: -21.78,
            east: -53.5,
        });
    });

    test("« zone du profil » : une emprise déclarée malformée ne s'invente pas — repli", async () => {
        self._map = {
            getBounds: () => ({ north: 5, south: 4, east: 5, west: 4 }),
            getZoom: () => 8,
        };
        globalThis.GeoLeaf.Config = {
            get: (k, fb) => {
                if (k === "data.activeProfile") return "prof-1";
                if (k === "map.bounds") return [[-55, "x"], [-21.78]];
                return fb;
            },
        };
        const store = installStorage();
        buildZoneSelectionSection(self, parent);
        await flush();

        zoneButtons()[1].click();
        await flush();

        const saved = store.saveLayerSelection.mock.calls.at(-1)[1];
        expect(saved.vectorZone.bounds.north).toBe(5);
    });

    test("sans carte → avertit, ne persiste rien", async () => {
        self._map = null;
        const store = installStorage();
        buildZoneSelectionSection(self, parent);
        await flush();

        zoneButtons()[0].click();
        await flush();

        expect(store.saveLayerSelection).not.toHaveBeenCalled();
    });

    test("sans LayerSelector, la zone est quand même persistée (refresh best-effort)", async () => {
        const store = installStorage({ withLayerSelector: false });
        buildZoneSelectionSection(self, parent);
        await flush();

        zoneButtons()[0].click();
        await flush();

        expect(store.saveLayerSelection).toHaveBeenCalled();
    });

    test("sans profil actif → persistZone sort sans écrire", async () => {
        setConfig("");
        const store = installStorage();
        buildZoneSelectionSection(self, parent);
        await flush();

        zoneButtons()[0].click();
        await flush();

        expect(store.saveLayerSelection).not.toHaveBeenCalled();
    });
});

describe("onCeilingChange — changement de plafond", () => {
    test("avec une zone préexistante → re-persiste au nouveau plafond", async () => {
        const prior = {
            vectorZone: {
                bounds: { north: 1, south: 0, east: 1, west: 0 },
                cacheMinZoom: 10,
                cacheMaxZoom: 14,
                source: "view",
            },
        };
        const store = installStorage({ selection: prior });
        buildZoneSelectionSection(self, parent);
        await flush();

        const select = parent.querySelector(".gl-cache-zone__zoom-select");
        select.value = "16";
        select.dispatchEvent(new Event("change"));
        await flush();

        expect(store.saveLayerSelection).toHaveBeenCalled();
        const saved = store.saveLayerSelection.mock.calls.at(-1)[1];
        expect(saved.vectorZone.cacheMaxZoom).toBe(16);
    });

    test("sans zone préexistante → le plafond seul est un no-op", async () => {
        const store = installStorage({ selection: null });
        buildZoneSelectionSection(self, parent);
        await flush();

        const select = parent.querySelector(".gl-cache-zone__zoom-select");
        select.value = "12";
        select.dispatchEvent(new Event("change"));
        await flush();

        expect(store.saveLayerSelection).not.toHaveBeenCalled();
    });
});

describe("hydrateZone — restauration au montage", () => {
    test("une zone sauvegardée cale le sélecteur et rend le résumé", async () => {
        installStorage({
            selection: {
                vectorZone: {
                    bounds: { north: 1, south: 0, east: 1, west: 0 },
                    cacheMinZoom: 9,
                    cacheMaxZoom: 15,
                    source: "profile",
                },
            },
        });
        buildZoneSelectionSection(self, parent);
        await flush();

        expect(self._zoomCeilingSelect.value).toBe("15");
        expect(self._zoneSummaryEl.textContent).toContain("z9");
    });

    test("chargement en échec → hydrate silencieusement (pas de zone)", async () => {
        installStorage({ loadThrows: true });
        buildZoneSelectionSection(self, parent);
        await flush();
        // the summary stays on its initial text, no crash
        expect(self._zoneSummaryEl).toBeTruthy();
    });
});

describe("La zone et la liste des couches écrivent la MÊME préférence", () => {
    // 🛑 A LOST UPDATE, MEASURED ON THE SHIPPED BUNDLE. Both writers read the saved selection,
    // change their own half and write the whole back. The layer list reads at the START of
    // `saveSelection()` and writes after all its DOM work and its estimates: a zone persisted
    // in between is overwritten — and the download then pulls the WHOLE collection, with no
    // `bbox`, which is exactly what the zone exists to prevent. `populate()` calls
    // `saveSelection()` on a profile with no saved selection, so the window's own opening is
    // one of the racing writers. Seen on `e2e/54`: one run in two, a request without extent
    // AFTER the witness had seen the zone persisted.

    /** A store that answers with a SNAPSHOT, and whose first write can be held. */
    function statefulStorage() {
        let record = null;
        let releaseFirstSave = () => {};
        let firstSave = true;
        const heldSave = new Promise((resolve) => (releaseFirstSave = resolve));
        const loadLayerSelection = vi.fn(async () => (record ? { ...record } : null));
        const saveLayerSelection = vi.fn(async (_id, selection) => {
            if (firstSave) {
                firstSave = false;
                await heldSave;
            }
            record = { ...selection };
        });
        _installGeoLeafStorage({
            isAvailable: () => true,
            Cache: {
                Storage: { loadLayerSelection, saveLayerSelection },
                LayerSelector: {
                    saveSelection: vi.fn(async () => {}),
                    updateWarning: vi.fn(async () => {}),
                },
            },
        });
        return { current: () => record, releaseFirstSave, loadLayerSelection, saveLayerSelection };
    }

    test("🛑 une zone enregistrée pendant que la liste des couches écrit n'est pas perdue", async () => {
        const store = statefulStorage();
        const layersContent = document.createElement("div");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.layerId = "sites";
        layersContent.appendChild(box);
        LS.init({}, layersContent);
        LS._basemaps = [];

        // The layer list starts writing: it read a selection WITHOUT a zone.
        const listWriting = LS.saveSelection();
        await flush();

        // The user picks the profile's extent while that write is still in flight.
        self._map = plainMap();
        buildZoneSelectionSection(self, parent);
        await flush();
        zoneButtons()[1].click();
        await flush();

        store.releaseFirstSave();
        await listWriting;
        await flush();

        expect(store.current()?.layers).toEqual(["sites"]);
        expect(store.current()?.vectorZone?.source).toBe("profile");
    });
});
