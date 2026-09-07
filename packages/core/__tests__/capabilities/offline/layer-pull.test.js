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

        // ⚠️ **THIS COMMENT SAID THE OPPOSITE UNTIL R9**, and it was right at the
        // time: `fetchOgcApiFeatures` handed a partial collection back through the
        // SAME path as a complete one, unmarked, so `aborted` had to be re-read from
        // the signal. `streamOgcApiFeatures` reports what the run observed, so it is
        // now derived from the return — and the difference is not cosmetic: a signal
        // raised AFTER the source was exhausted no longer makes a complete batch call
        // itself partial.
        expect(report.aborted).toBe(true);
        expect(report.fetched).toBe(10);
        expect(report.written).toBe(10);
    });

    // ── ⑩ R9 — une page, une transaction, un tic de progression ──────────────────────────
    //
    // 🛑 WHAT THESE CASES HOLD IS NOT "IT STILL WORKS", it is the shape of the writing.
    // Every assertion above stays green against the previous single-transaction pull:
    // same entities, same tallies, same marker. The change is invisible to all of them,
    // and it is precisely the change that decides whether a 30 000-entity layer is
    // usable — hence a spy on the number of batches, not on their content.

    /** Counts calls to the batch writer, and lets the real one run. */
    function countBatches() {
        const real = IndexedDB.putLayerFeatures.bind(IndexedDB);
        const sizes = [];
        vi.spyOn(IndexedDB, "putLayerFeatures").mockImplementation(async (records) => {
            sizes.push(records.length);
            return real(records);
        });
        return sizes;
    }

    test("une page SOURCE = une transaction — 40 entités par 10 en font quatre, pas une", async () => {
        serveFeatures(
            Array.from({ length: 40 }, (_, i) => ogcFeature(i + 1)),
            10
        );
        const sizes = countBatches();

        const report = await pullLayer("sites_rosario");

        // Four batches of ten. The single-transaction shape gave `[40]`, and every
        // other assertion in this file is blind to the difference.
        expect(sizes).toEqual([10, 10, 10, 10]);
        expect(report.written).toBe(40);
        expect(await readFeatures()).toHaveLength(40);
    });

    test("chaque page publie sa progression, et le total est celui de la SOURCE", async () => {
        const seen = [];
        const onProgress = (e) => seen.push(e.detail);
        document.addEventListener("geoleaf:offline:pull-progress", onProgress);
        try {
            serveFeatures(
                Array.from({ length: 25 }, (_, i) => ogcFeature(i + 1)),
                10
            );
            await pullLayer("sites_rosario");
        } finally {
            document.removeEventListener("geoleaf:offline:pull-progress", onProgress);
        }

        expect(seen.map((d) => d.current)).toEqual([10, 20, 25]);
        // `numberMatched` is served by the harness, as pygeoapi serves it: the bar
        // shows a fraction of a KNOWN whole rather than a count that keeps growing.
        expect(seen.every((d) => d.totalIsKnown && d.total === 25)).toBe(true);
        expect(seen.map((d) => d.percentage)).toEqual([40, 80, 100]);
        expect(seen.every((d) => d.layerId === "sites_rosario")).toBe(true);
    });

    test("sans `numberMatched`, la progression COMPTE au lieu de prétendre une fraction", async () => {
        // A server omitting the total is not a server with a total of zero. The bar
        // must say "so far", never a percentage of something nobody measured.
        const all = Array.from({ length: 15 }, (_, i) => ogcFeature(i + 1));
        fetchSpy = vi.fn(async (url) => {
            const parsed = new URL(String(url));
            const offset = Number(parsed.searchParams.get("offset") ?? 0);
            const page = all.slice(offset, offset + 10);
            const next = offset + 10 < all.length;
            parsed.searchParams.set("offset", String(offset + 10));
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    type: "FeatureCollection",
                    features: page,
                    links: next ? [{ rel: "next", href: parsed.toString() }] : [],
                }),
            };
        });
        globalThis.fetch = fetchSpy;

        const seen = [];
        const onProgress = (e) => seen.push(e.detail);
        document.addEventListener("geoleaf:offline:pull-progress", onProgress);
        try {
            await pullLayer("sites_rosario");
        } finally {
            document.removeEventListener("geoleaf:offline:pull-progress", onProgress);
        }

        expect(seen.map((d) => d.totalIsKnown)).toEqual([false, false]);
        expect(seen.map((d) => d.total)).toEqual([10, 15]);
    });

    test("un abandon en cours de route LAISSE les pages commises, et le marqueur le dit", async () => {
        // 🛑 The property the single transaction did NOT have. An abort used to roll
        // the whole batch back — or, when it landed after the write, to keep it all;
        // either way the store held "all or nothing" and the marker said `ok`. Now it
        // holds what was committed, and the marker says the run did not finish.
        const controller = new AbortController();
        serveFeatures(
            Array.from({ length: 40 }, (_, i) => ogcFeature(i + 1)),
            10
        );
        const wrapped = fetchSpy;
        let served = 0;
        globalThis.fetch = vi.fn(async (url, init) => {
            const response = await wrapped(url, init);
            if (++served === 2) controller.abort();
            return response;
        });

        const report = await pullLayer("sites_rosario", { signal: controller.signal });

        expect(report.aborted).toBe(true);
        expect(report.written).toBe(20);
        expect(await readFeatures()).toHaveLength(20);

        const state = await IndexedDB.getPreference(PULL_STATE_KEY, null);
        // Not `ok`: half a layer under a status meaning "complete" is the defect the
        // `truncated` member exists to prevent, one level up.
        expect(state?.sites_rosario).toMatchObject({ outcome: "partial", written: 20 });
    });

    test("une saisie locale à cheval sur deux tranches est TOUJOURS préservée", async () => {
        // The rule lives inside `putManyPreservingLocal`, hence inside ONE transaction.
        // Chunking multiplies the transactions, so the property has to be re-measured
        // on a record that lands in the second batch, not the first.
        serveFeatures(
            Array.from({ length: 20 }, (_, i) => ogcFeature(i + 1)),
            10
        );
        await IndexedDB.applyLocalEdit({
            layerId: "sites_rosario",
            localId: "srv:15",
            serverId: "15",
            feature: ogcFeature(15, { title: "relevé terrain" }),
        });

        const report = await pullLayer("sites_rosario");

        expect(report.preserved).toBe(1);
        expect(report.written).toBe(19);
        const kept = (await readFeatures()).find((r) => r.localId === "srv:15");
        expect(kept.feature.properties.title).toBe("relevé terrain");
        expect(kept.syncState).not.toBe("synced");
    });

    test("le marqueur est écrit PENDANT la course, pas seulement à la fin", async () => {
        // 🛑 THIS CASE EXISTS BECAUSE A MUTATION FOUND NOTHING. Deleting the per-page
        // `writePullState` left every other assertion green — the epilogue writes the
        // same marker at the end, so the two are indistinguishable from outside. But a
        // tab killed mid-pull runs NO epilogue, and that is the whole point of writing
        // as we go: what is in the store when the process dies is what the next session
        // reads. Observing the marker from INSIDE the run is the only way to see it.
        const observed = [];
        const onProgress = () => {
            observed.push(IndexedDB.getPreference(PULL_STATE_KEY, null));
        };
        document.addEventListener("geoleaf:offline:pull-progress", onProgress);
        try {
            serveFeatures(
                Array.from({ length: 30 }, (_, i) => ogcFeature(i + 1)),
                10
            );
            await pullLayer("sites_rosario");
        } finally {
            document.removeEventListener("geoleaf:offline:pull-progress", onProgress);
        }

        const states = await Promise.all(observed);
        // Three ticks, and the marker already carried the running tally at each one —
        // under `partial`, never under a status meaning the layer is complete.
        expect(states.map((st) => st?.sites_rosario?.written)).toEqual([10, 20, 30]);
        expect(states.every((st) => st?.sites_rosario?.outcome === "partial")).toBe(true);
    });

    test("une source qui tombe en route persiste `failed` AVEC ce qui est déjà écrit", async () => {
        // ⚠️ `written: 0` would describe a store that does not exist: the pages committed
        // before the failure are in it. The marker says "we tried, it broke, and this
        // much is here" — the third half is what a re-pull needs to not look like a
        // first pull.
        serveFeatures(
            Array.from({ length: 40 }, (_, i) => ogcFeature(i + 1)),
            10
        );
        const wrapped = fetchSpy;
        let served = 0;
        globalThis.fetch = vi.fn(async (url, init) => {
            if (++served === 3) throw new Error("network down");
            return wrapped(url, init);
        });

        const report = await pullLayer("sites_rosario");

        expect(report.refused).toBe("sourceUnreachable");
        expect(report.written).toBe(20);
        expect(await readFeatures()).toHaveLength(20);

        const state = await IndexedDB.getPreference(PULL_STATE_KEY, null);
        expect(state?.sites_rosario).toMatchObject({ outcome: "failed", written: 20 });
    });

    test("un lot tronqué est ANNONCÉ à l'utilisateur, pas seulement rapporté", async () => {
        // 🛑 `capped: true` is a field of a report nothing displays. The cap that bit
        // here is `offline.maxFeatures`, and the DISPLAY path cannot announce it: a
        // layer with `offline.enabled` reads the local store, whose collection carries
        // no `truncated` member — it looks complete by construction. This is the only
        // moment anyone knows the parc was cut.
        const { resetTruncationNotices } =
            await import("../../../src/kernel/geojson/loader/truncation-notice.js");
        resetTruncationNotices();
        const seen = [];
        const { notifyPrimitive } = await import("../../../src/utils/notify/notify.primitive.js");
        const spy = vi.spyOn(notifyPrimitive, "notify").mockImplementation((m, lvl) => {
            seen.push([m, lvl]);
        });

        layerConfigs[0].offline.maxFeatures = 15;
        serveFeatures(
            Array.from({ length: 40 }, (_, i) => ogcFeature(i + 1)),
            10
        );

        const report = await pullLayer("sites_rosario");

        expect(report.capped).toBe(true);
        expect(seen).toHaveLength(1);
        expect(seen[0][1]).toBe("warning");
        expect(seen[0][0]).toContain("sites_rosario");
        // The harness serves `numberMatched: 40`, so the message can name the real
        // total rather than the 20 the loop had accumulated when the cap stopped it.
        expect(seen[0][0]).toContain("40");
        expect(seen[0][0]).toContain("15");
        spy.mockRestore();
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
