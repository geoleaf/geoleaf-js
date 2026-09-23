// @ts-check
/**
 * 54 — THE SECOND DOWNLOAD CONVERGES: IT REWRITES WHAT CHANGED, AND WHAT THE SERVER DELETED LEAVES
 *
 * 🛑 THE DEFECTS THIS SPEC EXISTS FOR, three links of one chain, each proven on the real engine
 * by `packages/core/__tests__/capabilities/offline/pull-converges.test.ts` and
 * `cache-manager-orchestration.test.js`:
 *
 * 1. the zone drawn in the download window bounded the vector tiles and nothing else — the
 *    entities left as the whole collection, with no `bbox`;
 * 2. every synchronised entity was rewritten on every pull, the freshness marker stored from the
 *    first one never read back;
 * 3. nothing removed an entity the server had stopped serving — it stayed on the device.
 *
 * WHAT THIS SPEC ADDS TO THE UNIT SUITES: the gesture. The zone is set by the window's own
 * "profile area" button — which offered the current view until it read the profile's declared
 * extent — and the download is the window's own button, on the shipped bundle.
 *
 * ⚠️ MEASURED BEFORE THIS SPEC WAS WRITTEN, on the bundle it was first run against: the request
 * left as `…/items?f=json&limit=1000`; the window asks for `profile-bundle.json` again with `HEAD`
 * during the download; and the Service Worker controls the page by the second download.
 *
 * ⚠️ THE SOURCE IS A ROUTE, NOT A BACKEND. `deploy-full` ships `sites_rosario` without its
 * `offline.source` (`scripts/lib/dev-backend.cjs`, gated `DNS-05`): it is injected into the
 * bundle, and the collection is served here, with state — the test edits it between the two
 * downloads. `context.route`, not `page.route`: once the worker controls the page, a request it
 * issues never reaches a page route.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { readStore, readRecord, GEOLEAF_DB } from "./helpers/idb.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

// 🛑 COUNTER-EXPERIMENT, FOR THE ONE PLACE THAT SHOWS THE DEFECT: THE CI RUNNER. There, the test
// that FOLLOWS a test of this file in the same worker hung for 60 s creating its browser context
// (`browser.newContext: Test ended`, or `Failed to find browser context for id`) — 9 full runs out
// of 11 between 20 and 23/09/2026, never reproduced locally (12 passes, 9 of them on 2 cores). A
// test of this file leaves an active service worker and ~28 MB of storage (4 caches, ~170
// entries) for the browser to tear down when the context closes. This hook releases them itself —
// storage AND service worker, awaited — before the context closes, and logs how long it took. If
// the hangs stop over several runs, the teardown was the cause and this hook is the fix; if they
// do not, the lead is refuted and the hook goes.
test.afterEach(async ({ page, context, browserName }) => {
    if (browserName !== "chromium") return;
    try {
        const origin = new URL(page.url()).origin;
        const cdp = await context.newCDPSession(page);
        const t0 = Date.now();
        await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
        console.log(`[54-teardown] storage and service worker released in ${Date.now() - t0} ms`);
    } catch (err) {
        console.log(`[54-teardown] release skipped: ${err instanceof Error ? err.message : err}`);
    }
});

/** Where the injected pull source lives. Fulfilled here, so every request is readable. */
const OGC = "https://backend.test/ogc";
const T1 = "2026-09-01T08:00:00+00:00";
const T2 = "2026-09-01T09:30:00+00:00";
/**
 * The extent `tourism` declares — `map.bounds`, `[[south, west], [north, east]]` — as the `bbox`
 * OGC reads: `west,south,east,north`. Read from the served configuration by the test itself, so
 * a profile edit cannot leave this spec asserting a stale extent.
 */
let declaredBbox = "";

/** An entity as an OGC API Features server returns it, inside the declared extent. */
function row(id, updatedAt = T1, title = `Site 54-${id}`) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [-60.64 + id / 100, -32.94] },
        properties: { id, local_id: null, title, updated_at: updatedAt },
    };
}

/**
 * Gives `sites_rosario` its pull source, in the served bundle — and a delta declaration when
 * the case is about one.
 *
 * ⚠️ Only a `200` to a `GET` is rewritten: the window asks for the bundle again with `HEAD` while
 * it downloads, and a conditional request may answer `304` — neither carries a body to parse.
 *
 * @param {import("@playwright/test").Page} page
 * @param {Record<string, unknown>} [delta] - The `offline.source.delta` block, if any.
 */
async function armPullSource(page, delta) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const response = await route.fetch();
        if (route.request().method() !== "GET" || response.status() !== 200) {
            await route.fulfill({ response });
            return;
        }
        const bundle = await response.json();
        const cfg = bundle.layerConfigs?.sites_rosario;
        if (!cfg) throw new Error("le bundle ne porte plus la couche `sites_rosario`");
        cfg.offline = {
            ...(cfg.offline ?? {}),
            enabled: true,
            maxFeatures: 5000,
            source: { url: OGC, ...(delta ? { delta } : {}) },
        };
        await route.fulfill({ response, json: bundle });
    });
}

/**
 * Serves the collection with state, and records every URL it was asked for.
 *
 * It honours `datetime=<start>/..` the way OGC API Features Part 1 reads it — the rows whose
 * temporal property, here the freshness marker, falls in the interval, closed at its start.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @param {ReturnType<typeof row>[]} initial
 */
async function serveCollection(context, initial) {
    const rows = new Map(initial.map((f) => [f.id, f]));
    /** @type {URL[]} */
    const asked = [];
    await context.route(`${OGC}/**`, async (route) => {
        const url = new URL(route.request().url());
        asked.push(url);
        const since = url.searchParams.get("datetime")?.split("/")[0];
        const features = [...rows.values()].filter(
            (f) => !since || Date.parse(f.properties.updated_at) >= Date.parse(since)
        );
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                type: "FeatureCollection",
                numberMatched: features.length,
                numberReturned: features.length,
                features,
                links: [],
            }),
        });
    });
    return { rows, asked };
}

/**
 * Opens the download window, sets the zone with its "profile area" button, and downloads.
 *
 * @param {import("@playwright/test").Page} page
 * @param {() => number} askedCount - How many requests the source has received so far.
 */
async function downloadWithProfileZone(page, askedCount) {
    const before = askedCount();
    const modal = page.locator("#gl-cache-modal");
    if ((await modal.count()) === 0 || !(await modal.isVisible())) {
        await page.locator('[data-gl-toolbar-action="offline-ui"]').first().click();
        await expect(modal).toHaveCount(1, { timeout: 5000 });
    }
    await page.locator(".gl-cache-zone__buttons .gl-btn").nth(1).click();
    // 🛑 The witness that the zone EXISTS before the download reads it. The button persists it
    // asynchronously, and a download started on the next tick loaded a selection without it —
    // measured: the first green-candidate run sent no `bbox` at all for that reason alone. The
    // witness holds on a bundle that predates the fix too (the button then persisted the VIEW,
    // under the same `source`), so it hides nothing the subject below asserts.
    await expect
        .poll(
            async () => {
                const saved = await readRecord(page, {
                    db: GEOLEAF_DB,
                    store: "preferences",
                    key: "cache_layer_selection_tourism",
                });
                return saved?.value?.vectorZone?.source ?? null;
            },
            { timeout: 10000, message: "la zone n'est pas enregistrée avant le téléchargement" }
        )
        .toBe("profile");
    const download = page.locator("#gl-cache-download");
    await expect(download).toBeEnabled({ timeout: 30000 });
    await download.click();
    await expect
        .poll(askedCount, { timeout: 60000, message: "la source n'a reçu aucune requête" })
        .toBeGreaterThan(before);
    // The pull writes after the source answers: the button coming back is what says it is over.
    await expect(download).toBeEnabled({ timeout: 60000 });
}

/** The stored records of `sites_rosario`, by server identity. */
async function stored(page) {
    const records = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    return new Map(
        records.filter((r) => r.layerId === "sites_rosario").map((r) => [String(r.serverId), r])
    );
}

test("[offline] le second téléchargement ne réécrit que la modifiée, et la supprimée quitte l'appareil", async ({
    page,
    context,
}) => {
    test.setTimeout(150000);
    await armPullSource(page);
    const source = await serveCollection(context, [row(1), row(2), row(3)]);

    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    // The container shows before the profile is merged: wait for the declaration itself.
    await page.waitForFunction(
        () => Array.isArray(/** @type {any} */ (window).GeoLeaf?.Config?.get?.("map.bounds")),
        null,
        { timeout: 20000 }
    );
    const declared = await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Config.get("map.bounds")
    );
    declaredBbox = [declared[0][1], declared[0][0], declared[1][1], declared[1][0]].join(",");

    // --- first download: the reference state ------------------------------------------------
    await downloadWithProfileZone(page, () => source.asked.length);
    await expect.poll(async () => (await stored(page)).size, { timeout: 30000 }).toBe(3);
    const first = await stored(page);

    // --- the server moves on: one entity edited, one deleted ---------------------------------
    source.rows.set(2, row(2, T2, "Renommée côté serveur"));
    source.rows.delete(3);
    const askedBefore = source.asked.length;

    await downloadWithProfileZone(page, () => source.asked.length);

    // --- the witness: the second download really reached the source, through the worker ------
    // Without it, a store read after a download that never ran would say "nothing changed" and
    // look like convergence.
    expect(source.asked.length).toBeGreaterThan(askedBefore);
    expect(
        await page.evaluate(() => !!navigator.serviceWorker.controller),
        "le worker ne contrôle pas la page : la route de contexte n'est pas éprouvée"
    ).toBe(true);

    // --- the subject --------------------------------------------------------------------------
    // Soft, so a red run on a bundle that predates the fix names EVERY link that is missing.
    for (const url of source.asked) {
        expect
            .soft(url.searchParams.get("bbox"), `requête sans l'emprise : ${url}`)
            .toBe(declaredBbox);
    }
    const second = await stored(page);
    expect
        .soft([...second.keys()].sort(), "la supprimée est restée sur l'appareil")
        .toEqual(["1", "2"]);
    expect
        .soft(second.get("1")?.updatedAt, "l'inchangée a été réécrite")
        .toBe(first.get("1")?.updatedAt);
    expect.soft(second.get("2")?.feature?.properties?.title).toBe("Renommée côté serveur");
    expect.soft(second.get("2")?.version?.value).toBe(T2);
});

test("[offline] une couche qui DÉCLARE fraîcheur et suppressions ne demande que ce qui a changé", async ({
    page,
    context,
}) => {
    test.setTimeout(150000);
    const T0 = "2026-09-01T07:00:00+00:00";
    const T3 = "2026-09-01T11:00:00+00:00";
    await armPullSource(page, { freshness: "datetime", deletedProperty: "deleted_at" });
    const source = await serveCollection(context, [row(1, T0), row(2, T0), row(3, T1)]);

    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

    // --- first download: complete, and it leaves the mark T1 --------------------------------
    await downloadWithProfileZone(page, () => source.asked.length);
    await expect.poll(async () => (await stored(page)).size, { timeout: 30000 }).toBe(3);
    const first = await stored(page);

    // --- the server moves on: one entity edited, one deleted — served as a tombstone ---------
    source.rows.set(2, row(2, T2, "Renommée côté serveur"));
    const buried = row(3, T3);
    source.rows.set(3, { ...buried, properties: { ...buried.properties, deleted_at: T3 } });
    const askedBefore = source.asked.length;

    await downloadWithProfileZone(page, () => source.asked.length);

    // --- the witness: the second download reached the source ---------------------------------
    expect(source.asked.length).toBeGreaterThan(askedBefore);
    const second = source.asked.at(-1);

    // --- the subject --------------------------------------------------------------------------
    // Soft, so a red run on a bundle that predates the fix names EVERY link that is missing.
    expect
        .soft(second?.searchParams.get("datetime"), "le second n'a pas demandé le delta")
        .toBe(`${T1}/..`);
    const after = await stored(page);
    expect
        .soft([...after.keys()].sort(), "la pierre tombale est restée sur l'appareil")
        .toEqual(["1", "2"]);
    expect
        .soft(after.get("1")?.updatedAt, "une entité hors du delta a été réécrite")
        .toBe(first.get("1")?.updatedAt);
    expect.soft(after.get("2")?.feature?.properties?.title).toBe("Renommée côté serveur");
});
