// @ts-check
// E2E: GeoLeaf.mount() — the PLUGINS, unmounted and mounted again with the application.
//
// `71-mount-remount` proves that the application comes back whole, on `deploy-core`, for the core
// and the plugins that variant loads at boot. A plugin loaded ON DEMAND is out of its reach by
// construction: a page that merely boots holds nothing of it. This spec is the other half, on
// `deploy-full`: the plugins are brought to their BUILT state — the table open, the editor armed,
// a measure started, a print area being selected —, then the application is unmounted and mounted.
//
// What it guards, each seen RED on the deployed build before the fix (motive in the commit):
//
//   · the toolbar gives every button back — list AND order equal to the one `boot()` drew. A
//     plugin loaded since the boot lost its button: the toolbars offered the lazy slots of the
//     plugins NOT loaded yet, and a plugin loaded late declares no slot of its own;
//   · nothing of a plugin outlives `unmount()` — the table panel stayed open in `<body>`, the
//     editor and measure menus in the map container, the print selector over it;
//   · each button WORKS on the new map — the editor and the measure tool kept the engine of the
//     map that had gone, and armed nothing;
//   · the credential button of the connector returns, and the map of the next application gets the
//     request hook of a configured connector;
//   · a position being shared stops being sent;
//   · a plugin loaded after the boot is torn down too (`geocoding`, whose preload is emptied);
//   · `realtime-layer` loaded after the boot stops polling with the application, and one set of
//     sources — not two — polls on the next map;
//   · a pane its plugin removed is not brought back by the host that had adopted it — the
//     itinerary pane of `routing`, under the mobile sheet AND under the desktop panel;
//   · a guidance session of `navigation` ends with the application — banner, position watch,
//     screen wake lock — and is not resumed;
//   · the offline window of `offline-ui` closes with the application, and gives its listeners back;
//   · cycle after cycle, with the plugins built again each time, the live listeners stay flat.
//
// ⚠️ TWO DECISIONS ARE ASSERTED AS SUCH. `unmount()` does NOT give `window.fetch` back to a
// configured connector, and does NOT close the socket `GeoLeaf.Ws.init()` opened. Both are the
// host's call, made once for the page — neither is part of the application the boot starts.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import {
    installListenerProbe,
    liveListeners,
    livePageListeners,
} from "./helpers/listener-probe.js";
import { bootPage, installSignals, mountAndWait, unmount } from "./helpers/mount.js";

test.use({ baseURL: baseURL("full") });

/** Where an emitting position-share posts — intercepted, never reached. */
const SHARE_ENDPOINT = "https://positions.geoleaf-e2e.test/positions";
/** A connector base that collides with none of the application's own requests. */
const CONNECTOR_BASE = "https://api.geoleaf-e2e.test";
const HERE = { latitude: -32.95, longitude: -60.65 };
/** A socket endpoint that exists nowhere — answered by the spec, never reached. */
const WS_URL = "wss://ws.geoleaf-e2e.test/live";
/** A synthetic itinerary along one parallel — what `routing` shows and `navigation` follows. */
const ROUTE_LINE = [
    [-60.66, -32.95],
    [-60.659, -32.95],
    [-60.658, -32.95],
    [-60.657, -32.95],
    [-60.656, -32.95],
];
const ROUTE = {
    distance: 400,
    duration: 40,
    geometry: "",
    provider: "e2e",
    waypoints: [
        { coordinates: ROUTE_LINE[0], name: "Start" },
        { coordinates: ROUTE_LINE[4], name: "End" },
    ],
    legs: [{ distance: 400, duration: 40, steps: [] }],
};

/**
 * Counts the live intervals and the product's live mutation observers — neither is seen by the
 * listener probe. Installed before any page script.
 *
 * ⚠️ Playwright's own injected script keeps one observer on `document` for the life of the page:
 * an observer is counted only when it was created from a script of the PAGE's origin.
 *
 * @param {import("@playwright/test").Page} page
 */
async function installTimerProbe(page) {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        const intervals = new Set();
        const setI = w.setInterval;
        const clearI = w.clearInterval;
        w.setInterval = function (/** @type {any[]} */ ...args) {
            const id = setI.apply(this, args);
            intervals.add(id);
            return id;
        };
        w.clearInterval = function (/** @type {any} */ id) {
            intervals.delete(id);
            return clearI.call(this, id);
        };
        const observers = new Set();
        const Native = w.MutationObserver;
        w.MutationObserver = class extends Native {
            /** @param {any[]} args */
            observe(...args) {
                if (String(new Error().stack).includes(location.origin)) observers.add(this);
                return super.observe(...args);
            }
            disconnect() {
                observers.delete(this);
                return super.disconnect();
            }
        };
        w.__glTimers = () => ({ intervals: intervals.size, observers: observers.size });
        w.__glNativeFetch = w.fetch;
    });
}

/**
 * Replaces what a guidance session HOLDS on the device — the position watch and the screen wake
 * lock — by counted stand-ins, and lets a spec feed positions (`__glFix`). Installed before any
 * page script. Neither is visible in the DOM: without the count, a session that outlives its
 * application is indistinguishable from one that ended.
 *
 * @param {import("@playwright/test").Page} page
 */
async function installGuidanceProbe(page) {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        const watches = new Map();
        let nextWatch = 1;
        Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: {
                watchPosition: (/** @type {Function} */ onFix) => {
                    const id = nextWatch++;
                    watches.set(id, onFix);
                    return id;
                },
                clearWatch: (/** @type {number} */ id) => {
                    watches.delete(id);
                },
                getCurrentPosition: () => {},
            },
        });
        let locks = 0;
        Object.defineProperty(navigator, "wakeLock", {
            configurable: true,
            value: {
                request: async () => {
                    locks += 1;
                    return {
                        released: false,
                        release: async () => {
                            locks -= 1;
                        },
                        addEventListener() {},
                        removeEventListener() {},
                    };
                },
            },
        });
        w.__glHeld = () => ({ watches: watches.size, wakeLocks: locks });
        w.__glFix = (
            /** @type {number} */ lng,
            /** @type {number} */ lat,
            /** @type {number} */ at
        ) =>
            watches.forEach((onFix) =>
                onFix({
                    coords: {
                        longitude: lng,
                        latitude: lat,
                        accuracy: 6,
                        altitude: null,
                        altitudeAccuracy: null,
                        heading: null,
                        speed: 10,
                    },
                    timestamp: at,
                })
            );
    });
}

/**
 * What a guidance session shows and holds right now.
 *
 * @param {import("@playwright/test").Page} page
 */
function guidance(page) {
    return page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return {
            banners: document.querySelectorAll(".gl-nav-banner").length,
            guiding: w.GeoLeaf.Navigation?.isGuiding?.() ?? false,
            ...w.__glHeld(),
        };
    });
}

/**
 * Starts a guidance session on the synthetic itinerary and feeds it two positions.
 *
 * @param {import("@playwright/test").Page} page
 */
async function startGuidance(page) {
    await page.evaluate(
        async ({ route, line }) => {
            const w = /** @type {any} */ (window);
            await w.GeoLeaf.plugins.load("navigation");
            w.GeoLeaf.Navigation.start(route, line, {
                recompute: async () => ({ ok: false, reason: "network" }),
                decodeGeometry: () => line,
            });
            let at = 1_700_000_000_000;
            for (const [lng, lat] of line.slice(0, 2)) {
                at += 5000;
                w.__glFix(lng, lat, at);
            }
        },
        { route: ROUTE, line: ROUTE_LINE }
    );
}

/**
 * The buttons the toolbars show, in DOM order — what « the same toolbar » means.
 *
 * @param {import("@playwright/test").Page} page
 */
function bars(page) {
    return page.evaluate(() => {
        const list = (/** @type {string} */ attr) =>
            [...document.querySelectorAll(`[${attr}]`)].map((e) => e.getAttribute(attr));
        return {
            actions: list("data-gl-toolbar-action"),
            sheets: list("data-gl-sheet"),
            desktopTabs: list("data-gl-desktop-tab"),
            credentialButtons: document.querySelectorAll(".gc-credential-btn").length,
            credentialSeparators: document.querySelectorAll(".gc-credential-separator").length,
        };
    });
}

/**
 * What the plugins hold in the page right now.
 *
 * @param {import("@playwright/test").Page} page
 */
function pluginState(page) {
    return page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const count = (/** @type {string} */ sel) => document.querySelectorAll(sel).length;
        /** @type {string[]} */
        let layers = [];
        let hook = false;
        try {
            const native = w.GeoLeaf.Core.getMap().getNativeMap();
            layers = native.getStyle().layers.map((/** @type {any} */ l) => l.id);
            hook = typeof native._requestManager._transformRequestFn === "function";
        } catch {
            /* no map: the application is unmounted */
        }
        const timers = w.__glTimers();
        return {
            tablePanels: count(".gl-table-panel"),
            tableVisible: count(".gl-table-panel.gl-is-visible"),
            tableOpenClass: document.body.classList.contains("gl-table-open"),
            editorRoots: count(".gl-editor-root"),
            editorLayers: layers.filter((id) => id.startsWith("td-")).length,
            measureRoots: count(".gl-measure-root"),
            measureLayers: layers.filter((id) => id.startsWith("gl-measure-")).length,
            printSelectors: count(".gl-emprise-overlay"),
            geocodingControls: count(".gl-geocoding-ctrl"),
            positionBadges: count(".gl-position-share-badge"),
            credentialButtons: count(".gc-credential-btn"),
            requestHook: hook,
            fetchReplaced: w.fetch !== w.__glNativeFetch,
            intervals: timers.intervals,
            observers: timers.observers,
        };
    });
}

/**
 * Clicks a toolbar button through the DOM — the path a user's click takes, whatever the
 * viewport shows of the two toolbars.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} action
 */
async function clickToolbar(page, action) {
    const clicked = await page.evaluate((a) => {
        const button = /** @type {HTMLElement | null} */ (
            document.querySelector(`[data-gl-toolbar-action="${a}"]`)
        );
        button?.click();
        return button !== null;
    }, action);
    expect(clicked, `the toolbar has a « ${action} » button`).toBe(true);
}

/** Waits for a drawing layer of the editor on the map alive now. */
function editorArmed(/** @type {import("@playwright/test").Page} */ page, timeout = 30_000) {
    return page.waitForFunction(
        () => {
            try {
                const w = /** @type {any} */ (window);
                return !!w.GeoLeaf.Core.getMap().getNativeMap().getLayer("td-point");
            } catch {
                return false;
            }
        },
        null,
        { timeout }
    );
}

/**
 * Brings the plugins to their built state through the toolbar, as a user does: the table open,
 * the editor armed, a measure started. Lazy plugins load on their first click.
 *
 * @param {import("@playwright/test").Page} page
 */
async function buildPlugins(page) {
    await clickToolbar(page, "table");
    await expect(page.locator(".gl-table-panel.gl-is-visible")).toHaveCount(1, { timeout: 20_000 });

    await clickToolbar(page, "editor");
    const tool = page.locator('button.gl-editor-tool-btn[data-tool="select"]');
    await tool.waitFor({ state: "visible", timeout: 20_000 });
    await tool.click();
    await editorArmed(page);

    await clickToolbar(page, "measure");
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Measure?.startMeasure) === "function",
        null,
        { timeout: 20_000 }
    );
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Measure.startMeasure("distance"));
    await expect
        .poll(async () => (await pluginState(page)).measureLayers, { timeout: 20_000 })
        .toBeGreaterThan(0);
}

/**
 * Lets what keeps loading after `geoleaf:app:ready` land: two equal readings, 500 ms apart.
 *
 * @param {import("@playwright/test").Page} page
 */
async function settle(page) {
    let previous = "";
    for (let i = 0; i < 40; i++) {
        const current = JSON.stringify([await bars(page), await pluginState(page)]);
        if (current === previous) return;
        previous = current;
        await page.waitForTimeout(500);
    }
    throw new Error("the page never settled");
}

test.describe("75-remount-plugins — the plugins, unmounted and mounted again", () => {
    test("built plugins leave with the application, and every button works on the next", async ({
        page,
    }) => {
        test.setTimeout(240_000);
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await installSignals(page);
        await installTimerProbe(page);
        await bootPage(page);
        await settle(page);

        // B0 is the toolbar `boot()` drew, before any plugin loaded on demand.
        const b0 = await bars(page);
        // Non-vacuity: the buttons this spec is about are there to be lost.
        for (const action of ["table", "editor", "measure", "print", "position-share"]) {
            expect(b0.actions, `B0 has a « ${action} » button`).toContain(action);
        }
        expect(b0.credentialButtons, "B0 has the credential buttons").toBe(2);

        await mountAndWait(page);
        await settle(page);
        expect(await bars(page), "the takeover drew the toolbar boot() drew").toEqual(b0);
        const idle = await pluginState(page);

        await buildPlugins(page);
        await clickToolbar(page, "print");
        await expect(page.locator(".gl-emprise-overlay")).toHaveCount(1, { timeout: 20_000 });
        await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.plugins.load("position-share")
        );

        const built = await pluginState(page);
        // Non-vacuity: there IS something to tear down.
        expect(built.tableVisible).toBe(1);
        expect(built.tableOpenClass).toBe(true);
        expect(built.editorRoots).toBe(1);
        expect(built.editorLayers).toBeGreaterThan(0);
        expect(built.measureRoots).toBe(1);
        expect(built.printSelectors).toBe(1);

        await unmount(page);
        const gone = await pluginState(page);
        expect(
            {
                tablePanels: gone.tablePanels,
                tableOpenClass: gone.tableOpenClass,
                tableIsOpen: await page.evaluate(() =>
                    /** @type {any} */ (window).GeoLeaf.Table.isOpen()
                ),
                editorRoots: gone.editorRoots,
                measureRoots: gone.measureRoots,
                printSelectors: gone.printSelectors,
                geocodingControls: gone.geocodingControls,
                credentialButtons: gone.credentialButtons,
                observers: gone.observers,
                intervals: gone.intervals,
            },
            "the unmounted application left something of a plugin"
        ).toEqual({
            tablePanels: 0,
            tableOpenClass: false,
            tableIsOpen: false,
            editorRoots: 0,
            measureRoots: 0,
            printSelectors: 0,
            geocodingControls: 0,
            credentialButtons: 0,
            observers: 0,
            intervals: 0,
        });

        await mountAndWait(page);
        await settle(page);
        expect(await bars(page), "the toolbar of the next application").toEqual(b0);
        const back = await pluginState(page);
        expect(back.intervals, "the intervals of an idle application").toBe(idle.intervals);
        expect(back.tablePanels, "the table is not open on its own").toBe(0);

        // Every button works — on the map alive NOW.
        await buildPlugins(page);
        const rebuilt = await pluginState(page);
        expect(rebuilt.tableVisible).toBe(1);
        expect(rebuilt.editorRoots).toBe(1);
        expect(rebuilt.editorLayers).toBeGreaterThan(0);
        expect(rebuilt.measureRoots).toBe(1);
        expect(
            await page.evaluate(() => {
                const w = /** @type {any} */ (window);
                const container = w.GeoLeaf.Core.getMap().getNativeMap().getContainer();
                return {
                    editor: container.querySelectorAll(".gl-editor-root").length,
                    measure: container.querySelectorAll(".gl-measure-root").length,
                };
            }),
            "the menus sit in the container of the new map"
        ).toEqual({ editor: 1, measure: 1 });

        await clickToolbar(page, "print");
        await expect(page.locator(".gl-emprise-overlay")).toHaveCount(1, { timeout: 20_000 });

        expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
    });

    test("five cycles with the plugins built again each time: live listeners stay flat", async ({
        page,
    }) => {
        test.setTimeout(420_000);
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await installSignals(page);
        await installTimerProbe(page);
        await installListenerProbe(page);
        await bootPage(page);
        await mountAndWait(page);
        await settle(page);
        await buildPlugins(page);
        await settle(page);

        const CYCLES = 5;
        const counts = [];
        for (let i = 1; i <= CYCLES; i++) {
            await unmount(page);
            await mountAndWait(page);
            await settle(page);
            await buildPlugins(page);
            await settle(page);
            counts.push(await liveListeners(page));
        }

        // Judged on the series, as in `71-mount-remount`: a leak drifts, jitter does not.
        // ⚠️ From the SECOND cycle on. Measured, over three runs: the first cycle reads a few
        // listeners more than every following one (608, 608, 613), which are equal to each other
        // (602). Judged against that first reading, a leak of one or two listeners per cycle
        // would have hidden under it for the whole series.
        const JITTER = 2;
        const steady = counts.slice(1);
        expect(counts[0], "listener probe observed nothing — it is not wired").toBeGreaterThan(50);
        expect(
            Math.max(...steady) - steady[0],
            `live listeners drifted across ${CYCLES} cycles: ${counts.join(", ")}`
        ).toBeLessThanOrEqual(JITTER);
        expect(
            Math.max(...counts) - counts[0],
            `the first cycle is not the highest: ${counts.join(", ")}`
        ).toBeLessThanOrEqual(JITTER);
        console.info(
            `[remount-plugins] live listeners over ${CYCLES} cycles: ${counts.join(", ")}`
        );
        expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
    });

    test("a position being shared is no longer sent once the application is unmounted", async ({
        browser,
    }) => {
        test.setTimeout(180_000);
        const context = await browser.newContext({
            baseURL: baseURL("full"),
            ignoreHTTPSErrors: true,
            permissions: ["geolocation"],
            geolocation: HERE,
        });
        let posts = 0;
        await context.route(`${SHARE_ENDPOINT}**`, (route) => {
            posts += 1;
            return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        });
        const page = await context.newPage();
        try {
            await installSignals(page);
            await installTimerProbe(page);
            await bootPage(page);
            await mountAndWait(page);
            await settle(page);

            await page.evaluate(
                async ({ endpoint, here }) => {
                    const gl = /** @type {any} */ (window).GeoLeaf;
                    const original = gl.Config.get.bind(gl.Config);
                    const cfg = {
                        enabled: true,
                        mode: "manual",
                        transport: "http",
                        endpoint,
                        intervalMs: 500,
                        minDistanceM: 0,
                        showButton: true,
                        receive: { enabled: false },
                    };
                    gl.Config.get = (/** @type {string} */ k, /** @type {unknown} */ d) =>
                        k === "modules.position-share" ? cfg : original(k, d);
                    await gl.plugins.load("position-share");
                    // ⚠️ The seam the emitter reads answers « active » FOR EVER, the unmounted
                    // application included: what is measured is the loop itself, in the worst
                    // case — a watch still running when the application goes.
                    const geo = gl.Geolocation;
                    gl.Geolocation = {
                        ...geo,
                        getState: () => ({
                            active: true,
                            watchId: 1,
                            userPosition: {
                                lat: here.latitude,
                                lng: here.longitude,
                                timestamp: Date.now(),
                            },
                        }),
                    };
                    gl.PositionShare.start();
                },
                { endpoint: SHARE_ENDPOINT, here: HERE }
            );
            await expect.poll(() => posts, { timeout: 15_000 }).toBeGreaterThan(1);
            expect((await pluginState(page)).positionBadges, "the badge says it is sharing").toBe(
                1
            );

            await unmount(page);
            const after = posts;
            await page.waitForTimeout(4000);

            expect(posts - after, "positions sent after unmount()").toBe(0);
            expect(
                await page.evaluate(() =>
                    /** @type {any} */ (window).GeoLeaf.PositionShare.isEmitting()
                )
            ).toBe(false);
            const gone = await pluginState(page);
            expect(gone.positionBadges).toBe(0);
            expect(gone.intervals).toBe(0);
        } finally {
            await context.close();
        }
    });

    test("a configured connector keeps its session, and the next map gets its request hook", async ({
        context,
        page,
    }) => {
        test.setTimeout(180_000);
        await context.route(`${CONNECTOR_BASE}/**`, (route) =>
            route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
        );
        await installSignals(page);
        await installTimerProbe(page);
        await bootPage(page);
        await mountAndWait(page);
        await settle(page);

        await page.evaluate(async (base) => {
            const w = /** @type {any} */ (window);
            await w.GeoLeaf.plugins.load("connector");
            // Not awaited: with no stored session it waits on a login nobody gives.
            void Promise.resolve(
                w.GeoLeaf.Connector.configure({
                    baseUrl: base,
                    auth: { endpoint: `${base}/login`, ui: false },
                })
            ).catch(() => {});
        }, CONNECTOR_BASE);
        await expect
            .poll(async () => (await pluginState(page)).requestHook, { timeout: 15_000 })
            .toBe(true);
        expect((await pluginState(page)).fetchReplaced, "configure() replaced fetch").toBe(true);

        await unmount(page);
        const gone = await pluginState(page);
        // THE DECISION: the session is the host's, an unmount does not give `fetch` back.
        expect(gone.fetchReplaced, "window.fetch after unmount()").toBe(true);
        expect(gone.credentialButtons).toBe(0);

        await mountAndWait(page);
        await settle(page);
        const back = await pluginState(page);
        expect(back.fetchReplaced).toBe(true);
        expect(back.requestHook, "the request hook on the map of the next application").toBe(true);
        expect(back.credentialButtons, "the credential buttons of the next application").toBe(2);
    });

    test("a plugin loaded after the boot is torn down too — geocoding, its preload emptied", async ({
        browser,
    }) => {
        test.setTimeout(180_000);
        // The service worker is blocked: a request it serves is not seen by the route below.
        const context = await browser.newContext({
            baseURL: baseURL("full"),
            ignoreHTTPSErrors: true,
            serviceWorkers: "block",
        });
        // The application preloads the plugin at boot whenever its profile enables it: the late
        // path does not exist as shipped. Its preload gets an EMPTY module, and the real bundle
        // is evaluated below under another URL — a module is cached by its URL.
        // ⚠️ The preload asks for the bundle with its content token (`?v=`): the pattern takes
        // it with or without one, and stops there — `?late`, below, must reach the real file.
        let emptied = 0;
        await context.route(/\/dist\/geoleaf-geocoding\.plugin\.js(\?v=[0-9a-f]+)?$/, (route) => {
            emptied += 1;
            return route.fulfill({
                status: 200,
                contentType: "text/javascript",
                body: "export {};",
            });
        });
        const page = await context.newPage();
        try {
            await installSignals(page);
            await installTimerProbe(page);
            await bootPage(page);
            await mountAndWait(page);
            await settle(page);
            expect(emptied, "the preload was intercepted").toBeGreaterThan(0);
            expect(
                await page.evaluate(() => typeof (/** @type {any} */ (window).GeoLeaf.Geocoding)),
                "the plugin is not loaded yet"
            ).toBe("undefined");

            // Nothing is returned: a module namespace does not cross the evaluation boundary.
            await page.evaluate(
                async (url) => {
                    await import(url);
                },
                `${baseURL("full")}/dist/geoleaf-geocoding.plugin.js?late`
            );
            await expect(page.locator(".gl-geocoding-ctrl")).toHaveCount(1, { timeout: 15_000 });

            await unmount(page);
            expect((await pluginState(page)).geocodingControls, "after unmount()").toBe(0);

            await mountAndWait(page);
            await expect(page.locator(".gl-geocoding-ctrl")).toHaveCount(1, { timeout: 15_000 });
        } finally {
            await context.close();
        }
    });

    test("realtime-layer loaded after the boot stops polling with the application, and restarts ONCE", async ({
        browser,
    }) => {
        test.setTimeout(180_000);
        // 🛑 MEASURED BEFORE THE FIX, by this very technique: its module was registered only
        // before the first boot, so loaded late the plugin heard no unmount. Over nine seconds
        // at a two-second interval the feed was requested 4 times AFTER `unmount()` — for a
        // layer that no longer existed — and 9 times after the next `mount()`: a second set of
        // sources beside the first. After the fix: 0, then 4.
        const LAYER = "epicentres_seismes";
        const INTERVAL_MS = 2000;
        const WINDOW_MS = 9000;
        const context = await browser.newContext({
            baseURL: baseURL("full"),
            ignoreHTTPSErrors: true,
            serviceWorkers: "block",
        });
        let emptied = 0;
        // With or without its content token, and nothing else — see the geocoding case above.
        await context.route(
            /\/dist\/geoleaf-realtime-layer\.plugin\.js(\?v=[0-9a-f]+)?$/,
            (route) => {
                emptied += 1;
                return route.fulfill({
                    status: 200,
                    contentType: "text/javascript",
                    body: "export {};",
                });
            }
        );
        // The shipped interval is a minute: shortened, so a window of seconds can count.
        await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
            const bundle = await (await route.fetch()).json();
            const realtime = bundle.layerConfigs?.[LAYER]?.data?.realtime;
            if (!realtime)
                throw new Error(`le bundle ne porte plus la couche temps réel \`${LAYER}\``);
            realtime.intervalMs = INTERVAL_MS;
            await route.fulfill({ json: bundle });
        });
        // The feed is a route, counted: the subject is WHETHER it is asked, not what it answers.
        /** @type {number[]} */
        const asked = [];
        await context.route("https://earthquake.usgs.gov/**", (route) => {
            asked.push(Date.now());
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ type: "FeatureCollection", features: [] }),
            });
        });
        const page = await context.newPage();
        /** How many times the feed is asked over the next window. */
        const askedOverWindow = async () => {
            const from = Date.now();
            await page.waitForTimeout(WINDOW_MS);
            return asked.filter((at) => at >= from).length;
        };
        try {
            await installSignals(page);
            await bootPage(page);
            await mountAndWait(page);
            expect(emptied, "the preload was intercepted").toBeGreaterThan(0);
            expect(
                await page.evaluate(
                    () => typeof (/** @type {any} */ (window).GeoLeaf.RealtimeLayer)
                ),
                "the plugin is not loaded yet"
            ).toBe("undefined");

            await page.evaluate(
                async ({ url, layer }) => {
                    await import(url);
                    /** @type {any} */ (window).GeoLeaf.RealtimeLayer.start(layer);
                },
                {
                    url: `${baseURL("full")}/dist/geoleaf-realtime-layer.plugin.js?late`,
                    layer: LAYER,
                }
            );
            // The witness: the source polls, at about the interval — else nothing below is a
            // measure of a source that stopped.
            const mounted = await askedOverWindow();
            expect(mounted, "the late-loaded source does not poll").toBeGreaterThanOrEqual(3);

            await unmount(page);
            // One request may be in flight at the unmount; the window is counted after it.
            await page.waitForTimeout(1500);
            expect(
                await askedOverWindow(),
                "the feed is still polled after unmount(), for a layer that is gone"
            ).toBe(0);

            await mountAndWait(page);
            const again = await askedOverWindow();
            expect(again, "the sources did not start again on the next map").toBeGreaterThanOrEqual(
                3
            );
            // One set, not two: twice the rate is what a second set beside the first gave.
            expect(again, "a second set of sources polls beside the first").toBeLessThanOrEqual(
                mounted + 2
            );
        } finally {
            await context.close();
        }
    });

    // 🛑 MEASURED BEFORE THE FIX, under both hosts: the plugin removes its pane at the unmount,
    // then the host that had adopted it — torn down after the plugin — handed its moved nodes
    // back to their original parent without checking that it still held them. The pane was back
    // in `<body>` after `unmount()`, the SAME element, and the next opening built a second one
    // beside it. The defect was the host's: any hosted pane its plugin removes was in that case.
    for (const host of [
        {
            name: "the mobile sheet",
            viewport: { width: 1280, height: 720 },
            within: "#gl-sheet-panel-body",
        },
        {
            name: "the desktop panel",
            viewport: { width: 1600, height: 900 },
            within: ".gl-rp-pane",
        },
    ]) {
        test(`a pane its plugin removed is not brought back by ${host.name} — routing`, async ({
            browser,
        }) => {
            test.setTimeout(180_000);
            const context = await browser.newContext({
                baseURL: baseURL("full"),
                ignoreHTTPSErrors: true,
                viewport: host.viewport,
            });
            const page = await context.newPage();
            const pageErrors = [];
            page.on("pageerror", (e) => pageErrors.push(e.message));
            /** Opens the itinerary pane and reads where its roots sit. */
            const openPane = async () => {
                await clickToolbar(page, "routing");
                await expect(page.locator(".gl-routing-panel")).not.toHaveCount(0, {
                    timeout: 20_000,
                });
                return page.evaluate(
                    (within) => ({
                        panes: document.querySelectorAll(".gl-routing-panel").length,
                        hosted: document.querySelectorAll(`${within} .gl-routing-panel`).length,
                    }),
                    host.within
                );
            };
            try {
                await installSignals(page);
                await installTimerProbe(page);
                await bootPage(page);
                await mountAndWait(page);
                await settle(page);

                // The witness: ONE pane, and it is THIS host that holds it — else the test would
                // pass on the other host, whatever this one does.
                expect(await openPane(), `the pane is open in ${host.name}`).toEqual({
                    panes: 1,
                    hosted: 1,
                });

                await unmount(page);
                await expect(
                    page.locator(".gl-routing-panel"),
                    "the pane its plugin removed is back in the page"
                ).toHaveCount(0);

                await mountAndWait(page);
                await settle(page);
                expect(await page.locator(".gl-routing-panel").count(), "after mount()").toBe(0);
                expect(await openPane(), "the next opening builds ONE pane").toEqual({
                    panes: 1,
                    hosted: 1,
                });
                expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
            } finally {
                await context.close();
            }
        });
    }

    test("a guidance session ends with the application, and is not resumed", async ({ page }) => {
        test.setTimeout(180_000);
        // 🛑 MEASURED BEFORE THE FIX: the plugin registered no lifecycle module. After
        // `unmount()` the banner was still in the page, one position watch and one wake lock
        // were still held, and the session followed positions for a map that was gone.
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await installSignals(page);
        await installTimerProbe(page);
        await installGuidanceProbe(page);
        await bootPage(page);
        await mountAndWait(page);
        await settle(page);

        await startGuidance(page);
        // The witness: there IS a session, and it holds what the test says it gives back.
        await expect
            .poll(() => guidance(page), { timeout: 15_000 })
            .toEqual({ banners: 1, guiding: true, watches: 1, wakeLocks: 1 });

        await unmount(page);
        await expect
            .poll(() => guidance(page), {
                timeout: 5_000,
                message: "the session outlived its application",
            })
            .toEqual({ banners: 0, guiding: false, watches: 0, wakeLocks: 0 });

        await mountAndWait(page);
        await settle(page);
        expect(await guidance(page), "the next mount resumed the session").toEqual({
            banners: 0,
            guiding: false,
            watches: 0,
            wakeLocks: 0,
        });

        // And guidance WORKS on the next application: the banner sits in the new map.
        await startGuidance(page);
        await expect
            .poll(() => guidance(page), { timeout: 15_000 })
            .toEqual({ banners: 1, guiding: true, watches: 1, wakeLocks: 1 });
        expect(
            await page.evaluate(() => {
                const w = /** @type {any} */ (window);
                const container = w.GeoLeaf.Core.getMap().getNativeMap().getContainer();
                return container.querySelectorAll(".gl-nav-banner").length;
            }),
            "the banner sits in the container of the new map"
        ).toBe(1);
        expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
    });

    test("the offline window closes with the application, and its listeners come back", async ({
        page,
    }) => {
        test.setTimeout(240_000);
        // 🛑 MEASURED BEFORE THE FIX: open at `unmount()`, the window stayed over the page — and
        // over the next application —, with some thirty listeners.
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await installSignals(page);
        await installTimerProbe(page);
        await installListenerProbe(page);
        await bootPage(page);
        await mountAndWait(page);
        await settle(page);

        // ⚠️ The listeners of the PAGE, not every live one: the requests a map had in flight when
        // it went each hold an `abort` listener for a while, and that count fell by twelve
        // between two cycles of this very test — on nothing the window does.
        /** Two equal readings, 500 ms apart: the window keeps rendering after it shows. */
        const settledListeners = async () => {
            let previous = -1;
            for (let i = 0; i < 40; i++) {
                const current = await livePageListeners(page);
                if (current === previous) return current;
                previous = current;
                await page.waitForTimeout(500);
            }
            throw new Error("the live listeners never settled");
        };

        // The reference: what an unmounted application leaves when the window was NEVER opened.
        const idle = [await settledListeners()];
        await unmount(page);
        const bare = await settledListeners();
        await mountAndWait(page);
        await settle(page);
        idle.push(await settledListeners());

        const CYCLES = 3;
        const open = [];
        const gone = [];
        for (let i = 1; i <= CYCLES; i++) {
            await clickToolbar(page, "offline-ui");
            await expect(page.locator("#gl-cache-modal")).toBeVisible({ timeout: 20_000 });
            open.push(await settledListeners());
            await unmount(page);
            await expect(
                page.locator("#gl-cache-modal"),
                "the window of the unmounted application is still in the page"
            ).toHaveCount(0);
            gone.push(await settledListeners());
            await mountAndWait(page);
            await settle(page);
            expect(await page.locator("#gl-cache-modal").count(), "after mount()").toBe(0);
            idle.push(await settledListeners());
        }

        const JITTER = 2;
        const report = `idle ${idle.join(", ")} · window open ${open.join(", ")} · unmounted ${gone.join(", ")} (never opened: ${bare})`;
        // The witness: an open window DOES hold listeners — else « they come back » says nothing.
        expect(open[0] - idle[1], `an open window holds no listener: ${report}`).toBeGreaterThan(
            20
        );
        for (const left of gone) {
            expect(
                Math.abs(left - bare),
                `an application unmounted with its window open leaves listeners: ${report}`
            ).toBeLessThanOrEqual(JITTER);
        }
        expect(
            Math.max(...idle) - Math.min(...idle),
            `the listeners of an idle application drift: ${report}`
        ).toBeLessThanOrEqual(JITTER);
        console.info(`[remount-plugins] offline window over ${CYCLES} cycles: ${report}`);
        expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
    });
    test("a socket the host opened stays open across a remount — a decision, asserted as such", async ({
        browser,
    }) => {
        test.setTimeout(180_000);
        // Not a defect waiting for its fix: the connection is opened by the host
        // (`GeoLeaf.Ws.init()`), like the session of the connector, and belongs to the page. What
        // is asserted is that the decision HOLDS — one socket, never opened again, and a message
        // still reaches its subscriber on the next application. A plugin that came to register a
        // teardown would turn this test red, and that is its job.
        const context = await browser.newContext({
            baseURL: baseURL("full"),
            ignoreHTTPSErrors: true,
        });
        /** @type {import("@playwright/test").WebSocketRoute[]} */
        const served = [];
        await context.routeWebSocket(WS_URL, (socket) => {
            served.push(socket);
            socket.onMessage((message) => {
                try {
                    if (JSON.parse(String(message)).type === "ping") {
                        socket.send(JSON.stringify({ type: "pong" }));
                    }
                } catch {
                    /* not JSON: nothing to answer */
                }
            });
        });
        const page = await context.newPage();
        /** What the page holds of the connection. */
        const connection = () =>
            page.evaluate(() => {
                const w = /** @type {any} */ (window);
                return {
                    state: w.GeoLeaf.Ws.state,
                    subscriptions: w.GeoLeaf.Ws.getSubscriptions(),
                    received: w.__glReceived,
                };
            });
        /** Sends one message on the subscribed channel, from the server side. */
        const push = () => served[0]?.send(JSON.stringify({ channel: "t", payload: { n: 1 } }));
        try {
            await installSignals(page);
            await installTimerProbe(page);
            await bootPage(page);
            await mountAndWait(page);
            await settle(page);

            await page.evaluate(async (url) => {
                const w = /** @type {any} */ (window);
                await w.GeoLeaf.plugins.load("websocket");
                await w.GeoLeaf.Ws.init({
                    transport: "native-ws",
                    url,
                    reconnect: { initialDelayMs: 50, maxRetries: 5 },
                });
                w.__glReceived = 0;
                w.GeoLeaf.Ws.subscribe("t", () => (w.__glReceived += 1));
            }, WS_URL);
            // The witness: the channel delivers — else « still delivers » below says nothing.
            push();
            await expect
                .poll(connection, { timeout: 15_000 })
                .toEqual({ state: "connected", subscriptions: ["t"], received: 1 });

            await unmount(page);
            push();
            await expect
                .poll(connection, { timeout: 15_000 })
                .toEqual({ state: "connected", subscriptions: ["t"], received: 2 });

            await mountAndWait(page);
            await settle(page);
            push();
            await expect
                .poll(connection, { timeout: 15_000 })
                .toEqual({ state: "connected", subscriptions: ["t"], received: 3 });
            expect(served.length, "the socket was opened again").toBe(1);

            // And the gesture that DOES close it is the host's.
            await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Ws.destroy());
            expect((await connection()).state).toBe("disconnected");
        } finally {
            await context.close();
        }
    });
});
