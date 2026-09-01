// @ts-check
/**
 * 28 — THE OFFLINE QUEUE REPLAYS WHAT IT MUST (proof criterion no. 4)
 *
 * Two properties, and both are verified on the SHIPPED BUNDLE, not the source:
 *
 *   1. **A `failed` entry becomes processable again.** Until 2026-08-03, the
 *      queue read queried only the `pending` index: an entry that failed once
 *      NEVER came back. On a field device that is the most probable loss mode
 *      of the whole chain — a capture has neither server copy nor export, so
 *      an entry the queue stops offering is work lost, silently. The contract
 *      engraves it: `failed` **is not terminal**.
 *   2. **Replay order follows capture order**, down to the very millisecond,
 *      and it follows it AFTER a real boot — through the facade, the module
 *      registry and the browser's real IndexedDB.
 *
 * ## ⚠️ PORTED ONTO THE OUTBOX — AND TWO THINGS CHANGED IN NATURE
 *
 * This file used to seed a **v3** database dump and drive `sync_queue` through
 * `getPendingSyncQueue` / `updateSyncQueueStatus`. The store is removed, and
 * those two methods with it. The port is thus not a name swap:
 *
 * - **The seed goes through the ENGINE, no longer through a dump.**
 *   `Storage.applyEdit` has been the single writer since the storage
 *   unification, and it **validates the layer** — the v3 queue accepted any
 *   identifier, which let this file seed a `poi_tourisme` the profile does
 *   not carry. Seeding through the engine means seeding what the product can
 *   really write.
 * - **Order is no longer read in the same place.** `listPendingEdits()` groups
 *   **by state**; the DRAIN holds the global order, because it reads
 *   `outbox.list()`. The order property is thus asserted on the store, whose
 *   `seq` key IS the insertion order.
 *
 * 🛑 WHAT WOULD PROVE NOTHING:
 *   - a green on the `failed` entry alone: without a counter-proof, a requeue
 *     returning the WHOLE store would pass too. A `synced` entry is thus
 *     proven NOT to come back.
 *
 * ⚠️ The Service Worker is neither blocked nor involved. The subject is the
 * PAGE's engine — that is where replay runs (point 5 of the synchronisation
 * contract: the connector's authentication patches the page's `fetch` and
 * never reaches the worker). So the real environment is left in place rather
 * than simplified.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { wipeOnOrigin } from "./helpers/db-seed.js";
import { GEOLEAF_DB, readStore } from "./helpers/idb.js";

const ORIGIN = baseURL("core");

/**
 * The layer the seed borrows.
 *
 * ⚠️ `applyEdit` refuses `layerUnknown`: the `tourism` profile carries only
 * four editable layers, and this one is the only one declaring a `write`
 * block — **in the SOURCE**. ⚠️ That sentence used to stop there, and the
 * artifact has contradicted it since 2026-08-09: the served variant is a
 * DELIVERABLE, and `dev-backend.cjs` (DNS-05) strips `write.endpoint` from it,
 * setting `write.enabled` to `false`. See {@link ensureWriteTarget}, which is
 * the answer.
 */
const LAYER = "sites_rosario";

/**
 * Re-sets a write target on the layer, IN THE PAGE, before any drain.
 *
 * 🛑 **THIS HELPER EXISTS BECAUSE THE TEST MUST NOT DEPEND ON WHAT THE
 * DELIVERABLE DECLARES.** Since DNS-05, deliverable variants no longer carry
 * the bindings to the proof backend: `sites_rosario` there carries
 * `write.enabled: false` and no `endpoint`. The drain thus discarded the three
 * entries as `layerNoLongerWritable` **before any send**, and the cap test
 * came out red having never reached its subject — it no longer proved the
 * replay budget, only the absence of a target. The hardening is correct; it is
 * the test that borrowed a property the deliverable is no longer allowed to
 * have.
 *
 * ⚠️ **The origin is deliberately UNREACHABLE** (`.invalid`, reserved by
 * RFC 2606). This file proves the budget OFF-NETWORK: what it needs is a
 * **declared** target, not one that answers. Putting the proof backend there
 * would make the test depend on the containers, which `30-sync-cycle.spec.js`
 * has to assume and this one has no reason to share.
 *
 * The mutation bears on the ACTIVE profile, whose live reference
 * `getActiveProfile()` returns (`profile.ts` → `this._activeProfile`); the
 * same source `resolveWriteTarget` reads via `profileLayers()`.
 *
 * @param {import('@playwright/test').Page} page
 */
async function ensureWriteTarget(page) {
    const posed = await page.evaluate((layer) => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        const profile = gl?.Config?.getActiveProfile?.();
        const cfg = profile?.layers?.find((/** @type {any} */ l) => l.id === layer);
        if (!cfg) return false;
        cfg.write = {
            enabled: true,
            endpoint: `https://e2e-offline.invalid/${layer}`,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["nom"],
        };
        return true;
    }, LAYER);
    // A guard that cannot return false guards nothing: if the profile changes
    // shape, this test must SAY so, not silently fall back into the
    // `layerNoLongerWritable` it just left.
    expect(posed, `la couche "${LAYER}" doit exister dans le profil actif`).toBe(true);
}

/** The seed's three captures, in capture order. */
const CAPTURE_ORDER = ["cap-1", "cap-2", "cap-3"];

/**
 * Boots the application and waits for the offline engine to be WIRED.
 *
 * ⚠️ We wait for `Storage.DB.<method>` and not `Storage.applyEdit`: the facade
 * mounts `applyEdit` at boot, so waiting on it would return `true` with
 * `Storage.DB` still `null`. Measured at the outbox port — the witness must
 * prove the WIRING, not the facade's existence.
 *
 * @param {import('@playwright/test').Page} page
 */
async function boot(page) {
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
        () =>
            typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
            "function",
        null,
        { timeout: 25000 }
    );
}

/**
 * Seeds three captures THROUGH THE ENGINE, then forces the state of one.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} failedLocalId local id whose entry is set to `failed`
 * @returns {Promise<string[]>} the entry ids, in capture order
 */
function seedThroughEngine(page, failedLocalId) {
    return page.evaluate(
        async ({ layer, order, failed }) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            /** @type {string[]} */
            const ids = [];
            for (const localId of order) {
                const res = await gl.Storage.applyEdit({
                    layerId: layer,
                    kind: "create",
                    localId,
                    feature: {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                        properties: { nom: localId },
                    },
                });
                if (!res.entryId) throw new Error(`applyEdit refusé : ${res.refused}`);
                ids.push(res.entryId);
            }
            // The state is forced through the MODULE, not a raw write: the very
            // path the drain itself takes to mark a failure.
            const outbox = gl.Storage.DB._ensureModule("Outbox");
            const rows = await outbox.list();
            const target = rows.find((/** @type {any} */ r) => r.localId === failed);
            await outbox.updateState(target.id, "failed");
            return ids;
        },
        { layer: LAYER, order: CAPTURE_ORDER, failed: failedLocalId }
    );
}

/**
 * What the ENGINE still declares owed to the server — the surface the plugins
 * call.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{entryId: string, localId: string, state: string}[]>}
 */
function due(page) {
    return page.evaluate(async () => {
        const db = /** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB;
        if (!db) throw new Error("GeoLeaf.Storage.DB absent — l'app n'a pas booté son moteur");
        const rows = await db.listPendingEdits();
        return rows.map((/** @type {any} */ r) => ({
            entryId: r.entryId,
            localId: r.localId,
            state: r.state,
        }));
    });
}

test.describe("28 — la file hors-ligne rejoue ce qu'elle doit", () => {
    test.beforeEach(async ({ page }) => {
        await wipeOnOrigin(page, ORIGIN);
        await boot(page);
    });

    test("CRITÈRE 4 — une entrée `failed` reste DUE, et garde son rang de saisie", async ({
        page,
    }) => {
        await seedThroughEngine(page, "cap-2");

        // ── ① The criterion: it is still due. `failed` is not terminal.
        const rows = await due(page);
        const failed = rows.find((e) => e.localId === "cap-2");
        expect(failed, "une entrée `failed` doit rester traitable").toBeTruthy();
        expect(failed?.state).toBe("failed");

        // ── ② Its RANK. `listPendingEdits()` groups by state, so the global
        // order cannot be read there — the store carries it, through its `seq`
        // key, and that is what the drain reads since the order fix. A `failed`
        // entry neither "moves up" nor "down": it stays where capture put it.
        const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
        expect(outbox.map((/** @type {any} */ e) => e.localId)).toEqual(CAPTURE_ORDER);
    });

    test("CONTRÔLE NÉGATIF — une entrée `synced` ne revient PAS", async ({ page }) => {
        // Without this test, a requeue returning the whole store would pass the
        // previous one. A guard that cannot return false guards nothing.
        await seedThroughEngine(page, "cap-2");

        await page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const outbox = gl.Storage.DB._ensureModule("Outbox");
            const rows = await outbox.list();
            const first = rows.find((/** @type {any} */ r) => r.localId === "cap-1");
            await outbox.updateState(first.id, "synced");
        });

        const ids = (await due(page)).map((e) => e.localId).sort();
        expect(ids).not.toContain("cap-1");
        expect(ids).toEqual(["cap-2", "cap-3"]);
    });

    test("le plafond d'essais met l'entrée en QUARANTAINE — écartée du rejeu, pas du magasin", async ({
        page,
        context,
    }) => {
        // ⚠️ **THIS TEST SPENT A FEW HOURS AS A `test.fixme`**, and the motive
        // deserves reading: the cap it guards did NOT exist.
        // `MAX_REPLAY_ATTEMPTS` was enforced at write time in the v3 queue and
        // left with it at the outbox port; measured then, `push-engine` neither
        // incremented nor capped `attempts` — the budget was already absent
        // from the v4 path. Leaving it green by softening the assertion would
        // have closed the criterion over a fiction. It is re-armed because the
        // budget exists.
        await seedThroughEngine(page, "cap-2");

        // 🛑 WITHOUT THIS LINE, THE TEST DOES NOT REACH ITS SUBJECT — the three
        // entries leave as `layerNoLongerWritable` before any send, and the
        // `setOffline` below no longer affects the outcome. Seen red exactly so
        // on 2026-08-09.
        await ensureWriteTarget(page);

        // Off-network, the three sends fail as `networkError`: the path the
        // budget exists for — a failure that CAN be transient, so it is
        // replayed, but not forever.
        await context.setOffline(true);
        await page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            for (let i = 0; i < 3; i += 1) await gl.Storage.pushOutbox();
        });
        await context.setOffline(false);

        // Excluded from replay…
        const stillDue = (await due(page)).filter((e) => e.state !== "quarantined");
        expect(stillDue, "aucune entrée ne doit rester rejouable").toEqual([]);

        // …but STILL IN THE DATABASE, and MOTIVATED. What distinguishes it from
        // a disappearance: direct store read, because here the subject is
        // precisely what is PERSISTED.
        const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
        expect(outbox, "le contrat interdit de détruire une entrée").toHaveLength(3);
        for (const row of outbox) {
            expect(row.state).toBe("quarantined");
            expect(row.attempts).toBe(3);
            expect(row.quarantine).toBe("retryBudgetExhausted");
        }
    });

    test("trois captures dans la MÊME milliseconde gardent leur ordre", async ({ page }) => {
        // 🛑 THE CLOCK IS FROZEN, AND THAT IS THE SUBJECT. A first version
        // settled for three writes in a row, betting they would land in the
        // same millisecond: measured, they do not — each write awaits a real
        // IndexedDB transaction, which costs more than one ms. The test thus
        // went green without ever proving the collision condition. Freezing
        // `Date.now` REPRODUCES the condition instead of hoping for it.
        //
        // ⚠️ Only `Date.now` is frozen, never the timers: IndexedDB resolves
        // its requests on the event loop, and freezing it would hang every
        // `onsuccess`.
        //
        // ⚠️ **What the port changes**: in v3 the key was `sync_<ms>_<random>`
        // and the collision was the defect of a SORT on that key. The outbox
        // mints a monotonic `seq` — order is held **by construction**, not by a
        // sort. The test thus proves the construction holds on the deploy,
        // which no unit test can say.
        const written = await page.evaluate(async (layer) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const realNow = Date.now;
            const frozen = realNow.call(Date);
            Date.now = () => frozen;
            /** @type {string[]} */
            const ids = [];
            try {
                for (const localId of ["b03-1", "b03-2", "b03-3"]) {
                    const res = await gl.Storage.applyEdit({
                        layerId: layer,
                        kind: "create",
                        localId,
                        feature: {
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                            properties: { nom: localId },
                        },
                    });
                    if (!res.entryId) throw new Error(`applyEdit refusé : ${res.refused}`);
                    ids.push(localId);
                }
            } finally {
                Date.now = realNow;
            }
            return ids;
        }, LAYER);

        expect(written).toEqual(["b03-1", "b03-2", "b03-3"]);

        const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });

        // CONTROL OF THE CONTROL: without a shared timestamp, the green below
        // would come from distinct milliseconds and prove nothing.
        const stamps = new Set(outbox.map((/** @type {any} */ e) => e.createdAt));
        expect(stamps.size, "les 3 écritures doivent partager la milliseconde").toBe(1);

        expect(outbox.map((/** @type {any} */ e) => e.localId)).toEqual([
            "b03-1",
            "b03-2",
            "b03-3",
        ]);
    });
});
