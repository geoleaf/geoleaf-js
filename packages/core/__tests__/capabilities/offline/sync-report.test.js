/**
 * Tâche 4.8 — le rapport par couche, et le cas qui n'a AUCUN observable jusqu'à la coupure.
 *
 * Le contrat déclarait `LayerSyncReport` / `LayerOfflineStatus` depuis l'Étape 1bis et rien ne
 * les implémentait — mesuré au pré-vol du 04/08 : zéro implémenteur hors
 * `contracts/sync.contract.ts`.
 *
 * 🛑 **CE QUE CES TESTS EXISTENT POUR ÉPROUVER, ET QU'UN DÉCOMPTE NE PEUT PAS DIRE** : une
 * couche déclarée hors-ligne dont le rapatriement a rendu ZÉRO entité est, dans le magasin,
 * strictement indiscernable d'une couche jamais rapatriée. Les deux comptent 0. C'est
 * pourquoi le rapport s'appuie sur un marqueur PERSISTÉ et non sur le contenu du store — et
 * c'est le premier test ci-dessous qui le tient.
 *
 * Tourne contre `fake-indexeddb` et la VRAIE façade : `getSyncCounts` traverse deux magasins
 * v4 (`features`, `outbox`) que le mock maison de `vitest.config.ts` ne porte pas. Un test qui
 * moquerait la façade éprouverait sa propre cohérence, pas le code.
 */

const DB_NAME = "geoleaf-sync-report-test";

describe("4.8 — rapport de synchronisation par couche", () => {
    let IndexedDB;
    let StorageContract;
    let buildSyncReport;
    let deriveStatus;
    let writePullState;
    let applyEdit;
    let layerConfigs;
    let open;

    const byId = (report, layerId) => report.find((r) => r.layerId === layerId);

    // Une création SANS géométrie est refusée (`geometryRequired`) — la garde vit dans le
    // core, seul endroit qui lit la déclaration de couche. On fournit donc du réel.
    const point = { type: "Point", coordinates: [-60.64, -32.94] };

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ buildSyncReport, deriveStatus } = await import(
            "../../../src/capabilities/offline/report/sync-report.js"
        ));
        ({ writePullState } = await import(
            "../../../src/capabilities/offline/report/pull-state.js"
        ));
        ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    });

    beforeEach(async () => {
        open = [];
        // ⚠️ Le bloc `edition` est INDISPENSABLE sur les deux premières, et son absence a
        // fait rougir la 1ʳᵉ rédaction de ce fichier : `applyEdit` refuse `layerNotEditable`
        // au nom de l'invariant S6 (rapatrier n'accorde JAMAIS l'éditabilité). Le test
        // assertait alors 2 contre 0 — la garde faisait son travail, pas la fixture le sien.
        layerConfigs = [
            {
                id: "sites_rosario",
                edition: { create: true, update: true },
                offline: { enabled: true, maxFeatures: 5000 },
            },
            {
                id: "villes_principales",
                edition: { create: true, update: true },
                offline: { enabled: true },
            },
            { id: "communes", write: { dialect: "collection" } },
        ];
        // La surface RÉELLEMENT montée, mesurée en navigateur au cours de 4.1 :
        // `Config.getActiveProfile()`, et non `Config.Profile.getActiveProfileLayersConfig()`.
        globalThis.GeoLeaf = {
            Config: {
                get: (key, dflt) => (key === "data.activeProfile" ? dflt : dflt),
                getActiveProfile: () => ({ layers: layerConfigs }),
            },
        };
        // `close()` et non `_db = null` : la façade cache ses sous-modules par connexion.
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

    // ── ① LE CAS QUE LA TÂCHE EXISTE POUR RENDRE VISIBLE ──────────────────────────────────

    test("une couche déclarée et jamais rapatriée est `declaredNeverPulled`", async () => {
        const report = await buildSyncReport();

        expect(byId(report, "sites_rosario").status).toBe("declaredNeverPulled");
        expect(byId(report, "sites_rosario").lastPullAt).toBeNull();
        expect(byId(report, "sites_rosario").featureCount).toBe(0);
    });

    test("🛑 un rapatriement qui rend ZÉRO entité n'est PAS `declaredNeverPulled`", async () => {
        // C'est LE test de la tâche. Les deux situations comptent 0 entité dans le magasin :
        // seul le marqueur persisté les sépare. S'il disparaissait, ce test rougirait et
        // celui du dessus resterait vert — c'est-à-dire que le rapport se remettrait à
        // rassurer sur une couche vide qu'on n'a jamais tentée.
        await writePullState(IndexedDB, "sites_rosario", {
            at: 1_700_000_000_000,
            outcome: "ok",
            written: 0,
        });

        const entry = byId(await buildSyncReport(), "sites_rosario");
        expect(entry.status).toBe("pulled");
        expect(entry.featureCount).toBe(0);
        expect(entry.lastPullAt).toBe(1_700_000_000_000);
    });

    test("une source injoignable rend `pullFailed`, pas `declaredNeverPulled`", async () => {
        await writePullState(IndexedDB, "sites_rosario", {
            at: 1_700_000_000_000,
            outcome: "failed",
            written: 0,
        });

        expect(byId(await buildSyncReport(), "sites_rosario").status).toBe("pullFailed");
    });

    test("une couche non déclarée est `notDeclared`, quoi qu'il y ait dans le magasin", async () => {
        expect(byId(await buildSyncReport(), "communes").status).toBe("notDeclared");
    });

    // ── ② LA PÉREMPTION NE SE DEVINE PAS ──────────────────────────────────────────────────

    test("sans `maxAgeMs` déclaré, un rapatriement ancien reste `pulled` — jamais périmé", () => {
        const ilYAUnAn = Date.now() - 365 * 24 * 3600 * 1000;
        const state = { at: ilYAUnAn, outcome: "ok", written: 27 };

        expect(deriveStatus(true, state, undefined, Date.now())).toBe("pulled");
    });

    test("avec `maxAgeMs` déclaré, le dépassement rend `pulledStale`", () => {
        const now = 1_700_000_000_000;
        const state = { at: now - 5000, outcome: "ok", written: 27 };

        expect(deriveStatus(true, state, 10_000, now)).toBe("pulled");
        expect(deriveStatus(true, state, 1_000, now)).toBe("pulledStale");
    });

    test("`notDeclared` prime sur tout — l'ordre des tests n'est pas commutatif", () => {
        const state = { at: 0, outcome: "failed", written: 0 };
        expect(deriveStatus(false, state, 1, 1_000_000)).toBe("notDeclared");
    });

    // ── ③ LES DÉCOMPTES TRAVERSENT LES DEUX MAGASINS ──────────────────────────────────────

    test("`pendingCount` compte la dette réelle, et n'attribue rien à la mauvaise couche", async () => {
        await writePullState(IndexedDB, "sites_rosario", {
            at: 1_700_000_000_000,
            outcome: "ok",
            written: 2,
        });
        // Deux saisies sur une couche, une sur l'autre : si le regroupement par `layerId`
        // était faux, le total serait juste et la RÉPARTITION fausse — ce qu'un test qui ne
        // regarde que la somme laisserait passer.
        await applyEdit({
            layerId: "sites_rosario",
            kind: "create",
            localId: "a",
            feature: { type: "Feature", geometry: point, properties: {} },
        });
        await applyEdit({
            layerId: "sites_rosario",
            kind: "create",
            localId: "b",
            feature: { type: "Feature", geometry: point, properties: {} },
        });
        await applyEdit({
            layerId: "villes_principales",
            kind: "create",
            localId: "c",
            feature: { type: "Feature", geometry: point, properties: {} },
        });

        const report = await buildSyncReport();
        expect(byId(report, "sites_rosario").pendingCount).toBe(2);
        expect(byId(report, "villes_principales").pendingCount).toBe(1);
        expect(byId(report, "communes").pendingCount).toBe(0);

        // Les entités saisies sont dans `features` : le décompte les voit.
        expect(byId(report, "sites_rosario").featureCount).toBe(2);
    });

    test("une couche du profil est toujours rapportée, même sans rien dans les magasins", async () => {
        const report = await buildSyncReport();
        expect(report.map((r) => r.layerId)).toEqual([
            "sites_rosario",
            "villes_principales",
            "communes",
        ]);
    });

    // ── ④ LE REPLI ALERTE, IL NE RASSURE PAS ──────────────────────────────────────────────

    test("sans moteur de stockage, le rapport reste `declaredNeverPulled` — pas `pulled`", async () => {
        StorageContract.init({
            get DB() {
                return null;
            },
            isAvailable: () => false,
        });

        const report = await buildSyncReport();
        expect(byId(report, "sites_rosario").status).toBe("declaredNeverPulled");
        expect(byId(report, "sites_rosario").featureCount).toBe(0);
    });

    test("sans profil actif, le rapport est vide et ne jette pas", async () => {
        globalThis.GeoLeaf = { Config: { get: (_k, d) => d } };
        await expect(buildSyncReport()).resolves.toEqual([]);
    });

    // ── ⑤ B-121 — `getStorageStats` ne voyait pas les magasins v4 ─────────────────────────

    test("B-121 — `features` et `outbox` sont comptés, pas seulement les magasins v3", async () => {
        // 🛑 CE TEST EST ICI, ET PAS DANS `db-modules.test.js`, PAR MESURE. Là-bas
        // `getStorageStats` tourne contre `makeIDB()`, un mock dont `ensureStore` CRÉE tout
        // magasin qu'on lui demande — il aurait donc rendu vert une transaction sur quatre
        // magasins même si le schéma réel n'en portait que deux. Son propre commentaire le
        // dit : `features: null, // composite — not exercised here`. Ici, la base est celle
        // que `_upgradeDatabase` construit vraiment.
        //
        // ⚠️ Et il asserte une VALEUR, pas une forme. Le test de forme qui existait
        // (`toHaveProperty("layersCount")`) serait resté vert sur un compteur bloqué à 0 —
        // ce qui était exactement le défaut : après un rapatriement de 27 entités,
        // `getStats()` rapportait toujours 0.
        const before = await IndexedDB.getStorageStats();
        expect(before.featuresCount).toBe(0);
        expect(before.outboxCount).toBe(0);

        await applyEdit({
            layerId: "sites_rosario",
            kind: "create",
            localId: "a",
            feature: { type: "Feature", geometry: point, properties: {} },
        });

        const after = await IndexedDB.getStorageStats();
        expect(after.featuresCount).toBe(1);
        expect(after.outboxCount).toBe(1);
    });

    // ── ⑥ 4.10 — la purge ne touche QUE le cache, et l'export ne rate rien ────────────────

    describe("4.10 — le cache se purge, le travail ne se purge jamais", () => {
        /** Écrit une entité déjà synchronisée : du CACHE, re-rapatriable par `pullLayer()`. */
        const seedSynced = (localId, layerId = "sites_rosario") =>
            IndexedDB.putLayerFeatures([
                {
                    layerId,
                    localId,
                    serverId: `srv-${localId}`,
                    syncState: "synced",
                    updatedAt: 1,
                    version: null,
                    feature: { type: "Feature", geometry: point, properties: { localId } },
                },
            ]);

        test("purge les entités `synced` et rapporte son décompte", async () => {
            await seedSynced("a");
            await seedSynced("b");

            const tally = await IndexedDB.purgeCachedFeatures();

            expect(tally).toEqual({ removed: 2, preserved: 0 });
            expect((await IndexedDB.getStorageStats()).featuresCount).toBe(0);
        });

        test("🛑 NE TOUCHE PAS une saisie en attente — ni son entité, ni son entrée", async () => {
            await seedSynced("a");
            await applyEdit({
                layerId: "sites_rosario",
                kind: "create",
                localId: "terrain",
                feature: { type: "Feature", geometry: point, properties: {} },
            });

            const tally = await IndexedDB.purgeCachedFeatures();

            // Seule l'entité de cache part. La saisie de terrain n'a AUCUNE autre copie :
            // c'est la propriété 1 du contrat, « une capture ne disparaît jamais ».
            expect(tally.removed).toBe(1);
            const stats = await IndexedDB.getStorageStats();
            expect(stats.featuresCount).toBe(1);
            expect(stats.outboxCount).toBe(1);
        });

        test("épargne une entité `synced` que l'outbox réclame encore, et le DIT", async () => {
            // L'invariant de 4.4 rend ce cas théoriquement impossible — `applyEdit` écrit
            // l'entité en `pending` en même temps que son entrée. On le fabrique donc à la
            // main : une garde qui ne s'éprouve que sur des états que le code produit déjà
            // n'éprouve rien. C'est celle-ci qui empêche une destruction irréversible si
            // l'invariant venait à céder.
            await applyEdit({
                layerId: "sites_rosario",
                kind: "create",
                localId: "divergente",
                feature: { type: "Feature", geometry: point, properties: {} },
            });
            // ⚠️ ÉCRITURE DIRECTE, et le détour est la preuve que l'invariant tient :
            // `putLayerFeatures` a REFUSÉ de repasser cet enregistrement en `synced`
            // (`putManyPreservingLocal` n'écrase jamais une saisie non synchronisée, règle
            // de 4.1) — la 1ʳᵉ rédaction de ce test échouait exactement là. L'état divergent
            // n'est donc pas atteignable par l'API ; on le fabrique au niveau du magasin,
            // sinon la garde de `purgeCachedFeatures` ne serait jamais éprouvée.
            await new Promise((resolve, reject) => {
                const tx = IndexedDB._db.transaction(["features"], "readwrite");
                tx.objectStore("features").put({
                    layerId: "sites_rosario",
                    localId: "divergente",
                    serverId: "srv-divergente",
                    syncState: "synced",
                    updatedAt: 1,
                    version: null,
                    feature: { type: "Feature", geometry: point, properties: {} },
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            const tally = await IndexedDB.purgeCachedFeatures();

            expect(tally).toEqual({ removed: 0, preserved: 1 });
            expect((await IndexedDB.getStorageStats()).featuresCount).toBe(1);
        });

        test("l'export rend les saisies dues, jointes à leur entité", async () => {
            await seedSynced("deja-la");
            await applyEdit({
                layerId: "sites_rosario",
                kind: "create",
                localId: "terrain",
                feature: { type: "Feature", geometry: point, properties: { nom: "cabane" } },
            });

            const pending = await IndexedDB.listPendingEdits();

            // ⚠️ Une entité `synced` sans entrée d'outbox n'est PAS une saisie due : elle est
            // déjà chez le serveur. L'export ne doit pas la faire passer pour du travail.
            expect(pending).toHaveLength(1);
            expect(pending[0]).toMatchObject({
                kind: "create",
                layerId: "sites_rosario",
                localId: "terrain",
                state: "pending",
            });
            expect(pending[0].feature.properties.nom).toBe("cabane");
        });
    });
});
