/**
 * Tâche 4.1 — le rapatriement borné, PREMIER ÉCRIVAIN du store `features`.
 *
 * Le store existe depuis 3.4 et a reçu son lecteur en 4.3. `DBFeatures.put` comptait zéro
 * appelant en `src/` : ces tests éprouvent l'écrivain, et surtout les trois propriétés qui ne
 * se voient pas en lisant le code.
 *
 * Tourne contre `fake-indexeddb` — la clé composée `[layerId, localId]`, `IDBKeyRange` et
 * l'index `serverId` sont exactement ce que le mock maison ne sait pas rendre, et
 * `putManyPreservingLocal` ne tient QUE sur ces sémantiques. Import différé pour la même
 * raison que `sync-entry-id.test.js` : les modules doivent charger APRÈS l'installation de
 * `globalThis.indexedDB`.
 *
 * ⚠️ `layer-pull.ts` n'importe volontairement pas `../db/indexeddb.js` : `vitest.config.ts`
 * aliase ce spécificateur vers le mock maison, et l'orchestrateur y aurait écrit dans une
 * fiction. Il passe par `StorageContract.DB`, qu'on câble ici sur la vraie façade.
 */

const DB_NAME = "geoleaf-pull-test";

/** Une entité telle que pygeoapi la sert — mesurée sur le backend de preuve. */
function ogcFeature(id, overrides = {}) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        properties: {
            id,
            local_id: null,
            title: `Site ${id}`,
            updated_at: "2026-08-03T20:41:05.130076+00:00",
            ...overrides,
        },
    };
}

describe("4.1 — rapatriement borné vers le store `features`", () => {
    let IndexedDB;
    let StorageContract;
    let pullLayer;
    let PULL_STATE_KEY;
    let fetchSpy;
    let layerConfigs;
    let open;

    function request(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    const readFeatures = () =>
        request(
            IndexedDB._db.transaction(["features"], "readonly").objectStore("features").getAll()
        );

    const countOutbox = () =>
        request(IndexedDB._db.transaction(["outbox"], "readonly").objectStore("outbox").count());

    /** Sert `n` entités, paginées comme pygeoapi (`limit` fixé à 10 côté serveur). */
    function serveFeatures(features, pageSize = 10) {
        fetchSpy = vi.fn(async (url) => {
            const parsed = new URL(String(url));
            const offset = Number(parsed.searchParams.get("offset") ?? 0);
            const page = features.slice(offset, offset + pageSize);
            const next = offset + pageSize < features.length;
            parsed.searchParams.set("offset", String(offset + pageSize));
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    type: "FeatureCollection",
                    numberMatched: features.length,
                    numberReturned: page.length,
                    features: page,
                    links: next
                        ? [{ rel: "next", href: parsed.toString() }]
                        : [{ rel: "self", href: String(url) }],
                }),
            };
        });
        globalThis.fetch = fetchSpy;
    }

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ pullLayer } = await import("../../../src/capabilities/offline/pull/layer-pull.js"));
        // La CLÉ vient du module, elle n'est pas recopiée : un littéral en double ici
        // laisserait le test vert si la clé de production changeait.
        ({ PULL_STATE_KEY } = await import(
            "../../../src/capabilities/offline/report/pull-state.js"
        ));
    });

    beforeEach(async () => {
        open = [];
        layerConfigs = [
            {
                id: "sites_rosario",
                offline: {
                    enabled: true,
                    maxFeatures: 5000,
                    source: { url: "https://backend.test/ogc" },
                },
            },
            { id: "villes_principales", offline: { enabled: true, maxFeatures: 5000 } },
        ];
        // ⚠️ LA FORME EST CELLE QU'ON A MESURÉE EN NAVIGATEUR, pas celle qu'on espérait.
        // La 1ʳᵉ rédaction moquait `Config.Profile.getActiveProfileLayersConfig()` : le
        // module `Config` porte bien cette méthode, mais le sous-objet `Profile` n'est PAS
        // monté sur `globalThis.GeoLeaf.Config` — et ce test était vert pendant que la sonde
        // navigateur rendait `refused: "layerUnknown"`. Un mock choisi par l'auteur du code
        // qu'il éprouve ne prouve rien de plus que sa propre cohérence.
        globalThis.GeoLeaf = {
            Config: { getActiveProfile: () => ({ layers: layerConfigs }) },
        };
        // ⚠️ `close()` et non `_db = null` : la façade CACHE les instances de sous-modules
        // dans `_modules`, liées à la connexion qui les a créées. Remettre `_db` à la main
        // laisse ce cache en place, et un autre fichier de test qui ouvre sa propre base
        // écrit alors dans la connexion PRÉCÉDENTE. `close()` vide les deux — c'est
        // l'invariant que la façade tient déjà, et le contourner l'a fait mentir.
        IndexedDB.close();
        IndexedDB._dbName = DB_NAME;
        await IndexedDB.init();
        open.push(IndexedDB._db);
        StorageContract.init({
            get DB() {
                return IndexedDB;
            },
            isAvailable: () => true,
        });
    });

    afterEach(async () => {
        for (const db of open) db.close();
        IndexedDB.close();
        delete globalThis.GeoLeaf;
        await new Promise((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    // ── ① la forme de ce qui est écrit ────────────────────────────────────────────────────
    test("écrit un enregistrement par entité, clé composée, `synced`, `serverId` et `version`", async () => {
        serveFeatures([ogcFeature(1), ogcFeature(2), ogcFeature(3)]);

        const report = await pullLayer("sites_rosario");

        expect(report.refused).toBeNull();
        expect(report.fetched).toBe(3);
        expect(report.written).toBe(3);

        const stored = await readFeatures();
        expect(stored).toHaveLength(3);
        for (const record of stored) {
            expect(record.layerId).toBe("sites_rosario");
            expect(record.syncState).toBe("synced");
            expect(record.serverId).toBeTruthy();
            // ⚠️ `feature` DOIT être peuplé : `getLayerFeatureCollection` décide son `null`
            // sur `records.length === 0`, AVANT de filtrer les `feature` indéfinis. Un lot
            // écrit sans géométrie lui ferait rendre une collection vide et NON nulle, et le
            // chargeur afficherait zéro entité en croyant avoir lu.
            expect(record.feature).toBeTruthy();
            expect(record.version).toEqual({
                kind: "timestamp",
                value: "2026-08-03T20:41:05.130076+00:00",
            });
            // Le marqueur serveur va dans `version`, JAMAIS dans `updatedAt` — que le
            // contrat documente comme un horodatage LOCAL.
            expect(typeof record.updatedAt).toBe("number");
        }

        // Et le lecteur de 4.3 les relit par le même chemin.
        const collection = await IndexedDB.getLayerFeatureCollection("sites_rosario");
        expect(collection.features).toHaveLength(3);
    });

    // ── ② le plafond est DUR ──────────────────────────────────────────────────────────────
    test("plafond DUR : le loader rend 20, `maxFeatures: 15` en écrit 15 et le dit", async () => {
        layerConfigs[0].offline.maxFeatures = 15;
        serveFeatures(
            Array.from({ length: 40 }, (_, i) => ogcFeature(i + 1)),
            10
        );

        const report = await pullLayer("sites_rosario");

        // `ogc-api-loader` coupe APRÈS avoir accumulé une page entière et ne tronque jamais :
        // il rend 20 pour un plafond de 15. Sans la troncature de l'orchestrateur, le store
        // porterait 20 enregistrements et le rapport sortirait vert.
        expect(report.fetched).toBe(20);
        expect(report.written).toBe(15);
        expect(report.capped).toBe(true);
        expect(await readFeatures()).toHaveLength(15);
    });

    // ── ③ une saisie non synchronisée n'est JAMAIS écrasée ────────────────────────────────
    test("un enregistrement `pending` survit au rapatriement et est compté `preserved`", async () => {
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites_rosario",
            localId: "srv:2",
            serverId: "2",
            syncState: "pending",
            updatedAt: 1,
            version: null,
            feature: { type: "Feature", properties: { title: "SAISIE DE TERRAIN" } },
        });

        serveFeatures([ogcFeature(1), ogcFeature(2), ogcFeature(3)]);
        const report = await pullLayer("sites_rosario");

        expect(report.preserved).toBe(1);
        expect(report.written).toBe(2);

        const kept = (await readFeatures()).find((r) => r.localId === "srv:2");
        expect(kept.syncState).toBe("pending");
        expect(kept.feature.properties.title).toBe("SAISIE DE TERRAIN");
    });

    // ── ④ invariant S6 — le rapatriement ne confère pas l'éditabilité ─────────────────────
    test("l'`outbox` reste vide après un rapatriement (invariant S6)", async () => {
        serveFeatures([ogcFeature(1), ogcFeature(2)]);
        await pullLayer("sites_rosario");
        expect(await countOutbox()).toBe(0);
    });

    // ── ⑤ identité et idempotence ─────────────────────────────────────────────────────────
    test("re-rapatrier ne duplique rien, et l'identité cliente du serveur l'emporte", async () => {
        serveFeatures([ogcFeature(1), ogcFeature(2)]);
        await pullLayer("sites_rosario");
        await pullLayer("sites_rosario");
        expect(await readFeatures()).toHaveLength(2);

        // La ligne 1 GAGNE un `local_id` côté serveur (ce que fera le push de 4.5). Sans le
        // départage par `serverId`, la dérivation `srv:1` produirait un SECOND enregistrement
        // pour la même entité.
        serveFeatures([ogcFeature(1, { local_id: "client-abc" }), ogcFeature(2)]);
        await pullLayer("sites_rosario");

        const stored = await readFeatures();
        expect(stored).toHaveLength(2);
        expect(stored.map((r) => r.localId).sort()).toEqual(["srv:1", "srv:2"]);
    });

    // ── ⑥ un refus se DIT ─────────────────────────────────────────────────────────────────
    test("une couche sans `offline.source` refuse en nommant son motif, sans requête", async () => {
        serveFeatures([ogcFeature(1)]);
        const report = await pullLayer("villes_principales");

        expect(report.refused).toBe("noSource");
        expect(report.written).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("une couche absente du profil refuse en `layerUnknown`", async () => {
        serveFeatures([ogcFeature(1)]);
        expect((await pullLayer("inexistante")).refused).toBe("layerUnknown");
    });

    test("une source injoignable refuse en `sourceUnreachable` et n'écrit rien", async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
        const report = await pullLayer("sites_rosario");

        expect(report.refused).toBe("sourceUnreachable");
        expect(await readFeatures()).toHaveLength(0);
    });

    // ── ⑦ le moteur absent se DIT aussi, et ne pend pas ───────────────────────────────────
    test("sans moteur de stockage, le rapport dit `engineUnavailable`", async () => {
        StorageContract.init({
            get DB() {
                return null;
            },
            isAvailable: () => false,
        });
        serveFeatures([ogcFeature(1)]);

        const report = await pullLayer("sites_rosario");
        expect(report.refused).toBe("engineUnavailable");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    // ── ⑧ une entité sans identité serveur est ÉCARTÉE, jamais en silence ─────────────────
    test("une entité sans identité serveur est comptée `skipped`", async () => {
        const orphan = ogcFeature(2);
        delete orphan.id;
        delete orphan.properties.id;
        serveFeatures([ogcFeature(1), orphan]);

        const report = await pullLayer("sites_rosario");
        expect(report.skipped).toBe(1);
        expect(report.written).toBe(1);
    });

    // ── ⑨ l'emprise et le plafond partent bien sur le fil ─────────────────────────────────
    test("l'emprise de l'appel est posée sur la requête", async () => {
        serveFeatures([ogcFeature(1)]);
        await pullLayer("sites_rosario", { bbox: [-60.66, -32.95, -60.62, -32.93] });

        const url = new URL(String(fetchSpy.mock.calls[0][0]));
        expect(url.searchParams.get("bbox")).toBe("-60.66,-32.95,-60.62,-32.93");
        // `collectionId` absent du profil ⇒ l'identifiant de couche.
        expect(url.pathname).toContain("/collections/sites_rosario/items");
    });

    test("un abandon rend un lot PARTIEL, et le rapport le dit", async () => {
        const controller = new AbortController();
        serveFeatures(
            Array.from({ length: 40 }, (_, i) => ogcFeature(i + 1)),
            10
        );
        const wrapped = fetchSpy;
        globalThis.fetch = vi.fn(async (url, init) => {
            const response = await wrapped(url, init);
            controller.abort();
            return response;
        });

        const report = await pullLayer("sites_rosario", { signal: controller.signal });

        // `fetchOgcApiFeatures` rend une collection partielle par le MÊME chemin qu'un succès,
        // sans marqueur : `aborted` est relu sur le signal, jamais dérivé du retour.
        expect(report.aborted).toBe(true);
        expect(report.fetched).toBe(10);
        expect(report.written).toBe(10);
    });

    // ── le marqueur de rapatriement (tâche 4.8) ───────────────────────────────────────────
    //
    // 🛑 CES DEUX TESTS SONT ICI ET PAS DANS `sync-report.test.js`, ET C'EST LE POINT. Là-bas,
    // le marqueur est écrit à la main par `writePullState` : ces tests-là éprouvent la
    // DÉRIVATION du statut, et resteraient tous verts si `pullLayer` cessait complètement
    // d'écrire son marqueur. Le lien entre le rapatriement et le rapport ne s'éprouve qu'ici,
    // où le vrai `pullLayer` tourne contre une vraie source.

    test("un rapatriement réussi PERSISTE son marqueur — sinon 4.8 ne peut rien distinguer", async () => {
        serveFeatures([ogcFeature(1), ogcFeature(2)]);

        await pullLayer("sites_rosario");

        const state = await IndexedDB.getPreference(PULL_STATE_KEY, null);
        expect(state?.sites_rosario).toMatchObject({ outcome: "ok", written: 2 });
        expect(typeof state.sites_rosario.at).toBe("number");
    });

    test("une source injoignable persiste `failed` — un échec n'est pas une absence d'essai", async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error("network down");
        });

        const report = await pullLayer("sites_rosario");
        expect(report.refused).toBe("sourceUnreachable");

        // Sans cette écriture, la couche retomberait sur `declaredNeverPulled` : le MÊME
        // statut qu'une couche jamais tentée. « On a essayé et la source a dit non » est
        // actionnable ; « on n'a jamais essayé » ne l'est pas. Les confondre efface la
        // différence que la tâche 4.8 existe pour rendre visible.
        const state = await IndexedDB.getPreference(PULL_STATE_KEY, null);
        expect(state?.sites_rosario).toMatchObject({ outcome: "failed", written: 0 });
    });
});
