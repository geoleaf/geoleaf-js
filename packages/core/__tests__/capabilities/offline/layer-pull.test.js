/**
 * The bounded pull, FIRST WRITER of the `features` store.
 *
 * The store existed and had received its reader. `DBFeatures.put` counted
 * zero callers in `src/`: these tests exercise the writer, and above all the
 * three properties that cannot be seen by reading the code.
 *
 * Runs against `fake-indexeddb` — the composite key `[layerId, localId]`,
 * `IDBKeyRange` and the `serverId` index are exactly what the home-made mock
 * cannot render, and `putManyPreservingLocal` holds ONLY on those semantics.
 * Deferred import for the same reason as `sync-entry-id.test.js`: the modules
 * must load AFTER `globalThis.indexedDB` is installed.
 *
 * ⚠️ `layer-pull.ts` deliberately does not import `../db/indexeddb.js`:
 * `vitest.config.ts` aliases that specifier to the home-made mock, and the
 * orchestrator would have written into a fiction. It goes through
 * `StorageContract.DB`, wired here onto the real facade.
 */

const DB_NAME = "geoleaf-pull-test";

/** An entity as pygeoapi serves it — measured on the reference backend. */
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

    /** Serves `n` entities, paginated like pygeoapi (`limit` fixed at 10 server-side). */
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
        // The KEY comes from the module, it is not copied: a duplicate
        // literal here would leave the test green if the production key changed.
        ({ PULL_STATE_KEY } =
            await import("../../../src/capabilities/offline/report/pull-state.js"));
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
        // ⚠️ THE SHAPE IS THE ONE MEASURED IN THE BROWSER, not the hoped-for
        // one. The 1st draft mocked `Config.Profile.getActiveProfileLayersConfig()`:
        // the `Config` module does carry that method, but the `Profile`
        // sub-object is NOT mounted on `globalThis.GeoLeaf.Config` — and this
        // test was green while the browser probe returned
        // `refused: "layerUnknown"`. A mock chosen by the author of the code
        // it exercises proves nothing beyond its own consistency.
        globalThis.GeoLeaf = {
            Config: { getActiveProfile: () => ({ layers: layerConfigs }) },
        };
        // ⚠️ `close()` and not `_db = null`: the facade CACHES the sub-module
        // instances in `_modules`, bound to the connection that created them.
        // Resetting `_db` by hand leaves that cache in place, and another test
        // file opening its own base then writes into the PREVIOUS connection.
        // `close()` clears both — the invariant the facade already holds, and
        // bypassing it made it lie.
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

    // ── ① the shape of what is written ───────────────────────────────────────────────────
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
            // ⚠️ `feature` MUST be populated: `getLayerFeatureCollection`
            // decides its `null` on `records.length === 0`, BEFORE filtering
            // undefined `feature`s. A batch written without geometry would
            // make it return an empty, NON-null collection, and the loader
            // would display zero entities believing it had read.
            expect(record.feature).toBeTruthy();
            expect(record.version).toEqual({
                kind: "timestamp",
                value: "2026-08-03T20:41:05.130076+00:00",
            });
            // The server marker goes into `version`, NEVER into `updatedAt`
            // — which the contract documents as a LOCAL timestamp.
            expect(typeof record.updatedAt).toBe("number");
        }

        // And the reader re-reads them through the same path.
        const collection = await IndexedDB.getLayerFeatureCollection("sites_rosario");
        expect(collection.features).toHaveLength(3);
    });

    // ── ② the cap is HARD ────────────────────────────────────────────────────────────────
    test("plafond DUR : la source rend 20, `maxFeatures: 15` en écrit 15 et le DIT encore", async () => {
        layerConfigs[0].offline.maxFeatures = 15;
        serveFeatures(
            Array.from({ length: 40 }, (_, i) => ogcFeature(i + 1)),
            10
        );

        const report = await pullLayer("sites_rosario");

        // ⚠️ THIS COMMENT WAS FLIPPED ON 19/08/2026 — its previous version
        // said the loader "never truncates" and returns 20 for a cap of 15.
        // It now truncates, at the exact bound, and signals the cut.
        //
        // 🛑 The three expectations below did not move, and that is the point:
        // `fetched` stays 20 because the report says what the SOURCE returned
        // before the cut, and `capped` stays true because it is now read from
        // the loader's signal. Without that second read, the local comparison
        // would have become permanently false — this module already receiving
        // 15 for a cap of 15 — and the report would have stopped saying a
        // pull is partial, precisely the day the cut became reliable.
        expect(report.fetched).toBe(20);
        expect(report.written).toBe(15);
        expect(report.capped).toBe(true);
        expect(await readFeatures()).toHaveLength(15);
    });

    // ── ③ an unsynced capture is NEVER overwritten ───────────────────────────────────────
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

    // ── ④ editability invariant — pulling does not confer editability ────────────────────
    test("l'`outbox` reste vide après un rapatriement (invariant S6)", async () => {
        serveFeatures([ogcFeature(1), ogcFeature(2)]);
        await pullLayer("sites_rosario");
        expect(await countOutbox()).toBe(0);
    });

    // ── ⑤ identity and idempotence ───────────────────────────────────────────────────────
    test("re-rapatrier ne duplique rien, et l'identité cliente du serveur l'emporte", async () => {
        serveFeatures([ogcFeature(1), ogcFeature(2)]);
        await pullLayer("sites_rosario");
        await pullLayer("sites_rosario");
        expect(await readFeatures()).toHaveLength(2);

        // Row 1 GAINS a `local_id` server-side (what the push will do).
        // Without the `serverId` tie-break, the `srv:1` derivation would
        // produce a SECOND record for the same entity.
        serveFeatures([ogcFeature(1, { local_id: "client-abc" }), ogcFeature(2)]);
        await pullLayer("sites_rosario");

        const stored = await readFeatures();
        expect(stored).toHaveLength(2);
        expect(stored.map((r) => r.localId).sort()).toEqual(["srv:1", "srv:2"]);
    });

    // ── ⑥ a refusal is SAID ──────────────────────────────────────────────────────────────
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

    // ── ⑦ the absent engine is SAID too, and does not hang ──────────────────────────────
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

    // ── ⑧ an entity without server identity is SET ASIDE, never silently ─────────────────
    test("une entité sans identité serveur est comptée `skipped`", async () => {
        const orphan = ogcFeature(2);
        delete orphan.id;
        delete orphan.properties.id;
        serveFeatures([ogcFeature(1), orphan]);

        const report = await pullLayer("sites_rosario");
        expect(report.skipped).toBe(1);
        expect(report.written).toBe(1);
    });

    // ── ⑨ the extent and the cap do go on the wire ───────────────────────────────────────
    test("l'emprise de l'appel est posée sur la requête", async () => {
        serveFeatures([ogcFeature(1)]);
        await pullLayer("sites_rosario", { bbox: [-60.66, -32.95, -60.62, -32.93] });

        const url = new URL(String(fetchSpy.mock.calls[0][0]));
        expect(url.searchParams.get("bbox")).toBe("-60.66,-32.95,-60.62,-32.93");
        // `collectionId` absent from the profile ⇒ the layer id.
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

        // `fetchOgcApiFeatures` returns a partial collection through the SAME
        // path as a success, unmarked: `aborted` is re-read from the signal,
        // never derived from the return.
        expect(report.aborted).toBe(true);
        expect(report.fetched).toBe(10);
        expect(report.written).toBe(10);
    });

    // ── the pull marker ──────────────────────────────────────────────────────────────────
    //
    // 🛑 THESE TWO TESTS ARE HERE AND NOT IN `sync-report.test.js`, AND THAT
    // IS THE POINT. There, the marker is written by hand by `writePullState`:
    // those tests exercise the status DERIVATION, and would all stay green if
    // `pullLayer` completely stopped writing its marker. The link between the
    // pull and the report is only exercised here, where the real `pullLayer`
    // runs against a real source.

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

        // Without this write, the layer would fall back to
        // `declaredNeverPulled`: the SAME status as a never-attempted layer.
        // "We tried and the source said no" is actionable; "we never tried"
        // is not. Confusing them erases the very difference this feature
        // exists to make visible.
        const state = await IndexedDB.getPreference(PULL_STATE_KEY, null);
        expect(state?.sites_rosario).toMatchObject({ outcome: "failed", written: 0 });
    });
});
