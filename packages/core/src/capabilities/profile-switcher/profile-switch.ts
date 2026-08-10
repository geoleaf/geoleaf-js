/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Profile-switcher capability — the switch itself.
 *
 * Switching profile reloads the page: a profile redefines layers, taxonomy, themes
 * and bounds, so swapping it in place would mean tearing down and rebuilding the whole
 * GeoJSON pipeline. The reload path is the mechanism the demo layer used before T1b
 * removed it, and it is reproduced here — persistence excepted, which is new (S1).
 */
"use strict";

import { Log } from "../../utils/log/index.js";

/** Same guard the boot applies — a forged id must never reach a fetch path. */
const PROFILE_ID_RE = /^[a-zA-Z0-9_-]{1,50}$/;

/** localStorage key holding the user's standing profile choice (read by `boot-core`). */
export const PROFILE_STORAGE_KEY = "gl-profile";

/**
 * Asks the service worker to drop its caches, so the reload refetches the new
 * profile's resources instead of replaying the previous profile's.
 *
 * Best-effort and deliberately not awaited: a page with no service worker, or one
 * whose worker never answers, must still reload.
 */
function _clearServiceWorkerCache(): void {
    try {
        const sw = navigator.serviceWorker;
        if (!sw?.controller) return;
        const channel = new MessageChannel();
        sw.controller.postMessage({ type: "CLEAR_CACHE" }, [channel.port2]);
    } catch (e) {
        Log?.warn?.("[ProfileSwitcher] Service worker cache purge failed:", e);
    }
}

/**
 * Persists `profileId`, purges the service-worker cache and reloads onto that profile.
 *
 * The id is written to BOTH stores, and they do different jobs:
 *   - `sessionStorage` — consumed by `boot-core` on the very next load (one-shot),
 *     which is what makes the reload land on the chosen profile even if localStorage
 *     is unavailable;
 *   - `localStorage` — the durable preference, restored on later visits.
 *
 * @param profileId - Target profile id (validated).
 */
export function switchToProfile(profileId: string): void {
    if (!PROFILE_ID_RE.test(profileId)) {
        Log?.warn?.("[ProfileSwitcher] Refusing invalid profile id:", profileId);
        return;
    }

    try {
        sessionStorage.setItem("gl-selected-profile", profileId);
    } catch (e) {
        Log?.warn?.("[ProfileSwitcher] Unable to write sessionStorage:", e);
    }

    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
    } catch (e) {
        // Private browsing: the switch still works for this load (sessionStorage), it
        // just will not be remembered on the next visit.
        Log?.warn?.("[ProfileSwitcher] Unable to persist profile choice:", e);
    }

    _clearServiceWorkerCache();

    // Cache-busting query so the profile's JSON resources are refetched rather than
    // served from the HTTP cache.
    try {
        const url = new URL(window.location.href);
        url.searchParams.set("profile", profileId);
        url.searchParams.set("t", String(Date.now()));
        window.location.href = url.href;
    } catch (e) {
        Log?.error?.("[ProfileSwitcher] Profile switch failed:", e);
    }
}
