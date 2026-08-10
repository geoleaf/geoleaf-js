/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Shared `geoleaf:toolbar:action` dispatch for plugin-registered actions.
 *
 * Lives in `ui/` root because both `ui/desktop/` (tab strip buttons) and
 * `ui/mobile/` (toolbar pill) dispatch the same event and the ESLint
 * `no-restricted-imports` boundary forbids them from importing each other
 * (archi B.4). Extracted in KERNEL S8 from two byte-identical blocks.
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { Log } from "../../utils/log/index.js";

/** Subset of `GeoLeaf.plugins` consumed when resolving a lazy action. */
interface DispatchPluginsLike {
    isLazyAction?: (action: string) => boolean;
    ensureLoadedForAction?: (action: string) => Promise<void>;
}

/** Emits the toolbar action event for `element`. */
function _emit(action: string, element: HTMLElement): void {
    document.dispatchEvent(
        new CustomEvent("geoleaf:toolbar:action", {
            detail: { action, element },
            bubbles: false,
        })
    );
}

/**
 * Dispatches `geoleaf:toolbar:action` for a plugin-registered toolbar action.
 *
 * When the action belongs to a lazy plugin, the bundle is loaded first and the
 * event is emitted afterwards, so the plugin's listener is registered by the
 * time it fires. Load failures are logged, not thrown.
 *
 * Fire-and-forget: returns immediately in the lazy case. Callers that guard on
 * `action` must keep their own control flow (early `return`) around the call —
 * this function reports nothing about which path it took.
 *
 * @param action - The action id carried by `data-gl-toolbar-action`.
 * @param element - The button that triggered the action, forwarded in `detail`.
 */
export function dispatchToolbarAction(action: string, element: HTMLElement): void {
    const plugins = getGeoLeaf()?.plugins as DispatchPluginsLike | undefined;
    if (plugins?.isLazyAction?.(action)) {
        (plugins.ensureLoadedForAction!(action) as Promise<void>)
            .then(() => _emit(action, element))
            .catch((err: unknown) => Log.error("[GeoLeaf] lazy plugin load failed:", err));
        return;
    }
    _emit(action, element);
}
