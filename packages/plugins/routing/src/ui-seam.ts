/*!
 * @geoleaf-plugins/routing — Panel-host seam
 *
 * The three kernel calls that decide WHERE this plugin's panel is shown, typed in one place.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getGeoLeaf } from "@geoleaf/host-runtime";

/**
 * ## Why a seam and not three inline casts
 *
 * `GeoLeafHost.UI` is declared `Record<string, unknown>` in `@geoleaf/host-runtime` — a
 * deliberate long tail, since the façade is assembled at boot. Reaching a member through it
 * therefore needs a cast at every call site, and three casts of the same shape written in
 * three files is how two of them end up disagreeing about whether a method returns a boolean.
 *
 * ⚠️ The members ARE declared on the core side (`packages/core/src/global.d.ts`). This file is
 * not covering an undeclared API — it is the local narrowing of a surface that arrives untyped
 * through the host bridge, the same pattern this package already uses for `Navigation`.
 *
 * ## Why every call is optional
 *
 * The kernel may be older than this bundle: an integrator pins `@geoleaf/core` and updates
 * plugins separately. A missing member then means "this host cannot dock a panel", which is a
 * fact to fall back from, not a crash to take the map down with.
 */

/** The slice of `GeoLeaf.UI` this plugin drives. */
interface PanelHostFacade {
    registerPanelPane?(pane: {
        id: string;
        labelKey: string;
        selector: string;
        order?: number;
        onOpen?(): void;
    }): void;
    openPane?(paneId: string): boolean;
    closePane?(): void;
}

/**
 * The UI façade, narrowed to what this package calls.
 *
 * @returns The façade, or `undefined` before boot.
 */
function ui(): PanelHostFacade | undefined {
    return getGeoLeaf()?.UI as PanelHostFacade | undefined;
}

/**
 * Offers this plugin's panel as a hostable pane.
 *
 * @param pane - Identifier, i18n key, the selector the host adopts, and the build hook the
 *               host calls before adopting it.
 * @returns `true` when the kernel accepted the registration, `false` when it has no such API
 *          yet — which the caller retries once the app is ready.
 */
export function registerPane(pane: {
    id: string;
    labelKey: string;
    selector: string;
    onOpen?(): void;
}): boolean {
    const register = ui()?.registerPanelPane;
    if (typeof register !== "function") return false;
    register(pane);
    return true;
}

/**
 * Asks the kernel to show the pane on whichever surface is live.
 *
 * ⚠️ `openPane`, never `openPanel`: the latter drives the DESKTOP panel and answers `false`
 * below 1440px, where the same content belongs in the mobile sheet. This plugin reacts to a
 * click on a feature and has no business knowing which surface the current width implies.
 *
 * @param paneId - The pane to show.
 * @returns `true` when a host displayed it.
 */
export function showPane(paneId: string): boolean {
    return ui()?.openPane?.(paneId) === true;
}

/** Asks the kernel to hide whatever pane is open. */
export function hidePane(): void {
    ui()?.closePane?.();
}
