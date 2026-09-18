// @ts-check
/**
 * 46 — "RETRY ALL (MOTIVE X)" REPLAYS THAT MOTIVE, AND ONLY IT
 *
 * 🛑 THE DEFECT, MEASURED ON 17/09/2026. The editor's pending-operations window listed every
 * non-`synced` entry, set-aside ones included, showing two fields: the operation and the
 * layer. Nothing said an entry was quarantined, nothing said why, and its single "Retry now"
 * button called the drain — which replays `pending` and `failed` only. The one gesture the
 * window offered had, by construction, no effect on the entries it had been opened for.
 *
 * 🛑 AND TWO MOTIVES HAD NO EXIT AT ALL. `rejectedByServer` and `deletedOnServer` are what
 * the core's `REQUEUEABLE` excludes: their only contractual exit is `discardQuarantined`,
 * which had zero callers anywhere.
 *
 * 🛑 WHAT THIS SPEC ADDS TO THE UNIT SUITE: the CHAIN. `quarantine-actions.test.ts` proves
 * the window renders and calls back; only the shipped bundle proves that the callback reaches
 * the core's queue, that the core's rule — read through `Storage.requeueableReasons()` —
 * arrives in the plugin, and that a requeued entry is then actually SENT.
 *
 * ⚠️ THE SERVER IS A ROUTE, NOT A BACKEND. The subject is which entries leave, not what a
 * backend answers.
 *
 * ⚠️ The queue is SEEDED rather than produced by failing sends: producing an `authRequired`
 * quarantine for real would mean driving a 401 through the connector, i.e. testing the
 * connector. What is under test starts with the queue in that state.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { readStore, seedStore, GEOLEAF_DB } from "./helpers/idb.js";
import { armEditor } from "./helpers/editor.js";

test.use({ baseURL: baseURL("full") });

const LAYER = "routes_principales";
const ENDPOINT = "https://backend.test/rows";
const PULLED_AT = "2026-09-01T08:00:00+00:00";
const WRITTEN_AT = "2026-09-01T11:00:00+00:00";

/** The two set-aside entries a dead session leaves, and the one a refusal leaves. */
const ASIDE = [
    { seq: 101, id: "update:sites:srv:a1", localId: "srv:a1", quarantine: "authRequired" },
    { seq: 102, id: "update:sites:srv:a2", localId: "srv:a2", quarantine: "authRequired" },
    { seq: 103, id: "update:sites:srv:b1", localId: "srv:b1", quarantine: "rejectedByServer" },
];

/** Makes the layer writable — the drain refuses a layer without a write target. */
async function armWritableLayer(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`le bundle ne porte plus de couche \`${LAYER}\``);
        cfg.edition = { create: true, update: true, delete: true };
        cfg.write = {
            enabled: true,
            endpoint: ENDPOINT,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["nom"],
        };
        await route.fulfill({ json: bundle });
    });
}

/** Seeds one entity and its set-aside queue entry, as a failed tour leaves them. */
async function seedQuarantinedTour(page) {
    const features = ASIDE.map((e) => ({
        layerId: LAYER,
        localId: e.localId,
        serverId: e.localId.replace("srv:", ""),
        syncState: "pending",
        updatedAt: Date.now(),
        version: { kind: "timestamp", value: PULLED_AT },
        feature: {
            type: "Feature",
            properties: { id: e.localId.replace("srv:", ""), nom: e.localId },
            geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        },
    }));
    expect(await seedStore(page, { db: GEOLEAF_DB, store: "features", records: features })).toBe(
        ASIDE.length
    );

    const entries = ASIDE.map((e) => ({
        seq: e.seq,
        id: e.id,
        layerId: LAYER,
        localId: e.localId,
        kind: "update",
        state: "quarantined",
        quarantine: e.quarantine,
        attempts: 3,
        createdAt: Date.now(),
        baseVersion: { kind: "timestamp", value: PULLED_AT },
    }));
    expect(await seedStore(page, { db: GEOLEAF_DB, store: "outbox", records: entries })).toBe(
        ASIDE.length
    );
}

test("[editor] « réessayer tout (motif X) » ne rejoue que ce motif, et l'envoie", async ({
    page,
}) => {
    /** @type {{ method: string, url: string }[]} */
    const sent = [];
    await page.route(`${ENDPOINT}**`, async (route) => {
        const request = route.request();
        sent.push({ method: request.method(), url: request.url() });
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ id: "a1", nom: "vu", updated_at: WRITTEN_AT }]),
        });
    });

    await armWritableLayer(page);
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(
        (id) => {
            const L = /** @type {any} */ (window).GeoLeaf?.Layers;
            try {
                return (L?.getFeatureCount?.(id) ?? 0) > 0;
            } catch {
                return false;
            }
        },
        LAYER,
        { timeout: 20000 }
    );

    await seedQuarantinedTour(page);
    await armEditor(page);

    // 🛑 THE CORE'S RULE REACHES THE PLUGIN. Without it the window offers no group at all —
    // the honest reading of "the engine did not tell me" — so a missing relay would look like
    // a rendering bug rather than the broken seam it is.
    const requeueable = await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Storage.requeueableReasons()
    );
    expect(requeueable, "la règle du rejeu n'atteint pas le plugin").toContain("authRequired");
    expect(requeueable).not.toContain("rejectedByServer");

    // The badge is the only way in, and it is what the operator actually presses.
    const badge = page.locator(".gl-editor-queue-badge");
    await expect(badge).toBeVisible({ timeout: 15000 });
    await badge.click();
    await expect(page.locator(".gl-editor-queue-detail")).toBeVisible({ timeout: 10000 });

    // One group, and it is the requeueable motive. The refusal has no retry — it has a discard.
    const groups = page.locator(".gl-editor-queue-detail__requeue");
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toHaveAttribute("data-gl-reason", "authRequired");
    await expect(page.locator(".gl-editor-queue-detail__discard")).toHaveCount(1);

    await groups.first().click();

    // THE SUBJECT: the two entries of that motive left the quarantine and were SENT; the
    // third one did not move.
    await expect
        .poll(
            async () => {
                const rows = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
                return rows.filter((r) => r.state === "quarantined").map((r) => r.quarantine);
            },
            { timeout: 20000, message: "le motif n'a pas été remis en file" }
        )
        .toEqual(["rejectedByServer"]);

    await expect
        .poll(async () => sent.filter((r) => r.method === "PATCH").length, {
            timeout: 20000,
            message: "les entrées remises en file ne sont jamais parties",
        })
        .toBe(2);

    // ⚠️ The window stays open and re-reads itself: both gestures change the queue on the
    // core's side, so patching the DOM would make it a second, divergent tally.
    await expect(page.locator(".gl-editor-queue-detail")).toBeVisible();
    await expect(page.locator(".gl-editor-queue-detail__requeue")).toHaveCount(0);
});
