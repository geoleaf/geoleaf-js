/**
 * THE OPTIMISTIC WRITE, and the `outbox`'s first writer.
 *
 * The `outbox` existed and counted **zero producers**, core and plugins
 * together. These tests exercise the three properties that cannot be read off
 * the code:
 *
 *  1. the entity AND the queue entry land together, or not at all;
 *  2. coalescing loses no edit and stacks none in duplicate;
 *  3. the editability invariant holds — pulling never confers editability.
 *
 * Runs against `fake-indexeddb`: the cross-store transaction, the composite
 * `[layerId, localId]` index and the UNIQUE index on `id` are exactly what
 * the home-made mock cannot render — and everything rests on them. Deferred
 * import for the same reason as `sync-entry-id.test.js`.
 */

const DB_NAME = "geoleaf-edit-test";

function feature(title) {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        properties: { title },
    };
}

describe("4.4 — écriture optimiste", () => {
    let IndexedDB;
    let StorageContract;
    let applyEdit;
    let layerConfigs;
    let open;

    const request = (req) =>
        new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

    const readAll = (store) =>
        request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    });

    beforeEach(async () => {
        open = [];
        layerConfigs = [
            { id: "sites", edition: { create: true, update: true, delete: true } },
            // Pullable READ-only layer — the editability invariant's subject.
            { id: "villes", offline: { enabled: true }, edition: { create: false } },
            // Editable, but without delete rights — what `enableEditionFull`
            // really governed, whatever its name suggested.
            { id: "readonly_delete", edition: { create: true, update: true } },
            // 🛑 The three safe-by-default fixtures. They are distinct
            // because they land on distinct branches, and any single one
            // would let the other two's mutation through.
            /** No `edition` block: nothing is granted. */
            { id: "muette" },
            /** Block present but EMPTY: declaring is not granting. */
            { id: "vide", edition: {} },
            /** Grants ONLY `update`: must confer neither `create` nor `delete`. */
            { id: "update_seul", edition: { update: true } },
        ];
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

    // ── ① both halves land together ──────────────────────────────────────────────────────
    test("une création écrit l'entité ET l'entrée de file, avec une identité cliente frappée", async () => {
        const report = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("Saisie terrain"),
        });

        expect(report.refused).toBeNull();
        expect(report.queued).toBe(true);
        expect(report.localId).toMatch(/^loc:/);

        const features = await readAll("features");
        expect(features).toHaveLength(1);
        expect(features[0].syncState).toBe("pending");
        expect(features[0].serverId).toBeNull();
        expect(features[0].feature.properties.title).toBe("Saisie terrain");

        const outbox = await readAll("outbox");
        expect(outbox).toHaveLength(1);
        expect(outbox[0].kind).toBe("create");
        expect(outbox[0].localId).toBe(report.localId);
        expect(outbox[0].state).toBe("pending");

        // And the local read returns it: "the user sees their own capture".
        const collection = await IndexedDB.getLayerFeatureCollection("sites");
        expect(collection.features).toHaveLength(1);
    });

    // ── ② coalescing, line by line ───────────────────────────────────────────────────────
    test("create puis update → l'entrée reste un `create`, et il porte l'état le plus récent", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("v1"),
        });
        const updated = await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: created.localId,
            feature: feature("v2"),
        });

        expect(updated.queued).toBe(false);
        expect(updated.coalescedInto).toBe(created.entryId);

        const outbox = await readAll("outbox");
        expect(outbox).toHaveLength(1);
        expect(outbox[0].kind).toBe("create");

        // 🛑 What makes the merge correct: the entry does NOT carry the
        // payload, it references `localId`. The payload is the record, and it is current.
        const features = await readAll("features");
        expect(features[0].feature.properties.title).toBe("v2");
    });

    test("update puis update → une seule entrée, pas deux", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:7",
            feature: feature("a"),
        });
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:7",
            feature: feature("b"),
        });

        expect(await readAll("outbox")).toHaveLength(1);
        expect((await readAll("features"))[0].feature.properties.title).toBe("b");
    });

    test("create puis delete → ANNULATION : ni entrée, ni entité", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("regret"),
        });
        const deleted = await applyEdit({
            layerId: "sites",
            kind: "delete",
            localId: created.localId,
        });

        expect(deleted.annulled).toBe(true);
        // The server never saw it: pushing a DELETE on an identity unknown to
        // it would be noise at best, a queue-blocking error at worst.
        expect(await readAll("outbox")).toHaveLength(0);
        expect(await readAll("features")).toHaveLength(0);
    });

    test("update puis delete → le delete REMPLACE l'update", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:9",
            feature: feature("x"),
        });
        await applyEdit({ layerId: "sites", kind: "delete", localId: "srv:9" });

        const outbox = await readAll("outbox");
        expect(outbox).toHaveLength(1);
        expect(outbox[0].kind).toBe("delete");
    });

    test("une entrée `inFlight` ne coalesce PAS — elle est déjà sur le fil", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:3",
            feature: feature("p"),
        });
        const outbox = IndexedDB._ensureModule("Outbox");
        const [entry] = await outbox.list();
        await outbox.updateState(entry.id, "inFlight");

        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:3",
            feature: feature("q"),
        });

        // Merging would let what goes on the wire diverge from what the queue believes it sends.
        const all = await readAll("outbox");
        expect(all).toHaveLength(2);
        expect(all.map((e) => e.state).sort()).toEqual(["inFlight", "pending"]);
    });

    test("deux entrées frappées dans la MÊME milliseconde ne collisionnent pas", async () => {
        // 🛑 The `outbox`'s `id` index is UNIQUE: a collision THROWS instead
        // of overwriting (intended fix). The right behaviour, and the one
        // that unmasked an id composed of `Date.now()` alone — two edits of
        // the same entity in the same millisecond struck the same id, and the
        // transaction failed on a perfectly legitimate case. The defect only
        // showed under the full suite, fast enough for both calls to land in
        // the same millisecond.
        vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
        try {
            await applyEdit({
                layerId: "sites",
                kind: "update",
                localId: "srv:11",
                feature: feature("un"),
            });
            const outbox = IndexedDB._ensureModule("Outbox");
            const [first] = await outbox.list();
            await outbox.updateState(first.id, "inFlight");

            await applyEdit({
                layerId: "sites",
                kind: "update",
                localId: "srv:11",
                feature: feature("deux"),
            });

            const all = await readAll("outbox");
            expect(all).toHaveLength(2);
            expect(new Set(all.map((e) => e.id)).size).toBe(2);
        } finally {
            vi.mocked(Date.now).mockRestore();
        }
    });

    // ── ②bis — a PARTIAL edit does not destroy what it does not bring ────────────────────
    test("une modification sans géométrie CONSERVE celle du magasin", async () => {
        // 🛑 The real case, measured in the product: `updateExistingPoi` logs
        // "missing geometry" and enqueues anyway. Renaming a point does not
        // resend its position; overwriting with `undefined` would make it vanish.
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites",
            localId: "srv:20",
            serverId: "20",
            syncState: "synced",
            updatedAt: 1,
            version: null,
            feature: feature("nom d'origine"),
        });

        const report = await applyEdit({ layerId: "sites", kind: "update", localId: "srv:20" });

        expect(report.refused).toBeNull();
        const stored = (await readAll("features"))[0];
        expect(stored.feature.geometry).toEqual({
            type: "Point",
            coordinates: [-60.64, -32.94],
        });
    });

    test("une CRÉATION sans position est refusée — garde sur un état inatteignable", async () => {
        // The form carries a `latlng` field, fed by the placement click: a
        // creation without a position does not exist in the product. Refusing
        // here therefore loses no capture — what distinguishes this guard
        // from an enqueue refusal.
        const report = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: { type: "Feature", geometry: null, properties: { title: "sans lieu" } },
        });

        expect(report.refused).toBe("geometryRequired");
        expect(await readAll("features")).toHaveLength(0);
    });

    // ── ③ the local deletion leaves the map, without losing its `serverId` ───────────────
    test("une suppression en attente sort de la lecture locale, mais garde son `serverId`", async () => {
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites",
            localId: "srv:42",
            serverId: "42",
            syncState: "synced",
            updatedAt: 1,
            version: null,
            feature: feature("rapatriée"),
        });

        await applyEdit({ layerId: "sites", kind: "delete", localId: "srv:42" });

        // Off the map…
        const collection = await IndexedDB.getLayerFeatureCollection("sites");
        expect(collection.features).toHaveLength(0);

        // …but still in the base: the outbox entry only carries the
        // `localId`, so the record is the ONLY place the push will find what to delete.
        const stored = await readAll("features");
        expect(stored).toHaveLength(1);
        expect(stored[0].serverId).toBe("42");
        // ⚠️ AND THE ENTITY ITSELF SURVIVES. This line was missing from the
        // first draft: the mutation replacing the kept geometry with
        // `input.feature` — `undefined` for a deletion — came out GREEN. The
        // test only exercised the `serverId`, so a deletion could silently
        // erase the data without it flinching.
        expect(stored[0].feature).toBeTruthy();
        expect(stored[0].feature.properties.title).toBe("rapatriée");
    });

    // ── ④ invariant S6 ────────────────────────────────────────────────────────────────────
    test("une couche rapatriable mais NON éditable refuse l'édition (invariant S6)", async () => {
        const report = await applyEdit({
            layerId: "villes",
            kind: "update",
            localId: "srv:1",
            feature: feature("interdit"),
        });

        expect(report.refused).toBe("layerNotEditable");
        expect(await readAll("outbox")).toHaveLength(0);
        expect(await readAll("features")).toHaveLength(0);
    });

    test("`edition.delete` absent interdit la SUPPRESSION, pas la modification", async () => {
        const ok = await applyEdit({
            layerId: "readonly_delete",
            kind: "update",
            localId: "srv:1",
            feature: feature("ok"),
        });
        expect(ok.refused).toBeNull();

        const ko = await applyEdit({
            layerId: "readonly_delete",
            kind: "delete",
            localId: "srv:1",
        });
        expect(ko.refused).toBe("deleteNotPermitted");
    });

    // ── safe by default, in three inseparable guards ─────────────────────────────────────
    //
    // 🛑 They do not replace one another, and that is mutation-verified:
    //   · the "muette" guard comes out GREEN if the default becomes
    //     `edition ? (x ?? true) : false` — "vide" is needed to catch it;
    //   · the "vide" guard comes out GREEN if the default becomes `!== false`
    //     — "muette" is needed;
    //   · neither sees a key implying another — "update_seul" is needed.
    // Writing only one of the three would give a guard claiming to hold what it does not.

    test("une couche SANS bloc `edition` n'accorde rien — ni create, ni update, ni delete", async () => {
        const created = await applyEdit({
            layerId: "muette",
            kind: "create",
            localId: "loc:1",
            feature: feature("x"),
        });
        expect(created.refused).toBe("layerNotEditable");

        const updated = await applyEdit({
            layerId: "muette",
            kind: "update",
            localId: "srv:1",
            feature: feature("x"),
        });
        expect(updated.refused).toBe("layerNotEditable");

        const deleted = await applyEdit({ layerId: "muette", kind: "delete", localId: "srv:1" });
        expect(deleted.refused).toBe("deleteNotPermitted");

        expect(await readAll("outbox")).toHaveLength(0);
    });

    test("un bloc `edition` VIDE n'accorde rien non plus — déclarer n'est pas accorder", async () => {
        const created = await applyEdit({
            layerId: "vide",
            kind: "create",
            localId: "loc:2",
            feature: feature("x"),
        });
        expect(created.refused).toBe("layerNotEditable");

        const deleted = await applyEdit({ layerId: "vide", kind: "delete", localId: "srv:2" });
        expect(deleted.refused).toBe("deleteNotPermitted");

        expect(await readAll("outbox")).toHaveLength(0);
    });

    test("aucune clé n'en implique une autre : `update` seul refuse `create` ET `delete`", async () => {
        const updated = await applyEdit({
            layerId: "update_seul",
            kind: "update",
            localId: "srv:3",
            feature: feature("ok"),
        });
        expect(updated.refused).toBeNull();

        const created = await applyEdit({
            layerId: "update_seul",
            kind: "create",
            localId: "loc:3",
            feature: feature("x"),
        });
        expect(created.refused).toBe("layerNotEditable");

        const deleted = await applyEdit({
            layerId: "update_seul",
            kind: "delete",
            localId: "srv:3",
        });
        expect(deleted.refused).toBe("deleteNotPermitted");
    });

    test("une couche absente du profil refuse en `layerUnknown`", async () => {
        const report = await applyEdit({
            layerId: "inexistante",
            kind: "update",
            localId: "x",
            feature: feature("z"),
        });
        expect(report.refused).toBe("layerUnknown");
    });

    test("sans moteur de stockage, l'édition refuse au lieu de disparaître", async () => {
        StorageContract.init({
            get DB() {
                return null;
            },
            isAvailable: () => false,
        });
        const report = await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:1",
            feature: feature("z"),
        });
        expect(report.refused).toBe("engineUnavailable");
    });
});
