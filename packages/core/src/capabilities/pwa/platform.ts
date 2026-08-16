/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Platform / user-agent detection helpers.
 *
 * iOS Safari never fires `beforeinstallprompt`, so the PWA capability must sniff the
 * user agent to route between the native install banner and the manual iOS
 * instructions. That sniff used to live twice and drift: a bare `/iPhone|iPad|iPod/`
 * regex in `pwa-manager` and a UA + `navigator.standalone` variant in `ios-banner`.
 * Both now share this single leaf module — it imports nothing (no capability, no
 * cycle) so any part of the core can depend on it.
 */

/** `true` when the current user agent is an iPhone / iPad / iPod. */
export function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * `true` on iOS Safari when the app is NOT already installed — i.e. the user can still
 * add it to the home screen. iOS never fires `beforeinstallprompt`, so this UA +
 * `navigator.standalone` check is the only "installable" signal available on that
 * platform (used by `PWAManager.isInstallable()` and the iOS instructions banner).
 */
export function isIOSInstallable(): boolean {
    if (!isIOS()) return false;
    // `navigator.standalone` is `true` when already running as an installed PWA
    // (non-standard iOS Safari property, absent from the lib DOM typings).
    const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return !isStandalone;
}
