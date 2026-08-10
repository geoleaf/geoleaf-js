/**
 * Config-contract Phase C / C6 — B7 modules.offline consumed by the CORE (S14 Phase B).
 *
 * The core reads cfg.modules.offline at the OfflineLifecycle seam (shared.module #8):
 * when `modules.offline.enabled` ∧ `modules.pwa.enabled`, it loads the engine on demand
 * (CapabilityRegistry.ensureLoaded) then calls Storage.init, SPREADING true/true cache
 * defaults so a partial profile cache block cannot silently drop a flag:
 *   cache: { enableProfileCache: true, enableTileCache: true, ...cfg.modules.offline.cache }
 *
 * @anomaly ANO-078 — DEFAULT INCOHERENCE: this core half defaults true/true, while the
 * plugin UI half (plugin-storage layer-selector/core.ts) defaults true (UI fallback).
 * S15 LOCKS the core half live; the plugin half is asserted in the plugin-storage suite.
 *
 * `ensureLoaded` is stubbed so the real engine chunk is not imported in this app-boot test.
 */

import { makeFakeMap, populateInitGeoLeaf, stubPerformance } from "./_helpers/config-harness.js";

// ─── vi.hoisted: mocks available before static imports (module classes capture _g) ──
const mocks = vi.hoisted(() => {
    const AppLog = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const GeoLeaf = {
        _app: { AppLog, checkPlugins: vi.fn(), showNotification: vi.fn().mockReturnValue(true) },
    };
    return {
        GeoLeaf,
        padBounds: vi.fn((bounds, margin) => ({ __padded: true, margin, src: bounds })),
        initBasemaps: vi.fn(),
        initPOI: vi.fn(),
        initGeoJSON: vi.fn(),
        initUIPanels: vi.fn(),
        initI18n: vi.fn(),
    };
});

vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => mocks.GeoLeaf,
    getGeoLeaf: () => mocks.GeoLeaf,
}));
vi.mock("../../src/app/init-features.js", () => ({
    initBasemaps: mocks.initBasemaps,
    initPOI: mocks.initPOI,
    initGeoJSON: mocks.initGeoJSON,
    initUIPanels: mocks.initUIPanels,
}));
vi.mock("../../src/kernel/map/map-container.js", () => ({ padBounds: mocks.padBounds }));
vi.mock("../../src/utils/i18n/i18n.js", () => ({
    initI18n: mocks.initI18n,
    getLabel: vi.fn((key) => key),
}));
// S1.2: logic migrated from initApp() → CoreMapModule/SharedModule/UIModule directly
import { CoreMapModule } from "../../src/app/boot-modules/core-map.module.ts";
import { SharedModule } from "../../src/app/boot-modules/shared.module.ts";
import { UIModule } from "../../src/app/boot-modules/ui.module.ts";
import { CapabilityRegistry } from "../../src/kernel/api/capability-registry.ts";
import { PWA_INSTALLER } from "../../src/capabilities/pwa/install.ts";
import { OFFLINE_INSTALLER } from "../../src/capabilities/offline/install.ts";

const GeoLeaf = mocks.GeoLeaf;

// The app-global capability lifecycles `shared.module` drives (#7 pwa → #8 offline).
// Since S4 the kernel no longer imports them — the seam under test IS OfflineLifecycle,
// so it must be contributed explicitly.
//
// ⚠️ This list MIRRORS production order; it is not a constraint. The comment here read « Order
// is load-bearing: offline reads `modules.pwa.enabled` » until 08/08/2026, and socle-init 7.4
// measured that false — `shared-lifecycle-order.test.ts` inverts the pair with no observable
// difference. What IS load-bearing, and what this file's teardown test at the bottom asserts, is
// the MECHANISM: `SharedModule.destroy()` walks the list backwards. Keep the two apart — the
// mechanism is real, the ordinal dependency was not.
const APP_GLOBAL = [PWA_INSTALLER, OFFLINE_INSTALLER];
const VALID_MAP = {
    bounds: [
        [43, 1],
        [44, 2],
    ],
    initialMaxZoom: 10,
};

describe("config B7 — modules.offline @ OfflineLifecycle seam (@anomaly ANO-078 core half)", () => {
    let fakeMap;
    const realAddEventListener = document.addEventListener.bind(document);

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(GeoLeaf).forEach((k) => {
            if (k !== "_app") delete GeoLeaf[k];
        });
        // Capture (don't register) UIModule's deferred-UI listener so it never
        // accumulates on `document` across runs.
        vi.spyOn(document, "addEventListener").mockImplementation((type, handler, opts) => {
            if (type === "geoleaf:app:ready") return;
            return realAddEventListener(type, handler, opts);
        });
        fakeMap = makeFakeMap();
        document.body.innerHTML = "";
        const loader = document.createElement("div");
        loader.id = "gl-loader";
        document.body.appendChild(loader);
        stubPerformance();
    });

    afterEach(() => vi.restoreAllMocks());

    /**
     * Run the boot module sequence with offline enabled + a Storage stub; return the
     * config Storage.init received. `offlineCache` (optional) becomes `modules.offline.cache`.
     */
    async function runStorageInit(offlineCache) {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const Storage = {
            init: vi.fn().mockResolvedValue(undefined),
            DB: {},
            wireModules: vi.fn(),
        };
        populateInitGeoLeaf(GeoLeaf, fakeMap, { Storage });
        const cfg = {
            map: { ...VALID_MAP },
            modules: {
                offline: { enabled: true, ...(offlineCache ? { cache: offlineCache } : {}) },
                pwa: { enabled: true },
            },
        };
        new CoreMapModule().init(null, cfg);
        new SharedModule(APP_GLOBAL).init(null, cfg);
        await new UIModule().init(null, cfg);
        await new Promise((r) => setTimeout(r, 20)); // flush ensureLoaded().then()
        return Storage.init.mock.calls[0]?.[0];
    }

    // ⚠️ RÉÉCRITS à la tâche 3.13. Les deux assertions portaient « cache defaults true/true »,
    // c'est-à-dire qu'elles épinglaient la recopie de `enableTileCache` dans l'argument de
    // `Storage.init` — un défaut que RIEN dans le core ne lisait. Elles prouvaient donc qu'un
    // réglage sans effet était bien transmis. Le drapeau a désormais un lecteur unique et
    // direct (`ResourceEnumerator._tilesRequested`), et il n'a plus à traverser ce seam.
    // ANO-078 n'est pas relâchée pour autant : ce qu'elle garde — une surcharge partielle ne
    // doit pas faire tomber les autres défauts — reste éprouvé sur `enableProfileCache`.
    it("live: no cache override → core applies the profile-cache default", async () => {
        const initArg = await runStorageInit(undefined);
        expect(initArg.cache).toEqual({ enableProfileCache: true });
        expect(initArg.enableOfflineDetector).toBe(false);
        expect(initArg).not.toHaveProperty("enableServiceWorker");
    });

    it("live: a profile override reaches the seam untouched, and drops nothing else", async () => {
        const initArg = await runStorageInit({ enableProfileCache: false });
        expect(initArg.cache).toEqual({ enableProfileCache: false });
    });

    it("live: `enableTileCache` no longer travels through this seam — it is read directly", async () => {
        // Garde de non-retour : si quelqu'un remet le drapeau en défaut ici, il redevient une
        // SECONDE vérité face à celle que lit l'énumérateur, et les deux dérivent en silence.
        // C'est exactement la forme de la cause racine n° 2 du sprint.
        // Ce qu'un profil pose traverse le seam tel quel — le core ne le RÉÉCRIT pas…
        const withFlag = await runStorageInit({ enableTileCache: false });
        expect(withFlag.cache.enableTileCache).toBe(false);
        // …mais quand le profil se tait, le core n'INVENTE plus de valeur. C'est la moitié
        // qui compte : une clé absente ne peut pas diverger de celle que lit l'énumérateur.
        const withoutFlag = await runStorageInit(undefined);
        expect(withoutFlag.cache).not.toHaveProperty("enableTileCache");
    });

    it("SW / offline-detector are owned by modules.pwa — never in the Storage.init arg", async () => {
        const initArg = await runStorageInit(undefined);
        expect(initArg).not.toHaveProperty("enableServiceWorker");
        expect(initArg.enableOfflineDetector).toBe(false);
    });

    // The plugin half of ANO-078 (plugin-storage layer-selector/core.ts) is plugin-owned
    // → assert in the plugin-storage suite, not here.
    it.todo(
        "@anomaly ANO-078 plugin half — layer-selector UI-fallback default → plugin-storage suite"
    );
});

// ── S4 (roadmap nettoyage) — sharedTeardown ─────────────────────────────────
// `SharedModule.init()` runs each installer's `sharedLifecycle` (#7 pwa → #8 offline).
// Until S4 `destroy()` ran no teardown at all, so pwa/offline kept their module-level
// state across create → destroy → recreate: the next init re-ran over stale state.
describe("shared.module — sharedTeardown (S4)", () => {
    it("destroy() calls each contributed sharedTeardown, in reverse manifest order", () => {
        const calls = [];
        const first = { id: "first", sharedTeardown: () => calls.push("first") };
        const second = { id: "second", sharedTeardown: () => calls.push("second") };

        new SharedModule([first, second]).destroy();

        // Mirror of init()'s order: the last installer unwinds first.
        expect(calls).toEqual(["second", "first"]);
    });

    it("destroy() ignores an installer that contributes no teardown", () => {
        const withTeardown = { id: "with", sharedTeardown: vi.fn() };
        const without = { id: "without" };

        expect(() => new SharedModule([without, withTeardown]).destroy()).not.toThrow();
        expect(withTeardown.sharedTeardown).toHaveBeenCalledTimes(1);
    });

    it("the real pwa/offline installers both contribute a teardown", () => {
        expect(typeof PWA_INSTALLER.sharedTeardown).toBe("function");
        expect(typeof OFFLINE_INSTALLER.sharedTeardown).toBe("function");
    });
});
