/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @file sw-register.ts
 * @description Service Worker registration — `register()` — and the update that WAITS:
 * `isUpdateWaiting()`, `applyUpdate()`, `geoleaf:sw:update-waiting`.
 *
 * ⚠️ THIS HEADER DESCRIBED THREE FICTIONS, since corrected:
 *   · "Handles SW lifecycle: register, update, unregister" — `update()` and
 *     `unregister()` had no production caller and are removed; real unregistration
 *     is done by `capabilities/pwa/lifecycle.ts` (`_unregisterOwn`), which enumerates
 *     `getRegistrations()` and keeps the ones whose `scriptURL` names `sw-core.js`;
 *   · "The plugin SW (sw.js) replaces it" — no `sw.js` exists in this repo;
 *   · "storage.enableServiceWorker = true in the profile" — that key is set by NO
 *     profile, and it was removed by the same fix.
 *
 * What remains: `sw-core.js` is registered at startup by the `pwa` capability.
 *
 * 🛑 AND A NEW VERSION NO LONGER TAKES THE PAGE BY ITSELF. `sw-core.js` skips the wait at a
 * first install only; at an update it stays `waiting`. A worker that waits and says nothing
 * waits for every tab to be closed — so this file says it, once per worker, and carries the
 * user's answer back. The interface that asks the question is not here: the offline plugin
 * shows a banner, and a host without it calls `GeoLeaf.PWA.applyUpdate()` itself.
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

/** The workers whose state is already followed — a registration hands the same ones back. */
const _followed = new WeakSet<ServiceWorker>();

/** The waiting workers already announced: one `update-waiting` per worker, however many boots. */
const _announced = new WeakSet<ServiceWorker>();

/** `controllerchange` listened to? `navigator.serviceWorker` is a document singleton. */
let _controllerWatched = false;

/** The worker that held the page at the last look — `null` for a page nothing holds. */
let _heldBy: ServiceWorker | null = null;

/** The gesture was made on THIS page: the change of controller it leads to reloads it. */
let _applying = false;

/**
 * A newer worker took this page without the gesture being made here — it was made in another
 * tab, and one worker serves them all. The page then runs code older than what serves it: it
 * is not reloaded under its user, and it is still owed a way to reload.
 */
let _outdated = false;

/** The reload was asked for: once per page, whatever the controller does next. */
let _reloading = false;

/**
 * Reloads the page — ONCE.
 *
 * 🛑 A SECOND `reload()` ABORTS THE FIRST. Measured in a browser that installs a worker at
 * every navigation (DevTools' « Update on reload »): the reload's own navigation brought a
 * new controller, the listener below reloaded again, and the navigation under way was
 * cancelled — each attempt installing one more worker, the page never leaving. The latch is
 * not reset: a page that asked to reload has nothing left to decide.
 */
function _reloadOnce(): void {
    if (_reloading) return;
    _reloading = true;
    globalThis.location.reload();
}

/** `navigator.serviceWorker`, or nothing where service workers do not exist. */
function _container(): ServiceWorkerContainer | undefined {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker
        : undefined;
}

/**
 * Says that an installed worker waits behind the one holding this page.
 *
 * ⚠️ The controller is the condition, not `registration.active`. A FIRST install passes
 * through `installed` too, and so does an update found by a page nothing holds (a forced
 * reload): the browser activates both at once, and announcing them would offer a wait that
 * is already over.
 */
function _announceWaiting(worker: ServiceWorker): void {
    if (!_container()?.controller || _announced.has(worker)) return;
    _announced.add(worker);
    Log.info("[SWRegister] A new Service Worker is installed and waits for the page.");
    dispatchGeoLeafEvent("geoleaf:sw:update-waiting", {});
}

/**
 * Follows a worker that is not active yet, from wherever it was found.
 *
 * Three places hand one over, and the last two are why this is a function: `updatefound`;
 * a worker ALREADY installing when `register()` resolves — the browser looks for an update at
 * navigation, `register()` is called at idle, and the event is long gone; and a worker
 * already WAITING, which a page booting onto it must say again — the announcement made to
 * the previous page left with it.
 */
function _followWorker(worker: ServiceWorker | null): void {
    if (!worker || _followed.has(worker)) return;
    _followed.add(worker);
    // Whether this worker ever finished installing: `redundant` ends a FAILED install as well
    // as the life of a worker that was replaced, and only the first is worth a line.
    let installed = worker.state !== "installing";
    worker.addEventListener("statechange", () => {
        if (worker.state === "installed") {
            installed = true;
            _announceWaiting(worker);
        } else if (worker.state === "activated") {
            Log.info("[SWRegister] New Service Worker activated.");
            dispatchGeoLeafEvent("geoleaf:sw:updated", {});
        } else if (worker.state === "redundant" && !installed) {
            // An update whose pre-cache fails rejects its own install (`sw-core.js`). Nothing
            // is offered and the worker in place keeps serving — said here because nothing
            // else says it, and a file missing for good would hold every update back.
            Log.warn(
                "[SWRegister] A Service Worker failed to install and was discarded; the one in place keeps serving."
            );
        }
    });
    if (worker.state === "installed") _announceWaiting(worker);
}

/**
 * Watches who holds the page — once.
 *
 * 🛑 THE PAGE RELOADS ON THE GESTURE, NEVER ON THE EVENT. `controllerchange` → `reload()`
 * is the textbook line, and it reloads a page whose user asked for nothing: the first
 * `clients.claim()`, a worker replaced from another tab, a developer's "update on reload".
 * Here the reload answers `applyUpdate()` alone. A change nobody asked for on this page only
 * marks it outdated. And it reloads ONCE ({@link _reloadOnce}).
 */
function _watchController(): void {
    const container = _container();
    if (!container || _controllerWatched) return;
    _controllerWatched = true;
    _heldBy = container.controller;
    container.addEventListener("controllerchange", () => {
        const before = _heldBy;
        _heldBy = container.controller;
        if (_applying) {
            _reloadOnce();
            return;
        }
        // A page nothing held was simply taken: that is the first install's claim.
        if (before) _outdated = true;
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
/** The registrations whose `updatefound` is already listened to — see `register()`. */
const _updateWatched = new WeakSet<ServiceWorkerRegistration>();

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

            // Who holds the page, before anything is followed: a change of controller is
            // judged against it.
            _watchController();

            // Listen for updates — once per registration. The browser hands back the SAME
            // registration to every `register()`, and each boot calls it: an application mounted
            // again (`GeoLeaf.mount`) added one more `updatefound` listener every time, never
            // removed. Measured by the `71-mount-remount` E2E.
            if (!_updateWatched.has(registration)) {
                _updateWatched.add(registration);
                registration.addEventListener("updatefound", () => {
                    _followWorker(registration.installing);
                });
            }
            // And what the registration ALREADY carries: an install under way, a worker waiting.
            _followWorker(registration.installing);
            _followWorker(registration.waiting);

            return registration;
        } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : String(error);
            Log.error(`[SWRegister] Registration failed: ${detail}`);
            throw error;
        }
    },

    /**
     * Is a newer version of the application installed, that this page has not been reloaded
     * onto?
     *
     * `true` in two cases: a new worker WAITS behind the one holding the page, or it already
     * took the page because the update was applied from another tab. `false` for a first
     * install, before `register()` has resolved, and where service workers do not exist.
     *
     * @returns Whether {@link SWRegister.applyUpdate} has something to apply.
     * @example
     * if (SWRegister.isUpdateWaiting()) showReloadBanner();
     */
    isUpdateWaiting(): boolean {
        if (_outdated) return true;
        return !!this._registration?.waiting && !!_container()?.controller;
    },

    /**
     * Applies the update the user accepted: the waiting worker takes the page, and the page
     * RELOADS once it holds it — its own code is the old version's.
     *
     * ⚠️ The reload is not immediate, and it is not optional: it follows the change of
     * controller, which the worker answers with. Reloading before would boot the old version
     * again. A browser lets the new worker take over once the previous one has no request
     * left in flight — measured: a previous worker waiting on slow tiles held the gesture for
     * more than thirty seconds. Where the update was already applied from another tab,
     * nothing waits any more and the page reloads at once.
     *
     * @returns `true` when an update is being applied — the page WILL reload; `false` when
     *   nothing was waiting, and nothing happens.
     * @example
     * reloadButton.addEventListener("click", () => SWRegister.applyUpdate());
     */
    applyUpdate(): boolean {
        if (_outdated) {
            _reloadOnce();
            return true;
        }
        const waiting = _container() ? this._registration?.waiting : null;
        if (!waiting) return false;
        _applying = true;
        waiting.postMessage({ type: "SKIP_WAITING" });
        return true;
    },

    // ⚠️ `update()`, `unregister()` and `getRegistration()` were REMOVED, and the
    // measurement is worth writing: none of the three had a production caller.
    //
    // 🛑 WHAT MAKES THE DELETION SAFE rather than optimistic: REAL unregistration
    // did not go through here. `capabilities/pwa/lifecycle.ts` (`_unregisterOwn`)
    // enumerates `navigator.serviceWorker.getRegistrations()` itself, without ever
    // reading `_registration`. There were thus two unregistration paths, only one of
    // which ran — and the one that remains depended in nothing on the one removed.
    //
    // ⚠️ AND THE SURVIVING PATH WAS WRONG, unnoticed for as long as this note said
    // merely that it existed. It unregistered EVERY registration on the origin, so a
    // bundle mounted in a host application took down the HOST's worker at boot —
    // measured on a real host. It now keeps only the registrations whose `scriptURL`
    // names `_swPath`. That predicate is a SECOND COPY of this file's literal; its
    // source guard is `__tests__/capabilities/pwa/lifecycle-sw-ownership.test.ts`,
    // which builds its fixtures from `_swPath` so the two cannot drift silently.
    //
    // `_registration` stays set by `register()`: it carries the update listener, and
    // `isUpdateWaiting()` / `applyUpdate()` read its `waiting` slot.
};

export { SWRegister };
