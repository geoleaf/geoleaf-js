/**
 * The per-layer report, and the case with NO observable until the cutoff.
 *
 * The contract had declared `LayerSyncReport` / `LayerOfflineStatus` with
 * nothing implementing them — measured at the preflight of 04/08: zero
 * implementers outside `contracts/sync.contract.ts`.
 *
 * 🛑 **WHAT THESE TESTS EXIST TO EXERCISE, AND A TALLY CANNOT SAY**: a layer
 * declared offline whose pull returned ZERO entities is, in the store,
 * strictly indistinguishable from a never-pulled layer. Both count 0. That is
 * why the report leans on a PERSISTED marker and not on the store's content —
 * and the first test below is what holds it.
 *
 * Runs against `fake-indexeddb` and the REAL facade: `getSyncCounts` crosses
 * two v4 stores (`features`, `outbox`) the home-made mock of
 * `vitest.config.ts` does not carry. A test mocking the facade would exercise
 * its own consistency, not the code.
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

    // A creation WITHOUT geometry is refused (`geometryRequired`) — the guard
    // lives in the core, the only place reading the layer declaration. So we provide real data.
    const point = { type: "Point", coordinates: [-60.64, -32.94] };

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ buildSyncReport, deriveStatus } =
            await import("../../../src/capabilities/offline/report/sync-report.js"));
        ({ writePullState } =
            await import("../../../src/capabilities/offline/report/pull-state.js"));
        ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    });

    beforeEach(async () => {
        open = [];
        // ⚠️ The `edition` block is INDISPENSABLE on the first two, and its
        // absence turned this file's 1st draft red: `applyEdit` refuses
        // `layerNotEditable` in the name of the editability invariant (pulling
        // NEVER grants editability). The test then asserted 2 against 0 — the
        // guard did its job, the fixture did not do its own.
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
        // The surface REALLY mounted, measured in the browser:
        // `Config.getActiveProfile()`, and not `Config.Profile.getActiveProfileLayersConfig()`.
        globalThis.GeoLeaf = {
            Config: {
                get: (key, dflt) => (key === "data.activeProfile" ? dflt : dflt),
                getActiveProfile: () => ({ layers: layerConfigs }),
            },
        };
        // `close()` and not `_db = null`: the facade caches its sub-modules per connection.
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

    // ── ① THE CASE THIS FEATURE EXISTS TO MAKE VISIBLE ───────────────────────────────────

    test("une couche déclarée et jamais rapatriée est `declaredNeverPulled`", async () => {
        const report = await buildSyncReport();

        expect(byId(report, "sites_rosario").status).toBe("declaredNeverPulled");
        expect(byId(report, "sites_rosario").lastPullAt).toBeNull();
        expect(byId(report, "sites_rosario").featureCount).toBe(0);
    });

    test("🛑 un rapatriement qui rend ZÉRO entité n'est PAS `declaredNeverPulled`", async () => {
        // THE test of the feature. Both situations count 0 entities in the
        // store: only the persisted marker separates them. If it vanished,
        // this test would turn red and the one above would stay green — i.e.
        // the report would go back to reassuring about an empty layer never attempted.
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

    // ── ② STALENESS IS NOT GUESSED ───────────────────────────────────────────────────────

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

    // ── ③ THE TALLIES CROSS BOTH STORES ──────────────────────────────────────────────────

    test("`pendingCount` compte la dette réelle, et n'attribue rien à la mauvaise couche", async () => {
        await writePullState(IndexedDB, "sites_rosario", {
            at: 1_700_000_000_000,
            outcome: "ok",
            written: 2,
        });
        // Two captures on one layer, one on the other: if the `layerId`
        // grouping were wrong, the total would be right and the SPLIT wrong —
        // what a sum-only test would let through.
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

        // The captured entities are in `features`: the tally sees them.
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

    // ── ④ THE FALLBACK WARNS, IT DOES NOT REASSURE ───────────────────────────────────────

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

    // ── ⑤ `getStorageStats` did not see the v4 stores ────────────────────────────

    test("`features` et `outbox` sont comptés, pas seulement les magasins v3", async () => {
        // 🛑 THIS TEST IS HERE, AND NOT IN `db-modules.test.js`, BY
        // MEASUREMENT. There `getStorageStats` runs against `makeIDB()`, a
        // mock whose `ensureStore` CREATES any store asked of it — it would
        // thus have greenlit a transaction over four stores even if the real
        // schema carried only two. Its own comment says so:
        // `features: null, // composite — not exercised here`. Here, the base
        // is the one `_upgradeDatabase` really builds.
        //
        // ⚠️ And it asserts a VALUE, not a shape. The shape test that existed
        // (`toHaveProperty("layersCount")`) would have stayed green on a
        // counter stuck at 0 — which was exactly the defect: after a pull of
        // 27 entities, `getStats()` still reported 0.
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

    // ── ⑥ the purge touches ONLY the cache, and the export misses nothing ───────────────

    describe("4.10 — le cache se purge, le travail ne se purge jamais", () => {
        /** Writes an already-synced entity: CACHE, re-pullable by `pullLayer()`. */
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

            // Only the cache entity leaves. The field capture has NO other
            // copy: the contract's property 1, "a capture never disappears".
            expect(tally.removed).toBe(1);
            const stats = await IndexedDB.getStorageStats();
            expect(stats.featuresCount).toBe(1);
            expect(stats.outboxCount).toBe(1);
        });

        test("épargne une entité `synced` que l'outbox réclame encore, et le DIT", async () => {
            // The write invariant makes this case theoretically impossible —
            // `applyEdit` writes the entity as `pending` together with its
            // entry. So we forge it by hand: a guard exercised only on states
            // the code already produces exercises nothing. This one is what
            // prevents an irreversible destruction should the invariant give way.
            await applyEdit({
                layerId: "sites_rosario",
                kind: "create",
                localId: "divergente",
                feature: { type: "Feature", geometry: point, properties: {} },
            });
            // ⚠️ DIRECT WRITE, and the detour is the proof the invariant
            // holds: `putLayerFeatures` REFUSED to flip this record back to
            // `synced` (`putManyPreservingLocal` never overwrites an unsynced
            // capture) — this test's 1st draft failed exactly there. The
            // divergent state is thus unreachable through the API; we forge it
            // at store level, otherwise `purgeCachedFeatures`'s guard would
            // never be exercised.
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

            // ⚠️ A `synced` entity without an outbox entry is NOT owed work:
            // it is already at the server. The export must not pass it off as work.
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
