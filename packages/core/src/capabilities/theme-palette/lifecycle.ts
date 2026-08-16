/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-palette capability — lifecycle / mount wiring.
 *
 * Two responsibilities, and only the SECOND one is gated:
 *   1. **Apply the resolved palette** — always. Even with the selector disabled, the
 *      configured `default` must take effect: that is the majority production case
 *      (integrator fixes a brand colour and offers no choice).
 *   2. **Mount the button** — only when `enabled === true`.
 */

import { getThemePaletteConfig, getPalettes } from "./config.js";
import { applyPalette, resolveInitialPalette } from "./palette-engine.js";
import {
    appendPaletteButtonToTabs,
    buildPaletteButton,
    removePaletteButtonsFromDocument,
    PALETTE_BUTTON_CLASS,
} from "./palette-button.js";
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
    if (scroll.querySelector(`.${PALETTE_BUTTON_CLASS}`)) return true;
    const btn = buildPaletteButton("mobile");
    btn.classList.add("gl-map-toolbar__btn");
    scroll.appendChild(btn);
    return true;
}

/** Idempotent mount for the theme-palette capability. Safe to call twice. */
export const ThemePaletteLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;

        // (1) Apply FIRST, and unconditionally. Called from `module.init()`, i.e. before
        // the UI is painted, so the stored palette is in place from the first frame —
        // no orange→green flash. `persist: false`: reading a preference must not
        // immediately rewrite it.
        applyPalette(resolveInitialPalette(), false);

        // (2) The button is opt-in, and pointless with a single palette.
        if (getThemePaletteConfig().enabled !== true) return;
        if (getPalettes().length < 2) return;

        _seamHandler = ((e: CustomEvent<DesktopTabsReadyDetail>) => {
            if (e.detail?.tabs) appendPaletteButtonToTabs(e.detail.tabs);
        }) as EventListener;
        document.addEventListener("geoleaf:desktop-panel:tabs-ready", _seamHandler);

        // Catch-up: the strip may already exist (seam fired before this init).
        const tabs = document.querySelector<HTMLElement>(".gl-rp-tabs");
        if (tabs) appendPaletteButtonToTabs(tabs);

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
        removePaletteButtonsFromDocument();
        _started = false;
    },
};
