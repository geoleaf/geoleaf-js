/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description iOS PWA installation instructions banner.
 *
 * On iOS Safari, `beforeinstallprompt` does not exist. This module detects
 * the iOS environment and shows a bottom sheet with manual install instructions:
 * "Tap the share icon, then 'Add to Home Screen'".
 *
 * The banner is shown once per browser (dismissal persisted in localStorage).
 * It is not shown if the app is already running in standalone mode.
 */

import { applyCssText } from "../../utils/general/dom-helpers.js";
import { isIOSInstallable } from "./platform.js";
import { getLabel } from "../../utils/i18n/i18n.js";

const IOS_DISMISSED_KEY = "gl_pwa_ios_dismissed";

/** Pending show-timer id (1.5 s delay), or null when none is scheduled. */
let _timer: ReturnType<typeof setTimeout> | null = null;
/** The mounted banner element, or null when not shown. */
let _banner: HTMLElement | null = null;

// iOS share icon — simplified Apple share symbol (SVG inline, no external resource).
// No inline `style` attribute (CSP style-src): layout comes from the wrapper.
const SHARE_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="20" viewBox="0 0 16 20" ' +
    'fill="currentColor" aria-hidden="true">' +
    '<path d="M8 0L4 4h3v9h2V4h3L8 0z"/>' +
    '<path d="M0 7v11a1 1 0 001 1h14a1 1 0 001-1V7a1 1 0 00-1-1h-3v2h2v8H2V8h2V6H1a1 1 0 00-1 1z"/>' +
    "</svg>";

function _isDismissed(): boolean {
    try {
        return localStorage.getItem(IOS_DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

function _dismiss(banner: HTMLElement): void {
    try {
        localStorage.setItem(IOS_DISMISSED_KEY, "1");
    } catch {
        // localStorage unavailable — silently ignore
    }
    banner.remove();
}

/** Builds the banner header (title + close button bound to dismiss). */
function _buildBannerHeader(banner: HTMLElement, appName: string): HTMLElement {
    const header = document.createElement("div");
    applyCssText(
        header,
        "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"
    );

    const title = document.createElement("strong");
    applyCssText(title, "font-size:15px;");
    title.textContent = getLabel("pwa.ios.title", appName);

    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("aria-label", getLabel("pwa.ios.close"));
    closeBtn.textContent = "✕";
    applyCssText(
        closeBtn,
        [
            "background:transparent",
            "border:none",
            "color:#aaa",
            "cursor:pointer",
            "font-size:20px",
            "padding:0",
            "line-height:1",
        ].join(";")
    );
    closeBtn.addEventListener("click", () => _dismiss(banner));

    header.appendChild(title);
    header.appendChild(closeBtn);
    return header;
}

/** Builds the instruction body (share icon + "Add to Home Screen" text). */
function _buildBannerBody(): HTMLElement {
    const body = document.createElement("div");
    applyCssText(body, "display:flex;align-items:flex-start;gap:10px;line-height:1.6;");

    const iconWrap = document.createElement("span");
    applyCssText(iconWrap, "color:#2d6a4f;flex-shrink:0;margin-top:2px;");
    iconWrap.innerHTML = SHARE_ICON_SVG; // SAFE: hardcoded SVG constant — no user data

    // Build the instruction line via DOM (no inline `style` attribute — CSP).
    const instructions = document.createElement("span");
    instructions.appendChild(document.createTextNode(getLabel("pwa.ios.instructions_pre")));
    const iconInline = document.createElement("span");
    applyCssText(
        iconInline,
        "color:#2d6a4f;display:inline-flex;align-items:center;vertical-align:middle;"
    );
    iconInline.innerHTML = SHARE_ICON_SVG; // SAFE: hardcoded SVG constant — no user data
    instructions.appendChild(iconInline);
    instructions.appendChild(document.createTextNode(getLabel("pwa.ios.instructions_mid")));
    const strong = document.createElement("strong");
    strong.textContent = getLabel("pwa.ios.home_screen");
    instructions.appendChild(strong);

    body.appendChild(iconWrap);
    body.appendChild(instructions);
    return body;
}

function _createBanner(appName: string): HTMLElement {
    const div = document.createElement("div");
    div.id = "gl-ios-install-banner";
    div.setAttribute("role", "complementary");
    div.setAttribute("aria-label", getLabel("pwa.ios.aria", appName));
    applyCssText(
        div,
        [
            "position:fixed",
            "bottom:0",
            "left:0",
            "right:0",
            "background:#1c1c1e",
            "color:#fff",
            "padding:16px 16px 20px",
            "box-shadow:0 -2px 16px rgba(0,0,0,0.4)",
            "z-index:99999",
            "font-family:inherit",
            "font-size:13px",
            "border-top-left-radius:12px",
            "border-top-right-radius:12px",
        ].join(";")
    );

    div.appendChild(_buildBannerHeader(div, appName));
    div.appendChild(_buildBannerBody());
    return div;
}

/**
 * iOS PWA installation instructions banner controller.
 */
export const IosBanner = {
    /**
     * Shows the iOS install instructions banner if the current environment is
     * iOS Safari and the app has not been dismissed or already installed.
     * Displayed after a 1.5 s delay to avoid interfering with the initial render.
     */
    init(appName = "GeoLeaf"): void {
        if (!isIOSInstallable() || _isDismissed() || _timer !== null || _banner) return;

        _timer = setTimeout(() => {
            _timer = null;
            _banner = _createBanner(appName);
            document.body.appendChild(_banner);
        }, 1500);
    },

    /**
     * Registry destroy / test seam: cancels a pending show-timer and removes the banner
     * so a re-init starts clean (S7.5 — no dangling timer / duplicate banner).
     */
    _reset(): void {
        if (_timer !== null) {
            clearTimeout(_timer);
            _timer = null;
        }
        if (_banner) {
            _banner.remove();
            _banner = null;
        }
    },
};
