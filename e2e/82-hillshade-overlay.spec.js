// @ts-check
/**
 * 82 — A BASEMAP'S HILLSHADE OVERLAY LANDS WHERE IT SHOULD, AND FOLLOWS THE BASEMAP
 *
 * A basemap that declares `hillshade.overlay: true` stays what it is and gets the relief shading
 * drawn over it: right above its layer when it is an image, inside its style when it is vector —
 * before the layer `hillshade.beforeLayer` names, else before the style's first `symbol` layer.
 *
 * The unit tier proves the placement and the lifecycle on a fake engine that keeps an order. What
 * only the real one can say is what its STYLE DIFF does:
 *   - the overlay is not declared to the style transform, so a basemap switch that replaces the
 *     style must DROP it, and the kernel must put it back in the incoming style;
 *   - two vector basemaps that share one style differ by nothing the diff can see. The engine
 *     then performs no operation and fires no `style.load` — the switch used to never finish.
 *
 * ⚠️ WHAT THIS SPEC DOES NOT SEE: the shading itself. The elevation tiles are flat
 * (`helpers/dem-tile.js`), so the layer is there, is fed, and draws nothing. Presence, order and
 * sources are judged here; the rendering was judged by eye, on real tiles.
 *
 * The basemaps are fixtures, same-origin: no third party decides the verdict.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { armAppReadyWitness, waitAppReadyWitness } from "./helpers/boot.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";
import { flatDemTile } from "./helpers/dem-tile.js";

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

const OVERLAY_LAYER = "__geoleaf_hillshade_overlay_layer__";
const OVERLAY_SOURCE = "__geoleaf_hillshade_overlay__";
const BASEMAP_LAYER = "__geoleaf_basemap_layer__";
const STYLE_A = "/__e2e__/shade-a-style.json";
const STYLE_B = "/__e2e__/shade-b-style.json";
const DEM_SEGMENT = "__e2e_dem__";
const TILE_SEGMENT = "__e2e_tiles__";
const WAIT_MS = 30_000;

/** A 1×1 transparent PNG — a valid raster tile for any `{z}/{x}/{y}`. */
const RASTER_TILE = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
);
const DEM_TILE = flatDemTile();

/** A fixture style: one empty GeoJSON source, and the layers given. */
function fixtureStyle(name, layers) {
    return {
        version: 8,
        name,
        sources: {
            "e2e-base": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
            { id: `${name}-bg`, type: "background", paint: { "background-color": "#e8eef2" } },
            ...layers.map(([id, type]) => ({ id, type, source: "e2e-base" })),
        ],
    };
}

/** Land, water, road, label — a basemap's usual order. */
const STYLE_A_JSON = fixtureStyle("e2e-shade-a", [
    ["e2e-land", "fill"],
    ["e2e-water", "fill"],
    ["e2e-road", "line"],
    ["e2e-label", "symbol"],
]);
const STYLE_B_JSON = fixtureStyle("e2e-shade-b", [
    ["e2e-b-land", "fill"],
    ["e2e-b-road", "line"],
    ["e2e-b-label", "symbol"],
]);

/**
 * What the map holds of the relief, read in one evaluation.
 *
 * @param {import('@playwright/test').Page} page
 */
function relief(page) {
    return page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const style = native.getStyle();
        return {
            order: /** @type {string[]} */ (native.getLayersOrder()),
            shadings: style.layers
                .filter((layer) => layer.type === "hillshade")
                .map((layer) => ({ id: layer.id, source: layer.source })),
            demSources: Object.entries(style.sources)
                .filter(([, source]) => /** @type {any} */ (source).type === "raster-dem")
                .map(([id]) => id)
                .sort(),
            terrain: native.getTerrain()?.source ?? null,
            active: /** @type {any} */ (window).GeoLeaf.Baselayers.getActiveKey(),
        };
    });
}

/**
 * Asks for a basemap and waits for `geoleaf:basemap:change` to name it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 * @returns {Promise<boolean>} Whether the switch FINISHED within the budget — the event is
 *   emitted last, once the basemap, its overlay and its terrain are in place.
 */
function switchTo(page, key) {
    return page.evaluate(
        ({ key, budget }) =>
            new Promise((resolve) => {
                /** @param {boolean} finished */
                const settle = (finished) => {
                    document.removeEventListener("geoleaf:basemap:change", onChange);
                    clearTimeout(timer);
                    resolve(finished);
                };
                /** @param {Event} event */
                const onChange = (event) => {
                    if (/** @type {CustomEvent} */ (event).detail?.key === key) settle(true);
                };
                const timer = setTimeout(() => settle(false), budget);
                document.addEventListener("geoleaf:basemap:change", onChange);
                /** @type {any} */ (window).GeoLeaf.Baselayers.setBaseLayer(key);
            }),
        { key, budget: 15_000 }
    );
}

/** @param {import('@playwright/test').Page} page */
function register(page, key, definition) {
    return page.evaluate(
        ({ key, definition, demSegment }) => {
            const origin = location.origin;
            // The fixtures are named by path; the page knows its own origin.
            const absolute = JSON.parse(
                JSON.stringify(definition)
                    .replaceAll("@origin", origin)
                    .replaceAll("@dem", `${origin}/${demSegment}`)
            );
            /** @type {any} */ (window).GeoLeaf.Baselayers.registerBaseLayer(key, {
                label: key,
                ...absolute,
            });
        },
        { key, definition, demSegment: DEM_SEGMENT }
    );
}

const SHADING = { overlay: true, demUrl: "@dem/shade/{z}/{x}/{y}.png", demMaxZoom: 4 };

/** Requests answered per fixture — the witness that a route bit, and how often. */
let served;
/** @type {string[]} */
let engineComplaints;

test.beforeEach(async ({ context, page }) => {
    served = { styleA: 0, styleB: 0, shade: 0, terrain: 0 };
    engineComplaints = [];
    page.on("console", (msg) => {
        const text = msg.text();
        if (/same source for a hillshade layer|already exists|Cannot add layer/i.test(text)) {
            engineComplaints.push(text);
        }
    });
    // The profile's own raster basemap is not this spec's subject.
    await serveBasemapTilesLocally(context);
    await context.route(`**${STYLE_A}*`, (route) => {
        served.styleA += 1;
        return route.fulfill({ json: STYLE_A_JSON });
    });
    await context.route(`**${STYLE_B}*`, (route) => {
        served.styleB += 1;
        return route.fulfill({ json: STYLE_B_JSON });
    });
    await context.route(`**/${DEM_SEGMENT}/**`, (route) => {
        served[route.request().url().includes("/shade/") ? "shade" : "terrain"] += 1;
        return route.fulfill({ status: 200, contentType: "image/png", body: DEM_TILE });
    });
    await context.route(`**/${TILE_SEGMENT}/**`, (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: RASTER_TILE })
    );
    await armAppReadyWitness(page);
    await page.goto("/");
    await waitAppReadyWitness(page);
    // The boot's own basemap activation is deferred until the style is ready: a settled camera
    // is the witness that it has run, and that `getActiveKey()` names a basemap.
    await awaitSettledCamera(page);
});

test("[basemaps] fond vectoriel : la surcouche se place dans le style, suit le changement de style, et part avec le fond", async ({
    page,
}) => {
    const rasterKey = (await relief(page)).active;
    expect(rasterKey, "aucun fond actif au départ : le retour ne mesurerait rien").toBeTruthy();
    expect((await relief(page)).shadings, "une surcouche avant toute demande").toEqual([]);

    // 1. A vector basemap with BOTH the terrain and the overlay, the overlay before `e2e-water`.
    await register(page, "e2e-shade-a", {
        type: "maplibre",
        style: `@origin${STYLE_A}`,
        terrain: {
            enabled: true,
            demUrl: "@dem/terrain/{z}/{x}/{y}.png",
            demMaxZoom: 4,
            default3D: true,
            pitch: 30,
        },
        hillshade: { ...SHADING, beforeLayer: "e2e-water" },
    });
    expect(await switchTo(page, "e2e-shade-a"), "la bascule ne s'est pas achevée").toBe(true);

    let state = await relief(page);
    expect(state.shadings).toEqual([{ id: OVERLAY_LAYER, source: OVERLAY_SOURCE }]);
    expect(
        state.order.slice(state.order.indexOf("e2e-land"), state.order.indexOf("e2e-road")),
        "la surcouche n'est pas entre les aplats de sol et l'eau"
    ).toEqual(["e2e-land", OVERLAY_LAYER, "e2e-water"]);
    // Two sources, never one: the terrain's and the overlay's.
    expect(state.terrain).toBe("terrain-dem");
    expect(state.demSources).toEqual([OVERLAY_SOURCE, "terrain-dem"].sort());
    await expect
        .poll(() => served.shade, {
            timeout: WAIT_MS,
            message: "la source de la surcouche n'a demandé aucune tuile",
        })
        .toBeGreaterThan(0);

    // 2. Another style, no `beforeLayer`: the style diff drops the overlay, the kernel puts it
    //    back before the incoming style's first `symbol` layer.
    await register(page, "e2e-shade-b", {
        type: "maplibre",
        style: `@origin${STYLE_B}`,
        hillshade: SHADING,
    });
    expect(await switchTo(page, "e2e-shade-b"), "la bascule ne s'est pas achevée").toBe(true);

    state = await relief(page);
    expect(state.shadings, "une surcouche, et une seule").toEqual([
        { id: OVERLAY_LAYER, source: OVERLAY_SOURCE },
    ]);
    expect(
        state.order.slice(state.order.indexOf("e2e-b-road"), state.order.indexOf("e2e-b-label") + 1)
    ).toEqual(["e2e-b-road", OVERLAY_LAYER, "e2e-b-label"]);
    expect(state.terrain, "ce fond ne déclare pas de relief").toBeNull();

    // 3. Back to the profile's raster basemap, which declares none: the overlay goes.
    expect(await switchTo(page, rasterKey), "le retour ne s'est pas achevé").toBe(true);
    await expect
        .poll(async () => (await relief(page)).shadings, {
            timeout: WAIT_MS,
            message: "la surcouche a survécu à un fond qui n'en déclare pas",
        })
        .toEqual([]);
    expect((await relief(page)).demSources).not.toContain(OVERLAY_SOURCE);

    expect(engineComplaints, "le moteur a refusé ou averti").toEqual([]);
});

test("[basemaps] fond en tuiles, puis deux fonds vectoriels au même style : la surcouche est posée, et la bascule s'achève", async ({
    page,
}) => {
    // 1. An image basemap: right above its layer, under every data layer.
    await register(page, "e2e-tiles", {
        url: `@origin/${TILE_SEGMENT}/{z}/{x}/{y}.png`,
        attribution: "© E2E",
        hillshade: SHADING,
    });
    expect(await switchTo(page, "e2e-tiles"), "la bascule ne s'est pas achevée").toBe(true);

    let state = await relief(page);
    expect(state.shadings).toEqual([{ id: OVERLAY_LAYER, source: OVERLAY_SOURCE }]);
    expect(state.order.slice(0, 2), "la surcouche n'est pas juste au-dessus du fond").toEqual([
        BASEMAP_LAYER,
        OVERLAY_LAYER,
    ]);
    expect(
        state.order.slice(2).some((id) => id.startsWith("gl-")),
        "aucune couche de données au-dessus : la spec ne mesure pas l'ordre"
    ).toBe(true);

    // 2. Two vector basemaps on ONE style; only the second declares the overlay.
    await register(page, "e2e-plain", { type: "maplibre", style: `@origin${STYLE_A}` });
    await register(page, "e2e-shaded", {
        type: "maplibre",
        style: `@origin${STYLE_A}`,
        hillshade: SHADING,
    });
    expect(await switchTo(page, "e2e-plain"), "la bascule ne s'est pas achevée").toBe(true);
    expect((await relief(page)).shadings, "la surcouche du fond en tuiles est restée").toEqual([]);

    // 🛑 THE SWITCH THE ENGINE ANSWERS WITH NOTHING: same style, so an empty diff and no
    // `style.load`. It finishes because the kernel no longer asks the engine for the style.
    expect(
        await switchTo(page, "e2e-shaded"),
        "bascule entre deux fonds au même style : `geoleaf:basemap:change` n'est pas venu"
    ).toBe(true);
    state = await relief(page);
    expect(state.shadings).toEqual([{ id: OVERLAY_LAYER, source: OVERLAY_SOURCE }]);
    expect(
        state.order.slice(state.order.indexOf("e2e-road"), state.order.indexOf("e2e-label") + 1)
    ).toEqual(["e2e-road", OVERLAY_LAYER, "e2e-label"]);

    expect(await switchTo(page, "e2e-plain"), "le retour ne s'est pas achevé").toBe(true);
    expect((await relief(page)).shadings).toEqual([]);
    // The style was downloaded once for the three switches that share it.
    expect(served.styleA, "le style a été redemandé pour un fond qui le partage").toBe(1);

    expect(engineComplaints, "le moteur a refusé ou averti").toEqual([]);
});
