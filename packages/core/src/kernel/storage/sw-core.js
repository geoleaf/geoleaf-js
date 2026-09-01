/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/* eslint-disable no-console */ // Service Worker context — Log module unavailable, console is required
/* global __SW_DEBUG__ */ // build-time constant injected by Rollup replace plugin
/**
 * GeoLeaf Service Worker — Unified
 *
 * Single service worker for every bundle (core-only AND with the offline engine).
 * Handles offline cache for:
 * - Static assets (JS, CSS, fonts)
 * - Profile resources (JSON, GeoJSON, SVG)
 * - Configurations (network-first with cache fallback)
 * - Map tiles (Cache API — see the WHAT ACTUALLY RUNS note below)
 *
 * Strategies:
 * - Cache-First (stale-while-revalidate): static assets + profiles
 * - Network-First: configurations
 * - Tile: IndexedDB `geoleaf-db` → Cache API → network → placeholder
 *
 * ✅ ROOT CAUSE n°2 IS REPAIRED (task 3.1, 02/08/2026) — and the repair was to REMOVE a
 * number, not to correct one.
 *
 * Until then this file opened `geoleaf-db` at a hard-coded version `2` while the engine
 * declared `3`. IndexedDB refuses to open below the stored version, so `openIndexedDB()`
 * resolved `null` on EVERY call in EVERY deployment: step 1 of the tile strategy was never
 * taken, offline tiles came from the Cache API alone, and the profile download filled a store
 * nothing could read back. Measured from inside the deployed worker before the fix:
 * `open("geoleaf-db", 2)` → `{ ok: false, err: "VersionError" }` against `geoleaf-db@v3`
 * (`scripts/probe-sw-observability.mjs`).
 *
 * The worker now opens WITHOUT a version (decision T2′). An `undefined` version opens at the
 * database's current version and never triggers an upgrade, so the READ-ONLY /
 * NON-PROVISIONING intent below is structurally true rather than defended by an abort — and
 * there is no number left to desynchronise. What replaces the version check is capability
 * detection (`objectStoreNames.contains("layers")`), which stays true across schema versions.
 *
 * ⚠️ AND THE REPAIR CREATED A RISK THAT DID NOT EXIST BEFORE. A worker that never opened the
 * database could never block a schema migration. One that succeeds can — a live connection is
 * the ONLY thing that blocks an upgrade. Hence {@link withIndexedDB}: every handle is closed
 * in a `finally`, and `onversionchange` yields on demand. Never call `openIndexedDB()`
 * directly from a request path.
 *
 * ⚠️ STILL TRUE, and NOT repaired by 3.1: Background Sync is dead by ABSENCE OF EMITTER.
 * No `registration.sync.register` exists anywhere in the repository, so the `sync` listener
 * below never fires. Verified by the pre-vol command of the roadmap, which returns 0.
 *
 * ⚠️ IndexedDB access is READ-ONLY and NON-PROVISIONING by design: the offline engine owns
 * the `geoleaf-db` schema, and this SW must NEVER create or upgrade it.
 *
 * @version __GEOLEAF_VERSION__
 */

"use strict";

// __SW_DEBUG__ is a build-time constant — injected as a plain boolean by Rollup.
// In production all SW console.log calls are removed at build time via terser.
const _SW_DEBUG = typeof __SW_DEBUG__ !== "undefined" ? __SW_DEBUG__ : false;

// ═══════════════════════════════════════════════════════════════════════════════════════
// CACHE NAMING — survival across a deployment is carried by the NAME CONSTRUCTOR,
// never by an exception list.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 🛑 WHAT `activate` REALLY DOES, measured: it does not raze "on every version bump",
// it razes ON EVERY BUILD. `scripts/build-deploy.cjs` suffixes `CACHE_VERSION` with a
// `Date.now()` — and the comment there explicitly says "so the SW purges old caches on
// every build". Read off the four deployed variants: THREE different timestamps for a
// single `build:deploy`. Deploying during a field campaign therefore razed the
// downloaded basemap, with no version having changed.
//
// The intent is right for the STATIC — code re-downloadable from a server the user
// has necessarily just reached. It is wrong for what the USER deliberately cached.
//
// THE RULE: a cache survives BECAUSE ITS NAME CARRIES NO VERSION, and it carries none
// because its content belongs to the user and not to the build. No name is written
// twice, there is no list to keep current, and a future durable cache survives by
// construction — naming it `geoleaf-data-*` is enough.
const CACHE_VERSION = "geoleaf-v__GEOLEAF_VERSION__";

/** Purgeable: code, re-downloadable. */
const CACHE_STATIC = `${CACHE_VERSION}-static`;
/** Purgeable: profile resources, re-downloadable. */
const CACHE_PROFILE_PREFIX = `${CACHE_VERSION}-profile-`;
/**
 * DURABLE — no version in the name, deliberately.
 *
 * This is the basemap the user downloaded to go into the field. Re-downloading it
 * assumes a network they precisely do not have.
 *
 * ⚠️ Renamed once. No transitional clause accompanies the rename, and the
 * no-migration decision is what allows it: the application had no users, so no
 * device carries the old `${CACHE_VERSION}-tiles` name. At the first field
 * deployment, renaming a durable cache will require a bridge — not now.
 */
const CACHE_TILES = "geoleaf-data-tiles";
const CACHE_RUNTIME = `${CACHE_VERSION}-runtime`;

// ═══════════════════════════════════════════════════════════════════════════════════════
// TILE CACHE BOUNDING — a DATA-LOSS guard
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 🛑 THIS IS NOT A PERFORMANCE TOPIC. Browsers evict by ORIGIN, never by store.
// IndexedDB is bounded (`maxCacheBytes`, LRU eviction, an event) and carries `outbox`
// and `features` — field captures with NO other copy. `CACHE_TILES` was bounded by
// nothing. Under disk pressure, a tile cache free to grow can therefore get the
// ENTIRE origin evicted, unsynchronised captures included.
//
// ⚠️ And persistence does not answer the objection. Measured: two OPPOSITE verdicts
// on the same origin — `persist()` REFUSED in headless Chromium on a fresh profile
// (~800 MB quota), GRANTED in real Chrome (~10 GB). It depends on the user's
// engagement with the ORIGIN, not on a property of the application — a field device
// opening a production origin for the first time starts in `bestEffort`.
//
// ⚠️ WHY A COUNT AND NOT BYTES. The Cache API exposes no entry's size, and
// `estimate()` measures the whole origin, not one store. The count is the only
// portable, cheap bound; `estimate()` serves as the ESCAPE HATCH. The byte
// equivalence is written in the spec (`specs/capacites/offline.md` §Arbitrage du
// stockage) and NOWHERE ELSE — copying it here would make two truths that diverge.

/**
 * FALLBACK cap, in entry count, when no profile publishes one.
 *
 * ⚠️ The fallback BOUNDS, it does not open: a core-only deployment has no database
 * to read, and "no value read" must never mean "no limit". The byte equivalence
 * (measured, and SPREAD by a factor of 10) is written in the spec, not here.
 *
 * ⚠️ MIRROR literal of the `modules.offline.cache.maxTileCacheEntries` default
 * (`capabilities/offline/offline-capability.ts`). `config-schema-coverage.test.js`
 * checks both say the same number — the worker cannot import the schema.
 */
const TILE_CACHE_MAX_ENTRIES = 2000;

/**
 * `preferences`-store key where the engine publishes the cap.
 *
 * ⚠️ Literal SHARED with `capabilities/offline/tile-budget.ts`, which cannot be
 * imported here — this file is copied as-is, no bundler. A source guard checks both
 * say the same thing.
 */
const TILE_BUDGET_KEY = "offline.tileCacheMaxEntries";

/** FIFO trim low-water mark: trigger AT the cap, come back down to this fraction. */
const TILE_CACHE_TRIM_RATIO = 0.8;

/** Share of the ORIGIN quota beyond which trimming stops being routine. */
const TILE_CACHE_PRESSURE_RATIO = 0.8;

/** Trim target under pressure — deliberately far below the nominal cap. */
const TILE_CACHE_PRESSURE_TRIM_TO = 400;

/**
 * Amortisation: `cache.keys()` is O(n), we do not pay it on every tile.
 *
 * ⚠️ The counter STARTS at this value, so the worker's first `put` checks. Not a
 * detail: the browser restarts the worker whenever it wants, and a worker waiting 50
 * tiles before looking would let a cache already ten times too full live on.
 */
const TILE_CACHE_CHECK_EVERY = 50;

/** Memoised cap. `null` = not read yet. */
let _tileMaxEntries = null;

/** Tile puts since the last check — see {@link TILE_CACHE_CHECK_EVERY}. */
let _tilePutsSinceCheck = TILE_CACHE_CHECK_EVERY;

// Core assets to pre-cache — injected by build-deploy.cjs at build time
const STATIC_ASSETS = [/* __GEOLEAF_STATIC_ASSETS__ */];

// URLs to never cache
const CACHE_BLACKLIST = [/chrome-extension/, /\/__/];

// Placeholder tile served when a tile cannot be resolved offline (IndexedDB, Cache
// API and network all missed).
const OFFLINE_TILE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f0f0f0"/><text x="50%" y="50%" text-anchor="middle" fill="#999" font-family="Arial" font-size="14">Offline</text></svg>';

// ═══════════════════════════════════════════════
// INSTALL EVENT
// ═══════════════════════════════════════════════
self.addEventListener("install", (event) => {
    if (_SW_DEBUG) console.log("[SW] Installing Service Worker v" + CACHE_VERSION);

    event.waitUntil(
        (async () => {
            try {
                const cache = await caches.open(CACHE_STATIC);
                if (STATIC_ASSETS.length > 0) {
                    // 🛑 NO `cache: "reload"`. It forced the pre-cache to REFETCH from
                    // the network, bypassing the HTTP cache, everything the page had
                    // exactly just downloaded: ~257 KB gz re-requested from the server
                    // while already in the browser's memory, while tiles were loading.
                    //
                    // Freshness does not rest on that, and never did: every deployment
                    // changes `CACHE_VERSION`, so `activate` purges the `geoleaf-v*`
                    // family and this install starts from an empty cache. A stale asset
                    // cannot survive that cycle. `reload` therefore bought no
                    // freshness — it bought a second download.
                    //
                    // ⚠️ `addAll` stays ALL-OR-NOTHING: a single 404 rejects the whole
                    // batch. That is the motive for the bijection in
                    // `lib/boot-assets.cjs` — every derived entry must have a file
                    // behind it, and the derivation throws otherwise.
                    await cache.addAll(STATIC_ASSETS);
                }
                await self.skipWaiting();
                if (_SW_DEBUG) console.log("[SW] Installation complete");
            } catch (error) {
                console.error("[SW] Pre-cache failed:", error);
                await self.skipWaiting();
            }
        })()
    );
});

// ═══════════════════════════════════════════════
// ACTIVATE EVENT
// ═══════════════════════════════════════════════
self.addEventListener("activate", (event) => {
    if (_SW_DEBUG) console.log("[SW] Activating Service Worker v" + CACHE_VERSION);

    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        // Only VERSIONED caches are purgeable, and only those of ANOTHER
                        // version than ours. `geoleaf-data-*` is not versioned, so it
                        // cannot enter here — a naming fact, not a listed exception. The
                        // tested prefix is `geoleaf-v` and not `geoleaf-`, and that is
                        // the whole difference.
                        if (
                            cacheName.startsWith("geoleaf-v") &&
                            !cacheName.startsWith(CACHE_VERSION)
                        ) {
                            if (_SW_DEBUG) console.log("[SW] Deleting old cache:", cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                if (_SW_DEBUG) console.log("[SW] Old caches cleared");
                return self.clients.claim();
            })
    );
});

// ═══════════════════════════════════════════════
// FETCH EVENT
// ═══════════════════════════════════════════════
self.addEventListener("fetch", (event) => {
    const { request } = event;

    // 🛑 METHOD FILTER — first, before any other decision.
    //
    // The handler NEVER tested `request.method`. Every write — POST, PUT, DELETE,
    // POI sends to the server included — therefore fell into the network-first
    // strategy, which attempts a `cache.put`. The Cache API REJECTS any non-GET
    // request, and that rejection went into an empty `.catch(() => {})`: a promise
    // rejected by design, swallowed on every write.
    //
    // Returning without `respondWith` lets the browser handle the request normally.
    // Exactly what we want: the worker has nothing to say about a write.
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // ⚠️ The blacklist no longer carries `/api/`. It now excludes what is NOT
    // applicative HTTP (`chrome-extension:`) and reserved paths — not a URL
    // convention. `/api/` was a blind exclusion skipping the most common path of a
    // data API, i.e. exactly the traffic a field deployment depends on. What decides
    // now is the DECLARATION.
    if (CACHE_BLACKLIST.some((pattern) => pattern.test(url.href))) {
        return;
    }

    // Page navigations (root path has no extension, so it would otherwise fall
    // through to networkFirst with no cache hit). Network-first with the precached
    // app shell as fallback — a transient network failure or offline load no longer
    // rejects the navigation FetchEvent.
    if (request.mode === "navigate") {
        event.respondWith(navigationStrategy(request));
        return;
    }

    // 🛑 ROUTING BY DECLARATION — it PRECEDES every heuristic.
    //
    // A declared origin decides for itself: its `roles` say what it serves, its
    // `cacheable` says whether we may keep it. An origin declared NOT cacheable — a
    // tile provider answering opaque, an authenticated API — goes to the network with
    // no strategy interfering. A REVIEWED decision, not a guessed one.
    //
    // ⚠️ What follows only runs when NOTHING is declared. The remaining heuristics
    // are therefore a BOOTSTRAP path, not the nominal regime — and a profile that
    // declares its origins never takes them. They will disappear when declaration
    // becomes mandatory; muting them today would break every not-yet-migrated
    // profile.
    event.respondWith(routeRequest(request, url));
});

/**
 * Picks the strategy: by DECLARATION first, by bootstrap heuristic second.
 *
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function routeRequest(request, url) {
    const origins = await loadDataOrigins();

    if (origins.length > 0) {
        const declared = matchDeclaredOrigin(url.href, origins);
        if (!declared) {
            // 🛑 THE APPLICATION ITSELF IS NOT DECLARABLE (arbitrated 07/08/2026).
            //
            // Declaring one origin disables caching for all others. Yet the origin
            // SERVING the application changes with every deployment —
            // `localhost:8766` on the `ports` target, `demo.geoleaf.local.test`
            // under nginx, production elsewhere — so no PORTABLE profile can write
            // it. Measured consequence before this fix: a profile declaring its data
            // origins lost the cache of its own shell, i.e. offline entirely.
            // All-or-nothing, and the "nothing" was only reachable by giving up
            // declaring anything.
            //
            // ⚠️ THE PERMISSION IS NARROW, AND THAT IS THE HEART OF THE ARBITRATION.
            // It does not cover "the same origin", it covers WHAT SERVES THE
            // APPLICATION: its profile resources and its static files. A data API
            // served from the same origin stays a DATA origin — the very motive of
            // route 1 says so — and it gets DECLARED, like any other. Without this
            // narrowing, an authenticated same-origin response would be cached by
            // default: we would have opened the authenticated-cache leak while
            // closing the shell one.
            //
            // 🛑 THE INVARIANT IS THEREFORE NOT WEAKENED, IT IS DELIMITED: a
            // declaration's silence refuses the caching of DATA; the application
            // shell is not data. It is the principle `isStaticAsset` already carries
            // a few lines below — "static means nothing outside our own origin: what
            // is ours is deployed with us and versioned with us". We generalise it,
            // we do not introduce it.
            if (url.origin === self.location.origin) {
                // FIRST: what `install` wrote into `CACHE_STATIC` is read back from
                // it, without a second derivation of the perimeter.
                if (isPrecachedAsset(url)) return cacheFirstStrategy(request, CACHE_STATIC);
                if (isProfileResource(url)) {
                    return cacheFirstStrategy(request, getCacheNameForProfile(url));
                }
                if (isStaticAsset(url)) return cacheFirstStrategy(request, CACHE_STATIC);
            }
            // Origin NOT declared in a profile that declares: nothing is cached. A
            // declaration's silence is a refusal, not a permission.
            return fetchBounded(request);
        }
        if (!declared.cacheable) {
            // Declared and explicitly not cacheable — the authenticated-API and
            // opaque-provider case. Straight to the network, never a copy.
            return fetchBounded(request);
        }
        if (declared.roles.includes("tiles")) return tileCacheStrategy(request);
        if (declared.roles.includes("layerData") || declared.roles.includes("sprites")) {
            return cacheFirstStrategy(request, getCacheNameForProfile(url));
        }
        if (declared.roles.includes("glyphs")) return cacheFirstStrategy(request, CACHE_STATIC);
        return networkFirstStrategy(request, CACHE_RUNTIME);
    }

    // ── Bootstrap: no profile has declared its origins yet ─────────────────────────────
    return legacyRoute(request, url);
}

/**
 * HISTORICAL routing, by heuristic. Kept ONLY for profiles that do not yet declare
 * their origins — see `routeRequest`.
 *
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<Response>}
 */
function legacyRoute(request, url) {
    // Same gesture as on the declared route, and FIRST for the same reason. BOTH
    // sites carried the defect; fixing only one would have left it alive for every
    // profile that does not declare its origins, i.e. on the most common path.
    if (isPrecachedAsset(url)) {
        return cacheFirstStrategy(request, CACHE_STATIC);
    }
    if (isProfileResource(url)) {
        return cacheFirstStrategy(request, getCacheNameForProfile(url));
    }
    if (isTileRequest(url)) {
        return tileCacheStrategy(request);
    }
    if (isStaticAsset(url)) {
        return cacheFirstStrategy(request, CACHE_STATIC);
    }
    return networkFirstStrategy(request, CACHE_RUNTIME);
}

// ═══════════════════════════════════════════════
// MESSAGE EVENT
// ═══════════════════════════════════════════════
self.addEventListener("message", (event) => {
    // Validate message source: only accept messages from controlled clients
    if (!event.source || (event.source.type !== "window" && event.source.type !== "worker")) {
        return;
    }

    // 🛑 AND ITS ORIGIN. The check above tests only the source's TYPE, never where it
    // comes from. The effect is bounded by construction — a worker only receives
    // messages from clients of its own scope, hence its own origin — but "bounded by
    // construction" is a reasoning, not a verification: it rests entirely on a
    // browser property no line here asserts.
    //
    // What it costs: nothing. What it buys: `CLEAR_CACHE` is destructive, and the
    // day a scope widens, a `client.postMessage` travels differently, or someone
    // simply re-reads this file to know who may clear the cache, the answer is
    // written here instead of deduced.
    //
    // ⚠️ `event.origin` is empty for a same-origin client message in some browsers:
    // we refuse it only when it is SET and different. Treating an empty string as a
    // foreign origin would make the guard block everywhere — a guard refusing
    // everything does not guard better, it breaks.
    if (event.origin && event.origin !== self.location.origin) {
        console.warn("[SW] Message refusé — origine étrangère:", event.origin);
        return;
    }

    if (event.data && event.data.type === "SKIP_WAITING") {
        self.skipWaiting();
    }

    if (event.data && event.data.type === "CLEAR_CACHE") {
        event.waitUntil(
            caches
                .keys()
                .then((cacheNames) => {
                    return Promise.all(
                        cacheNames.map((cacheName) => {
                            // ⚠️ DELIBERATE ASYMMETRY WITH `activate`, and it is the
                            // subject.
                            //
                            // `activate` purges only VERSIONED caches of another
                            // version: it cleans up after the BUILD, and has no
                            // mandate over what the user downloaded.
                            //
                            // `CLEAR_CACHE` is that same user ASKING to clear. The
                            // prefix is therefore `geoleaf-` and not `geoleaf-v`: the
                            // durable cache is included, otherwise the button would
                            // lie about what it does.
                            //
                            // 🛑 Without this change, de-versioning `CACHE_TILES`
                            // would have made the basemap UNERASABLE — a cache
                            // nothing purges any more, neither deployment nor user.
                            if (cacheName.startsWith("geoleaf-")) {
                                return caches.delete(cacheName);
                            }
                        })
                    );
                })
                .then(() => {
                    if (event.ports && event.ports[0]) {
                        event.ports[0].postMessage({ success: true });
                    }
                })
        );
    }
});

// ═══════════════════════════════════════════════
// BACKGROUND SYNC EVENT
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// NO BACKGROUND SYNC — AND IT IS A DECISION, NOT AN OVERSIGHT
// ═══════════════════════════════════════════════
//
// 🛑 A `sync` listener lived here, with `syncProfile()`, `getSyncQueue()` and
// `removeSyncItem()` behind it — about 75 lines NOTHING triggered: no
// `registration.sync.register(...)` exists in the repository, and there never was
// one. A listener with no emitter is not inactive code, it is code that LIES about
// what the product does.
//
// And the removal is not mere cleanup: point 5 of the sync contract
// (`contracts/sync.contract.ts`) fixes that **replay runs on the PAGE, not in the
// worker**. The motive is mechanical — the connector's authentication patches the
// PAGE's `fetch` and never reaches the worker, so a replay from the SW would leave
// without a token. The contract says "the Background Sync path is REMOVED, not left
// dead": here it is.
//
// ⚠️ Restoring it one day would not be "rewiring a listener": worker-side
// authentication would have to be solved first. Written here so the question comes
// back whole.

// ═══════════════════════════════════════════════
// CACHING STRATEGIES
// ═══════════════════════════════════════════════

/**
 * Cache-First with stale-while-revalidate.
 * Serves from cache immediately, updates in the background.
 */
/**
 * May this response enter the cache?
 *
 * 🛑 THE FUNCTIONAL HOLE, AND IT WAS NOT WHERE IT WAS BELIEVED. The four strategies
 * guarded on `status === 200`. An OPAQUE response — what a CORS-less cross-origin
 * request returns, i.e. nearly every raster tile provider — carries `status: 0`. It
 * was therefore discarded, silently, and **no raster basemap is offline today**.
 *
 * ⚠️ NOT CACHING AN OPAQUE IS RIGHT, and this fix does not change that decision:
 *   - its content is **unverifiable** — we can read neither its status nor its
 *     headers, nor tell a tile from an error page or a captive-portal redirect;
 *   - it costs the quota far more than its size (the browser pads it, up to several
 *     hundred kilobytes per entry), so a few hundred tiles suffice to get field
 *     work evicted.
 *
 * **What was not right was not SAYING it.** An integrator declaring an origin
 * `cacheable: true` and getting no cache had no way to understand why. The
 * contradiction is now logged, once per origin.
 *
 * ── TWO MORE REFUSALS, AND THEY DEPEND ON NO DECLARATION (07/08/2026) ──
 *
 * 🛑 This function only looked at "not opaque, status 200". Consequence on the
 * BOOTSTRAP path — that of every shipped profile, since none declares its origins: a
 * pull URL `…/collections/<id>/items?limit=…` matches no heuristic, falls onto
 * `networkFirstStrategy(request, CACHE_RUNTIME)`, and **every** 200 response entered
 * it — including an AUTHENTICATED response, in a SHARED cache, on a field device
 * itself shared. The connector patches the page's `fetch`, so the token is indeed on
 * the request the worker sees.
 *
 * ⚠️ **The declared-origins hardening did not close this class.** It protects the
 * profile that DECLARES its origins: `publishDataOrigins` forces `cacheable: false`
 * on any `authenticated` origin. The bootstrap path never reaches that rule. The two
 * refusals below hold **whatever the declaration** — which is what makes them
 * useful, and why they live here rather than in `routeRequest`.
 *
 * ⚠️ They also hold at a level the declaration cannot reach: an origin can be
 * declared cacheable **in perfectly good faith** and serve, on one path, an
 * authenticated response. The declaration bears on the ORIGIN, the credential on
 * the REQUEST.
 *
 * @param {Response} response
 * @param {Request|string} request - Original request (or its URL, legacy form).
 * @returns {boolean} `true` when the response may be cached.
 */
function isCacheableResponse(response, request) {
    if (!response) return false;
    const url = typeof request === "string" ? request : request?.url;

    if (response.type === "opaque" || response.status === 0) {
        _warnOpaqueOnce(url);
        return false;
    }
    // A partial response (206) is not worth the resource: caching it would serve a
    // fragment as if it were the whole.
    if (response.status !== 200) return false;

    // The request carries credentials → its response belongs to nobody else.
    if (carriesCredentials(request)) return false;

    // The server refuses shared caching → we honour it. `no-store` forbids any
    // storage; `private` targets EXACTLY the shared cache, which a Service Worker's
    // is.
    if (refusesSharedCache(response)) return false;

    return true;
}

/**
 * Does the request carry credentials?
 *
 * Two signals, and both are needed: a token carried by an `Authorization` header
 * (what the connector sets), and `credentials: "include"`, which attaches cookies
 * with no header saying so. Looking only at the first would let every session API
 * through.
 *
 * @param {Request|string} request
 * @returns {boolean}
 */
function carriesCredentials(request) {
    if (!request || typeof request === "string") return false;
    if (request.credentials === "include") return true;
    try {
        return Boolean(request.headers?.get?.("Authorization"));
    } catch (_e) {
        return false;
    }
}

/**
 * Does the response forbid SHARED caching?
 *
 * @param {Response} response
 * @returns {boolean}
 */
function refusesSharedCache(response) {
    let cc;
    try {
        cc = response.headers?.get?.("Cache-Control");
    } catch (_e) {
        return false;
    }
    if (!cc) return false;
    const directives = String(cc).toLowerCase();
    return directives.includes("no-store") || directives.includes("private");
}

/** Origins already flagged — a contradiction is said ONCE, not on every tile. */
const _opaqueWarned = new Set();

/**
 * Logs, once per origin, that an opaque response could not be cached.
 *
 * ⚠️ The message differs on whether the origin is DECLARED cacheable or not:
 * declared, it is a contradiction the integrator must fix (or accept knowingly); not
 * declared, it is simply the normal regime of a CORS-less third party.
 */
function _warnOpaqueOnce(url) {
    let origin;
    try {
        origin = new URL(url).origin;
    } catch (_e) {
        return;
    }
    if (_opaqueWarned.has(origin)) return;
    _opaqueWarned.add(origin);

    const declared = matchDeclaredOrigin(url, _dataOrigins || [], null);
    if (declared && declared.cacheable) {
        console.warn(
            `[SW] ${origin} est déclarée \`cacheable: true\` mais répond en OPAQUE — rien ne ` +
                `sera mis en cache pour elle. Une réponse opaque est invérifiable et coûte au ` +
                `quota bien plus que sa taille. Pour un cache hors-ligne, l'origine doit servir ` +
                `du CORS (\`Access-Control-Allow-Origin\`) ; sinon, déclarez-la ` +
                `\`cacheable: false\` pour rendre l'intention explicite.`
        );
    } else if (_SW_DEBUG) {
        console.log(`[SW] Opaque response not cached (expected for a CORS-less origin): ${origin}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// THE BOUNDING — read the cap, trim, say what was trimmed
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Reads the cap the profile published, once, then keeps it in memory.
 *
 * Modelled on {@link loadDataOrigins} — same store, same memoisation, same motive: a
 * message dies with the worker, a preference survives.
 *
 * ⚠️ An ABSENT cap yields the fallback, never infinity. `0`, however, is a
 * MEANINGFUL value (bounding disabled) and is therefore not filtered out with the
 * rejects.
 *
 * @returns {Promise<number>} The cap, in entry count.
 */
async function loadTileMaxEntries() {
    if (_tileMaxEntries !== null) return _tileMaxEntries;
    const declared = await withIndexedDB(
        (db) =>
            new Promise((resolve) => {
                try {
                    if (!db.objectStoreNames.contains("preferences")) return resolve(null);
                    const req = db
                        .transaction(["preferences"], "readonly")
                        .objectStore("preferences")
                        .get(TILE_BUDGET_KEY);
                    req.onsuccess = () => {
                        const v = req.result && req.result.value;
                        resolve(typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
                    };
                    req.onerror = () => resolve(null);
                } catch (_e) {
                    resolve(null);
                }
            }),
        null
    );
    _tileMaxEntries = declared === null ? TILE_CACHE_MAX_ENTRIES : Math.floor(declared);
    return _tileMaxEntries;
}

/**
 * Reads the ORIGIN quota pressure.
 *
 * ⚠️ The key vocabulary is that of `CacheManager.getStorageQuota()` — `usage` /
 * `quota`, never `used`. Not cosmetics: the offline capability carried THREE
 * `estimate()` wrappers with three different vocabularies, and a caller picking the
 * wrong copy read `undefined` with nothing saying so. Two were removed; this one
 * cannot import the survivor (no bundler here), so it at least takes its shape.
 *
 * @returns {Promise<number|null>} Share of quota consumed (0–1), or `null` when not measurable.
 */
async function _originPressure() {
    try {
        const estimate = await self.navigator?.storage?.estimate?.();
        if (!estimate) return null;
        const usage = estimate.usage ?? 0;
        const quota = estimate.quota ?? 0;
        return quota > 0 ? usage / quota : null;
    } catch (_e) {
        return null;
    }
}

/**
 * Removes the OLDEST entries from the store down to `target`, when `trigger` is exceeded.
 *
 * FIFO by entry count: `cache.keys()` returns insertion order, so the head is the
 * oldest. An approximation of LRU — the Cache API exposes no access date — and it
 * suffices here because everything this store carries is re-downloadable.
 *
 * 🛑 WHAT IT CANNOT EVICT, AND IT IS STRUCTURAL: this store has one writer, the
 * opportunistic step of {@link tileCacheStrategy}. What the user EXPLICITLY asked to
 * download goes to IndexedDB via the `Downloader`, never here. A trim therefore
 * cannot take away a zone prepared for the field.
 *
 * @param {Cache} cache
 * @param {number} trigger Above this count, we trim.
 * @param {number} target Count aimed for after the trim.
 * @returns {Promise<{evicted: number, totalBefore: number, totalAfter: number}>} The
 *   shape of `EvictionResult` (`capabilities/offline/db/eviction.ts`), **minus
 *   `freedBytes`**: the Cache API gives no entry's size, and fabricating a number
 *   would be worse than staying silent.
 */
async function _trimTileCache(cache, trigger, target) {
    let keys;
    try {
        keys = await cache.keys();
    } catch (_e) {
        return { evicted: 0, totalBefore: 0, totalAfter: 0 };
    }
    const totalBefore = keys.length;
    if (totalBefore <= trigger) return { evicted: 0, totalBefore, totalAfter: totalBefore };

    const doomed = keys.slice(0, Math.max(0, totalBefore - target));
    const outcomes = await Promise.all(
        doomed.map((key) =>
            cache.delete(key).then(
                () => true,
                () => false
            )
        )
    );
    // The report is that of REAL deletions, not attempts: an eviction announced
    // without having been done is exactly what is being fixed elsewhere.
    const evicted = outcomes.filter(Boolean).length;
    return { evicted, totalBefore, totalAfter: totalBefore - evicted };
}

/**
 * Says an eviction happened — to the console always, to clients only when it matters.
 *
 * ⚠️ THE ROUTINE TRIM DOES NOT BUBBLE UP, AND THAT IS THE POINT. It runs on every
 * sustained pan; one toast per map move teaches the user to stop reading
 * notifications, which costs precisely the warning we want to be able to give the
 * day space genuinely runs out.
 *
 * The detail takes `EvictionResult`'s shape and the `geoleaf:cache:evicted` event
 * name: `sw-register.ts` re-broadcasts it on `document`, where `offline-ui`'s
 * listener already displays it.
 *
 * @param {{evicted: number, totalBefore: number, totalAfter: number}} result
 * @param {"fifo"|"pressure"|"quota"} reason
 */
function _notifyEvicted(result, reason) {
    const line =
        `[SW] Cache de tuiles borné (${reason}) — ${result.evicted} entrée(s) retirée(s), ` +
        `${result.totalBefore} → ${result.totalAfter}.`;

    if (reason === "fifo") {
        // ⚠️ `_SW_DEBUG` and not `warn`, unlike the other two. A routine trim is not
        // an incident: it is the nominal regime of a bounded cache, and it runs on
        // every sustained pan. Announcing it as a warning would drown the ones that
        // really are, and terser strips these calls from the production bundle. Same
        // split as `_warnOpaqueOnce`, which only raises its voice for the
        // contradiction.
        if (_SW_DEBUG) console.log(line);
        return;
    }
    console.warn(line);

    try {
        self.clients
            ?.matchAll?.({ type: "window" })
            .then((clients) => {
                for (const client of clients) {
                    client.postMessage({
                        type: "GEOLEAF_CACHE_EVICTED",
                        detail: {
                            evicted: result.evicted,
                            totalBefore: result.totalBefore,
                            totalAfter: result.totalAfter,
                            store: "cache-api",
                            reason,
                        },
                    });
                }
            })
            .catch(() => {
                // A client gone between `matchAll` and `postMessage` is not a defect.
            });
    } catch (_e) {
        /* `clients` absent (test context, worker shutting down) — inconsequential. */
    }
}

/**
 * Amortised check of the tile store, called after a successful write.
 *
 * Two regimes: under origin pressure we trim AGGRESSIVELY and say so; otherwise we
 * simply bring it back to the cap. The first is correct because under pressure the
 * right class to sacrifice is the re-downloadable one — the spec's `lru` / `never`
 * distinction, applied to the Cache API.
 *
 * @param {Cache} cache The tile store, already open.
 */
async function _maybeTrimTiles(cache) {
    if (++_tilePutsSinceCheck < TILE_CACHE_CHECK_EVERY) return;
    _tilePutsSinceCheck = 0;

    try {
        const max = await loadTileMaxEntries();
        if (max <= 0) return; // `0` = bounding explicitly disabled by the profile.

        const pressure = await _originPressure();
        if (pressure !== null && pressure >= TILE_CACHE_PRESSURE_RATIO) {
            const target = Math.min(TILE_CACHE_PRESSURE_TRIM_TO, max);
            const result = await _trimTileCache(cache, target, target);
            if (result.evicted > 0) _notifyEvicted(result, "pressure");
            return;
        }

        const result = await _trimTileCache(cache, max, Math.floor(max * TILE_CACHE_TRIM_RATIO));
        if (result.evicted > 0) _notifyEvicted(result, "fifo");
    } catch (error) {
        // Logged, not swallowed: a bounding failing silently is indistinguishable
        // from one that does not exist, and that is the state this comes out of.
        console.warn("[SW] Contrôle du cache de tuiles impossible:", error);
    }
}

/**
 * Does the refusal come from the QUOTA, or something else?
 *
 * Three shapes across engines: the standard name, the legacy `DOMException` code,
 * and Gecko's. Confusing them with the rest is exactly what the four
 * `.catch(() => {})` did — a quota overflow swallowed like a non-GET request.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function _isQuotaError(error) {
    if (!error) return false;
    const name = error.name;
    return (
        name === "QuotaExceededError" ||
        name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        error.code === 22 ||
        error.code === 1014
    );
}

/**
 * Writes to cache — SINGLE DECISION POINT for the four strategies.
 *
 * 🛑 WHAT THIS REPLACES. The four sites did `cache.put(…).catch(() => {})`: a quota
 * overflow was swallowed there exactly like a non-GET request. The worker therefore
 * could not know it was full, nor do anything with that information. Same gesture as
 * the cacheability fix, which gathered the four guards in one place.
 *
 * On quota: we free space in the RE-DOWNLOADABLE class — the tiles — whatever store
 * overflowed, then **one** retry. Nothing freed ⟹ no retry: it would fail for the
 * same reason, and a loop on a full disk is a freeze, not resilience.
 *
 * ⚠️ THE CLONE IS TAKEN BEFORE THE FIRST `put`, and that is not caution. A
 * `Response` body is consumed only once, and `cache.put` consumes it. Retrying with
 * the same object fails with "body already used" — the trim would have run for
 * nothing, and the fix would have come out green while repairing nothing.
 *
 * @param {Cache} cache
 * @param {Request} request
 * @param {Response} response
 * @returns {Promise<boolean>} `true` when the response is cached. Never rejects:
 *   three of the four callers are fire-and-forget.
 */
async function cachePut(cache, request, response) {
    // Taken BEFORE the first `put`, never after: the body will be consumed.
    let spare = null;
    try {
        spare = response.clone();
    } catch (_e) {
        // Body already consumed, or response not clonable: there will be no retry,
        // and `spare` is already `null`. Reassigning it here would be a readerless
        // write.
    }

    try {
        await cache.put(request, response);
        return true;
    } catch (error) {
        if (!_isQuotaError(error)) {
            if (_SW_DEBUG) console.log("[SW] cache.put refusé:", error);
            return false;
        }

        let result = { evicted: 0, totalBefore: 0, totalAfter: 0 };
        try {
            const max = await loadTileMaxEntries();
            // ⚠️ `max === 0` — bounding disabled by the profile — does NOT DISARM
            // this path, and that is a choice. "No cap" says not to trim
            // *preventively*; here the browser just REFUSED a write. Honouring the
            // `0` would mean caching nothing at all, indefinitely, on a full device —
            // exactly the loss path being closed. So we recover in the
            // re-downloadable class, and we SAY it (`reason: "quota"`).
            const target = Math.min(TILE_CACHE_PRESSURE_TRIM_TO, max > 0 ? max : Infinity);
            const tiles = await caches.open(CACHE_TILES);
            result = await _trimTileCache(tiles, target, target);
        } catch (trimError) {
            console.warn("[SW] Quota dépassé, et le trim a échoué:", trimError);
        }

        if (result.evicted === 0) {
            console.warn(
                "[SW] Quota de stockage dépassé et rien à libérer dans le cache de tuiles — " +
                    "la réponse n'est pas mise en cache."
            );
            return false;
        }
        _notifyEvicted(result, "quota");

        if (!spare) return false;
        try {
            await cache.put(request, spare);
            return true;
        } catch (retryError) {
            console.warn("[SW] Quota dépassé — le retry après trim a échoué aussi:", retryError);
            return false;
        }
    }
}

async function cacheFirstStrategy(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
        // Background update (stale-while-revalidate)
        //
        // 🛑 BOUNDED, and this is the site a pattern-based detector COULD NOT SEE:
        // its shape only looked for `await fetch(`, `= fetch(` and `return fetch(`.
        // A fire-and-forget call is none of the three. The "≥ 14" figure therefore
        // under-counted for a reason of SHAPE, not inattention — found by the
        // non-regression guard, which scans lines instead of matching three
        // patterns.
        //
        // A hanging background revalidation is the worst case: nobody awaits it, so
        // nobody sees it holding a connection.
        fetchBounded(request)
            .then((networkResponse) => {
                if (isCacheableResponse(networkResponse, request)) {
                    void cachePut(cache, request, networkResponse.clone());
                }
            })
            .catch(() => {});

        return cachedResponse;
    }

    const networkResponse = await fetchBounded(request);
    if (isCacheableResponse(networkResponse, request)) {
        void cachePut(cache, request, networkResponse.clone());
    }
    return networkResponse;
}

/**
 * Network-First with cache fallback.
 * Tries the network first, serves from cache if offline.
 */
async function networkFirstStrategy(request, cacheName) {
    const cache = await caches.open(cacheName);

    try {
        const networkResponse = await fetchBounded(request);
        if (isCacheableResponse(networkResponse, request)) {
            void cachePut(cache, request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) return cachedResponse;
        throw error;
    }
}

/**
 * Navigation strategy: network-first with the precached app shell as fallback.
 * Root navigations (`/`) have no cached entry of their own, so on a network failure
 * we serve the precached `index.html` instead of rejecting the navigation (which
 * surfaced as "FetchEvent resulted in a network error").
 */
async function navigationStrategy(request) {
    try {
        return await fetchBounded(request);
    } catch (error) {
        const cache = await caches.open(CACHE_STATIC);
        const shell = await cache.match("index.html");
        if (shell) return shell;
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// DECLARED DATA ORIGINS — route on a DECLARATION, not a guess
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * `preferences`-store key where the engine publishes the declarations.
 *
 * ⚠️ Literal SHARED with `capabilities/offline/data-origins.ts`, which cannot be
 * imported here — this file is copied as-is, no bundler. A source guard checks both
 * say the same thing; without it, a divergence would come out silently green,
 * exactly as the base version did for months.
 */
const DATA_ORIGINS_KEY = "offline.dataOrigins";

/** Memoised declarations. `null` = not read yet; `[]` = read and empty (a REFUSAL). */
let _dataOrigins = null;

/**
 * Reads the declarations from IndexedDB, once, then keeps them in memory.
 *
 * ⚠️ Through IndexedDB and not `postMessage`: a message is lost at every worker
 * restart, and the browser restarts it whenever it wants — leaving the worker
 * declaration-less exactly when a field device wakes up off-network.
 */
async function loadDataOrigins() {
    if (_dataOrigins !== null) return _dataOrigins;
    _dataOrigins = await withIndexedDB(
        (db) =>
            new Promise((resolve) => {
                try {
                    if (!db.objectStoreNames.contains("preferences")) return resolve([]);
                    const req = db
                        .transaction(["preferences"], "readonly")
                        .objectStore("preferences")
                        .get(DATA_ORIGINS_KEY);
                    req.onsuccess = () => {
                        const v = req.result && req.result.value;
                        resolve(Array.isArray(v) ? v : []);
                    };
                    req.onerror = () => resolve([]);
                } catch (_e) {
                    resolve([]);
                }
            }),
        []
    );
    return _dataOrigins;
}

/**
 * Does the request target a DECLARED origin, in the requested role?
 *
 * Strict ORIGIN comparison — no `includes`, no `startsWith`, no path sniffing.
 * @returns {object|null} the declaration, or `null` when the origin is not declared.
 */
function matchDeclaredOrigin(url, origins, role) {
    if (!origins || origins.length === 0) return null;
    let origin;
    try {
        origin = new URL(url).origin;
    } catch (_e) {
        return null;
    }
    for (const d of origins) {
        if (!d || d.origin !== origin) continue;
        if (role && !(Array.isArray(d.roles) && d.roles.includes(role))) continue;
        return d;
    }
    return null;
}

/**
 * BOUNDED `fetch` — the worker cannot import, so it carries its own.
 *
 * 🛑 WHY THIS IS THE MOST DANGEROUS SITE OF THE PERIMETER. This file is copied
 * as-is into the deployment variants: it has neither bundler nor imports. Its
 * `fetch`es sit on a `FetchEvent`'s critical path — a slow server does not FAIL
 * them, it HOLDS them. The resource never resolves, the page waits, and there is no
 * error to show and nothing to retry. A frank failure is infinitely preferable to an
 * endless wait.
 *
 * ⚠️ It THROWS rather than returning `null`: each strategy already has its `catch`
 * and knows how to degrade visibly — cache, then a 504 placeholder. Returning
 * `null` would force every caller to distinguish "no response" from "empty
 * response", which nobody does.
 *
 * @param {Request|string} request
 * @param {number} [timeoutMs] Delay before giving up. 10 s by default: beyond that,
 *   in the field, the user has already concluded it does not work.
 * @returns {Promise<Response>}
 */
async function fetchBounded(request, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(request, { signal: controller.signal });
    } finally {
        // The timer is released EVEN on rejection: without this `finally`, a durably
        // down network accumulated one timer per attempted request.
        clearTimeout(timer);
    }
}

/**
 * Tile strategy: IndexedDB (offline engine) → Cache API → network → placeholder.
 *
 * The IndexedDB lookup is best-effort and non-provisioning (see `openIndexedDB`):
 * when the offline engine is absent the DB is `null` and we fall straight through to
 * the Cache API, so a core-only deployment serves tiles exactly like the former lite
 * SW.
 *
 * ✅ Step 1 is REACHABLE since task 3.1 (02/08/2026). It was unreachable in every deployment
 * until then — the worker opened the database at a version it could not have. The ordering
 * above is now the ordering that actually runs.
 *
 * ⚠️ The handle is taken through {@link withIndexedDB}, never `openIndexedDB()` directly: this
 * is a per-request path, and a connection left open here would block the engine's next schema
 * migration on every tile the user pans over.
 */
async function tileCacheStrategy(request) {
    if (_SW_DEBUG) console.log("[SW] Tile requested:", request.url);

    // 1. IndexedDB (tiles cached by the offline engine via the layers store).
    try {
        const response = await withIndexedDB(async (db) => {
            const cachedTile = await getTileFromIndexedDB(db, request.url);
            return cachedTile ? await buildResponseFromRecord(cachedTile) : null;
        });
        if (response) return response;
    } catch (dbError) {
        console.error("[SW] IndexedDB tile lookup failed:", dbError);
    }

    // 2. Cache API (fallback)
    const cache = await caches.open(CACHE_TILES);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    // 3. Network
    try {
        const networkResponse = await fetchBounded(request);
        if (isCacheableResponse(networkResponse, request)) {
            // 🛑 THE ONLY WRITER OF `CACHE_TILES`, and that is what makes the trim
            // safe: what the user EXPLICITLY asked to download goes to IndexedDB via
            // the `Downloader`, never here. An eviction therefore cannot take away a
            // zone prepared for the field — a structural property, not a
            // precaution.
            void cachePut(cache, request, networkResponse.clone()).then((stored) =>
                stored ? _maybeTrimTiles(cache) : undefined
            );
        }
        return networkResponse;
    } catch (_error) {
        // 4. Placeholder tile on total failure.
        //
        // 🛑 This placeholder used to leave with status **200**, so a NETWORK
        // FAILURE became a SUCCESS. For a raster tile that is a grey image instead
        // of an image; for a VECTOR tile, MapLibre receives a `200` and tries to
        // parse SVG as protobuf. The error it then raises no longer speaks of the
        // network.
        //
        // The status is now **504 Gateway Timeout**: the body is still served — the
        // placeholder has use value, it tells the user the tile is missing — but the
        // status tells the TRUTH, and any consumer testing `response.ok` sees it.
        //
        // ⚠️ `Cache-Control: no-store` and not `no-cache`: a failure response must
        // not be kept, even revalidatable. It has no value beyond the instant.
        return new Response(OFFLINE_TILE_SVG, {
            headers: {
                "Content-Type": "image/svg+xml",
                "Cache-Control": "no-store",
                // Explicit marker: the body is a substitute, not the requested resource.
                "X-GeoLeaf-Placeholder": "tile",
            },
            status: 504,
            // ⚠️ PURE ASCII, and this is not style. A non-ASCII `statusText` makes
            // the `Response` constructor THROW — a first draft's em-dash made
            // `tileCacheStrategy` fail INSIDE its own catch, and the page received a
            // `TypeError: Failed to fetch` instead of the placeholder. Measured on
            // 02/08/2026.
            statusText: "Offline - tile unavailable",
        });
    }
}

// ═══════════════════════════════════════════════
// DETECTION HELPERS
// ═══════════════════════════════════════════════

/**
 * Does the resource belong to ONE profile, i.e. does it live UNDER its directory?
 *
 * 🛑 **The trailing `/` is not cosmetic, it is a measured fix.** This function
 * returned `true` for any path CONTAINING `/profiles/`, hence also for the index
 * `geoleaf.config.json`, which sits at the root of `profiles/` and belongs to no
 * profile. `getCacheNameForProfile` then captured the FILE NAME as if it were a
 * profile name and derived a `…-profile-geoleaf.config.json` bucket — which
 * `cacheFirstStrategy` CREATES by opening it, and nothing ever fills.
 *
 * Measured consequence on 13/08/2026: the file was correctly PRE-CACHED in
 * `CACHE_STATIC` (`lib/boot-assets.cjs` deliberately lists it) and **unreachable** —
 * the read was scoped to an empty bucket. Offline, a global `caches.match()` found
 * it; the route did not. The application did not boot on second load, for lack of
 * `map.bounds`.
 *
 * ⚠️ **Narrowing here is NOT enough**, and that is this fix's trap: `isStaticAsset`
 * does not accept `json`, so the index would fall back to
 * `networkFirstStrategy(CACHE_RUNTIME)` — another bucket, another miss, same
 * outage. See {@link isProfileShellConfig}, the other half.
 */
function isProfileResource(url) {
    return /\/profiles\/[^/]+\//.test(url.pathname);
}

/**
 * Keys of {@link STATIC_ASSETS}, resolved as `install` wrote them. `null` until the
 * first request asks — the list is injected at build time, not at load time.
 */
let _precachedKeys = null;

/**
 * Is the resource part of the PRE-CACHE, as `install` wrote it?
 *
 * 🛑 **THE OTHER HALF OF THE SAME DEFECT, AND THE MORE IMPORTANT ONE: what `install`
 * writes, `fetch` must know how to read.** The worker's two halves derived their
 * perimeter separately — `install` from `STATIC_ASSETS` (derived by
 * `lib/boot-assets.cjs`), `fetch` from an EXTENSION LIST (`isStaticAsset`) that does
 * not accept `json`. Any pre-cached entry whose extension was missing from that
 * list was therefore written into `CACHE_STATIC` then looked up elsewhere —
 * `networkFirstStrategy(CACHE_RUNTIME)` — and unfindable offline.
 *
 * Measured on 13/08/2026 by the class guard of `e2e/31-offline-second-load.spec.js`:
 * **TWO** entries out of 17, `profiles/geoleaf.config.json` and `manifest.json`.
 * The first prevented the application from booting on second load, for lack of
 * `map.bounds`.
 *
 * ⚠️ **The first fix written treated only the config**, by narrowing
 * `isProfileResource` and routing the `profiles/` root to `CACHE_STATIC`. It would
 * have left `manifest.json` broken — the guard, not re-reading, is what said so.
 * Hence this shape: instead of guessing the perimeter a second time, we read THE
 * ONE THAT SERVED TO WRITE. An extension list and an asset list cannot diverge if
 * one of the two no longer exists.
 *
 * ⚠️ The resolution base is `self.location.href`, and that is not indifferent: it
 * is exactly the one `cache.addAll(STATIC_ASSETS)` uses at installation. Resolving
 * here from another base would produce keys matching nothing.
 */
function isPrecachedAsset(url) {
    if (url.origin !== self.location.origin) {
        return false;
    }
    if (_precachedKeys === null) {
        _precachedKeys = new Set(
            STATIC_ASSETS.map((entry) => {
                const u = new URL(entry, self.location.href);
                return u.pathname + u.search;
            })
        );
    }
    return _precachedKeys.has(url.pathname + url.search);
}

/**
 * Does the host belong to `domain`, or to one of its subdomains?
 *
 * 🛑 REPLACES `hostname.includes(...)`. A substring knows no hostname boundaries:
 * `includes("tile")` matched `mon-site-hostile.tilerie.com`, and
 * `includes("maptiler")` would match `maptiler.attaquant.tld`. The worker then
 * routed hostile traffic to its tile strategy, hence to its cache.
 *
 * ⚠️ This hardening only makes the CURRENT mechanism honest. It does not replace
 * it: declared data origins supersede these hard-coded lists. Until they are there,
 * at least the comparison no longer lies.
 */
function _isHostOf(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

/** Known VECTOR tile domains. Provisional — superseded by declared origins. */
const _VECTOR_TILE_DOMAINS = ["openfreemap.org", "maptiler.com", "protomaps.com", "versatiles.org"];

function _isVectorTileProvider(hostname) {
    return _VECTOR_TILE_DOMAINS.some((d) => _isHostOf(hostname, d));
}

/**
 * Known RASTER tile domains. Provisional — superseded by declared origins.
 *
 * ⚠️ `"tile"` disappeared from this list, and that is the fix's point: it was not a
 * domain but a substring, accepting any host containing the word. The genuinely
 * targeted hosts (`tile.openstreetmap.org`, `c.tile.opentopomap.org`) are covered
 * by their domain, as subdomains.
 */
const _RASTER_TILE_DOMAINS = ["openstreetmap.org", "arcgisonline.com", "opentopomap.org"];

function _isRasterProvider(hostname) {
    return _RASTER_TILE_DOMAINS.some((d) => _isHostOf(hostname, d));
}

function _isTileFile(path) {
    return path.endsWith(".pbf") || path.endsWith(".mvt");
}

function isTileRequest(url) {
    const hostname = url.hostname;
    const path = url.pathname;

    // 0. IGN Géoplateforme — route EVERY resource (vector .pbf, glyph .pbf, sprite
    //    .png/.json, style .json) to the tile strategy so the full vector basemap
    //    renders offline. Paths never contain /profiles/, so this pre-empts
    //    isStaticAsset (.png) and the networkFirst fallback (.json).
    //    ⚠️ `_isHostOf` and not `includes`: this domain is HARD-CODED in the worker,
    //    and a substring would have made it match `data.geopf.fr.attaquant.tld`. A
    //    hard-coded domain that compares badly is doubly fragile. The hard-coding
    //    itself is what declared origins remove.
    if (_isHostOf(hostname, "data.geopf.fr")) {
        return true;
    }

    // 1. Vector providers — only real tile files (.pbf/.mvt/.png), NOT metadata
    //    (JSON styles, TileJSON) which must go through networkFirst. Checked FIRST
    //    because some hostnames (tiles.openfreemap.org, api.maptiler.com) contain
    //    "tile" and would be caught by the generic raster rule.
    if (_isVectorTileProvider(hostname)) {
        return _isTileFile(path) || path.endsWith(".png");
    }

    // 2. Raster providers — always accepted (hostname is sufficient)
    if (_isRasterProvider(hostname)) {
        return true;
    }

    // 3. Fallback: detection by file extension
    return _isTileFile(path);
}

function isStaticAsset(url) {
    // 🛑 ORIGIN CHECK — without it, the extension sufficed.
    //
    // The function tested only the path: any `.js` from any host entered the STATIC
    // cache, then was re-served **cache-first** — i.e. the cache won over the
    // network, for a third-party script, indefinitely. A script compromised once
    // stayed served after its fix at the source.
    //
    // "Static" means nothing outside our own origin: what is ours is deployed with
    // us and versioned with us.
    if (url.origin !== self.location.origin) {
        return false;
    }
    // ⚠️ `mjs` counts as much as `js`, and its absence was a DIAGNOSTIC TRAP. Since
    // MapLibre 6 the whole engine is `.mjs`: without this extension it fell into
    // `networkFirstStrategy(CACHE_RUNTIME)` instead of the static cache — so a first
    // ONLINE load filled the runtime cache, and the offline reload worked anyway.
    // The pre-cache defect became invisible to tests, including
    // `e2e/31-offline-second-load.spec.js`, which loads online before cutting the
    // network.
    return url.pathname.match(/\.(js|mjs|css|html|png|jpg|jpeg|svg|woff|woff2|ttf)$/);
}

function getCacheNameForProfile(url) {
    const match = url.pathname.match(/\/profiles\/([^/]+)/);
    if (match && match[1]) {
        return `${CACHE_PROFILE_PREFIX}${match[1]}`;
    }
    return CACHE_RUNTIME;
}

// ═══════════════════════════════════════════════
// INDEXEDDB (read-only, non-provisioning) + BACKGROUND SYNC
// ═══════════════════════════════════════════════

/**
 * Opens the shared `geoleaf-db` IndexedDB — READ-ONLY, NON-PROVISIONING, VERSIONLESS.
 *
 * 🛑 THE SW CARRIES NO VERSION NUMBER, AND THAT IS THE WHOLE POINT (task 3.1, decision T2′).
 *
 * It used to open at a hard-coded `2` while the engine declared `3`. IndexedDB refuses to
 * open below the stored version — it throws `VersionError` — so this function resolved
 * `null` on EVERY call, in EVERY deployment, and ~256 lines of this file were unreachable.
 * That was root cause n°2 of the offline chain. Measured from inside the deployed worker:
 * `open("geoleaf-db", 2)` → `{ ok: false, err: "VersionError" }` against `geoleaf-db@v3`.
 *
 * The fix is NOT to copy the right number, nor to derive it at build time. Per spec, an
 * `undefined` version opens the database AT ITS CURRENT VERSION and `onupgradeneeded` never
 * fires. So:
 *   - the READ-ONLY / NON-PROVISIONING intent stops being *defended* by an abort and becomes
 *     structurally true;
 *   - there is no number left to desynchronise — the drift becomes INEXPRESSIBLE, not merely
 *     unlikely;
 *   - and a device mid-rollout, carrying a worker from one release and a bundle from another,
 *     works in BOTH directions. With any number — copied or derived — one direction always
 *     breaks, because the worker updates on `activate` and the bundle on reload.
 *
 * What replaces the version check is CAPABILITY DETECTION: the worker needs the `layers`
 * store, so it asks for it. That question stays true at v3, at v4, and at whatever comes
 * after — which a version number never does.
 *
 * ⚠️ Prefer {@link withIndexedDB}. A connection held open is the only thing that can block a
 * schema migration, and a worker that opens one per tile request would block every one.
 *
 * Resolves to `null` when the DB is absent, unusable, or lacks the store we need.
 */
async function openIndexedDB() {
    try {
        if (typeof indexedDB === "undefined") return null;

        // Existence check (best-effort — not all browsers implement databases()).
        if (typeof indexedDB.databases === "function") {
            const dbs = await indexedDB.databases();
            const exists = dbs.some((d) => d && d.name === "geoleaf-db");
            if (!exists) return null;
        }

        return await new Promise((resolve) => {
            let request;
            try {
                // NO SECOND ARGUMENT. See above — this is the fix, not an omission.
                request = indexedDB.open("geoleaf-db");
            } catch (_e) {
                resolve(null);
                return;
            }
            // Belt and braces for engines without `databases()`: a versionless open on an
            // ABSENT database still creates it at version 1. Aborting keeps the promise of
            // never writing a schema that would shadow the engine's.
            request.onupgradeneeded = () => {
                try {
                    if (request.transaction) request.transaction.abort();
                } catch (_e) {
                    /* ignore */
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                // Capability detection replaces the version check: what the worker actually
                // needs is the store, not a number.
                if (!db || !db.objectStoreNames.contains("layers")) {
                    try {
                        if (db) db.close();
                    } catch (_e) {
                        /* ignore */
                    }
                    resolve(null);
                    return;
                }
                // Yield if the engine asks to upgrade while we hold this handle. Combined
                // with withIndexedDB's close(), the worker can never be the blocker.
                db.onversionchange = () => {
                    try {
                        db.close();
                    } catch (_e) {
                        /* ignore */
                    }
                };
                resolve(db);
            };
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        });
    } catch (_e) {
        return null;
    }
}

/**
 * Runs `fn` against the shared database and ALWAYS closes the handle afterwards.
 *
 * 🛑 THIS EXISTS BECAUSE REPAIRING 3.1 CREATES THE RISK IT GUARDS. While `openIndexedDB()`
 * resolved `null`, the worker held no connection and could block nothing. The moment it
 * succeeds, `tileCacheStrategy` opens one PER TILE — and a live connection is the only thing
 * that can block a schema migration. The engine would then hang on `onblocked` and fall back
 * to a storage-less stub, on a device that may hold unsynced field captures.
 *
 * Resolves to `fallback` (default `null`) when the database is unavailable.
 *
 * @param {(db: IDBDatabase) => Promise<any>} fn
 * @param {any} [fallback]
 */
async function withIndexedDB(fn, fallback = null) {
    const db = await openIndexedDB();
    if (!db) return fallback;
    try {
        return await fn(db);
    } finally {
        try {
            db.close();
        } catch (_e) {
            /* ignore */
        }
    }
}

/**
 * Retrieves a tile record from IndexedDB (keyed by request URL). Resolves to `null`
 * on any error (missing store, transaction failure) so callers fall back gracefully.
 */
async function getTileFromIndexedDB(db, tileUrl) {
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction(["layers"], "readonly");
            const store = transaction.objectStore("layers");
            const request = store.get(tileUrl);

            request.onsuccess = () => {
                const result = request.result;
                if (result && result.data) {
                    resolve(result);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => {
                console.error("[SW] IndexedDB get error:", request.error);
                resolve(null);
            };
        } catch (error) {
            console.error("[SW] IndexedDB transaction error:", error);
            resolve(null);
        }
    });
}

/**
 * Extracts a binary { buffer, mimeType } payload from already-decoded record data
 * (data: URI, ArrayBuffer, or the { kind:"binary" } wrapper), or `null` when the
 * data is not binary (text/JSON).
 */
function extractBinary(cachedData, record) {
    if (!cachedData) {
        return null;
    }

    if (typeof cachedData === "string" && cachedData.startsWith("data:")) {
        const mimeMatch = cachedData.match(/^data:([^;,]+)/);
        const contentType = mimeMatch && mimeMatch[1] ? mimeMatch[1] : "image/png";
        const base64Data = cachedData.split(",")[1];
        if (!base64Data) {
            return null;
        }

        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        return {
            buffer: new Uint8Array(byteNumbers),
            mimeType: contentType,
        };
    }

    if (cachedData instanceof ArrayBuffer) {
        return {
            buffer: cachedData,
            mimeType: record.contentType || "application/octet-stream",
        };
    }

    const obj = cachedData;
    if (typeof cachedData === "object" && obj.kind === "binary" && obj.buffer) {
        return {
            buffer: obj.buffer,
            mimeType: obj.mimeType || record.contentType || "application/octet-stream",
        };
    }

    return null;
}

/**
 * Builds the response of a record RECONSTRUCTED from IndexedDB.
 *
 * 🛑 **`no-store`, and it is not caution: it is the only header that tells the
 * truth.** These responses do not come from the network, they are rebuilt from the
 * database. Announcing `max-age=31536000` promised a year of freshness to content
 * whose freshness **nothing** guarantees, and made the browser keep a second copy,
 * out of reach of any worker purge. The worker owns this cache, not the HTTP cache.
 *
 * ⚠️ **This header's justification was corrected.** It was copied **three times**
 * identically in the function below — an 8-line block per payload type — and it
 * asserted that "the TTL meant to do it is **computed, forwarded**, then discarded
 * at write time". Measured: it is no longer computed nor forwarded.
 * `downloader.ts` carries "THE `ttl` WAS REMOVED FROM HERE", and no `ttl` survives
 * anywhere — not in the core, not in `offline-ui`, not in the profile schemas;
 * `LayerMetadata` declares only `etag`, `lastModified`, `contentLength`,
 * `contentType` and `resourceType`. **The prose described a producer deleted four
 * steps earlier**, and tripling it had tripled the cost of correcting it.
 *
 * @param {BodyInit} body - The already-decoded body.
 * @param {string} contentType - The MIME type to announce.
 * @returns {Response} A 200 response, no `Content-Encoding` (the body is plain).
 */
function reconstructedResponse(body, contentType) {
    return new Response(body, {
        status: 200,
        headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
}

/**
 * Builds an HTTP Response from a cached IndexedDB record, serving binary
 * (tiles/glyphs/sprite images), text, or JSON (style/sprite/TileJSON). A fresh
 * Response is built with only Content-Type — never Content-Encoding — so the browser
 * receives raw bytes (no double-gzip).
 */
async function buildResponseFromRecord(record) {
    const decoded = await decodeCachedRecordData(record);
    if (decoded == null) {
        return null;
    }

    const binary = extractBinary(decoded, record);
    if (binary) {
        const contentType = binary.mimeType || "application/octet-stream";
        return reconstructedResponse(new Blob([binary.buffer], { type: contentType }), contentType);
    }

    // Text payloads (GPX, SVG, …)
    if (typeof decoded === "string") {
        return reconstructedResponse(decoded, record.contentType || "text/plain");
    }

    // JSON payloads (style JSON, sprite JSON, TileJSON)
    if (typeof decoded === "object") {
        return reconstructedResponse(JSON.stringify(decoded), "application/json");
    }

    return null;
}

async function decodeCachedRecordData(record) {
    if (!record || !record.dataCompressed) {
        return record?.data;
    }

    if (typeof DecompressionStream === "undefined" || !(record.data instanceof ArrayBuffer)) {
        return record.data;
    }

    try {
        const decompressedBuffer = await new Response(
            new Blob([record.data])
                .stream()
                .pipeThrough(new DecompressionStream(record.dataEncoding || "gzip"))
        ).arrayBuffer();

        // Binary records (vector tiles, glyphs, sprite images) must be returned as a
        // raw ArrayBuffer — served untouched (no double gzip, no Content-Encoding).
        // TextDecoder would corrupt the protobuf/PNG.
        if (record.dataType === "binary") {
            return decompressedBuffer;
        }

        const text = new TextDecoder().decode(decompressedBuffer);
        if (record.dataType === "json") {
            return JSON.parse(text);
        }

        return text;
    } catch (_error) {
        return record.data;
    }
}

if (_SW_DEBUG) console.log("[SW] Unified Service Worker script loaded");
