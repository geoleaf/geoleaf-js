/**
 * Witness — the registry can be torn down and run again without corrupting a run in flight.
 *
 * ## What this file pins
 *
 * `ModuleRegistry.destroy()` already re-arms the registry, but it had never been called while
 * `init()` was still looping: no production path called it at all. `GeoLeaf.mount()` makes that
 * window reachable — an application unmounted while a module is still starting. Before the fix:
 *
 * - `destroy()` during the loop tore every module of the order down, including the ones not yet
 *   started, and cleared `_initialized`; the loop then carried on and started the rest, which
 *   nothing tracked any more;
 * - there was no way to stop the loop between two modules;
 * - `destroy()` walked the whole order, so a loop stopped half-way tore down modules that never
 *   ran;
 * - a gated capability module kept answering `isEnabled() === true` after its `destroy()`, so
 *   `getActiveModules()` still listed it.
 *
 * Each case below was seen RED on the registry before the fix.
 *
 * ## A module registered while the application runs
 *
 * A plugin whose bundle loads on demand registers after `init()`. The registry stored it and
 * `destroy()` walked past it — it only knew the modules whose `init()` it had called. The
 * plugin therefore outlived the unmount: panels left in the page, timers still running. The
 * last block pins that it is torn down with the others, and is a module like any other from
 * the next `init()` on.
 */
import { describe, it, expect, vi } from "vitest";

const { ModuleRegistry } = await import("../../src/app/module-registry.ts");
const { Log } = await import("../../src/utils/log/index.ts");
const { registerPresetModules } = await import("../../src/presets/apply-preset.ts");

/**
 * A lifecycle module stub.
 *
 * @param id - Module id.
 * @param deps - Ids it depends on.
 * @param init - What its `init()` does; resolves by default.
 */
function makeModule(id: string, deps: string[] = [], init?: () => Promise<void>) {
    return {
        id,
        dependencies: deps,
        init: vi.fn(init ?? (() => Promise.resolve())),
        destroy: vi.fn(),
    };
}

/** A promise and the function that resolves it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

const adapter = {} as never;
const config = {} as never;

describe("ModuleRegistry — torn down and run again", () => {
    it("🛑 refuses destroy() while init() is still running, and tears down nothing", async () => {
        const gate = deferred();
        const a = makeModule("a", [], () => gate.promise);
        const b = makeModule("b", ["a"]);
        const registry = new ModuleRegistry();
        registry.register(a);
        registry.register(b);

        const running = registry.init(adapter, config);
        registry.destroy();
        expect(a.destroy).not.toHaveBeenCalled();
        expect(b.destroy).not.toHaveBeenCalled();
        expect(registry.isInitialized()).toBe(true);

        gate.resolve();
        await running;
        expect(b.init).toHaveBeenCalledTimes(1);
    });

    it("🛑 stops between two modules when shouldContinue answers false", async () => {
        let go = true;
        const a = makeModule("a", [], () => {
            go = false;
            return Promise.resolve();
        });
        const b = makeModule("b", ["a"]);
        const registry = new ModuleRegistry();
        registry.register(a);
        registry.register(b);

        await registry.init(adapter, config, { shouldContinue: () => go });
        expect(a.init).toHaveBeenCalledTimes(1);
        expect(b.init).not.toHaveBeenCalled();
    });

    it("🛑 destroy() tears down only the modules that started, and the registry runs again", async () => {
        let go = true;
        const a = makeModule("a", [], () => {
            go = false;
            return Promise.resolve();
        });
        const b = makeModule("b", ["a"]);
        const registry = new ModuleRegistry();
        registry.register(a);
        registry.register(b);

        await registry.init(adapter, config, { shouldContinue: () => go });
        registry.destroy();
        expect(a.destroy).toHaveBeenCalledTimes(1);
        expect(b.destroy).not.toHaveBeenCalled();
        expect(registry.isInitialized()).toBe(false);

        await registry.init(adapter, config);
        expect(a.init).toHaveBeenCalledTimes(2);
        expect(b.init).toHaveBeenCalledTimes(1);
    });

    it("🛑 a gated capability module destroyed is no longer active", async () => {
        const inner = makeModule("cap");
        const registry = new ModuleRegistry();
        const preset = {
            id: "p",
            capabilities: [{ declaration: { id: "cap" }, createModule: () => inner }],
        } as never;
        registerPresetModules(preset, { isEnabled: () => true }, registry);

        await registry.init(adapter, { get: () => undefined } as never);
        expect(registry.getActiveModules().map((m) => m.id)).toEqual(["cap"]);

        registry.destroy();
        expect(inner.destroy).toHaveBeenCalledTimes(1);
        expect(registry.getActiveModules().map((m) => m.id)).toEqual([]);
    });
});

describe("ModuleRegistry — a module registered while the application runs", () => {
    it("🛑 destroy() reaches a lifecycle module registered after init(), before the others", async () => {
        const order: string[] = [];
        const early = makeModule("early");
        early.destroy.mockImplementation(() => order.push("early"));
        const late = makeModule("late");
        late.destroy.mockImplementation(() => order.push("late"));
        const registry = new ModuleRegistry();
        registry.register(early);
        await registry.init(adapter, config);

        registry.register(late);
        // The application is already running: the bundle wired itself, the loop is not replayed.
        expect(late.init).not.toHaveBeenCalled();

        registry.destroy();
        expect(late.destroy).toHaveBeenCalledTimes(1);
        // Last in, first out — while everything it may lean on is still alive.
        expect(order).toEqual(["late", "early"]);
    });

    it("🛑 it is a module like any other from the next init() on, torn down once per run", async () => {
        const early = makeModule("early");
        const late = makeModule("late");
        const registry = new ModuleRegistry();
        registry.register(early);
        await registry.init(adapter, config);
        registry.register(late);
        registry.destroy();

        await registry.init(adapter, config);
        expect(late.init).toHaveBeenCalledTimes(1);
        registry.destroy();
        expect(late.destroy).toHaveBeenCalledTimes(2);
        // A second destroy() has nothing left to walk.
        registry.destroy();
        expect(late.destroy).toHaveBeenCalledTimes(2);
    });

    it("a lifecycle module without a UI slot is taken without a word; a slot is warned about", async () => {
        const warn = vi.spyOn(Log, "warn").mockImplementation(() => undefined);
        try {
            const registry = new ModuleRegistry();
            registry.register(makeModule("early"));
            await registry.init(adapter, config);
            warn.mockClear();

            registry.register(makeModule("late"));
            expect(warn).not.toHaveBeenCalled();

            registry.register({ id: "slot", ui: { mobileIcon: {} } } as never);
            expect(warn).toHaveBeenCalledTimes(1);
            const message = String(warn.mock.calls[0]?.[0]);
            expect(message).toContain("'slot' registered AFTER init()");
            expect(message).toContain("not drawn before the next mount");
            // A slot alone has no init() to speak of.
            expect(message).not.toContain("init() runs");
        } finally {
            warn.mockRestore();
        }
    });

    it("a UI-only slot registered after init() is never torn down — it has no destroy()", async () => {
        const warn = vi.spyOn(Log, "warn").mockImplementation(() => undefined);
        try {
            const registry = new ModuleRegistry();
            registry.register(makeModule("early"));
            await registry.init(adapter, config);
            registry.register({ id: "slot", ui: { mobileIcon: {} } } as never);
            expect(() => registry.destroy()).not.toThrow();
            expect(registry.has("slot")).toBe(true);
        } finally {
            warn.mockRestore();
        }
    });
});
