// @ts-check
// The isochrone plugin in the delivered application, in the real engine: its zones are stacked
// on the map in the order its list shows, and they keep that order through everything the
// window lets a user do — move, restyle, delete — and through a basemap switch.
//
// 🛑 WHAT ONLY THIS SPEC SEES. The plugin's own tests run against a fake adapter, and the core's
// rank primitive against a local ordered stack that moves the way the engine does. Neither is
// the engine. Here the order is read from MapLibre's own layer list, after the bundle the
// application ships has drawn it.
//
// ⚠️ THE ENGINE IS SIMULATED, ITS ANSWER IS NOT. The routed body is the nominal response captured
// from the public server by `scripts/capture-isochrone-fixtures.cjs`, read from the package
// through `scripts/lib/packages.cjs` — a path written here would stop matching the day the
// package moves, and the spec would fail on a missing file instead of on the plugin.
//
// ⚠️ NO CLICK ON THE MAP. The origin is « my position », a GPS fix the browser context emulates —
// the core's GPS is switched on by the window's own button: the simulated click reaches the
// adapter's subscription under Chromium only, and everything below must hold under WebKit too.
// A real pointer stays a manual test.
//
// ⚠️ "WITHOUT RECREATING" IS MEASURED, NOT ASSUMED. A move that the rank primitive refuses falls
// back to removing and re-adding the zone — same final order, new source. The order alone cannot
// tell the two apart; the identity of the engine's source objects can.

import fs from "node:fs";
import path from "node:path";
import packages from "../scripts/lib/packages.cjs";
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { armAppReadyWitness, waitAppReadyWitness } from "./helpers/boot.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

// deploy-core: the plugin ships in every variant, and its button is drawn by the application.
test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/** `{ request, status, body }` — the envelope the capture script writes. */
const NOMINAL = JSON.parse(
    fs.readFileSync(
        path.join(
            packages.requireByDirName("isochrone").absDir,
            "fixtures",
            "valhalla-isochrone-nominal.json"
        ),
        "utf8"
    )
);
const ZONES = NOMINAL.body.features.length;
/** The GPS fix the browser gives: the origin of the captured request, so the zones lie around it. */
const [{ lat: GPS_LAT, lon: GPS_LON }] = NOMINAL.request.locations;
const SOURCE_PREFIX = "gl-src-__gl_isochrone_";
const BUTTON = '[data-gl-toolbar-action="isochrone"]';
const PANEL = "section.gl-isochrone__panel";
const ROW = "li.gl-isochrone__row";
const ORIGIN = ".gl-isochrone-origin";
const VECTOR_KEY = "e2e-isochrone-vector";
const STYLE_PATH = "/__e2e__/isochrone-vector-style.json";
const STYLE_NAME = "e2e-isochrone-fixture";
const WAIT_MS = 30_000;

/** The fixture basemap: a background and one empty fill, all same-origin. */
const FIXTURE_STYLE = {
    version: 8,
    name: STYLE_NAME,
    sources: {
        "e2e-base": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
        { id: "e2e-background", type: "background", paint: { "background-color": "#e8eef2" } },
        { id: "e2e-base-fill", type: "fill", source: "e2e-base" },
    ],
};

/**
 * The zones as the engine stacks them, TOP FIRST, with what lies under the lowest one.
 *
 * Each zone is drawn as several sub-layers reading one source; a zone's place is that of its
 * sub-layers, and two zones whose sub-layers interleave are reported, not averaged.
 *
 * @param {import('@playwright/test').Page} page
 */
function mapStack(page) {
    return page.evaluate((prefix) => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const order = /** @type {string[]} */ (native.getLayersOrder());
        /** @type {Map<string, { min: number, max: number }>} */
        const spans = new Map();
        order.forEach((layerId, i) => {
            const source = native.getLayer(layerId)?.source;
            if (typeof source !== "string" || !source.startsWith(prefix)) return;
            const zone = source.slice("gl-src-".length);
            const span = spans.get(zone);
            if (span) span.max = i;
            else spans.set(zone, { min: i, max: i });
        });
        const zones = [...spans.entries()].sort((a, b) => b[1].min - a[1].min);
        const interleaved = zones.some(([, s], k) => k > 0 && s.max > zones[k - 1][1].min);
        const lowest = zones.length ? Math.min(...zones.map(([, s]) => s.min)) : -1;
        return {
            zones: zones.map(([id]) => id),
            interleaved,
            // The SOURCES under the lowest zone: the basemap's must be among them.
            below: [
                ...new Set(
                    order.slice(0, Math.max(lowest, 0)).map((id) => native.getLayer(id)?.source)
                ),
            ].filter(Boolean),
        };
    }, SOURCE_PREFIX);
}

/** @param {import('@playwright/test').Page} page */
function rowIds(page) {
    return page
        .locator(ROW)
        .evaluateAll((rows) => rows.map((r) => /** @type {HTMLElement} */ (r).dataset.id));
}

/**
 * Fill colour and opacity of one zone, as the engine paints it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} zone
 */
function fillOf(page, zone) {
    return page.evaluate((id) => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const layer = `gl-${id}-fill`;
        if (!native.getLayer(layer)) return null;
        return {
            color: native.getPaintProperty(layer, "fill-color"),
            opacity: native.getPaintProperty(layer, "fill-opacity"),
        };
    }, zone);
}

/**
 * Sets an `<input>` the way a user's gesture does: value, then the `input` event.
 *
 * @param {import('@playwright/test').Locator} input
 * @param {string} value
 */
async function setInput(input, value) {
    await input.evaluate((el, v) => {
        const field = /** @type {HTMLInputElement} */ (el);
        field.value = v;
        field.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
}

test("les zones isochrones s'empilent sur la carte dans l'ordre de la liste, et le gardent", async ({
    page,
    context,
}) => {
    test.setTimeout(120_000);
    /** @type {string[]} */
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: GPS_LAT, longitude: GPS_LON });

    let engineCalls = 0;
    /** @type {{ lat: number, lon: number } | null} */
    let askedFrom = null;
    await page.route(
        (url) => url.pathname === "/isochrone",
        (route) => {
            engineCalls += 1;
            const question = JSON.parse(
                new URL(route.request().url()).searchParams.get("json") ?? "{}"
            );
            askedFrom = question.locations?.[0] ?? null;
            return route.fulfill({
                status: NOMINAL.status,
                contentType: "application/json",
                body: JSON.stringify(NOMINAL.body),
            });
        }
    );
    await serveBasemapTilesLocally(context);
    await context.route(`**${STYLE_PATH}*`, (route) => route.fulfill({ json: FIXTURE_STYLE }));
    await armAppReadyWitness(page);
    await page.goto("/");
    await waitAppReadyWitness(page);
    await page
        .locator("#gl-loader")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {});
    const rasterKey = await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Baselayers.getActiveKey()
    );

    // 1. The button the application declares loads the plugin and opens its window.
    await page.locator(`${BUTTON}:visible`).first().click();
    await expect(page.locator(PANEL)).toBeVisible({ timeout: WAIT_MS });

    // 2. One computation from « my position »: the core's GPS switched on, one request from the
    // fix, one row per captured contour.
    await page.locator(".gl-isochrone__locate").click();
    await expect(page.locator(ROW)).toHaveCount(ZONES, { timeout: WAIT_MS });
    await expect(page.locator(".gl-isochrone__status")).toContainText(String(ZONES));
    expect(engineCalls, "une seule question au moteur").toBe(1);
    expect(askedFrom, "la question n'est pas partie de la position GPS").toMatchObject({
        lat: GPS_LAT,
        lon: GPS_LON,
    });
    expect(
        await page.evaluate(
            () => /** @type {any} */ (window).GeoLeaf.Geolocation.getState().active
        ),
        "le GPS du cœur n'a pas été allumé"
    ).toBe(true);

    // 2b. The ORIGIN IS SHOWN — one marker, with a size, where the computation started (the GPS
    // fix). ⚠️ Presence is not visibility: a marker element of 0 × 0 sits in the DOM and shows
    // nothing, which is exactly how the origin went unseen.
    await expect(page.locator(ORIGIN)).toHaveCount(1);
    const marker = await page.locator(ORIGIN).boundingBox();
    const canvas = await page
        .locator("#geoleaf-map canvas.maplibregl-canvas")
        .first()
        .boundingBox();
    expect(marker, "le marqueur d'origine n'a pas de boîte").not.toBeNull();
    expect(canvas, "le canvas de la carte n'a pas de boîte").not.toBeNull();
    if (!marker || !canvas) return;
    expect(
        Math.min(marker.width, marker.height),
        "le marqueur d'origine est trop petit pour être vu"
    ).toBeGreaterThanOrEqual(10);
    // Measured against the engine's projection of the fix, polled: the core's GPS may still be
    // moving the camera.
    await expect
        .poll(
            async () => {
                const box = await page.locator(ORIGIN).boundingBox();
                const at = await page.evaluate(
                    ([lng, lat]) =>
                        /** @type {any} */ (window).GeoLeaf.Core.getMap()
                            .getNativeMap()
                            .project([lng, lat]),
                    [GPS_LON, GPS_LAT]
                );
                if (!box) return Infinity;
                return Math.hypot(
                    box.x + box.width / 2 - (canvas.x + at.x),
                    box.y + box.height / 2 - (canvas.y + at.y)
                );
            },
            { timeout: 10_000, message: "le marqueur n'est pas sur le point de calcul" }
        )
        .toBeLessThan(3);
    await expect(page.locator(ORIGIN)).toHaveAttribute("role", "img");
    await expect(page.locator(ORIGIN)).not.toHaveAttribute("aria-label", /^isochrone\./);

    // 3. ORDER — the engine's stack, top first, is the list, top first; above the basemap.
    const rows = await rowIds(page);
    const drawn = await mapStack(page);
    expect(drawn.zones, "ordre des zones sur la carte ≠ ordre des lignes").toEqual(rows);
    expect(drawn.interleaved, "les sous-couches de deux zones s'entrelacent").toBe(false);
    expect(drawn.below, "le fond n'est pas sous les zones").toContain("__geoleaf_basemap__");

    // 4. MOVE — the bottom row goes up one place; the map follows, the focus follows the row,
    // and no source is recreated.
    await page.evaluate((prefix) => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        /** @type {Record<string, unknown>} */
        const kept = {};
        for (const id of Object.keys(native.getStyle().sources)) {
            if (id.startsWith(prefix)) kept[id] = native.getSource(id);
        }
        /** @type {any} */ (window).__e2eIsochroneSources = kept;
    }, SOURCE_PREFIX);
    const moved = rows[rows.length - 1];
    await page.locator(`${ROW}[data-id="${moved}"] .gl-isochrone__up`).click();
    const expected = [...rows];
    expected.splice(rows.length - 2, 2, moved, rows[rows.length - 2]);
    await expect.poll(() => rowIds(page), { timeout: 10_000 }).toEqual(expected);
    await expect
        .poll(async () => (await mapStack(page)).zones, {
            timeout: 10_000,
            message: "la carte n'a pas suivi le déplacement de la ligne",
        })
        .toEqual(expected);
    const focusedRow = await page.evaluate(
        () => /** @type {HTMLElement | null} */ (document.activeElement?.closest("li"))?.dataset.id
    );
    expect(focusedRow, "le focus n'a pas suivi la ligne déplacée").toBe(moved);
    const recreated = await page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const kept = /** @type {Record<string, unknown>} */ (
            /** @type {any} */ (window).__e2eIsochroneSources
        );
        return Object.keys(kept).filter((id) => native.getSource(id) !== kept[id]);
    });
    expect(recreated, "sources recréées par un déplacement").toEqual([]);

    // 5. PAINT — colour and opacity reach the engine's paint (applied on the next frame).
    const restyled = moved;
    const row0 = page.locator(`${ROW}[data-id="${restyled}"]`);
    await setInput(row0.locator("input.gl-isochrone__swatch"), "#123456");
    await setInput(row0.locator("input.gl-isochrone__opacity"), "0.6");
    await expect
        .poll(() => fillOf(page, restyled), { timeout: 10_000 })
        .toEqual({ color: "#123456", opacity: 0.6 });

    // 6. DELETE — the row, its sub-layers and its source go; the others keep their order.
    // ⚠️ The TOP zone goes, not one of the moved pair: the pair is the only order the move
    // created, and the basemap switch below must still have it to lose.
    const removed = expected[0];
    await page.locator(`${ROW}[data-id="${removed}"] .gl-isochrone__remove`).click();
    const remaining = expected.filter((id) => id !== removed);
    await expect.poll(() => rowIds(page), { timeout: 10_000 }).toEqual(remaining);
    await expect
        .poll(async () => (await mapStack(page)).zones, { timeout: 10_000 })
        .toEqual(remaining);
    const leftovers = await page.evaluate((zone) => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const layers = native
            .getLayersOrder()
            .filter((/** @type {string} */ id) => id.startsWith(`gl-${zone}-`));
        return { layers, source: !!native.getSource(`gl-src-${zone}`) };
    }, removed);
    expect(leftovers, "une zone supprimée a laissé de quoi la dessiner").toEqual({
        layers: [],
        source: false,
    });

    // 7. BASEMAP — raster → vector downloads a style, vector → raster applies one inline: two
    // paths through the engine. Same zones, same order, same paint, and no new computation.
    const paintBefore = await fillOf(page, restyled);
    await page.evaluate(
        ({ key, url }) => {
            const bl = /** @type {any} */ (window).GeoLeaf.Baselayers;
            bl.registerBaseLayer(key, {
                type: "maplibre",
                label: "E2E vector",
                style: location.origin + url,
            });
            bl.setBaseLayer(key);
        },
        { key: VECTOR_KEY, url: STYLE_PATH }
    );
    await page.waitForFunction(
        (name) => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            return native.getStyle().name === name && native.isStyleLoaded() === true;
        },
        STYLE_NAME,
        { timeout: WAIT_MS }
    );
    const onVector = await mapStack(page);
    expect.soft(onVector.zones, "ordre perdu par raster → vecteur").toEqual(remaining);
    expect.soft(onVector.interleaved, "zones entrelacées après raster → vecteur").toBe(false);
    expect.soft(onVector.below, "le fond vectoriel n'est pas sous les zones").toContain("e2e-base");
    expect
        .soft(await fillOf(page, restyled), "peinture perdue par raster → vecteur")
        .toEqual(paintBefore);

    await page.evaluate(
        (key) => /** @type {any} */ (window).GeoLeaf.Baselayers.setBaseLayer(key),
        rasterKey
    );
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            return !!native.getSource("__geoleaf_basemap__") && native.isStyleLoaded() === true;
        },
        null,
        { timeout: WAIT_MS }
    );
    const onRaster = await mapStack(page);
    expect.soft(onRaster.zones, "ordre perdu par vecteur → raster").toEqual(remaining);
    expect.soft(onRaster.interleaved, "zones entrelacées après vecteur → raster").toBe(false);
    expect
        .soft(onRaster.below, "le fond raster n'est pas sous les zones")
        .toContain("__geoleaf_basemap__");
    expect
        .soft(await fillOf(page, restyled), "peinture perdue par vecteur → raster")
        .toEqual(paintBefore);
    await expect(page.locator(ROW), "la liste a changé avec le fond").toHaveCount(remaining.length);
    await expect(page.locator(ORIGIN), "le marqueur d'origine a disparu avec le fond").toHaveCount(
        1
    );
    expect(engineCalls, "un changement de fond a relancé un calcul").toBe(1);

    expect(pageErrors, `exceptions non rattrapées : ${pageErrors.join(" | ")}`).toEqual([]);
});

// ⚠️ Above 1440 px the core moves every slot that declares a DESKTOP button to the right-hand
// band. The isochrone's button belongs to the left-hand pill at every width — beside the map's
// own tools, like `measure` — so it declares no desktop button, here AND in its `entry.ts`.
test("au-delà de 1440 px, le bouton reste dans la barre de gauche", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await armAppReadyWitness(page);
    await page.goto("/");
    await waitAppReadyWitness(page);
    const buttons = page.locator(`${BUTTON}:visible`);
    await expect(buttons, "un seul bouton isochrone visible").toHaveCount(1);
    const iso = await buttons.boundingBox();
    const zoom = await page
        .locator('[data-gl-toolbar-action="zoom-in"]:visible')
        .first()
        .boundingBox();
    expect(iso, "le bouton isochrone n'a pas de boîte").not.toBeNull();
    expect(zoom, "le bouton de zoom n'a pas de boîte").not.toBeNull();
    if (!iso || !zoom) return;
    expect(
        Math.abs(iso.x - zoom.x),
        "le bouton isochrone a quitté la barre de gauche"
    ).toBeLessThan(2);
});
