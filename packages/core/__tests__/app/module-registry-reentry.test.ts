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
 */
import { describe, it, expect, vi } from "vitest";

const { ModuleRegistry } = await import("../../src/app/module-registry.ts");
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
