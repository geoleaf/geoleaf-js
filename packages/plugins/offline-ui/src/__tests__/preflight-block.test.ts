/**
 * "Can I leave?" — the check the cache modal shows before going off-network.
 *
 * The facts come from the core in one read (`GeoLeaf.Storage.preflight()`); this block says
 * them, and says them where one prepares the device — next to the download. It must NOT judge
 * anything itself: the verdict is the core's, so a second opinion here could only disagree.
 *
 * ⚠️ The modules under test are reached through the built `CacheControl` state object, whose
 * shape the package types loosely on purpose; `any` is the honest form for the doubles here.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

import { buildStructure } from "../cache/cache-control-dom.js";
import { cleanup } from "../cache/cache-control-events.js";
import { updateStatus } from "../cache/cache-control-state.js";

let check: any;

function installGeoLeaf() {
    (globalThis as any).GeoLeaf = {
        I18n: {
            getLabel: (key: string, ...args: string[]) =>
                args.length ? `${key}(${args.join(",")})` : key,
        },
        Storage: {
            isPluginLoaded: () => true,
            isAvailable: () => true,
            getSyncStatus: () =>
                Promise.resolve({ online: true, owed: 0, quarantined: 0, lastSyncAt: null }),
            preflight: () => Promise.resolve(check),
            CacheManager: {
                getCacheStatus: () => Promise.resolve({ resourcesCount: 1, size: 1 }),
                getStorageQuota: () => Promise.resolve({ usage: 0, quota: 100 }),
            },
        },
    };
}

function makeSelf(): any {
    const self: any = {
        options: { position: "topright", collapsed: false, collapsible: false },
        _eventCleanups: [],
        _map: null,
        _container: document.createElement("div"),
        _bodyEl: null,
    };
    self._container.className = "gl-cache-control";
    self._updateStatus = vi.fn().mockResolvedValue(undefined);
    self._populateLayerSelection = vi.fn().mockResolvedValue(undefined);
    self._attachEventListeners = vi.fn();
    self._handleDownload = vi.fn(() => Promise.resolve());
    self._handleClear = vi.fn(() => Promise.resolve());
    self._handleStop = vi.fn();
    self._toggleCollapsed = vi.fn();
    return self;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

const layer = (layerId: string, status: string) => ({
    layerId,
    status,
    featureCount: 0,
    pendingCount: 0,
    quarantinedCount: 0,
    lastPullAt: null,
});

beforeEach(() => {
    installGeoLeaf();
    check = {
        at: 0,
        verdict: "notReady",
        persistence: "bestEffort",
        quota: { used: 1, quota: 100, percentage: 1 },
        layers: [layer("sites", "declaredNeverPulled"), layer("routes", "pulled")],
        queue: { online: true, owed: 0, quarantined: 0, lastSyncAt: null },
        preparation: null,
    };
});

afterEach(() => {
    delete (globalThis as any).GeoLeaf;
    vi.restoreAllMocks();
});

async function mount() {
    const self = makeSelf();
    buildStructure(self);
    await settle();
    return self;
}

describe("the check says what the core read", () => {
    test("a layer never pulled is flagged; a pulled one is not", async () => {
        const self = await mount();
        const rows = [...self._container.querySelectorAll(".gl-cache-preflight__layer")];
        const byId = (id: string) => rows.find((r: any) => r.dataset.layerId === id) as any;
        expect(byId("sites")?.getAttribute("data-status")).toBe("declaredNeverPulled");
        expect(byId("sites")?.getAttribute("data-alert")).toBe("true");
        expect(byId("routes")?.getAttribute("data-alert")).toBe("false");
        cleanup(self);
    });

    test("the verdict is the core's, shown as is", async () => {
        const self = await mount();
        const root = self._container.querySelector(".gl-cache-preflight");
        expect(root?.getAttribute("data-verdict")).toBe("notReady");
        expect(root?.getAttribute("role")).toBe("status");
        cleanup(self);
    });

    test("the persistence verdict of the browser is shown — the one the PWA used to log", async () => {
        const self = await mount();
        const persistence = self._container.querySelector(".gl-cache-preflight__persistence");
        expect(persistence?.getAttribute("data-persistence")).toBe("bestEffort");
        expect(persistence?.textContent).toContain("storage.preflight.persistence.bestEffort");
        cleanup(self);
    });

    test("zooms a preparation left out are named", async () => {
        check.verdict = "degraded";
        check.layers = [layer("sites", "pulled")];
        check.preparation = {
            cachedAt: 1,
            failedResources: 0,
            tiles: {
                zone: null,
                skippedZooms: [{ source: "fond", zoom: 16, tiles: 9 }],
                capped: false,
            },
        };
        const self = await mount();
        const tiles = self._container.querySelector(".gl-cache-preflight__tiles");
        expect(tiles?.hidden).toBe(false);
        expect(tiles?.textContent).toContain("fond");
        expect(tiles?.textContent).toContain("16");
        cleanup(self);
    });
});

describe("it stays current", () => {
    test("re-read when the control updates its status — after the download, pull included", async () => {
        // 🛑 NOT on `geoleaf:cache:completed`: the downloader emits it when the RESOURCES are in,
        // before `cacheProfile` pulls the entities and writes their state. Re-read there, the
        // check showed a layer just downloaded as never downloaded — measured on the shipped
        // bundle (e2e/61). The status update runs once `cacheProfile` has resolved.
        const self = await mount();
        check = { ...check, verdict: "degraded", layers: [layer("sites", "pulled")] };
        await updateStatus(self);
        await settle();
        const row = self._container.querySelector(
            '.gl-cache-preflight__layer[data-layer-id="sites"]'
        );
        expect(row?.getAttribute("data-alert")).toBe("false");
        cleanup(self);
    });

    test("an older core without the member: the block stays hidden, nothing throws", async () => {
        delete (globalThis as any).GeoLeaf.Storage.preflight;
        const self = await mount();
        expect(self._container.querySelector(".gl-cache-preflight")?.hidden).toBe(true);
        cleanup(self);
    });
});
