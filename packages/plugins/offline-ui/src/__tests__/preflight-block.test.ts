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
        session: null,
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

describe("the write session, as its holder told the core", () => {
    const sessionLine = (self: any) =>
        self._container.querySelector(".gl-cache-preflight__session") as HTMLElement | null;

    test.each([
        ["expired", "storage.preflight.session.expired"],
        ["absent", "storage.preflight.session.absent"],
    ])("a session %s is said", async (state, label) => {
        check.session = { state, expiresAt: state === "expired" ? 1 : null };
        const self = await mount();
        expect(sessionLine(self)?.hidden).toBe(false);
        expect(sessionLine(self)?.getAttribute("data-session")).toBe(state);
        expect(sessionLine(self)?.textContent).toBe(label);
        cleanup(self);
    });

    test("a valid session says until when — a clock reading, which a trip is compared with", async () => {
        const expiresAt = Date.UTC(2026, 8, 26, 14, 32);
        check.session = { state: "valid", expiresAt };
        const self = await mount();
        const line = sessionLine(self);
        expect(line?.getAttribute("data-session")).toBe("valid");
        const clock = new Date(expiresAt).toLocaleString(undefined, {
            dateStyle: "short",
            timeStyle: "short",
        });
        expect(line?.textContent).toBe(`storage.preflight.session.valid(${clock})`);
        cleanup(self);
    });

    test("a valid session whose holder does not know the expiry says only that it is open", async () => {
        check.session = { state: "valid", expiresAt: null };
        const self = await mount();
        expect(sessionLine(self)?.textContent).toBe("storage.preflight.session.validNoExpiry");
        cleanup(self);
    });

    test.each([
        ["nobody told it", (c: any) => (c.session = null)],
        ["a core older than 3.11.0 answers without the field", (c: any) => delete c.session],
    ])("hidden when %s — no session is guessed", async (_what, strip) => {
        strip(check);
        const self = await mount();
        expect(sessionLine(self)?.hidden).toBe(true);
        cleanup(self);
    });

    test("re-read when the session changes — a sign-in from the window shows at once", async () => {
        const self = await mount();
        expect(sessionLine(self)?.hidden).toBe(true);
        check = { ...check, session: { state: "valid", expiresAt: null } };
        document.dispatchEvent(new CustomEvent("geoleaf:connector:authenticated"));
        await settle();
        expect(sessionLine(self)?.getAttribute("data-session")).toBe("valid");
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
