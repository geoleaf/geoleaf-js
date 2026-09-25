// @ts-check
/**
 * 63 — A DESTROYED CAPTURE DOES NOT STAY ON THE MAP
 *
 * 🛑 THE DEFECT, MEASURED ON 25/09/2026. A quarantine is written on the queue entry, not on the
 * entity's local record, which keeps the `pending` state its edit gave it. Destroying the capture
 * (`Storage.discardQuarantined`, the confirmed exit) removed the entry and nothing else. What
 * remained was a record claiming local work that no entry would ever push — and that the pull
 * never replaces, since it preserves everything not `synced`. A layer that reads the device
 * before the network drew it on every load, online too.
 *
 * The case taken here is the one the contract names: the server deleted the entity
 * (`deletedOnServer`), the operator saw the capture and destroyed it. There is nothing on the
 * server to go back to, so the entity must be gone after the next load. Seen red on the bundle
 * built before the fix: the orphan was still drawn after the reload, and still in the store.
 *
 * ⚠️ The queue is SEEDED rather than produced by a real 404, as in `46`: what is under test
 * starts with the queue in that state. The unit half, every motive included, is
 * `packages/core/__tests__/capabilities/offline/quarantine-api.test.ts`.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { readRecord, seedStore, GEOLEAF_DB } from "./helpers/idb.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

const LAYER = "routes_principales";
/** A property value no shipped feature carries: the orphan is found by it, whatever its id. */
const MARK = "E2E-ORPHAN";
const LOCAL_ID = "srv:e2e-gone";
const ENTRY_ID = `update:${LAYER}:${LOCAL_ID}`;
const WAIT_MS = 20_000;

/** Makes the layer read the device before the network — the case where the orphan was drawn. */
async function armOfflineRead(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg)
            throw new Error(
                `le bundle ne porte plus de couche \`${LAYER}\` : la spec ne mord plus`
            );
        cfg.offline = { ...(cfg.offline ?? {}), enabled: true };
        await route.fulfill({ json: bundle });
    });
}

/** Loads the map and waits for the layer to hold features. */
async function loadLayer(page) {
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: WAIT_MS });
    await page.waitForFunction(
        (id) => {
            const w = /** @type {any} */ (window);
            try {
                return (w.GeoLeaf?.Layers?.getFeatureCount?.(id) ?? 0) > 0;
            } catch {
                return false;
            }
        },
        LAYER,
        { timeout: WAIT_MS }
    );
}

test("[offline] une saisie `deletedOnServer` détruite ne reste pas sur la carte", async ({
    page,
}) => {
    await armOfflineRead(page);
    await page.goto("/");
    await loadLayer(page);

    // The state a server deletion leaves: the entity's local record, still `pending`, and its
    // queue entry set aside with the motive.
    expect(
        await seedStore(page, {
            db: GEOLEAF_DB,
            store: "features",
            records: [
                {
                    layerId: LAYER,
                    localId: LOCAL_ID,
                    serverId: "e2e-gone",
                    syncState: "pending",
                    updatedAt: Date.now(),
                    version: null,
                    feature: {
                        type: "Feature",
                        properties: { id: "e2e-gone", nom: MARK },
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [-60.64, -32.94],
                                [-60.63, -32.95],
                            ],
                        },
                    },
                },
            ],
        })
    ).toBe(1);
    expect(
        await seedStore(page, {
            db: GEOLEAF_DB,
            store: "outbox",
            records: [
                {
                    seq: 9001,
                    id: ENTRY_ID,
                    layerId: LAYER,
                    localId: LOCAL_ID,
                    kind: "update",
                    state: "quarantined",
                    quarantine: "deletedOnServer",
                    attempts: 1,
                    createdAt: Date.now(),
                    baseVersion: null,
                },
            ],
        })
    ).toBe(1);

    // Control: before the destruction, the layer reads the device and DRAWS the entity. Waited
    // for, not sampled: the layer can first be filled from the network when the offline engine
    // wires late, and a sample taken then would say "not drawn" for the wrong reason.
    await page.reload();
    await page.waitForFunction(
        ([id, mark]) => {
            const f = /** @type {any} */ (window).GeoLeaf?.Layers?.getFeatures?.(id) ?? [];
            return f.some((/** @type {any} */ x) => x?.properties?.nom === mark);
        },
        [LAYER, MARK],
        { timeout: WAIT_MS }
    );

    const outcome = await page.evaluate(
        async ([id, localId]) => {
            const storage = /** @type {any} */ (window).GeoLeaf?.Storage;
            await storage?.whenReady?.();
            return storage?.discardQuarantined?.(id, localId);
        },
        [ENTRY_ID, LOCAL_ID]
    );
    expect(outcome).toEqual({ ok: true });

    // What the layer loader reads on the next load, asserted where it is decided rather than by
    // sampling a render: the record is gone, and the device no longer serves the entity.
    expect(
        await readRecord(page, { db: GEOLEAF_DB, store: "features", key: [LAYER, LOCAL_ID] }),
        "l'enregistrement local d'une saisie détruite ne reste pas sur l'appareil"
    ).toBeNull();
    const servedByDevice = await page.evaluate(
        async ([id, mark]) => {
            const fc = await /** @type {any} */ (
                window
            ).GeoLeaf?.Storage?.DB?.getLayerFeatureCollection?.(id);
            return (fc?.features ?? []).some((/** @type {any} */ x) => x?.properties?.nom === mark);
        },
        [LAYER, MARK]
    );
    expect(servedByDevice, "l'appareil ne sert plus l'entité détruite au chargeur de couches").toBe(
        false
    );
});
