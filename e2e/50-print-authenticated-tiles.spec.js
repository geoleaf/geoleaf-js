// @ts-check
/**
 * e2e/50 — the printed map asks the live map's transform for its tiles: authenticated tiles
 * carry the token in print too.
 *
 * 🛑 THE PRINT NEVER CARRIED THE TRANSFORM. It copied `_requestManager._transformRequest` — a
 * field MapLibre does not write: every version measured names it `_transformRequestFn` — behind
 * a cast that kept the compiler from seeing it. The off-screen map the print renders was created
 * with no transform, and the vector tiles only the connector's bridge authenticates left
 * without a token: a protected layer printed empty.
 *
 * ⚠️ THE WITNESS: the printed extent lies on another continent than the profile's view, and a
 * request is judged only when its tile lies in that extent. Once both maps carry the token,
 * nothing else tells their requests apart — and the live map keeps asking for tiles after
 * `loaded()`: parent tiles among them, seen arriving once the capture had started.
 */
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootWithoutServiceWorker } from "./helpers/connector.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

const BASE = "https://api.geoleaf-e2e.test";
// Dotted, so the connector's "static token" heuristic stays quiet.
const HOST_TOKEN = "eyJob3N0.payload.sig";
// On another continent than the profile's view.
const PRINTED_EXTENT = { minLng: 100, minLat: 10, maxLng: 110, maxLat: 20 };

/**
 * Whether a tile, read from its `z/x/y` path, overlaps the printed extent's longitudes.
 *
 * @param {string} url
 */
function inPrintedExtent(url) {
    const [z, x] = url.split("/tiles/")[1].split("/").map(Number);
    const span = 360 / 2 ** z;
    const west = x * span - 180;
    return west < PRINTED_EXTENT.maxLng && west + span > PRINTED_EXTENT.minLng;
}

test("[print] une carte imprimée demande ses tuiles protégées avec le jeton de la carte vivante", async ({
    page,
}) => {
    /** @type {{ url: string, authorization: string | null }[]} */
    const tiles = [];
    await page.route(`${BASE}/**`, async (route) => {
        const request = route.request();
        if (request.url().includes("/tiles/")) {
            tiles.push({
                url: request.url(),
                authorization: request.headers()["authorization"] ?? null,
            });
        }
        await route.fulfill({
            status: 200,
            contentType: "application/x-protobuf",
            body: Buffer.alloc(0),
        });
    });

    await bootWithoutServiceWorker(page);
    await page.evaluate(
        async ({ baseUrl, token }) => {
            const w = /** @type {any} */ (window);
            await w.GeoLeaf.plugins.load("connector");
            await w.GeoLeaf.Connector.configure({ baseUrl, getToken: () => token });
            await w.GeoLeaf.plugins.load("print");
            const map = w.GeoLeaf.Core.getMap().getNativeMap();
            map.addSource("protected", {
                type: "vector",
                tiles: [`${baseUrl}/tiles/{z}/{x}/{y}.pbf`],
                minzoom: 0,
                maxzoom: 14,
            });
            map.addLayer({
                id: "protected-line",
                type: "line",
                source: "protected",
                "source-layer": "probe",
            });
        },
        { baseUrl: BASE, token: HOST_TOKEN }
    );

    // The live map carries the token — that part never failed.
    await expect.poll(() => tiles.length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(tiles.every((t) => t.authorization === `Bearer ${HOST_TOKEN}`)).toBe(true);

    // Let the live map go quiet, then render off-screen.
    await page.waitForFunction(
        () => /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap().loaded(),
        null,
        { timeout: 20000 }
    );
    const mark = tiles.length;
    const rendered = await page.evaluate(async (bbox) => {
        const w = /** @type {any} */ (window);
        const result = await w.GeoLeaf.Print.captureExtent(bbox, { format: "A4", dpi: 72 });
        return result !== null;
    }, PRINTED_EXTENT);

    // THE WITNESS: the live map never looked at the printed extent, and the off-screen map asked
    // for tiles of it. The live map's own late requests are not judged.
    expect(rendered, "captureExtent n'a rien rendu").toBe(true);
    expect(tiles.slice(0, mark).filter((t) => inPrintedExtent(t.url))).toEqual([]);
    const printed = tiles.slice(mark).filter((t) => inPrintedExtent(t.url));
    expect(
        printed.length,
        "la carte hors écran n'a demandé aucune tuile de l'emprise imprimée"
    ).toBeGreaterThan(0);
    // THE SUBJECT: each of them carried the token of the live map.
    expect(printed.map((t) => t.authorization)).toEqual(printed.map(() => `Bearer ${HOST_TOKEN}`));
});
