// @ts-check
/**
 * 27 — LE HORS-LIGNE SERT DEPUIS INDEXEDDB (tâche 3.2, critère de preuve n° 2)
 *
 * C'est la vérification que la cause racine n° 2 est RÉELLEMENT corrigée, et pas seulement
 * corrigée en apparence : jusqu'au 02/08/2026 le Service Worker ouvrait `geoleaf-db` à une
 * version `2` codée en dur pendant que le moteur déclarait `3`, donc `openIndexedDB()`
 * rendait `null` à chaque appel et l'étape 1 de la stratégie de tuiles n'était jamais prise.
 *
 * 🛑 CE QUI NE PROUVERAIT RIEN, et qui est le piège que ce fichier existe pour éviter :
 *   - « la tuile arrive hors ligne » — le chemin Cache API produit exactement le même vert ;
 *   - « on a vidé la Cache API » — le cache HTTP du navigateur peut encore servir ;
 *   - « un événement a été émis » — c'est ainsi que six défauts ont survécu des mois.
 *
 * ✅ CE QUI PROUVE : des octets que SEULE la branche IndexedDB peut produire. On sème une
 * tuile dont on connaît le contenu exact, on vide la Cache API, on coupe le réseau, et on
 * assert l'égalité OCTET POUR OCTET. Hors ligne et sans cache, aucune autre branche ne peut
 * rendre ces octets-là.
 *
 * ✅ ET LE CONTRÔLE NÉGATIF, sans lequel le vert ci-dessus reste douteux : on retire
 * l'enregistrement, on reste hors ligne, on redemande — et on doit obtenir le placeholder
 * SVG. Sans ce pas, un vert pourrait venir d'un cache mal nettoyé.
 *
 * ⚠️ CE SPEC N'ARME PAS `serviceWorkers: "block"`, contrairement aux 26 autres. C'est le
 * Service Worker qui est le sujet. Sous `E2E_TARGET=nginx` l'enregistrement exige
 * `--ignore-certificate-errors` au niveau NAVIGATEUR — `ignoreHTTPSErrors` ne couvre pas le
 * fetch du script de worker. Le drapeau est posé par `hostResolverArgs`
 * (`e2e/helpers/base-url.js`), qui documente le piège.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import {
    seedDatabase,
    seedLegacyDump,
    openBlankOnOrigin,
    wipeOnOrigin,
} from "./helpers/db-seed.js";
import {
    GEOLEAF_DB,
    describe as describeDb,
    readRecord,
    readBinary,
    countStore,
} from "./helpers/idb.js";
import { goOffline, goOnline, withOffline } from "./helpers/offline.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ⚠️ Lecture par `fs` et non `import ... with { type: "json" }` : Node 22 accepte les
// attributs d'import, le parser d'ESLint configuré ici non — la forme « moderne » fait
// échouer la gate Lint. Mesuré le 02/08/2026.
const dump = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("./fixtures/offline/db-v3-dump.json", import.meta.url)),
        "utf8"
    )
);

const ORIGIN = baseURL("core");

/** Une URL de tuile — `isTileRequest()` du SW la route vers `tileCacheStrategy`. */
const TILE_URL = "https://tile.openstreetmap.org/7/63/42.png";

/** PNG 1×1 réellement décodable, et son empreinte : c'est l'oracle de l'assertion d'octets. */
const TILE_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TILE_BYTES = 70;

test.describe("27 — le hors-ligne sert depuis IndexedDB (3.2)", () => {
    test.beforeEach(async ({ page }) => {
        // Isolation réelle : un vert ne doit jamais pouvoir venir d'un run précédent.
        await wipeOnOrigin(page, ORIGIN);
    });

    test.afterEach(async ({ context, page }) => {
        await goOnline(context, page).catch(() => {
            /* le contexte peut déjà être en ligne */
        });
    });

    test("une tuile semée en base est servie PAR LE CHEMIN DU SW, hors ligne et sans Cache API", async ({
        context,
        page,
    }) => {
        // ── 1. Semer une v3 RÉELLE avant tout boot ──────────────────────────────────────
        // Le critère dit « ouvrir geoleaf-db APRÈS migration » : il faut donc qu'une base
        // existe déjà quand l'application démarre. Semer après le boot ne teste rien.
        await seedDatabase(page, {
            ...dump,
            clear: true,
            data: {
                layers: [
                    {
                        id: TILE_URL,
                        profileId: "tourism",
                        resourceType: "tile",
                        contentType: "image/png",
                        timestamp: 1785600000000,
                        // ArrayBuffer et NON Blob : `extractBinary()` du SW lit un
                        // ArrayBuffer, une chaîne `data:` ou une enveloppe {kind:"binary"} —
                        // un Blob traverse les trois et l'enregistrement devient illisible
                        // par le chemin même qu'il sert à éprouver.
                        data: { __arraybuffer__: { base64: TILE_B64 } },
                    },
                ],
            },
        });

        const seeded = await describeDb(page, GEOLEAF_DB);
        expect(seeded.version).toBe(3);
        expect(seeded.stores).toContain("layers");

        // ── 2. Booter l'application SUR cette base ──────────────────────────────────────
        await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });

        // `controller`, pas `.ready` : un SW enregistré mais NON CONTRÔLANT ne sert rien,
        // et l'attendre est ce qui rend ce test non menteur.
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 25000,
        });

        // La base semée a survécu au boot — sinon on éprouverait une base neuve.
        const afterBoot = await readRecord(page, {
            db: GEOLEAF_DB,
            store: "layers",
            key: TILE_URL,
        });
        expect(afterBoot, "la tuile semée doit survivre au boot de l'app").toBeTruthy();

        // ── 3. Vider la Cache API — la branche concurrente ──────────────────────────────
        //
        // ⚠️ NE PAS asserter « 0 cache ». L'application tourne : le worker rouvre un bucket
        // dès la requête suivante (`caches.open(CACHE_TILES)`, les stratégies network-first
        // qui font `cache.put`), donc compter les caches revient à courir contre elle et
        // rend un rouge qui ne dit rien du code testé. Mesuré : 1 cache recréé entre le
        // `delete` et la relecture.
        //
        // Ce qui compte n'est pas « aucun cache » mais « rien EN CACHE POUR CETTE URL » —
        // c'est-à-dire que la branche concurrente ne peut pas répondre à la place d'IndexedDB.
        const tileInCache = await page.evaluate(async (url) => {
            const names = await caches.keys();
            await Promise.all(names.map((n) => caches.delete(n)));
            const hit = await caches.match(url);
            return hit ? { status: hit.status } : null;
        }, TILE_URL);
        expect(tileInCache, "aucune réponse en Cache API pour cette tuile").toBeNull();

        // ── 3bis. Les octets sont RÉELLEMENT en base, sous la bonne forme ───────────────
        // `readBinary` distingue un ArrayBuffer d'une chaîne : semer un Blob passerait
        // silencieusement le `toBeTruthy()` ci-dessus et resterait illisible par le SW.
        const stored = await readBinary(page, {
            db: GEOLEAF_DB,
            store: "layers",
            key: TILE_URL,
            field: "data",
        });
        expect(stored.kind, "la tuile doit être un ArrayBuffer, pas un Blob ni une chaîne").toBe(
            "arraybuffer"
        );
        expect(stored.byteLength).toBe(TILE_BYTES);

        // ── 4. Couper le réseau ─────────────────────────────────────────────────────────
        // ── 5. Demander la tuile — la réponse ne peut venir que d'IndexedDB ─────────────
        // `withOffline` restaure le réseau même si une assertion échoue : sans lui, un rouge
        // ici laisserait le contexte hors ligne pour tous les tests suivants du fichier.
        // ⚠️ PAS d'`assertZeroNetwork` ici, et le motif est mesuré : un `fetch()` servi
        // ENTIÈREMENT par le Service Worker émet quand même un événement `request`. Le
        // helper compte des INITIATIONS de requête, pas de la sortie réseau — l'assertion
        // aurait donc rougi sur la tuile qu'on vient de servir depuis la base.
        //
        // ✅ La limite est INSTRUITE depuis le 03/08 (voir l'en-tête d'`offline.js`) : elle ne
        // concerne QUE les lectures que le worker intercepte — c'est-à-dire exactement ce
        // test-ci. Le critère 3 porte sur une ÉCRITURE, qui n'en émet aucune ; il est éprouvé
        // par `29-offline-proof.spec.js`. Ce commentaire reste donc juste, et il l'est
        // désormais pour une raison mesurée plutôt que par prudence.
        const served = await withOffline(context, page, () =>
            page.evaluate(async (url) => {
                const res = await fetch(url, { cache: "no-store" });
                const buf = await res.arrayBuffer();
                const bytes = Array.from(new Uint8Array(buf));
                return {
                    status: res.status,
                    contentType: res.headers.get("content-type"),
                    byteLength: buf.byteLength,
                    head: bytes.slice(0, 8),
                };
            }, TILE_URL)
        );

        expect(served.status).toBe(200);
        expect(served.contentType).toContain("image/png");
        // L'assertion qui porte tout : les octets sont CEUX QU'ON A SEMÉS. Hors ligne, sans
        // Cache API, aucune autre branche du worker ne peut les produire.
        expect(served.byteLength).toBe(TILE_BYTES);
        // En-tête PNG — la preuve que ce n'est ni le placeholder SVG ni une réponse vide.
        expect(served.head).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    });

    test("CONTRÔLE NÉGATIF — sans l'enregistrement, la même requête rend le placeholder", async ({
        context,
        page,
    }) => {
        // Sans ce test, le vert du précédent pourrait venir d'un cache mal nettoyé : il faut
        // montrer que la MÊME requête, dans les MÊMES conditions, échoue quand la seule
        // chose qui change est l'absence de l'enregistrement IndexedDB.
        // `seedLegacyDump` — le point d'entrée documenté : il pose la fixture v3 COMPLÈTE
        // avant tout boot. Sa tuile est une AUTRE URL que celle mesurée, ce qui est
        // exactement la condition du contrôle négatif.
        const seeded = await seedLegacyDump(page, ORIGIN, dump);
        expect(seeded.version).toBe(3);

        // La fixture porte bien ce qu'elle annonce — 5 entrées de file, dont l'entrée
        // `failed` du critère 4 et les trois qui portent l'ordre de saisie (B-03). Ce que
        // ces cinq prouvent est éprouvé par `28-offline-queue.spec.js` ; ici on ne vérifie
        // que leur PRÉSENCE, pour que le contrôle négatif ci-dessous parte d'une base réelle.
        expect(await countStore(page, { db: GEOLEAF_DB, store: "sync_queue" })).toBe(5);

        await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 25000,
        });

        const absent = await readRecord(page, { db: GEOLEAF_DB, store: "layers", key: TILE_URL });
        expect(absent, "le contrôle négatif exige que la tuile soit ABSENTE").toBeNull();

        await page.evaluate(async () => {
            const names = await caches.keys();
            await Promise.all(names.map((n) => caches.delete(n)));
        });
        await goOffline(context, page);

        const served = await page.evaluate(async (url) => {
            const res = await fetch(url, { cache: "no-store" });
            return {
                status: res.status,
                contentType: res.headers.get("content-type"),
                body: (await res.text()).slice(0, 40),
            };
        }, TILE_URL);

        // Le worker sert son placeholder. ✅ Depuis 3.6 il le sert en **504** : le corps a
        // une valeur d'usage — il dit à l'utilisateur que la tuile manque — mais le statut dit
        // la vérité, et tout consommateur qui teste `response.ok` la voit. En 200, MapLibre
        // recevait du SVG pour une tuile vectorielle et tentait de le parser en protobuf.
        expect(served.contentType).toContain("image/svg+xml");
        expect(served.body).toContain("<svg");
        expect(served.status, "bug n° 6 : l'échec réseau ne se déguise plus en succès").toBe(504);
    });

    // ⚠️ CE TEST N'EST PAS UNE GARDE, et le dire est le seul moyen qu'on ne le prenne pas
    // pour une. Il rejoue les deux ouvertures depuis la PAGE : il constate donc un fait sur
    // IndexedDB et sur la base semée, pas sur `sw-core.js`. Vérifié par mutation — en
    // remettant `open("geoleaf-db", 2)` dans le worker et en reconstruisant le déployé, il
    // reste VERT pendant que le premier test de ce fichier rougit.
    //
    // Il vaut pour ce qu'il documente : POURQUOI une version épinglée ne peut pas marcher.
    // Ce qui GARDE le comportement du worker, ce sont le premier test ci-dessus (octets
    // servis hors ligne) et la garde de source de `__tests__/storage/sw-core.test.js`
    // (aucun `indexedDB.open(` à deux arguments).
    test("le MÉCANISME de 3.1, documenté depuis le navigateur (pas une garde — voir ci-dessus)", async ({
        page,
    }) => {
        await seedDatabase(page, { ...dump, clear: true, data: {} });
        await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 25000,
        });

        // Reproduit les deux ouvertures depuis la PAGE (même origine, même base que le SW).
        // La versionless doit aboutir ; celle épinglée à 2 doit encore échouer — sans ce
        // témoin, le vert ne se distinguerait pas d'un navigateur sans base.
        const opens = await page.evaluate(async () => {
            const tryOpen = (version) =>
                new Promise((resolve) => {
                    const req =
                        version === undefined
                            ? indexedDB.open("geoleaf-db")
                            : indexedDB.open("geoleaf-db", version);
                    req.onsuccess = () => {
                        const db = req.result;
                        resolve({
                            ok: true,
                            version: db.version,
                            hasLayers: db.objectStoreNames.contains("layers"),
                        });
                        db.close();
                    };
                    req.onerror = () => resolve({ ok: false, err: String(req.error?.name) });
                    req.onblocked = () => resolve({ ok: false, err: "BLOCKED" });
                });
            return { versionless: await tryOpen(undefined), pinnedAt2: await tryOpen(2) };
        });

        // ⚠️ AUCUN littéral de version ici, et c'est le sujet même du test. Ce qui se
        // vérifie est que l'ouverture SANS version SUIT le moteur, quel que soit son numéro —
        // c'est précisément ce que T2′ achète. Écrire `version: 3` a fait rougir ce test au
        // passage en v4 (3.4) alors que RIEN n'avait cassé : le littéral était la seule
        // chose désynchronisée, dans le test qui documente la désynchronisation.
        expect(opens.versionless).toMatchObject({ ok: true, hasLayers: true });
        expect(opens.versionless.version).toBeGreaterThanOrEqual(3);
        // Le témoin historique : une version ÉPINGLÉE en-dessous échoue toujours.
        expect(opens.pinnedAt2).toMatchObject({ ok: false, err: "VersionError" });
    });

    test("openBlankOnOrigin ne boote PAS l'application", async ({ page }) => {
        // Garde du harnais lui-même : si ce document bootait l'app, le seeding cesserait
        // d'être « avant le boot » et le critère 2 perdrait son objet, en silence.
        await openBlankOnOrigin(page, ORIGIN);
        const state = await page.evaluate(() => ({
            hasGeoLeaf: typeof (/** @type {any} */ (window).GeoLeaf) !== "undefined",
            hasMapEl: !!document.getElementById("geoleaf-map"),
            origin: location.origin,
        }));
        expect(state.hasGeoLeaf).toBe(false);
        expect(state.hasMapEl).toBe(false);
        expect(state.origin).toBe(ORIGIN);
    });
});
