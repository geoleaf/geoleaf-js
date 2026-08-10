/**
 * `routeRequest` — le routage PAR DÉCLARATION du Service Worker (tâches 3.9 et 8.2).
 *
 * 🛑 **Ce routage n'avait AUCUN test.** Mesuré au pré-vol 8.2 : `grep routeRequest|dataOrigins`
 * sur `__tests__/` ne rendait rien. C'est pourtant lui qui décide ce qui entre en cache et ce
 * qui n'y entre pas — la pièce centrale de la tâche 3.9, et la cause opérante de B-119 comme de
 * B-120. Le même angle mort que `resolveProfileLayers` à la tâche 8.9 : la fonction qui porte
 * la décision est celle que personne n'éprouve.
 *
 * Ce que cette suite garde :
 *
 *  1. **L'invariant** — déclarer une origine REFUSE toutes les autres. Le silence d'une
 *     déclaration est un refus, pas une permission.
 *  2. **Son exception, et sa BORNE** — l'origine qui sert l'application est cachable sans
 *     être déclarée, parce qu'elle change à chaque déploiement et qu'aucun profil portable ne
 *     peut l'écrire (B-119). Mais l'exception couvre la COQUILLE, pas la donnée : une API
 *     servie depuis la même origine reste une origine de données et doit se déclarer. Sans
 *     cette borne, une réponse authentifiée same-origin serait mise en cache par défaut —
 *     on aurait ouvert B-120 en fermant B-119.
 *
 * L'observable est `caches.open` : une stratégie de cache l'appelle avec son magasin, un
 * passage réseau direct (`fetchBounded`) ne l'appelle jamais.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const APP_ORIGIN = "https://demo.geoleaf.test";

/** Les origines que le profil déclare, lues par le worker dans IndexedDB. */
type Declared = Array<{ origin: string; roles: string[]; cacheable: boolean }>;

interface Harness {
    fetchHandler: (event: unknown) => void;
    /** Magasins OUVERTS — une stratégie de cache en ouvre un, `fetchBounded` jamais. */
    cacheOpens: string[];
    /**
     * URLs réellement ÉCRITES en cache.
     *
     * ⚠️ Distinct de `cacheOpens`, et la distinction a été trouvée en se trompant :
     * `networkFirstStrategy` ouvre son magasin AVANT de tester la cachabilité de la réponse.
     * Mesurer l'ouverture répond à « une stratégie de cache a-t-elle été choisie », pas à
     * « quelque chose a-t-il été mis en cache ». Les deux questions sont utiles — la première
     * distingue le routage (8.2), la seconde le refus d'écriture (8.3) — mais les confondre
     * fait mesurer un test à côté de ce qu'il énonce.
     */
    cachePuts: string[];
    networkCalls: string[];
}

/**
 * Monte un worker NEUF avec les origines déclarées données.
 *
 * ⚠️ `vi.resetModules()` est porteur : `_dataOrigins` est mémorisé au niveau module (pour ne
 * pas relire IndexedDB à chaque requête), donc deux cas partageant le module partageraient
 * aussi sa déclaration — le second sortirait vert en éprouvant l'état du premier.
 */
async function mountWorker(
    declared: Declared,
    responseHeaders: Record<string, string> = {}
): Promise<Harness> {
    vi.resetModules();
    const cacheOpens: string[] = [];
    const cachePuts: string[] = [];
    const networkCalls: string[] = [];
    const handlers: Record<string, (e: unknown) => void> = {};

    const store = {
        get: (key: string) => {
            const req: Record<string, unknown> = {};
            setTimeout(() => {
                req.result = key === "offline.dataOrigins" ? { value: declared } : null;
                (req.onsuccess as (() => void) | undefined)?.();
            }, 0);
            return req;
        },
    };
    const db = {
        objectStoreNames: { contains: () => true },
        close: () => {},
        transaction: () => ({ objectStore: () => store }),
    };

    vi.stubGlobal("indexedDB", {
        databases: () => Promise.resolve([{ name: "geoleaf-db", version: 3 }]),
        open: () => {
            const req: Record<string, unknown> = {};
            setTimeout(() => {
                req.result = db;
                (req.onsuccess as (() => void) | undefined)?.();
            }, 0);
            return req;
        },
    });
    vi.stubGlobal("caches", {
        open: (name: string) => {
            cacheOpens.push(name);
            return Promise.resolve({
                match: () => Promise.resolve(undefined),
                put: (req: unknown) => {
                    cachePuts.push(
                        typeof req === "string" ? req : String((req as Request)?.url ?? req)
                    );
                    return Promise.resolve();
                },
                keys: () => Promise.resolve([]),
                delete: () => Promise.resolve(true),
            });
        },
        keys: () => Promise.resolve([]),
        delete: () => Promise.resolve(true),
        match: () => Promise.resolve(undefined),
    });
    vi.stubGlobal(
        "fetch",
        vi.fn((input: unknown) => {
            networkCalls.push(typeof input === "string" ? input : String((input as Request).url));
            const hdr = {
                get: (n: string) => responseHeaders[n] ?? responseHeaders[n.toLowerCase()] ?? null,
            };
            return Promise.resolve({
                ok: true,
                status: 200,
                type: "basic",
                headers: hdr,
                clone: () => ({ status: 200, type: "basic", headers: hdr }),
            });
        })
    );
    vi.stubGlobal("self", {
        location: { origin: APP_ORIGIN },
        addEventListener: (name: string, fn: (e: unknown) => void) => {
            handlers[name] = fn;
        },
        skipWaiting: () => Promise.resolve(),
        clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
        registration: { scope: `${APP_ORIGIN}/` },
    });

    await import("../../src/kernel/storage/sw-core.js");
    return { fetchHandler: handlers["fetch"]!, cacheOpens, cachePuts, networkCalls };
}

/** Joue une requête GET et rend la promesse que le worker a passée à `respondWith`. */
async function route(
    h: Harness,
    url: string,
    opts: { headers?: Record<string, string>; credentials?: string } = {}
): Promise<void> {
    let responded: Promise<unknown> | null = null;
    h.fetchHandler({
        request: {
            method: "GET",
            url,
            mode: "cors",
            ...(opts.credentials !== undefined && { credentials: opts.credentials }),
            headers: {
                get: (n: string) => opts.headers?.[n] ?? opts.headers?.[n.toLowerCase()] ?? null,
            },
        },
        respondWith: (p: Promise<unknown>) => {
            responded = p;
        },
    });
    if (responded) await (responded as Promise<unknown>).catch(() => undefined);
    // Les stratégies enchaînent des micro-tâches après `respondWith` ; laisser tourner.
    await new Promise((r) => setTimeout(r, 5));
}

const DECLARED: Declared = [
    { origin: "https://tiles.example.test", roles: ["tiles"], cacheable: true },
];

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("routeRequest — l'invariant : le silence d'une déclaration est un refus", () => {
    let h: Harness;
    beforeEach(async () => {
        h = await mountWorker(DECLARED);
    });

    it("garde anti-gate-vide : le worker s'est bien branché sur `fetch`", () => {
        expect(typeof h.fetchHandler).toBe("function");
    });

    it("une origine DÉCLARÉE et cachable passe par un cache", async () => {
        await route(h, "https://tiles.example.test/1/2/3.png");
        expect(h.cacheOpens.length, "une origine déclarée doit être mise en cache").toBeGreaterThan(
            0
        );
    });

    it("une origine NON déclarée ne touche AUCUN cache", async () => {
        await route(h, "https://autre.example.test/data.geojson");
        expect(h.cacheOpens, "le silence est un refus, pas une permission").toEqual([]);
    });
});

describe("routeRequest — l'exception B-119, et sa BORNE", () => {
    let h: Harness;
    beforeEach(async () => {
        h = await mountWorker(DECLARED);
    });

    it("la COQUILLE same-origin est cachée sans être déclarée — le profil ne peut pas l'écrire", async () => {
        // 🛑 Sans cette exception, un profil qui déclare ses origines de données perd le cache
        // de sa propre application : tout-ou-rien, où le « rien » n'était atteignable qu'en
        // ne déclarant rien du tout.
        await route(h, `${APP_ORIGIN}/profiles/tourism/profile.json`);
        expect(h.cacheOpens.length, "la ressource de profil same-origin doit être cachée").toBe(1);
    });

    it("un fichier STATIQUE same-origin est caché sans être déclaré", async () => {
        await route(h, `${APP_ORIGIN}/geoleaf.esm.js`);
        expect(h.cacheOpens.length).toBe(1);
    });

    it("🛑 une API same-origin N'EST PAS cachée — la coquille n'est pas la donnée", async () => {
        // C'est la BORNE, et elle est le cœur de l'arbitrage. Élargir l'exception à « la même
        // origine » mettrait en cache une réponse authentifiée par défaut : on fermerait B-119
        // en ouvrant B-120. Une API de données servie depuis notre propre origine reste une
        // origine de DONNÉES, et elle se déclare comme toutes les autres.
        await route(h, `${APP_ORIGIN}/collections/pois/items`);
        expect(h.cacheOpens, "une API same-origin non déclarée doit rester hors cache").toEqual([]);
    });

    it("l'exception ne franchit pas l'origine : le même chemin sur un AUTRE hôte est refusé", async () => {
        await route(h, "https://attaquant.test/profiles/tourism/profile.json");
        expect(h.cacheOpens, "`/profiles/` sur un hôte tiers ne prouve rien").toEqual([]);
    });
});

describe("routeRequest — sans aucune déclaration, le routage historique s'applique", () => {
    it("un profil qui ne déclare rien garde le comportement d'amorçage", async () => {
        // ⚠️ Témoin nécessaire : c'est l'état de TOUS les profils du dépôt aujourd'hui (0 en
        // déclare). Si ce cas cassait, l'exception B-119 aurait changé le comportement par
        // défaut au lieu de le préserver.
        const h = await mountWorker([]);
        await route(h, `${APP_ORIGIN}/profiles/tourism/profile.json`);
        expect(h.cacheOpens.length).toBeGreaterThan(0);
    });
});

/**
 * B-120 / tâche 8.3 — une réponse de RAPATRIEMENT n'entre pas dans un cache partagé.
 *
 * 🛑 **Écrits AVANT le correctif et vus rouges**, comme la ligne 8.3 l'exige. Le chemin
 * d'amorçage — aucun profil du dépôt ne déclare ses origines — envoie toute URL inconnue sur
 * `networkFirstStrategy(request, CACHE_RUNTIME)`, qui met en cache **toute** réponse à 200.
 *
 * Deux conséquences, toutes deux silencieuses :
 *  - une réponse **authentifiée** (le connector patche le `fetch` de la page, le jeton est sur
 *    la requête que le worker voit) atterrit dans un cache PARTAGÉ ;
 *  - chaque page de rapatriement est cachée sous une URL distincte (`limit`/`offset`/`bbox`
 *    sont dans la query), donc le volume croît à chaque pull.
 *
 * ⚠️ **8.2 ne suffit pas à fermer la classe.** Elle protège le profil qui DÉCLARE ses origines
 * (`publishDataOrigins` force `cacheable: false` sur toute origine `authenticated`). Le chemin
 * d'amorçage, lui, n'atteint jamais cette règle — et c'est l'état de tous les profils livrés.
 * La garde ci-dessous vaut **quelle que soit la déclaration**, c'est ce qui la rend utile.
 */
describe("8.3 / B-120 — ce qui porte des identifiants n'entre pas en cache", () => {
    it("une requête portant `Authorization` n'est PAS mise en cache (amorçage)", async () => {
        const h = await mountWorker([]);
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items?limit=50", {
            headers: { Authorization: "Bearer jeton-de-terrain" },
        });
        expect(
            h.cachePuts,
            "une réponse authentifiée dans un cache PARTAGÉ — c'est le défaut B-120"
        ).toEqual([]);
    });

    it("une requête `credentials: include` n'est PAS mise en cache", async () => {
        const h = await mountWorker([]);
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items", {
            credentials: "include",
        });
        expect(h.cachePuts).toEqual([]);
    });

    it("une réponse `Cache-Control: no-store` n'est PAS mise en cache", async () => {
        // Le serveur a le droit de refuser le cache, et un cache partagé doit l'honorer.
        const h = await mountWorker([], { "Cache-Control": "no-store" });
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items");
        expect(h.cachePuts).toEqual([]);
    });

    it("une réponse `Cache-Control: private` n'est PAS mise en cache", async () => {
        // `private` vise exactement le cas d'un cache PARTAGÉ entre utilisateurs, ce qu'est
        // le cache d'un Service Worker sur un appareil de terrain partagé.
        const h = await mountWorker([], { "Cache-Control": "private, max-age=60" });
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items");
        expect(h.cachePuts).toEqual([]);
    });

    it("témoin : la MÊME requête SANS identifiant ni interdiction reste cachée", async () => {
        // 🛑 Sans ce témoin, les quatre cas ci-dessus seraient verts si le worker cessait de
        // cacher quoi que ce soit — la garde mesurerait le vide.
        const h = await mountWorker([]);
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items");
        expect(h.cachePuts.length).toBeGreaterThan(0);
    });

    it("la règle vaut AUSSI pour une origine déclarée cachable", async () => {
        // Une origine peut être déclarée cachable en toute bonne foi et servir, sur un chemin,
        // une réponse authentifiée. La déclaration porte sur l'ORIGINE, l'identifiant sur la
        // REQUÊTE : les deux niveaux doivent tenir.
        const h = await mountWorker([
            { origin: "https://qgis.geoleaf.dev", roles: ["layerData"], cacheable: true },
        ]);
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items", {
            headers: { Authorization: "Bearer jeton" },
        });
        expect(h.cachePuts).toEqual([]);
    });
});
