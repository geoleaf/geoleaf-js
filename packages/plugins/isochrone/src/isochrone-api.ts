/*!
 * @geoleaf-plugins/isochrone — Domain module
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Implementation behind the public façade of `@geoleaf-plugins/isochrone`.
 *
 * `public-api.ts` only delegates here (INV-FACADE): the behaviour, and the tests that hold
 * it, live in this module. It reads the plugin's configuration through `getPluginConfig()`
 * and through nothing else.
 */

import { getPluginConfig } from "./config.js";

/**
 * Root CSS class of the plugin's own DOM — the single owner of the stylesheet's namespace.
 *
 * ⚠️ It is written HERE, in a source file, for a mechanical reason: PurgeCSS extracts its
 * candidates from the source text, so a class that appears in no source is DEAD to it.
 *
 * Build the plugin's markup under this class: the stylesheet is scoped to it.
 */
const ROOT_CLASS = "gl-isochrone";

/**
 * Opens the plugin: builds its root element, once.
 *
 * @returns `false` when the profile switched the plugin off
 *   (`modules.isochrone.enabled: false`), `true` once it is open.
 */
export function openIsochrone(): boolean {
    if (!getPluginConfig().enabled) return false;
    if (!document.querySelector(`.${ROOT_CLASS}`)) {
        const root = document.createElement("div");
        root.className = ROOT_CLASS;
        document.body.append(root);
    }
    return true;
}

/**
 * Closes the plugin: removes what `openIsochrone()` built in the page.
 *
 * It is also the plugin's teardown, called when the application is unmounted — so it tolerates
 * being called when nothing was built, and leaves the plugin able to open again.
 */
export function closeIsochrone(): void {
    document.querySelector(`.${ROOT_CLASS}`)?.remove();
}
