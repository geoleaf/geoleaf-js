/**
 * Unit tests — `entry.ts` et `ui/cache-button.ts`, couverture réelle (chantier R.31).
 *
 * Deux modules à EFFET DE BORD, sans export : `entry.ts` enregistre i18n + le plugin + la
 * toolbar sur `globalThis.GeoLeaf` au chargement ; `cache-button.ts` publie l'orchestrateur
 * sur `GeoLeaf.UI.CacheButton`. On les charge dynamiquement (`vi.resetModules()` d'abord)
 * après avoir préparé le namespace global, ce qui rend l'enregistrement observable.
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
            // 5.1-f — `optional` cite `editor`, pas `addpoi` : le gestionnaire `"poi"` du seam
            // `Sync` n'a pas changé d'identifiant, il a changé de FOURNISSEUR. L'assertion
            // reste sur la valeur exacte — la relâcher en `expect.any(Array)` laisserait
            // passer un `optional` vide, donc un plugin qui ne déclare plus sa dépendance
            // faible au fournisseur de rejeu.
            expect.objectContaining({ label: expect.any(String), optional: ["editor"] })
        );
        // le healthCheck lit la présence de la façade Storage
        const opts = register.mock.calls[0][1];
        expect(opts.healthCheck()).toBe(false);
        globalThis.GeoLeaf.Storage = {};
        expect(opts.healthCheck()).toBe(true);
        // toolbar enregistrée sur le registre
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

        // Isoler la délégation des internes des sous-modules.
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
