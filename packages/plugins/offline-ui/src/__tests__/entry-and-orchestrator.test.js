/**
 * Unit tests — `entry.ts` and `ui/cache-button.ts`, real coverage.
 *
 * Two SIDE-EFFECT modules, no exports: `entry.ts` registers i18n + the plugin +
 * the toolbar on `globalThis.GeoLeaf` at load; `cache-button.ts` publishes the
 * orchestrator on `GeoLeaf.UI.CacheButton`. We load them dynamically
 * (`vi.resetModules()` first) after preparing the global namespace, which makes
 * the registration observable.
 */
import { vi, describe, test, expect, beforeEach } from "vitest";

beforeEach(() => {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
});

describe("entry.ts", () => {
    test("enregistre les dictionnaires i18n, le plugin et la toolbar", async () => {
        vi.resetModules();
        const registerDict = vi.fn();
        const register = vi.fn();
        const registryRegister = vi.fn();
        globalThis.GeoLeaf = {
            I18n: { registerDict, getLabel: (k) => k },
            plugins: { register },
            registry: { register: registryRegister },
            UI: {},
        };

        await import("../entry.js");

        expect(registerDict).toHaveBeenCalledWith("offline-ui", expect.any(Object));
        expect(register).toHaveBeenCalledWith(
            "offline-ui",
            // `optional` cites `editor`, not `addpoi`: the `Sync` seam's `"poi"`
            // handler did not change identifier, it changed PROVIDER. The
            // assertion stays on the exact value — loosening it to
            // `expect.any(Array)` would let an empty `optional` through, hence a
            // plugin no longer declaring its weak dependency on the replay
            // provider.
            expect.objectContaining({ label: expect.any(String), optional: ["editor"] })
        );
        // the healthCheck reads the Storage facade's presence
        const opts = register.mock.calls[0][1];
        expect(opts.healthCheck()).toBe(false);
        globalThis.GeoLeaf.Storage = {};
        expect(opts.healthCheck()).toBe(true);
        // toolbar registered on the registry
        expect(registryRegister).toHaveBeenCalled();
    });

    test("sans plugins.register → charge sans enregistrer de plugin", async () => {
        vi.resetModules();
        globalThis.GeoLeaf = {
            I18n: { registerDict: vi.fn(), getLabel: (k) => k },
            registry: { register: vi.fn() },
        };
        await expect(import("../entry.js")).resolves.toBeDefined();
    });
});

describe("cache-button.ts (orchestrateur)", () => {
    test("s'enregistre sur GeoLeaf.UI et délègue aux sous-modules", async () => {
        vi.resetModules();
        globalThis.GeoLeaf = { UI: {} };
        await import("../ui/cache-button.js");

        const CB = globalThis.GeoLeaf.UI.CacheButton;
        expect(CB).toBeTruthy();
        expect(CB.Modules.ButtonControl).toBeTruthy();
        expect(CB.Modules.ModalManager).toBeTruthy();
        expect(CB.Modules.ExportLogic).toBeTruthy();

        // Isolate the delegation from the sub-modules' internals.
        const initSpy = vi.spyOn(CB.Modules.ButtonControl, "init").mockReturnValue("ctrl");
        const openSpy = vi.spyOn(CB.Modules.ModalManager, "openModal").mockReturnValue(undefined);
        const closeSpy = vi.spyOn(CB.Modules.ModalManager, "closeModal").mockReturnValue(undefined);

        expect(CB.init({ id: "map" }, { ui: { showCacheButton: true } })).toBe("ctrl");
        expect(initSpy).toHaveBeenCalled();
        CB.openModal();
        expect(openSpy).toHaveBeenCalled();
        CB.closeModal();
        expect(closeSpy).toHaveBeenCalled();
    });

    test("sans GeoLeaf.UI → se charge sans enregistrer (branche `if UI`)", async () => {
        vi.resetModules();
        globalThis.GeoLeaf = {}; // pas de UI
        await expect(import("../ui/cache-button.js")).resolves.toBeDefined();
    });
});
