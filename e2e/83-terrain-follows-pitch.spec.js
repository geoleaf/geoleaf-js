// @ts-check
/**
 * 83 — A RELIEF THAT FOLLOWS THE TILT COSTS NOTHING TO A FLAT MAP
 *
 * A basemap whose `terrain` block says `activation: "pitch"` has no relief while the map is
 * flat, gets it once the camera comes to rest tilted past `activateFromPitch`, and loses it once
 * it comes to rest under `deactivateBelowPitch`. The camera is never moved by any of it.
 *
 * The unit tier proves the decision on a fake engine. What only the real one can say:
 *   - that a flat map requests NO elevation tile — the whole point of the mode, and a property a
 *     fake cannot have: a `raster-dem` source nothing reads asks for nothing, a source the
 *     terrain reads does;
 *   - that nothing is written DURING a gesture. The engine keeps a copy of the camera for as
 *     long as a movement lasts while a relief is on; a relief removed then put back inside one
 *     movement resumes from that stale copy;
 *   - that leaving such a basemap through a style change does not make the engine rebuild the
 *     style from scratch — which it does whenever a relief is still on when the style is asked;
 *   - that a hillshade overlay told to show `onlyWithTerrain` requests nothing either while
 *     hidden.
 *
 * ⚠️ WHAT THIS SPEC DOES NOT SEE: the relief itself. The elevation tiles are flat
 * (`helpers/dem-tile.js`): the terrain is on, is fed, and drapes a level ground. Presence,
 * requests and camera are judged here; the rendering was judged by eye, on real tiles.
 *
 * The basemaps are fixtures, same-origin, except the last case: the demo profile's own
 * `satellite` basemap, with its real configuration and its elevation host answered locally.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { armAppReadyWitness, waitAppReadyWitness } from "./helpers/boot.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";
import { flatDemTile } from "./helpers/dem-tile.js";

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

const TERRAIN_SOURCE = "terrain-dem";
const OVERLAY_LAYER = "__geoleaf_hillshade_overlay_layer__";
const STYLE = "/__e2e__/tilt-style.json";
const DEM_SEGMENT = "__e2e_dem__";
const TILE_SEGMENT = "__e2e_tiles__";
const WAIT_MS = 30_000;

/** The thresholds a basemap gets when it declares none. */
const ACTIVATE_FROM = 12;
const DEACTIVATE_BELOW = 6;

/** A 1×1 transparent PNG — a valid raster tile for any `{z}/{x}/{y}`. */
const RASTER_TILE = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
);
const DEM_TILE = flatDemTile();

const STYLE_JSON = {
    version: 8,
    name: "e2e-tilt",
    sources: {
        "e2e-base": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
        { id: "e2e-tilt-bg", type: "background", paint: { "background-color": "#e8eef2" } },
        { id: "e2e-tilt-land", type: "fill", source: "e2e-base" },
        { id: "e2e-tilt-label", type: "symbol", source: "e2e-base" },
    ],
};

/** A relief that follows the tilt, on the elevation fixture `name`. */
const followsTilt = (name) => ({
    enabled: true,
    demUrl: `@dem/${name}/{z}/{x}/{y}.png`,
    demMaxZoom: 4,
    activation: "pitch",
});

const TILES = { url: `@origin/${TILE_SEGMENT}/{z}/{x}/{y}.png`, attribution: "© E2E" };

/** The `satellite` basemap of the demo profile, as the SOURCE declares it. */
const SATELLITE = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("../profiles/tourism/config/core/basemaps.json", import.meta.url)),
        "utf8"
    )
).basemaps.satellite;

/**
 * Counts every `setTerrain` the page makes from now on, whoever makes it — the kernel, or the
 * engine itself when it rebuilds a style.
 *
 * 🛑 THE COUNTER KEEPS THE RECEIVER IT IS CALLED WITH, and that is not a detail. The engine's
 * style diff calls `map.setTerrain` on the WRONG receiver (MapLibre before 6.10): it throws,
 * and the engine rebuilds the style from scratch — the very thing the kernel avoids by cutting
 * the relief first. A counter that bound the method to the map repaired that call on the way:
 * the diff went through, and this spec could not see a relief left on at a style change. Measured:
 * with the cut removed from the bundle, the case below stayed green.
 *
 * @param {import('@playwright/test').Page} page
 */
function countTerrainWrites(page) {
    return page.evaluate(() => {
        const page = /** @type {any} */ (window);
        const native = page.GeoLeaf.Core.getMap().getNativeMap();
        /** @type {string[]} */
        const writes = (page.__terrainWrites = []);
        const original = native.setTerrain;
        native.setTerrain = function (/** @type {unknown[]} */ ...args) {
            writes.push(args[0] ? "on" : "off");
            return original.apply(this, args);
        };
    });
}

/**
 * Marks the engine's style object, so a later reading can tell whether it was REPLACED — the
 * witness of a style rebuilt from scratch. The console warning is emitted once per message, and
 * cannot tell two rebuilds apart.
 *
 * @param {import('@playwright/test').Page} page
 */
function markEngineStyle(page) {
    return page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        /** @type {any} */ (window).__e2eEngineStyle = native.style;
    });
}

/**
 * Whether the engine replaced its style object since {@link markEngineStyle}.
 *
 * @param {import('@playwright/test').Page} page
 */
function engineStyleReplaced(page) {
    return page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        return native.style !== /** @type {any} */ (window).__e2eEngineStyle;
    });
}

/**
 * What the map holds of the relief, read in one evaluation.
 *
 * @param {import('@playwright/test').Page} page
 */
function relief(page) {
    return page.evaluate((overlayLayer) => {
        const live = /** @type {any} */ (window);
        const native = live.GeoLeaf.Core.getMap().getNativeMap();
        const style = native.getStyle();
        const dem = style.sources["terrain-dem"];
        return {
            terrain: native.getTerrain()?.source ?? null,
            pitch: Math.round(native.getPitch() * 10) / 10,
            bearing: Math.round(native.getBearing() * 10) / 10,
            moving: native.isMoving(),
            demTiles: /** @type {string | null} */ (dem?.tiles?.[0] ?? null),
            overlay: native.getLayer(overlayLayer)
                ? (native.getLayoutProperty(overlayLayer, "visibility") ?? "visible")
                : null,
            writes: /** @type {string[]} */ ([...(live.__terrainWrites ?? [])]),
            active: live.GeoLeaf.Baselayers.getActiveKey(),
        };
    }, OVERLAY_LAYER);
}

/**
 * Posts the camera with no animation, then lets the map come to rest.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, unknown>} camera
 */
async function jumpTo(page, camera) {
    await page.evaluate((camera) => {
        /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap().jumpTo(camera);
    }, camera);
    await settle(page);
}

/**
 * Waits until the map has nothing left to load or draw — the moment a request it was going to
 * make has been made. A map that never settles is given a few seconds, then read as it stands.
 *
 * @param {import('@playwright/test').Page} page
 */
function settle(page) {
    return page.evaluate(
        () =>
            new Promise((resolve) => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                const timer = setTimeout(() => resolve("timeout"), 4_000);
                native.once("idle", () => {
                    clearTimeout(timer);
                    resolve("idle");
                });
                native.triggerRepaint();
            })
    );
}

/**
 * Records every `geoleaf:basemap:change` the page emits from now on — the event is emitted last,
 * once a basemap, its overlay and its terrain are in place.
 *
 * @param {import('@playwright/test').Page} page
 */
function recordBasemapChanges(page) {
    return page.evaluate(() => {
        const live = /** @type {any} */ (window);
        /** @type {string[]} */
        const changes = (live.__basemapChanges = []);
        document.addEventListener("geoleaf:basemap:change", (event) => {
            changes.push(/** @type {CustomEvent} */ (event).detail?.key);
        });
    });
}

/**
 * Asks for a basemap and waits for `geoleaf:basemap:change` to name it.
 *
 * The wait is a poll from here, not a promise held in the page. Measured with such a promise, on
 * a bundle that left the relief on at a style change: the engine rebuilt the style, and the
 * evaluation failed on "Resulting promise was garbage collected" — why is not established. The
 * failure named this helper instead of the rebuild.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 * @returns {Promise<boolean>} Whether the switch FINISHED within the budget.
 */
async function switchTo(page, key) {
    const from = await page.evaluate((key) => {
        const seen = /** @type {any} */ (window).__basemapChanges.length;
        /** @type {any} */ (window).GeoLeaf.Baselayers.setBaseLayer(key);
        return seen;
    }, key);
    return page
        .waitForFunction(
            ({ from, key }) =>
                /** @type {any} */ (window).__basemapChanges.slice(from).includes(key),
            { from, key },
            { timeout: 15_000 }
        )
        .then(
            () => true,
            () => false
        );
}

/** @param {import('@playwright/test').Page} page */
function register(page, key, definition) {
    return page.evaluate(
        ({ key, definition, demSegment }) => {
            const origin = location.origin;
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

/**
 * Tilts the map as a visitor does: a right-button drag, straight up or down, held until
 * `whileHeld` has read the page, then released.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} dy Pixels dragged — negative tilts the map, positive flattens it.
 * @param {() => Promise<void>} [whileHeld] Runs with the button still down.
 */
async function tiltByHand(page, dy, whileHeld) {
    const box = await page.locator(".maplibregl-canvas").boundingBox();
    if (!box) throw new Error("le canevas de la carte est introuvable");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(x, y + dy, { steps: 12 });
    if (whileHeld) await whileHeld();
    await page.mouse.up({ button: "right" });
}

/** Elevation tiles answered per fixture — the witness that a route bit, and how often. */
let served;
/** @type {string[]} */
let engineComplaints;

test.beforeEach(async ({ context, page }) => {
    served = { tilt: 0, other: 0, shade: 0, demo: 0 };
    engineComplaints = [];
    page.on("console", (msg) => {
        const text = msg.text();
        if (
            /Unable to perform style diff|Rebuilding the style|already exists|cannot be removed|There is no source/i.test(
                text
            )
        ) {
            engineComplaints.push(text);
        }
    });
    page.on("pageerror", (error) => engineComplaints.push(`pageerror: ${error.message}`));

    await serveBasemapTilesLocally(context);
    await context.route(`**${STYLE}*`, (route) => route.fulfill({ json: STYLE_JSON }));
    await context.route(`**/${DEM_SEGMENT}/**`, (route) => {
        const name = /\/__e2e_dem__\/([a-z]+)\//.exec(route.request().url())?.[1] ?? "";
        if (name in served) served[name] += 1;
        return route.fulfill({ status: 200, contentType: "image/png", body: DEM_TILE });
    });
    await context.route(`**/${TILE_SEGMENT}/**`, (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: RASTER_TILE })
    );
    // The demo profile's own elevation host, for the last case: answered here, never by a third
    // party. Derived from the profile, so a basemap moved to another provider is followed.
    const demoDem = SATELLITE?.terrain?.demUrl;
    if (typeof demoDem === "string") {
        const host = new URL(demoDem.replace("{s}.", "")).hostname;
        await context.route(
            (url) => url.hostname === host,
            (route) => {
                served.demo += 1;
                return route.fulfill({ status: 200, contentType: "image/png", body: DEM_TILE });
            }
        );
    }

    await armAppReadyWitness(page);
    await page.goto("/");
    await waitAppReadyWitness(page);
    // The boot's own basemap activation is deferred until the style is ready: a settled camera
    // is the witness that it has run. Basemaps are switched from a camera at rest throughout.
    await awaitSettledCamera(page);
    await countTerrainWrites(page);
    await recordBasemapChanges(page);
});

test("[basemaps] relief à l'inclinaison : rien à plat, posé au relâcher, retiré à plat — et la caméra n'est jamais déplacée", async ({
    page,
}) => {
    await register(page, "e2e-tilt", { ...TILES, terrain: followsTilt("tilt") });
    expect(await switchTo(page, "e2e-tilt"), "la bascule ne s'est pas achevée").toBe(true);
    await settle(page);

    // 1. Flat: no relief, and not one elevation tile — over a massif, and tilted under the
    //    threshold, where a relief WOULD show if it were on.
    let state = await relief(page);
    expect(state.pitch, "la carte n'est pas à plat au départ : le test ne mesure rien").toBe(0);
    expect(state.terrain, "un relief est posé sur une carte à plat").toBeNull();
    await jumpTo(page, { center: [6.865, 45.832], zoom: 10 });
    await jumpTo(page, { pitch: ACTIVATE_FROM - 2 });
    state = await relief(page);
    expect(state.pitch).toBe(ACTIVATE_FROM - 2);
    expect(state.terrain, "le relief est posé sous le seuil").toBeNull();
    expect(state.writes, "le relief a été écrit sur une carte restée sous le seuil").toEqual([]);
    expect(served.tilt, "des tuiles d'altitude ont été demandées sans relief").toBe(0);
    await jumpTo(page, { pitch: 0 });

    // 2. A real tilt gesture. With the button still down the camera is past the threshold and
    //    NOTHING has been written; the relief comes once the hand lets go.
    await tiltByHand(page, -70, async () => {
        const held = await relief(page);
        expect(
            held.pitch,
            "le geste n'a pas incliné la carte au-delà du seuil : le test ne prouve rien"
        ).toBeGreaterThan(ACTIVATE_FROM);
        expect(held.writes, "le relief a été écrit PENDANT le geste").toEqual([]);
        expect(held.terrain).toBeNull();
    });
    await expect
        .poll(async () => (await relief(page)).terrain, {
            timeout: WAIT_MS,
            message: "incliné au-delà du seuil, le relief n'est pas venu",
        })
        .toBe(TERRAIN_SOURCE);
    await settle(page);
    state = await relief(page);
    expect(state.writes, "un geste, une écriture").toEqual(["on"]);
    // The camera is the visitor's: neither flattened, nor taken to a configured angle.
    expect(state.pitch, "la caméra a été déplacée à la pose du relief").toBeGreaterThan(
        ACTIVATE_FROM
    );
    expect(state.pitch).not.toBe(45);
    expect(state.bearing, "la caméra a été tournée à la pose du relief").toBe(0);
    await expect
        .poll(() => served.tilt, {
            timeout: WAIT_MS,
            message: "le relief posé n'a demandé aucune tuile d'altitude",
        })
        .toBeGreaterThan(0);

    // 3. Between the two thresholds the relief stays: it only leaves under the lower one.
    const tilted = state.pitch;
    await jumpTo(page, { pitch: DEACTIVATE_BELOW + 2 });
    state = await relief(page);
    expect(state.terrain, "le relief est parti entre les deux seuils").toBe(TERRAIN_SOURCE);
    expect(state.writes).toEqual(["on"]);
    await jumpTo(page, { pitch: tilted });

    // 4. Flattened by hand: gone at release, the camera where the hand left it, and no elevation
    //    tile for a place the map then moves to.
    await tiltByHand(page, 120);
    await expect
        .poll(async () => (await relief(page)).terrain, {
            timeout: WAIT_MS,
            message: "remise à plat, la carte a gardé son relief",
        })
        .toBeNull();
    await settle(page);
    state = await relief(page);
    expect(state.pitch, "le geste n'a pas remis la carte à plat").toBeLessThan(DEACTIVATE_BELOW);
    expect(state.writes).toEqual(["on", "off"]);
    const before = served.tilt;
    await jumpTo(page, { center: [-3.7, 40.4], zoom: 10 });
    await jumpTo(page, { center: [24.9, 60.2], zoom: 9 });
    expect(served.tilt, "des tuiles d'altitude ont été demandées après la remise à plat").toBe(
        before
    );

    expect(engineComplaints, "le moteur a refusé ou averti").toEqual([]);
});

test("[basemaps] relief à l'inclinaison : il traverse un changement de fond sous une caméra inclinée, sans que le moteur reconstruise le style", async ({
    page,
}) => {
    const flatKey = (await relief(page)).active;
    expect(flatKey, "aucun fond actif au départ : le retour ne mesurerait rien").toBeTruthy();

    await register(page, "e2e-tilt", { ...TILES, terrain: followsTilt("tilt") });
    await register(page, "e2e-tilt-other", { ...TILES, terrain: followsTilt("other") });
    await register(page, "e2e-tilt-vector", {
        type: "maplibre",
        style: `@origin${STYLE}`,
        terrain: followsTilt("tilt"),
    });
    expect(await switchTo(page, "e2e-tilt"), "la bascule ne s'est pas achevée").toBe(true);
    await jumpTo(page, { pitch: 40, bearing: 25 });
    let state = await relief(page);
    expect(state.terrain, "incliné à 40°, le relief n'est pas posé").toBe(TERRAIN_SOURCE);
    expect(state.demTiles).toContain("/tilt/");

    /** The camera a basemap switch must leave alone. */
    const untouched = async (what) => {
        const now = await relief(page);
        expect([now.pitch, now.bearing], `${what} : la caméra a été déplacée`).toEqual([40, 25]);
        return now;
    };

    // 1. Another basemap in the same mode, ANOTHER elevation source: the relief stays on, read
    //    from the new one.
    expect(await switchTo(page, "e2e-tilt-other"), "la bascule ne s'est pas achevée").toBe(true);
    await expect
        .poll(async () => (await relief(page)).demTiles, {
            timeout: WAIT_MS,
            message: "le relief lit encore l'altitude du fond précédent",
        })
        .toContain("/other/");
    state = await untouched("vers un fond d'une autre altitude");
    expect(state.terrain).toBe(TERRAIN_SOURCE);
    await expect.poll(() => served.other, { timeout: WAIT_MS }).toBeGreaterThan(0);

    // 2. A VECTOR basemap: the style is replaced. The relief is cut before the engine is asked
    //    for the style — left on, the engine cannot diff and rebuilds everything — and comes
    //    back in the incoming style, the camera being still tilted.
    await markEngineStyle(page);
    expect(await switchTo(page, "e2e-tilt-vector"), "la bascule ne s'est pas achevée").toBe(true);
    await expect
        .poll(async () => (await relief(page)).terrain, {
            timeout: WAIT_MS,
            message: "le fond vectoriel est arrivé sous une caméra inclinée, sans relief",
        })
        .toBe(TERRAIN_SOURCE);
    expect(
        await engineStyleReplaced(page),
        "le moteur a reconstruit le style : le relief était encore posé quand il a été demandé"
    ).toBe(false);
    await untouched("vers un fond vectoriel");

    // 3. Back to tiles — a style change again, on the way OUT of the vector basemap —, then to a
    //    basemap that follows nothing: the relief goes, and the camera stays where the visitor
    //    put it. Leaving this mode flattens nothing.
    await markEngineStyle(page);
    expect(await switchTo(page, "e2e-tilt"), "le retour ne s'est pas achevé").toBe(true);
    await expect
        .poll(async () => (await relief(page)).terrain, { timeout: WAIT_MS })
        .toBe(TERRAIN_SOURCE);
    expect(
        await engineStyleReplaced(page),
        "le moteur a reconstruit le style en quittant le fond vectoriel"
    ).toBe(false);
    await untouched("retour vers le fond en tuiles");

    expect(await switchTo(page, flatKey), "le retour ne s'est pas achevé").toBe(true);
    await expect
        .poll(async () => (await relief(page)).terrain, {
            timeout: WAIT_MS,
            message: "le relief a survécu à un fond qui n'en suit aucun",
        })
        .toBeNull();
    await untouched("vers un fond sans relief");
    await expect
        .poll(async () => (await relief(page)).demTiles, {
            timeout: WAIT_MS,
            message: "la source d'altitude est restée déclarée après le départ du fond",
        })
        .toBeNull();

    expect(engineComplaints, "le moteur a refusé, averti ou reconstruit le style").toEqual([]);
});

test("[basemaps] surcouche d'ombrage `onlyWithTerrain` : masquée et sans tuile à plat, montrée avec le relief", async ({
    page,
}) => {
    await register(page, "e2e-tilt-shaded", {
        ...TILES,
        terrain: followsTilt("tilt"),
        hillshade: {
            overlay: true,
            onlyWithTerrain: true,
            demUrl: "@dem/shade/{z}/{x}/{y}.png",
            demMaxZoom: 4,
        },
    });
    expect(await switchTo(page, "e2e-tilt-shaded"), "la bascule ne s'est pas achevée").toBe(true);
    await jumpTo(page, { center: [6.865, 45.832], zoom: 10 });

    let state = await relief(page);
    expect(state.overlay, "la surcouche est visible sur une carte à plat").toBe("none");
    expect(served.shade, "la surcouche masquée a demandé des tuiles d'altitude").toBe(0);
    expect(served.tilt).toBe(0);

    await jumpTo(page, { pitch: 40 });
    await expect
        .poll(async () => (await relief(page)).overlay, {
            timeout: WAIT_MS,
            message: "le relief est posé, la surcouche est restée masquée",
        })
        .toBe("visible");
    expect((await relief(page)).terrain).toBe(TERRAIN_SOURCE);
    await expect
        .poll(() => served.shade, {
            timeout: WAIT_MS,
            message: "la surcouche montrée n'a demandé aucune tuile",
        })
        .toBeGreaterThan(0);

    await jumpTo(page, { pitch: 0 });
    await expect
        .poll(async () => (await relief(page)).overlay, {
            timeout: WAIT_MS,
            message: "le relief est parti, la surcouche est restée visible",
        })
        .toBe("none");
    state = await relief(page);
    expect(state.terrain).toBeNull();

    expect(engineComplaints, "le moteur a refusé ou averti").toEqual([]);
});

test("[basemaps] le fond Satellite de la démonstration : aucune tuile d'altitude à plat, le relief quand on incline", async ({
    page,
}) => {
    expect(
        SATELLITE?.terrain?.activation,
        "le fond `satellite` du profil ne suit plus l'inclinaison : ce cas n'a plus de sujet"
    ).toBe("pitch");

    expect(await switchTo(page, "satellite"), "la bascule ne s'est pas achevée").toBe(true);
    await jumpTo(page, { center: [6.865, 45.832], zoom: 10 });
    let state = await relief(page);
    expect(state.terrain, "un relief est posé sur une carte à plat").toBeNull();
    expect(served.demo, "des tuiles d'altitude ont été demandées à plat").toBe(0);

    await jumpTo(page, { pitch: 40 });
    await expect
        .poll(async () => (await relief(page)).terrain, {
            timeout: WAIT_MS,
            message: "incliné, le fond Satellite n'a pas son relief",
        })
        .toBe(TERRAIN_SOURCE);
    await expect
        .poll(() => served.demo, {
            timeout: WAIT_MS,
            message: "le relief n'a demandé aucune tuile à l'hôte d'altitude du profil",
        })
        .toBeGreaterThan(0);

    await jumpTo(page, { pitch: 0 });
    await expect.poll(async () => (await relief(page)).terrain, { timeout: WAIT_MS }).toBeNull();
    state = await relief(page);
    expect(state.pitch).toBe(0);

    expect(engineComplaints, "le moteur a refusé ou averti").toEqual([]);
});
