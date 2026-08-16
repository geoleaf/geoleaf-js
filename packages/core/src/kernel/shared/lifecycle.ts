/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Lifecycle teardown registry — IoC seam for the create → destroy → recreate
 * cycle (boot-di-lifecycle roadmap, S3).
 *
 * The singleton stores that hold business state (`GeoJSONShared`, `LayerManager`,
 * `ProfileManager`) self-register a teardown callback here at import time.
 * `Core.destroy(mapId)` runs every registered callback once the last map instance
 * is closed — clearing the leaked state (GeoJSON layers, active profile,
 * layer-manager control) so the next `Core.init()` starts clean.
 *
 * Why a seam and not direct imports / the ModuleRegistry:
 *  - `map/facade.ts` stays decoupled from the data modules (no import cycle).
 *  - The lifecycle is reachable from `Core.destroy()` **without** an initialized
 *    `ModuleRegistry` — the lifecycle unit test drives `Core.init`/`Core.destroy`
 *    only. The module `destroy()` hooks delegate to the SAME store `reset()`
 *    methods, so the registry path (production boot) and the seam path stay in
 *    sync (single source of truth = each store's `reset()`).
 *
 * This registry lives **outside** the `GeoLeaf.*` namespace on purpose: it must
 * not add any public façade key (the boot golden master freezes that surface),
 * and it imports nothing.
 *
 * 🛑 **"It imports nothing (no cycle risk)" is what this header claimed until 07/08/2026, and
 * it was broader than its proof.** Importing nothing protects against a cycle this module
 * *starts*; it says nothing about one it *ends*. This module is the TARGET of import-time calls
 * from other modules, so it only has to be reached while its own body has not run yet — which
 * is precisely what happened. Rollup emitted `Circular chunk: chunk-geojson -> chunk-core-utils
 * -> chunk-geojson` on every build, the build exited 0, and `kernel/geojson/shared.ts` (in one
 * chunk) called `registerLifecycleTeardown` (in the other) before this module's `const` had
 * been evaluated: `ReferenceError: Cannot access '_teardowns' before initialization`. It took
 * down three `ci:local` gates. See the store declaration below for what now prevents it.
 */

/** A store teardown callback (idempotent — safe to run more than once). */
type LifecycleTeardownFn = () => void;

/**
 * Registered teardown callbacks. A Set makes re-registration idempotent.
 *
 * ⚠️ **`const` is deliberate, and its temporal dead zone is a FEATURE here.** Hoisting this as
 * `var` would let an early cross-chunk caller register into a lazily-created store instead of
 * throwing — which sounds safer and is worse: it would swallow a returning chunk cycle in
 * silence, exactly the defect B.12 spent three red gates surfacing. The TDZ is the loud signal.
 * The cycle is prevented where it belongs, in `rollup.config.mjs` (`manualChunks`), and a
 * returning one fails the build there rather than being absorbed here.
 */
const _teardowns = new Set<LifecycleTeardownFn>();

/**
 * Registers a teardown callback, run by {@link runLifecycleTeardowns} when the
 * last map instance is destroyed. Called at import time by each business-state
 * store, e.g. `registerLifecycleTeardown(() => GeoJSONShared.reset())`.
 *
 * @param fn - Idempotent teardown callback.
 */
export function registerLifecycleTeardown(fn: LifecycleTeardownFn): void {
    _teardowns.add(fn);
}

/**
 * Runs every registered teardown callback. Each call is isolated in a try/catch
 * so one failing reset never prevents the others from running.
 */
export function runLifecycleTeardowns(): void {
    for (const fn of _teardowns) {
        try {
            fn();
        } catch (err) {
            // Read the ambient declaration directly (`global.d.ts`: `var GeoLeaf: GeoLeafGlobal |
            // undefined`) instead of re-typing globalThis as `{ GeoLeaf?: … }`: the two differ
            // under `exactOptionalPropertyTypes` — present-holding-undefined is not absent. This
            // seam stays import-free ON PURPOSE (see the header: no import cycle), so the
            // canonical `getGeoLeaf()` of `utils/general/geoleaf-global.ts` is not used here.
            const _g = typeof globalThis !== "undefined" ? globalThis : undefined;
            const log = (_g?.GeoLeaf?.Log ?? console) as { warn?: (message: string) => void };
            const msg = err instanceof Error ? err.message : String(err);
            log.warn?.(`[GeoLeaf.lifecycle] teardown callback failed: ${msg}`);
        }
    }
}
