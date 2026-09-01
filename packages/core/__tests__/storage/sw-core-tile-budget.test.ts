/**
 * Bounding the Service Worker's tile cache.
 *
 * 🛑 WHAT THIS SUITE GUARDS, AND WHY IT IS NOT A PERFORMANCE SUBJECT.
 * Browsers evict by ORIGIN, not by store. `CACHE_TILES` was bounded by
 * nothing while IndexedDB — which carries `outbox` and `features`, i.e. field
 * captures with no other copy — was capped at 250 MB. Under disk pressure, a
 * tile cache left free to grow can thus get the whole origin evicted. And the
 * survey shows a new device starts in `bestEffort`: persistence is
 * obtainable, never guaranteed.
 *
 * The first four cases are BEHAVIOUR guards — they run the worker. The last
 * two are SOURCE guards: they catch what no behaviour assertion sees, namely
 * a second writer later added on the bounded store.
 *
 * ⚠️ `_tileMaxEntries` and the put counter are memoised AT MODULE LEVEL — so
 * IndexedDB is not reread at every tile. Two cases sharing the module would
 * thus also share its counter, and the second would come out green
 * exercising the first's state. Hence `mountWorker`'s `vi.resetModules()`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import swCoreSource from "../../src/kernel/storage/sw-core.js?raw";
import tileBudgetSource from "../../src/capabilities/offline/tile-budget.ts?raw";

/**
 * The source STRIPPED OF ITS COMMENTS.
 *
 * 🛑 Written after getting caught: the guard "no `.catch(() => {})` remains"
 * came out RED on `cachePut`'s prose, which cites the removed form to say
 * what it replaces. A source guard that reads documentation measures what is
 * TOLD about the code, not the code — and it punishes precisely having
 * explained the fix.
 *
 * ⚠️ The line-comment strip spares what follows a `:` — otherwise `https://`
 * in a string literal would truncate the line (`sw-core.js` carries some, in
 * the SVG placeholder).
 */
const swCoreCode = swCoreSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const APP_ORIGIN = "https://demo.geoleaf.test";
const TILE_ORIGIN = "https://tiles.example.test";

/** The tile store, simulated with an observable INSERTION ORDER. */
interface FakeCache {
    name: string;
    /** Keys in insertion order — what `cache.keys()` really returns. */
    entries: string[];
    puts: string[];
    deletes: string[];
}

interface Harness {
    fetchHandler: (e: unknown) => void;
    caches: Map<string, FakeCache>;
    /** Messages posted to clients (`client.postMessage`). */
    posted: Array<{ type?: string; detail?: Record<string, unknown> }>;
    warnings: string[];
}

interface MountOptions {
    /** Keys already in `geoleaf-data-tiles` at worker start. */
    seedTiles?: number;
    /** Ceiling the profile published into `preferences`. `undefined` = nothing published. */
    declaredMax?: number;
    /** Value `navigator.storage.estimate()` returns. */
    estimate?: { usage: number; quota: number } | null;
    /**
     * Name of the store whose first `put` must fail, and its error.
     * Serves to exercise the `QuotaExceededError` path.
     */
    failFirstPutOn?: { cache: RegExp; error: Error };
}

function quotaError(): Error {
    const err = new Error("Quota exceeded");
    err.name = "QuotaExceededError";
    return err;
}

async function mountWorker(opts: MountOptions = {}): Promise<Harness> {
    vi.resetModules();

    const handlers: Record<string, (e: unknown) => void> = {};
    const cacheStore = new Map<string, FakeCache>();
    const posted: Harness["posted"] = [];
    const warnings: string[] = [];
    const failedOnce = new Set<string>();

    const getCache = (name: string): FakeCache => {
        let c = cacheStore.get(name);
        if (!c) {
            c = { name, entries: [], puts: [], deletes: [] };
            cacheStore.set(name, c);
        }
        return c;
    };

    if (opts.seedTiles) {
        const tiles = getCache("geoleaf-data-tiles");
        for (let i = 0; i < opts.seedTiles; i++) tiles.entries.push(`${TILE_ORIGIN}/seed/${i}.pbf`);
    }

    // ── IndexedDB: the worker reads the declared origins AND the tile ceiling there ──────
    const preferences: Record<string, unknown> = {
        "offline.dataOrigins": [{ origin: TILE_ORIGIN, roles: ["tiles"], cacheable: true }],
    };
    if (opts.declaredMax !== undefined) {
        preferences["offline.tileCacheMaxEntries"] = opts.declaredMax;
    }

    const store = {
        get: (key: string) => {
            const req: Record<string, unknown> = {};
            setTimeout(() => {
                req.result = key in preferences ? { value: preferences[key] } : null;
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
        databases: () => Promise.resolve([{ name: "geoleaf-db", version: 4 }]),
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
            const c = getCache(name);
            return Promise.resolve({
                match: () => Promise.resolve(undefined),
                put: (req: unknown, res: unknown) => {
                    const url =
                        typeof req === "string" ? req : String((req as Request)?.url ?? req);
                    // 🛑 THE BODY CONSUMES ITSELF, AND THE MOCK MUST SAY SO.
                    // Without it, the guard "the retry receives a consumable
                    // body" would be DECORATIVE: retrying with the
                    // already-passed object would come out green here and
                    // fail in a browser. Written after observing the mutation
                    // did not turn it red.
                    const body = res as { _consumed?: boolean } | undefined;
                    if (body?._consumed) {
                        return Promise.reject(new TypeError("Response body is already used"));
                    }
                    if (body) body._consumed = true;

                    if (opts.failFirstPutOn?.cache.test(name) && !failedOnce.has(name)) {
                        failedOnce.add(name);
                        return Promise.reject(opts.failFirstPutOn.error);
                    }
                    c.puts.push(url);
                    c.entries.push(url);
                    return Promise.resolve();
                },
                keys: () => Promise.resolve([...c.entries]),
                delete: (key: unknown) => {
                    const url =
                        typeof key === "string" ? key : String((key as Request)?.url ?? key);
                    const idx = c.entries.indexOf(url);
                    if (idx === -1) return Promise.resolve(false);
                    c.entries.splice(idx, 1);
                    c.deletes.push(url);
                    return Promise.resolve(true);
                },
            });
        },
        keys: () => Promise.resolve([...cacheStore.keys()]),
        delete: () => Promise.resolve(true),
        match: () => Promise.resolve(undefined),
    });

    vi.stubGlobal(
        "fetch",
        vi.fn((input: unknown) => {
            const url = typeof input === "string" ? input : String((input as Request).url);
            const headers = { get: () => null };
            const body = () => ({ status: 200, type: "basic", headers, url, _consumed: false });
            return Promise.resolve({
                ok: true,
                status: 200,
                type: "basic",
                headers,
                url,
                clone: () => ({ ...body(), clone: () => body() }),
            });
        })
    );

    const client = { postMessage: (m: unknown) => posted.push(m as Harness["posted"][number]) };
    vi.stubGlobal("self", {
        location: { origin: APP_ORIGIN },
        addEventListener: (name: string, fn: (e: unknown) => void) => {
            handlers[name] = fn;
        },
        skipWaiting: () => Promise.resolve(),
        clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([client]) },
        registration: { scope: `${APP_ORIGIN}/` },
        navigator:
            opts.estimate === null
                ? {}
                : {
                      storage: {
                          estimate: () =>
                              Promise.resolve(opts.estimate ?? { usage: 1, quota: 100 }),
                      },
                  },
    });

    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
    });

    await import("../../src/kernel/storage/sw-core.js");
    return { fetchHandler: handlers["fetch"]!, caches: cacheStore, posted, warnings };
}

/**
 * Fingerprint of everything observable the worker can produce. Serves as
 * {@link settle}'s stop criterion: as long as it moves, work is still in flight.
 */
function _snapshot(h: Harness): string {
    let n = h.posted.length + h.warnings.length;
    for (const c of h.caches.values()) n += c.puts.length + c.deletes.length + c.entries.length;
    return String(n);
}

/**
 * Waits for the worker's background work to BE DONE — not for a delay to elapse.
 *
 * 🛑 THIS HELPER REPLACES A `setTimeout(r, 5)`, AND THAT IS A DEFECT MEASURED
 * IN CI ON 08/08/2026. The preference read simulates IndexedDB with a CHAIN
 * of `setTimeout(…, 0)` — `open` → `onsuccess` → `transaction` → `get` →
 * `onsuccess` —, several macrotasks before the ceiling is even known, then
 * the trim itself. Five wall-clock milliseconds suffice on an idle 16-core
 * dev machine; on the runner — **2 cores, 8 concurrent workers, istanbul
 * instrumentation** — the timers are delayed beyond, and the test asserts a
 * state not yet produced. Symptoms: "expected 0 to be greater than 0" (the
 * trim did not happen) and "expected [] to have a length of 1" (nothing was posted).
 *
 * ⚠️ **The falling cases were not the same from run to run** (1.2 and 1.4 in
 * CI, 1.2 and 1.3 in local reproduction): the signature of a race, and what
 * forbids "lengthening the delay". A longer delay moves the threshold, it
 * does not remove it — and it would be paid on each of the suite's ~20 calls.
 *
 * The criterion is therefore QUIESCENCE: we yield to the event loop until
 * nothing observable changes for `quietTurns` consecutive turns. At rest it
 * is near instant; under contention, the wait lengthens by itself, exactly
 * the property that was missing.
 *
 * ⚠️ `quietTurns` cannot be small: between the first turn and the first
 * observable write, the IndexedDB chain crosses several macrotasks producing
 * NOTHING. A threshold of 2 or 3 would exit during that hole and recreate
 * exactly the race being closed.
 */
async function settle(h: Harness, quietTurns = 25, maxTurns = 2000): Promise<void> {
    let prev = _snapshot(h);
    let quiet = 0;
    for (let i = 0; i < maxTurns && quiet < quietTurns; i++) {
        await new Promise((r) => setTimeout(r, 0));
        const cur = _snapshot(h);
        if (cur === prev) {
            quiet++;
        } else {
            quiet = 0;
            prev = cur;
        }
    }
}

/** Plays a GET request and waits for the background work to settle. */
async function route(h: Harness, url: string): Promise<void> {
    let responded: Promise<unknown> | null = null;
    h.fetchHandler({
        request: { method: "GET", url, mode: "cors", headers: { get: () => null } },
        respondWith: (p: Promise<unknown>) => {
            responded = p;
        },
    });
    if (responded) await (responded as Promise<unknown>).catch(() => undefined);
    await settle(h);
}

const tileUrl = (n: number) => `${TILE_ORIGIN}/10/${n}/340.pbf`;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// the FIFO ceiling
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("1.2 — `CACHE_TILES` est borné en FIFO par nombre d'entrées", () => {
    it("au-delà du plafond, les entrées les PLUS ANCIENNES partent, et le compte redescend", async () => {
        // Ceiling declared at 10, store seeded at 14: the first cached tile
        // triggers the trim. Low target = 80% of the ceiling = 8, plus the tile just written.
        const h = await mountWorker({ seedTiles: 14, declaredMax: 10 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.puts).toHaveLength(1); // witness: the tile did go through the cache
        expect(tiles.deletes.length).toBeGreaterThan(0);
        // The oldest leave — `cache.keys()` returns insertion order.
        expect(tiles.deletes[0]).toBe(`${TILE_ORIGIN}/seed/0.pbf`);
        expect(tiles.deletes).not.toContain(tileUrl(1));
        expect(tiles.entries.length).toBeLessThanOrEqual(9);
        // The freshly written tile SURVIVES: evicting what was just fetched
        // would leave the cache unable to serve what the user is looking at.
        expect(tiles.entries).toContain(tileUrl(1));
    });

    it("sous le plafond, RIEN n'est évincé", async () => {
        const h = await mountWorker({ seedTiles: 3, declaredMax: 10 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.puts).toHaveLength(1); // witness
        expect(tiles.deletes).toHaveLength(0);
    });

    it("entre la marge basse et le plafond, on NE RETAILLE PAS — c'est l'hystérésis", async () => {
        // 🛑 THIS CASE WAS ADDED BECAUSE A MUTATION WENT UNNOTICED. Lowering
        // the TRIGGER to zero turned no guard red: the target (80% of the
        // ceiling) absorbed the mutation as long as the store stayed under
        // it. The trigger was thus exercised nowhere, and it is precisely
        // what avoids paying a `cache.keys()` and a burst of `delete`s at
        // every tile once past the margin.
        //
        // Ceiling 10, low margin 8: at 9 entries we are IN the band, nothing must move.
        const h = await mountWorker({ seedTiles: 8, declaredMax: 10 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.entries).toHaveLength(9); // witness: we are indeed in the band
        expect(tiles.deletes).toHaveLength(0);
    });

    it("un plafond déclaré à `0` DÉSACTIVE le bornage", async () => {
        const h = await mountWorker({ seedTiles: 50, declaredMax: 0 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.puts).toHaveLength(1); // witness
        expect(tiles.deletes).toHaveLength(0);
    });

    it("sans plafond publié, le worker retombe sur sa constante — jamais sur « pas de limite »", async () => {
        // A core-only deployment has no base to read: the fallback must BOUND, not open.
        const h = await mountWorker({ seedTiles: 2, declaredMax: undefined });
        await route(h, tileUrl(1));

        const decl = swCoreSource.match(/const TILE_CACHE_MAX_ENTRIES = (\d+);/);
        expect(decl).not.toBeNull();
        expect(Number(decl![1])).toBeGreaterThan(0);
        expect(Number(decl![1])).toBeLessThan(100000);
    });

    it("le contrôle ne tourne pas à CHAQUE tuile — il est amorti", async () => {
        // `cache.keys()` is O(n): calling it at every tile would charge the
        // bounding to a FetchEvent's critical path. It runs at the first put
        // (a restarting worker may inherit an already-overfull cache), then in batches.
        const h = await mountWorker({ seedTiles: 14, declaredMax: 10 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));
        const afterFirst = tiles.deletes.length;
        expect(afterFirst).toBeGreaterThan(0); // witness: the first put DID check

        // The next tiles go back over the ceiling without retriggering a trim.
        for (let i = 2; i <= 6; i++) await route(h, tileUrl(i));
        expect(tiles.deletes.length).toBe(afterFirst);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// the pressure escape hatch
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("1.2 — sous pression du quota d'ORIGINE, le trim devient agressif", () => {
    it("au-delà du seuil de pression, la cible descend bien plus bas que le plafond FIFO", async () => {
        // `estimate()` measures the WHOLE origin, not the tile cache — and
        // that is what makes this trim correct: under origin pressure, the
        // right class to sacrifice is the re-downloadable, exactly the CDC's
        // `lru` / `never` distinction.
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 1000, // FIFO alone would have evicted NOTHING: 600 < 1000
            estimate: { usage: 95, quota: 100 },
        });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.deletes.length).toBeGreaterThan(0);
        expect(tiles.deletes[0]).toBe(`${TILE_ORIGIN}/seed/0.pbf`);
    });

    it("sous le seuil, la pression ne déclenche rien", async () => {
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 1000,
            estimate: { usage: 10, quota: 100 },
        });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.puts).toHaveLength(1); // witness
        expect(tiles.deletes).toHaveLength(0);
    });

    it("un navigateur sans `storage.estimate` ne casse pas le bornage FIFO", async () => {
        const h = await mountWorker({ seedTiles: 14, declaredMax: 10, estimate: null });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.deletes.length).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// `QuotaExceededError` stops being swallowed
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("1.3 — un refus de quota est distingué, traité, et réessayé UNE fois", () => {
    it("le quota déclenche un trim des tuiles puis EXACTEMENT un retry", async () => {
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 1000,
            failFirstPutOn: { cache: /-static$/, error: quotaError() },
        });

        await route(h, `${APP_ORIGIN}/dist/app.js`);

        const tiles = h.caches.get("geoleaf-data-tiles")!;
        const staticCache = [...h.caches.values()].find((c) => c.name.endsWith("-static"))!;

        // The overflowing store is NOT the one being emptied: tiles are the
        // re-downloadable class, the application script is not in the same way.
        expect(tiles.deletes.length).toBeGreaterThan(0);
        // One retry, and it succeeded → one entry written, not zero and not two.
        expect(staticCache.puts).toHaveLength(1);
    });

    it("le retry reçoit un corps CONSOMMABLE — sinon le correctif sort vert sans rien réparer", async () => {
        // 🛑 `cache.put` consumes the body of the response it is given.
        // Retrying with the SAME object fails with "body already used", and
        // the trim would have run for nothing.
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 1000,
            failFirstPutOn: { cache: /-static$/, error: quotaError() },
        });

        await route(h, `${APP_ORIGIN}/dist/app.js`);

        const staticCache = [...h.caches.values()].find((c) => c.name.endsWith("-static"))!;
        expect(staticCache.puts).toEqual([`${APP_ORIGIN}/dist/app.js`]);
        expect(staticCache.entries).toContain(`${APP_ORIGIN}/dist/app.js`);
    });

    it("une erreur qui N'EST PAS un quota ne déclenche ni trim ni retry", async () => {
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 1000,
            failFirstPutOn: { cache: /-static$/, error: new TypeError("Request method POST") },
        });

        await route(h, `${APP_ORIGIN}/dist/app.js`);

        const tiles = h.caches.get("geoleaf-data-tiles")!;
        const staticCache = [...h.caches.values()].find((c) => c.name.endsWith("-static"))!;
        expect(tiles.deletes).toHaveLength(0);
        expect(staticCache.puts).toHaveLength(0);
    });

    it("un plafond à `0` ne DÉSARME PAS la récupération sur refus de quota", async () => {
        // 🛑 Explicit decision, pinned here because nothing else would carry
        // it. "No ceiling" says not to trim *preventively*; here the browser
        // just REFUSED a write. Honouring the `0` would mean caching nothing
        // at all, indefinitely, on a full device — the very loss path being closed.
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 0,
            failFirstPutOn: { cache: /-static$/, error: quotaError() },
        });

        await route(h, `${APP_ORIGIN}/dist/app.js`);

        const tiles = h.caches.get("geoleaf-data-tiles")!;
        const staticCache = [...h.caches.values()].find((c) => c.name.endsWith("-static"))!;
        expect(tiles.deletes.length).toBeGreaterThan(0);
        expect(staticCache.puts).toHaveLength(1);
        // And the ROUTINE trim stays disabled: no tile was trimmed without a refusal.
        expect(h.posted.filter((m) => m.type === "GEOLEAF_CACHE_EVICTED")[0]?.detail?.reason).toBe(
            "quota"
        );
    });

    it("si le trim ne libère RIEN, il n'y a pas de retry — il échouerait pareil", async () => {
        const h = await mountWorker({
            seedTiles: 0,
            declaredMax: 1000,
            failFirstPutOn: { cache: /-static$/, error: quotaError() },
        });

        await route(h, `${APP_ORIGIN}/dist/app.js`);

        const staticCache = [...h.caches.values()].find((c) => c.name.endsWith("-static"))!;
        expect(staticCache.puts).toHaveLength(0);
        expect(h.warnings.join("\n")).toMatch(/quota/i);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// porting the eviction pattern, not reinventing it
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("1.4 — le signal d'éviction remonte, et seulement quand il le doit", () => {
    it("un trim SOUS PRESSION est posté aux clients, avec la forme d'`EvictionResult`", async () => {
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 1000,
            estimate: { usage: 95, quota: 100 },
        });

        await route(h, tileUrl(1));

        const evicted = h.posted.filter((m) => m.type === "GEOLEAF_CACHE_EVICTED");
        expect(evicted).toHaveLength(1);
        const detail = evicted[0]!.detail!;
        expect(detail.evicted).toBeGreaterThan(0);
        expect(detail.totalBefore).toBeGreaterThan(detail.totalAfter as number);
        expect(detail.reason).toBe("pressure");
        // ⚠️ `freedBytes` is deliberately ABSENT: the Cache API does not give
        // an entry's size, and `engine-signals.ts` already omits the size
        // when missing. Fabricating a number would be worse than staying silent.
        expect(detail).not.toHaveProperty("freedBytes");
        expect(detail.store).toBe("cache-api");
    });

    it("un trim FIFO de ROUTINE ne remonte PAS — il tourne à chaque panoramique", async () => {
        // One toast per map pan teaches people to stop reading notifications.
        const h = await mountWorker({ seedTiles: 14, declaredMax: 10 });

        await route(h, tileUrl(1));

        const tiles = h.caches.get("geoleaf-data-tiles")!;
        expect(tiles.deletes.length).toBeGreaterThan(0); // témoin : le trim a bien eu lieu
        expect(h.posted.filter((m) => m.type === "GEOLEAF_CACHE_EVICTED")).toHaveLength(0);
    });

    it("un trim déclenché par un REFUS DE QUOTA remonte, lui", async () => {
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 1000,
            failFirstPutOn: { cache: /-static$/, error: quotaError() },
        });

        await route(h, `${APP_ORIGIN}/dist/app.js`);

        const evicted = h.posted.filter((m) => m.type === "GEOLEAF_CACHE_EVICTED");
        expect(evicted).toHaveLength(1);
        expect(evicted[0]!.detail!.reason).toBe("quota");
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// SOURCE guards — what no behaviour assertion catches
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("garde de source — le magasin borné n'a qu'un écrivain", () => {
    it("aucun `.catch(() => {})` ne subsiste sur un `cache.put`", () => {
        // 🛑 THAT WAS THE DEFECT: four empty catches swallowed the quota
        // overrun like anything else. The worker thus could not know it was full.
        expect(swCoreCode).toMatch(/function cachePut/); // witness
        expect(swCoreCode).not.toMatch(/cache\.put\([\s\S]{0,80}?\)\.catch\(\(\) => \{\}\)/);
    });

    it("les quatre stratégies écrivent par `cachePut`, jamais par un `cache.put` nu", () => {
        const strategies = swCoreCode.slice(
            swCoreCode.indexOf("async function cacheFirstStrategy"),
            swCoreCode.indexOf("function isProfileResource")
        );
        expect(strategies.length).toBeGreaterThan(0); // witness: the slice is not empty
        const calls = strategies.match(/cachePut\(/g) || [];
        expect(calls).toHaveLength(4);
        // The only `cache.put(` left in the slice would belong to a forgotten site.
        expect(strategies).not.toMatch(/\bcache\.put\(/);
    });

    it("le plafond de repli et la clé partagée sont écrits UNE fois chacun", () => {
        expect(swCoreCode.match(/const TILE_CACHE_MAX_ENTRIES = /g)).toHaveLength(1);
        expect(swCoreCode.match(/const TILE_BUDGET_KEY = /g)).toHaveLength(1);
    });

    it("la clé de `preferences` dit LA MÊME CHOSE des deux côtés", () => {
        // 🛑 The worker cannot import `tile-budget.ts` — it is copied as-is,
        // unbundled. The literal is thus written twice, and nothing but this
        // guard would see the two diverge: the engine would publish under one
        // key, the worker read under the other, and the bounding would
        // silently drop to the fallback. EXACTLY the shape of the offline
        // roadmap's root cause no. 2 — a number written on both sides,
        // desynchronised for months with no suite turning red.
        const swKey = swCoreCode.match(/const TILE_BUDGET_KEY = "([^"]+)"/);
        const modKey = tileBudgetSource.match(/export const TILE_BUDGET_KEY = "([^"]+)"/);
        expect(swKey).not.toBeNull();
        expect(modKey).not.toBeNull();
        expect(swKey![1]).toBe(modKey![1]);
        // And the prefix does not pass itself off as an event: the EVENT-MAP
        // gate scans `geoleaf:*` literals and would take the key for an untyped signal.
        expect(swKey![1]).not.toMatch(/^geoleaf:/);
    });

    it("un seul site ÉCRIT dans `CACHE_TILES` — le trim l'ouvre pour supprimer", () => {
        // 🛑 The property that makes the trim safe. What the user explicitly
        // downloads goes to IndexedDB; only the opportunistic path writes
        // here. A second writer (e.g. caching a prepared zone) would make the
        // FIFO able to take field work away, and this guard is the only place
        // that would see it.
        const opens = swCoreCode.match(/caches\.open\(CACHE_TILES\)/g) || [];
        expect(opens).toHaveLength(2); // `tileCacheStrategy` (lit+écrit) et `cachePut` (taille)

        const trimmer = swCoreCode.slice(
            swCoreCode.indexOf("async function cachePut"),
            swCoreCode.indexOf("async function cacheFirstStrategy")
        );
        expect(trimmer).toMatch(/caches\.open\(CACHE_TILES\)/); // witness
        // The tile store `cachePut` opens serves ONLY `_trimTileCache`.
        expect(trimmer).toMatch(/_trimTileCache\(tiles,/);
        expect(trimmer).not.toMatch(/tiles\.put\(/);
    });
});
