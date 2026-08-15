/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/* eslint-disable no-console */ // Service Worker context — Log module unavailable, console is required
/* global true */ // build-time constant injected by Rollup replace plugin
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
 * @version 3.0.0
 */

"use strict";

// true is a build-time constant — injected as a plain boolean by Rollup.
// In production all SW console.log calls are removed at build time via terser.
const _SW_DEBUG = typeof true !== "undefined" ? true : false;

// ═══════════════════════════════════════════════════════════════════════════════════════
// NOMMAGE DES CACHES — la survie à un déploiement est portée par le CONSTRUCTEUR DE NOM,
// jamais par une liste d'exceptions (tâche 3.5).
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 🛑 CE QUE `activate` FAIT VRAIMENT, mesuré : il ne rase pas « à chaque montée de version »,
// il rase À CHAQUE BUILD. `scripts/build-deploy.cjs` suffixe `CACHE_VERSION` d'un
// `Date.now()` — et le commentaire y dit explicitement « so the SW purges old caches on every
// build ». Relevé sur les quatre variantes déployées : TROIS horodatages différents pour un
// seul `build:deploy`. Déployer pendant une campagne de terrain rasait donc le fond de carte
// téléchargé, sans qu'aucune version n'ait changé.
//
// L'intention est juste pour le STATIQUE — du code re-téléchargeable depuis le serveur que
// l'utilisateur vient forcément d'atteindre. Elle est fausse pour ce que l'UTILISATEUR a
// délibérément mis en cache.
//
// LA RÈGLE : un cache survit PARCE QUE SON NOM NE PORTE PAS DE VERSION, et il n'en porte pas
// parce que son contenu appartient à l'utilisateur et non au build. Aucun nom n'est écrit deux
// fois, il n'y a pas de liste à tenir à jour, et un futur cache durable survit par
// construction — il suffit de le nommer `geoleaf-data-*`.
const CACHE_VERSION = "geoleaf-v3.0.0-1c345dcd5f87";

/** Purgeable : du code, re-téléchargeable. */
const CACHE_STATIC = `${CACHE_VERSION}-static`;
/** Purgeable : des ressources de profil, re-téléchargeables. */
const CACHE_PROFILE_PREFIX = `${CACHE_VERSION}-profile-`;
/**
 * DURABLE — pas de version dans le nom, délibérément.
 *
 * C'est le fond de carte que l'utilisateur a téléchargé pour aller sur le terrain. Le
 * re-télécharger suppose un réseau qu'il n'a précisément pas.
 *
 * ⚠️ Renommé en 3.5. Aucune clause transitoire n'accompagne ce renommage, et c'est la
 * décision **A16** qui le permet : l'application n'a pas d'utilisateurs, donc aucun appareil
 * ne porte l'ancien nom `${CACHE_VERSION}-tiles`. Au premier déploiement terrain, un
 * renommage de cache durable exigera un pont — pas maintenant.
 */
const CACHE_TILES = "geoleaf-data-tiles";
const CACHE_RUNTIME = `${CACHE_VERSION}-runtime`;

// ═══════════════════════════════════════════════════════════════════════════════════════
// BORNAGE DU CACHE DE TUILES (tâches 1.2 / 1.3 / 1.4) — une garde de PERTE DE DONNÉES
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 🛑 CE N'EST PAS UN SUJET DE PERFORMANCE. Les navigateurs évincent par ORIGINE, jamais par
// magasin. IndexedDB est borné (`maxCacheBytes`, éviction LRU, un événement) et porte `outbox`
// et `features` — des saisies terrain qui n'ont AUCUNE autre copie. `CACHE_TILES` n'était
// borné par rien. Sous pression disque, un cache de tuiles libre de grossir peut donc faire
// évincer l'origine ENTIÈRE, saisies non synchronisées comprises.
//
// ⚠️ Et la persistance ne répond pas à l'objection. Mesuré à la tâche 1.1, deux verdicts
// OPPOSÉS sur la même origine : `persist()` REFUSÉ en Chromium headless sur profil neuf
// (~800 Mo de quota), ACCORDÉ en Chrome réel (~10 Go). Elle dépend de l'engagement de
// l'utilisateur avec l'ORIGINE, pas d'une propriété de l'application — un appareil de terrain
// qui ouvre une origine de production pour la première fois démarre en `bestEffort`.
//
// ⚠️ POURQUOI UN COMPTE ET PAS DES OCTETS. La Cache API n'expose la taille d'aucune entrée, et
// `estimate()` mesure toute l'origine et non un magasin. Le compte est le seul bornage
// portable et bon marché ; `estimate()` sert d'ÉCHAPPATOIRE. L'équivalence en octets est
// écrite au CDC (`specs/capacites/offline.md` §Arbitrage du stockage) et NULLE PART AILLEURS —
// la recopier ici ferait deux vérités qui divergent.

/**
 * Plafond de REPLI, en nombre d'entrées, quand aucun profil n'en publie.
 *
 * ⚠️ Le repli BORNE, il n'ouvre pas : un déploiement core-only n'a pas de base à lire, et
 * « pas de valeur lue » ne doit jamais vouloir dire « pas de limite ». L'équivalence en octets
 * (mesurée, et DISPERSÉE d'un facteur 10) est écrite au CDC, pas ici.
 *
 * ⚠️ Littéral MIROIR du défaut de `modules.offline.cache.maxTileCacheEntries`
 * (`capabilities/offline/offline-capability.ts`). `config-schema-coverage.test.js` vérifie que
 * les deux disent le même nombre — le worker ne peut pas importer le schéma.
 */
const TILE_CACHE_MAX_ENTRIES = 2000;

/**
 * Clé du store `preferences` où le moteur publie le plafond.
 *
 * ⚠️ Littéral PARTAGÉ avec `capabilities/offline/tile-budget.ts`, qui ne peut pas être importé
 * ici — ce fichier est copié tel quel, sans bundler. Une garde de source vérifie que les deux
 * disent la même chose.
 */
const TILE_BUDGET_KEY = "offline.tileCacheMaxEntries";

/** Marge basse du trim FIFO : on déclenche AU plafond, on redescend à cette fraction. */
const TILE_CACHE_TRIM_RATIO = 0.8;

/** Part du quota d'ORIGINE au-delà de laquelle le trim cesse d'être de routine. */
const TILE_CACHE_PRESSURE_RATIO = 0.8;

/** Cible du trim sous pression — délibérément bien plus basse que le plafond nominal. */
const TILE_CACHE_PRESSURE_TRIM_TO = 400;

/**
 * Amortissement : `cache.keys()` est en O(n), on ne le paie pas à chaque tuile.
 *
 * ⚠️ Le compteur DÉMARRE à cette valeur, donc le premier `put` du worker vérifie. Ce n'est pas
 * un détail : le navigateur redémarre le worker quand il veut, et un worker qui attendrait 50
 * tuiles avant de regarder laisserait vivre un cache déjà dix fois trop plein.
 */
const TILE_CACHE_CHECK_EVERY = 50;

/** Plafond mémoïsé. `null` = pas encore lu. */
let _tileMaxEntries = null;

/** Puts de tuile depuis le dernier contrôle — voir {@link TILE_CACHE_CHECK_EVERY}. */
let _tilePutsSinceCheck = TILE_CACHE_CHECK_EVERY;

// Core assets to pre-cache — injected by build-deploy.cjs at build time
const STATIC_ASSETS = ["index.html", "icons/fav.png", "manifest.json", "icons/icon-192.png", "dist/geoleaf-main.min.css", "dist/chunks/geoleaf-chunk-core-utils-Di5sqeKk.js", "dist/chunks/geoleaf-chunk-geojson-B04mENVK.js", "dist/chunks/geoleaf-chunk-ui-controls-N1sJP3MI.js", "profiles/geoleaf.config.json", "vendor/maplibre-gl/maplibre-gl.css", "vendor/maplibre-gl/global.mjs", "dist/geoleaf.esm.js?v=7fe19134", "dist/geoleaf-offline-ui.plugin.js?v=47066607", "init.js", "vendor/maplibre-gl/maplibre-gl-shared.mjs", "vendor/maplibre-gl/maplibre-gl-worker.mjs", "vendor/maplibre-gl/maplibre-gl.mjs"];

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
                    // 🛑 PAS de `cache: "reload"` (S5.7). Il forçait le pré-cache à REFETCHER
                    // sur le réseau, en contournant le cache HTTP, tout ce que la page venait
                    // exactement de télécharger : ~257 Ko gz redemandés au serveur alors qu'ils
                    // étaient déjà en mémoire du navigateur, pendant que les tuiles chargeaient.
                    //
                    // La fraîcheur ne repose pas là-dessus, et ne l'a jamais fait : chaque
                    // déploiement change `CACHE_VERSION`, donc `activate` purge la famille
                    // `geoleaf-v*` et cette install repart d'un cache vide. Un asset périmé ne
                    // peut survivre à ce cycle. `reload` n'achetait donc pas de la fraîcheur,
                    // il achetait un second téléchargement.
                    //
                    // ⚠️ `addAll` reste TOUT-OU-RIEN : un seul 404 rejette le lot entier. C'est
                    // le motif de la bijection posée en S3 (`lib/boot-assets.cjs`) — chaque
                    // entrée dérivée doit avoir un fichier derrière, et la dérivation lève sinon.
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
                        // Seuls les caches VERSIONNÉS sont purgeables, et seulement ceux d'une
                        // AUTRE version que la nôtre. `geoleaf-data-*` n'est pas versionné,
                        // donc il ne peut pas entrer ici — c'est un fait de nommage, pas une
                        // exception listée. Le préfixe testé est `geoleaf-v` et non
                        // `geoleaf-`, et c'est toute la différence.
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

    // 🛑 FILTRE DE MÉTHODE — en tête, avant toute autre décision (tâche 3.7).
    //
    // Le gestionnaire ne testait JAMAIS `request.method`. Chaque écriture — POST, PUT,
    // DELETE, y compris les envois de POI vers le serveur — tombait donc dans la stratégie
    // réseau-d'abord, qui tente un `cache.put`. La Cache API REJETTE toute requête non-GET,
    // et ce rejet partait dans un `.catch(() => {})` vide : une promesse rejetée par
    // conception, avalée à chaque écriture.
    //
    // Sortir sans `respondWith` laisse le navigateur traiter la requête normalement. C'est
    // exactement ce qu'on veut : le worker n'a rien à dire sur une écriture.
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // ⚠️ La blacklist ne porte plus `/api/` (tâche 3.9). Elle exclut désormais ce qui n'est
    // PAS de l'HTTP applicatif (`chrome-extension:`) et les chemins réservés — pas une
    // convention d'URL. `/api/` était une exclusion en aveugle qui sautait le chemin le plus
    // courant d'une API de données, c'est-à-dire exactement le trafic dont dépend un
    // déploiement de terrain. Ce qui décide désormais, c'est la DÉCLARATION.
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

    // 🛑 ROUTAGE PAR DÉCLARATION (tâche 3.9) — il PRÉCÈDE toute heuristique.
    //
    // Une origine déclarée décide d'elle-même : ses `roles` disent ce qu'elle sert, son
    // `cacheable` dit si on a le droit de la garder. Une origine déclarée NON cachable — un
    // fournisseur de tuiles qui répond en opaque, une API authentifiée — passe au réseau sans
    // qu'aucune stratégie ne s'en mêle. C'est une décision REVUE, pas devinée.
    //
    // ⚠️ Ce qui suit ne s'exécute que si RIEN n'est déclaré. Les heuristiques restantes sont
    // donc un chemin d'AMORÇAGE, pas le régime nominal — et un profil qui déclare ses origines
    // ne les emprunte jamais. Elles disparaissent avec la tâche 4.x qui rendra la déclaration
    // obligatoire ; les garder muettes aujourd'hui casserait tout profil non encore migré.
    event.respondWith(routeRequest(request, url));
});

/**
 * Choisit la stratégie : par DÉCLARATION d'abord, par heuristique d'amorçage ensuite.
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
            // 🛑 TÂCHE 8.2 / B-119 — L'APPLICATION ELLE-MÊME N'EST PAS DÉCLARABLE.
            //
            // Déclarer une origine désactive le cache de toutes les autres. Or l'origine qui
            // SERT l'application change à chaque déploiement — `localhost:8766` en cible
            // `ports`, `demo.geoleaf.local.test` sous nginx, la production ailleurs — donc
            // aucun profil PORTABLE ne peut l'écrire. Conséquence mesurée avant ce correctif :
            // un profil qui déclarait ses origines de données perdait le cache de sa propre
            // coquille, c'est-à-dire le hors-ligne tout entier. Tout-ou-rien, et le « rien »
            // n'était atteignable qu'en renonçant à déclarer quoi que ce soit.
            //
            // ⚠️ LA PERMISSION EST ÉTROITE, ET C'EST LE CŒUR DE L'ARBITRAGE. Elle ne couvre
            // pas « la même origine », elle couvre CE QUI SERT L'APPLICATION : ses ressources
            // de profil et ses fichiers statiques. Une API de données servie depuis la même
            // origine reste une origine de DONNÉES — le motif même de la voie 1 le dit — et
            // elle se DÉCLARE, comme n'importe quelle autre. Sans ce resserrage, une réponse
            // authentifiée same-origin serait mise en cache par défaut : on aurait ouvert
            // B-120 en fermant B-119.
            //
            // 🛑 L'INVARIANT N'EST DONC PAS AFFAIBLI, IL EST DÉLIMITÉ : le silence d'une
            // déclaration refuse le cache des DONNÉES ; la coquille applicative n'est pas une
            // donnée. C'est le principe que `isStaticAsset` porte déjà quelques lignes plus
            // bas — « statique ne veut rien dire hors de notre propre origine : ce qui est à
            // nous est déployé avec nous et versionné avec nous ». On le généralise, on ne
            // l'introduit pas.
            if (url.origin === self.location.origin) {
                // B-236 — EN PREMIER : ce qu'`install` a écrit dans `CACHE_STATIC` s'y relit,
                // sans repasser par une seconde dérivation du périmètre.
                if (isPrecachedAsset(url)) return cacheFirstStrategy(request, CACHE_STATIC);
                if (isProfileResource(url)) {
                    return cacheFirstStrategy(request, getCacheNameForProfile(url));
                }
                if (isStaticAsset(url)) return cacheFirstStrategy(request, CACHE_STATIC);
            }
            // Origine NON déclarée dans un profil qui déclare : on ne met rien en cache. Le
            // silence d'une déclaration est un refus, pas une permission.
            return fetchBounded(request);
        }
        if (!declared.cacheable) {
            // Déclarée et explicitement non cachable — le cas de l'API authentifiée et du
            // fournisseur opaque. Réseau direct, jamais de copie.
            return fetchBounded(request);
        }
        if (declared.roles.includes("tiles")) return tileCacheStrategy(request);
        if (declared.roles.includes("layerData") || declared.roles.includes("sprites")) {
            return cacheFirstStrategy(request, getCacheNameForProfile(url));
        }
        if (declared.roles.includes("glyphs")) return cacheFirstStrategy(request, CACHE_STATIC);
        return networkFirstStrategy(request, CACHE_RUNTIME);
    }

    // ── Amorçage : aucun profil n'a encore déclaré ses origines ───────────────────────────
    return legacyRoute(request, url);
}

/**
 * Routage HISTORIQUE, par heuristique. Conservé UNIQUEMENT pour les profils qui ne déclarent
 * pas encore leurs origines — voir `routeRequest`.
 *
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<Response>}
 */
function legacyRoute(request, url) {
    // B-236 — même geste que sur la route déclarée, et EN PREMIER pour la même raison. Les
    // DEUX sites portaient le défaut ; n'en corriger qu'un l'aurait laissé vivant pour tout
    // profil qui ne déclare pas ses origines, c'est-à-dire sur le chemin le plus courant.
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

    // 🛑 ET SON ORIGINE (tâche 3.13). Le contrôle ci-dessus ne teste que le TYPE de la
    // source, jamais d'où elle vient. L'effet est borné par construction — un worker ne
    // reçoit de messages que de clients de son propre scope, donc de sa propre origine — mais
    // « borné par construction » est un raisonnement, pas une vérification : il repose
    // entièrement sur une propriété du navigateur qu'aucune ligne d'ici n'affirme.
    //
    // Ce que ça coûte : rien. Ce que ça achète : `CLEAR_CACHE` est destructeur, et le jour où
    // un scope s'élargit, où un `client.postMessage` transite autrement, ou simplement où
    // quelqu'un relit ce fichier pour savoir qui a le droit de vider le cache, la réponse est
    // écrite ici au lieu d'être déduite.
    //
    // ⚠️ `event.origin` est vide pour un message de client same-origin dans certains
    // navigateurs : on le refuse seulement s'il est RENSEIGNÉ et différent. Traiter une chaîne
    // vide comme une origine étrangère rendrait la garde bloquante partout — une garde qui
    // refuse tout ne garde pas mieux, elle casse.
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
                            // ⚠️ ASYMÉTRIE DÉLIBÉRÉE AVEC `activate`, et elle est le sujet.
                            //
                            // `activate` ne purge que les caches VERSIONNÉS d'une autre
                            // version : il nettoie après le BUILD, et n'a aucun mandat sur ce
                            // que l'utilisateur a téléchargé.
                            //
                            // `CLEAR_CACHE` est ce même utilisateur qui DEMANDE de vider. Le
                            // préfixe est donc `geoleaf-` et non `geoleaf-v` : le cache
                            // durable est inclus, sinon le bouton mentirait sur ce qu'il fait.
                            //
                            // 🛑 Sans ce changement, dé-versionner `CACHE_TILES` (3.5) aurait
                            // rendu le fond de carte INEFFAÇABLE — un cache que rien ne purge
                            // plus, ni le déploiement ni l'utilisateur.
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
// PAS DE BACKGROUND SYNC — ET C'EST UNE DÉCISION, PAS UN OUBLI
// ═══════════════════════════════════════════════
//
// 🛑 Un écouteur `sync` a vécu ici jusqu'à la tâche 3.13, avec `syncProfile()`,
// `getSyncQueue()` et `removeSyncItem()` derrière lui — environ 75 lignes que RIEN ne
// déclenchait : il n'existe aucun `registration.sync.register(...)` dans le dépôt, et il n'y
// en a jamais eu. Un écouteur sans émetteur n'est pas du code inactif, c'est du code qui MENT
// sur ce que le produit fait.
//
// Et le retrait n'est pas qu'un ménage : le point 5 du contrat de synchronisation
// (`contracts/sync.contract.ts`) fige que **le rejeu tourne sur la PAGE, pas dans le worker**.
// Le motif est mécanique — l'authentification du connector patche le `fetch` DE LA PAGE et
// n'atteint jamais le worker, donc un rejeu depuis le SW partirait sans jeton. Le contrat dit
// « le chemin Background Sync est SUPPRIMÉ, pas laissé mort » : voilà.
//
// ⚠️ Le rétablir un jour ne serait pas « rebrancher un écouteur » : il faudrait d'abord
// résoudre l'authentification côté worker. Écrit ici pour que la question se repose entière.

// ═══════════════════════════════════════════════
// CACHING STRATEGIES
// ═══════════════════════════════════════════════

/**
 * Cache-First with stale-while-revalidate.
 * Serves from cache immediately, updates in the background.
 */
/**
 * Cette réponse a-t-elle le droit d'entrer en cache ? (tâche 3.11)
 *
 * 🛑 LE TROU FONCTIONNEL ⑤, ET IL N'ÉTAIT PAS OÙ ON LE CROYAIT. Les quatre stratégies
 * gardaient sur `status === 200`. Une réponse OPAQUE — celle que rend une requête
 * cross-origin sans CORS, c'est-à-dire la quasi-totalité des fournisseurs de tuiles raster —
 * porte `status: 0`. Elle était donc écartée, silencieusement, et **aucun fond raster n'est
 * hors-ligne aujourd'hui**.
 *
 * ⚠️ NE PAS CACHER UNE OPAQUE EST JUSTE, et ce correctif ne change pas cette décision :
 *   - son contenu est **invérifiable** — on ne peut ni lire son statut, ni ses en-têtes, ni
 *     distinguer une tuile d'une page d'erreur ou d'une redirection de portail captif ;
 *   - elle coûte au quota bien plus que sa taille (le navigateur la rembourre, jusqu'à
 *     plusieurs centaines de kilo-octets par entrée), donc quelques centaines de tuiles
 *     suffisent à faire évincer du travail de terrain.
 *
 * **Ce qui n'était pas juste, c'est de ne pas le DIRE.** Un intégrateur qui déclare une
 * origine `cacheable: true` et n'obtient aucun cache n'avait aucun moyen de comprendre
 * pourquoi. La contradiction est désormais journalisée, une fois par origine.
 *
 * ── TÂCHE 8.3 / B-120 — DEUX REFUS DE PLUS, ET ILS NE DÉPENDENT D'AUCUNE DÉCLARATION ──
 *
 * 🛑 Cette fonction ne regardait que « pas opaque, statut 200 ». Conséquence sur le chemin
 * d'AMORÇAGE — celui de tous les profils livrés, puisque aucun ne déclare ses origines : une
 * URL de rapatriement `…/collections/<id>/items?limit=…` ne matche aucune heuristique, tombe
 * sur `networkFirstStrategy(request, CACHE_RUNTIME)`, et **toute** réponse à 200 y entrait —
 * y compris une réponse AUTHENTIFIÉE, dans un cache PARTAGÉ, sur un appareil de terrain
 * lui-même partagé. Le connector patche le `fetch` de la page, donc le jeton est bien sur la
 * requête que le worker voit.
 *
 * ⚠️ **La tâche 8.2 ne fermait pas cette classe.** Elle protège le profil qui DÉCLARE ses
 * origines : `publishDataOrigins` force `cacheable: false` sur toute origine `authenticated`.
 * Le chemin d'amorçage n'atteint jamais cette règle. Les deux refus ci-dessous valent **quelle
 * que soit la déclaration** — c'est ce qui les rend utiles, et c'est pourquoi ils vivent ici
 * plutôt que dans `routeRequest`.
 *
 * ⚠️ Ils tiennent aussi à un niveau que la déclaration ne peut pas atteindre : une origine
 * peut être déclarée cachable **en toute bonne foi** et servir, sur un seul chemin, une
 * réponse authentifiée. La déclaration porte sur l'ORIGINE, l'identifiant sur la REQUÊTE.
 *
 * @param {Response} response
 * @param {Request|string} request - Requête d'origine (ou son URL, forme héritée).
 * @returns {boolean} `true` si la réponse peut être mise en cache.
 */
function isCacheableResponse(response, request) {
    if (!response) return false;
    const url = typeof request === "string" ? request : request?.url;

    if (response.type === "opaque" || response.status === 0) {
        _warnOpaqueOnce(url);
        return false;
    }
    // Une réponse partielle (206) ne vaut pas la ressource : la remettre en cache
    // servirait un fragment comme s'il était le tout.
    if (response.status !== 200) return false;

    // La requête porte des identifiants → sa réponse n'appartient à personne d'autre.
    if (carriesCredentials(request)) return false;

    // Le serveur refuse le cache partagé → on l'honore. `no-store` interdit tout stockage ;
    // `private` vise EXACTEMENT le cache partagé, ce qu'est celui d'un Service Worker.
    if (refusesSharedCache(response)) return false;

    return true;
}

/**
 * La requête porte-t-elle des identifiants ?
 *
 * Deux signaux, et il en faut deux : un jeton porté par un en-tête `Authorization` (ce que
 * pose le connector), et `credentials: "include"`, qui joint les cookies sans qu'aucun
 * en-tête ne le dise. Ne regarder que le premier laisserait passer toute API à session.
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
 * La réponse interdit-elle le cache PARTAGÉ ?
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

/** Origines déjà signalées — une contradiction se dit UNE fois, pas à chaque tuile. */
const _opaqueWarned = new Set();

/**
 * Journalise, une seule fois par origine, qu'une réponse opaque n'a pas pu être cachée.
 *
 * ⚠️ Le message change selon que l'origine est DÉCLARÉE cachable ou non : déclarée, c'est une
 * contradiction que l'intégrateur doit corriger (ou accepter en connaissance de cause) ; non
 * déclarée, c'est simplement le régime normal d'un tiers sans CORS.
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
// LE BORNAGE — lire le plafond, tailler, dire ce qu'on a taillé
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Lit le plafond publié par le profil, une fois, puis le garde en mémoire.
 *
 * Calqué sur {@link loadDataOrigins} — même store, même mémoïsation, même motif : un message
 * meurt avec le worker, une préférence survit.
 *
 * ⚠️ Un plafond ABSENT rend le repli, jamais l'infini. `0`, lui, est une valeur SIGNIFIANTE
 * (bornage désactivé) et n'est donc pas filtré avec les rebuts.
 *
 * @returns {Promise<number>} Le plafond en nombre d'entrées.
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
 * Lit la pression du quota d'ORIGINE.
 *
 * ⚠️ Le vocabulaire de clés est celui de `CacheManager.getStorageQuota()` — `usage` / `quota`,
 * jamais `used`. Ce n'est pas de la cosmétique : la capacité hors-ligne a porté TROIS
 * enveloppements de `estimate()` avec trois vocabulaires différents, et un appelant qui se
 * trompait d'exemplaire lisait `undefined` sans que rien ne le dise. Deux ont été retirés à la
 * clôture S3c ; celui-ci ne peut pas importer le survivant (aucun bundler ici), alors il en
 * reprend au moins la forme.
 *
 * @returns {Promise<number|null>} Part du quota consommée (0–1), ou `null` si non mesurable.
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
 * Retire les entrées les plus ANCIENNES du magasin jusqu'à `target`, si `trigger` est dépassé.
 *
 * FIFO par nombre d'entrées : `cache.keys()` rend l'ordre d'insertion, la tête est donc la plus
 * ancienne. C'est une approximation de LRU — la Cache API n'expose aucune date d'accès — et
 * elle suffit ici parce que tout ce que porte ce magasin est re-téléchargeable.
 *
 * 🛑 CE QU'IL NE PEUT PAS ÉVINCER, ET C'EST STRUCTUREL : ce magasin n'a qu'un écrivain,
 * l'étape opportuniste de {@link tileCacheStrategy}. Ce que l'utilisateur a EXPLICITEMENT
 * demandé à télécharger part en IndexedDB via le `Downloader`, jamais ici. Un trim ne peut donc
 * pas emporter une zone préparée pour le terrain.
 *
 * @param {Cache} cache
 * @param {number} trigger Au-dessus de ce compte, on taille.
 * @param {number} target Compte visé après la taille.
 * @returns {Promise<{evicted: number, totalBefore: number, totalAfter: number}>} La forme
 *   d'`EvictionResult` (`capabilities/offline/db/eviction.ts`), **moins `freedBytes`** : la
 *   Cache API ne donne pas la taille d'une entrée, et fabriquer un nombre serait pire que se
 *   taire.
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
    // Le compte rendu est celui des suppressions RÉELLES, pas des tentatives : une éviction
    // qu'on annonce sans l'avoir faite est exactement ce que cette tâche corrige ailleurs.
    const evicted = outcomes.filter(Boolean).length;
    return { evicted, totalBefore, totalAfter: totalBefore - evicted };
}

/**
 * Dit qu'une éviction a eu lieu — à la console toujours, aux clients seulement quand ça compte.
 *
 * ⚠️ LE TRIM DE ROUTINE NE REMONTE PAS, ET C'EST LE POINT. Il tourne à chaque panoramique
 * soutenu ; un toast par déplacement de carte apprend à l'utilisateur à ne plus lire les
 * notifications, ce qui coûte précisément l'avertissement qu'on veut pouvoir donner le jour où
 * la place manque vraiment.
 *
 * Le détail reprend la forme d'`EvictionResult` et le nom d'événement `geoleaf:cache:evicted` :
 * `sw-register.ts` le re-diffuse sur `document`, où l'écouteur d'`offline-ui` l'affiche déjà.
 *
 * @param {{evicted: number, totalBefore: number, totalAfter: number}} result
 * @param {"fifo"|"pressure"|"quota"} reason
 */
function _notifyEvicted(result, reason) {
    const line =
        `[SW] Cache de tuiles borné (${reason}) — ${result.evicted} entrée(s) retirée(s), ` +
        `${result.totalBefore} → ${result.totalAfter}.`;

    if (reason === "fifo") {
        // ⚠️ `_SW_DEBUG` et non `warn`, contrairement aux deux autres. Un trim de routine n'est
        // pas un incident : c'est le régime nominal d'un cache borné, et il tourne à chaque
        // panoramique soutenu. L'annoncer en avertissement noierait ceux qui en sont vraiment,
        // et terser retire ces appels du bundle de production. Même partage que
        // `_warnOpaqueOnce`, qui n'élève la voix que pour la contradiction.
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
                // Un client parti entre le `matchAll` et le `postMessage` n'est pas un défaut.
            });
    } catch (_e) {
        /* `clients` absent (contexte de test, worker en cours d'arrêt) — sans conséquence. */
    }
}

/**
 * Contrôle amorti du magasin de tuiles, appelé après une écriture réussie.
 *
 * Deux régimes : sous pression d'origine on taille AGRESSIVEMENT et on le dit ; sinon on
 * ramène simplement au plafond. Le premier est correct parce que sous pression la bonne classe
 * à sacrifier est la re-téléchargeable — c'est la distinction `lru` / `never` du CDC, appliquée
 * à la Cache API.
 *
 * @param {Cache} cache Le magasin de tuiles, déjà ouvert.
 */
async function _maybeTrimTiles(cache) {
    if (++_tilePutsSinceCheck < TILE_CACHE_CHECK_EVERY) return;
    _tilePutsSinceCheck = 0;

    try {
        const max = await loadTileMaxEntries();
        if (max <= 0) return; // `0` = bornage explicitement désactivé par le profil.

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
        // Journalisé et non avalé : un bornage qui échoue en silence est indiscernable d'un
        // bornage qui n'existe pas, et c'est l'état dont cette tâche sort.
        console.warn("[SW] Contrôle du cache de tuiles impossible:", error);
    }
}

/**
 * Le refus vient-il du QUOTA, ou d'autre chose ?
 *
 * Trois formes selon les moteurs : le nom standard, le code hérité de `DOMException`, et celui
 * de Gecko. Les confondre avec le reste est exactement ce que les quatre `.catch(() => {})`
 * faisaient — un dépassement de quota avalé comme une requête non-GET.
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
 * Écrit en cache — POINT DE DÉCISION UNIQUE pour les quatre stratégies.
 *
 * 🛑 CE QUE ÇA REMPLACE. Les quatre sites faisaient `cache.put(…).catch(() => {})` : un
 * dépassement de quota y était avalé exactement comme une requête non-GET. Le worker ne pouvait
 * donc pas savoir qu'il était plein, ni rien faire de cette information. Même geste que la
 * tâche 3.11, qui a réuni les quatre gardes de cachabilité en un seul endroit.
 *
 * Sur quota : on rend de la place dans la classe RE-TÉLÉCHARGEABLE — les tuiles — quel que soit
 * le magasin qui a débordé, puis **un seul** retry. Rien libéré ⟹ pas de retry : il échouerait
 * pour la même raison, et une boucle sur un disque plein est un gel, pas une résilience.
 *
 * ⚠️ LE CLONE EST PRIS AVANT LE PREMIER `put`, et ce n'est pas de la prudence. Un corps de
 * `Response` ne se consomme qu'une fois, et `cache.put` le consomme. Réessayer avec le même
 * objet échoue en « body already used » — le trim aurait tourné pour rien, et le correctif
 * serait sorti vert en ne réparant rien.
 *
 * @param {Cache} cache
 * @param {Request} request
 * @param {Response} response
 * @returns {Promise<boolean>} `true` si la réponse est en cache. Ne rejette jamais : trois des
 *   quatre appelants sont en fire-and-forget.
 */
async function cachePut(cache, request, response) {
    // Pris AVANT le premier `put`, jamais après : le corps sera consommé.
    let spare = null;
    try {
        spare = response.clone();
    } catch (_e) {
        // Corps déjà consommé, ou réponse non clonable : il n'y aura pas de retry, et
        // `spare` vaut déjà `null`. Le réassigner ici serait une écriture sans lecteur.
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
            // ⚠️ `max === 0` — bornage désactivé par le profil — NE DÉSARME PAS ce chemin, et
            // c'est un choix. « Pas de plafond » dit de ne pas tailler *préventivement* ; ici
            // le navigateur vient de REFUSER une écriture. Honorer le `0` reviendrait à ne
            // plus rien mettre en cache du tout, indéfiniment, sur un appareil plein — soit
            // exactement le chemin de perte que ce sprint ferme. On récupère donc dans la
            // classe re-téléchargeable, et on le DIT (`reason: "quota"`).
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
        // 🛑 BORNÉ, et c'est le site que le détecteur de la roadmap NE POUVAIT PAS VOIR : sa
        // forme ne cherchait que `await fetch(`, `= fetch(` et `return fetch(`. Un appel
        // fire-and-forget n'est aucun des trois. Le chiffre « ≥ 14 » sous-comptait donc pour
        // une raison de FORME, pas d'inattention — trouvé par la garde de non-régression, qui
        // scanne les lignes au lieu de chercher trois patrons.
        //
        // Une revalidation d'arrière-plan qui pend est le pire cas : personne ne l'attend,
        // donc personne ne voit qu'elle retient une connexion.
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
// ORIGINES DE DONNÉES DÉCLARÉES (tâche 3.9) — router sur une DÉCLARATION, pas sur une devinette
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Clé du store `preferences` où le moteur publie les déclarations.
 *
 * ⚠️ Littéral PARTAGÉ avec `capabilities/offline/data-origins.ts`, qui ne peut pas être
 * importé ici — ce fichier est copié tel quel, sans bundler. Une garde de source vérifie que
 * les deux disent la même chose ; sans elle, une divergence sortirait silencieusement verte,
 * exactement comme la version de base l'a fait pendant des mois.
 */
const DATA_ORIGINS_KEY = "offline.dataOrigins";

/** Déclarations mémoïsées. `null` = pas encore lues ; `[]` = lues et vides (un REFUS). */
let _dataOrigins = null;

/**
 * Lit les déclarations depuis IndexedDB, une fois, puis les garde en mémoire.
 *
 * ⚠️ Par IndexedDB et non par `postMessage` : un message est perdu à chaque redémarrage du
 * worker, et le navigateur le redémarre quand il veut — laissant le worker sans déclaration
 * exactement au moment où un appareil de terrain se réveille hors réseau.
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
 * La requête vise-t-elle une origine DÉCLARÉE, dans le rôle demandé ?
 *
 * Comparaison d'ORIGINE stricte — ni `includes`, ni `startsWith`, ni reniflage de chemin.
 * @returns {object|null} la déclaration, ou `null` si l'origine n'est pas déclarée.
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
 * `fetch` BORNÉ — le worker ne peut pas importer, alors il porte le sien (tâche 3.8).
 *
 * 🛑 POURQUOI C'EST LE SITE LE PLUS DANGEREUX DU PÉRIMÈTRE. Ce fichier est copié tel quel
 * dans les variantes de déploiement : il n'a ni bundler ni imports. Ses `fetch` sont sur le
 * chemin critique d'un `FetchEvent` — un serveur lent ne les FAIT PAS ÉCHOUER, il les RETIENT.
 * La ressource ne se résout jamais, la page attend, et il n'y a ni erreur à montrer ni rien à
 * réessayer. Un échec franc est infiniment préférable à une attente sans fin.
 *
 * ⚠️ Il JETTE plutôt que de rendre `null` : chaque stratégie a déjà son `catch` et sait
 * dégrader visiblement — cache, puis placeholder en 504 (bug n° 6). Rendre `null` obligerait
 * chaque appelant à distinguer « pas de réponse » de « réponse vide », ce que personne ne fait.
 *
 * @param {Request|string} request
 * @param {number} [timeoutMs] Délai avant abandon. 10 s par défaut : au-delà, sur le terrain,
 *   l'utilisateur a déjà conclu que ça ne marche pas.
 * @returns {Promise<Response>}
 */
async function fetchBounded(request, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(request, { signal: controller.signal });
    } finally {
        // Le timer se libère MÊME sur rejet : sans ce `finally`, un réseau durablement
        // coupé accumulait un timer par requête tentée.
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
            // 🛑 LE SEUL ÉCRIVAIN DE `CACHE_TILES`, et c'est ce qui rend le trim sûr : ce que
            // l'utilisateur a EXPLICITEMENT demandé à télécharger part en IndexedDB via le
            // `Downloader`, jamais ici. Une éviction ne peut donc pas emporter une zone
            // préparée pour le terrain — c'est une propriété de structure, pas une précaution.
            void cachePut(cache, request, networkResponse.clone()).then((stored) =>
                stored ? _maybeTrimTiles(cache) : undefined
            );
        }
        return networkResponse;
    } catch (_error) {
        // 4. Placeholder tile on total failure.
        //
        // 🛑 BUG n° 6 — ce placeholder partait en statut **200**, donc un ÉCHEC RÉSEAU
        // devenait un SUCCÈS. Pour une tuile raster c'est une image grise à la place d'une
        // image ; pour une tuile VECTORIELLE, MapLibre reçoit un `200` et tente de parser du
        // SVG en protobuf. L'erreur qu'il remonte alors ne parle plus de réseau.
        //
        // Le statut est désormais **504 Gateway Timeout** : le corps reste servi — le
        // placeholder a une valeur d'usage, il dit à l'utilisateur que la tuile manque — mais
        // le statut dit la VÉRITÉ, et tout consommateur qui teste `response.ok` la voit.
        //
        // ⚠️ `Cache-Control: no-store` et non `no-cache` : une réponse d'échec ne doit pas
        // être conservée, même revalidable. Elle n'a aucune valeur au-delà de l'instant.
        return new Response(OFFLINE_TILE_SVG, {
            headers: {
                "Content-Type": "image/svg+xml",
                "Cache-Control": "no-store",
                // Marqueur explicite : le corps est un substitut, pas la ressource demandée.
                "X-GeoLeaf-Placeholder": "tile",
            },
            status: 504,
            // ⚠️ ASCII PUR, et ce n'est pas du style. Un `statusText` non-ASCII fait JETER le
            // constructeur `Response` — le tiret cadratin d'une première rédaction faisait
            // échouer `tileCacheStrategy` DANS son propre catch, et la page recevait un
            // `TypeError: Failed to fetch` au lieu du placeholder. Mesuré le 02/08/2026.
            statusText: "Offline - tile unavailable",
        });
    }
}

// ═══════════════════════════════════════════════
// DETECTION HELPERS
// ═══════════════════════════════════════════════

/**
 * La ressource appartient-elle à UN profil, c'est-à-dire vit-elle SOUS son répertoire ?
 *
 * 🛑 **Le `/` final n'est pas cosmétique, il est le correctif de B-236.** Cette fonction rendait
 * `true` pour tout chemin CONTENANT `/profiles/`, donc aussi pour l'index `geoleaf.config.json`,
 * qui est à la racine de `profiles/` et n'appartient à aucun profil. `getCacheNameForProfile`
 * capturait alors le NOM DE FICHIER comme s'il était un nom de profil et dérivait un seau
 * `…-profile-geoleaf.config.json` — que `cacheFirstStrategy` CRÉE en l'ouvrant, et que rien ne
 * remplit jamais.
 *
 * Conséquence mesurée le 13/08/2026 : le fichier était correctement PRÉ-CACHÉ dans
 * `CACHE_STATIC` (`lib/boot-assets.cjs` l'y inscrit délibérément) et **inatteignable** — la
 * lecture était scopée à un seau vide. Hors ligne, `caches.match()` global le trouvait ;
 * la route, non. L'application ne bootait pas au second chargement, faute de `map.bounds`.
 *
 * ⚠️ **Restreindre ici ne suffit PAS**, et c'est le piège de ce correctif : `isStaticAsset`
 * n'accepte pas `json`, donc l'index retomberait en `networkFirstStrategy(CACHE_RUNTIME)` —
 * autre seau, autre miss, même panne. Voir {@link isProfileShellConfig}, qui est l'autre moitié.
 */
function isProfileResource(url) {
    return /\/profiles\/[^/]+\//.test(url.pathname);
}

/**
 * Clés de {@link STATIC_ASSETS}, résolues comme `install` les a écrites. `null` tant que
 * la première requête ne l'a pas demandé — la liste est injectée au build, pas au chargement.
 */
let _precachedKeys = null;

/**
 * La ressource fait-elle partie du PRÉ-CACHE, tel qu'`install` l'a écrit ?
 *
 * 🛑 **L'AUTRE MOITIÉ DE B-236, ET LA PLUS IMPORTANTE : ce que `install` écrit, `fetch` doit
 * savoir le lire.** Les deux moitiés du worker dérivaient leur périmètre séparément — `install`
 * depuis `STATIC_ASSETS` (dérivée par `lib/boot-assets.cjs`), `fetch` depuis une LISTE
 * D'EXTENSIONS (`isStaticAsset`) qui n'accepte pas `json`. Toute entrée pré-cachée dont
 * l'extension manquait à cette liste était donc écrite dans `CACHE_STATIC` puis cherchée
 * ailleurs — `networkFirstStrategy(CACHE_RUNTIME)` — et introuvable hors ligne.
 *
 * Mesuré le 13/08/2026 par la garde de classe de `e2e/31-offline-second-load.spec.js` :
 * **DEUX** entrées sur 17, `profiles/geoleaf.config.json` et `manifest.json`. La première
 * empêchait l'application de booter au second chargement, faute de `map.bounds`.
 *
 * ⚠️ **Le premier correctif écrit ne traitait que le config**, en restreignant
 * `isProfileResource` et en routant la racine de `profiles/` vers `CACHE_STATIC`. Il aurait
 * laissé `manifest.json` cassé — c'est la garde, et non la relecture, qui l'a dit. D'où cette
 * forme-ci : au lieu de deviner le périmètre une seconde fois, on lit CELUI QUI A SERVI À
 * ÉCRIRE. Une liste d'extensions et une liste d'assets ne peuvent pas diverger si l'une des
 * deux n'existe plus.
 *
 * ⚠️ La base de résolution est `self.location.href`, et ce n'est pas indifférent : c'est
 * exactement celle que `cache.addAll(STATIC_ASSETS)` emploie à l'installation. Résoudre ici
 * depuis une autre base produirait des clés qui ne correspondraient à rien.
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
 * L'hôte appartient-il au domaine `domain`, ou à l'un de ses sous-domaines ?
 *
 * 🛑 REMPLACE `hostname.includes(...)` (tâche 3.7). Une sous-chaîne ne connaît pas les
 * frontières d'un nom d'hôte : `includes("tile")` matchait `mon-site-hostile.tilerie.com`, et
 * `includes("maptiler")` matcherait `maptiler.attaquant.tld`. Le worker routait alors du
 * trafic hostile vers sa stratégie de tuiles, donc vers son cache.
 *
 * ⚠️ Ce durcissement ne fait que rendre le mécanisme ACTUEL honnête. Il ne le remplace pas :
 * la tâche 3.9 substitue à ces listes codées en dur les **origines de données déclarées** du
 * profil. Tant qu'elles ne sont pas là, au moins la comparaison ne ment plus.
 */
function _isHostOf(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

/** Domaines de tuiles VECTORIELLES connus. Provisoire — remplacé par 3.9. */
const _VECTOR_TILE_DOMAINS = ["openfreemap.org", "maptiler.com", "protomaps.com", "versatiles.org"];

function _isVectorTileProvider(hostname) {
    return _VECTOR_TILE_DOMAINS.some((d) => _isHostOf(hostname, d));
}

/**
 * Domaines de tuiles RASTER connus. Provisoire — remplacé par 3.9.
 *
 * ⚠️ `"tile"` a disparu de cette liste, et c'est le point du correctif : ce n'était pas un
 * domaine mais une sous-chaîne, qui acceptait n'importe quel hôte en contenant le mot. Les
 * hôtes réellement visés (`tile.openstreetmap.org`, `c.tile.opentopomap.org`) sont couverts
 * par leur domaine, en sous-domaine.
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
    //    ⚠️ `_isHostOf` et non `includes` (3.7) : ce domaine est CODÉ EN DUR dans le worker,
    //    et une sous-chaîne l'aurait fait matcher `data.geopf.fr.attaquant.tld`. Un domaine
    //    en dur qui se compare mal est doublement fragile. Le codage en dur lui-même est ce
    //    que 3.9 retire, en le remplaçant par les origines déclarées du profil.
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
    // 🛑 CONTRÔLE D'ORIGINE — sans lui, l'extension suffisait (tâche 3.7).
    //
    // La fonction ne testait que le chemin : n'importe quel `.js` de n'importe quel hôte
    // entrait dans le cache STATIQUE, puis était resservi **cache-first** — c'est-à-dire que
    // le cache l'emportait sur le réseau, pour un script tiers, indéfiniment. Un script
    // compromis une seule fois restait servi après sa correction à la source.
    //
    // « Statique » ne veut rien dire hors de notre propre origine : ce qui est à nous est
    // déployé avec nous et versionné avec nous.
    if (url.origin !== self.location.origin) {
        return false;
    }
    // ⚠️ `mjs` compte autant que `js`, et son absence était un PIÈGE À DIAGNOSTIC. Depuis
    // MapLibre 6 le moteur entier est en `.mjs` : sans cette extension il tombait en
    // `networkFirstStrategy(CACHE_RUNTIME)` au lieu du cache statique — donc un premier
    // chargement EN LIGNE remplissait le cache runtime, et le rechargement hors ligne
    // fonctionnait quand même. Le défaut de pré-cache devenait invisible aux tests, y compris
    // à `e2e/31-offline-second-load.spec.js`, qui charge en ligne avant de couper le réseau.
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
 * Bâtit la réponse d'un enregistrement RECONSTRUIT depuis IndexedDB.
 *
 * 🛑 **`no-store`, et ce n'est pas une prudence : c'est le seul en-tête qui dise vrai.**
 * Ces réponses ne viennent pas du réseau, elles sont rebâties depuis la base. Annoncer
 * `max-age=31536000` (tâche 3.7) promettait un an de fraîcheur à un contenu dont **rien** ne
 * garantit la fraîcheur, et faisait garder au navigateur une seconde copie, hors de portée de
 * toute purge du worker. C'est le worker qui détient ce cache, pas le cache HTTP.
 *
 * ⚠️ **La justification de cet en-tête a été corrigée à la tâche 8.8 (compteurs C4 et C5).**
 * Elle était recopiée **trois fois** à l'identique dans la fonction ci-dessous — un bloc de 8
 * lignes par type de charge utile — et elle affirmait que « le TTL qui devait le faire est
 * **calculé, transmis**, puis jeté à l'écriture ». Mesuré : il n'est plus ni calculé ni
 * transmis. `downloader.ts` porte « LE `ttl` A ÉTÉ RETIRÉ D'ICI (tâche 3.13) », et aucun `ttl`
 * ne subsiste nulle part — ni dans le core, ni dans `offline-ui`, ni dans les schémas de
 * profil ; `LayerMetadata` ne déclare que `etag`, `lastModified`, `contentLength`,
 * `contentType` et `resourceType`. **La prose décrivait un producteur supprimé quatre tâches
 * plus tôt**, et la tripler avait triplé le coût de la corriger.
 *
 * @param {BodyInit} body - Le corps déjà décodé.
 * @param {string} contentType - Le type MIME à annoncer.
 * @returns {Response} Une réponse 200, sans `Content-Encoding` (le corps est en clair).
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
