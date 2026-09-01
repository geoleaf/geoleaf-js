/*!
 * GeoLeaf Core (share capability) — lifecycle / boot wiring
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Lifecycle for the in-core `share` capability.
 *
 * Wires two kernel seams so the kernel never imports the capability statically:
 *   - `geoleaf:toolbar:action` — opens the share modal when a share button dispatches
 *     `{ action: "share" }` (desktop + mobile).
 *   - `geoleaf:desktop-panel:tabs-ready` — the desktop panel emits this once its tab
 *     strip is built; the capability injects its bottom "Share" button (mirrors the
 *     labels `geoleaf:layer-item:controls` seam). `init()` also performs a catch-up
 *     injection when the strip already exists (subscription-after-render / recreate).
 *
 * `init()` is idempotent (`_started` guard); `_reset()` detaches both listeners
 * (registry destroy / test seam). Since the presets build (S2 Lot 6) it is called by
 * `ShareModule.init()` **alone** — the kernel (`setupUI`) no longer imports this file.
 * Ordering is safe by construction: `ShareModule` has no dependencies, so the registry
 * dequeues it 2nd (right after `security`), six modules before `UIModule.init()` builds
 * the desktop panel and emits `geoleaf:desktop-panel:tabs-ready`. The catch-up injection
 * below covers any future reordering anyway.
 */

import { openShareModal, closeShareModal } from "./share-modal.js";
import { appendShareButtonToTabs, removeShareButtonsFromDocument } from "./share-button-desktop.js";
import type { DesktopTabsReadyDetail } from "../../../kernel/ui/desktop/desktop-tabs-seam.js";
import type { GeoLeafRawEventMap } from "../../../contracts/event-bus.contract.js";

let _started = false;

function _onToolbarAction(e: Event): void {
    // Typed from the contract instead of a locally guessed `{ action?: string }`. The emitter
    // always sets both fields (`kernel/ui/toolbar-dispatch.ts`), so `action` is not
    // optional — the `?.` below now guards only against a `detail`-less event, which some
    // test suites do dispatch. (It named one suite until the 19/08/2026; that suite left with
    // its plugin, and the guard is still needed — so naming it made the guard look obsolete.)
    const detail = (e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>).detail;
    if (detail?.action === "share") openShareModal();
}

function _onDesktopTabsReady(e: Event): void {
    const detail = (e as CustomEvent<DesktopTabsReadyDetail>).detail;
    if (detail?.tabs) appendShareButtonToTabs(detail.tabs);
}

/** Idempotent lifecycle for the share capability. */
export const ShareLifecycle = {
    /**
     * Attaches the toolbar-action + desktop-tabs listeners (idempotent) and injects the
     * desktop button into an already-rendered tab strip (catch-up for late subscription
     * / registry recreate). `appendShareButtonToTabs` is itself gated (opt-out) and
     * idempotent, so the catch-up is safe when the seam also fires.
     */
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        document.addEventListener("geoleaf:toolbar:action", _onToolbarAction);
        document.addEventListener("geoleaf:desktop-panel:tabs-ready", _onDesktopTabsReady);
        const tabs = document.querySelector<HTMLElement>(".gl-rp-tabs");
        if (tabs) appendShareButtonToTabs(tabs);
    },

    /**
     * Registry destroy / test seam: undoes everything `init()` did to a DOM the
     * capability does not own — the two document listeners, the injected desktop
     * button, and an open modal.
     *
     * The last two are not symmetry for its own sake. Both survive a `destroy()` with
     * no re-init: the button stays painted in the tab strip with its click listener,
     * and an open modal keeps a `document`-level `keydown` handler plus a full-screen
     * overlay on top of a torn-down capability. `closeShareModal()` is a no-op when
     * no modal is open, so ordering against `openShareModal` never matters.
     */
    _reset(): void {
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:toolbar:action", _onToolbarAction);
            document.removeEventListener("geoleaf:desktop-panel:tabs-ready", _onDesktopTabsReady);
        }
        closeShareModal();
        removeShareButtonsFromDocument();
        _started = false;
    },
};
