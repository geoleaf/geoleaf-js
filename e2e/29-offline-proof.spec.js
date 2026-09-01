// @ts-check
/**
 * 29 — THE REMAINING OFFLINE PROOF CRITERIA (nos. 1, 3, 5 and 6)
 *
 * **Criterion 1** — write offline, then **re-read the IndexedDB entry and assert
 *   the PAYLOAD** after a page reload.
 * **Criterion 3** — "an add followed by a delete offline produces ZERO requests".
 * **Criterion 5** — "a backup that restores — today it is impossible".
 * **Criterion 6** — "a photo taken off-network really contains its bytes after a
 *   reload".
 *
 * ⚠️ CRITERIA 1 AND 6 WERE ASSIGNED TO A SLICE DECLARED CLOSED WITHOUT DELIVERING
 * THEM. The CODE they prove was indeed fixed — the queue facade, the photo bytes
 * — but no scenario had ever observed them in a browser. Found on 2026-08-03 by
 * re-reading the slices table rather than the task list: the two said different
 * things, and the criteria list was the one that was right. A proof criterion no
 * test carries is not closed, it is **asserted**.
 *
 * 🛑 WHAT THESE TWO REQUIRE THAT THE OTHERS DID NOT: **a page reload**. That is
 * their whole subject — "after reload" is in both statements. A test re-reading
 * in the same session proves an object is in memory, not that it was PERSISTED.
 *
 * ═══ CRITERION 3's INSTRUMENT WAS INVESTIGATED BEFORE WRITING THIS SCENARIO ═══
 *
 * `helpers/offline.js`'s header recorded a measured limit: `recordRequests`
 * counts request **initiations**, not network egress — a `fetch()` served
 * entirely by the Service Worker still emits a `request` event, and
 * `Response.fromServiceWorker()` does not settle it (it also returns `true` when
 * the worker relays). Writing "zero requests" on top of that without measuring
 * would have produced a red that says nothing.
 *
 * Measured on 2026-08-03, recorder open and **without assertion**, against the
 * vhost:
 *
 *   1. **The write gesture REALLY produces zero requests.** Two offline
 *      enqueues → **0** events, neither page nor worker. _(The measurement bore
 *      on `addToSyncQueue`; the gesture goes through `Storage.applyEdit` since
 *      the producer switch, and the v3 queue's removal made the old name
 *      unreachable. The measured fact does not change: an enqueue emits
 *      nothing.)_ The documented limit does not apply here: it concerns the
 *      READS the worker intercepts, and an enqueue is not one. No discriminator
 *      is thus necessary — building one "just in case" would have been
 *      purposeless code.
 *   2. **`request.serviceWorker()` DISCRIMINATES, should it one day be needed.**
 *      On a read the worker relays, the recorder sees **two** events for one
 *      URL: the page's (`serviceWorker() === null`) and the worker's. A request
 *      carrying a worker is **sufficient** proof the thread was solicited — the
 *      worker's `fetch` is not re-interceptable. Recorded for the day a scenario
 *      needs it.
 *   3. **Boot traffic settles in ~2 s**, not 300 ms. `settleNetwork` before any
 *      zero assertion is thus no precaution, it is the condition.
 *
 * ⚠️ WHAT WOULD PROVE NOTHING: an UNSCOPED `assertZeroNetwork`. A live map never
 * stops talking to the network; "zero requests" is only ever a statement about a
 * PERIMETER. The perimeter here is the write origin, and the negative control
 * proves the instrument does see something when there is something to see.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { wipeOnOrigin } from "./helpers/db-seed.js";
import { GEOLEAF_DB, seedStore, readStore, readBinary } from "./helpers/idb.js";
import {
    goOffline,
    goOnline,
    settleNetwork,
    assertZeroNetwork,
    recordRequests,
} from "./helpers/offline.js";

/** The variant embarking BOTH editing and `offline-ui` — the only one where the
 *  restoration cycle is reachable end to end. ⚠️ It used to be `deploy-addpoi`;
 *  since the merge `deploy-full` plays that role, and it is not a mere port
 *  change. */
const ORIGIN = baseURL("full");

/**
 * Criterion 3's PERIMETER: everything that is not the application's origin is
 * noise.
 *
 * 🛑 IT IS DERIVED, NOT HAND-WRITTEN, and that is not cosmetics. A first version
 * of this test had no perimeter: it yielded **28 distinct URLs** — the basemap's
 * `s3.amazonaws.com/elevation-tiles-prod` and `tile.opentopomap.org` tiles,
 * which keep arriving well after `settleNetwork`. A live map never stops talking
 * to the network; "zero requests" is only ever a statement about a perimeter.
 *
 * ⚠️ AND IT IS AN INSTRUMENT BIAS OF MINE, not a code surprise: the preliminary
 * investigation had been played on the `full` variant, where the map had
 * settled, and I concluded "zero requests at all". Measuring on one variant and
 * concluding on another is exactly what the preflight rule forbids.
 *
 * The perimeter is POSITIVE — "the application's origin" — and not a provider
 * blacklist: a blacklist would silently excuse the traffic a future scenario
 * must precisely catch. And it is the right perimeter for this criterion: a POI
 * push goes to the origin (`/api/pois`), never to a tile provider.
 */
const NOT_APP_ORIGIN = new RegExp(`^(?!${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`);

/**
 * Boots the application and waits on the SURFACE, never an event.
 *
 * ⚠️ The availability witness used to be `Storage.DB.addToSyncQueue`, removed
 * with the v3 queue. We now wait on `Storage.applyEdit` — the single write point
 * since the producer switch, i.e. what these tests really exercise.
 */
async function boot(page) {
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
        // 🛑 The witness must prove the engine is WIRED, not merely that the
        // facade exists. `Storage.applyEdit` is mounted from boot and would
        // return `true` too early — measured: the tests then started with
        // `Storage.DB` still `null`. `DB.<method>` requires both, which is what
        // `addToSyncQueue` did before its removal.
        () =>
            typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
            "function",
        null,
        { timeout: 25000 }
    );
}

test.describe("29 — critères de preuve n° 1, 3, 5 et 6", () => {
    test.beforeEach(async ({ page }) => {
        await wipeOnOrigin(page, ORIGIN);
    });

    test.afterEach(async ({ context, page }) => {
        await goOnline(context, page).catch(() => {
            /* the context may already be online */
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════
    // CRITERION 3
    // ═══════════════════════════════════════════════════════════════════════════════════

    test("CRITÈRE 3 — un ajout PUIS une suppression hors ligne ne produisent AUCUNE requête", async ({
        context,
        page,
    }) => {
        await boot(page);
        // Without this, the assertion would redden on boot traffic: ~2 s of
        // tiles, styles, glyphs and sprites that have nothing to do with the
        // gesture being proven.
        await settleNetwork(context, { quietMs: 800, timeout: 30000 });

        await goOffline(context, page);

        /** @type {{add: string, del: string, due: string[]}} */
        let queued;
        await assertZeroNetwork(
            context,
            async () => {
                queued = await page.evaluate(async () => {
                    const gl = /** @type {any} */ (globalThis).GeoLeaf;
                    const feature = {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [55.38, -21.07] },
                        properties: { nom: "Saisie hors réseau" },
                    };
                    // ⚠️ `sites_rosario` and NOT `poi_tourisme`: `applyEdit`
                    // validates the layer (`layerUnknown` refusal), where the v3
                    // queue accepted any identifier. The `tourism` profile has
                    // only four editable layers, and this one is the only one
                    // carrying a `write` block.
                    const add = await gl.Storage.applyEdit({
                        layerId: "sites_rosario",
                        kind: "create",
                        localId: "c3-poi",
                        feature,
                    });
                    // State AFTER the creation alone: the entity is there, its entry too.
                    const afterAdd = await gl.Storage.DB.listPendingEdits();

                    const del = await gl.Storage.applyEdit({
                        layerId: "sites_rosario",
                        kind: "delete",
                        localId: "c3-poi",
                    });
                    const afterDel = await gl.Storage.DB.listPendingEdits();
                    return {
                        add: add.entryId,
                        del: del.entryId,
                        afterAdd: afterAdd.length,
                        afterDel: afterDel.length,
                    };
                });
                // Give a late request time to show: an assertion closing its
                // window too early does not prove absence, it proves impatience.
                await page.waitForTimeout(1500);
            },
            { allow: [NOT_APP_ORIGIN] }
        );

        // 🛑 THE ASSERTION CARRYING THE CRITERION IS NOT "ZERO REQUESTS" ALONE.
        // Zero requests is also what a gesture that did nothing would produce.
        // The gesture must have LEFT A TRACE for the zero to mean "it stayed
        // local".
        //
        // ⚠️ **PORTED TO THE v4 CYCLE, and the property CHANGED SHAPE.** In v3
        // the two operations stayed stacked side by side, and the test read
        // their order. The outbox **coalesces**: an entity created then deleted
        // offline never existed server-side, so the two entries CANCEL OUT
        // (`local-edit.ts`, the "annulation" case). Keeping the old assertion
        // would have required disabling coalescence to measure it — i.e. testing
        // the contract's opposite.
        //
        // The trace thus reads in two steps: the creation alone leaves ONE queue
        // entry, the deletion that follows leaves NONE. An inert gesture would
        // produce neither.
        // @ts-expect-error — assigned in the callback above
        expect(queued.add, "la création doit rendre un identifiant d'entrée").toBeTruthy();
        // @ts-expect-error — assigned in the callback above
        expect(queued.afterAdd, "une entrée après la création").toBe(1);
        // @ts-expect-error — assigned in the callback above
        expect(queued.afterDel, "ANNULATION — plus rien après la suppression").toBe(0);
    });

    test("CONTRÔLE NÉGATIF — l'instrument VOIT une requête quand il y en a une", async ({
        context,
        page,
    }) => {
        // Without this test, the previous one's green would be indistinguishable
        // from an unplugged recorder. The guard's guard: a zero measurement only
        // has value if the same measurement is shown able to yield something
        // other than zero.
        await boot(page);
        await settleNetwork(context, { quietMs: 800, timeout: 30000 });

        const rec = recordRequests(context, { filter: (url) => url.includes("/profiles/") });
        await page.evaluate(async () => {
            await fetch("./profiles/tourism/profile.json", { cache: "reload" }).catch(() => {});
        });
        await page.waitForTimeout(1200);
        rec.stop();

        expect(
            rec.count(),
            "l'enregistreur doit voir la requête qu'on vient de faire"
        ).toBeGreaterThan(0);
    });
    // 🛑 CRITERION 5 IS WITHDRAWN — THE FEATURE NO LONGER EXISTS (2026-08-04).
    //
    // Its three tests bore on backup restoration: the proven half (the numeric
    // key, fixed earlier), the backup `test.fixme`, and its negative control.
    //
    // The 08-04 preflight overturned the premise. The line said "backups are
    // created EMPTY"; the measurement says they **are no longer created at
    // all** — `_createBackup` had no production caller since the producer
    // switch rewrote `processSyncQueue` as a delegation to `pushOutbox`. And its
    // motive was wrong on the mechanism: the store lived in the database an
    // origin purge destroys, so it did not protect against the case it existed
    // for. The whole chain is deleted, and **the chain closes by removal**.
    //
    // ⚠️ What replaced it already existed: the outbox contractually forbids
    // destroying an entry, and `offline-ui`'s JSON export leaves the browser —
    // it survives the purge.

    // ═══════════════════════════════════════════════════════════════════════════════════
    // CRITERION 1 — the payload SURVIVES the reload
    // ═══════════════════════════════════════════════════════════════════════════════════

    test("CRITÈRE 1 — une saisie hors ligne se relit AVEC SA CHARGE UTILE après rechargement", async ({
        context,
        page,
    }) => {
        // 🛑 THE DEFECT THIS TEST PINS. The `addToSyncQueue` facade remapped the
        // arguments: it read `operation.data` — always `undefined` — and had
        // **no slot for `payload`**. Every field entry thus went into the queue
        // as `poiData: null`, and the editor lost its envelope. Two payload
        // vocabularies, two losses, one faulty remap.
        //
        // ⚠️ AND HERE IS WHY THIS CRITERION EXISTS: the only E2E that cut the
        // network before 08-02 asserted a FLAG (`window.__edQueued`), never the
        // data. An event fires just as well when what it carries is empty —
        // exactly how the defect survived for months.
        await boot(page);
        await goOffline(context, page);

        // ⚠️ **PORTED TO THE v4 CYCLE — and the original defect became
        // INEXPRESSIBLE.** The test wrote TWO queue entries, one per payload
        // vocabulary (`poiData` for `addpoi`, `payload` for the editor),
        // because the `addToSyncQueue` remap lost one. Since the producer
        // switch there is one write point and one vocabulary; since the queue
        // slimming, **the queue entry carries NO payload at all** — it
        // references `localId`, and the data lives in `features`.
        //
        // The property stays the same — "an offline entry re-reads WITH ITS
        // PAYLOAD after reload" — but it now reads in the entity store.
        const queued = await page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const poi = await gl.Storage.applyEdit({
                layerId: "sites_rosario",
                kind: "create",
                localId: "c1-poi",
                feature: {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [55.38, -21.07] },
                    properties: { nom: "Belvédère du Maïdo", categorie: "belvedere" },
                },
            });
            const ed = await gl.Storage.applyEdit({
                layerId: "sites_rosario",
                kind: "create",
                localId: "c1-geom",
                feature: {
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [55.3, -21.0],
                            [55.4, -21.1],
                        ],
                    },
                    properties: { nom: "Sentier" },
                },
            });
            return { poi: poi.entryId, ed: ed.entryId };
        });

        await goOnline(context, page);

        // ── THE RELOAD — the criterion's whole subject ──────────────────────────────────
        // Without it, we would prove an object is in memory, not that it was
        // PERSISTED. ⚠️ No `wipeOnOrigin` in between: that would erase the proof.
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(
            () =>
                typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
                "function",
            null,
            { timeout: 25000 }
        );

        // Re-read through the STORES, not the engine: what is asserted is what is on disk.
        const entities = await readStore(page, { db: GEOLEAF_DB, store: "features" });
        const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
        const poiRow = entities.find((/** @type {any} */ r) => r.localId === "c1-poi");
        const edRow = entities.find((/** @type {any} */ r) => r.localId === "c1-geom");

        expect(poiRow, "l'entité POI doit survivre au rechargement").toBeTruthy();
        expect(edRow, "l'entité tracée doit survivre au rechargement").toBeTruthy();

        // 🛑 THE ASSERTIONS CARRYING THE CRITERION: the payload, not its
        // presence. `toBeTruthy()` on the row would have been green BEFORE the
        // fix, with `poiData: null`.
        expect(poiRow.feature.properties).toMatchObject({
            nom: "Belvédère du Maïdo",
            categorie: "belvedere",
        });
        expect(poiRow.feature.geometry.coordinates).toEqual([55.38, -21.07]);
        expect(edRow.feature.properties).toMatchObject({ nom: "Sentier" });
        expect(edRow.feature.geometry.type).toBe("LineString");

        // 🛑 AND HERE IS WHAT MAKES THE ORIGINAL DEFECT INEXPRESSIBLE: the queue
        // entry carries NO payload. There is no slot left where one producer's
        // envelope could fall beside another's — the contract writes it ("It
        // references `localId` and never `serverId`"), and it is verifiable on
        // disk.
        const poiEntry = outbox.find((/** @type {any} */ e) => e.id === queued.poi);
        expect(poiEntry, "l'entrée de file doit survivre au rechargement").toBeTruthy();
        expect(poiEntry.localId).toBe("c1-poi");
        expect(poiEntry.poiData).toBeUndefined();
        expect(poiEntry.payload).toBeUndefined();
    });

    // ⚠️ CRITERION 1's "back online → verify the push" HALF IS NOT HERE, and its
    // absence is deliberate: it requires a real backend and the connector's
    // authentication. It is the v4 cycle's proof, whose statement repeats it
    // word for word. The half that belonged to the foundation — write offline
    // and re-read the payload — is above.

    // ═══════════════════════════════════════════════════════════════════════════════════
    // CRITERION 6 — the photo contains its BYTES
    // ═══════════════════════════════════════════════════════════════════════════════════

    test("CRITÈRE 6 — une photo prise hors réseau contient ses OCTETS après rechargement", async ({
        context,
        page,
    }) => {
        // 🛑 THE DEFECT — and it was DOUBLE in the same object.
        //   ① `image-upload.ts` wrote `base64: <data-url>` while `db/images.ts`
        //      declares `blob: Blob` and `storeImageLocally` explicitly maps
        //      `blob: imageData.blob`. The `base64` key was read by nobody: the
        //      store received `blob: undefined`. The record existed, it was
        //      UNUSABLE.
        //   ② `uploaded: false` — a boolean is NOT a valid IndexedDB key, and
        //      the store carries an `uploaded` index. The record stayed OUT of
        //      that index, hence invisible to `getPendingImages()`: never
        //      uploaded, never cleaned.
        //
        // Both halves are proven here, and the negative control below replays
        // the defective shape to show the fix makes an OBSERVABLE difference.
        await boot(page);
        await goOffline(context, page);

        const written = await page.evaluate(async () => {
            const db = /** @type {any} */ (globalThis).GeoLeaf.Storage.DB;
            // Bytes we KNOW — the PNG header, so the assertion can say "these
            // are mine" and not merely "there is something".
            const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
            await db.storeImageLocally({
                id: "c6-photo",
                blob: new Blob([bytes], { type: "image/png" }),
                filename: "terrain.png",
                type: "image/png",
                size: bytes.byteLength,
                timestamp: Date.now(),
                uploaded: 0,
            });
            return { size: bytes.byteLength };
        });

        await goOnline(context, page);

        // ── THE RELOAD ──────────────────────────────────────────────────────────────────
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(
            () =>
                typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.getPendingImages) ===
                "function",
            null,
            { timeout: 25000 }
        );

        // ── ① The BYTES, and in the right SHAPE ─────────────────────────────────────────
        // `readBinary` tells a Blob from an ArrayBuffer and a string — the tool
        // written for this criterion, and what separates "there is a record"
        // from "there is an image". A `toBeTruthy()` would have been green with
        // the defect.
        const stored = await readBinary(page, {
            db: GEOLEAF_DB,
            store: "local_images",
            key: "c6-photo",
            field: "blob",
        });
        expect(stored.kind, "la photo doit être un Blob, pas une chaîne base64").toBe("blob");
        expect(stored.byteLength).toBe(written.size);

        // ── ② And it is IN the "pending" INDEX ──────────────────────────────────────────
        // The bug's second half: a boolean stays out of the index. Without this
        // assertion, a photo could have its bytes and stay invisible to upload
        // forever.
        const pending = await page.evaluate(async () => {
            const db = /** @type {any} */ (globalThis).GeoLeaf.Storage.DB;
            const rows = await db.getPendingImages();
            return rows.map((/** @type {any} */ r) => r.id);
        });
        expect(pending, "l'index `uploaded` doit voir la photo en attente").toContain("c6-photo");
    });

    test("CONTRÔLE NÉGATIF — la forme du bug n° 3 perd les octets ET sort de l'index", async ({
        page,
    }) => {
        // Without this test, the two assertions above would be indistinguishable
        // from a tolerant store. The EXACT shape `image-upload.ts` wrote before
        // the fix is replayed — `base64` instead of `blob`, `uploaded: false`
        // instead of `0` — showing both defects are observable on the real
        // store, not merely reasoned.
        await boot(page);

        await seedStore(page, {
            db: GEOLEAF_DB,
            store: "local_images",
            records: [
                {
                    id: "c6-defectueuse",
                    base64: "data:image/png;base64,iVBORw0KGgo=",
                    filename: "terrain.png",
                    type: "image/png",
                    size: 12,
                    timestamp: 1785600000000,
                    uploaded: false,
                },
            ],
        });

        // ① The bytes are nowhere: the field the reader looks at is ABSENT.
        const stored = await readBinary(page, {
            db: GEOLEAF_DB,
            store: "local_images",
            key: "c6-defectueuse",
            field: "blob",
        });
        expect(stored.kind, "`base64` n'est pas `blob` — le lecteur ne trouve rien").toBe("absent");

        // ② And the record is out of the index, hence invisible to upload.
        const pending = await page.evaluate(async () => {
            const db = /** @type {any} */ (globalThis).GeoLeaf.Storage.DB;
            const rows = await db.getPendingImages();
            return rows.map((/** @type {any} */ r) => r.id);
        });
        expect(pending, "un booléen reste HORS de l'index `uploaded`").not.toContain(
            "c6-defectueuse"
        );
        // …while it IS in the database: what makes the defect silent.
        const rows = await readStore(page, { db: GEOLEAF_DB, store: "local_images" });
        expect(rows.map((/** @type {any} */ r) => r.id)).toContain("c6-defectueuse");
    });
});
