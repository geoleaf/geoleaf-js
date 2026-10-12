// @ts-check
/**
 * 84 — A LAYER BORN EMPTY HEARS A GESTURE ON WHATEVER IT IS FILLED WITH
 *
 * A GeoJSON layer created with no feature says nothing about its geometry, so it is built with
 * the sub-layers of the three families — fill, line, circle. Its gestures were bound to ONE
 * family, chosen by precedence (fill first): filled later with points, the layer drew them and
 * never heard them. A click on such a point went to whatever another layer drew underneath.
 *
 * 🛑 WHAT A REAL ENGINE ESTABLISHES, AND THE UNIT TEST CANNOT. The binder is proven on a map
 * double, which runs no listener of its own. The fix hands the engine an ARRAY of sub-layers for
 * one listener (`kernel/geojson/feature-interaction.ts`), and what the engine does with it — one
 * call per gesture, the topmost feature first, a `leave` only once every sub-layer is left — is
 * read here, from real pointer events.
 *
 * The layers are created through `GeoLeaf.Layers.create()` and filled through
 * `GeoLeaf.GeoJSON.updateLayerData()`: the mechanism is the subject, not a profile, and every
 * assertion names the layer it reads, whatever a shipped layer draws at the same place. What is read is the kernel seam, `geoleaf:feature:click` and
 * `geoleaf:feature:hover` — the popup and the tooltip are drawn from nothing else.
 *
 * Seen RED on the deployed build that preceded the fix: no `geoleaf:feature:click` from the
 * layer born empty, only the one of the polygon layer under the point.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { bootMapUntilIdle } from "./helpers/boot.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full") });

/** A polygon layer created with its data: what lies UNDER the point. */
const BELOW = "e2e_polygon_below";
/** The layer created with no feature, and filled afterwards. */
const BORN_EMPTY = "e2e_born_empty";
const WAIT_MS = 20_000;

/**
 * Where the fixture sits, in pixels from the middle of the canvas. The features are laid out on
 * the camera the profile boots on rather than at fixed coordinates: a profile may bound its
 * map, and a `fitBounds` towards a place outside those bounds is clamped without a word.
 */
const POINT_PX = [0, 0];
/** Inside the polygon the born-empty layer carries itself, away from the point above. */
const OWN_POLYGON_POINT_PX = [220, 0];

/**
 * Boots, creates the polygon layer with its data and the other one EMPTY, fills the latter,
 * frames both and starts recording the seam.
 * @param {import('@playwright/test').Page} page
 */
async function bootWithBornEmptyLayer(page) {
    // The loader gone, as a pointer user finds the page: under its veil the first click of a
    // test lands on the overlay, and the map hears nothing — a red that names no defect.
    await bootMapUntilIdle(page);
    await awaitSettledCamera(page);
    await page.evaluate(async ([below, bornEmpty, pointPx, ownPx]) => {
        const w = /** @type {any} */ (window);
        const G = w.GeoLeaf;
        const map = G.Core.getMap().getNativeMap();
        const canvas = map.getCanvas();
        const mid = [canvas.clientWidth / 2, canvas.clientHeight / 2];
        const at = (dx, dy) => map.unproject([mid[0] + dx, mid[1] + dy]).toArray();
        const square = (px, half) => [
            at(px[0] - half, px[1] - half),
            at(px[0] + half, px[1] - half),
            at(px[0] + half, px[1] + half),
            at(px[0] - half, px[1] + half),
            at(px[0] - half, px[1] - half),
        ];
        const feature = (id, type, coordinates) => ({
            type: "Feature",
            id,
            properties: { id },
            geometry: { type, coordinates },
        });
        w.__at = { point: at(pointPx[0], pointPx[1]), ownPolygonPoint: at(ownPx[0], ownPx[1]) };
        // What the born-empty layer receives later: two points, and a polygon under the second.
        w.__fill = {
            type: "FeatureCollection",
            features: [
                feature("own-polygon", "Polygon", [square(ownPx, 50)]),
                feature("point-over-other-layer", "Point", w.__at.point),
                feature("point-over-own-polygon", "Point", w.__at.ownPolygonPoint),
            ],
        };
        await G.Layers.create({
            id: below,
            label: "E2E — polygone dessous",
            geometry: "polygon",
            inlineData: {
                type: "FeatureCollection",
                features: [feature("below-1", "Polygon", [square(pointPx, 70)])],
            },
        });
        await G.Layers.create({
            id: bornEmpty,
            label: "E2E — couche née vide",
            inlineData: { type: "FeatureCollection", features: [] },
        });
        w.__seam = [];
        for (const type of ["geoleaf:feature:click", "geoleaf:feature:hover"]) {
            document.addEventListener(type, (e) => {
                const d = /** @type {CustomEvent} */ (e).detail;
                w.__seam.push({
                    type,
                    layerId: d.layerId,
                    featureId: d.featureId,
                    phase: d.phase ?? null,
                });
            });
        }
    }, /** @type {[string, string, number[], number[]]} */ ([BELOW, BORN_EMPTY, POINT_PX, OWN_POLYGON_POINT_PX]));

    // The premise, read before anything is asserted on it: born empty, the three families.
    const subs = await page.evaluate(
        (id) =>
            /** @type {any} */ (window).GeoLeaf.Core.getMap().getLayerRegistry().getSubLayerIds(id),
        BORN_EMPTY
    );
    for (const family of ["fill", "line", "circle"]) {
        expect(subs, `née vide, la couche a une sous-couche « ${family} »`).toContain(
            `gl-${BORN_EMPTY}-${family}`
        );
    }

    await page.evaluate((id) => {
        const w = /** @type {any} */ (window);
        w.GeoLeaf.GeoJSON.updateLayerData(id, w.__fill);
    }, BORN_EMPTY);
    // Drawn, not merely stored: a gesture reaches what the engine has rendered.
    await expect
        .poll(
            () =>
                page.evaluate((id) => {
                    const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                    return map.queryRenderedFeatures({ layers: [`gl-${id}-circle`] }).length;
                }, BORN_EMPTY),
            { timeout: WAIT_MS, message: "les deux points de la couche remplie sont dessinés" }
        )
        .toBe(2);
    await awaitSettledCamera(page);
}

/**
 * The page position of one of the two points, canvas offset included.
 * @param {import('@playwright/test').Page} page
 * @param {"point" | "ownPolygonPoint"} which
 */
function pagePoint(page, which) {
    return page.evaluate((key) => {
        const w = /** @type {any} */ (window);
        const map = w.GeoLeaf.Core.getMap().getNativeMap();
        const p = map.project(w.__at[key]);
        const box = map.getCanvas().getBoundingClientRect();
        return { x: box.left + p.x, y: box.top + p.y };
    }, which);
}

/** The seam events recorded so far for one type, optionally for one layer. */
function seam(page, type, layerId) {
    return page.evaluate(
        ([t, id]) =>
            /** @type {any} */ (window).__seam.filter(
                (e) => e.type === t && (id === null || e.layerId === id)
            ),
        /** @type {[string, string | null]} */ ([type, layerId ?? null])
    );
}

test.beforeEach(async ({ context }) => {
    // The basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
});

test("[geojson] une couche née vide puis remplie de points entend le clic sur un point", async ({
    page,
}) => {
    await bootWithBornEmptyLayer(page);
    const at = await pagePoint(page, "point");
    await page.mouse.click(at.x, at.y);

    await expect
        .poll(() => seam(page, "geoleaf:feature:click", BORN_EMPTY), {
            timeout: WAIT_MS,
            message: "le point de la couche née vide émet son clic",
        })
        .toEqual([
            {
                type: "geoleaf:feature:click",
                layerId: BORN_EMPTY,
                featureId: "point-over-other-layer",
                phase: null,
            },
        ]);
});

test("[geojson] un point sur un polygone de la MÊME couche : un seul clic, celui du point", async ({
    page,
}) => {
    await bootWithBornEmptyLayer(page);
    const at = await pagePoint(page, "ownPolygonPoint");
    await page.mouse.click(at.x, at.y);

    await expect
        .poll(() => seam(page, "geoleaf:feature:click", BORN_EMPTY), { timeout: WAIT_MS })
        .not.toEqual([]);
    // Two sub-layers of the layer are under the pointer — the circle and the fill. One event,
    // and the feature drawn on top.
    expect(await seam(page, "geoleaf:feature:click", BORN_EMPTY)).toEqual([
        {
            type: "geoleaf:feature:click",
            layerId: BORN_EMPTY,
            featureId: "point-over-own-polygon",
            phase: null,
        },
    ]);
});

test("[geojson] le survol suit la même règle que le clic", async ({ page }) => {
    await bootWithBornEmptyLayer(page);
    const at = await pagePoint(page, "point");
    await page.mouse.move(at.x - 3, at.y - 3);
    await page.mouse.move(at.x, at.y);

    await expect
        .poll(
            async () =>
                (await seam(page, "geoleaf:feature:hover", BORN_EMPTY)).filter(
                    (e) => e.phase === "move"
                ).length,
            { timeout: WAIT_MS, message: "le point de la couche née vide émet son survol" }
        )
        .toBeGreaterThan(0);
    const moves = await seam(page, "geoleaf:feature:hover", BORN_EMPTY);
    expect(new Set(moves.map((e) => e.featureId))).toEqual(new Set(["point-over-other-layer"]));
});

// 🛑 BETWEEN TWO LAYERS, THE ONE DRAWN ON TOP ANSWERS — AND IT ALONE. Each layer under the
// pointer used to emit its own click, in the order the layers were created, and the popup shown
// was the last one's: which layer answered depended on when it had been created, not on what
// the user saw.
test("[geojson] deux couches sous le clic : seule celle du dessus émet", async ({ page }) => {
    await bootWithBornEmptyLayer(page);
    const at = await pagePoint(page, "point");
    await page.mouse.click(at.x, at.y);

    await expect
        .poll(() => seam(page, "geoleaf:feature:click"), { timeout: WAIT_MS })
        .not.toEqual([]);
    // The point of the layer born empty lies ON the polygon of the other layer.
    expect((await seam(page, "geoleaf:feature:click")).map((e) => e.layerId)).toEqual([BORN_EMPTY]);

    // And the layer underneath still answers where nothing covers it.
    await page.mouse.click(at.x + 45, at.y + 45);
    await expect
        .poll(async () => (await seam(page, "geoleaf:feature:click")).map((e) => e.layerId), {
            timeout: WAIT_MS,
        })
        .toEqual([BORN_EMPTY, BELOW]);
});

// 🛑 A LAYER CREATED WITH ONE GEOMETRY DRAWS ANOTHER ONE IT RECEIVES LATER. The sub-layers were
// decided once, from the first batch: a layer created with points had no sub-layer for a
// polygon, which was then stored, listed in the table, and never drawn.
test("[geojson] une couche créée avec des points dessine et entend le polygone reçu ensuite", async ({
    page,
}) => {
    await bootMapUntilIdle(page);
    await awaitSettledCamera(page);
    const ID = "e2e_born_with_points";
    const at = await page.evaluate(async (id) => {
        const w = /** @type {any} */ (window);
        const G = w.GeoLeaf;
        const map = G.Core.getMap().getNativeMap();
        const canvas = map.getCanvas();
        const mid = [canvas.clientWidth / 2, canvas.clientHeight / 2];
        const ll = (dx, dy) => map.unproject([mid[0] + dx, mid[1] + dy]).toArray();
        const point = {
            type: "Feature",
            id: "first-point",
            properties: { id: "first-point" },
            geometry: { type: "Point", coordinates: ll(-200, 0) },
        };
        const polygon = {
            type: "Feature",
            id: "late-polygon",
            properties: { id: "late-polygon" },
            geometry: {
                type: "Polygon",
                coordinates: [[ll(-50, -50), ll(50, -50), ll(50, 50), ll(-50, 50), ll(-50, -50)]],
            },
        };
        await G.Layers.create({
            id,
            label: "E2E — née avec des points",
            // Not clustered, and it has to be said: this profile clusters every point layer, and
            // a clustered source indexes points alone — such a layer is never completed.
            clustering: false,
            inlineData: { type: "FeatureCollection", features: [point] },
        });
        w.__clicks = [];
        document.addEventListener("geoleaf:feature:click", (e) => {
            const d = /** @type {CustomEvent} */ (e).detail;
            w.__clicks.push({ layerId: d.layerId, featureId: d.featureId });
        });
        G.GeoJSON.updateLayerData(id, { type: "FeatureCollection", features: [point, polygon] });
        const box = canvas.getBoundingClientRect();
        return { x: box.left + mid[0] + 20, y: box.top + mid[1] + 20 };
    }, ID);

    await expect
        .poll(
            () =>
                page.evaluate((id) => {
                    const adapter = /** @type {any} */ (window).GeoLeaf.Core.getMap();
                    const map = adapter.getNativeMap();
                    const fill = adapter
                        .getLayerRegistry()
                        .getSubLayerIds(id)
                        .find((s) => s.endsWith("-fill"));
                    return fill
                        ? // Deduplicated: a polygon across a tile boundary is rendered once per tile.
                          [
                              ...new Set(
                                  map.queryRenderedFeatures({ layers: [fill] }).map((f) => f.id)
                              ),
                          ]
                        : "aucune sous-couche de fond";
                }, ID),
            { timeout: WAIT_MS, message: "le polygone reçu après la création est dessiné" }
        )
        .toEqual(["late-polygon"]);

    await page.mouse.click(at.x, at.y);
    await expect
        .poll(() => page.evaluate(() => /** @type {any} */ (window).__clicks), { timeout: WAIT_MS })
        .toEqual([{ layerId: ID, featureId: "late-polygon" }]);
});
