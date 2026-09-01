/**
 * Schema v4 — `features` and `outbox`.
 *
 * Three things are exercised here, and only one is structural:
 *  1. the schema's shape (stores, keys, indexes);
 *  2. **the collision fixed IN THE KEY** — the guard that matters, and it was seen turning red;
 *  3. unreachability by eviction, which is a fact of STORE NAME and not of field.
 *
 * ⚠️ `fake-indexeddb`, like `storage-helper-open-database.test.js`: the rest
 * of the offline suite's home-made mock can produce neither `versionchange`,
 * nor composite indexes, nor `autoIncrement`.
 */

import "fake-indexeddb/auto";
// ⚠️ `?raw` and not `readFileSync(new URL(..., import.meta.url))`: under
// vitest, `import.meta.url` is NOT a `file:` URL and the read throws
// `ERR_INVALID_URL_SCHEME`. Measured twice in this repo; the vite resolution
// is the form that works.
import evictionSource from "../../../src/capabilities/offline/db/eviction.ts?raw";
import { IndexedDB } from "../../../src/capabilities/offline/db/indexeddb.ts";

const DB_NAME = "geoleaf-db";

afterEach(async () => {
    const handle = IndexedDB._db;
    if (handle && typeof handle.close === "function") handle.close();
    IndexedDB._db = null;
    IndexedDB._modules = {};
    await new Promise((resolve) => {
        const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
});

// ⚠️ The FILE keeps its `schema-v4` name although the base moved to v5, and
// that is not an oversight: it is cited by `docs/specs/capacites/offline.md`
// (twice) and frozen in `scripts/.baselines/js-test-debt.json`. Renaming
// would make three references diverge for a readability gain this comment
// makes unnecessary. What the file guards is not ONE version, it is the
// schema's SHAPE — and what must not come back into it.
describe("la forme du schéma — v5", () => {
    test("la base s'ouvre en v5 avec les sept stores", async () => {
        const db = await IndexedDB.init();
        expect(db.version).toBe(5);
        expect(Array.from(db.objectStoreNames).sort()).toEqual([
            "features",
            "layers",
            "local_images",
            "metadata",
            "outbox",
            "preferences",
            "routes",
        ]);
    });

    test("🛑 `sync_queue` et `sync_backups` ne sont PLUS créés (4.11)", async () => {
        // This file carried the opposite test — "`sync_queue` SURVIVES v4,
        // this is not legacy, it is the live path" — and it was TRUE when
        // written: `addpoi` and `editor` wrote there, `poi-restore` and the
        // rescue export read it.
        //
        // All four have since moved. Only the backup restoration remained,
        // removed here with its chain — including the `sync_backups` store,
        // which claimed to protect against an origin purge while living
        // INSIDE the base that purge destroys.
        //
        // ⚠️ The test is flipped rather than deleted: the only shape that
        // turns red if someone recreates either store. A plain removal would
        // have let the recreation pass silently.
        const db = await IndexedDB.init();
        const created = new Set(Array.from(db.objectStoreNames));
        expect(created.has("sync_queue")).toBe(false);
        expect(created.has("sync_backups")).toBe(false);
    });

    test("`features` porte une clé COMPOSÉE et trois index", async () => {
        const db = await IndexedDB.init();
        const store = db.transaction("features", "readonly").objectStore("features");
        expect(store.keyPath).toEqual(["layerId", "localId"]);
        expect(Array.from(store.indexNames).sort()).toEqual(["serverId", "syncState", "updatedAt"]);
        // No `layerId` index: the composite key gives the per-layer walk for
        // free. One more index would be a second truth for the same question.
        expect(store.indexNames.contains("layerId")).toBe(false);
    });

    test("`outbox` est en autoIncrement, et son index `id` est UNIQUE", async () => {
        const db = await IndexedDB.init();
        const store = db.transaction("outbox", "readonly").objectStore("outbox");
        expect(store.keyPath).toBe("seq");
        expect(store.autoIncrement).toBe(true);
        expect(store.index("id").unique).toBe(true);
        expect(store.index("localId").keyPath).toEqual(["layerId", "localId"]);
    });
});

describe("v4 — la collision est corrigée DANS LA CLÉ", () => {
    const entry = (id, n) => ({
        id,
        kind: "create",
        layerId: "poi",
        localId: `l${n}`,
        baseVersion: null,
        state: "pending",
        attempts: 0,
        // SAME timestamp for all three: the collision's exact condition. On
        // `sync_queue` the key suffix's luck then decides the order, and the
        // — stable — timestamp sort merely carries it along.
        createdAt: 1785600000000,
    });

    test("trois écritures dans la MÊME milliseconde se relisent dans l'ordre d'écriture", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");

        await outbox.append(entry("op-zzz", 1));
        await outbox.append(entry("op-mmm", 2));
        await outbox.append(entry("op-aaa", 3));

        // ⚠️ The ids are chosen so LEXICOGRAPHIC order is the reverse of the
        // write order. On the old key (`keyPath: "id"`), `getAll()` would
        // have returned aaa, mmm, zzz — i.e. 3, 2, 1. Here the key is `seq`,
        // minted by the base.
        const all = await outbox.list();
        expect(all.map((e) => e.localId)).toEqual(["l1", "l2", "l3"]);
        expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
    });

    test("l'ordre survit à un filtrage par état — et sans AUCUN tri", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append(entry("op-z", 1));
        await outbox.append(entry("op-m", 2));
        await outbox.append(entry("op-a", 3));

        const pending = await outbox.listByState("pending");
        expect(pending.map((e) => e.localId)).toEqual(["l1", "l2", "l3"]);
    });

    test("changer d'état ne DÉPLACE PAS l'entrée dans la file", async () => {
        // A `failed` that becomes processable again must keep its place: it
        // was captured before the next ones, it replays before them.
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append(entry("op-1", 1));
        await outbox.append(entry("op-2", 2));

        await outbox.updateState("op-1", "failed");
        await outbox.updateState("op-1", "pending");

        const all = await outbox.list();
        expect(all.map((e) => e.localId)).toEqual(["l1", "l2"]);
        expect(all[0].seq).toBe(1);
    });

    test("getById, listByEntity et remove — l'adressage par le contrat", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append(entry("op-1", 1));
        await outbox.append({ ...entry("op-2", 1), kind: "update" });
        await outbox.append(entry("op-3", 9));

        // `id` is the contract's ADDRESS, even though it no longer carries the order.
        const found = await outbox.getById("op-2");
        expect(found).toMatchObject({ id: "op-2", kind: "update", seq: 2 });
        expect(await outbox.getById("op-inexistant")).toBeNull();

        // The composite index serves coalescing: all of ONE entity's operations.
        const surL1 = await outbox.listByEntity("poi", "l1");
        expect(surL1.map((e) => e.id)).toEqual(["op-1", "op-2"]);
        expect(await outbox.listByEntity("poi", "inconnue")).toEqual([]);

        // `remove` goes through the `id` index then deletes by `seq` — the
        // other entries' order is unaffected.
        await outbox.remove("op-1");
        expect(await outbox.count()).toBe(2);
        expect((await outbox.list()).map((e) => e.id)).toEqual(["op-2", "op-3"]);
        // Removing an absent id does not throw: a no-op, not an error.
        await expect(outbox.remove("op-inexistant")).resolves.toBeUndefined();
    });

    test("updateState sur un id absent REJETTE — un état perdu ne se tait pas", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await expect(outbox.updateState("op-fantome", "failed")).rejects.toThrow(
            /no entry with id/
        );
    });

    test("un `seq` fourni par l'appelant est IGNORÉ — le store est le seul minteur", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append({ ...entry("op-x", 1), seq: 9999 });
        const [only] = await outbox.list();
        expect(only.seq).toBe(1);
    });

    test("deux entrées de même `id` LÈVENT au lieu de s'écraser en silence", async () => {
        // On `keyPath: "id"` the second overwrote the first — a capture
        // vanished without a sound. The unique index turns the vanishing into a failure.
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append(entry("op-doublon", 1));
        await expect(outbox.append(entry("op-doublon", 2))).rejects.toThrow();
        expect(await outbox.count()).toBe(1);
    });
});

describe("v4 — `features` est INATTEIGNABLE par l'éviction", () => {
    test("`eviction.ts` ne nomme qu'un seul store, et ce n'est ni `features` ni `outbox`", () => {
        // 🛑 The guard that makes the contract's rule true without depending
        // on a field. The day eviction learns a second store name, it turns
        // red — exactly the day `EvictionClass` must be reread.
        const src = evictionSource;
        const stores = [...src.matchAll(/transaction\(\s*\[?\s*["']([a-z_]+)["']/g)].map(
            (m) => m[1]
        );
        const named = [
            ...new Set([...stores, ...(src.match(/STORE = "([a-z_]+)"/) || []).slice(1)]),
        ];

        expect(named.length).toBeGreaterThan(0); // témoin : la garde ne mesure pas le vide
        expect(named).not.toContain("features");
        expect(named).not.toContain("outbox");
        expect(named).toContain("layers");
    });

    test("le CRUD de `features` fonctionne sur la clé composée", async () => {
        await IndexedDB.init();
        const features = IndexedDB._ensureModule("Features");

        const rec = (layerId, localId, syncState = "pending") => ({
            layerId,
            localId,
            serverId: null,
            syncState,
            updatedAt: 1785600000000,
            version: null,
            feature: { type: "Feature", properties: { nom: localId }, geometry: null },
        });

        await features.put(rec("poi", "a"));
        await features.put(rec("poi", "b", "synced"));
        await features.put(rec("autre", "c"));

        expect((await features.get("poi", "a")).feature.properties.nom).toBe("a");
        expect(await features.get("poi", "inexistant")).toBeNull();

        // The per-layer walk comes from the composite key, no dedicated index.
        expect((await features.listByLayer("poi")).map((r) => r.localId).sort()).toEqual([
            "a",
            "b",
        ]);
        expect(await features.countByLayer("poi")).toBe(2);
        expect(await features.countByLayer("autre")).toBe(1);

        expect((await features.listByState("pending")).map((r) => r.localId).sort()).toEqual([
            "a",
            "c",
        ]);

        await features.remove("poi", "a");
        expect(await features.countByLayer("poi")).toBe(1);
    });

    test("⚠️ `serverId: null` n'entre PAS dans l'index — une entité créée hors ligne y est invisible", async () => {
        // `null` is not a valid IndexedDB key. Not a defect as long as the
        // index only serves to find an entity BY its server id — but counting
        // entities through it would UNDERCOUNT. Same mechanism as the
        // booleans-outside-the-index bug. The behaviour is ASSERTED here so
        // nobody rediscovers it and mistakes it for data loss.
        await IndexedDB.init();
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "poi",
            localId: "hors-ligne",
            serverId: null,
            syncState: "pending",
            updatedAt: 1,
            version: null,
            feature: {},
        });

        const db = IndexedDB._db;
        const idx = db
            .transaction("features", "readonly")
            .objectStore("features")
            .index("serverId");
        const viaIndex = await new Promise((resolve) => {
            const req = idx.count();
            req.onsuccess = () => resolve(req.result);
        });

        expect(viaIndex).toBe(0); // invisible à l'index…
        expect(await features.countByLayer("poi")).toBe(1); // …mais bien stockée.
    });
});
