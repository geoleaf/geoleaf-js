/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Language-switcher capability — lifecycle / mount wiring.
 *
 * Two mount points, one component:
 *   - **≥ 1440 px** — the desktop tab strip, reached through the existing
 *     `geoleaf:desktop-panel:tabs-ready` seam (plus a catch-up when the strip already
 *     exists, i.e. the seam fired before this init);
 *   - **< 1440 px** — the mobile toolbar, which is built asynchronously, hence the
 *     `MutationObserver` (same pattern as the kernel's own theme-toggle injection).
 */
"use strict";

import { getLanguageSwitcherConfig } from "./config.js";
import {
    appendLanguageButtonToTabs,
    buildLanguageButton,
    removeLanguageButtonsFromDocument,
    LANG_BUTTON_CLASS,
} from "./language-button.js";
import type { DesktopTabsReadyDetail } from "../../kernel/ui/desktop/desktop-tabs-seam.js";

let _started = false;
let _seamHandler: EventListener | null = null;
let _toolbarObserver: MutationObserver | null = null;

/** Injects the mobile variant into the toolbar scroller, once it exists. */
function _tryInjectMobile(): boolean {
    const scroll =
        document.querySelector<HTMLElement>(".gl-map-toolbar__scroll") ??
        document.querySelector<HTMLElement>(".gl-map-toolbar");
    if (!scroll) return false;
    if (scroll.querySelector(`.${LANG_BUTTON_CLASS}`)) return true;
    const btn = buildLanguageButton("mobile");
    btn.classList.add("gl-map-toolbar__btn");
    scroll.appendChild(btn);
    return true;
}

/** Idempotent mount for the language-switcher capability. Safe to call twice. */
export const LanguageSwitcherLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;

        // User-facing default OFF — opt-in on the merged config.
        if (getLanguageSwitcherConfig().enabled !== true) return;

        _seamHandler = ((e: CustomEvent<DesktopTabsReadyDetail>) => {
            if (e.detail?.tabs) appendLanguageButtonToTabs(e.detail.tabs);
        }) as EventListener;
        document.addEventListener("geoleaf:desktop-panel:tabs-ready", _seamHandler);

        // Catch-up: the strip may already be built (seam fired before this init).
        const tabs = document.querySelector<HTMLElement>(".gl-rp-tabs");
        if (tabs) appendLanguageButtonToTabs(tabs);

        // Mobile toolbar — built asynchronously, so watch for it.
        if (!_tryInjectMobile()) {
            _toolbarObserver = new MutationObserver(() => {
                if (_tryInjectMobile()) {
                    _toolbarObserver?.disconnect();
                    _toolbarObserver = null;
                }
            });
            _toolbarObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    /** Detaches listeners and removes the buttons (module destroy / test seam). */
    _reset(): void {
        if (typeof document !== "undefined" && _seamHandler) {
            document.removeEventListener("geoleaf:desktop-panel:tabs-ready", _seamHandler);
        }
        _seamHandler = null;
        _toolbarObserver?.disconnect();
        _toolbarObserver = null;
        removeLanguageButtonsFromDocument();
        _started = false;
    },
};
