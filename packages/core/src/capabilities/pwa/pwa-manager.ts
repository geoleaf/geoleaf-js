/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description GeoLeaf PWA Manager — orchestrates the install prompt experience.
 *
 * Activated by `GeoLeaf.PWA.init(config)` after the application config is loaded.
 * The install prompt is **opt-in**: it only activates when
 * `pwa.installPrompt.enabled` is `true` in `geoleaf.config.json`.
 *
 * Platform routing:
 * - **iOS Safari** → `IosBanner` (manual instructions — `beforeinstallprompt` not available on iOS)
 * - **Android / Chrome / Edge** → `InstallPrompt` (native `beforeinstallprompt` banner)
 *
 * @example
 * // geoleaf.config.json
 * {
 *   "pwa": {
 *     "name": "My App",
 *     "short_name": "MyApp",
 *     "theme_color": "#2d6a4f",
 *     "background_color": "#ffffff",
 *     "installPrompt": { "enabled": true }
 *   }
 * }
 */

import { InstallPrompt } from "./install-prompt.js";
import { IosBanner } from "./ios-banner.js";
import { isIOS, isIOSInstallable } from "./platform.js";

/**
 * Configuration for the PWA install prompt behaviour.
 */
export interface InstallPromptConfig {
    /**
     * Set to `true` to enable the install banner.
     * @defaultValue false
     */
    enabled?: boolean;
}

/**
 * The `modules.pwa` configuration block.
 *
 * **Canonical shape** — this is the single declaration of the block. `lifecycle.ts` and
 * `install.ts` derive their own narrower views from it with `Pick<>` rather than
 * redeclaring it (they used to, and the three copies had already drifted apart: neither
 * carried the manifest fields, and this one carried neither `enabled` nor
 * `offlineDetector`). The authoritative runtime schema is `pwa-capability.ts` — keep the
 * two in sync.
 *
 * @example
 * // profiles/geoleaf.config.json
 * {
 *   "modules": {
 *     "pwa": {
 *       "enabled": true,
 *       "name": "My App",
 *       "short_name": "MyApp",
 *       "theme_color": "#2d6a4f",
 *       "background_color": "#ffffff",
 *       "installPrompt": { "enabled": true },
 *       "offlineDetector": { "enabled": true }
 *     }
 *   }
 * }
 */
export interface PWAConfig {
    /**
     * Master gate (**opt-in**, defaults to `false`): registers the service worker, enables
     * the install prompt and emits the manifest. Everything below is inert without it.
     */
    enabled?: boolean;
    /** Full application name — used in the generated `manifest.json`. */
    name?: string;
    /** Short name displayed under the home-screen icon. */
    short_name?: string;
    /** Description of the application. */
    description?: string;
    /** Theme color for the browser chrome and splash screen (hex, e.g. `"#2d6a4f"`). */
    theme_color?: string;
    /** Background color for the PWA splash screen (hex, e.g. `"#ffffff"`). */
    background_color?: string;
    /** Install prompt / iOS banner configuration. */
    installPrompt?: InstallPromptConfig;
    /** Online/offline connectivity badge. */
    offlineDetector?: { enabled?: boolean };
}

/**
 * GeoLeaf PWA Manager.
 * Initializes the appropriate install prompt experience based on the platform.
 */
export const PWAManager = {
    /**
     * Initializes the PWA install prompt for the current platform.
     *
     * - **Opt-in**: does nothing unless `config.installPrompt.enabled === true`.
     * - **iOS Safari**: displays a bottom sheet with manual install instructions.
     * - **Other browsers**: listens for `beforeinstallprompt` and shows a custom banner.
     *
     * Call this method after the GeoLeaf config has been loaded (i.e. from `app/boot.ts`).
     *
     * @param config - PWA section from the loaded `geoleaf.config.json`.
     */
    init(config: PWAConfig): void {
        if (config?.installPrompt?.enabled !== true) return;

        // App name shown in the banners — prefers the short name (home-screen label),
        // falls back to the full name, then to the library default.
        const appName = config.short_name ?? config.name ?? "GeoLeaf";
        if (isIOS()) {
            IosBanner.init(appName);
        } else {
            InstallPrompt.init(appName);
        }
    },

    /**
     * `true` when the app can still be installed on this device — for integrators who
     * want to render their own install button instead of (or alongside) the built-in
     * banner.
     *
     * Mirrors the platform split of {@link PWAManager.init}:
     * - **iOS Safari** — never fires `beforeinstallprompt`; answers from the UA +
     *   `navigator.standalone` check (installable = iOS and not already installed).
     * - **Android / Chrome / Edge** — answers `true` once the browser has handed us a
     *   deferred `beforeinstallprompt` event.
     *
     * ⚠️ On Android this reports **"a prompt is available"**, not "the browser could
     * install this app": the deferred event is only captured if {@link PWAManager.init}
     * has run, which is gated on `modules.pwa.installPrompt.enabled === true`. With the
     * prompt disabled, it answers `false` even on an installable Chrome. iOS is
     * unaffected — its check needs no listener.
     *
     * @returns `true` if an install path is available right now.
     */
    isInstallable(): boolean {
        return isIOSInstallable() || InstallPrompt.isInstallable();
    },

    /**
     * Registry destroy / test seam: tears down both install sub-flows (the Android
     * install-prompt global listeners and the iOS banner timer/banner) so a re-init
     * starts clean (S7.5 — no listener / timer leak).
     */
    _reset(): void {
        InstallPrompt._reset();
        IosBanner._reset();
    },
};
