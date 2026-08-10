/**
 * Tests unitaires — app/module-registry.ts (Sprint 3)
 *
 * Cas couverts (roadmap tâche 3.4.1) :
 *  1. Enregistrement simple → has() / getAll()
 *  2. Doublon d'id → GeoLeafError
 *  3. Tri topologique — init() appelle dans le bon ordre
 *  4. Dépendance circulaire — GeoLeafError avec chemin du cycle
 *  5. get('inconnu') → GeoLeafError
 *  6. destroy() → ordre inverse de l'init
 *  7. getUISlots() → uniquement les modules avec ui
 *  8. init() rejette si un module.init() rejette
 *  9. register() après init() → stocké SANS erreur (S4, plugins lazy) — ⚠️ cette ligne a dit
 *     « → GeoLeafError » jusqu'au 07/08/2026, alors que le cas 9 lui-même asserte l'inverse
 *     depuis le S4 : l'en-tête décrivait le comportement d'avant, dans le fichier qui prouve
 *     le nouveau
 *  9b. …mais plus en SILENCE (socle-init 7.2) — le warn nomme les deux conséquences
 * 10. Dépendance non enregistrée → GeoLeafError
 * 11. has() → false pour module inconnu
 */
"use strict";

import { ModuleRegistry } from "../../src/app/module-registry.js";
import { GeoLeafError } from "../../src/utils/errors/errors.js";
import { Log } from "../../src/utils/log/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Crée un ICoreModule stub avec init/destroy espionnés.
 * @param {string} id
 * @param {string[]} deps
 * @param {boolean} withUI
 */
function makeModule(id, deps = [], withUI = false) {
    return {
        id,
        dependencies: deps,
        ...(withUI
            ? {
                  ui: {
                      mobileIcon: {
                          icon: "<svg/>",
                          labelKey: `${id}.label`,
                          profileKey: `ui.show${id}`,
                      },
                  },
              }
            : {}),
        init: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn(),
    };
}

// ── Suite principale ───────────────────────────────────────────────────────────

describe("ModuleRegistry (Sprint 3)", () => {
    let registry;

    beforeEach(() => {
        registry = new ModuleRegistry();
    });

    // ── 1. Enregistrement simple ───────────────────────────────────────────────
    describe("register() / has() / getAll()", () => {
        it("has() retourne true après enregistrement", () => {
            const mod = makeModule("alpha");
            registry.register(mod);
            expect(registry.has("alpha")).toBe(true);
        });

        it("has() retourne false pour un module non enregistré", () => {
            expect(registry.has("unknown")).toBe(false);
        });

        it("getAll() contient le module enregistré", () => {
            const mod = makeModule("beta");
            registry.register(mod);
            expect(registry.getAll()).toContain(mod);
        });

        it("getAll() retourne tous les modules dans l'ordre d'insertion", () => {
            const a = makeModule("a");
            const b = makeModule("b");
            registry.register(a);
            registry.register(b);
            const all = registry.getAll();
            expect(all).toHaveLength(2);
            expect(all[0].id).toBe("a");
            expect(all[1].id).toBe("b");
        });
    });

    // ── 2. Doublon d'id — idempotent (S4 lazy-load: plugin re-registers after boot) ─
    it("register() est idempotent si l'id est déjà enregistré", () => {
        const mod = makeModule("dup");
        registry.register(mod);
        expect(() => registry.register(makeModule("dup"))).not.toThrow();
        // Second registration is a no-op — still one entry in the map
        expect(registry.getAll().filter((m) => m.id === "dup")).toHaveLength(1);
    });

    // ── 3. Tri topologique — ordre d'init ─────────────────────────────────────
    it("init() appelle les modules dans l'ordre topologique (A → B → C)", async () => {
        const callOrder = [];
        const modA = makeModule("a");
        const modB = makeModule("b", ["a"]);
        const modC = makeModule("c", ["b"]);
        modA.init.mockImplementation(() => {
            callOrder.push("a");
        });
        modB.init.mockImplementation(() => {
            callOrder.push("b");
        });
        modC.init.mockImplementation(() => {
            callOrder.push("c");
        });

        // Enregistrement dans un ordre différent pour valider que le registry trie
        registry.register(modC);
        registry.register(modA);
        registry.register(modB);

        await registry.init(null, null);

        expect(callOrder).toEqual(["a", "b", "c"]);
    });

    it("init() résout correctement une arborescence en diamant (A→B, A→C, B→D, C→D)", async () => {
        const callOrder = [];
        const a = makeModule("a");
        const b = makeModule("b", ["a"]);
        const c = makeModule("c", ["a"]);
        const d = makeModule("d", ["b", "c"]);
        [a, b, c, d].forEach((m) => {
            m.init.mockImplementation(() => {
                callOrder.push(m.id);
            });
            registry.register(m);
        });

        await registry.init(null, null);

        // A doit être avant B et C ; B et C avant D
        expect(callOrder.indexOf("a")).toBeLessThan(callOrder.indexOf("b"));
        expect(callOrder.indexOf("a")).toBeLessThan(callOrder.indexOf("c"));
        expect(callOrder.indexOf("b")).toBeLessThan(callOrder.indexOf("d"));
        expect(callOrder.indexOf("c")).toBeLessThan(callOrder.indexOf("d"));
    });

    // ── 4. Dépendance circulaire ───────────────────────────────────────────────
    it("init() lève GeoLeafError lorsqu'un cycle est détecté (X → Y → X)", async () => {
        registry.register(makeModule("x", ["y"]));
        registry.register(makeModule("y", ["x"]));

        await expect(registry.init(null, null)).rejects.toThrow(GeoLeafError);
        await expect(registry.init(null, null)).rejects.toThrow(/x|y/);
    });

    it("init() lève GeoLeafError pour un cycle à trois nœuds (A → B → C → A)", async () => {
        registry.register(makeModule("ca", ["cc"]));
        registry.register(makeModule("cb", ["ca"]));
        registry.register(makeModule("cc", ["cb"]));

        await expect(registry.init(null, null)).rejects.toThrow(GeoLeafError);
    });

    // ── 5. get() — id inconnu ─────────────────────────────────────────────────
    it("get() lève GeoLeafError si le module n'existe pas", () => {
        expect(() => registry.get("nope")).toThrow(GeoLeafError);
        expect(() => registry.get("nope")).toThrow(/nope/);
    });

    it("get() retourne le module enregistré", async () => {
        const mod = makeModule("found");
        registry.register(mod);
        await registry.init(null, null);
        expect(registry.get("found")).toBe(mod);
    });

    // ── 6. destroy() — ordre inverse ──────────────────────────────────────────
    it("destroy() appelle destroy() dans l'ordre inverse de l'init", async () => {
        const callOrder = [];
        const a = makeModule("da");
        const b = makeModule("db", ["da"]);
        const c = makeModule("dc", ["db"]);
        a.destroy.mockImplementation(() => {
            callOrder.push("da");
        });
        b.destroy.mockImplementation(() => {
            callOrder.push("db");
        });
        c.destroy.mockImplementation(() => {
            callOrder.push("dc");
        });
        [a, b, c].forEach((m) => registry.register(m));

        await registry.init(null, null);
        registry.destroy();

        expect(callOrder).toEqual(["dc", "db", "da"]);
    });

    it("destroy() ne lève pas si un module.destroy() échoue", async () => {
        const mod = makeModule("bad");
        mod.destroy.mockImplementation(() => {
            throw new Error("destroy failure");
        });
        registry.register(mod);
        await registry.init(null, null);

        expect(() => registry.destroy()).not.toThrow();
    });

    // ── destroy() ré-arme le registre (S6 Lot 1) ───────────────────────────────
    // `destroy()` détruisait les modules mais ne remettait jamais `_initialized` à false,
    // donc `init()` sortait ensuite sur son garde idempotent : le cycle create → destroy →
    // recreate était un NO-OP SILENCIEUX. Resté invisible parce que `registry.destroy()` n'a
    // aucun appelant de production (le teardown réel passe par `registerLifecycleTeardown`),
    // et parce que les 2 tests qui en avaient besoin forçaient la privée `_initialized = false`
    // au lieu d'appeler `destroy()` — ils contournaient le bug qu'ils auraient pu révéler.
    it("destroy() ré-arme le registre : init → destroy → init ré-initialise les modules", async () => {
        const mod = makeModule("recreate-me");
        registry.register(mod);

        await registry.init(null, null);
        expect(mod.init).toHaveBeenCalledTimes(1);
        expect(registry.isInitialized()).toBe(true);

        registry.destroy();
        expect(mod.destroy).toHaveBeenCalledTimes(1);
        expect(registry.isInitialized()).toBe(false);

        await registry.init(null, null);
        expect(mod.init).toHaveBeenCalledTimes(2);
        expect(registry.isInitialized()).toBe(true);
    });

    it("destroy() est idempotent — un second appel ne re-détruit pas les modules", async () => {
        const mod = makeModule("destroy-twice");
        registry.register(mod);
        await registry.init(null, null);

        registry.destroy();
        registry.destroy();

        // `_initOrder` vidé ⇒ la seconde passe n'a plus rien à parcourir.
        expect(mod.destroy).toHaveBeenCalledTimes(1);
    });

    it("destroy() conserve les modules enregistrés — sinon aucun recreate n'est possible", async () => {
        // `_modules` ne doit PAS être vidé : les 8 modules kernel sont enregistrés une seule
        // fois, à l'évaluation du bundle (`boot-install.ts:115-128`). Les purger rendrait tout
        // recreate impossible — le registre serait vide et `init()` n'aurait rien à faire.
        const mod = makeModule("survivor");
        registry.register(mod);
        await registry.init(null, null);

        registry.destroy();

        expect(registry.has("survivor")).toBe(true);
        expect(registry.getAll()).toHaveLength(1);
    });

    // ── 7. getUISlots() ────────────────────────────────────────────────────────
    it("getUISlots() retourne uniquement les modules qui ont un slot ui", async () => {
        registry.register(makeModule("no-ui-a"));
        registry.register(makeModule("with-ui", [], true));
        registry.register(makeModule("no-ui-b"));

        const slots = registry.getUISlots();
        expect(slots).toHaveLength(1);
        expect(slots[0].mobileIcon.labelKey).toBe("with-ui.label");
    });

    it("getUISlots() retourne un tableau vide si aucun module n'a de ui", () => {
        registry.register(makeModule("plain-a"));
        registry.register(makeModule("plain-b"));
        expect(registry.getUISlots()).toEqual([]);
    });

    // ── 8. init() rejette si un module.init() rejette ─────────────────────────
    it("init() rejette avec l'erreur du module si module.init() lève", async () => {
        const good = makeModule("g1");
        const bad = makeModule("g2", ["g1"]);
        const boom = new Error("module boom");
        bad.init.mockRejectedValue(boom);

        registry.register(good);
        registry.register(bad);

        await expect(registry.init(null, null)).rejects.toThrow("module boom");
    });

    // ── 9. register() après init() — S4: autorisé pour les plugins lazy ──────────
    it("register() après init() stocke le module sans lancer d'erreur (plugins lazy)", async () => {
        registry.register(makeModule("early"));
        await registry.init(null, null);

        // Late registration must not throw (lazy-loaded plugins call register() post-boot).
        expect(() => registry.register(makeModule("late"))).not.toThrow();
        // Module is stored for UI queries (getAll / get) even if lifecycle init is not called.
        expect(registry.get("late")).not.toBeNull();
    });

    // ── 9b. …mais il ne le fait plus EN SILENCE (socle-init 7.2) ────────────────
    // Le silence était le vrai défaut : le module est bien enregistré, l'introspection le
    // confirme, et rien n'apparaît — ce qui fait chercher un problème d'ORDRE là où il n'y
    // en a pas. Le warn doit nommer les DEUX conséquences, pas seulement `init()`.
    describe("9b. register() post-init avertit — le silence de 7.2", () => {
        it("avertit en nommant le module, les deux conséquences, et la voie supportée", async () => {
            const warn = vi.spyOn(Log, "warn").mockImplementation(() => {});
            try {
                registry.register(makeModule("early"));
                await registry.init(null, null);
                warn.mockClear(); // ignorer tout warn émis pendant le boot lui-même

                registry.register(makeModule("late", [], true));

                expect(warn).toHaveBeenCalledTimes(1);
                const msg = warn.mock.calls[0][0];
                expect(msg).toContain("late"); // le module est NOMMÉ
                expect(msg).toContain("init()"); // conséquence 1
                expect(msg).toContain("UI slot"); // conséquence 2 — le corollaire non documenté
                expect(msg).toContain("registerLazyForAction"); // la voie supportée
            } finally {
                warn.mockRestore();
            }
        });

        it("ne dit rien AVANT init() — le chemin normal reste muet", () => {
            const warn = vi.spyOn(Log, "warn").mockImplementation(() => {});
            try {
                registry.register(makeModule("eager-a"));
                registry.register(makeModule("eager-b", [], true));
                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });

        it("ne dit rien sur un ré-enregistrement du même id — c'est idempotent, pas fautif", async () => {
            const warn = vi.spyOn(Log, "warn").mockImplementation(() => {});
            try {
                registry.register(makeModule("twice"));
                await registry.init(null, null);
                warn.mockClear();

                registry.register(makeModule("twice")); // même id, déjà présent
                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });
    });

    // ── 10. Dépendance non enregistrée ────────────────────────────────────────
    it("init() lève GeoLeafError si une dépendance déclarée n'est pas enregistrée", async () => {
        registry.register(makeModule("orphan", ["missing-dep"]));

        await expect(registry.init(null, null)).rejects.toThrow(GeoLeafError);
        await expect(registry.init(null, null)).rejects.toThrow(/missing-dep/);
    });

    // ── 11. init() idempotent (second appel = no-op) ──────────────────────────
    it("init() est idempotent — un second appel retourne sans ré-initialiser", async () => {
        const mod = makeModule("once");
        registry.register(mod);

        await registry.init(null, null);
        await registry.init(null, null); // second call

        expect(mod.init).toHaveBeenCalledTimes(1);
    });

    // ════════════════════════════════════════════════════════════════════════
    //  S0 — delta filet de sécurité (roadmap boot-di-lifecycle)
    // ════════════════════════════════════════════════════════════════════════

    // ── S0.2 — branche `?? []` : module sans propriété `dependencies` ──────────
    it("init() tolère un module sans propriété `dependencies` (guard `?? []`)", async () => {
        // makeModule fournit toujours `dependencies` → on enregistre un objet brut
        // sans cette clé pour exercer réellement `mod.dependencies ?? []`.
        const noDeps = {
            id: "nodeps",
            init: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn(),
        };
        registry.register(noDeps);

        await expect(registry.init(null, null)).resolves.toBeUndefined();
        expect(noDeps.init).toHaveBeenCalledTimes(1);
    });

    // ── S0.2 — message de cycle : chemin complet exact `a → b → a` ─────────────
    it("init() expose le chemin de cycle complet `a → b → a` dans le message", async () => {
        registry.register(makeModule("a", ["b"]));
        registry.register(makeModule("b", ["a"]));

        await expect(registry.init(null, null)).rejects.toThrow(
            "circular dependency detected: a → b → a"
        );
    });

    // ── S0.3 — guard de forme : module lifecycle incomplet rejeté ──────────────
    it("register() lève GeoLeafError si un module déclare init sans destroy", () => {
        expect(() => registry.register({ id: "half", dependencies: [], init: vi.fn() })).toThrow(
            GeoLeafError
        );
    });

    it("register() lève GeoLeafError si init n'est pas une fonction", () => {
        expect(() =>
            registry.register({ id: "badinit", dependencies: [], init: 42, destroy: vi.fn() })
        ).toThrow(GeoLeafError);
    });

    it("register() lève GeoLeafError si destroy n'est pas une fonction", () => {
        expect(() =>
            registry.register({ id: "baddestroy", dependencies: [], init: vi.fn(), destroy: {} })
        ).toThrow(GeoLeafError);
    });

    it("register() lève GeoLeafError pour un objet ni lifecycle ni slot UI (`{ id }` seul)", () => {
        expect(() => registry.register({ id: "empty" })).toThrow(GeoLeafError);
    });

    // ── S0.3 — tolérance slot UI-only `{ id, ui }` (sans init/destroy) ─────────
    it("register() accepte un slot UI-only `{ id, ui }` et l'expose via getUISlots()", () => {
        const slot = {
            id: "storage",
            ui: {
                mobileIcon: { icon: "<svg/>", labelKey: "storage.label", profileKey: "ui.show" },
            },
        };
        expect(() => registry.register(slot)).not.toThrow();
        const slots = registry.getUISlots();
        expect(slots).toHaveLength(1);
        expect(slots[0].mobileIcon.labelKey).toBe("storage.label");
    });

    it("init()/destroy() ignorent un slot UI-only présent dans l'ordre (sans lever)", async () => {
        const lifecycle = makeModule("lc");
        const uiSlot = {
            id: "ui-only",
            ui: { mobileIcon: { icon: "<svg/>", labelKey: "x.label", profileKey: "ui.x" } },
        };
        registry.register(lifecycle);
        registry.register(uiSlot); // enregistré avant init → présent dans _initOrder

        await expect(registry.init(null, null)).resolves.toBeUndefined();
        expect(lifecycle.init).toHaveBeenCalledTimes(1); // slot UI ignoré, pas d'erreur
        expect(() => registry.destroy()).not.toThrow();
        expect(lifecycle.destroy).toHaveBeenCalledTimes(1);
    });

    // ── S1.5 — API d'introspection ─────────────────────────────────────────────
    it("getActiveModules() retourne les modules sans gate avec id/dependencies/hasUI", () => {
        registry.register(makeModule("security", []));
        registry.register(makeModule("poi", ["security"]));
        const modules = registry.getActiveModules();
        expect(modules).toHaveLength(2);
        const ids = modules.map((m) => m.id);
        expect(ids).toContain("security");
        expect(ids).toContain("poi");
        const poi = modules.find((m) => m.id === "poi");
        expect(poi.dependencies).toEqual(["security"]);
        expect(poi.hasUI).toBe(false);
    });

    // socle-init 9.3 — depuis 9.2, un module éteint EST enregistré. Sans ce filtre, une
    // méthode nommée `getActiveModules` répondrait « enregistrés » à une question qui demande
    // « actifs », et l'introspection annoncerait à l'intégrateur des capacités éteintes.
    it("getActiveModules() écarte un module dont l'enrobage répond isEnabled() === false", () => {
        registry.register(makeModule("security", []));
        registry.register({ ...makeModule("gated-off", []), isEnabled: () => false });
        registry.register({ ...makeModule("gated-on", []), isEnabled: () => true });

        const ids = registry.getActiveModules().map((m) => m.id);

        expect(ids).toEqual(["security", "gated-on"]);
        // Enregistré ≠ actif : `getModuleSchema()` répond, lui, sur l'enregistrement.
        expect(registry.getModuleSchema("gated-off")).not.toBeNull();
    });

    it("getModuleSchema('security') retourne { id, dependencies, hasUI } pour un module connu", () => {
        registry.register(makeModule("security", []));
        const schema = registry.getModuleSchema("security");
        expect(schema).toEqual({ id: "security", dependencies: [], hasUI: false });
    });

    it("getModuleSchema('unknown') retourne null pour un module inconnu", () => {
        expect(registry.getModuleSchema("unknown-id-xyz")).toBeNull();
    });
});
