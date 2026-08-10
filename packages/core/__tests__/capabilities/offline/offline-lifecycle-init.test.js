/**
 * Unit tests — `capabilities/offline/lifecycle.ts` OfflineLifecycle.init (gisement offline).
 *
 * `lifecycle-detector-teardown.test.js` couvre `_reset` ; `init` restait le trou (~41 %).
 * On l'exerce en injectant les deps (pur DI, sans accès global) et en espionnant les deux
 * seams réels : `CapabilityRegistry.ensureLoaded` (import dynamique du moteur) et
 * `StorageContract._markReady`. Trois modes : moteur (enabled+pwa+storage), badge seul, rien.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { OfflineLifecycle } from "../../../src/capabilities/offline/lifecycle.js";
import { CapabilityRegistry } from "../../../src/kernel/api/index.js";
import { StorageContract } from "../../../src/kernel/shared/index.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    globalThis.GeoLeaf = {
        ...(globalThis.GeoLeaf ?? {}),
        Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
});

afterEach(() => {
    OfflineLifecycle._reset();
    vi.restoreAllMocks();
});

describe("OfflineLifecycle.init — mode moteur", () => {
    test("enabled + pwa + storage → charge le moteur, init, marque prêt", async () => {
        const ensure = vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const markReady = vi.spyOn(StorageContract, "_markReady");
        const storage = { init: vi.fn(() => Promise.resolve()) };

        OfflineLifecycle.init(
            { storage },
            { enabled: true, pwaEnabled: true, cache: { maxCacheBytes: 5 } }
        );
        await flush();

        expect(ensure).toHaveBeenCalledWith("offline");
        expect(storage.init).toHaveBeenCalledTimes(1);
        // la config cache fusionne les défauts + l'override
        const initArg = storage.init.mock.calls[0][0];
        expect(initArg.cache).toMatchObject({ enableProfileCache: true, maxCacheBytes: 5 });
        expect(markReady).toHaveBeenCalled();
    });

    test("enabled sans pwa → PAS de mode moteur (dépendance gardée)", async () => {
        const ensure = vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        OfflineLifecycle.init({ storage: { init: vi.fn() } }, { enabled: true, pwaEnabled: false });
        await flush();
        expect(ensure).not.toHaveBeenCalled();
    });

    test("chargement du moteur en échec → journalisé, ne jette pas", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockRejectedValue(new Error("chunk KO"));
        const storage = { init: vi.fn() };
        OfflineLifecycle.init({ storage }, { enabled: true, pwaEnabled: true });
        await flush();
        expect(storage.init).not.toHaveBeenCalled();
        expect(globalThis.GeoLeaf.Log.warn).toHaveBeenCalled();
    });

    test("storage.init en échec → journalisé, pas de markReady", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const markReady = vi.spyOn(StorageContract, "_markReady");
        const storage = { init: vi.fn(() => Promise.reject(new Error("IDB KO"))) };
        OfflineLifecycle.init({ storage }, { enabled: true, pwaEnabled: true });
        await flush();
        await flush();
        expect(markReady).not.toHaveBeenCalled();
        expect(globalThis.GeoLeaf.Log.warn).toHaveBeenCalled();
    });
});

describe("OfflineLifecycle.init — mode badge seul", () => {
    test("offline désactivé mais détecteur activé → init le badge", () => {
        const detector = { init: vi.fn(), destroy: vi.fn() };
        OfflineLifecycle.init({ offlineDetector: detector }, { offlineDetectorEnabled: true });
        expect(detector.init).toHaveBeenCalledWith(
            expect.objectContaining({ showBadge: true, badgePosition: "topleft" })
        );
    });

    test("tout désactivé → aucun effet", () => {
        const detector = { init: vi.fn() };
        OfflineLifecycle.init({ offlineDetector: detector }, {});
        expect(detector.init).not.toHaveBeenCalled();
    });
});

describe("OfflineLifecycle._reset", () => {
    test("détruit le détecteur mémorisé et ré-arme la promesse de disponibilité", () => {
        const detector = { init: vi.fn(), destroy: vi.fn() };
        const resetReady = vi.spyOn(StorageContract, "_resetReady");
        OfflineLifecycle.init({ offlineDetector: detector }, { offlineDetectorEnabled: true });

        OfflineLifecycle._reset();

        expect(detector.destroy).toHaveBeenCalled();
        expect(resetReady).toHaveBeenCalled();
    });
});
