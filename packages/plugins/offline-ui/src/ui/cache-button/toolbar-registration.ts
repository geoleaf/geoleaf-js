/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Cache toolbar registration
 * @description Registers the offline-cache button as a core toolbar slot
 * (desktop band + mobile pill) via `GeoLeaf.registry.register`, replacing the
 * former top-left MapLibre IControl, and opens the modal on toolbar action.
 *
 * Extracted from entry.ts so the registration + event wiring can be unit-tested
 * in isolation (no heavy module graph).
 * @version 1.0.0
 */

// Toolbar seam shape imported from the published contract instead of a local
// re-declaration: the 7 plugins carried 4 diverging shapes of it. This one's
// (`{ action?: string }`) was the laxest — the emitter always sets `action`.
import type { GeoLeafRawEventMap } from "@geoleaf/core";
import { registerPluginModule } from "@geoleaf/host-runtime";
import { removeSwUpdateBanner } from "../../core/sw-update-banner.js";
import { ModalManager } from "./modal-manager.js";

/** Minimal shape of the global GeoLeaf surface used here. */
interface GeoLeafToolbarHost {
    GeoLeaf?: {
        UI?: { CacheButton?: { openModal?: () => void } };
    };
}

/**
 * Takes the offline window down with the application it belonged to.
 *
 * 🛑 THE WINDOW OUTLIVED AN UNMOUNT. Measured in a browser: opened, then `unmount()` — it
 * stayed open over the page, with the thirty-odd listeners its blocks had put on `document`,
 * and covered the next application. Closing first releases the focus trap; destroying
 * releases the control in its body, then removes the node. The next opening builds it again.
 */
function destroyCacheWindow(): void {
    ModalManager.closeModal();
    ModalManager.destroy();
    // The « new version » banner is on `document.body`, outside everything the core removes:
    // it would stay over the page of a host that unmounted the application. The next boot
    // shows it again if the update still waits.
    removeSwUpdateBanner();
}

// Offline-cache icon (refresh, 22px, stroke currentColor) — sanitised by core
// DOMSecurity.setSafeHTML when the slot is rendered.
const CACHE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>' +
    "</svg>";

/**
 * Toolbar action id shared between the slot definition and the listener.
 *
 * ⚠️ Plugin rename — this is the id that goes into the DOM
 * (`data-gl-toolbar-action`) and that two E2E specs target. It follows the
 * plugin rename, unlike the i18n key prefix (`storage.*`), which stays: that one
 * is a PROFILE OVERRIDE surface (`_overrides[key]` in `utils/i18n/i18n.ts`),
 * hence a public contract wider than the plugin's identity. The two namespaces
 * are independent — `registerDict` only files into a bucket, resolution goes
 * through the flat key.
 */
const CACHE_TOOLBAR_ACTION = "offline-ui";

/**
 * Registers the plugin's lifecycle module — its teardown, and its toolbar slot when it loads
 * before the boot — and wires the open-modal listener.
 * Visibility is gated by the `ui.showCacheButton` profile key (handled by the
 * core) and `requiresPlugin: "offline-ui"`.
 *
 * ⚠️ The module goes to the registry of the PAGE's `GeoLeaf` (`registerPluginModule`), not to
 * `host`: the registry that unmounts an application is the one the core mounted.
 *
 * @param host - the global object exposing `GeoLeaf` (defaults to globalThis); read for the
 *   modal's opening.
 */
export function registerCacheToolbar(
    host: GeoLeafToolbarHost = globalThis as unknown as GeoLeafToolbarHost
): void {
    const slot = {
        icon: CACHE_ICON,
        labelKey: "storage.toolbar.button",
        profileKey: "modules.offline-ui.showButton",
        legacyProfileKey: "ui.showCacheButton",
        // Opt-in: hidden unless the profile turns it on — canonical
        // `modules.offline-ui.showButton`, or the legacy `ui.showCacheButton` when the
        // canonical key is absent. Documented default false in the config guide.
        //
        // ⚠️ This comment used to justify the convention with "matches ui.showAddPoi".
        // The `addpoi` capability was removed in S5, so it aligned on an example that no
        // longer exists — the convention now stands on INV-CONFIG and its gate `PC-14`,
        // which is a rule rather than a precedent.
        defaultVisible: false,
        requiresPlugin: "offline-ui",
        action: CACHE_TOOLBAR_ACTION,
    };

    registerPluginModule({
        id: "offline-ui",
        destroy: destroyCacheWindow,
        ui: { mobileIcon: { ...slot }, desktopTabButton: { ...slot } },
    });

    if (typeof document !== "undefined") {
        document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
            const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
            if (ce.detail?.action === CACHE_TOOLBAR_ACTION) {
                host.GeoLeaf?.UI?.CacheButton?.openModal?.();
            }
        });
    }
}
