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
import { destroyController } from "./controller.js";
import { getMapAdapter } from "./map-binding.js";
import { createFloatingWindow, type FloatingWindow } from "./ui/floating-window.js";

/**
 * Root CSS class of the plugin's own DOM — the single owner of the stylesheet's namespace.
 *
 * ⚠️ It is written HERE, in a source file, for a mechanical reason: PurgeCSS extracts its
 * candidates from the source text, so a class that appears in no source is DEAD to it.
 *
 * Build the plugin's markup under this class: the stylesheet is scoped to it.
 */
const ROOT_CLASS = "gl-isochrone";

/** The open window, if any. */
let panel: FloatingWindow | null = null;

/**
 * Opens the window, once, and says so to the other floating tools — which close theirs.
 *
 * The window is placed in the map's container when a map is mounted, in the page otherwise:
 * the API stays usable without a map, and the window then says why it cannot compute.
 *
 * @param anchor The toolbar button that opened it: the window is placed beside it. Without one,
 *   it keeps the place it had, or its default one.
 * @returns `false` when the profile switched the plugin off
 *   (`modules.isochrone.enabled: false`), `true` once it is open.
 */
export function openIsochrone(anchor?: Element): boolean {
    if (!getPluginConfig().enabled) return false;
    const container = getMapAdapter()?.getContainer() ?? document.body;
    let root = document.querySelector<HTMLElement>(`.${ROOT_CLASS}`);
    if (!root || !panel) {
        root?.remove();
        root = document.createElement("div");
        root.className = ROOT_CLASS;
        panel = createFloatingWindow(closeIsochrone);
        root.append(panel.element);
        container.append(root);
        panel.wireMove(container, root);
    }
    if (anchor) panel.placeNear(anchor, container);
    document.dispatchEvent(
        new CustomEvent("geoleaf:submenu:open", { detail: { id: "isochrone" }, bubbles: false })
    );
    return true;
}

/**
 * Closes the window: leaves the picking, and removes what `openIsochrone()` built in the page.
 * The zones stay on the map, and a computation running still lands.
 *
 * Tolerates being called when nothing was built, and leaves the plugin able to open again.
 */
export function closeIsochrone(): void {
    panel?.destroy();
    panel = null;
    document.querySelector(`.${ROOT_CLASS}`)?.remove();
}

/**
 * The plugin's teardown, called when the application is unmounted, while the map is still
 * there: cancels the computation running, removes the zones, their markers and the credit,
 * then closes.
 *
 * What `configure()` set and the providers registered survive — they belong to the page. It
 * tolerates being called twice, and leaves the plugin able to start again on the next map.
 */
export function destroyIsochrone(): void {
    destroyController();
    closeIsochrone();
}
