/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @file sw-register.ts
 * @description Service Worker registration — one gesture, `register()`.
 *
 * ⚠️ THIS HEADER DESCRIBED THREE FICTIONS, since corrected:
 *   · "Handles SW lifecycle: register, update, unregister" — `update()` and
 *     `unregister()` had no production caller and are removed; real unregistration
 *     is done by `capabilities/pwa/lifecycle.ts` (`_unregisterAll`), which iterates
 *     `getRegistrations()` without reading `_registration`;
 *   · "The plugin SW (sw.js) replaces it" — no `sw.js` exists in this repo;
 *   · "storage.enableServiceWorker = true in the profile" — that key is set by NO
 *     profile, and it was removed by the same fix.
 *
 * What remains: `sw-core.js` is registered at startup by the `pwa` capability,
 * full stop.
 *
 * © 2026 Mattieu Pottier
 * Licensed under the MIT License
 * SPDX-License-Identifier: MIT
 */

import type { GeoLeafCacheEvictedDetail } from "../../contracts/event-bus.contract.js";
import { Log } from "../../utils/log/index.js";
import { dispatchGeoLeafEvent } from "../events/event-bus.js";

/**
 * Bridge in place? A second `register()` must not stack a second listener.
 *
 * ⚠️ The flag is MODULE-level and not on `SWRegister`: `register()` can be called
 * again (re-boot, scope change) and `navigator.serviceWorker` is a document
 * singleton — two listeners would make two toasts for one eviction.
 */
let _evictionBridgeWired = false;

/**
 * Re-establishes on `document` the signals the Service Worker cannot emit itself.
 *
 * 🛑 WHY THIS BRIDGE EXISTS. A worker has no `document`: it cannot dispatch
 * `geoleaf:cache:evicted`. Nor can it import the bus — it is copied as-is into each
 * deployment variant, no bundler. So it posts a message, and this file is the ONLY
 * place that turns it back into an event. Without it, an eviction under origin-quota
 * pressure — the precise moment the user needs to know space is running out — would
 * stay invisible, in the console of a worker nobody opens.
 *
 * 🛑 **THIS COMMENT CARRIED A MEASURED DEFECT FOR NINE DAYS.** It said:
 *
 * > ~~Page-side there is then nothing left to write: `offline-ui` already listens to
 * > `geoleaf:cache:evicted` for the IndexedDB eviction, and shows the same notice.~~
 *
 * The sentence was **true on `deploy-full` and false on `deploy-core`** — the
 * variant that does not embed `offline-ui`, and that ships to a client. A reader
 * come to verify the chain found assurance it was complete there, and stopped. The
 * textbook case of a fact exact in one perimeter, false in the other, stated
 * without its perimeter.
 *
 * ✅ Since the fix, the listener is **in-core and unconditional**:
 * `kernel/storage/eviction-notice.ts`, wired by `setupStorage()` — hence present on
 * every variant, and **independent of this bridge** (which only exists when a
 * worker registered, while `cache-manager` also emits outside PWA).
 *
 * ⚠️ The `type` check is not decorative. `navigator.serviceWorker` receives the
 * messages of EVERY worker in scope; re-dispatching without discriminating would
 * make any message an eviction signal.
 */
function _wireEvictionBridge(): void {
    if (_evictionBridgeWired) return;
    _evictionBridgeWired = true;

    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as { type?: string; detail?: GeoLeafCacheEvictedDetail } | null;
        if (!data || data.type !== "GEOLEAF_CACHE_EVICTED") return;

        const detail = data.detail;
        // A zero detail stays possible; `offline-ui` already early-exits on it, but
        // emitting an empty signal would teach its future listeners to distrust the
        // signal.
        if (!detail || typeof detail.evicted !== "number" || detail.evicted <= 0) return;

        Log.info(
            `[SWRegister] Cache de tuiles évincé par le worker (${detail.reason}) : ` +
                `${detail.evicted} entrée(s).`
        );
        dispatchGeoLeafEvent("geoleaf:cache:evicted", detail);
    });
}

/**
 * Service Worker registration helper.
 *
 * 🛑 IT IS NOT ON THE NAMESPACE, and its `@example` claimed otherwise.
 * `@namespace GeoLeaf._SWRegister` and `await GeoLeaf._SWRegister.register()`
 * described a member **nothing mounted**: the only assignment of
 * `GeoLeaf._SWRegister` in the whole repo is in a test harness. The example was
 * copy-pastable and false — the `typecheck-docs-examples` gate turned it red as
 * soon as the phantom declaration fell out of `global.d.ts`.
 *
 * The only real caller is `capabilities/pwa/lifecycle.ts`, by import.
 *
 * @example
 * import { SWRegister } from "./kernel/storage/index.js";
 * await SWRegister.register({ scope: "./" });
 */
const SWRegister = {
    /** @type {ServiceWorkerRegistration|null} */
    _registration: null as ServiceWorkerRegistration | null,

    /** Worker script path. Only one exists in this repo: `sw-core.js`. */
    _swPath: "sw-core.js",

    /**
     * Register the Service Worker.
     * No-op in environments that don't support Service Workers.
     *
     * @param {Object}  [options]
     * @param {string}  [options.path="sw-core.js"] - Script path. ⚠️ No caller sets
     *                  this parameter: it documented a second worker (`sw.js`) that
     *                  never existed in this repo.
     * @param {string}  [options.scope="/"]     - SW scope
     * @returns {Promise<ServiceWorkerRegistration|null>}
     * @example
     * const reg = await SWRegister.register({ scope: "./" });
     */
    async register(options: { path?: string; scope?: string } = {}) {
        if (!("serviceWorker" in navigator)) {
            Log.warn("[SWRegister] Service Workers not supported in this browser.");
            return null;
        }

        const swPath = options.path || this._swPath;
        const scope = options.scope || "/";

        try {
            const registration = await navigator.serviceWorker.register(swPath, { scope });
            this._registration = registration;

            Log.info(`[SWRegister] Service Worker registered (scope: ${registration.scope})`);

            // The eviction bridge. Set AFTER registration, hence never on a page
            // with no worker — and once, whatever the number of calls.
            _wireEvictionBridge();

            // Listen for updates
            registration.addEventListener("updatefound", () => {
                const newWorker = registration.installing;
                if (newWorker) {
                    newWorker.addEventListener("statechange", () => {
                        if (newWorker.state === "activated") {
                            Log.info("[SWRegister] New Service Worker activated.");
                            dispatchGeoLeafEvent("geoleaf:sw:updated", {});
                        }
                    });
                }
            });

            return registration;
        } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : String(error);
            Log.error(`[SWRegister] Registration failed: ${detail}`);
            throw error;
        }
    },

    // ⚠️ `update()`, `unregister()` and `getRegistration()` were REMOVED, and the
    // measurement is worth writing: none of the three had a production caller.
    //
    // 🛑 WHAT MAKES THE DELETION SAFE rather than optimistic: REAL unregistration
    // did not go through here. `capabilities/pwa/lifecycle.ts` (`_unregisterAll`)
    // iterates `navigator.serviceWorker.getRegistrations()` and unregisters
    // everything, without ever reading `_registration`. There were thus two
    // unregistration paths, only one of which ran — and the one that remains
    // depended in nothing on the one removed.
    //
    // `_registration` stays set by `register()`: it carries the update listener.
};

export { SWRegister };
