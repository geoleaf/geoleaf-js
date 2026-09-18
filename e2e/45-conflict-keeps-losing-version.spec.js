// @ts-check
/**
 * 45 — A SETTLED CONFLICT KEEPS THE VERSION IT CRUSHED
 *
 * 🛑 THE HOLE THIS SPEC EXISTS FOR, closed on 17/09/2026. `lastWriteWins` was made observable
 * the same day: the drain detects the conflict, logs it, and re-sends the write unfiltered.
 * What no part of the cycle ever did was LOOK at the row it was about to overwrite. After a
 * settled update the server still holds a row; after a settled DELETE it holds nothing, and
 * neither did anything else — the only irrecoverable loss of the whole write cycle.
 *
 * 🛑 WHAT THIS SPEC ADDS TO THE UNIT SUITE: the SHIPPED BUNDLE. `conflict-store.test.ts`
 * proves the chain against `fake-indexeddb` with a controlled `fetch`; only a browser running
 * the built bundle proves that the v6 migration ran, that the store exists in the deliverable,
 * and that the drain's three requests leave in the right order once everything is bundled.
 *
 * ⚠️ THE SERVER IS A ROUTE, NOT A BACKEND — same arrangement as spec 44. The subject is what
 * the drain reads and writes, and a real backend would only answer it.
 *
 * ⚠️ The entity is seeded as a DOWNLOAD leaves it rather than pulled for real: a pull needs an
 * OGC source this deliverable does not carry (`DNS-05` strips it), and what is under test
 * starts after it.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { readStore, seedStore, GEOLEAF_DB } from "./helpers/idb.js";
import { armEditor } from "./helpers/editor.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** The layer the substitute feature takes the place of — loaded at boot, and linear. */
const LAYER = "routes_principales";

/** The server identity of the edited entity, carried in `properties` like every real layer. */
const ROW_ID = "cable-45";

/** Where the drain is told to write, and to read back from. */
const ENDPOINT = "https://backend.test/rows";

/** The marker the download left on the record — the filter the edit leaves with. */
const PULLED_AT = "2026-09-01T08:00:00+00:00";
/** The marker A COLLEAGUE wrote in between. This is the version the overwrite destroys. */
const THEIRS_AT = "2026-09-01T09:30:00+00:00";
/** The marker the unfiltered re-send gets back. */
const WRITTEN_AT = "2026-09-01T11:00:00+00:00";

/** What the colleague left on the server, and what must survive being crushed. */
const THEIR_NAME = "Câble 45 — renommé au bureau";

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
                        properties: { id: ROW_ID, nom: "Câble 45", updated_at: PULLED_AT },
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

test("[offline] un conflit tranché conserve la version qu'il écrase", async ({ page, context }) => {
    /** @type {{ method: string, url: string }[]} */
    const sent = [];
    // 🛑 ON THE CONTEXT, AND NOT ON THE PAGE — measured here on 17/09/2026, and it is the
    // whole reason this spec first came out red. The Service Worker passes every non-`GET`
    // straight through (`sw-core.js`: `if (request.method !== "GET")`) but HANDLES the GETs,
    // and a request a Service Worker makes never reaches `page.route`. So the two `PATCH`es
    // were intercepted and the re-read's `GET` was not: it left for a host that does not
    // resolve, failed with `net::ERR_FAILED`, and the conflict was archived
    // `readOutcome: "unreadable"` — a plausible record, produced by the instrument rather
    // than by the code under test.
    //
    // ⚠️ `e2e/helpers/offline.js` already carries this fact for the traffic it RECORDS — its
    // header states that traffic is read on the CONTEXT and not on the page — and it holds
    // identically for the traffic a spec FULFILS. The witness below keeps the explanation FALSIFIABLE: without
    // it, "the Service Worker took it" is a story, and the day the worker stops controlling
    // this page the spec would keep passing while its comment lied.
    await context.route(`${ENDPOINT}**`, async (route) => {
        const request = route.request();
        const method = request.method();
        sent.push({ method, url: request.url() });

        // The row a colleague wrote — what the re-read finds, and what the overwrite destroys.
        if (method === "GET") {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify([{ id: ROW_ID, nom: THEIR_NAME, updated_at: THEIRS_AT }]),
            });
            return;
        }
        // Filtered on the marker the download left: zero rows, because it moved to THEIRS_AT.
        // `200 []` is the form this server says "nothing matched" in — measured on PostgREST.
        if (request.url().includes("updated_at=eq.")) {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: "[]",
            });
            return;
        }
        // The unfiltered re-send: the local version wins, and the server moves its marker.
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ id: ROW_ID, nom: "Câble 45", updated_at: WRITTEN_AT }]),
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

    // 🛑 THE STORE MUST EXIST IN THE DELIVERABLE. The v6 migration runs at boot, on whatever
    // version the browser already held; asserted first so a missing store fails HERE rather
    // than as an empty read at the end, where it would read as "nothing was kept".
    const conflictsAtBoot = await readStore(page, { db: GEOLEAF_DB, store: "conflicts" });
    expect(conflictsAtBoot, "la base livrée n'a pas de magasin `conflicts`").toEqual([]);

    // The record a download leaves: keyed `srv:<id>`, carrying the marker it came with.
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
                    properties: { id: ROW_ID, nom: "Câble 45", updated_at: PULLED_AT },
                    geometry,
                },
            },
        ],
    });
    expect(written, "l'entité rapatriée n'a pas été semée").toBe(1);

    await armEditor(page);

    // Select, move a vertex, commit — the gestures of spec 44, on a row that moved under us.
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

    await expect
        .poll(
            async () => {
                const rows = await readStore(page, { db: GEOLEAF_DB, store: "features" });
                return rows.filter((r) => r.layerId === LAYER).length;
            },
            { timeout: 15000, message: "l'édition n'a pas atteint le magasin" }
        )
        .toBe(1);

    // 🛑 THE WITNESS OF THE PARAGRAPH AT THE TOP. A worker IS controlling this page at the
    // moment the drain runs — which is what makes `context.route` necessary and `page.route`
    // blind to the re-read's `GET`.
    const controlled = await page.evaluate(
        () => !!navigator.serviceWorker && !!navigator.serviceWorker.controller
    );
    expect(controlled, "aucun Service Worker ne contrôle la page — relire le § du haut").toBe(true);

    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Storage.pushOutbox());

    // THE SUBJECT: the version the overwrite destroyed is still on the device.
    await expect
        .poll(
            async () => {
                const kept = await readStore(page, { db: GEOLEAF_DB, store: "conflicts" });
                return kept.length;
            },
            { timeout: 20000, message: "aucun conflit n'a été conservé" }
        )
        .toBe(1);

    const [kept] = await readStore(page, { db: GEOLEAF_DB, store: "conflicts" });
    expect(kept.layerId).toBe(LAYER);
    expect(kept.localId).toBe(`srv:${ROW_ID}`);
    expect(kept.kind).toBe("update");
    expect(kept.settledBy).toBe("lastWriteWins");
    expect(kept.readOutcome).toBe("read");
    // What the colleague had written, byte for byte — the point of the whole store.
    expect(kept.serverFeature?.nom).toBe(THEIR_NAME);
    expect(kept.serverVersion).toEqual({ kind: "timestamp", value: THEIRS_AT });
    // And the base the edit left on, so the conflict can be read without the outbox.
    expect(kept.baseVersion).toEqual({ kind: "timestamp", value: PULLED_AT });

    // 🛑 THE ORDER OF THE THREE REQUESTS, and it is the mechanism. A re-read AFTER the
    // overwrite would read back what we just wrote and archive it as "what was crushed" — a
    // record that looks right and is exactly backwards.
    const shape = sent
        .filter((r) => r.method !== "OPTIONS")
        .map((r) => `${r.method}${r.url.includes("updated_at=eq.") ? " filtré" : ""}`);
    expect(shape).toEqual(["PATCH filtré", "GET", "PATCH"]);

    // ⚠️ The local capture wins and the store holds IT, never the server's row: the archive is
    // evidence, never a source.
    const [record] = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    expect(record.feature.properties.nom).toBe("Câble 45");
    expect(record.version).toEqual({ kind: "timestamp", value: WRITTEN_AT });
});
