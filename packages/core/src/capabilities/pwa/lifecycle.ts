/*!
 * GeoLeaf Core (pwa capability) — Lifecycle / boot wiring
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Lifecycle for the in-core PWA capability (S14 Phase A3).
 *
 * Gated (post-merge) on `modules.pwa.enabled`, read from the **config block passed by
 * `shared.module` #7** — which runs after `loadActiveProfileResources`, so the config
 * is merged (and `modules.pwa` is app-global, present from the base config anyway).
 * Reading the passed block (rather than the `Config` singleton) keeps the gate testable
 * and avoids any merge-timing ambiguity.
 *
 *  - enabled  → register the unified service worker (scope `"./"`, supports sub-path
 *               deploys), request origin-level persistent storage, and, when
 *               `installPrompt.enabled`, wire the browser install prompt (Android
 *               banner / iOS instructions).
 *  - disabled → unregister GEOLEAF'S OWN service worker so a returning visitor honours
 *               "no SW" (a registered SW survives reloads until explicitly unregistered).
 *               🛑 Never the origin's others: this bundle is mounted inside third-party host
 *               applications, and sweeping `getRegistrations()` took down the HOST's worker
 *               — measured on a real host, which lost its offline mode and its app install
 *               silently, on both sides.
 *
 * The lifecycle holds no state of its own — `shared.module` calls `init` exactly once per
 * boot (the registry guarantees a single module init), so it needs no idempotency guard.
 * Its install sub-flows (`InstallPrompt` / `IosBanner`) DO hold state (global listeners and
 * a pending timer); `_reset` releases them so repeated `initApp()` calls stay clean.
 */

import { Log } from "../../utils/log/index.js";
import { SWRegister } from "../../kernel/storage/index.js";
import { Helpers } from "../../utils/general/helpers-namespace.js";
import { PWAManager } from "./pwa-manager.js";
import type { PWAConfig } from "./pwa-manager.js";

/** The `modules.pwa` block subset that PwaLifecycle acts on — derived, not redeclared. */
type PwaLifecycleConfig = Pick<PWAConfig, "enabled" | "installPrompt" | "name" | "short_name">;

/**
 * Filename of the service worker GeoLeaf registers — the same literal `SWRegister._swPath`
 * hands to `navigator.serviceWorker.register()`.
 *
 * ⚠️ Written twice ON PURPOSE. `kernel/storage/index.ts` is a narrow mediation barrel that
 * exposes `SWRegister` alone (`CDC_kernel.md` §barils kernel), and widening the
 * `capabilities/ → kernel/` boundary for one string costs more than the duplication. Its
 * source guard is therefore a test, not the type system: `lifecycle-sw-ownership.test.ts`
 * builds every fixture FROM `SWRegister._swPath`, so the two cannot drift apart while staying
 * green.
 *
 * ⚠️ Known limit, assumed: `SWRegister.register()` accepts an `options.path` that no caller
 * passes (stated at its `@param`). A worker registered under some other name would escape
 * this predicate — and be left alone, which is the safe direction.
 */
const GEOLEAF_SW_FILENAME = "sw-core.js";

/**
 * Is this registration carrying GeoLeaf's own worker?
 *
 * All three slots are read because a registration is ours from the moment it is `installing`,
 * long before it is `active` — and `_reset()` can land in that window.
 */
function _isOwnRegistration(reg: ServiceWorkerRegistration): boolean {
    for (const worker of [reg.active, reg.waiting, reg.installing]) {
        const url = worker?.scriptURL;
        if (typeof url !== "string") continue;
        // Compare the LAST PATH SEGMENT, query and hash stripped. A plain `endsWith()` would
        // also match a host's `vendor-sw-core.js`, and a sub-path deploy moves the prefix.
        const path = url.split(/[?#]/)[0] ?? "";
        if (path.slice(path.lastIndexOf("/") + 1) === GEOLEAF_SW_FILENAME) return true;
    }
    return false;
}

/**
 * Best-effort unregistration of GEOLEAF'S service workers on this origin.
 *
 * 🛑 The `filter` is the whole point, and it closes a blocking defect: this function used to
 * unregister every registration `getRegistrations()` returned. Mounted in a host application
 * with the PWA gate closed, GeoLeaf thereby unregistered the HOST's worker at boot.
 *
 * `getRegistrations()` remains the right call — our own scope is `"./"`, hence unknown ahead
 * of time on a sub-path deploy, so the origin still has to be enumerated. What changed is the
 * selection, not the sweep.
 */
function _unregisterOwn(): void {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw || typeof sw.getRegistrations !== "function") return;
    void sw
        .getRegistrations()
        .then((regs) => Promise.all(regs.filter(_isOwnRegistration).map((r) => r.unregister())))
        .catch(() => {
            /* best-effort — nothing to unregister */
        });
}

/**
 * `localStorage` key of the contexts that hold GeoLeaf's worker: a JSON array of holder ids.
 *
 * The worker is registered for the whole origin, and two configurations can live on one origin —
 * two pages of an integrator, a configuration handed over in memory — of which only one enables
 * the PWA. The one without it used to unregister the worker at boot, and the other lost its
 * offline mode: its next load without network found no worker. A context cannot tell, from one
 * load to the next, whether it registered the worker itself; this registry is that memory.
 */
const PWA_HOLDERS_STORAGE_KEY = "gl-pwa-holders";

/** Holder id of a context booted without a profile. */
const NO_PROFILE_HOLDER = "_none";

/** Same format as a profile id. The registry is user-writable: anything else is dropped. */
const HOLDER_ID_RE = /^[a-zA-Z0-9_-]{1,50}$/;

/** Bound on the registry: a holder that never comes back must not grow it without end. */
const MAX_HOLDERS = 32;

/** The holders on record. Unreadable or corrupt counts as none — the former behaviour. */
function _readHolders(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(PWA_HOLDERS_STORAGE_KEY) ?? "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is string => typeof v === "string" && HOLDER_ID_RE.test(v));
    } catch {
        return [];
    }
}

/** Best-effort write: a storage that refuses leaves the registry as it was. */
function _writeHolders(holders: string[]): void {
    try {
        if (holders.length === 0) localStorage.removeItem(PWA_HOLDERS_STORAGE_KEY);
        else localStorage.setItem(PWA_HOLDERS_STORAGE_KEY, JSON.stringify(holders));
    } catch {
        /* best-effort — private browsing, quota */
    }
}

/** Records `id` as holding the worker; the most recent holders are kept. */
function _addHolder(id: string): void {
    const holders = _readHolders().filter((h) => h !== id);
    holders.push(id);
    _writeHolders(holders.slice(-MAX_HOLDERS));
}

/**
 * Withdraws `id` and says whether another context still holds the worker.
 *
 * ⚠️ When the registry cannot be read, nobody holds it: the worker goes, as it always did. That
 * is the safe direction for the single-profile case, whose motive stands — a profile that turns
 * the PWA off must not stay controlled by a residual GeoLeaf worker.
 */
function _withdrawHolder(id: string): boolean {
    const others = _readHolders().filter((h) => h !== id);
    _writeHolders(others);
    return others.length > 0;
}

/** Holder id of this context: its profile, or a shared id without one. */
function _holderId(profileId: string | null | undefined): string {
    return typeof profileId === "string" && HOLDER_ID_RE.test(profileId)
        ? profileId
        : NO_PROFILE_HOLDER;
}

/**
 * Requests origin-level persistent storage and logs the verdict.
 *
 * Browsers evict **per origin, not per store**: under disk pressure a "best-effort"
 * origin can lose the Cache API *and* IndexedDB together. IndexedDB holds `features` and
 * `outbox`, whose entries are field captures with no other copy — no server, no export.
 * `persist()` is the only lever that moves the whole origin out of that regime, and it covers
 * every store at once, so it stays correct whichever tile-storage arbitration lands later.
 *
 * Deliberately **not chained** onto `SWRegister.register()`: the data this protects is
 * written by the offline engine, which does not need the service worker to have come up.
 *
 * The verdict is logged because it is otherwise unobservable — nothing else reports which
 * quota regime the app runs under, and a refusal is indistinguishable from a request that
 * was never made. Read it back at runtime with `await navigator.storage.persisted()`.
 *
 * ⚠️ `navigator.storage` is a **`Window`** API, absent from the service-worker scope: this
 * cannot live in `sw-core.js`. Chrome grants it without prompting to an installed PWA;
 * Firefox asks the user, which is why the call is made only behind the `pwa` opt-in gate.
 */
function _requestPersistentStorage(): void {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage || typeof storage.persist !== "function") {
        Log.info("[PWA] Persistent storage unsupported — origin stays best-effort.");
        return;
    }

    void storage
        .persist()
        .then((granted) => {
            if (granted) {
                Log.info("[PWA] Persistent storage granted — origin is exempt from eviction.");
            } else {
                Log.warn(
                    "[PWA] Persistent storage refused — origin stays best-effort; stored data, " +
                        "including the offline sync queue, can be evicted under disk pressure."
                );
            }
        })
        .catch((err) =>
            Log.warn("[PWA] Persistent storage request failed:", (err as Error)?.message)
        );
}

/**
 * Ceiling on how long the service-worker registration may wait for an idle moment.
 *
 * Passed as `requestIdleCallback`'s `timeout`, so it is a GUARANTEE, not a delay: the callback
 * runs at the first idle slice, or at this deadline, whichever comes first. A page that never
 * goes idle still registers.
 *
 * 3 s is chosen against the two bounds that matter, not by feel. Below: the reveal path it must
 * clear — the default theme's layers resolve well inside it, and `init-reveal` has its own 5 s
 * net. Above: `e2e/27-offline-idb.spec.js` waits 25 s for `navigator.serviceWorker.controller`,
 * the tightest budget in the suite, which leaves the install more than 20 s of margin.
 *
 * ⚠️ Raising this trades boot latency for offline readiness on a first visit that is closed
 * quickly. Do not raise it past the 25 s spec budget without moving that budget first.
 */
const SW_REGISTER_IDLE_CEILING_MS = 3000;

/** Lifecycle for the PWA capability (SW registration + persistent storage + install prompt). */
export const PwaLifecycle = {
    /**
     * @param pwaConfig - `modules.pwa`, merged.
     * @param profileId - The active profile: the id under which this context holds the worker.
     */
    init(pwaConfig?: PwaLifecycleConfig, profileId?: string | null): void {
        const holder = _holderId(profileId);
        if (!pwaConfig || pwaConfig.enabled !== true) {
            // Opt-in gate off: ensure no residual GeoLeaf SW keeps controlling the page — unless
            // another context of this origin still holds it (see `PWA_HOLDERS_STORAGE_KEY`).
            // Ours only — the host's workers are not ours to revoke.
            if (!_withdrawHolder(holder)) _unregisterOwn();
            return;
        }
        _addHolder(holder);

        // Register the unified service worker (scope "./" supports sub-path deploys), OFF the
        // critical path — but never conditionally on it.
        //
        // The install fetches every entry of `STATIC_ASSETS` (~257 Ko gz on `deploy-full`),
        // and it used to start the moment this module initialised: in direct competition with
        // the first tiles and the profile's layers, on the same connection.
        //
        // 🛑 `geoleaf:app:ready` WAS THE OBVIOUS HOOK AND IT WAS REJECTED, on measurement.
        // That event is only emitted from `UIModule`, which is sorted after `geojson` — so
        // attaching to it puts the registration behind `GeoJSONModule.init()`'s UNBOUNDED
        // network wait, and drops it entirely when `beforeBoot` rejects or `registry.init()`
        // throws. That is precisely the boot where an offline cache is worth the most: it
        // would have removed the PWA from the failure paths it exists to survive.
        //
        // `requestIdleCallback` with a ceiling keeps both properties: it yields to the map,
        // and the `timeout` option guarantees the callback runs even if idle never comes.
        Helpers.lazyExecute(() => {
            void SWRegister.register({ scope: "./" })
                .then(() => Log.info("[PWA] Service Worker registered."))
                .catch((err) =>
                    Log.warn("[PWA] Service Worker registration failed:", (err as Error)?.message)
                );
        }, SW_REGISTER_IDLE_CEILING_MS);

        // Origin-level eviction protection. Independent of the registration above — it
        // guards IndexedDB (`features`, `outbox`) as much as the SW's caches.
        _requestPersistentStorage();

        // Install prompt (opt-in sub-flag): Android banner / iOS instructions.
        if (pwaConfig.installPrompt?.enabled === true) {
            try {
                PWAManager.init({
                    ...(pwaConfig.name !== undefined && { name: pwaConfig.name }),
                    ...(pwaConfig.short_name !== undefined && { short_name: pwaConfig.short_name }),
                    installPrompt: { enabled: true },
                });
            } catch (e) {
                Log.warn("[PWA] Install prompt init failed:", e);
            }
        }
    },

    /**
     * Registry destroy / test seam: unregisters GeoLeaf's own service worker AND tears down
     * the install sub-flows. The SW is stateless per boot, but the install-prompt
     * and iOS banner hold global listeners / a pending timer that must be released.
     *
     * ⚠️ Same narrowing as `init()`'s closed gate: a teardown must not revoke a worker the
     * host application installed.
     *
     * ⚠️ A teardown is not a withdrawal: the holders on record stay, and while there is one the
     * worker stays too. Unregistering it here would cost the next offline load of this very
     * context — and of any other that holds it — its worker.
     */
    _reset(): void {
        PWAManager._reset();
        if (_readHolders().length === 0) _unregisterOwn();
    },
};
