// @ts-check
/**
 * 37 — OFFLINE GUIDANCE (F-06.3): a prepared route unrolls **without a
 * single network call**.
 *
 * 🛑 **The assertion that counts is the REQUEST COUNT, not the absence of
 * errors.** A silently failing guidance would make no call either — the
 * zero would then be true and empty. Each scenario thus carries its
 * WITNESS: the number of samples emitted and the states traversed, without
 * which "zero requests" cannot tell an autonomous guidance from a dead one.
 *
 * ═══ THE INSTRUMENT WAS SCHOOLED BEFORE WRITING THESE ASSERTIONS ═══
 *
 * Measured on 2026-08-22 against the vhost, recorder open and WITHOUT
 * assertions:
 *
 * ① **The guidance loop really produces ZERO requests** — four fixes
 *    replayed, four samples emitted, no entry in the recorder.
 * ② **The recorder is not blind**: a deliberate `fetch()` shows up in it
 *    TWICE, `sent` then `failed` (`net::ERR_INTERNET_DISCONNECTED`).
 *    Without that measurement, ①'s zero could have been an instrument
 *    watching nothing.
 * ③ **The page itself emits background traffic** at cut-off time — an
 *    external seismic feed, a layer snapshot, an icon sheet. It must be
 *    left to settle (`settleNetwork`) BEFORE cutting, otherwise the zero is
 *    impossible and the red says nothing about the guidance.
 *
 * ⚠️ **The plugin is loaded ONLINE, and that is no test artifice.** Offline,
 * its dynamic import fails — `serviceWorkers: 'block'` prevents any
 * pre-cache. It is a product PROPERTY: guiding out of coverage requires the
 * plugin already loaded, hence the preparation happened in coverage.
 * Exactly what the design says — "guide out of coverage on a route prepared
 * while in coverage".
 *
 * Target: deploy-coverage (port 8769).
 */
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { goOffline, recordRequests, settleNetwork } from "./helpers/offline.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

/** A short path, aligned due east — four 100 m vertices. */
const LINE = [
    [55.4781, -21.0964],
    [55.479064, -21.0964],
    [55.480028, -21.0964],
    [55.480992, -21.0964],
];

/** A single-leg route. */
const ROUTE = {
    distance: 300,
    duration: 30,
    geometry: "",
    provider: "e2e",
    waypoints: [
        { coordinates: LINE[0], name: "Départ" },
        { coordinates: LINE[3], name: "Arrivée" },
    ],
    legs: [{ distance: 300, duration: 30, steps: [] }],
};

/**
 * Installs a driven geolocation whose timestamps we control.
 *
 * ⚠️ Timestamps are simulated: the jump filter bounds progress to
 * `55 m/s × Δt`, and fixes a few milliseconds apart would all be rejected.
 *
 * @param {import('@playwright/test').Page} page The page.
 */
async function fakeGeolocation(page) {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        /** @type {Function[]} */
        const cbs = [];
        Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: {
                watchPosition: (/** @type {Function} */ f) => (cbs.push(f), 7),
                clearWatch: () => {
                    cbs.length = 0;
                },
                getCurrentPosition: () => {},
            },
        });
        w.__fire = (
            /** @type {number} */ lng,
            /** @type {number} */ lat,
            /** @type {number} */ ts
        ) =>
            cbs.forEach((cb) =>
                cb({
                    coords: {
                        longitude: lng,
                        latitude: lat,
                        accuracy: 6,
                        altitude: null,
                        altitudeAccuracy: null,
                        heading: null,
                        speed: 10,
                    },
                    timestamp: ts,
                })
            );
    });
}

/**
 * Loads the page, waits for the map, loads the plugin, and lets the
 * background traffic settle.
 *
 * @param {import('@playwright/test').Page} page The page.
 * @param {import('@playwright/test').BrowserContext} context The context.
 */
async function bootAndSettle(page, context) {
    await page.goto("/");
    await page.waitForSelector(".maplibregl-canvas", { timeout: 15000 });
    await page.waitForFunction(
        () => {
            const n = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!(n && typeof n.loaded === "function" && n.loaded());
        },
        null,
        { timeout: 20000 }
    );
    // ONLINE — see the header note: offline, the dynamic import fails.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("navigation"));
    await settleNetwork(context, { timeout: 5000 }).catch(() => {});
}

/**
 * Is this URL a basemap tile — i.e. the ENGINE's traffic, not the feature's?
 *
 * 🛑 Measured, not tolerated: under `taskset -c 0,1` against nginx, the
 * recorder captured 16 calls, all toward the profile's tile hosts, because the
 * camera follows the guided position and the engine reloads the basemap — the
 * service worker (the tiles' cache layer) being blocked by Playwright. Offline
 * the requests still ISSUE and are still recorded: `recordRequests` counts
 * request INITIATIONS, not network egress (see `helpers/offline.js`).
 *
 * ⚠️ Hoisted out of the first test on 2026-08-26 because the LAST test lacked
 * it and asserted a bare `toEqual([])` — green in isolation, red under
 * full-suite load, when the tiles arrive late enough to land inside its
 * recording window. `helpers/offline.js` states the rule this violated: an
 * unscoped call on a map page CANNOT come out green, "zero requests" is only
 * ever a statement about a PERIMETER. One recogniser, two tests: two spellings
 * would have diverged the same way.
 */
const isBasemapTile = (/** @type {string} */ url) =>
    /tile\.opentopomap\.org|elevation-tiles-prod/.test(url);

test.describe("le guidage hors ligne", () => {
    test.beforeEach(async ({ page }) => fakeGeolocation(page));

    test("🛑 la boucle de guidage ne fait AUCUN appel réseau — et elle a bien tourné", async ({
        page,
        context,
    }) => {
        await bootAndSettle(page, context);
        await goOffline(context, page);

        const rec = recordRequests(context);
        const out = await page.evaluate(
            async ({ line, route }) => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                /** @type {string[]} */
                const states = [];
                gl.Navigation.onProgress((/** @type {any} */ p) => states.push(p.state));
                gl.Navigation.start(route, line, {
                    recompute: async () => ({ ok: false, reason: "network" }),
                    decodeGeometry: () => line,
                });
                let t = 1_700_000_000_000;
                for (const p of line) {
                    t += 5000;
                    /** @type {any} */ (window).__fire(p[0], p[1], t);
                }
                return states;
            },
            { line: LINE, route: ROUTE }
        );
        rec.stop();

        // 🛑 THE WITNESS FIRST. Without it, "zero requests" cannot tell an
        // autonomous guidance from one that did nothing.
        expect(out).toHaveLength(LINE.length);
        expect(out[0]).toBe("navigating");
        expect(out[out.length - 1]).toBe("arrived");

        // ⚠️ The basemap TILES are excluded from the assertion, and that is
        // measured, not tolerated: under `taskset -c 0,1` against nginx, the
        // recorder captured 16 calls — all toward the profile's tile hosts
        // (opentopomap, terrarium DEM) — because the camera FOLLOWS the
        // guided position and the engine reloads the basemap, the service
        // worker (the tiles' cache layer) being blocked by Playwright. That
        // traffic is the ENGINE's, not the guidance's; reading it as "the
        // loop falls back on the network" cost a false entry in the
        // register. The test's sentence bears on the LOOP: it is judged on
        // everything else — same origin and recompute included.
        expect(
            rec.entries.filter((e) => !isBasemapTile(e.url)).map((e) => `${e.phase} ${e.url}`),
            "la boucle de guidage a tendu la main vers le réseau"
        ).toEqual([]);
        // And among the excluded tiles, NO disguised recompute — the only
        // network the loop could legitimately want is a routing engine, and
        // it has no business here.
        expect(
            rec.entries.filter((e) => /valhalla|route|recompute/i.test(e.url)),
            "un appel de recalcul se cachait dans le trafic du moteur"
        ).toEqual([]);
    });

    test("l'enregistreur N'EST PAS aveugle — un appel volontaire y apparaît", async ({
        page,
        context,
    }) => {
        // The second direction, and it is indispensable: a recorder seeing
        // nothing would make the previous test's zero true and empty.
        // "failed" counts too — the code reached for the network, it is the
        // network that was cut.
        await bootAndSettle(page, context);
        await goOffline(context, page);

        const rec = recordRequests(context);
        await page.evaluate(async () => {
            try {
                await fetch("/__witness");
            } catch {
                /* offline — expected */
            }
        });
        rec.stop();
        expect(rec.count()).toBeGreaterThan(0);
        expect(rec.entries.some((e) => e.url.includes("__witness"))).toBe(true);
    });

    test("l'itinéraire PERSISTÉ se relit hors ligne, ligne décodée comprise", async ({
        page,
        context,
    }) => {
        // The half the `routes` store exists to render: what was prepared in
        // coverage must be there when coverage is gone.
        await bootAndSettle(page, context);
        await goOffline(context, page);

        const back = await page.evaluate(
            async ({ line, route }) => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                await gl.Storage?.whenReady?.();
                await gl.Storage?.DB?.init?.();
                const routes = gl.Storage?.DB?._ensureModule?.("Routes");
                if (!routes) return { reachable: false };
                await routes.saveRoute({
                    id: "e2e-offline",
                    route,
                    line,
                    timestamp: 42,
                    corridorBufferM: 500,
                    corridorZooms: [13, 14],
                });
                const read = await routes.getRoute("e2e-offline");
                return {
                    reachable: true,
                    id: read?.id,
                    points: read?.line?.length,
                    buffer: read?.corridorBufferM,
                };
            },
            { line: LINE, route: ROUTE }
        );

        expect(back.reachable, "le magasin `routes` n'est pas atteignable").toBe(true);
        expect(back.id).toBe("e2e-offline");
        expect(back.points).toBe(LINE.length);
        expect(back.buffer).toBe(500);
    });

    test("écrire et relire l'itinéraire ne fait AUCUN appel réseau", async ({ page, context }) => {
        // IndexedDB is local; verify it rather than assume it, because it is
        // what makes offline possible and nothing else would say so.
        await bootAndSettle(page, context);
        await goOffline(context, page);
        await page.evaluate(async () => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            await gl.Storage?.whenReady?.();
            await gl.Storage?.DB?.init?.();
        });

        const rec = recordRequests(context);
        const ok = await page.evaluate(
            async ({ line, route }) => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                const routes = gl.Storage?.DB?._ensureModule?.("Routes");
                if (!routes) return false;
                await routes.saveRoute({
                    id: "e2e-quiet",
                    route,
                    line,
                    timestamp: 7,
                    corridorBufferM: 250,
                    corridorZooms: [13],
                });
                return (await routes.getRoute("e2e-quiet"))?.id === "e2e-quiet";
            },
            { line: LINE, route: ROUTE }
        );
        rec.stop();

        expect(ok, "le témoin : l'aller-retour a bien eu lieu").toBe(true);
        // Scoped like its sibling above, and for the same measured reason: the
        // engine keeps asking for basemap tiles while this test writes to
        // IndexedDB, and those requests are the ENGINE's, not the store's. The
        // sentence this test defends is about the STORE — it is judged on
        // everything else, same origin included.
        expect(
            rec.entries.filter((e) => !isBasemapTile(e.url)).map((e) => e.url),
            "l'aller-retour IndexedDB a tendu la main vers le réseau"
        ).toEqual([]);
    });
});
