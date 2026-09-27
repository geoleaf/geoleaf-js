// @ts-check
/**
 * 44 — A DOWNLOADED ENTITY, EDITED, REACHES ITS OWN SERVER ROW
 *
 * 🛑 THE DEFECT THIS SPEC EXISTS FOR, proven in the unit suite on 17/09/2026 and closed the
 * same day. The picker names an existing entity by the id the map shows — its SERVER identity
 * — while the store keys a downloaded entity under `srv:<id>` (or the client identity the
 * server echoes back). Nothing resolved one to the other: the edit landed on a SECOND record
 * with no server identity, and the request left as `?id=eq.null`. With the offline capability
 * on, the editor queues every write, so this missed the row for every modification and every
 * deletion of an existing entity — downloaded or not.
 *
 * 🛑 WHAT THIS SPEC ADDS TO THE UNIT SUITE: the REQUEST. `write-cycle-defects.test.ts` proves
 * the chain against `fake-indexeddb` with a controlled `fetch`; only a browser running the
 * shipped bundle proves that the picker, the plugin's adapter, the core's store and the drain
 * still agree once they are bundled — the exact seam three of this repository's measured
 * defects lived in.
 *
 * ⚠️ THE SERVER IS A ROUTE, NOT A BACKEND. The layer's `write.endpoint` is fulfilled by
 * Playwright, which is what makes the URL readable: the subject is the filter the drain built,
 * and a real backend would only answer it.
 *
 * ⚠️ The entity is seeded as a DOWNLOAD leaves it — `srv:<id>`, a server identity and the
 * freshness marker that came with it — rather than pulled for real: a pull needs an OGC source
 * this deliverable does not carry (`DNS-05` strips it), and what is under test starts after it.
 *
 * 🛑 AND A DELETED ONE REACHES IT TOO — the defect the two deletion tests exist for, measured on
 * 27/09/2026 on the shipped bundle. Delete from the pill or the `Delete` key, confirm, and
 * NOTHING: no `feature-deleted`, no queued write, the feature still in its layer, and a page
 * error for anyone looking. Removing a SELECTED shape makes the drawing engine deselect it first,
 * synchronously, and the editor's deselect handler reconciled the host as for a cancelled edit:
 * it removed that very copy and showed the original back, then the engine threw on an id it no
 * longer held. After a move, the deselect committed the move instead — the deletion left, but
 * preceded by an update and a `feature-saved` for a feature being deleted. No test deleted
 * anything, and no drawing-engine fake of the unit suite deselects on removal: only the real
 * engine says it. Both tests were seen red on the bundle built before the fix.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { readStore, seedStore, GEOLEAF_DB } from "./helpers/idb.js";
import { armEditor } from "./helpers/editor.js";
import { awaitSettledCamera } from "./helpers/camera.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** The layer the substitute feature takes the place of — loaded at boot, and linear. */
const LAYER = "routes_principales";

/** The server identity of the edited entity, carried in `properties` like every real layer. */
const ROW_ID = "cable-44";

/** Where the drain is told to write. Fulfilled here, so the request is readable. */
const ENDPOINT = "https://backend.test/rows";

/** The marker the download left on the record, and the one the server hands back. */
const PULLED_AT = "2026-09-01T08:00:00+00:00";
const WRITTEN_AT = "2026-09-01T09:30:00+00:00";

/**
 * Makes the layer editable and writable, and gives it one identified feature.
 *
 * The intercept is on `profile-bundle.json`: the deploy inlines every layer config at build
 * time, so `<id>_config.json` is never fetched at runtime (measured in spec 38).
 */
async function armWritableLayer(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`le bundle ne porte plus de couche \`${LAYER}\``);
        cfg.edition = { create: true, update: true, delete: true };
        cfg.editableGeometryTypes = ["LineString"];
        cfg.interactiveShape = true;
        cfg.write = {
            enabled: true,
            endpoint: ENDPOINT,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["nom"],
        };
        await route.fulfill({ json: bundle });
    });

    await page.route(`**/${LAYER}/data/${LAYER}.geojson**`, async (route) => {
        const fc = await (await route.fetch()).json();
        const line = (fc.features ?? []).find((f) => f?.geometry?.type === "LineString");
        if (!line) throw new Error(`aucune LineString dans les données de \`${LAYER}\``);
        await route.fulfill({
            json: {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: { id: ROW_ID, nom: "Câble 44", updated_at: PULLED_AT },
                        geometry: line.geometry,
                    },
                ],
            },
        });
    });
}

/** Page coordinates of the loaded line's middle vertex — see spec 38 for the waits' motives. */
async function projectMidVertex(page) {
    await expect
        .poll(
            async () =>
                page.evaluate((id) => {
                    const G = /** @type {any} */ (window).GeoLeaf;
                    const map = G.Core.getMap().getNativeMap();
                    // A projection taken mid-animation is stale by the time the mouse acts on
                    // it — spec 43 already carried this guard; see `helpers/camera.js`.
                    if (map.isMoving?.()) return 0;
                    const coords = G.Layers.getFeatures(id)[0].geometry.coordinates;
                    if (map.getZoom() < 8) {
                        map.jumpTo({ center: coords[Math.floor(coords.length / 2)], zoom: 9 });
                        return 0;
                    }
                    return map.queryRenderedFeatures().filter((f) => f.layer.id.includes(id))
                        .length;
                }, LAYER),
            { timeout: 30000, intervals: [500], message: "la ligne n'est jamais rendue à l'écran" }
        )
        .toBeGreaterThan(0);

    return page.evaluate((id) => {
        const G = /** @type {any} */ (window).GeoLeaf;
        const coords = G.Layers.getFeatures(id)[0].geometry.coordinates;
        const c = coords[Math.floor(coords.length / 2)];
        const map = G.Core.getMap().getNativeMap();
        const p = map.project(c);
        const rect = map.getContainer().getBoundingClientRect();
        return { x: p.x + rect.left, y: p.y + rect.top };
    }, LAYER);
}

/**
 * Serves the entity, seeds it as a download leaves it, arms the editor and SELECTS the entity's
 * copy at its middle vertex — the ground every test below starts from.
 *
 * The write endpoint answers every request with the row the server now holds, and records it.
 * From the selection on, the page's errors and the editor's write events are recorded too.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{
 *   sent: { method: string, url: string, body: string | null }[],
 *   errors: string[],
 *   mid: { x: number, y: number },
 * }>}
 */
async function openServedEntity(page) {
    /** @type {{ method: string, url: string, body: string | null }[]} */
    const sent = [];
    await page.route(`${ENDPOINT}**`, async (route) => {
        const request = route.request();
        sent.push({
            method: request.method(),
            url: request.url(),
            body: request.postData(),
        });
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ id: ROW_ID, nom: "Câble 44", updated_at: WRITTEN_AT }]),
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

    // The record a download leaves: keyed `srv:<id>`, and carrying the marker it came with.
    const geometry = await page.evaluate(
        (id) => /** @type {any} */ (window).GeoLeaf.Layers.getFeatures(id)[0].geometry,
        LAYER
    );
    const written = await seedStore(page, {
        db: GEOLEAF_DB,
        store: "features",
        records: [
            {
                layerId: LAYER,
                localId: `srv:${ROW_ID}`,
                serverId: ROW_ID,
                syncState: "synced",
                updatedAt: Date.now(),
                version: { kind: "timestamp", value: PULLED_AT },
                feature: {
                    type: "Feature",
                    properties: { id: ROW_ID, nom: "Câble 44", updated_at: PULLED_AT },
                    geometry,
                },
            },
        ],
    });
    expect(written, "l'entité rapatriée n'a pas été semée").toBe(1);

    await armEditor(page);

    // 🛑 No gesture before the camera is posed: a basemap applied late tilts it to `pitch: 60`
    // mid-drag, and the drag is lost in silence (see `helpers/camera.js`).
    await awaitSettledCamera(page);

    // Select — the gesture of spec 38, on a writable layer this time.
    const mid = await projectMidVertex(page);
    await page.mouse.click(mid.x, mid.y);
    await page.waitForFunction(
        () => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const src = map.getSource("td-linestring");
            const data = src?.serialize?.()?.data ?? src?._data;
            return (data?.features?.length ?? 0) > 0;
        },
        null,
        { timeout: 10000 }
    );

    /** @type {string[]} */
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__editorWrites = [];
        for (const name of ["feature-deleted", "feature-saved", "feature-sync-queued"]) {
            document.addEventListener(`geoleaf:editor:${name}`, (e) =>
                w.__editorWrites.push({ name, detail: /** @type {CustomEvent} */ (e).detail })
            );
        }
    });
    return { sent, errors, mid };
}

/**
 * The editor's write events since the selection, in order.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ name: string, detail: any }[]>}
 */
function editorWrites(page) {
    return page.evaluate(() => /** @type {any} */ (window).__editorWrites);
}

/**
 * Answers the deletion's confirmation.
 *
 * @param {import("@playwright/test").Page} page
 */
async function confirmDeletion(page) {
    const confirm = page.locator(".gl-form-modal-confirm .gl-form-modal__btn-delete");
    await expect(confirm, "la suppression ne demande pas de confirmation").toBeVisible({
        timeout: 5000,
    });
    await confirm.click();
}

/**
 * Waits until the deletion has left the layer: announced, then out of the layer's store.
 *
 * @param {import("@playwright/test").Page} page
 */
async function expectDeletedFromLayer(page) {
    await expect
        .poll(
            async () =>
                (await editorWrites(page))
                    .filter((w) => w.name === "feature-deleted")
                    .map((w) => w.detail),
            { timeout: 10000, message: "aucune suppression annoncée" }
        )
        .toEqual([{ featureId: ROW_ID, layerId: LAYER }]);
    await expect
        .poll(
            async () =>
                page.evaluate(
                    (id) => /** @type {any} */ (window).GeoLeaf.Layers.getFeatureCount(id),
                    LAYER
                ),
            { timeout: 10000, message: "la couche tient encore l'entité supprimée" }
        )
        .toBe(0);
}

test("[editor] une entité rapatriée, modifiée, atteint SA ligne serveur", async ({ page }) => {
    const { sent, mid } = await openServedEntity(page);

    // Move a vertex, commit.
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y - 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Enter");

    // 🛑 ONE record for the entity, under the key the download used — a second one would be
    // the defect in its first form, and the map would draw the entity twice.
    await expect
        .poll(
            async () => {
                const rows = await readStore(page, { db: GEOLEAF_DB, store: "features" });
                return rows.filter((r) => r.layerId === LAYER).length;
            },
            { timeout: 15000, message: "l'édition n'a pas atteint le magasin" }
        )
        .toBe(1);

    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Storage.pushOutbox());
    await expect
        .poll(async () => sent.length, { timeout: 20000, message: "rien n'est parti au serveur" })
        .toBeGreaterThan(0);

    // THE SUBJECT: the request the drain built.
    const patch = sent.find((r) => r.method === "PATCH");
    expect(patch, "aucune modification n'a été envoyée").toBeTruthy();
    expect(patch.url).toContain(`id=eq.${ROW_ID}`);
    expect(patch.url).not.toContain("id=eq.null");
    // The marker the download left is the filter: that is what makes a conflict observable.
    expect(patch.url).toContain(`updated_at=eq.${encodeURIComponent(PULLED_AT)}`);

    // And what the server answered is kept: the next edit will not take its own write for
    // someone else's.
    await expect
        .poll(
            async () => {
                const rows = await readStore(page, { db: GEOLEAF_DB, store: "features" });
                return rows.find((r) => r.serverId === ROW_ID)?.version?.value;
            },
            { timeout: 10000, message: "le marqueur rendu par le serveur n'a pas été repris" }
        )
        .toBe(WRITTEN_AT);

    const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
    expect(outbox.filter((r) => r.layerId === LAYER)).toHaveLength(0);
});

test("[editor] une entité rapatriée, supprimée par la pastille, quitte sa couche et atteint SA ligne serveur", async ({
    page,
}) => {
    const { sent, errors } = await openServedEntity(page);

    await page.locator('button.gl-editor-action-btn[data-action="delete"]').click();
    await confirmDeletion(page);

    // Before the fix: nothing announced, the layer still holding the entity.
    await expectDeletedFromLayer(page);

    // ⚠️ The outbox is NOT read here: queuing a write asks for a drain, which the route answers
    // at once — measured, the entry is often gone before a read reaches it. The request says
    // which entry left, and under which key.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Storage.pushOutbox());
    await expect
        .poll(async () => sent.length, { timeout: 20000, message: "rien n'est parti au serveur" })
        .toBeGreaterThan(0);

    // THE SUBJECT: the request the drain built — the row, and the marker the download left.
    expect(sent.map((r) => r.method)).toEqual(["DELETE"]);
    expect(sent[0].url).toContain(`id=eq.${ROW_ID}`);
    expect(sent[0].url).toContain(`updated_at=eq.${encodeURIComponent(PULLED_AT)}`);

    // Answered: nothing is owed any more, and the device no longer holds the entity.
    await expect
        .poll(
            async () => {
                const owed = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
                const held = await readStore(page, { db: GEOLEAF_DB, store: "features" });
                return [...owed, ...held].filter((r) => r.layerId === LAYER).length;
            },
            { timeout: 10000, message: "la suppression poussée reste due ou tenue" }
        )
        .toBe(0);
    expect(errors, "la suppression a levé une erreur").toEqual([]);
});

test("[editor] une entité rapatriée, modifiée PUIS supprimée au clavier, n'écrit que sa suppression", async ({
    page,
}) => {
    const { errors, mid } = await openServedEntity(page);

    // A move, NOT committed: the selection is still open when the deletion comes.
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y - 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Delete");
    await confirmDeletion(page);

    await expectDeletedFromLayer(page);
    // A negative needs a window: before the fix, the move was committed as an update a few
    // milliseconds after the deletion was queued, and announced as saved.
    await page.waitForTimeout(1000);

    const writes = await editorWrites(page);
    expect(
        writes.filter((w) => w.name === "feature-sync-queued").map((w) => w.detail.kind),
        "la suppression a écrit autre chose qu'elle-même"
    ).toEqual(["delete"]);
    expect(
        writes.filter((w) => w.name === "feature-saved"),
        "une entité supprimée a été annoncée enregistrée"
    ).toEqual([]);
    expect(errors, "la suppression a levé une erreur").toEqual([]);
});

// 🛑 THE SAME SILENCE, REACHED FROM THE KEYBOARD — measured on 27/09/2026, after the fix above.
// The editor listens for Enter and Delete on the whole document, and only excluded text fields.
// Enter on the confirmation's own button was taken for "leave the select tool": the button's
// activation was cancelled, the tool disarmed, the drawing engine deselected, and the dialog stayed
// open over a selection that no longer existed — its "Supprimer" then did nothing, without a word.
// Delete, pressed again inside the dialog, stacked a second confirmation over the first.
test("[editor] une suppression confirmée AU CLAVIER part, sans empiler de seconde confirmation", async ({
    page,
}) => {
    const { errors } = await openServedEntity(page);

    const dialogs = page.locator(".gl-form-modal-confirm");
    await page.keyboard.press("Delete");
    await expect(dialogs, "la suppression ne demande pas de confirmation").toHaveCount(1, {
        timeout: 5000,
    });

    // The focus is in the dialog now. A negative needs a window: a stacked dialog would be
    // created synchronously by the key, so a short one is enough.
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    expect(await dialogs.count(), "une seconde confirmation s'est empilée").toBe(1);

    // The first action (cancel) holds the focus; the confirmation is the next one.
    await page.keyboard.press("Tab");
    await expect(
        page.locator(".gl-form-modal-confirm .gl-form-modal__btn-delete"),
        "le bouton de confirmation n'a pas le focus"
    ).toBeFocused();
    await page.keyboard.press("Enter");

    // Before the fix: the dialog still open, nothing announced, the layer still holding it.
    await expectDeletedFromLayer(page);
    await expect(dialogs, "la confirmation est restée ouverte").toHaveCount(0);
    expect(errors, "la suppression a levé une erreur").toEqual([]);
});
