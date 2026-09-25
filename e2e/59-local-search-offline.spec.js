// @ts-check
/**
 * 59 — FINDING A FEATURE BY ITS REFERENCE, OFF-NETWORK, ON THE SHIPPED BUNDLE.
 *
 * The gesture this proves: the network is cut, the user types a reference into the map's
 * search box — "PT-4472" — and the map recentres on that feature and selects it. Among
 * 30 000 of them, the dose this repository gates.
 *
 * What no unit suite can give: the real minified core and geocoding plugin, the layer loaded
 * by the real loader, the search box of the plugin talking to the core's `GeoLeaf.Layers`
 * through the runtime global, and a real MapLibre camera and feature-state.
 *
 * 🛑 THE DEFECTS IT CLOSES. The search box only ever asked a network geocoder — off-network
 * it could find nothing, and said nothing about it: zero results hid the list, which reads
 * as a bug. The filter, the other text box, masks without recentring.
 *
 * ⚠️ WHAT "NO NETWORK" MEANS HERE, and why it is split in two. During the SEARCH itself —
 * typing until the results show — nothing may leave for the application's origin nor for any
 * geocoder. Over the whole off-network phase, no geocoder may even be ASKED: a request that
 * can only fail is the defect, not a detail. Recentring the map may request basemap tiles:
 * that is the camera's business, not the search's, and it is not counted.
 *
 * ⚠️ WHAT THIS SPEC DOES NOT SEE. A layer never loaded (`active: false`) and a vector-tile
 * layer are not searchable — by construction, and said in the contract. Touch and WebKit are
 * not enabled on the `core` target.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { makeFeatureCollection } from "./helpers/feature-factory.js";
import { assertZeroNetwork, goOffline, recordRequests } from "./helpers/offline.js";

const ORIGIN = baseURL("core");
test.use({ baseURL: ORIGIN });

/**
 * A layer loaded at boot on `deploy-core`, hijacked for the dose. Measured by spec 56: of the
 * profile's layers, only three are loaded at boot; `provinces` is one, a polygon layer, not
 * clustered — so a selected feature paints its OUTLINE.
 */
const LAYER = "provinces";
const COUNT = 30_000;
const REF = "PT-4472";

/** Every geocoding service the plugin knows: none may be asked off-network. */
const GEOCODERS =
    /^https:\/\/(nominatim\.openstreetmap\.org|photon\.komoot\.io|api-adresse\.data\.gouv\.fr)\//;

/** Third-party, and not a geocoder — the basemap tiles a moving camera asks for. */
const THIRD_PARTY_NOT_GEOCODER = new RegExp(
    `^(?!${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?!${GEOCODERS.source.slice(1)})`
);

test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/**
 * Makes `provinces` a searchable layer of 30 000 polygons whose ids are `PT-0`…`PT-29999`,
 * and lists the layers before the address service in the search box.
 *
 * Routes go on the CONTEXT: the GeoJSON loader fetches from a Web Worker.
 */
async function armSearchableLayer(context) {
    await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`the bundle no longer carries a \`${LAYER}\` layer`);
        cfg.searchable = { fields: ["properties.label"] };
        bundle.modules = bundle.modules ?? {};
        const geocoding = bundle.modules.geocoding;
        if (!geocoding?.enabled) throw new Error("the bundle no longer enables geocoding");
        bundle.modules.geocoding = { ...geocoding, provider: ["layers", "nominatim"] };
        await route.fulfill({ json: bundle });
    });

    // Seeded, generated per run, never committed. Argentina, where the profile opens.
    const body = JSON.stringify(
        makeFeatureCollection({
            count: COUNT,
            seed: 7,
            clumps: 200,
            geometry: "Polygon",
            idPrefix: "PT-",
            bounds: [-66, -36, -58, -30],
        })
    );
    await context.route(`**/${LAYER}/data/${LAYER}.geojson**`, (route) =>
        route.fulfill({ contentType: "application/geo+json", body })
    );
}

/** Waits until the layer holds its 30 000 features and the search box is mounted. */
async function waitReady(page) {
    await page.waitForFunction(
        ({ id, count }) =>
            /** @type {any} */ (window).GeoLeaf?.Layers?.getFeatureCount?.(id) === count,
        { id: LAYER, count: COUNT },
        { timeout: 120_000 }
    );
    await expect(page.locator(".gl-geocoding-ctrl .gl-pill-search__input")).toBeVisible({
        timeout: 30_000,
    });
}

/** Types into the search box, the way a user does — key by key. */
async function typeQuery(page, text) {
    const input = page.locator(".gl-geocoding-ctrl .gl-pill-search__input");
    await input.fill("");
    await input.pressSequentially(text);
}

test.describe("59 — a reference is found and recentred on, off-network", () => {
    test.setTimeout(240_000);

    test(`"${REF}" recentres the map and selects it, with no network`, async ({
        page,
        context,
    }) => {
        await armSearchableLayer(context);
        await page.goto("/");
        await waitReady(page);

        // Where the feature is, read from the core — never guessed from the fixture.
        const target = await page.evaluate(
            ({ id, ref }) => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                const f = gl.Layers.getFeatureById(id, ref);
                const ring = f?.geometry?.coordinates?.[0] ?? [];
                const lngs = ring.map((c) => c[0]);
                const lats = ring.map((c) => c[1]);
                return {
                    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
                    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
                };
            },
            { id: LAYER, ref: REF }
        );

        await goOffline(context, page);
        const geocoders = recordRequests(context, { filter: (url) => GEOCODERS.test(url) });

        await assertZeroNetwork(
            context,
            async () => {
                await typeQuery(page, REF);
                await expect(page.locator(".gl-geocoding-result-item").first()).toHaveText(
                    "label-4472",
                    { timeout: 15_000 }
                );
            },
            { allow: [THIRD_PARTY_NOT_GEOCODER] }
        );

        await page.locator(".gl-geocoding-result-item").first().click();

        // Recentred on it — the camera animates, so the centre is waited for, not sampled.
        await page.waitForFunction(
            ({ lng, lat }) => {
                const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                const c = map.getCenter();
                return Math.abs(c.lng - lng) < 0.01 && Math.abs(c.lat - lat) < 0.01;
            },
            target,
            { timeout: 15_000 }
        );

        // Selected — the feature-state the adapter paints.
        const selected = await page.evaluate(
            ({ id, ref }) => {
                const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                return map.getFeatureState({ source: `gl-src-${id}`, id: ref })?.selected === true;
            },
            { id: LAYER, ref: REF }
        );
        expect(selected).toBe(true);

        // A reference nobody holds is SAID to be absent — an empty list reads as a bug.
        await typeQuery(page, "PT-999999");
        await expect(page.locator(".gl-geocoding-no-results")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".gl-geocoding-result-item")).toHaveCount(0);

        geocoders.stop();
        expect(geocoders.urls, "a geocoder was asked while the network was cut").toEqual([]);
    });
});
