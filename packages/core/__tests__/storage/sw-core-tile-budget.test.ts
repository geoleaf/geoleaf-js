/**
 * Bornage du cache de tuiles du Service Worker — tâches 1.2 / 1.3 / 1.4 de
 * `roadmap_socle-init`.
 *
 * 🛑 CE QUE CETTE SUITE GARDE, ET POURQUOI CE N'EST PAS UN SUJET DE PERFORMANCE. Les
 * navigateurs évincent par ORIGINE, pas par magasin. `CACHE_TILES` n'était borné par rien
 * pendant qu'IndexedDB — qui porte `outbox` et `features`, c'est-à-dire des saisies terrain
 * sans autre copie — l'était à 250 Mo. Sous pression disque, un cache de tuiles laissé libre
 * de grossir peut donc faire évincer l'origine entière. Et le relevé de la tâche 1.1 montre
 * qu'un appareil neuf démarre en `bestEffort` : la persistance est obtenable, jamais garantie.
 *
 * Les quatre premiers cas sont des gardes de COMPORTEMENT — ils exécutent le worker. Les deux
 * derniers sont des gardes de SOURCE : elles attrapent ce qu'aucune assertion de comportement
 * ne voit, à savoir un second écrivain ajouté plus tard sur le magasin borné.
 *
 * ⚠️ `_tileMaxEntries` et le compteur de puts sont mémorisés AU NIVEAU MODULE — pour ne pas
 * relire IndexedDB à chaque tuile. Deux cas qui partageraient le module partageraient donc
 * aussi son compteur, et le second sortirait vert en éprouvant l'état du premier. D'où le
 * `vi.resetModules()` de `mountWorker`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import swCoreSource from "../../src/kernel/storage/sw-core.js?raw";
import tileBudgetSource from "../../src/capabilities/offline/tile-budget.ts?raw";

/**
 * La source PRIVÉE DE SES COMMENTAIRES.
 *
 * 🛑 Écrit après s'être fait avoir : la garde « aucun `.catch(() => {})` ne subsiste » sortait
 * ROUGE sur la prose de `cachePut`, qui cite la forme supprimée pour dire ce qu'elle remplace.
 * Une garde de source qui lit la documentation mesure ce qu'on RACONTE du code, pas le code —
 * et elle punit précisément le fait d'avoir expliqué le correctif.
 *
 * ⚠️ Le retrait des commentaires de ligne épargne ce qui suit un `:` — sinon `https://` dans un
 * littéral de chaîne tronquerait la ligne (`sw-core.js` en porte, dans le placeholder SVG).
 */
const swCoreCode = swCoreSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const APP_ORIGIN = "https://demo.geoleaf.test";
const TILE_ORIGIN = "https://tiles.example.test";

/** Le magasin de tuiles, simulé avec un ORDRE D'INSERTION observable. */
interface FakeCache {
    name: string;
    /** Clés dans leur ordre d'insertion — ce que `cache.keys()` rend vraiment. */
    entries: string[];
    puts: string[];
    deletes: string[];
}

interface Harness {
    fetchHandler: (e: unknown) => void;
    caches: Map<string, FakeCache>;
    /** Messages postés aux clients (`client.postMessage`). */
    posted: Array<{ type?: string; detail?: Record<string, unknown> }>;
    warnings: string[];
}

interface MountOptions {
    /** Clés déjà présentes dans `geoleaf-data-tiles` au démarrage du worker. */
    seedTiles?: number;
    /** Plafond publié par le profil dans `preferences`. `undefined` = rien de publié. */
    declaredMax?: number;
    /** Valeur rendue par `navigator.storage.estimate()`. */
    estimate?: { usage: number; quota: number } | null;
    /**
     * Nom du magasin dont le premier `put` doit échouer, et son erreur.
     * Sert à éprouver le chemin `QuotaExceededError`.
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

    // ── IndexedDB : le worker y lit les origines déclarées ET le plafond de tuiles ────────
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
                    // 🛑 LE CORPS SE CONSOMME, ET LE MOCK DOIT LE DIRE. Sans ça, la garde
                    // « le retry reçoit un corps consommable » serait DÉCORATIVE : réessayer
                    // avec l'objet déjà passé sortirait vert ici et échouerait en navigateur.
                    // Écrit après avoir constaté que la mutation ne la faisait pas rougir.
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
 * Empreinte de tout ce que le worker peut produire d'observable. Sert de critère d'arrêt à
 * {@link settle} : tant qu'elle bouge, du travail est encore en vol.
 */
function _snapshot(h: Harness): string {
    let n = h.posted.length + h.warnings.length;
    for (const c of h.caches.values()) n += c.puts.length + c.deletes.length + c.entries.length;
    return String(n);
}

/**
 * Attend que le travail d'arrière-plan du worker SOIT FINI — pas qu'un délai soit écoulé.
 *
 * 🛑 CE HELPER REMPLACE UN `setTimeout(r, 5)`, ET C'EST UN DÉFAUT MESURÉ EN CI LE 08/08/2026.
 * La lecture des préférences simule IndexedDB par une CHAÎNE de `setTimeout(…, 0)` — `open` →
 * `onsuccess` → `transaction` → `get` → `onsuccess` —, soit plusieurs macro-tâches avant que
 * le plafond ne soit seulement connu, puis le trim lui-même. Cinq millisecondes d'horloge
 * suffisent sur une machine de dev à 16 cœurs au repos ; sur le runner — **2 cœurs, 8 workers
 * concurrents, instrumentation istanbul** — les timers sont retardés au-delà, et le test
 * assère un état qui n'est pas encore produit. Symptômes : « expected 0 to be greater than 0 »
 * (le trim n'a pas eu lieu) et « expected [] to have a length of 1 » (rien n'a été posté).
 *
 * ⚠️ **Les cas qui tombaient n'étaient pas les mêmes d'un run à l'autre** (1.2 et 1.4 en CI,
 * 1.2 et 1.3 en reproduction locale) : c'est la signature d'une course, et c'est ce qui
 * interdit de « rallonger le délai ». Un délai plus long déplace le seuil, il ne le supprime
 * pas — et il se paierait sur chacun des ~20 appels de la suite.
 *
 * Le critère est donc la QUIESCENCE : on rend la main au boucleur d'événements jusqu'à ce que
 * plus rien d'observable ne change pendant `quietTurns` tours consécutifs. Au repos c'est
 * quasi instantané ; sous contention, l'attente s'allonge d'elle-même, ce qui est exactement
 * la propriété qui manquait.
 *
 * ⚠️ `quietTurns` ne peut pas être petit : entre le premier tour et la première écriture
 * observable, la chaîne IndexedDB traverse plusieurs macro-tâches SANS rien produire. Un seuil
 * à 2 ou 3 sortirait pendant ce trou et recréerait exactement la course qu'on ferme.
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

/** Joue une requête GET et attend que le travail d'arrière-plan soit retombé. */
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
// 1.2 — le plafond FIFO
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("1.2 — `CACHE_TILES` est borné en FIFO par nombre d'entrées", () => {
    it("au-delà du plafond, les entrées les PLUS ANCIENNES partent, et le compte redescend", async () => {
        // Plafond déclaré à 10, magasin semé à 14 : la première tuile mise en cache déclenche
        // le trim. Cible basse = 80 % du plafond = 8, plus la tuile qu'on vient d'écrire.
        const h = await mountWorker({ seedTiles: 14, declaredMax: 10 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.puts).toHaveLength(1); // témoin : la tuile est bien passée par le cache
        expect(tiles.deletes.length).toBeGreaterThan(0);
        // Ce sont les plus anciennes qui partent — `cache.keys()` rend l'ordre d'insertion.
        expect(tiles.deletes[0]).toBe(`${TILE_ORIGIN}/seed/0.pbf`);
        expect(tiles.deletes).not.toContain(tileUrl(1));
        expect(tiles.entries.length).toBeLessThanOrEqual(9);
        // La tuile fraîchement écrite SURVIT : évincer ce qu'on vient d'aller chercher
        // rendrait le cache incapable de servir ce que l'utilisateur regarde.
        expect(tiles.entries).toContain(tileUrl(1));
    });

    it("sous le plafond, RIEN n'est évincé", async () => {
        const h = await mountWorker({ seedTiles: 3, declaredMax: 10 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.puts).toHaveLength(1); // témoin
        expect(tiles.deletes).toHaveLength(0);
    });

    it("entre la marge basse et le plafond, on NE RETAILLE PAS — c'est l'hystérésis", async () => {
        // 🛑 CE CAS A ÉTÉ AJOUTÉ PARCE QU'UNE MUTATION PASSAIT INAPERÇUE. Abaisser le
        // DÉCLENCHEUR à zéro ne faisait rougir aucune garde : la cible (80 % du plafond)
        // absorbait la mutation tant que le magasin restait sous elle. Le déclencheur n'était
        // donc éprouvé nulle part, et c'est précisément lui qui empêche de payer un
        // `cache.keys()` et une rafale de `delete` à chaque tuile une fois la marge franchie.
        //
        // Plafond 10, marge basse 8 : à 9 entrées on est DANS la bande, rien ne doit bouger.
        const h = await mountWorker({ seedTiles: 8, declaredMax: 10 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.entries).toHaveLength(9); // témoin : on est bien dans la bande
        expect(tiles.deletes).toHaveLength(0);
    });

    it("un plafond déclaré à `0` DÉSACTIVE le bornage", async () => {
        const h = await mountWorker({ seedTiles: 50, declaredMax: 0 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));

        expect(tiles.puts).toHaveLength(1); // témoin
        expect(tiles.deletes).toHaveLength(0);
    });

    it("sans plafond publié, le worker retombe sur sa constante — jamais sur « pas de limite »", async () => {
        // Un déploiement core-only n'a pas de base à lire : le repli doit BORNER, pas ouvrir.
        const h = await mountWorker({ seedTiles: 2, declaredMax: undefined });
        await route(h, tileUrl(1));

        const decl = swCoreSource.match(/const TILE_CACHE_MAX_ENTRIES = (\d+);/);
        expect(decl).not.toBeNull();
        expect(Number(decl![1])).toBeGreaterThan(0);
        expect(Number(decl![1])).toBeLessThan(100000);
    });

    it("le contrôle ne tourne pas à CHAQUE tuile — il est amorti", async () => {
        // `cache.keys()` est en O(n) : l'appeler à chaque tuile ferait payer le bornage sur le
        // chemin critique d'un FetchEvent. Il tourne au premier put (un worker qui redémarre
        // hérite peut-être d'un cache déjà trop plein), puis par lots.
        const h = await mountWorker({ seedTiles: 14, declaredMax: 10 });
        const tiles = h.caches.get("geoleaf-data-tiles")!;

        await route(h, tileUrl(1));
        const afterFirst = tiles.deletes.length;
        expect(afterFirst).toBeGreaterThan(0); // témoin : le premier put A vérifié

        // Les tuiles suivantes repassent au-dessus du plafond sans redéclencher de trim.
        for (let i = 2; i <= 6; i++) await route(h, tileUrl(i));
        expect(tiles.deletes.length).toBe(afterFirst);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// 1.2 — l'échappatoire de pression
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("1.2 — sous pression du quota d'ORIGINE, le trim devient agressif", () => {
    it("au-delà du seuil de pression, la cible descend bien plus bas que le plafond FIFO", async () => {
        // `estimate()` mesure TOUTE l'origine, pas le cache de tuiles — et c'est ce qui rend
        // ce trim correct : sous pression d'origine, la bonne classe à sacrifier est la
        // re-téléchargeable, exactement la distinction `lru` / `never` du CDC.
        const h = await mountWorker({
            seedTiles: 600,
            declaredMax: 1000, // FIFO seul n'aurait RIEN évincé : 600 < 1000
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

        expect(tiles.puts).toHaveLength(1); // témoin
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
// 1.3 — `QuotaExceededError` cesse d'être avalée
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

        // Le magasin qui a débordé n'est PAS celui qu'on vide : les tuiles sont la classe
        // re-téléchargeable, le script applicatif ne l'est pas au même titre.
        expect(tiles.deletes.length).toBeGreaterThan(0);
        // Un seul retry, et il a réussi → une entrée écrite, pas zéro et pas deux.
        expect(staticCache.puts).toHaveLength(1);
    });

    it("le retry reçoit un corps CONSOMMABLE — sinon le correctif sort vert sans rien réparer", async () => {
        // 🛑 `cache.put` consomme le corps de la réponse qu'on lui donne. Réessayer avec le
        // MÊME objet échoue en « body already used », et le trim aurait tourné pour rien.
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
        // 🛑 Décision explicite, épinglée ici parce que rien d'autre ne la porterait. « Pas de
        // plafond » dit de ne pas tailler *préventivement* ; ici le navigateur vient de REFUSER
        // une écriture. Honorer le `0` reviendrait à ne plus rien mettre en cache du tout,
        // indéfiniment, sur un appareil plein — le chemin de perte même que ce sprint ferme.
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
        // Et le trim de ROUTINE reste bien désactivé : aucune tuile n'a été taillée sans refus.
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
// 1.4 — porter le patron d'éviction, pas le réinventer
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
        // ⚠️ `freedBytes` est délibérément ABSENT : la Cache API ne donne pas la taille d'une
        // entrée, et `engine-signals.ts` omet déjà la taille quand elle manque. Fabriquer un
        // nombre serait pire que se taire.
        expect(detail).not.toHaveProperty("freedBytes");
        expect(detail.store).toBe("cache-api");
    });

    it("un trim FIFO de ROUTINE ne remonte PAS — il tourne à chaque panoramique", async () => {
        // Un toast par déplacement de carte apprend à ne plus lire les notifications.
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
// Gardes de SOURCE — ce qu'aucune assertion de comportement n'attrape
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("garde de source — le magasin borné n'a qu'un écrivain", () => {
    it("aucun `.catch(() => {})` ne subsiste sur un `cache.put`", () => {
        // 🛑 C'ÉTAIT LE DÉFAUT : quatre catch vides avalaient le dépassement de quota comme
        // n'importe quoi d'autre. Le worker ne pouvait donc pas savoir qu'il était plein.
        expect(swCoreCode).toMatch(/function cachePut/); // témoin
        expect(swCoreCode).not.toMatch(/cache\.put\([\s\S]{0,80}?\)\.catch\(\(\) => \{\}\)/);
    });

    it("les quatre stratégies écrivent par `cachePut`, jamais par un `cache.put` nu", () => {
        const strategies = swCoreCode.slice(
            swCoreCode.indexOf("async function cacheFirstStrategy"),
            swCoreCode.indexOf("function isProfileResource")
        );
        expect(strategies.length).toBeGreaterThan(0); // témoin : la tranche n'est pas vide
        const calls = strategies.match(/cachePut\(/g) || [];
        expect(calls).toHaveLength(4);
        // Le seul `cache.put(` restant dans la tranche appartiendrait à un site oublié.
        expect(strategies).not.toMatch(/\bcache\.put\(/);
    });

    it("le plafond de repli et la clé partagée sont écrits UNE fois chacun", () => {
        expect(swCoreCode.match(/const TILE_CACHE_MAX_ENTRIES = /g)).toHaveLength(1);
        expect(swCoreCode.match(/const TILE_BUDGET_KEY = /g)).toHaveLength(1);
    });

    it("la clé de `preferences` dit LA MÊME CHOSE des deux côtés", () => {
        // 🛑 Le worker ne peut pas importer `tile-budget.ts` — il est copié tel quel, sans
        // bundler. Le littéral est donc écrit deux fois, et rien d'autre que cette garde ne
        // verrait les deux diverger : le moteur publierait sous une clé, le worker lirait sous
        // l'autre, et le bornage sortirait silencieusement au repli. C'est EXACTEMENT la forme
        // de la cause racine n° 2 de la roadmap hors-ligne — un nombre écrit des deux côtés,
        // désynchronisé pendant des mois sans qu'aucune suite ne rougisse.
        const swKey = swCoreCode.match(/const TILE_BUDGET_KEY = "([^"]+)"/);
        const modKey = tileBudgetSource.match(/export const TILE_BUDGET_KEY = "([^"]+)"/);
        expect(swKey).not.toBeNull();
        expect(modKey).not.toBeNull();
        expect(swKey![1]).toBe(modKey![1]);
        // Et le préfixe ne se fait pas passer pour un événement : la gate EVENT-MAP scanne
        // les littéraux `geoleaf:*` et prendrait la clé pour un signal non typé.
        expect(swKey![1]).not.toMatch(/^geoleaf:/);
    });

    it("un seul site ÉCRIT dans `CACHE_TILES` — le trim l'ouvre pour supprimer", () => {
        // 🛑 La propriété qui rend le trim sûr. Ce que l'utilisateur télécharge explicitement
        // part en IndexedDB ; seul le chemin opportuniste écrit ici. Un second écrivain
        // (ex. mettre en cache une zone préparée) rendrait le FIFO capable d'emporter du
        // travail de terrain, et cette garde est le seul endroit qui le verrait.
        const opens = swCoreCode.match(/caches\.open\(CACHE_TILES\)/g) || [];
        expect(opens).toHaveLength(2); // `tileCacheStrategy` (lit+écrit) et `cachePut` (taille)

        const trimmer = swCoreCode.slice(
            swCoreCode.indexOf("async function cachePut"),
            swCoreCode.indexOf("async function cacheFirstStrategy")
        );
        expect(trimmer).toMatch(/caches\.open\(CACHE_TILES\)/); // témoin
        // Le magasin de tuiles ouvert par `cachePut` ne sert QU'à `_trimTileCache`.
        expect(trimmer).toMatch(/_trimTileCache\(tiles,/);
        expect(trimmer).not.toMatch(/tiles\.put\(/);
    });
});
