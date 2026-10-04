/*!
 * @geoleaf/host-runtime — module registry seam
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * How a plugin joins the application lifecycle: its teardown, registered with the core's module
 * registry (`GeoLeaf.registry`).
 *
 * `GeoLeaf.mount()` takes the application down by destroying that registry, and brings it back
 * by a new boot. A plugin that only wires itself when its script loads is reached by neither:
 * what it built stays in the page after `unmount()`, and nothing arms it again for the next
 * map. The module registered here is what the teardown calls.
 *
 * ## One gesture, on both loading paths
 *
 * A plugin cannot know who loaded it, and the two paths do not want the same registration:
 *
 * - **before the boot** (a `<script>` tag, a `beforeBoot` preload) — the registry is not
 *   initialised. The module carries the plugin's toolbar slot too: on that path this call is
 *   the ONLY declaration of the button.
 * - **after the boot** (`GeoLeaf.plugins.load()`, a click on a lazy button) — the registry is
 *   running. The module is registered WITHOUT its slot: the toolbar is built, a slot registered
 *   now is not drawn, and the button belongs to the declaration that drew it,
 *   `GeoLeaf.plugins.registerLazyForAction()`, which the core draws again at every boot.
 *
 * `init()` is a no-op on both: a plugin starts on the events of the boot (`geoleaf:map:ready`,
 * `geoleaf:app:ready`), which it listens to for the life of the page. The registry carries the
 * teardown, and only it.
 *
 * ⚠️ **What the core must be for the late path to work.** A module registered after `init()`
 * is torn down by `@geoleaf/core` ≥ 3.14.2. From 3.13.0 to 3.14.1 the registry stores it, never
 * calls its `destroy()` and logs a warning; before 3.13.0 there is no `GeoLeaf.mount()` and
 * nothing unmounts an application — nothing is registered there.
 */

import { getGeoLeaf } from "./host.js";

/** What a plugin hands to {@link registerPluginModule}. */
export interface PluginModule {
    /** The module id — the plugin's own id, which is also the action of its toolbar slot. */
    id: string;
    /**
     * Takes down what the plugin built for the application that goes away: DOM, listeners,
     * timers, references to the map. Called while the map is still alive. It must leave the
     * plugin able to start again on the next map, and tolerate being called when nothing was
     * built.
     */
    destroy: () => void;
    /**
     * The plugin's toolbar slot (`IModuleUISlot`, `@geoleaf/core`), declared when the plugin
     * loads before the boot. Left untyped: this package imports nothing from the core.
     */
    ui?: object;
}

/**
 * Registers a plugin's teardown with the core's module registry, and its toolbar slot when the
 * plugin loads before the boot.
 *
 * @param module - The module id, its teardown, and its toolbar slot if it has one.
 * @returns `true` when the module was handed to the registry. `false` without a core or a
 *   registry, and for a plugin loaded after the boot of a core that has no `GeoLeaf.mount()`.
 */
export function registerPluginModule(module: PluginModule): boolean {
    const host = getGeoLeaf();
    const registry = host?.registry;
    if (typeof registry?.register !== "function") return false;

    // `!== true` on the eager side: a host without `isInitialized` yields `undefined`, and the
    // slot IS declared — a missing declaration costs the button.
    const late = registry.isInitialized?.() === true;
    // Nothing unmounts an application there: a late registration would only be stored, and
    // reported as a mistake by a registry that cannot honour it.
    if (late && typeof host?.["mount"] !== "function") return false;

    registry.register({
        id: module.id,
        dependencies: [],
        init: () => undefined,
        destroy: module.destroy,
        ...(!late && module.ui !== undefined ? { ui: module.ui } : {}),
    });
    return true;
}
