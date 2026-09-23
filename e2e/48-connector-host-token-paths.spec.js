// @ts-check
// E2E: 48 — the host's token reaches every loading path, not only `window.fetch`.
//
// A map loads by three routes the page's `fetch` never sees whole: the GeoJSON worker (a
// dedicated worker, fed by a header hook the core reads), the vector tiles MapLibre fetches in
// its own worker (fed by `transformRequest`), and the PMTiles archive the `pmtiles` library
// reads through the main thread's global `fetch`, with a `Range` header carried by a `Headers`
// object. In `getToken` mode the token belongs to the host and is PULLED at each request; this
// spec proves it arrives on all three, is re-read after the host rotates it, and that a host
// that cannot produce one (no network) breaks none of them. The archive is also proven in
// `auth.endpoint` mode, where it carried no token either.
//
// Routing measured before writing, Service Worker blocked: `page.route` sees all three — see
// `helpers/connector.js`. A cut network is an ABORTED route, not `setOffline` alone.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { withOffline } from "./helpers/offline.js";
import { bootWithoutServiceWorker, seedConnectorToken } from "./helpers/connector.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const BASE = "https://api.geoleaf-e2e.test";
const HOST_TOKEN = "host.tok.1";
const ROTATED = "host.tok.2";
const STORED = "eyJzdG9yZWQ.payload.sig";
const FEATURES = JSON.stringify({
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2.35, 48.85] },
            properties: { name: "p" },
        },
    ],
});

/**
 * Every request made to the protected origin, in arrival order — and whether the network is
 * cut. The spec flips `cut`; the handler reads it at request time.
 * @typedef {{ cut: boolean, seen: { url: string, authorization: string|null, range: string|null }[] }} Protected
 */

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Protected>}
 */
async function routeProtected(page) {
    /** @type {Protected} */
    const state = { cut: false, seen: [] };
    await page.route(`${BASE}/**`, async (route) => {
        const request = route.request();
        const url = request.url();
        state.seen.push({
            url,
            authorization: request.headers()["authorization"] ?? null,
            range: request.headers()["range"] ?? null,
        });
        if (state.cut) return route.abort("internetdisconnected");
        if (url.includes(".geojson"))
            return route.fulfill({
                status: 200,
                contentType: "application/geo+json",
                body: FEATURES,
            });
        if (url.includes("/tiles/"))
            return route.fulfill({
                status: 200,
                contentType: "application/x-protobuf",
                body: Buffer.alloc(0),
            });
        if (url.includes(".pmtiles"))
            return route.fulfill({
                status: 200,
                contentType: "application/octet-stream",
                body: Buffer.alloc(64),
            });
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    return state;
}

/**
 * @param {Protected} state
 * @param {string} fragment
 */
const seenFor = (state, fragment) => state.seen.filter((s) => s.url.includes(fragment));

/**
 * Configures the connector in `getToken` mode with an ASYNCHRONOUS provider reading
 * `window.__hostToken` — the shape of an identity SDK. With `rejectOffline`, the provider
 * rejects while `navigator.onLine` is false, as a host whose own session is unreachable.
 *
 * Then installs two witnesses: the worker header hook is wrapped (calls recorded), and so is
 * the page's `fetch` (requests to the protected origin recorded) — together they tell a load
 * the worker carried from one the main thread did.
 * @param {import('@playwright/test').Page} page
 * @param {{ rejectOffline?: boolean }} [opts]
 */
async function configureHostToken(page, opts = {}) {
    await page.evaluate(
        async ({ baseUrl, token, rejectOffline }) => {
            const w = /** @type {any} */ (window);
            w.__hostToken = token;
            await w.GeoLeaf.Connector.configure({
                baseUrl,
                getToken: async () => {
                    if (rejectOffline && !navigator.onLine)
                        throw new Error("host session unreachable");
                    return w.__hostToken;
                },
            });
            const hook = w.__GEOLEAF_WORKER_HEADERS_HOOK__;
            w.__hookCalls = [];
            w.__GEOLEAF_WORKER_HEADERS_HOOK__ = (
                /** @type {string} */ url,
                /** @type {unknown} */ caps
            ) => {
                w.__hookCalls.push(url);
                return hook(url, caps);
            };
            const patched = w.fetch;
            w.__mainFetch = [];
            w.fetch = (/** @type {any} */ input, /** @type {any} */ init) => {
                const url =
                    typeof input === "string"
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url;
                if (url.startsWith(baseUrl)) w.__mainFetch.push(url);
                return patched(input, init);
            };
        },
        { baseUrl: BASE, token: HOST_TOKEN, rejectOffline: !!opts.rejectOffline }
    );
}

/**
 * Loads a GeoJSON layer from the protected origin through the real loader. A failed load is
 * swallowed here, so that it cannot surface as an unhandled rejection the spec would misread.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function createLayer(page, name) {
    await page.evaluate(
        ({ id, url }) => {
            void Promise.resolve(
                /** @type {any} */ (window).GeoLeaf.Layers.create({ id, label: id, url })
            ).catch(() => undefined);
        },
        { id: `host-${name}`, url: `${BASE}/layers/${name}.geojson` }
    );
}

/**
 * Adds a vector-tile source and a layer drawing it, both under the protected origin.
 * @param {import('@playwright/test').Page} page
 * @param {"tiles" | "pmtiles"} kind
 */
async function addTileSource(page, kind) {
    await page.evaluate(
        ({ base, kind }) => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const source =
                kind === "pmtiles"
                    ? { type: "vector", url: `pmtiles://${base}/archive.pmtiles` }
                    : {
                          type: "vector",
                          tiles: [`${base}/tiles/{z}/{x}/{y}.pbf`],
                          minzoom: 0,
                          maxzoom: 14,
                      };
            map.addSource(`host-${kind}`, source);
            map.addLayer({
                id: `host-${kind}-line`,
                type: "line",
                source: `host-${kind}`,
                "source-layer": "probe",
            });
        },
        { base: BASE, kind }
    );
}

test.describe("48-connector-host-token-paths", () => {
    test.beforeEach(async ({ page }) => {
        await page.route("**/connector.local.js*", (route) =>
            route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
        );
    });

    test("une couche GeoJSON chargée par l'ouvrier porte le jeton de l'hôte", async ({ page }) => {
        const state = await routeProtected(page);
        await bootWithoutServiceWorker(page);
        await configureHostToken(page);

        await createLayer(page, "worker");
        await expect.poll(() => seenFor(state, "/layers/worker.geojson").length).toBeGreaterThan(0);

        // The witness: the WORKER carried this load — the hook was asked, the main thread was not.
        const witness = await page.evaluate(() => ({
            hook: /** @type {any} */ (window).__hookCalls,
            main: /** @type {any} */ (window).__mainFetch,
        }));
        expect(witness.hook).toContain(`${BASE}/layers/worker.geojson`);
        expect(witness.main).not.toContain(`${BASE}/layers/worker.geojson`);

        expect(seenFor(state, "/layers/worker.geojson")[0]?.authorization).toBe(
            `Bearer ${HOST_TOKEN}`
        );
    });

    test("une tuile vectorielle porte le jeton de l'hôte", async ({ page }) => {
        const state = await routeProtected(page);
        await bootWithoutServiceWorker(page);
        await configureHostToken(page);

        await addTileSource(page, "tiles");
        await expect.poll(() => seenFor(state, "/tiles/").length).toBeGreaterThan(0);

        expect([...new Set(seenFor(state, "/tiles/").map((s) => s.authorization))]).toEqual([
            `Bearer ${HOST_TOKEN}`,
        ]);
    });

    test("une archive PMTiles porte le jeton de l'hôte, et garde son en-tête Range", async ({
        page,
    }) => {
        const state = await routeProtected(page);
        await bootWithoutServiceWorker(page);
        await configureHostToken(page);

        await addTileSource(page, "pmtiles");
        await expect.poll(() => seenFor(state, "/archive.pmtiles").length).toBeGreaterThan(0);

        const first = seenFor(state, "/archive.pmtiles")[0];
        expect(first?.range, "the Range header was lost on the way").toMatch(/^bytes=0-/);
        expect(first?.authorization).toBe(`Bearer ${HOST_TOKEN}`);
    });

    test("mode auth.endpoint : une archive PMTiles porte le jeton stocké", async ({ page }) => {
        const state = await routeProtected(page);
        await bootWithoutServiceWorker(page);
        await seedConnectorToken(page, {
            baseUrl: BASE,
            token: STORED,
            expiresAt: Date.now() + 3600 * 1000,
        });
        await page.evaluate(
            (baseUrl) =>
                /** @type {any} */ (window).GeoLeaf.Connector.configure({
                    baseUrl,
                    auth: { endpoint: `${baseUrl}/auth` },
                }),
            BASE
        );

        await addTileSource(page, "pmtiles");
        await expect.poll(() => seenFor(state, "/archive.pmtiles").length).toBeGreaterThan(0);

        const first = seenFor(state, "/archive.pmtiles")[0];
        expect(first?.range, "the Range header was lost on the way").toMatch(/^bytes=0-/);
        expect(first?.authorization).toBe(`Bearer ${STORED}`);
    });

    test("un jeton que l'hôte fait tourner (401) est relu à la requête suivante, ouvrier et tuiles", async ({
        page,
    }) => {
        const state = await routeProtected(page);
        await bootWithoutServiceWorker(page);
        await configureHostToken(page);

        await addTileSource(page, "tiles");
        await expect.poll(() => seenFor(state, "/tiles/").length).toBeGreaterThan(0);

        // The host rotated its token after a 401 — nothing tells the connector, and nothing must.
        await page.evaluate((token) => {
            /** @type {any} */ (window).__hostToken = token;
        }, ROTATED);
        const mark = state.seen.length;

        // NEW tiles: MapLibre never replays the ones it already has.
        await page.evaluate(() => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            map.jumpTo({ zoom: Math.min(map.getZoom() + 3, 13) });
        });
        await createLayer(page, "rotated");

        await expect
            .poll(() => state.seen.slice(mark).some((s) => s.url.includes("/tiles/")))
            .toBe(true);
        await expect
            .poll(() => seenFor(state, "/layers/rotated.geojson").length)
            .toBeGreaterThan(0);

        const lastTile = state.seen.filter((s) => s.url.includes("/tiles/")).at(-1);
        expect(lastTile?.authorization).toBe(`Bearer ${ROTATED}`);
        expect(seenFor(state, "/layers/rotated.geojson")[0]?.authorization).toBe(
            `Bearer ${ROTATED}`
        );
    });

    test("réseau coupé : un getToken qui rejette ne casse ni l'ouvrier ni les tuiles, et la requête suivante porte le jeton", async ({
        page,
        context,
    }) => {
        /** @type {string[]} */
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        const state = await routeProtected(page);
        await bootWithoutServiceWorker(page);
        await configureHostToken(page, { rejectOffline: true });

        await withOffline(context, page, async () => {
            state.cut = true;
            await createLayer(page, "offline");
            await addTileSource(page, "tiles");
            // Positive witness: both paths reached for the network, and the network was gone.
            await expect
                .poll(() => seenFor(state, "/layers/offline.geojson").length)
                .toBeGreaterThan(0);
            await expect.poll(() => seenFor(state, "/tiles/").length).toBeGreaterThan(0);
            state.cut = false;
        });

        expect(
            pageErrors.filter((m) => m.includes("host session unreachable")),
            "the host's rejection escaped the loading paths"
        ).toEqual([]);

        await createLayer(page, "back");
        await expect.poll(() => seenFor(state, "/layers/back.geojson").length).toBeGreaterThan(0);
        expect(seenFor(state, "/layers/back.geojson")[0]?.authorization).toBe(
            `Bearer ${HOST_TOKEN}`
        );
    });
});
