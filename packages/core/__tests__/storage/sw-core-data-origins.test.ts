/**
 * `routeRequest` — the Service Worker's routing BY DECLARATION.
 *
 * 🛑 **This routing had NO test.** Measured at the preflight:
 * `grep routeRequest|dataOrigins` over `__tests__/` returned nothing. Yet it
 * is what decides what enters the cache and what does not — the routing's
 * central piece, and the operative cause of both cache defects. The same
 * blind spot as `resolveProfileLayers`: the function carrying the decision is
 * the one nobody exercises.
 *
 * What this suite guards:
 *
 *  1. **The invariant** — declaring one origin REFUSES all others. A
 *     declaration's silence is a refusal, not a permission.
 *  2. **Its exception, and its BOUND» — the origin serving the application is
 *     cacheable without being declared, because it changes at every
 *     deployment and no portable profile can write it. But the exception
 *     covers the SHELL, not the data: an API served from the same origin
 *     stays a data origin and must declare itself. Without that bound, an
 *     authenticated same-origin response would be cached by default — one
 *     defect opened while closing the other.
 *
 * The observable is `caches.open`: a cache strategy calls it with its store,
 * a direct network pass (`fetchBounded`) never does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const APP_ORIGIN = "https://demo.geoleaf.test";

/** The origins the profile declares, read by the worker from IndexedDB. */
type Declared = Array<{ origin: string; roles: string[]; cacheable: boolean }>;

interface Harness {
    fetchHandler: (event: unknown) => void;
    /** OPENED stores — a cache strategy opens one, `fetchBounded` never. */
    cacheOpens: string[];
    /**
     * URLs really WRITTEN to cache.
     *
     * ⚠️ Distinct from `cacheOpens`, and the distinction was found by getting
     * it wrong: `networkFirstStrategy` opens its store BEFORE testing the
     * response's cacheability. Measuring the opening answers "was a cache
     * strategy chosen", not "was anything cached". Both questions are useful
     * — the first tells the routing, the second the write refusal — but
     * confusing them makes a test measure beside what it states.
     */
    cachePuts: string[];
    networkCalls: string[];
}

/**
 * Mounts a FRESH worker with the given declared origins.
 *
 * ⚠️ `vi.resetModules()` is load-bearing: `_dataOrigins` is memoised at
 * module level (so IndexedDB is not reread per request), so two cases sharing
 * the module would also share its declaration — the second would come out
 * green exercising the first's state.
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

/** Plays a GET request and returns the promise the worker passed to `respondWith`. */
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
    // The strategies chain microtasks after `respondWith`; let them run.
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

describe("routeRequest — l'exception coquille, et sa BORNE", () => {
    let h: Harness;
    beforeEach(async () => {
        h = await mountWorker(DECLARED);
    });

    it("la COQUILLE same-origin est cachée sans être déclarée — le profil ne peut pas l'écrire", async () => {
        // 🛑 Without this exception, a profile declaring its data origins
        // loses its own application's cache: all-or-nothing, where "nothing"
        // was only reachable by declaring nothing at all.
        await route(h, `${APP_ORIGIN}/profiles/tourism/profile.json`);
        expect(h.cacheOpens.length, "la ressource de profil same-origin doit être cachée").toBe(1);
    });

    it("un fichier STATIQUE same-origin est caché sans être déclaré", async () => {
        await route(h, `${APP_ORIGIN}/geoleaf.esm.js`);
        expect(h.cacheOpens.length).toBe(1);
    });

    it("🛑 une API same-origin N'EST PAS cachée — la coquille n'est pas la donnée", async () => {
        // The BOUND, and it is the arbitration's core. Widening the exception
        // to "the same origin" would cache an authenticated response by
        // default: one defect closed by opening the other. A data API served
        // from our own origin stays a DATA origin, and declares itself like
        // all the others.
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
        // ⚠️ Necessary witness: the state of ALL the repo's profiles today (0
        // declare any). If this case broke, the shell exception would have
        // changed the default behaviour instead of preserving it.
        const h = await mountWorker([]);
        await route(h, `${APP_ORIGIN}/profiles/tourism/profile.json`);
        expect(h.cacheOpens.length).toBeGreaterThan(0);
    });
});

/**
 * A PULL response does not enter a shared cache.
 *
 * 🛑 **Written BEFORE the fix and seen red**, as required. The bootstrap path
 * — no repo profile declares its origins — sends any unknown URL to
 * `networkFirstStrategy(request, CACHE_RUNTIME)`, which caches **every** 200
 * response.
 *
 * Two consequences, both silent:
 *  - an **authenticated** response (the connector patches the page's `fetch`,
 *    the token is on the request the worker sees) lands in a SHARED cache;
 *  - each pull page is cached under a distinct URL (`limit`/`offset`/`bbox`
 *    are in the query), so the volume grows at every pull.
 *
 * ⚠️ **The declaration path does not suffice to close the class.» It protects
 * the profile that DECLARES its origins (`publishDataOrigins` forces
 * `cacheable: false` on any `authenticated` origin). The bootstrap path never
 * reaches that rule — and that is the state of every shipped profile. The
 * guard below holds **whatever the declaration**, which is what makes it useful.
 */
describe("ce qui porte des identifiants n'entre pas en cache", () => {
    it("une requête portant `Authorization` n'est PAS mise en cache (amorçage)", async () => {
        const h = await mountWorker([]);
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items?limit=50", {
            headers: { Authorization: "Bearer jeton-de-terrain" },
        });
        expect(
            h.cachePuts,
            "une réponse authentifiée dans un cache PARTAGÉ — c'est le défaut même"
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
        // The server has the right to refuse caching, and a shared cache must honour it.
        const h = await mountWorker([], { "Cache-Control": "no-store" });
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items");
        expect(h.cachePuts).toEqual([]);
    });

    it("une réponse `Cache-Control: private` n'est PAS mise en cache", async () => {
        // `private` targets exactly the case of a cache SHARED between users,
        // which a Service Worker's cache on a shared field device is.
        const h = await mountWorker([], { "Cache-Control": "private, max-age=60" });
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items");
        expect(h.cachePuts).toEqual([]);
    });

    it("témoin : la MÊME requête SANS identifiant ni interdiction reste cachée", async () => {
        // 🛑 Without this witness, the four cases above would be green if the
        // worker stopped caching anything — the guard would measure emptiness.
        const h = await mountWorker([]);
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items");
        expect(h.cachePuts.length).toBeGreaterThan(0);
    });

    it("la règle vaut AUSSI pour une origine déclarée cachable", async () => {
        // An origin can be declared cacheable in good faith and serve, on one
        // path, an authenticated response. The declaration bears on the
        // ORIGIN, the credential on the REQUEST: both levels must hold.
        const h = await mountWorker([
            { origin: "https://qgis.geoleaf.dev", roles: ["layerData"], cacheable: true },
        ]);
        await route(h, "https://qgis.geoleaf.dev/ogc/collections/sites/items", {
            headers: { Authorization: "Bearer jeton" },
        });
        expect(h.cachePuts).toEqual([]);
    });
});
