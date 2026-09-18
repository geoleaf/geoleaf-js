/**
 * Witness — a module that throws no longer takes every later module down, when the caller says so.
 *
 * ## What this file pins
 *
 * `ModuleRegistry.init` runs the topological order with one `await` per module and no catch: the
 * first `init()` that throws rejects the whole call, and every module after it is skipped —
 * including the ones that do not depend on it. The contract (`IModuleRegistry.init`) promises
 * exactly that, and `module-registry.test.js` pins it, so the change is ADDITIVE: an
 * `onModuleError` option lets the caller keep going, and without it nothing moves.
 *
 * Each « continue » case was seen RED on the registry before the option existed. The two others
 * pin what must NOT move: without the option, or with « abort », `init()` still rejects.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { ModuleRegistry } = await import("../../src/app/module-registry.ts");

type Registry = InstanceType<typeof ModuleRegistry>;
type InitOptions = NonNullable<Parameters<Registry["init"]>[2]>;
type ModuleFailure = Parameters<NonNullable<InitOptions["onModuleError"]>>[0];

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

const failing = (message: string) => () => Promise.reject(new Error(message));

let registry: Registry;

beforeEach(() => {
    registry = new ModuleRegistry();
});

/** Registers the modules and runs `init()` with the given options. */
async function run(modules: ReturnType<typeof makeModule>[], options?: InitOptions): Promise<void> {
    for (const mod of modules) registry.register(mod as never);
    await registry.init(null as never, null as never, options as never);
}

describe("ModuleRegistry — per-module failure isolation", () => {
    it("without options the contract holds: the first failure rejects, later modules do not run", async () => {
        const base = makeModule("base", [], failing("base boom"));
        const next = makeModule("next", ["base"]);

        await expect(run([base, next])).rejects.toThrow("base boom");
        expect(next.init).not.toHaveBeenCalled();
    });

    it("« continue » skips the failed module's dependents, and independent modules still run", async () => {
        const base = makeModule("base");
        const cap = makeModule("cap", ["base"], failing("cap boom"));
        const dependent = makeModule("dependent", ["cap"]);
        const other = makeModule("other", ["base"]);
        const failures: ModuleFailure[] = [];

        await run([base, cap, dependent, other], {
            onModuleError: (failure) => {
                failures.push(failure);
                return "continue";
            },
        });

        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ id: "cap", skipped: ["dependent"] });
        expect((failures[0]?.error as Error).message).toBe("cap boom");
        expect(dependent.init).not.toHaveBeenCalled();
        expect(other.init).toHaveBeenCalledTimes(1);
    });

    it("`skipped` lists the TRANSITIVE dependents, not only the direct ones", async () => {
        const cap = makeModule("cap", [], failing("cap boom"));
        const d1 = makeModule("d1", ["cap"]);
        const d2 = makeModule("d2", ["d1"]);
        const failures: ModuleFailure[] = [];

        await run([cap, d1, d2], {
            onModuleError: (failure) => {
                failures.push(failure);
                return "continue";
            },
        });

        expect([...(failures[0]?.skipped ?? [])].sort()).toEqual(["d1", "d2"]);
        expect(d2.init).not.toHaveBeenCalled();
    });

    it("« abort » rejects with the module's own error", async () => {
        const cap = makeModule("cap", [], failing("cap boom"));

        await expect(run([cap], { onModuleError: () => "abort" })).rejects.toThrow("cap boom");
    });

    it("getActiveModules() leaves out the failed module and the ones skipped because of it", async () => {
        const base = makeModule("base");
        const cap = makeModule("cap", ["base"], failing("cap boom"));
        const dependent = makeModule("dependent", ["cap"]);
        const other = makeModule("other", ["base"]);

        await run([base, cap, dependent, other], { onModuleError: () => "continue" });

        expect(
            registry
                .getActiveModules()
                .map((m) => m.id)
                .sort()
        ).toEqual(["base", "other"]);
    });

    it("destroy() tears down the failed module — its init may have half-run — but never a skipped one", async () => {
        const base = makeModule("base");
        const cap = makeModule("cap", ["base"], failing("cap boom"));
        const dependent = makeModule("dependent", ["cap"]);

        await run([base, cap, dependent], { onModuleError: () => "continue" });
        registry.destroy();

        expect(cap.destroy).toHaveBeenCalledTimes(1);
        expect(base.destroy).toHaveBeenCalledTimes(1);
        expect(dependent.destroy).not.toHaveBeenCalled();
    });
});
