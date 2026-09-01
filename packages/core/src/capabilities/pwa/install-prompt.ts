/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Android PWA install prompt.
 *
 * Captures the `beforeinstallprompt` event and displays a custom bottom banner
 * with an "Install" button. The dismissal state is persisted in localStorage so
 * the banner is only shown once per browser profile.
 *
 * iOS does not fire `beforeinstallprompt` — use `IosBanner` instead.
 */

import { applyCssText } from "../../utils/general/dom-helpers.js";
import { getLabel } from "../../utils/i18n/i18n.js";

/** Browser-native `beforeinstallprompt` event (not yet in all TS libs). */
interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
    prompt(): Promise<void>;
}

const DISMISSED_KEY = "gl_pwa_install_dismissed";

let _deferredPrompt: BeforeInstallPromptEvent | null = null;
let _banner: HTMLElement | null = null;
/** `true` once the global listeners are attached — guards against double-registration. */
let _wired = false;
/** App name shown in the banner (from `modules.pwa.short_name`/`name`); set by `init`. */
let _appName = "GeoLeaf";

function _isDismissed(): boolean {
    try {
        return localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

function _persist(): void {
    try {
        localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
        // localStorage unavailable — silently ignore
    }
}

function _removeBanner(): void {
    if (_banner) {
        _banner.remove();
        _banner = null;
    }
}

function _dismiss(): void {
    _persist();
    _removeBanner();
}

/** Builds the "Installer" action button (triggers the deferred prompt). */
function _buildInstallButton(): HTMLButtonElement {
    const installBtn = document.createElement("button");
    installBtn.setAttribute("type", "button");
    installBtn.textContent = getLabel("pwa.install.button");
    applyCssText(
        installBtn,
        [
            "background:#fff",
            "color:#2d6a4f",
            "border:none",
            "border-radius:4px",
            "padding:6px 12px",
            "font-weight:600",
            "cursor:pointer",
            "font-size:13px",
            "white-space:nowrap",
            "flex-shrink:0",
        ].join(";")
    );
    installBtn.addEventListener("click", () => {
        const pending = _deferredPrompt;
        if (!pending) return;
        pending
            .prompt()
            .then(() => pending.userChoice)
            .then(() => {
                _deferredPrompt = null;
                _dismiss();
            })
            .catch(() => {
                // The native prompt was dismissed or had already been consumed —
                // the banner simply stays until the next beforeinstallprompt.
            });
    });
    return installBtn;
}

/** Builds the dismiss (✕) button. */
function _buildCloseButton(): HTMLButtonElement {
    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("aria-label", getLabel("pwa.install.close"));
    closeBtn.textContent = "✕";
    applyCssText(
        closeBtn,
        [
            "background:transparent",
            "border:none",
            "color:#fff",
            "cursor:pointer",
            "font-size:16px",
            "padding:0 4px",
            "line-height:1",
            "flex-shrink:0",
        ].join(";")
    );
    closeBtn.addEventListener("click", _dismiss);
    return closeBtn;
}

function _createBanner(appName: string): HTMLElement {
    const div = document.createElement("div");
    div.id = "gl-install-banner";
    div.setAttribute("role", "banner");
    div.setAttribute("aria-live", "polite");
    applyCssText(
        div,
        [
            "position:fixed",
            "bottom:16px",
            "left:50%",
            "transform:translateX(-50%)",
            "background:#2d6a4f",
            "color:#fff",
            "border-radius:8px",
            "padding:12px 16px",
            "box-shadow:0 4px 16px rgba(0,0,0,0.25)",
            "display:flex",
            "align-items:center",
            "gap:12px",
            "z-index:99999",
            "max-width:calc(100vw - 32px)",
            "font-family:inherit",
            "font-size:14px",
            "line-height:1.4",
        ].join(";")
    );

    const text = document.createElement("span");
    text.textContent = getLabel("pwa.install.title", appName);

    div.appendChild(text);
    div.appendChild(_buildInstallButton());
    div.appendChild(_buildCloseButton());
    return div;
}

/** `beforeinstallprompt` handler — defers the prompt and shows the banner once. */
function _onBeforeInstallPrompt(e: Event): void {
    e.preventDefault();
    _deferredPrompt = e as BeforeInstallPromptEvent;
    if (!_banner) {
        _banner = _createBanner(_appName);
        document.body.appendChild(_banner);
    }
}

/** `appinstalled` handler — the app was installed by another path; dismiss the banner. */
function _onAppInstalled(): void {
    _deferredPrompt = null;
    _dismiss();
}

/**
 * Android PWA install prompt controller.
 */
export const InstallPrompt = {
    /**
     * Registers event listeners for `beforeinstallprompt` and `appinstalled`.
     * Shows a banner when the browser signals the PWA is installable.
     * Does nothing if the user has previously dismissed the prompt, and is idempotent
     * (a second call does not stack a second set of global listeners).
     */
    init(appName = "GeoLeaf"): void {
        if (_isDismissed() || _wired) return;
        _appName = appName;
        _wired = true;

        // Bare event target (global scope) avoids the unicorn/prefer-globalThis lint rule.
        // Named handlers (not inline closures) so _reset can detach the exact references.
        addEventListener("beforeinstallprompt", _onBeforeInstallPrompt);
        // Auto-dismiss if the app gets installed through another path.
        addEventListener("appinstalled", _onAppInstalled);
    },

    /** Returns `true` if the browser has a deferred install prompt ready. */
    isInstallable(): boolean {
        return _deferredPrompt !== null;
    },

    /**
     * Registry destroy / test seam: detaches the global listeners, hides the banner and
     * clears the deferred prompt so a re-init starts clean (no listener leak).
     */
    _reset(): void {
        removeEventListener("beforeinstallprompt", _onBeforeInstallPrompt);
        removeEventListener("appinstalled", _onAppInstalled);
        _removeBanner();
        _deferredPrompt = null;
        _wired = false;
    },
};
