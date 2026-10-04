/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ModuleRegistry — the production implementation of `IModuleRegistry`.
 *
 * Manages the GeoLeaf module lifecycle:
 * - Validates uniqueness and registration order.
 * - Resolves the dependency graph via topological sort (Kahn's BFS).
 * - Detects circular dependencies at `init()` time and throws a `GeoLeafError`
 *   with the full cycle path (e.g. `"A → B → A"`).
 * - Calls each module's `init()` in dependency order, `destroy()` in reverse.
 * - Takes a lifecycle module registered AFTER `init()` down with the others: a plugin loaded on
 *   demand unmounts with the application.
 * - With `onModuleError`, isolates a module whose `init()` throws: the modules that depend on
 *   it are skipped, and every other module still runs.
 */

import type {
    ICoreModule,
    IModuleRegistry,
    IModuleUISlot,
    ModuleInitOptions,
} from "../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../contracts/config.contract.ts";
import type { IModuleInfo, IModuleSchema } from "../contracts/introspection.contract.ts";
import { GeoLeafError } from "../utils/errors/errors.js";
import { Log } from "../utils/log/index.js";

// ─── ModuleRegistry ───────────────────────────────────────────────────────────

/**
 * Concrete implementation of `IModuleRegistry`.
 *
 * @example
 * ```typescript
 * const registry = new ModuleRegistry();
 * registry.register(new ConfigModule());
 * registry.register(new GeoJSONModule());
 * await registry.init(adapter, config);
 * ```
 */
export class ModuleRegistry implements IModuleRegistry {
    /** Internal store — preserves insertion order. */
    private readonly _modules = new Map<string, ICoreModule>();

    /** Resolved initialisation order (populated by `init()`). */
    private _initOrder: readonly string[] = [];

    /** Guards against double-init and late registration. */
    private _initialized = false;

    /**
     * `true` while the `init()` loop is running. `destroy()` refuses to run then: it would tear
     * down modules the loop has not reached yet, and the loop would start them afterwards,
     * tracked by nothing.
     */
    private _initRunning = false;

    /**
     * The modules that are running, in the order they started — what `destroy()` walks back:
     * those whose `init()` was called, then the lifecycle modules registered while the
     * application ran, which started by themselves. Not the resolved order: a loop stopped by
     * `shouldContinue` never reached the rest.
     */
    private _started: string[] = [];

    /**
     * Modules whose `init()` failed under `onModuleError: () => "continue"`, and the modules
     * skipped because they depend on one — neither is running. Cleared by `destroy()`.
     */
    private readonly _failed = new Set<string>();
    private readonly _skipped = new Set<string>();

    // ── register ──────────────────────────────────────────────────────────────

    register(module: ICoreModule): void {
        // Validate the module shape before storing. Two shapes are accepted:
        //   1. Lifecycle module — provides init AND destroy (both must be functions).
        //   2. UI-only slot — `{ id, ui }` with neither init nor destroy (e.g. a lazy
        //      plugin registering a toolbar slot; lifecycle hooks are never called on it).
        // Fail-fast guard for the lazy-plugin boundary, where registered objects are
        // plain JS — inspect via a loosely-typed view rather than the compile-time type.
        const m = module as { id: string; init?: unknown; destroy?: unknown; ui?: unknown };
        const hasInit = typeof m.init === "function";
        const hasDestroy = typeof m.destroy === "function";
        if (hasInit || hasDestroy) {
            // Lifecycle module — both hooks must be functions.
            if (!hasInit || !hasDestroy) {
                throw new GeoLeafError(
                    `ModuleRegistry: module '${m.id}' must implement both init() and destroy() as functions.`
                );
            }
        } else if (m.ui === undefined) {
            // Neither lifecycle hooks nor a UI slot → meaningless registration.
            throw new GeoLeafError(
                `ModuleRegistry: module '${m.id}' must be a lifecycle module (init + destroy) ` +
                    `or a UI-only slot ({ id, ui }).`
            );
        }

        // Idempotent: a module already registered under this id wins — a second call is a no-op.
        // Deliberately silent: re-registering the same id is how a re-entrant import behaves, and
        // it costs nothing. What is NOT silent any more is the case just below.
        if (this._modules.has(module.id)) return;

        if (this._initialized) {
            // Registered while the application runs — a plugin whose bundle loaded on demand.
            // Stored so `getAll()` / `getUISlots()` can see it. What happens to it, by shape:
            //
            //   1. **A lifecycle module is torn down with the application.** Its `init()` is not
            //      called for the application already running — the init loop ran once, over the
            //      order computed before this module existed, and a bundle that loads late wires
            //      itself. But it is recorded as started: `destroy()` walks `_started`, so the
            //      teardown reaches it, last in and first out, while the map is still alive.
            //      Without that, a plugin loaded after the boot outlived `GeoLeaf.mount()`'s
            //      unmount — its panels stayed in the page, its timers kept running. From the next
            //      `init()` on it is a module like any other: it is in `_modules`, which
            //      `destroy()` does not clear.
            //   2. **A UI slot is not drawn before the next mount.** `_appendRegistryIcons()`
            //      walks `registry.getAll()` once per boot, from `createToolbarDom()`, and nothing
            //      replays it. This is what used to happen in silence (socle-init 7.2), and what
            //      made it look like an ordering problem: the module IS registered, introspection
            //      confirms it, and nothing appears on screen.
            //
            // The supported path for a plugin that wants a button before its bundle loads is
            // `GeoLeaf.plugins.registerLazyForAction()` — it declares the slot BEFORE boot, so
            // the toolbar draws it at every boot, and the bundle loads on first use.
            this._modules.set(module.id, module);
            if (hasDestroy) this._started.push(module.id);
            if (m.ui !== undefined) {
                Log.warn(
                    `[ModuleRegistry] module '${module.id}' registered AFTER init() — its UI ` +
                        `slot is not drawn before the next mount: the toolbar is built once per ` +
                        `boot` +
                        (hasInit ? `, and its init() runs from the next boot on` : ``) +
                        `. Use GeoLeaf.plugins.registerLazyForAction() to declare a slot before ` +
                        `boot and load the bundle on demand.`
                );
            }
            return;
        }

        this._modules.set(module.id, module);
    }

    // ── init ──────────────────────────────────────────────────────────────────

    async init(
        adapter: IMapAdapter,
        config: IGeoLeafConfig,
        options: ModuleInitOptions = {}
    ): Promise<void> {
        if (this._initialized) {
            // Safe to call twice (idempotent guard — no-op on second call).
            return;
        }

        const order = this._topoSort(); // throws on cycle or missing dep
        this._initOrder = order;
        this._initialized = true;
        this._initRunning = true;

        try {
            for (const id of order) {
                // The caller ended this run (an application unmounted while it was starting):
                // the modules not reached yet never start.
                if (options.shouldContinue && !options.shouldContinue()) return;
                // A module it depends on failed, and the caller chose to go on: it never runs.
                if (this._skipped.has(id)) continue;
                const mod = this._modules.get(id)!;
                // UI-only slots (no init) are tolerated if present in the order — skip them.
                if (typeof mod.init === "function") {
                    // Recorded BEFORE the call: a module whose init() throws half-way is torn
                    // down like the others, its init() may have run in part.
                    this._started.push(id);
                    try {
                        await Promise.resolve(mod.init(adapter, config));
                    } catch (error) {
                        this._isolateFailure(id, error, options);
                    }
                }
            }
        } finally {
            this._initRunning = false;
        }
    }

    /**
     * Isolates a module whose `init()` failed, when the caller asked to go on: the module is
     * marked failed, and every module that depends on it is marked skipped.
     *
     * Without `onModuleError`, or when it answers anything but `"continue"`, the module's error
     * is rethrown — `init()` rejects with it, as it always has.
     *
     * @throws The module's own error, unless `onModuleError` answers `"continue"`.
     */
    private _isolateFailure(id: string, error: unknown, options: ModuleInitOptions): void {
        const onModuleError = options.onModuleError;
        if (!onModuleError) throw error;
        const skipped = this._dependentsOf(id);
        if (onModuleError({ id, error, skipped }) !== "continue") throw error;
        this._failed.add(id);
        for (const dependent of skipped) this._skipped.add(dependent);
    }

    /** Every module that depends on `id`, directly or not, in initialisation order. */
    private _dependentsOf(id: string): string[] {
        const found = new Set<string>();
        const pending = [id];
        for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
            for (const mod of this._modules.values()) {
                if (found.has(mod.id) || !(mod.dependencies ?? []).includes(current)) continue;
                found.add(mod.id);
                pending.push(mod.id);
            }
        }
        return this._initOrder.filter((candidate) => found.has(candidate));
    }

    // ── get / has / getAll / getUISlots ───────────────────────────────────────

    get<T extends ICoreModule = ICoreModule>(id: string): T {
        const mod = this._modules.get(id);
        if (!mod) {
            throw new GeoLeafError(`ModuleRegistry: no module registered with id '${id}'.`);
        }
        return mod as T;
    }

    has(id: string): boolean {
        return this._modules.has(id);
    }

    isInitialized(): boolean {
        return this._initialized;
    }

    getAll(): readonly ICoreModule[] {
        return Array.from(this._modules.values());
    }

    getUISlots(): IModuleUISlot[] {
        const slots: IModuleUISlot[] = [];
        for (const mod of this._modules.values()) {
            if (mod.ui !== undefined) {
                slots.push(mod.ui);
            }
        }
        return slots;
    }

    // ── getModuleSchema / getActiveModules ────────────────────────────────────

    // `dependencies ?? []` — a UI-only slot may omit them (see `register()` above, and the
    // same coalescing in `_topoSort()`). Both readers reported `dependencies: undefined` for
    // such a slot until API publique S3 widened `ICoreModule` to the union the runtime has
    // always accepted; `IModuleInfo.dependencies` is non-optional, so the introspection
    // surface was quietly off-contract for every lazily registered toolbar slot.
    getModuleSchema(id: string): IModuleSchema | null {
        const mod = this._modules.get(id);
        if (!mod) return null;
        return { id: mod.id, dependencies: mod.dependencies ?? [], hasUI: mod.ui !== undefined };
    }

    /**
     * The modules that are actually RUNNING — not merely the ones registered.
     *
     * ## Why the two stopped being the same thing (socle-init 9.3)
     *
     * They were identical for as long as a switched-off capability was never registered:
     * `registerPresetModules` filtered at Pass 2, so the map only ever held live modules and
     * returning all of them was accurate by accident. **9.2 removed that filter** — every
     * capability module is now registered, and each decides in its own `init()` whether to
     * run, so that a profile loaded *after* Pass 2 gets a say. Returning the whole map from a
     * method called `getActiveModules` would, from that commit on, have answered
     * « registered » to a question that asks « active ». The introspection surface would
     * report capabilities that are switched off — silently, and to integrators.
     *
     * ## The duck-typed test, and why it defaults to ACTIVE
     *
     * `isEnabled()` is not in `ICoreModule`, deliberately: it is put there by the wrapper in
     * `presets/apply-preset.ts`, and the registry has no business learning what a capability
     * gate is. Everything else — kernel modules, plugin UI slots, anything registered by
     * hand — carries no gate, so it has nothing to be switched off by. **Absent ⟹ active** is
     * therefore the correct default, not a lenient one.
     *
     * ⚠️ A wrapper answers `false` until its `init()` has run. Called mid-boot, this method
     * lists the kernel only — which is the honest answer: nothing else has started yet.
     *
     * ## A module that failed is not active, whatever its gate says
     *
     * Under `init(…, { onModuleError: () => "continue" })`, a module whose `init()` threw, and
     * every module skipped because it depends on one, are left out: a gate says whether a
     * capability is switched on, not whether it started.
     */
    getActiveModules(): readonly IModuleInfo[] {
        return Array.from(this._modules.values())
            .filter((mod) => !this._failed.has(mod.id) && !this._skipped.has(mod.id))
            .filter((mod) => {
                const gated = mod as { isEnabled?: unknown };
                return typeof gated.isEnabled === "function"
                    ? (gated.isEnabled as () => boolean)()
                    : true;
            })
            .map((mod) => ({
                id: mod.id,
                dependencies: mod.dependencies ?? [],
                hasUI: mod.ui !== undefined,
            }));
    }

    // ── destroy ───────────────────────────────────────────────────────────────

    destroy(): void {
        if (this._initRunning) {
            // Tearing down now would destroy modules the loop has not reached, which it would then
            // start behind this call's back. The caller stops the loop first (`shouldContinue`),
            // waits for `init()` to settle, and destroys then.
            Log.error(
                "[ModuleRegistry] destroy() refused: init() is still running. Stop it with " +
                    "`shouldContinue`, wait for it to settle, then destroy."
            );
            return;
        }
        // Only the modules that started — `init()` called, or registered while the application
        // ran: a skipped module (a module it depends on failed) never ran, nor did one the loop
        // never reached. The module that failed IS torn down — its `init()` may have run in part.
        const reverseOrder = [...this._started].reverse();
        for (const id of reverseOrder) {
            const mod = this._modules.get(id);
            if (!mod) continue;
            // UI-only slots (no destroy) are tolerated if present in the order — skip them.
            if (typeof mod.destroy !== "function") continue;
            try {
                mod.destroy();
            } catch (err) {
                // Log but do not interrupt teardown — all modules must be destroyed.
                const msg = err instanceof Error ? err.message : String(err);
                Log.warn(`[ModuleRegistry] destroy() failed for module '${id}': ${msg}`);
            }
        }

        // Re-arm the registry (S6 Lot 1). Without resetting `_initialized` `init()` returned on its
        // idempotent guard forever after, so create → destroy → recreate was a SILENT no-op.
        // Clearing `_started` also makes destroy() idempotent — a second call has nothing
        // left to walk instead of destroying every module twice.
        this._initOrder = [];
        this._started = [];
        this._initialized = false;
        this._failed.clear();
        this._skipped.clear();

        // `_modules` is deliberately NOT cleared: the 6 kernel modules are registered once, at
        // bundle eval (`boot-install.ts`). Purging them would leave an empty registry
        // and make any recreate impossible. `register()` is idempotent, so replaying the preset
        // Pass 2 over a re-armed registry is safe.
    }

    // ── Topological sort (Kahn's BFS) ─────────────────────────────────────────

    /**
     * Produces a topological ordering of registered modules.
     *
     * Validates that every declared dependency is registered.
     * Detects circular dependencies; if found, performs a DFS to build the
     * human-readable cycle path (e.g. `"A → B → A"`).
     *
     * @throws `GeoLeafError` on missing dependency or circular dependency.
     */
    private _topoSort(): string[] {
        const ids = Array.from(this._modules.keys());

        // Validate dependencies — every declared dep must be registered.
        for (const id of ids) {
            const mod = this._modules.get(id)!;
            for (const dep of mod.dependencies ?? []) {
                if (!this._modules.has(dep)) {
                    throw new GeoLeafError(
                        `ModuleRegistry: module '${id}' declared dependency '${dep}' ` +
                            `which is not registered.`
                    );
                }
            }
        }

        // Build in-degree map and reverse adjacency (dep → dependants).
        const inDegree = new Map<string, number>();
        const dependants = new Map<string, string[]>(); // dep → [modules that depend on dep]

        for (const id of ids) {
            if (!inDegree.has(id)) inDegree.set(id, 0);
            if (!dependants.has(id)) dependants.set(id, []);
        }

        for (const id of ids) {
            const mod = this._modules.get(id)!;
            for (const dep of mod.dependencies ?? []) {
                inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
                dependants.get(dep)!.push(id);
            }
        }

        // Kahn's BFS — start with modules that have no dependencies.
        const queue: string[] = [];
        for (const [id, deg] of inDegree) {
            if (deg === 0) queue.push(id);
        }

        const result: string[] = [];
        while (queue.length > 0) {
            const id = queue.shift()!;
            result.push(id);
            for (const dep of dependants.get(id) ?? []) {
                const newDeg = (inDegree.get(dep) ?? 1) - 1;
                inDegree.set(dep, newDeg);
                if (newDeg === 0) queue.push(dep);
            }
        }

        // If not all modules were processed → cycle detected.
        if (result.length < ids.length) {
            const cyclePath = this._findCyclePath();
            throw new GeoLeafError(`ModuleRegistry: circular dependency detected: ${cyclePath}`);
        }

        return result;
    }

    /**
     * DFS-based cycle path finder. Called only when Kahn's algorithm confirms
     * a cycle exists. Returns a human-readable path like `"A → B → A"`.
     */
    private _findCyclePath(): string {
        const visited = new Set<string>();
        const stack = new Set<string>();
        const path: string[] = [];

        const dfs = (id: string): boolean => {
            if (stack.has(id)) {
                // Found the start of the cycle — slice from first occurrence.
                const cycleStart = path.indexOf(id);
                const cycle = path.slice(cycleStart);
                cycle.push(id); // close the loop
                path.splice(0, path.length, ...cycle);
                return true;
            }
            if (visited.has(id)) return false;

            visited.add(id);
            stack.add(id);
            path.push(id);

            const mod = this._modules.get(id)!;
            for (const dep of mod.dependencies ?? []) {
                if (dfs(dep)) return true;
            }

            stack.delete(id);
            path.pop();
            return false;
        };

        for (const id of this._modules.keys()) {
            if (!visited.has(id)) {
                if (dfs(id)) break;
            }
        }

        return path.join(" → ");
    }
}
