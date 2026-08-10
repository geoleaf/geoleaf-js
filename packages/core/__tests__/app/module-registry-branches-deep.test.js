/**
 * Deep branch coverage — app/module-registry.ts (Sprint T11)
 *
 * Strategy: await import() so Istanbul instruments every branch of
 * ModuleRegistry (register, init, _topoSort, _findCyclePath, destroy,
 * get, getAll, has, getUISlots).
 *
 * The existing module-registry.test.js uses require(), which bypasses
 * Istanbul instrumentation — this file fixes that gap.
 *
 * Branches covered:
 *  - register(): duplicate-id guard, post-init guard
 *  - init(): idempotent guard (already initialized), topo-sort success,
 *            module.init() rejection, missing dep, cycle (2-node, 3-node)
 *  - _topoSort(): diamond DAG, no-dep modules, all in-degree-0 queue
 *  - _findCyclePath(): DFS short cycle, DFS long cycle, already-visited node
 *  - destroy(): reverse order, catch branch (module.destroy() throws → console.warn)
 *  - get(): known id, unknown id GeoLeafError
 *  - has(): true / false
 *  - getUISlots(): modules with ui / without ui / empty registry
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Dynamic imports — Istanbul instruments the source ─────────────────────────
const { ModuleRegistry } = await import("../../src/app/module-registry.ts");
const { GeoLeafError } = await import("../../src/utils/errors/errors.ts");

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Creates a minimal ICoreModule stub with spied init/destroy.
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

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("ModuleRegistry — branch coverage (T11)", () => {
    let registry;

    beforeEach(() => {
        registry = new ModuleRegistry();
    });

    // ── register() ────────────────────────────────────────────────────────────

    describe("register()", () => {
        it("has() returns true after registration", () => {
            registry.register(makeModule("alpha"));
            expect(registry.has("alpha")).toBe(true);
        });

        it("has() returns false for unregistered id", () => {
            expect(registry.has("nope")).toBe(false);
        });

        it("getAll() contains registered module in insertion order", () => {
            const a = makeModule("a");
            const b = makeModule("b");
            registry.register(a);
            registry.register(b);
            const all = registry.getAll();
            expect(all[0].id).toBe("a");
            expect(all[1].id).toBe("b");
        });

        it("is idempotent on duplicate id — second register is a no-op (S4 lazy-load)", () => {
            registry.register(makeModule("dup"));
            expect(() => registry.register(makeModule("dup"))).not.toThrow();
            expect(registry.getAll().filter((m) => m.id === "dup")).toHaveLength(1);
        });

        it("stores module without throwing when called after init() (S4 lazy-load)", async () => {
            registry.register(makeModule("early"));
            await registry.init(null, null);
            expect(() => registry.register(makeModule("late"))).not.toThrow();
            expect(registry.get("late")).not.toBeNull();
        });
    });

    // ── init() ────────────────────────────────────────────────────────────────

    describe("init()", () => {
        it("calls modules in topological order (A → B → C)", async () => {
            const order = [];
            const a = makeModule("a");
            const b = makeModule("b", ["a"]);
            const c = makeModule("c", ["b"]);
            a.init.mockImplementation(() => order.push("a"));
            b.init.mockImplementation(() => order.push("b"));
            c.init.mockImplementation(() => order.push("c"));

            // Register in reverse order — registry must sort
            registry.register(c);
            registry.register(a);
            registry.register(b);

            await registry.init(null, null);
            expect(order).toEqual(["a", "b", "c"]);
        });

        it("resolves a diamond DAG (A→B, A→C, B→D, C→D) correctly", async () => {
            const order = [];
            const a = makeModule("a");
            const b = makeModule("b", ["a"]);
            const c = makeModule("c", ["a"]);
            const d = makeModule("d", ["b", "c"]);
            [a, b, c, d].forEach((m) => {
                m.init.mockImplementation(() => order.push(m.id));
                registry.register(m);
            });

            await registry.init(null, null);

            expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
            expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
            expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
            expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
        });

        it("is idempotent — second call is a no-op", async () => {
            const mod = makeModule("once");
            registry.register(mod);
            await registry.init(null, null);
            await registry.init(null, null); // second call
            expect(mod.init).toHaveBeenCalledTimes(1);
        });

        it("rejects when module.init() rejects", async () => {
            const good = makeModule("g1");
            const bad = makeModule("g2", ["g1"]);
            bad.init.mockRejectedValue(new Error("boom"));
            registry.register(good);
            registry.register(bad);
            await expect(registry.init(null, null)).rejects.toThrow("boom");
        });

        it("throws GeoLeafError for undeclared dependency", async () => {
            registry.register(makeModule("orphan", ["ghost"]));
            await expect(registry.init(null, null)).rejects.toThrow(GeoLeafError);
            await expect(registry.init(null, null)).rejects.toThrow(/ghost/);
        });

        it("throws GeoLeafError on 2-node cycle (X → Y → X)", async () => {
            registry.register(makeModule("x", ["y"]));
            registry.register(makeModule("y", ["x"]));
            await expect(registry.init(null, null)).rejects.toThrow(GeoLeafError);
        });

        it("throws GeoLeafError on 3-node cycle (A → B → C → A)", async () => {
            registry.register(makeModule("ca", ["cc"]));
            registry.register(makeModule("cb", ["ca"]));
            registry.register(makeModule("cc", ["cb"]));
            await expect(registry.init(null, null)).rejects.toThrow(GeoLeafError);
        });

        it("cycle error message contains the cycle path (→ separator)", async () => {
            registry.register(makeModule("p", ["q"]));
            registry.register(makeModule("q", ["p"]));
            let msg = "";
            try {
                await registry.init(null, null);
            } catch (err) {
                msg = err.message;
            }
            expect(msg).toMatch(/→/);
        });

        it("registers modules with no dependencies (all in-degree-0)", async () => {
            const a = makeModule("standalone-a");
            const b = makeModule("standalone-b");
            registry.register(a);
            registry.register(b);
            await expect(registry.init(null, null)).resolves.toBeUndefined();
            expect(a.init).toHaveBeenCalledTimes(1);
            expect(b.init).toHaveBeenCalledTimes(1);
        });
    });

    // ── get() ─────────────────────────────────────────────────────────────────

    describe("get()", () => {
        it("returns the registered module", async () => {
            const mod = makeModule("found");
            registry.register(mod);
            await registry.init(null, null);
            expect(registry.get("found")).toBe(mod);
        });

        it("throws GeoLeafError for unknown id", () => {
            expect(() => registry.get("missing")).toThrow(GeoLeafError);
            expect(() => registry.get("missing")).toThrow(/missing/);
        });
    });

    // ── destroy() ─────────────────────────────────────────────────────────────

    describe("destroy()", () => {
        it("calls destroy() in reverse init order", async () => {
            const order = [];
            const a = makeModule("da");
            const b = makeModule("db", ["da"]);
            const c = makeModule("dc", ["db"]);
            a.destroy.mockImplementation(() => order.push("da"));
            b.destroy.mockImplementation(() => order.push("db"));
            c.destroy.mockImplementation(() => order.push("dc"));
            [a, b, c].forEach((m) => registry.register(m));

            await registry.init(null, null);
            registry.destroy();

            expect(order).toEqual(["dc", "db", "da"]);
        });

        it("does not throw when a module.destroy() throws (catch branch)", async () => {
            const bad = makeModule("bad-destroy");
            bad.destroy.mockImplementation(() => {
                throw new Error("destroy failure");
            });
            registry.register(bad);
            await registry.init(null, null);
            expect(() => registry.destroy()).not.toThrow();
        });

        it("emits console.warn for each failing destroy()", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const bad = makeModule("warn-destroy");
            bad.destroy.mockImplementation(() => {
                throw new Error("fail");
            });
            registry.register(bad);
            await registry.init(null, null);
            registry.destroy();
            expect(warnSpy).toHaveBeenCalledWith(
                "[GeoLeaf.WARN]",
                expect.stringContaining("[ModuleRegistry]")
                // routed through Log → console.warn receives the "[GeoLeaf.WARN]" prefix first
            );
            warnSpy.mockRestore();
        });

        it("destroy() before init() completes without error (empty initOrder)", () => {
            registry.register(makeModule("pre-init"));
            expect(() => registry.destroy()).not.toThrow();
        });
    });

    // ── getUISlots() ──────────────────────────────────────────────────────────

    describe("getUISlots()", () => {
        it("returns only modules that have a ui slot", () => {
            registry.register(makeModule("no-ui-a"));
            registry.register(makeModule("with-ui", [], true));
            registry.register(makeModule("no-ui-b"));

            const slots = registry.getUISlots();
            expect(slots).toHaveLength(1);
            expect(slots[0].mobileIcon.labelKey).toBe("with-ui.label");
        });

        it("returns an empty array when no module has ui", () => {
            registry.register(makeModule("plain-a"));
            registry.register(makeModule("plain-b"));
            expect(registry.getUISlots()).toEqual([]);
        });

        it("returns an empty array on empty registry", () => {
            expect(registry.getUISlots()).toEqual([]);
        });
    });
});
