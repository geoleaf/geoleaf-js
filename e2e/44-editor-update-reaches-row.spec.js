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
 */

import { test, expect } from "@playwright/test";
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

test("[editor] une entité rapatriée, modifiée, atteint SA ligne serveur", async ({ page }) => {
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

    // Select, move a vertex, commit — the gestures of spec 38, on a writable layer this time.
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
