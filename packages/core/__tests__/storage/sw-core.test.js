/**
 * R4 — Tests du Service Worker core (sw-core.ts).
 * Mock de self, caches, fetch pour execute les listeners install/activate/fetch/message.
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
        // ⚠️ RÉÉCRIT le 02/08/2026 (tâche 3.9, décision T4). Ce test s'appelait « ignores
        // blacklisted URLs (/api/) » et VERROUILLAIT une exclusion en aveugle : `/api/` est le
        // chemin le plus courant d'une API de données, c'est-à-dire exactement le trafic dont
        // dépend un déploiement de terrain. Ce qui décide désormais, c'est la DÉCLARATION
        // d'origine du profil — pas une convention d'URL.
        it("une URL en /api/ n'est PLUS exclue d'office — la déclaration décide", () => {
            const respondWith = vi.fn();
            handlers.fetch({
                request: { method: "GET", url: "https://example.com/api/collections/pois" },
                respondWith,
            });
            expect(respondWith).toHaveBeenCalled();
        });

        it("ce qui n'est pas de l'HTTP applicatif reste ignoré", () => {
            // La blacklist ne garde que ce qui n'est pas une ressource de l'app : un schéma
            // d'extension, et les chemins réservés `/__`.
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
            // 🛑 504 et non 200 : un échec réseau ne doit pas se présenter comme un succès.
            // En 200, MapLibre recevait du SVG pour une tuile VECTORIELLE et tentait de le
            // parser en protobuf — l'erreur remontée ne parlait alors plus de réseau.
            expect(response.status).toBe(504);
            // ⚠️ `Response` est NATIVE dans cet environnement (la mock en tête de fichier
            // n'est posée que si `global.Response` est absent), donc `headers` est un vrai
            // `Headers` : il se lit par `.get()`, pas par indexation. Les deux formes sont
            // acceptées ici pour que le test ne dépende pas de cette bascule.
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

        // ── Tâche 3.13 — le contrôle d'ORIGINE, en plus du type de source ───────────────
        it("refuse un message d'une AUTRE origine, même de type window", () => {
            // Le contrôle qui existait ne testait que le TYPE de la source. L'effet de
            // `CLEAR_CACHE` est destructeur, et « borné par construction » est un
            // raisonnement sur le navigateur, pas une vérification faite ici.
            mockSkipWaiting.mockClear();
            handlers.message({
                source: { type: "window" },
                origin: "https://attaquant.example",
                data: { type: "SKIP_WAITING" },
            });
            expect(mockSkipWaiting).not.toHaveBeenCalled();
        });

        it("accepte un message dont l'origine est VIDE — sinon la garde bloque tout", () => {
            // 🛑 LE PIÈGE DE LA GARDE. `event.origin` est vide pour un message de client
            // same-origin dans plusieurs navigateurs. Traiter la chaîne vide comme une
            // origine étrangère aurait rendu le worker sourd à sa propre page : une garde qui
            // refuse tout ne garde pas mieux, elle casse.
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

        // ── isTileRequest — la règle 0, jamais testée jusqu'ici (backlog R.3) ──────
        //
        // Ces trois cas viennent du tri de R.3. `__tests__/storage/sw-tile-detection.test.js`
        // (144 l.) prétendait couvrir `isTileRequest` ; il en **recopiait** une version dans
        // le fichier de test — « Replicate isTileRequest() logic from sw.js / sw-core.js » —
        // et vérifiait la copie. Elle avait DIVERGÉ : la règle 0 (`data.geopf.fr`, toute
        // ressource de l'IGN Géoplateforme routée vers la stratégie tuile) n'y figurait pas.
        // Un réplica ne peut pas rougir quand l'original change ; c'est précisément ce qui
        // s'était produit, sans bruit. Le fichier est supprimé, ses scénarios rejoués ici
        // contre le vrai `sw-core.js`.
        //
        // Discriminant : `tileSimpleStrategy` rend un **placeholder 200** quand le réseau
        // échoue, là où `networkFirstStrategy` **relance** l'erreur sans entrée en cache.
        // C'est ce qui distingue « routé en tuile » de « routé ailleurs » depuis l'extérieur.
        //
        // ⚠️ **Sensibilité mesurée par mutation, pas supposée.** Règle 0 neutralisée
        // (`if (false && hostname.includes("data.geopf.fr"))`), les trois cas ci-dessous
        // ne rougissent PAS pareil :
        //   · le `.json`  → ROUGE   — c'est lui, et lui seul, qui prouve la règle 0 ;
        //   · le `.pbf`   → vert    — la règle 3 (`_isTileFile`) l'attrape de toute façon ;
        //   · la contre-épreuve → verte, elle n'est pas censée dépendre de la règle 0.
        // Le `.pbf` est donc gardé pour ce qu'il vaut (le chemin geopf est bien tuile),
        // pas comme preuve de la règle. Écrit ici pour qu'on ne le prenne pas pour telle.
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
                // 504 depuis le bug n° 6 : ces deux tests éprouvent le ROUTAGE vers la
                // stratégie tuile, et la preuve du routage est justement le placeholder —
                // qu'aucune autre stratégie ne produit. Le statut a changé, pas le sujet.
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
                // Sans la règle 0, un `.json` partirait en networkFirst et cette promesse
                // serait rejetée faute de cache. Le placeholder prouve le pré-emption.
                const response = await respondWith.mock.calls[0][0];
                // 504 depuis le bug n° 6 : ces deux tests éprouvent le ROUTAGE vers la
                // stratégie tuile, et la preuve du routage est justement le placeholder —
                // qu'aucune autre stratégie ne produit. Le statut a changé, pas le sujet.
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
                // Contre-épreuve de la précédente : hors data.geopf.fr, un .json de style
                // reste en networkFirst — donc rejet quand le réseau tombe et que rien
                // n'est en cache. C'est ce contraste qui donne son sens à la règle 0.
                await expect(respondWith.mock.calls[0][0]).rejects.toThrow("offline");
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════
    // Tâche 3.1 (T2′) — le SW ne RETIENT aucune connexion (défaut A)
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
            // LE point de 3.1 : un seul argument. Un numéro JUSTE passerait tous les tests
            // fonctionnels et se désynchroniserait au bump suivant — d'où la garde de source.
            expect(openCalls[0]).toEqual(["geoleaf-db"]);
            // LE point de l'hygiène : la connexion est rendue. Une connexion retenue par
            // requête de tuile bloquerait toute montée de schéma ultérieure.
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

            // La détection de CAPACITÉ remplace le contrôle de version : ce dont le worker a
            // besoin est le store, pas un numéro — et cette question reste vraie en v3, en v4
            // et après, ce qu'un numéro ne fait jamais.
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
                "geoleaf-v1.0.0-tiles", // ancien nom VERSIONNÉ : purgeable, c'est voulu
                "geoleaf-data-tiles", // DURABLE : doit survivre
                `${version}-static`, // la version courante : on ne se rase pas soi-même
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
            // 🛑 Les trois assertions qui portent la tâche.
            expect(deleted).not.toContain("geoleaf-data-tiles");
            expect(deleted).not.toContain(`${version}-static`);
            expect(deleted).not.toContain("autre-appli-cache");
        });

        it("`CLEAR_CACHE` atteint AUSSI le durable — sinon le bouton mentirait", async () => {
            // Asymétrie délibérée : `activate` nettoie après le build et n'a pas mandat sur ce
            // que l'utilisateur a téléchargé ; `CLEAR_CACHE` EST cet utilisateur qui demande.
            mockCaches.keys.mockResolvedValue(["geoleaf-data-tiles", "geoleaf-v9-static", "tiers"]);
            mockCaches.delete.mockClear();

            const event = {
                // `source: { type: "window" }` et non `{}` : le handler valide la source, et
                // un message sans source valide est IGNORÉ — le test serait vert sur un
                // handler qui n'a rien fait.
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
    // Tâche 3.7 — durcissement : méthode, origine, frontières de nom d'hôte
    // ═══════════════════════════════════════════════════════════════════════════════════
    describe("3.7 — durcissement du Service Worker", () => {
        it("une écriture (POST/PUT/DELETE) n'est PAS interceptée", () => {
            // Le worker ne testait jamais la méthode : chaque écriture tombait dans la
            // stratégie réseau-d'abord, qui tente un `cache.put` que la Cache API REJETTE —
            // rejet avalé par un `.catch(() => {})` vide. Ne pas appeler `respondWith` laisse
            // le navigateur traiter la requête normalement, ce qui est le comportement voulu.
            for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
                const respondWith = vi.fn();
                handlers.fetch({
                    // ⚠️ PAS d'URL en `/api/` ici. La blacklist `CACHE_BLACKLIST` fait déjà
                    // sortir le handler sur ces chemins : ce test aurait été VERT sans le
                    // filtre de méthode, c'est-à-dire vide. Vu par mutation le 02/08/2026 —
                    // exactement le piège que ce fichier existe pour interdire.
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
            // Témoin : sans lui, un filtre trop large sortirait vert en n'interceptant RIEN.
            const respondWith = vi.fn();
            handlers.fetch({
                request: { method: "GET", url: "https://example.com/app.js" },
                respondWith,
            });
            expect(respondWith).toHaveBeenCalled();
        });

        it("un script TIERS n'entre pas dans le cache statique", () => {
            // `isStaticAsset` ne testait que l'extension : n'importe quel `.js` de n'importe
            // quel hôte entrait en cache STATIQUE, puis était resservi cache-first — le cache
            // l'emportant sur le réseau, indéfiniment, pour du code qu'on ne contrôle pas.
            const staticSrc = swCoreSource.slice(
                swCoreSource.indexOf("function isStaticAsset"),
                swCoreSource.indexOf("function isConfigFile")
            );
            expect(staticSrc).toMatch(/url\.origin !== self\.location\.origin/);
        });

        it("les fournisseurs se comparent par FRONTIÈRE de nom d'hôte, pas par sous-chaîne", () => {
            // 🛑 `hostname.includes("tile")` matchait `mon-site-hostile.tilerie.com`, et
            // `includes("maptiler")` matcherait `maptiler.attaquant.tld`. Le worker routait
            // alors du trafic hostile vers sa stratégie de tuiles, donc vers son cache.
            expect(swCoreSource).toMatch(/function _isHostOf\(/);
            // Aucune détection de fournisseur ne doit plus passer par `includes`.
            const providers = swCoreSource.slice(
                swCoreSource.indexOf("function _isHostOf"),
                swCoreSource.indexOf("function isTileRequest")
            );
            expect(providers).not.toMatch(/hostname\.includes\(/);
            // Et le mot « tile », qui n'était pas un domaine, a disparu des listes.
            expect(swCoreSource).not.toMatch(/hostname\.includes\("tile"\)/);
        });

        it("plus aucune immutabilité d'un an affirmée sur du contenu reconstruit", () => {
            // Promettre `max-age=31536000` sur une réponse rebâtie depuis IndexedDB, alors que
            // le TTL censé garantir sa fraîcheur est calculé puis JETÉ à l'écriture, faisait
            // en plus garder au navigateur une seconde copie hors de portée du worker.
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
    // Tâche 3.11 — trancher les réponses OPAQUES, et le DIRE
    // ═══════════════════════════════════════════════════════════════════════════════════
    describe("3.11 — une réponse opaque n'entre pas en cache, et la contradiction se dit", () => {
        it("les quatre stratégies passent par `isCacheableResponse`, pas par `status === 200`", () => {
            // 🛑 Une opaque porte `status: 0`. Les gardes `status === 200` l'écartaient donc
            // silencieusement — et c'est pour ça qu'AUCUN fond raster n'est hors-ligne. La
            // décision (ne pas cacher) est juste ; c'est le silence qui ne l'était pas.
            const strategies = swCoreSource.slice(
                swCoreSource.indexOf("function isCacheableResponse"),
                swCoreSource.indexOf("async function navigationStrategy")
            );
            // Le seul `status === 200` restant est celui du helper lui-même.
            const guards = swCoreSource.match(/networkResponse\.status === 200/g) || [];
            expect(guards).toHaveLength(0);
            expect(strategies).toMatch(/isCacheableResponse\(/);
        });

        it("le helper REFUSE une opaque et une 206, ACCEPTE une 200", () => {
            const src = swCoreSource.slice(
                swCoreSource.indexOf("function isCacheableResponse"),
                swCoreSource.indexOf("const _opaqueWarned")
            );
            // Une réponse partielle ne vaut pas la ressource : la cacher servirait un
            // fragment comme s'il était le tout.
            expect(src).toMatch(/response\.type === "opaque"/);
            expect(src).toMatch(/response\.status === 0/);
            // ⚠️ Cette ligne cherchait le LITTÉRAL `return response.status === 200;` jusqu'à la
            // tâche 8.3, qui a ajouté deux refus APRÈS le contrôle de statut — celui-ci est
            // donc devenu `if (response.status !== 200) return false;`. La garde rougissait sur
            // un refactor correct, parce qu'elle s'ancrait sur la FORME et non sur l'intention.
            // Elle vérifie désormais que le statut décide, quelle que soit la tournure ; le
            // COMPORTEMENT, lui, est éprouvé par `sw-core-data-origins.test.ts`, qui exécute
            // vraiment le worker plutôt que de lire sa source.
            expect(src).toMatch(/response\.status (===|!==) 200/);
        });

        it("la contradiction « déclarée cachable mais opaque » est journalisée UNE fois", () => {
            // Un intégrateur qui déclare `cacheable: true` et n'obtient aucun cache n'avait
            // aucun moyen de comprendre pourquoi. Et le dire à chaque tuile noierait le signal.
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
// Garde de SOURCE de la tâche 3.1 — la seule qui attrape « quelqu'un remet un numéro ».
// Aucune assertion de comportement ne la remplace : un numéro JUSTE passerait tout, puis se
// désynchroniserait au bump suivant, ce qui EST la cause racine n° 2.
// Le source est importé via `?raw` (résolution vite) plutôt que par un chemin de fichier :
// `import.meta.url` n'est pas un URL `file:` sous vitest, mesuré.
// ═══════════════════════════════════════════════════════════════════════════════════════
import swCoreSource from "../../src/kernel/storage/sw-core.js?raw";

describe("3.1 — garde de source", () => {
    it("aucun `indexedDB.open(` de sw-core.js ne porte de second argument", () => {
        const calls = swCoreSource.match(/indexedDB\.open\([^)]*\)/g) || [];
        expect(calls.length).toBeGreaterThan(0); // témoin : la garde ne mesure pas le vide
        for (const call of calls) {
            expect(call).not.toMatch(/,/);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// S5.7 — le pré-cache d'install ne contourne PAS le cache HTTP
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("S5.7 — garde de source : l'install ne force aucun refetch", () => {
    // 🛑 GARDE DE SOURCE, ET C'EST UN CHOIX CONTRAINT. La forme comportementale — lire les
    // arguments d'`addAll` — NE PEUT PAS S'ARMER ici : `STATIC_ASSETS` n'est peuplé qu'au
    // déploiement (le source porte le placeholder `__GEOLEAF_STATIC_ASSETS__`), donc la garde
    // `STATIC_ASSETS.length > 0` est fausse sous vitest et `addAll` n'est jamais appelé.
    // Écrite en comportement, elle serait sortie VERTE sans rien avoir mesuré.
    //
    // ⚠️ ET C'EST EXACTEMENT COMME ÇA QUE `cache: "reload"` A SURVÉCU : le mock d'`addAll`
    // n'a jamais lu ses arguments, donc la suite était verte que l'install refetche tout ou
    // non. Elle mesurait qu'on appelle `addAll`, jamais AVEC QUOI.
    //
    // ⚠️ Le source est dépouillé de ses commentaires avant lecture. Sans ça, la garde
    // rougirait sur la prose qui EXPLIQUE le correctif — le défaut mesuré au Sprint 1, où une
    // garde punissait le fait d'avoir documenté ce qu'elle protégeait.
    const code = swCoreSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    it("`cache.addAll` reçoit les URL telles quelles, sans `new Request`", () => {
        expect(code).toMatch(/cache\.addAll\(/); // témoin : la garde ne mesure pas le vide
        // ⚠️ Découper jusqu'au `;` de fin d'instruction, PAS jusqu'à la première `)`.
        // La première rédaction faisait `addAll\([\s\S]{0,200}?\)` — non gourmand, donc elle
        // s'arrêtait à la parenthèse de `(url)` dans
        // `addAll(STATIC_ASSETS.map((url) => new Request(...)))` et ne voyait JAMAIS le
        // `new Request` qu'elle prétendait interdire. Vue verte sous la mutation qui le
        // restaure : une garde décorative, attrapée parce qu'on l'a mutée avant de la croire.
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
// Tâche 3.13 — le chemin Background Sync est SUPPRIMÉ, et il doit le rester
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("3.13 — garde de source : aucun Background Sync", () => {
    // 🛑 CE N'EST PAS UNE GARDE DE MÉNAGE. Le point 5 du contrat de synchronisation fige que
    // le rejeu tourne SUR LA PAGE : l'authentification du connector patche le `fetch` de la
    // page et n'atteint jamais le worker, donc un rejeu depuis le SW partirait sans jeton.
    // Un écouteur `sync` rebranché produirait des requêtes silencieusement non authentifiées.
    it("`sw-core.js` n'écoute plus l'événement `sync`", () => {
        // Témoin : le fichier écoute bien d'AUTRES événements — la garde ne mesure pas le vide.
        expect(swCoreSource).toMatch(/self\.addEventListener\("fetch"/);
        expect(swCoreSource).not.toMatch(/addEventListener\(\s*["']sync["']/);
    });

    it("le worker ne parle plus au store `sync_queue`", () => {
        // `getSyncQueue` / `removeSyncItem` lisaient et écrivaient la file depuis le worker,
        // avec une forme d'entrée que `SyncDB` n'écrit pas. Elles partent avec l'écouteur.
        expect(swCoreSource).toMatch(/objectStore\(/); // témoin : il parle encore à IndexedDB
        expect(swCoreSource).not.toMatch(/["']sync_queue["']/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// Tâche 3.5 — ce qui doit SURVIVRE à un déploiement y survit, et par son NOM
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("3.5 — garde de source du nommage des caches", () => {
    it("`CACHE_TILES` ne porte AUCUNE version — c'est ce qui le fait survivre", () => {
        // 🛑 La garde qui compte. `activate` ne rase pas « à chaque version » mais À CHAQUE
        // BUILD : `build-deploy.cjs` suffixe `CACHE_VERSION` d'un `Date.now()`, et son
        // commentaire l'assume (« purges old caches on every build »). Mesuré : trois
        // horodatages différents pour un seul `build:deploy` sur quatre variantes.
        //
        // Tant que le nom du cache de tuiles ne contient pas la version, il ne peut pas
        // entrer dans le prédicat de purge. Remettre `${CACHE_VERSION}-tiles` fait rougir.
        const decl = swCoreSource.match(/const CACHE_TILES = ([^;]+);/);
        expect(decl).not.toBeNull();
        expect(decl[1]).not.toMatch(/CACHE_VERSION/);
        expect(decl[1]).toMatch(/geoleaf-data-/);
    });

    it("le prédicat de purge teste `geoleaf-v`, pas `geoleaf-`", () => {
        // Un seul caractère sépare « je purge le build » de « je rase le travail de terrain ».
        const activate = swCoreSource.slice(
            swCoreSource.indexOf('addEventListener("activate"'),
            swCoreSource.indexOf('addEventListener("fetch"')
        );
        expect(activate).toMatch(/startsWith\("geoleaf-v"\)/);
        expect(activate).not.toMatch(/startsWith\("geoleaf-"\)/);
    });
});
