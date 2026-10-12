// @ts-check
/**
 * A THEME FRAMES THE MAP ON THE VIEW IT DECLARES
 *
 * A theme may declare `view` — an extent to fit (`bounds`), or a point to stand on (`center`
 * with `zoom`). Three things follow, and each one crosses several modules that the unit suites
 * prove one seam at a time:
 *
 *  1. THE MAP STARTS ON THE VIEW OF THE THEME THE PROFILE STARTS ON — and nothing of the boot
 *     moves it afterwards. The map is created on that view, and the reveal re-fits it before it
 *     announces the application ready.
 *  2. ACTIVATING A THEME MOVES THE CAMERA TO ITS VIEW; a theme that declares none leaves the
 *     camera where it is.
 *  3. THE VIEW OF A SHARED ADDRESS WINS — over the view of the theme the profile starts on, and
 *     over the view of the theme the address restores.
 *
 * The demo profile declares no view, and must not: a dozen specs read its initial framing. The
 * views are declared here, in the profile bundle the page receives.
 *
 * Seen red on the bundle built before theme views existed: (1) read the profile's framing back,
 * (2) read a camera that had not moved. (3) cannot be red there — nothing framed anything — and
 * was seen red on the new bundle with the restored theme activated without `keepView`.
 *
 * The unit halves: `packages/core/__tests__/app/core-map-start-view.test.ts` (the start),
 * `__tests__/themes/theme-applier-view.test.ts` (the switch), `__tests__/ui/permalink-sync.test.js`
 * (the address).
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/**
 * The views declared on the demo profile's themes, all inside its extent (lat [-55, -21.78],
 * lng [-73.5, -53.5]) and away from its own framing (centre ~ -38.4, -63.5, zoom ~ 4.2).
 *
 * - `environnement` is the theme the profile starts on: an extent.
 * - `tourisme` stands on a point.
 * - `paysage` declares none.
 */
const VIEWS = {
    environnement: {
        bounds: [
            [-36, -60],
            [-33, -57],
        ],
    },
    tourisme: { center: [-41.13, -71.3], zoom: 9 },
};
const SECTOR = { south: -36, west: -60, north: -33, east: -57, lat: -34.5, lng: -58.5 };

/**
 * Declares {@link VIEWS} in the profile bundle the page receives.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ declared: number }>} how many views were written — the witness that the
 *   rewrite bit: a route that matched nothing would leave every assertion below judging the
 *   profile's own framing.
 */
async function declareThemeViews(page) {
    const witness = { declared: 0 };
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        for (const theme of bundle?.themes?.themes ?? []) {
            const view = VIEWS[/** @type {keyof typeof VIEWS} */ (theme.id)];
            if (view) {
                theme.view = view;
                witness.declared += 1;
            }
        }
        await route.fulfill({ json: bundle });
    });
    return witness;
}

/**
 * Reads the camera off the engine.
 *
 * @param {import('@playwright/test').Page} page
 */
function readCamera(page) {
    return page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const center = native.getCenter();
        const bounds = native.getBounds();
        return {
            lat: center.lat,
            lng: center.lng,
            zoom: native.getZoom(),
            south: bounds.getSouth(),
            west: bounds.getWest(),
            north: bounds.getNorth(),
            east: bounds.getEast(),
        };
    });
}

/**
 * Asserts that the camera frames {@link SECTOR}: the whole extent is on screen, the camera sits
 * on its centre, and it is far closer than the profile's own framing.
 *
 * @param {{ lat: number, lng: number, zoom: number, south: number, west: number, north: number, east: number }} camera
 */
function expectSectorFramed(camera) {
    expect(camera.south).toBeLessThanOrEqual(SECTOR.south);
    expect(camera.north).toBeGreaterThanOrEqual(SECTOR.north);
    expect(camera.west).toBeLessThanOrEqual(SECTOR.west);
    expect(camera.east).toBeGreaterThanOrEqual(SECTOR.east);
    expect(Math.abs(camera.lat - SECTOR.lat)).toBeLessThan(0.5);
    expect(Math.abs(camera.lng - SECTOR.lng)).toBeLessThan(0.5);
    // The profile's framing sits near zoom 4.2; a three-degree extent fits several levels closer.
    expect(camera.zoom).toBeGreaterThan(6);
}

/**
 * Waits until the theme bar's engine seam is up: `setTheme` rejects before that.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitThemeSelectorReady(page) {
    await page.waitForFunction(
        () => /** @type {any} */ (window).GeoLeaf?.ThemeSelector?.isInitialized?.() === true,
        null,
        { timeout: 30_000 }
    );
}

test("[boot] la carte démarre sur la vue du thème de départ, et rien du boot ne la déplace ensuite", async ({
    page,
}) => {
    const witness = await declareThemeViews(page);
    // Before any script of the page: the camera is read AT the announcement.
    await page.addInitScript(() => {
        document.addEventListener(
            "geoleaf:app:ready",
            () => {
                const w = /** @type {any} */ (window);
                const native = w.GeoLeaf.Core.getMap().getNativeMap();
                const center = native.getCenter();
                const bounds = native.getBounds();
                w.__cameraAtReady = {
                    lat: center.lat,
                    lng: center.lng,
                    zoom: native.getZoom(),
                    south: bounds.getSouth(),
                    west: bounds.getWest(),
                    north: bounds.getNorth(),
                    east: bounds.getEast(),
                    at: performance.now(),
                };
            },
            { once: true }
        );
    });

    await page.goto("/");

    // Well past the announcement: what is read then is what stays.
    await page.waitForFunction(
        () => {
            const atReady = /** @type {any} */ (window).__cameraAtReady;
            return !!atReady && performance.now() - atReady.at > 600;
        },
        null,
        { timeout: 30_000 }
    );
    const atReady = await page.evaluate(() => /** @type {any} */ (window).__cameraAtReady);
    const later = await readCamera(page);

    expect(witness.declared, "the views were declared in the bundle").toBeGreaterThan(0);
    expectSectorFramed(atReady);
    expect(later.lat).toBeCloseTo(atReady.lat, 6);
    expect(later.lng).toBeCloseTo(atReady.lng, 6);
    expect(later.zoom).toBeCloseTo(atReady.zoom, 6);
});

test("[bascule] un thème cadré déplace la caméra, un thème sans vue la laisse où elle est", async ({
    page,
}) => {
    await declareThemeViews(page);
    await page.goto("/");
    await waitThemeSelectorReady(page);

    // A theme that stands on a point: the camera is there once the theme is applied.
    await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.ThemeSelector.setTheme("tourisme")
    );
    const onSpot = await readCamera(page);
    expect(onSpot.lat).toBeCloseTo(VIEWS.tourisme.center[0], 3);
    expect(onSpot.lng).toBeCloseTo(VIEWS.tourisme.center[1], 3);
    expect(onSpot.zoom).toBeCloseTo(VIEWS.tourisme.zoom, 3);

    // A theme that declares no view: the camera has not moved.
    await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.ThemeSelector.setTheme("paysage")
    );
    const stillOnSpot = await readCamera(page);
    expect(stillOnSpot.lat).toBeCloseTo(onSpot.lat, 6);
    expect(stillOnSpot.lng).toBeCloseTo(onSpot.lng, 6);
    expect(stillOnSpot.zoom).toBeCloseTo(onSpot.zoom, 6);

    // A theme that declares an extent — the one the profile started on: activated again, it
    // frames again.
    await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.ThemeSelector.setTheme("environnement")
    );
    expectSectorFramed(await readCamera(page));
});

test("[permalien] la vue de l'adresse l'emporte sur celle du thème de départ et sur celle du thème restauré", async ({
    page,
}) => {
    await declareThemeViews(page);
    // A view inside the profile, away from the three framings this spec knows — and a theme
    // that is not the one the profile starts on, so the address has a theme to restore.
    await page.goto("/#gl_lat=-48&gl_lng=-66&gl_zoom=8&gl_theme=tourisme");

    // `getCurrentTheme()` changes once the theme is APPLIED — a framing, the first thing an
    // activation does, would already have happened.
    await page.waitForFunction(
        () =>
            /** @type {any} */ (window).GeoLeaf?.ThemeSelector?.getCurrentTheme?.() === "tourisme",
        null,
        { timeout: 30_000 }
    );

    const camera = await readCamera(page);
    expect(camera.lat).toBeCloseTo(-48, 1);
    expect(camera.lng).toBeCloseTo(-66, 1);
    expect(camera.zoom).toBeCloseTo(8, 1);
});
