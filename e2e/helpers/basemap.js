/**
 * Third-party basemap tiles, answered locally — for the specs whose subject is not the basemap.
 *
 * 🛑 THE BASEMAP'S LATENCY DECIDED THE EDITOR SPECS, AND IT IS MEASURED. The demo profile's
 * default basemap is a third-party tile server; while its tiles are pending, the map's first
 * render waits, and Terra Draw does not lay its layers within the editor specs' 20 s. Measured on
 * 18/09/2026: under Chromium, `e2e/44`, `45` and `46` failed 3 times out of 3 with the real server
 * at 7.6 to over 25 s a tile, and passed 3 times out of 3 with its tiles answered locally; under
 * WebKit, `e2e/38` failed 4 times out of 4 with the same tiles delayed 25 s, and passed 4 times
 * out of 4 through the same interception with no delay. These specs test the write cycle: the
 * basemap's latency is not their subject, and it must not be their verdict.
 *
 * ⚠️ DERIVED FROM THE PROFILE, NOT LISTED. The hosts are read from the raster templates of the
 * profile the specs load (`url`, with `{s}` read as any subdomain), so a basemap moved to another
 * provider is followed. The terrain DEM (`terrain.demUrl`) is deliberately LEFT ALONE: a stub PNG
 * would decode as an elevation, and a false relief would move what the specs click. The suite
 * turns the relief off at boot anyway (`helpers/test.js`): in a context that fixture reaches, the
 * DEM is requested only by a spec that asks for the relief.
 *
 * ⚠️ `context.route`, not `page.route`: a request the service worker emits never reaches
 * `page.route`, and under `deploy-full` the worker may serve the tiles.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The basemaps of the profile the editor specs load (`profiles/tourism/profile-bundle.json`). */
const BASEMAPS = fileURLToPath(
    new URL("../../profiles/tourism/config/core/basemaps.json", import.meta.url)
);

/** A 1×1 transparent PNG — a valid raster tile for any `{z}/{x}/{y}`. */
const TILE = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
);

/**
 * The hosts of the profile's raster basemaps — `{s}.` dropped, so a subdomain matches.
 *
 * @returns {string[]}
 */
function basemapHosts() {
    /** @type {{ basemaps?: Record<string, { url?: unknown }> }} */
    const profile = JSON.parse(readFileSync(BASEMAPS, "utf8"));
    const hosts = new Set();
    for (const basemap of Object.values(profile.basemaps ?? {})) {
        if (typeof basemap?.url !== "string") continue;
        hosts.add(new URL(basemap.url.replace("{s}.", "")).hostname);
    }
    if (hosts.size === 0) throw new Error(`aucun fond raster déclaré dans ${BASEMAPS}`);
    return [...hosts];
}

/**
 * Answers every tile of the profile's third-party basemaps locally, for this context.
 *
 * Call it BEFORE the first navigation: a tile requested at boot and left to the network is not
 * taken back by a route laid afterwards.
 *
 * @param {import("@playwright/test").BrowserContext} context The test's browser context.
 * @returns {Promise<{ readonly served: number }>} How many tiles were answered — the witness that
 *   the route bit.
 * @example
 * test.beforeEach(async ({ context }) => {
 *     await serveBasemapTilesLocally(context);
 * });
 */
export async function serveBasemapTilesLocally(context) {
    const hosts = basemapHosts();
    let served = 0;
    await context.route(
        (url) => hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)),
        (route) => {
            served += 1;
            return route.fulfill({ status: 200, contentType: "image/png", body: TILE });
        }
    );
    return {
        get served() {
            return served;
        },
    };
}
