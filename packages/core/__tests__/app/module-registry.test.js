/**
 * Tests unitaires — app/module-registry.ts
 *
 * Covered cases:
 *  1. Simple registration → has() / getAll()
 *  2. Duplicate id → GeoLeafError
 *  3. Topological sort — init() calls in the right order
 *  4. Circular dependency — GeoLeafError with the cycle's path
 *  5. get('unknown') → GeoLeafError
 *  6. destroy() → reverse init order
 *  7. getUISlots() → only modules with ui
 *  8. init() rejects if a module.init() rejects
 *  9. register() after init() → stored WITHOUT error (lazy plugins) — ⚠️ this
 *     line said "→ GeoLeafError" until 07/08/2026, while case 9 itself has
 *     asserted the opposite since lazy plugins landed: the header described
 *     the old behaviour, in the file that proves the new one
 *  9b. …but no longer SILENTLY — the warn names both consequences
 * 10. Unregistered dependency → GeoLeafError
 * 11. has() → false for an unknown module
 */
"use strict";

import { ModuleRegistry } from "../../src/app/module-registry.js";
import { GeoLeafError } from "../../src/utils/errors/errors.js";
import { Log } from "../../src/utils/log/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Creates an ICoreModule stub with spied init/destroy.
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

describe("ModuleRegistry", () => {
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

        // Registered in a different order to validate that the registry sorts
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

        // A must come before B and C; B and C before D
        expect(callOrder.indexOf("a")).toBeLessThan(callOrder.indexOf("b"));
        expect(callOrder.indexOf("a")).toBeLessThan(callOrder.indexOf("c"));
        expect(callOrder.indexOf("b")).toBeLessThan(callOrder.indexOf("d"));
        expect(callOrder.indexOf("c")).toBeLessThan(callOrder.indexOf("d"));
    });

    // ── 4. Circular dependency ─────────────────────────────────────────────────
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

    // ── destroy() re-arms the registry ─────────────────────────────────────────
    // `destroy()` destroyed the modules but never reset `_initialized` to
    // false, so `init()` then exited on its idempotence guard: the create →
    // destroy → recreate cycle was a SILENT NO-OP. It stayed invisible
    // because `registry.destroy()` has no production caller (the real
    // teardown goes through `registerLifecycleTeardown`), and because the 2
    // tests that needed it forced the private `_initialized = false` instead
    // of calling `destroy()` — they worked around the bug they could have revealed.
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

        // `_initOrder` emptied ⇒ the second pass has nothing left to walk.
        expect(mod.destroy).toHaveBeenCalledTimes(1);
    });

    it("destroy() conserve les modules enregistrés — sinon aucun recreate n'est possible", async () => {
        // `_modules` must NOT be emptied: the 8 kernel modules are
        // registered once, at bundle evaluation (`boot-install.ts`).
        // Purging them would make any recreate impossible — the registry
        // would be empty and `init()` would have nothing to do.
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

    // ── 9. register() after init() — allowed for lazy plugins ────────────────────
    it("register() après init() stocke le module sans lancer d'erreur (plugins lazy)", async () => {
        registry.register(makeModule("early"));
        await registry.init(null, null);

        // Late registration must not throw (lazy-loaded plugins call register() post-boot).
        expect(() => registry.register(makeModule("late"))).not.toThrow();
        // Module is stored for UI queries (getAll / get) even if lifecycle init is not called.
        expect(registry.get("late")).not.toBeNull();
    });

    // ── 9b. …but it no longer does so SILENTLY ──────────────────────────────────
    // The silence was the real defect: the module is registered,
    // introspection confirms it, and nothing shows — which sends people
    // hunting an ORDER problem where there is none. The warn must name BOTH
    // consequences, not just `init()`.
    describe("9b. register() post-init avertit — le silence de 7.2", () => {
        it("avertit en nommant le module, les deux conséquences, et la voie supportée", async () => {
            const warn = vi.spyOn(Log, "warn").mockImplementation(() => {});
            try {
                registry.register(makeModule("early"));
                await registry.init(null, null);
                warn.mockClear(); // ignore any warn emitted during the boot itself

                registry.register(makeModule("late", [], true));

                expect(warn).toHaveBeenCalledTimes(1);
                const msg = warn.mock.calls[0][0];
                expect(msg).toContain("late"); // the module is NAMED
                expect(msg).toContain("init()"); // consequence 1
                expect(msg).toContain("UI slot"); // consequence 2 — the undocumented corollary
                expect(msg).toContain("registerLazyForAction"); // the supported route
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

                registry.register(makeModule("twice")); // same id, already present
                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });
    });

    // ── 10. Unregistered dependency ───────────────────────────────────────────
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
    //  Safety-net delta
    // ════════════════════════════════════════════════════════════════════════

    // ── `?? []` branch: module without a `dependencies` property ────────
    it("init() tolère un module sans propriété `dependencies` (guard `?? []`)", async () => {
        // makeModule always provides `dependencies` → a raw object without
        // that key is registered to really exercise `mod.dependencies ?? []`.
        const noDeps = {
            id: "nodeps",
            init: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn(),
        };
        registry.register(noDeps);

        await expect(registry.init(null, null)).resolves.toBeUndefined();
        expect(noDeps.init).toHaveBeenCalledTimes(1);
    });

    // ── Message de cycle : chemin complet exact `a → b → a` ─────────────
    it("init() expose le chemin de cycle complet `a → b → a` dans le message", async () => {
        registry.register(makeModule("a", ["b"]));
        registry.register(makeModule("b", ["a"]));

        await expect(registry.init(null, null)).rejects.toThrow(
            "circular dependency detected: a → b → a"
        );
    });

    // ── Shape guard: incomplete lifecycle module rejected ───────────────
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

    // ── UI-only slot tolerance `{ id, ui }` (no init/destroy) ───────────
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
        registry.register(uiSlot); // registered before init → present in _initOrder

        await expect(registry.init(null, null)).resolves.toBeUndefined();
        expect(lifecycle.init).toHaveBeenCalledTimes(1); // UI slot ignored, no error
        expect(() => registry.destroy()).not.toThrow();
        expect(lifecycle.destroy).toHaveBeenCalledTimes(1);
    });

    // ── API d'introspection ─────────────────────────────────────────────
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

    // Since the gate moved into init(), a gated-off module IS registered.
    // Without this filter, a method named `getActiveModules` would answer
    // "registered" to a question asking "active", and introspection would
    // announce gated-off capabilities to the integrator.
    it("getActiveModules() écarte un module dont l'enrobage répond isEnabled() === false", () => {
        registry.register(makeModule("security", []));
        registry.register({ ...makeModule("gated-off", []), isEnabled: () => false });
        registry.register({ ...makeModule("gated-on", []), isEnabled: () => true });

        const ids = registry.getActiveModules().map((m) => m.id);

        expect(ids).toEqual(["security", "gated-on"]);
        // Registered ≠ active: `getModuleSchema()` answers on registration.
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
