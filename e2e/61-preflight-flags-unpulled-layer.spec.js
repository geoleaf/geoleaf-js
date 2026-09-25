// @ts-check
/**
 * 61 — "CAN I LEAVE?" FLAGS A LAYER THAT IS NOT ON THE DEVICE, ON THE SHIPPED BUNDLE.
 *
 * The gesture this proves: the user opens the offline window before leaving. A layer that
 * declares a pull source and was never downloaded is flagged; once downloaded, it no longer is;
 * and the check answers with the network cut, with no request.
 *
 * What no unit suite can give: the core's check (`Storage.preflight`) reading the real stores
 * of the shipped bundle, the offline window showing it next to the download, and the browser's
 * own persistence verdict — which the PWA requested at boot and only LOGGED.
 *
 * 🛑 WHAT MAKES IT FALSIFIABLE. On both shipped bundles, two layers were reported "declared,
 * never pulled" FOREVER: the report judged "declared" on `offline.enabled`, the pull on
 * `offline.source.url`, and a layer with the first and not the second can never be pulled —
 * `villes_principales` declares no source; `sites_rosario` has its proof source removed by the
 * deploy build. A check built on that report would flag, on a fresh boot, exactly what this
 * spec asks it to flag — and come out green having proved nothing. So the spec asserts BOTH
 * halves: the sourced layer IS flagged, the unsourced one is NOT, then the counter-case.
 *
 * ⚠️ The source is injected by route (spec 54's pattern): the deploy build strips the proof
 * backend, so no shipped layer carries one.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { readRecord, GEOLEAF_DB } from "./helpers/idb.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { assertZeroNetwork, goOffline } from "./helpers/offline.js";

test.use({ baseURL: baseURL("full") });

const OGC = "https://backend.test/ogc";
const ORIGIN = baseURL("full");

/** An entity as an OGC API Features server returns it, inside the declared extent. */
function row(id) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [-60.64 + id / 100, -32.94] },
        properties: {
            id,
            local_id: null,
            title: `Site 61-${id}`,
            updated_at: "2026-09-01T08:00:00+00:00",
        },
    };
}

test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** Gives `sites_rosario` a pull source, in the served bundle (GET 200 only — see spec 54). */
async function armPullSource(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const response = await route.fetch();
        if (route.request().method() !== "GET" || response.status() !== 200) {
            await route.fulfill({ response });
            return;
        }
        const bundle = await response.json();
        const cfg = bundle.layerConfigs?.sites_rosario;
        if (!cfg) throw new Error("the bundle no longer carries `sites_rosario`");
        cfg.offline = {
            ...(cfg.offline ?? {}),
            enabled: true,
            maxFeatures: 5000,
            source: { url: OGC },
        };
        await route.fulfill({ response, json: bundle });
    });
}

/** Serves the collection. */
async function serveCollection(context) {
    let asked = 0;
    await context.route(`${OGC}/**`, async (route) => {
        asked += 1;
        const features = [row(1), row(2)];
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
    return () => asked;
}

/** The check's row for a layer, or its absence. */
const rowOf = (page, id) => page.locator(`.gl-cache-preflight__layer[data-layer-id="${id}"]`);

test("[offline] the check flags a layer never downloaded — and only it — then clears it", async ({
    page,
    context,
}) => {
    test.setTimeout(150_000);
    await armPullSource(page);
    const askedCount = await serveCollection(context);

    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Storage.whenReady());

    // Open the offline window — where the device is prepared, and where the check lives.
    await page.locator('[data-gl-toolbar-action="offline-ui"]').first().click();
    await expect(page.locator("#gl-cache-modal")).toHaveCount(1, { timeout: 5_000 });
    const check = page.locator(".gl-cache-preflight");
    await expect(check).toBeVisible({ timeout: 10_000 });

    // ① The sourced layer, never downloaded, is flagged — and the device is not ready.
    await expect(rowOf(page, "sites_rosario")).toHaveAttribute(
        "data-status",
        "declaredNeverPulled"
    );
    await expect(rowOf(page, "sites_rosario")).toHaveAttribute("data-alert", "true");
    await expect(check).toHaveAttribute("data-verdict", "notReady");

    // ② The layer read locally but with NOTHING to pull is not listed at all: it was red for
    // ever under the former predicate, on every device.
    await expect(rowOf(page, "villes_principales")).toHaveCount(0);

    // ③ The browser's own verdict on keeping the data is SHOWN — headless Chromium refuses it.
    await expect(page.locator(".gl-cache-preflight__persistence")).toHaveAttribute(
        "data-persistence",
        "bestEffort"
    );

    // ④ Counter-case: once downloaded, the same layer is no longer flagged.
    const before = askedCount();
    await page.locator(".gl-cache-zone__buttons .gl-btn").nth(1).click();
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
            { timeout: 10_000 }
        )
        .toBe("profile");
    const download = page.locator("#gl-cache-download");
    await expect(download).toBeEnabled({ timeout: 30_000 });
    await download.click();
    await expect.poll(askedCount, { timeout: 60_000 }).toBeGreaterThan(before);
    await expect(download).toBeEnabled({ timeout: 60_000 });
    await expect(rowOf(page, "sites_rosario")).toHaveAttribute("data-status", "pulled", {
        timeout: 15_000,
    });
    await expect(rowOf(page, "sites_rosario")).toHaveAttribute("data-alert", "false");

    // ⑤ With the network cut, the check still answers — from the device, with no request to
    // the application's origin nor to the source.
    await goOffline(context, page);
    /** @type {any} */
    let offlineCheck = null;
    await assertZeroNetwork(
        context,
        async () => {
            offlineCheck = await page.evaluate(() =>
                /** @type {any} */ (window).GeoLeaf.Storage.preflight()
            );
        },
        {
            allow: [
                new RegExp(
                    `^(?!${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?!${OGC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`
                ),
            ],
        }
    );
    const rosario = offlineCheck?.layers?.find(
        (/** @type {any} */ l) => l.layerId === "sites_rosario"
    );
    expect(rosario?.status).toBe("pulled");
});
