/**
 * Tests of the core Service Worker (sw-core.ts).
 * Mocks self, caches, fetch to run the install/activate/fetch/message listeners.
 */
"use strict";

if (typeof global.Response === "undefined") {
    global.Response = class Response {
        constructor(body, init = {}) {
            this.body = body;
            this.status = init.status ?? 200;
            this.headers = init.headers ?? {};
        }
    };
}

const mockSkipWaiting = vi.fn().mockResolvedValue(undefined);
const mockClaim = vi.fn().mockResolvedValue(undefined);

const mockCache = {
    match: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    addAll: vi.fn().mockResolvedValue(undefined),
};

const mockCaches = {
    open: vi.fn().mockResolvedValue(mockCache),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
};

const mockFetch = vi.fn().mockResolvedValue({ status: 200, clone: () => ({}) });

describe("sw-core (R4)", () => {
    let handlers;
    let originalAddEventListener;
    let originalCaches;
    let originalFetch;
    let originalSelfSkipWaiting;
    let originalClientsClaim;

    beforeAll(async () => {
        handlers = {};
        originalAddEventListener = global.addEventListener;
        global.addEventListener = function (type, handler) {
            handlers[type] = handler;
        };
        originalCaches = global.caches;
        originalFetch = global.fetch;
        originalSelfSkipWaiting = global.self?.skipWaiting;
        originalClientsClaim = global.self?.clients?.claim;
        if (global.self) {
            global.self.skipWaiting = mockSkipWaiting;
            global.self.clients = global.self.clients || {};
            global.self.clients.claim = mockClaim;
        }
        global.caches = mockCaches;
        global.fetch = mockFetch;
        await import("../../src/kernel/storage/sw-core.js");
    });

    afterAll(() => {
        global.addEventListener = originalAddEventListener;
        global.caches = originalCaches;
        global.fetch = originalFetch;
        if (global.self) {
            if (originalSelfSkipWaiting) global.self.skipWaiting = originalSelfSkipWaiting;
            if (originalClientsClaim) global.self.clients.claim = originalClientsClaim;
        }
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockCache.match.mockResolvedValue(null);
        mockCache.put.mockResolvedValue(undefined);
        mockCaches.open.mockResolvedValue(mockCache);
        mockCaches.keys.mockResolvedValue([]);
        mockFetch.mockResolvedValue({ status: 200, clone: () => ({}) });
    });

    describe("install", () => {
        it("appelle skipWaiting et ouvre le cache static", async () => {
            const waitUntil = vi.fn((p) => Promise.resolve(p));
            const event = { waitUntil };
            handlers.install(event);
            await waitUntil.mock.calls[0][0];
            expect(mockSkipWaiting).toHaveBeenCalled();
            expect(mockCaches.open).toHaveBeenCalled();
        });
    });

    describe("activate", () => {
        it("appelle caches.keys puis clients.claim", async () => {
            mockCaches.keys.mockResolvedValue(["geoleaf-v1-static", "other"]);
            mockCaches.open.mockResolvedValue(mockCache);
            const waitUntil = vi.fn((p) => Promise.resolve(p));
            const event = { waitUntil };
            handlers.activate(event);
            await waitUntil.mock.calls[0][0];
            expect(mockCaches.keys).toHaveBeenCalled();
            expect(mockClaim).toHaveBeenCalled();
        });
    });

    describe("fetch", () => {
        // ⚠️ REWRITTEN on 02/08/2026. This test was called "ignores
        // blacklisted URLs (/api/)" and LOCKED IN a blind exclusion: `/api/`
        // is a data API's most common path, i.e. exactly the traffic a field
        // deployment depends on. What decides now is the profile's origin
        // DECLARATION — not a URL convention.
        it("une URL en /api/ n'est PLUS exclue d'office — la déclaration décide", () => {
            const respondWith = vi.fn();
            handlers.fetch({
                request: { method: "GET", url: "https://example.com/api/collections/pois" },
                respondWith,
            });
            expect(respondWith).toHaveBeenCalled();
        });

        it("ce qui n'est pas de l'HTTP applicatif reste ignoré", () => {
            // The blacklist only keeps what is not an app resource: an
            // extension scheme, and the reserved `/__` paths.
            for (const url of ["chrome-extension://abc/x.js", "https://example.com/__probe"]) {
                const respondWith = vi.fn();
                handlers.fetch({ request: { method: "GET", url }, respondWith });
                expect(respondWith, url).not.toHaveBeenCalled();
            }
        });

        it("responds with networkFirst for config.json", async () => {
            const respondWith = vi.fn();
            const event = {
                request: { method: "GET", url: "https://example.com/config.json" },
                respondWith,
            };
            handlers.fetch(event);
            expect(respondWith).toHaveBeenCalled();
            const response = await respondWith.mock.calls[0][0];
            expect(response).toBeDefined();
        });

        it("responds with cacheFirst for resource /profiles/", async () => {
            const respondWith = vi.fn();
            const event = {
                request: { method: "GET", url: "https://example.com/profiles/demo/data.json" },
                respondWith,
            };
            handlers.fetch(event);
            expect(respondWith).toHaveBeenCalled();
            await respondWith.mock.calls[0][0];
        });

        it("tile URL : placeholder servi en 504 quand le réseau tombe (bug n° 6)", async () => {
            mockFetch.mockRejectedValue(new Error("offline"));
            const respondWith = vi.fn();
            const event = {
                request: { method: "GET", url: "https://tile.openstreetmap.org/1/2/3.png" },
                respondWith,
            };
            handlers.fetch(event);
            expect(respondWith).toHaveBeenCalled();
            const response = await respondWith.mock.calls[0][0];
            expect(response).toBeDefined();
            // 🛑 504 and not 200: a network failure must not present as a
            // success. At 200, MapLibre received SVG for a VECTOR tile and
            // tried to parse it as protobuf — the surfaced error then no
            // longer spoke of network.
            expect(response.status).toBe(504);
            // ⚠️ `Response` is NATIVE in this environment (the mock at the top
            // of the file is only set if `global.Response` is absent), so
            // `headers` is a real `Headers`: it reads through `.get()`, not
            // indexing. Both forms are accepted here so the test does not
            // depend on that toggle.
            const marker =
                response.headers.get?.("X-GeoLeaf-Placeholder") ??
                response.headers["X-GeoLeaf-Placeholder"];
            expect(marker).toBe("tile");
        });

        it("responds for static resource .js", async () => {
            const respondWith = vi.fn();
            const event = {
                request: { method: "GET", url: "https://example.com/app.js" },
                respondWith,
            };
            handlers.fetch(event);
            expect(respondWith).toHaveBeenCalled();
            await respondWith.mock.calls[0][0];
        });

        it("navigation (mode=navigate) returns the network response when online", async () => {
            const netResp = { status: 200, clone: () => ({}) };
            mockFetch.mockResolvedValueOnce(netResp);
            const respondWith = vi.fn();
            const event = {
                request: { method: "GET", url: "https://example.com/", mode: "navigate" },
                respondWith,
            };
            handlers.fetch(event);
            expect(respondWith).toHaveBeenCalled();
            const response = await respondWith.mock.calls[0][0];
            expect(response).toBe(netResp);
        });

        it("navigation falls back to the cached app shell when the fetch fails", async () => {
            mockFetch.mockRejectedValueOnce(new Error("offline"));
            const shell = { status: 200, clone: () => ({}) };
            mockCache.match.mockResolvedValueOnce(shell);
            const respondWith = vi.fn();
            const event = {
                request: { method: "GET", url: "https://example.com/", mode: "navigate" },
                respondWith,
            };
            handlers.fetch(event);
            expect(respondWith).toHaveBeenCalled();
            const response = await respondWith.mock.calls[0][0];
            expect(response).toBe(shell);
        });

        it("navigation rethrows when the fetch fails and no shell is cached", async () => {
            mockFetch.mockRejectedValueOnce(new Error("offline"));
            mockCache.match.mockResolvedValueOnce(null);
            const respondWith = vi.fn();
            const event = {
                request: { method: "GET", url: "https://example.com/", mode: "navigate" },
                respondWith,
            };
            handlers.fetch(event);
            expect(respondWith).toHaveBeenCalled();
            await expect(respondWith.mock.calls[0][0]).rejects.toThrow("offline");
        });
    });

    describe("message", () => {
        it("SKIP_WAITING appelle skipWaiting", () => {
            handlers.message({
                source: { type: "window" },
                data: { type: "SKIP_WAITING" },
            });
            expect(mockSkipWaiting).toHaveBeenCalled();
        });

        it("ignore message sans source valide", () => {
            mockSkipWaiting.mockClear();
            handlers.message({ source: null, data: { type: "SKIP_WAITING" } });
            expect(mockSkipWaiting).not.toHaveBeenCalled();
        });

        // ── the ORIGIN check, on top of the source type ─────────────────────────────────
        it("refuse un message d'une AUTRE origine, même de type window", () => {
            // The existing check only tested the source's TYPE.
            // `CLEAR_CACHE`'s effect is destructive, and "bounded by
            // construction" is reasoning about the browser, not a check made here.
            mockSkipWaiting.mockClear();
            handlers.message({
                source: { type: "window" },
                origin: "https://attaquant.example",
                data: { type: "SKIP_WAITING" },
            });
            expect(mockSkipWaiting).not.toHaveBeenCalled();
        });

        it("accepte un message dont l'origine est VIDE — sinon la garde bloque tout", () => {
            // 🛑 THE GUARD'S TRAP. `event.origin` is empty for a same-origin
            // client message in several browsers. Treating the empty string
            // as a foreign origin would have made the worker deaf to its own
            // page: a guard refusing everything does not guard better, it breaks.
            mockSkipWaiting.mockClear();
            handlers.message({
                source: { type: "window" },
                origin: "",
                data: { type: "SKIP_WAITING" },
            });
            expect(mockSkipWaiting).toHaveBeenCalled();
        });

        it("CLEAR_CACHE supprime les caches et postMessage sur le port", async () => {
            mockCaches.keys.mockResolvedValue(["geoleaf-v1-static"]);
            const postMessage = vi.fn();
            const event = {
                source: { type: "window" },
                data: { type: "CLEAR_CACHE" },
                ports: [{ postMessage }],
                waitUntil: vi.fn((p) => Promise.resolve(p)),
            };
            handlers.message(event);
            await event.waitUntil.mock.calls[0][0];
            expect(mockCaches.keys).toHaveBeenCalled();
            expect(postMessage).toHaveBeenCalledWith({ success: true });
        });
    });

    // ── T22 — sw-core.ts branch coverage ──────────────────────────────────
    describe("T22 branch coverage", () => {
        describe("cacheFirstStrategy — cache hit (stale-while-revalidate)", () => {
            it("returns cached response immediately when cache hit", async () => {
                const cachedResponse = { status: 200, clone: () => ({}) };
                mockCache.match.mockResolvedValueOnce(cachedResponse);
                const respondWith = vi.fn();
                const event = {
                    request: { method: "GET", url: "https://example.com/profiles/demo/layer.json" },
                    respondWith,
                };
                handlers.fetch(event);
                expect(respondWith).toHaveBeenCalled();
                const response = await respondWith.mock.calls[0][0];
                expect(response).toBe(cachedResponse);
            });
        });

        describe("isConfigFile — profile.json branch", () => {
            it("responds with networkFirst for profile.json (covers || right side)", async () => {
                const respondWith = vi.fn();
                const event = {
                    request: { method: "GET", url: "https://example.com/data/profile.json" },
                    respondWith,
                };
                handlers.fetch(event);
                expect(respondWith).toHaveBeenCalled();
                await respondWith.mock.calls[0][0];
            });
        });

        describe("getCacheNameForProfile — no profile id match → CACHE_RUNTIME", () => {
            it("falls back to CACHE_RUNTIME when /profiles/ path has no id segment", async () => {
                const respondWith = vi.fn();
                const event = {
                    request: { method: "GET", url: "https://example.com/profiles/" },
                    respondWith,
                };
                handlers.fetch(event);
                expect(respondWith).toHaveBeenCalled();
                await respondWith.mock.calls[0][0];
            });
        });

        describe("message — source.type='worker' accepted", () => {
            it("accepts SKIP_WAITING from source.type=worker", () => {
                mockSkipWaiting.mockClear();
                handlers.message({
                    source: { type: "worker" },
                    data: { type: "SKIP_WAITING" },
                });
                expect(mockSkipWaiting).toHaveBeenCalled();
            });
        });

        describe("isTileRequest — vector tile provider with .pbf", () => {
            it("handles vector tile provider URL with .pbf extension", async () => {
                const respondWith = vi.fn();
                const event = {
                    request: { method: "GET", url: "https://tiles.openfreemap.org/map/tile.pbf" },
                    respondWith,
                };
                handlers.fetch(event);
                expect(respondWith).toHaveBeenCalled();
                await respondWith.mock.calls[0][0];
            });
        });

        // ── isTileRequest — rule 0, never tested until now ─────────────────────────
        //
        // These three cases come from a triage.
        // `__tests__/storage/sw-tile-detection.test.js` (144 l.) claimed to
        // cover `isTileRequest`; it **copied** a version of it into the test
        // file — "Replicate isTileRequest() logic from sw.js / sw-core.js" —
        // and verified the copy. It had DIVERGED: rule 0 (`data.geopf.fr`,
        // every IGN Géoplateforme resource routed to the tile strategy) was
        // not in it. A replica cannot turn red when the original changes;
        // precisely what had happened, noiselessly. The file is deleted, its
        // scenarios replayed here against the real `sw-core.js`.
        //
        // Discriminant: `tileSimpleStrategy` returns a **200 placeholder**
        // when the network fails, where `networkFirstStrategy` **rethrows**
        // the error with no cache entry. What tells "routed as tile" from
        // "routed elsewhere" from the outside.
        //
        // ⚠️ **Sensitivity measured by mutation, not assumed.** Rule 0
        // neutralised (`if (false && hostname.includes("data.geopf.fr"))`),
        // the three cases below do NOT turn red alike:
        //   · the `.json`  → RED    — it, and it alone, proves rule 0;
        //   · the `.pbf`   → green  — rule 3 (`_isTileFile`) catches it anyway;
        //   · the counter-proof → green, it is not supposed to depend on rule 0.
        // The `.pbf` is thus kept for what it is worth (the geopf path is
        // indeed tile), not as proof of the rule. Written here so it is not
        // taken for such.
        describe("isTileRequest — règle 0 (IGN Géoplateforme)", () => {
            it("route un .pbf vectoriel de data.geopf.fr vers la stratégie tuile", async () => {
                mockFetch.mockRejectedValue(new Error("offline"));
                const respondWith = vi.fn();
                handlers.fetch({
                    request: {
                        method: "GET",
                        url: "https://data.geopf.fr/tms/1.0.0/PLAN/1/2/3.pbf",
                    },
                    respondWith,
                });
                const response = await respondWith.mock.calls[0][0];
                // 504 since bug no. 6: these two tests exercise the ROUTING
                // to the tile strategy, and the routing's proof is precisely
                // the placeholder — which no other strategy produces. The
                // status changed, not the subject.
                expect(response.status).toBe(504);
            });

            it("y route AUSSI un style .json, que la règle générale enverrait en networkFirst", async () => {
                mockFetch.mockRejectedValue(new Error("offline"));
                const respondWith = vi.fn();
                handlers.fetch({
                    request: {
                        method: "GET",
                        url: "https://data.geopf.fr/annexes/style/plan.json",
                    },
                    respondWith,
                });
                // Without rule 0, a `.json` would go networkFirst and this
                // promise would reject for want of cache. The placeholder proves the pre-emption.
                const response = await respondWith.mock.calls[0][0];
                // 504 since bug no. 6: these two tests exercise the ROUTING
                // to the tile strategy, and the routing's proof is precisely
                // the placeholder — which no other strategy produces. The
                // status changed, not the subject.
                expect(response.status).toBe(504);
            });

            it("un fournisseur vectoriel ordinaire ne pré-empte PAS ses métadonnées .json", async () => {
                mockFetch.mockRejectedValue(new Error("offline"));
                const respondWith = vi.fn();
                handlers.fetch({
                    request: {
                        method: "GET",
                        url: "https://tiles.openfreemap.org/styles/liberty.json",
                    },
                    respondWith,
                });
                // Counter-proof of the previous: outside data.geopf.fr, a
                // style .json stays networkFirst — hence rejection when the
                // network falls and nothing is cached. That contrast is what
                // gives rule 0 its meaning.
                await expect(respondWith.mock.calls[0][0]).rejects.toThrow("offline");
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════
    // The SW RETAINS no connection
    // ═══════════════════════════════════════════════════════════════════════════════════
    describe("3.1 — ouverture versionless, et handle rendu", () => {
        let originalIndexedDB;
        let openCalls;
        let closeSpy;

        function installIdbMock({ stores = ["layers"] } = {}) {
            openCalls = [];
            closeSpy = vi.fn();
            const db = {
                objectStoreNames: { contains: (n) => stores.includes(n) },
                close: closeSpy,
                transaction: () => ({
                    objectStore: () => ({
                        get: () => {
                            const req = {};
                            setTimeout(() => {
                                req.result = null;
                                req.onsuccess?.();
                            }, 0);
                            return req;
                        },
                    }),
                }),
            };
            originalIndexedDB = global.indexedDB;
            global.indexedDB = {
                databases: () => Promise.resolve([{ name: "geoleaf-db", version: 3 }]),
                open: (...args) => {
                    openCalls.push(args);
                    const req = {};
                    setTimeout(() => {
                        req.result = db;
                        req.onsuccess?.();
                    }, 0);
                    return req;
                },
            };
        }

        afterEach(() => {
            global.indexedDB = originalIndexedDB;
        });

        it("ouvre SANS version et FERME le handle après lecture d'une tuile", async () => {
            installIdbMock();
            mockFetch.mockResolvedValue({ status: 200, clone: () => ({}) });

            const respondWith = vi.fn();
            handlers.fetch({
                request: { method: "GET", url: "https://tile.openstreetmap.org/5/10/19.png" },
                respondWith,
            });
            await respondWith.mock.calls[0][0];

            expect(openCalls).toHaveLength(1);
            // THE point: a single argument. A CORRECT number would pass every
            // functional test and desynchronise at the next bump — hence the source guard.
            expect(openCalls[0]).toEqual(["geoleaf-db"]);
            // THE hygiene point: the connection is returned. A connection
            // retained per tile request would block any later schema upgrade.
            expect(closeSpy).toHaveBeenCalled();
        });

        it("refuse une base sans le store `layers` — et la ferme quand même", async () => {
            installIdbMock({ stores: [] });
            mockFetch.mockResolvedValue({ status: 200, clone: () => ({}) });

            const respondWith = vi.fn();
            handlers.fetch({
                request: { method: "GET", url: "https://tile.openstreetmap.org/5/10/20.png" },
                respondWith,
            });
            await respondWith.mock.calls[0][0];

            // CAPABILITY detection replaces the version check: what the
            // worker needs is the store, not a number — and that question
            // stays true at v3, v4 and beyond, which a number never does.
            expect(openCalls[0]).toEqual(["geoleaf-db"]);
            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe("3.5 — comportement de purge", () => {
        it("`activate` supprime les caches d'une AUTRE version et épargne le durable", async () => {
            const version = swCoreSource.match(/const CACHE_VERSION = "([^"]+)"/)[1];
            mockCaches.keys.mockResolvedValue([
                "geoleaf-v1.0.0-static",
                "geoleaf-v1.0.0-profile-tourism",
                "geoleaf-v1.0.0-tiles", // old VERSIONED name: purgeable, intended
                "geoleaf-data-tiles", // DURABLE : doit survivre
                `${version}-static`, // the current version: we do not raze ourselves
                "autre-appli-cache", // pas à nous
            ]);
            mockCaches.delete.mockClear();

            const waits = [];
            await handlers.activate({ waitUntil: (p) => waits.push(p) });
            await Promise.all(waits);

            const deleted = mockCaches.delete.mock.calls.map((c) => c[0]);
            expect(deleted).toContain("geoleaf-v1.0.0-static");
            expect(deleted).toContain("geoleaf-v1.0.0-profile-tourism");
            expect(deleted).toContain("geoleaf-v1.0.0-tiles");
            // 🛑 The three assertions carrying the work.
            expect(deleted).not.toContain("geoleaf-data-tiles");
            expect(deleted).not.toContain(`${version}-static`);
            expect(deleted).not.toContain("autre-appli-cache");
        });

        it("`CLEAR_CACHE` atteint AUSSI le durable — sinon le bouton mentirait", async () => {
            // Deliberate asymmetry: `activate` cleans up after the build and
            // has no mandate over what the user downloaded; `CLEAR_CACHE` IS
            // that user asking.
            mockCaches.keys.mockResolvedValue(["geoleaf-data-tiles", "geoleaf-v9-static", "tiers"]);
            mockCaches.delete.mockClear();

            const event = {
                // `source: { type: "window" }` and not `{}`: the handler
                // validates the source, and a message without a valid source
                // is IGNORED — the test would be green on a handler that did nothing.
                source: { type: "window" },
                data: { type: "CLEAR_CACHE" },
                ports: [{ postMessage: vi.fn() }],
                waitUntil: vi.fn((p) => Promise.resolve(p)),
            };
            handlers.message(event);
            await event.waitUntil.mock.calls[0][0];

            const deleted = mockCaches.delete.mock.calls.map((c) => c[0]);
            expect(deleted).toContain("geoleaf-data-tiles");
            expect(deleted).toContain("geoleaf-v9-static");
            expect(deleted).not.toContain("tiers");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════
    // Hardening: method, origin, hostname boundaries
    // ═══════════════════════════════════════════════════════════════════════════════════
    describe("3.7 — durcissement du Service Worker", () => {
        it("une écriture (POST/PUT/DELETE) n'est PAS interceptée", () => {
            // The worker never tested the method: every write fell into the
            // network-first strategy, which attempts a `cache.put` the Cache
            // API REJECTS — a rejection swallowed by an empty
            // `.catch(() => {})`. Not calling `respondWith` lets the browser
            // handle the request normally, the intended behaviour.
            for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
                const respondWith = vi.fn();
                handlers.fetch({
                    // ⚠️ NO `/api/` URL here. The `CACHE_BLACKLIST` already
                    // bails the handler on those paths: this test would have
                    // been GREEN without the method filter, i.e. empty. Seen
                    // by mutation on 02/08/2026 — exactly the trap this file
                    // exists to forbid.
                    request: {
                        method,
                        url: "https://example.com/collections/pois/items",
                        mode: "cors",
                    },
                    respondWith,
                });
                expect(respondWith, `${method} ne doit pas être intercepté`).not.toHaveBeenCalled();
            }
        });

        it("un GET reste intercepté — la garde ne coupe pas tout", () => {
            // Witness: without it, a too-wide filter would come out green intercepting NOTHING.
            const respondWith = vi.fn();
            handlers.fetch({
                request: { method: "GET", url: "https://example.com/app.js" },
                respondWith,
            });
            expect(respondWith).toHaveBeenCalled();
        });

        it("un script TIERS n'entre pas dans le cache statique", () => {
            // `isStaticAsset` only tested the extension: any `.js` from any
            // host entered the STATIC cache, then was reserved cache-first —
            // the cache beating the network, indefinitely, for code we do not control.
            const staticSrc = swCoreSource.slice(
                swCoreSource.indexOf("function isStaticAsset"),
                swCoreSource.indexOf("function isConfigFile")
            );
            expect(staticSrc).toMatch(/url\.origin !== self\.location\.origin/);
        });

        it("les fournisseurs se comparent par FRONTIÈRE de nom d'hôte, pas par sous-chaîne", () => {
            // 🛑 `hostname.includes("tile")` matched
            // `mon-site-hostile.tilerie.com`, and `includes("maptiler")` would
            // match `maptiler.attaquant.tld`. The worker then routed hostile
            // traffic to its tile strategy, hence into its cache.
            expect(swCoreSource).toMatch(/function _isHostOf\(/);
            // No provider detection may go through `includes` any more.
            const providers = swCoreSource.slice(
                swCoreSource.indexOf("function _isHostOf"),
                swCoreSource.indexOf("function isTileRequest")
            );
            expect(providers).not.toMatch(/hostname\.includes\(/);
            // And the word "tile", which was not a domain, is gone from the lists.
            expect(swCoreSource).not.toMatch(/hostname\.includes\("tile"\)/);
        });

        it("plus aucune immutabilité d'un an affirmée sur du contenu reconstruit", () => {
            // Promising `max-age=31536000` on a response rebuilt from
            // IndexedDB, while the TTL supposed to guarantee its freshness is
            // computed then DISCARDED at write, moreover made the browser
            // keep a second copy out of the worker's reach.
            const headerValues = [...swCoreSource.matchAll(/"Cache-Control":\s*"([^"]+)"/g)].map(
                (m) => m[1]
            );
            expect(headerValues.length).toBeGreaterThan(0); // témoin
            for (const v of headerValues) {
                expect(v).not.toMatch(/max-age=31536000/);
            }
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════
    // Settling OPAQUE responses, and SAYING so
    // ═══════════════════════════════════════════════════════════════════════════════════
    describe("3.11 — une réponse opaque n'entre pas en cache, et la contradiction se dit", () => {
        it("les quatre stratégies passent par `isCacheableResponse`, pas par `status === 200`", () => {
            // 🛑 An opaque carries `status: 0`. The `status === 200` guards
            // thus discarded it silently — and that is why NO raster basemap
            // is offline. The decision (not caching) is right; the silence was not.
            const strategies = swCoreSource.slice(
                swCoreSource.indexOf("function isCacheableResponse"),
                swCoreSource.indexOf("async function navigationStrategy")
            );
            // The only remaining `status === 200` is the helper's own.
            const guards = swCoreSource.match(/networkResponse\.status === 200/g) || [];
            expect(guards).toHaveLength(0);
            expect(strategies).toMatch(/isCacheableResponse\(/);
        });

        it("le helper REFUSE une opaque et une 206, ACCEPTE une 200", () => {
            const src = swCoreSource.slice(
                swCoreSource.indexOf("function isCacheableResponse"),
                swCoreSource.indexOf("const _opaqueWarned")
            );
            // A partial response is not the resource: caching it would serve
            // a fragment as though it were the whole.
            expect(src).toMatch(/response\.type === "opaque"/);
            expect(src).toMatch(/response\.status === 0/);
            // ⚠️ This line looked for the LITERAL
            // `return response.status === 200;` until two refusals were added
            // AFTER the status check — it thus became
            // `if (response.status !== 200) return false;`. The guard turned
            // red on a correct refactor, because it anchored on the FORM and
            // not the intent. It now verifies the status decides, whatever
            // the phrasing; the BEHAVIOUR is exercised by
            // `sw-core-data-origins.test.ts`, which really runs the worker
            // rather than reading its source.
            expect(src).toMatch(/response\.status (===|!==) 200/);
        });

        it("la contradiction « déclarée cachable mais opaque » est journalisée UNE fois", () => {
            // An integrator declaring `cacheable: true` and getting no cache
            // had no way to understand why. And saying it at every tile would drown the signal.
            expect(swCoreSource).toMatch(/const _opaqueWarned = new Set\(\)/);
            const warn = swCoreSource.slice(
                swCoreSource.indexOf("function _warnOpaqueOnce"),
                swCoreSource.indexOf("async function cacheFirstStrategy")
            );
            expect(warn).toMatch(/_opaqueWarned\.has\(origin\)/);
            expect(warn).toMatch(/declared && declared\.cacheable/);
            expect(warn).toMatch(/Access-Control-Allow-Origin/);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// SOURCE guard — the only one that catches "someone puts a number back". No
// behaviour assertion replaces it: a CORRECT number would pass everything,
// then desynchronise at the next bump, which IS root cause no. 2.
// The source is imported via `?raw` (vite resolution) rather than a file
// path: `import.meta.url` is not a `file:` URL under vitest, measured.
// ═══════════════════════════════════════════════════════════════════════════════════════
import swCoreSource from "../../src/kernel/storage/sw-core.js?raw";

describe("3.1 — garde de source", () => {
    it("aucun `indexedDB.open(` de sw-core.js ne porte de second argument", () => {
        const calls = swCoreSource.match(/indexedDB\.open\([^)]*\)/g) || [];
        expect(calls.length).toBeGreaterThan(0); // witness: the guard does not measure emptiness
        for (const call of calls) {
            expect(call).not.toMatch(/,/);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// The install pre-cache does NOT bypass the HTTP cache
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("garde de source : l'install ne force aucun refetch", () => {
    // 🛑 SOURCE GUARD, AND THAT IS A CONSTRAINED CHOICE. The behavioural form
    // — reading `addAll`'s arguments — CANNOT ARM here: `STATIC_ASSETS` is
    // only populated at deployment (the source carries the
    // `__GEOLEAF_STATIC_ASSETS__` placeholder), so the
    // `STATIC_ASSETS.length > 0` guard is false under vitest and `addAll` is
    // never called. Written as behaviour, it would have come out GREEN having
    // measured nothing.
    //
    // ⚠️ AND THAT IS EXACTLY HOW `cache: "reload"` SURVIVED: the `addAll`
    // mock never read its arguments, so the suite was green whether the
    // install refetched everything or not. It measured that `addAll` is
    // called, never WITH WHAT.
    //
    // ⚠️ The source is stripped of its comments before reading. Without that,
    // the guard would turn red on the prose EXPLAINING the fix — a defect
    // already paid, where a guard punished having documented what it protected.
    const code = swCoreSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    it("`cache.addAll` reçoit les URL telles quelles, sans `new Request`", () => {
        expect(code).toMatch(/cache\.addAll\(/); // witness: the guard does not measure emptiness
        // ⚠️ Cut to the statement-ending `;`, NOT to the first `)`. The first
        // draft did `addAll\([\s\S]{0,200}?\)` — non-greedy, so it stopped at
        // `(url)`'s parenthesis in
        // `addAll(STATIC_ASSETS.map((url) => new Request(...)))` and NEVER
        // saw the `new Request` it claimed to forbid. Seen green under the
        // mutation restoring it: a decorative guard, caught because it was
        // mutated before being believed.
        const calls = code.match(/cache\.addAll\([\s\S]*?;/g) || [];
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
            expect(call).not.toMatch(/new Request/);
        }
    });

    it('aucun `cache: "reload"` ne subsiste dans le worker', () => {
        expect(code).toMatch(/caches\.open\(/); // témoin
        expect(code).not.toMatch(/cache:\s*["']reload["']/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// The Background Sync path is REMOVED, and it must stay so
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("3.13 — garde de source : aucun Background Sync", () => {
    // 🛑 NOT A HOUSEKEEPING GUARD. The sync contract's point 5 pins that the
    // replay runs ON THE PAGE: the connector's authentication patches the
    // page's `fetch` and never reaches the worker, so a replay from the SW
    // would leave without a token. A rewired `sync` listener would produce
    // silently unauthenticated requests.
    it("`sw-core.js` n'écoute plus l'événement `sync`", () => {
        // Witness: the file does listen to OTHER events — the guard does not measure emptiness.
        expect(swCoreSource).toMatch(/self\.addEventListener\("fetch"/);
        expect(swCoreSource).not.toMatch(/addEventListener\(\s*["']sync["']/);
    });

    it("le worker ne parle plus au store `sync_queue`", () => {
        // `getSyncQueue` / `removeSyncItem` read and wrote the queue from the
        // worker, with an entry shape `SyncDB` does not write. They leave with the listener.
        expect(swCoreSource).toMatch(/objectStore\(/); // witness: it still talks to IndexedDB
        expect(swCoreSource).not.toMatch(/["']sync_queue["']/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// What must SURVIVE a deployment does, and by its NAME
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("3.5 — garde de source du nommage des caches", () => {
    it("`CACHE_TILES` ne porte AUCUNE version — c'est ce qui le fait survivre", () => {
        // 🛑 The guard that matters. `activate` does not raze "at every
        // version" but AT EVERY BUILD: `build-deploy.cjs` suffixes
        // `CACHE_VERSION` with a `Date.now()`, and its comment owns it
        // ("purges old caches on every build"). Measured: three different
        // timestamps for one `build:deploy` across four variants.
        //
        // As long as the tile cache's name does not contain the version, it
        // cannot enter the purge predicate. Putting `${CACHE_VERSION}-tiles`
        // back turns this red.
        const decl = swCoreSource.match(/const CACHE_TILES = ([^;]+);/);
        expect(decl).not.toBeNull();
        expect(decl[1]).not.toMatch(/CACHE_VERSION/);
        expect(decl[1]).toMatch(/geoleaf-data-/);
    });

    it("le prédicat de purge teste `geoleaf-v`, pas `geoleaf-`", () => {
        // A single character separates "I purge the build" from "I raze the field work".
        const activate = swCoreSource.slice(
            swCoreSource.indexOf('addEventListener("activate"'),
            swCoreSource.indexOf('addEventListener("fetch"')
        );
        expect(activate).toMatch(/startsWith\("geoleaf-v"\)/);
        expect(activate).not.toMatch(/startsWith\("geoleaf-"\)/);
    });
});
