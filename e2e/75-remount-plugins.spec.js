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
//   · cycle after cycle, with the plugins built again each time, the live listeners stay flat.
//
// ⚠️ ONE DECISION IS ASSERTED AS SUCH: `unmount()` does NOT give `window.fetch` back to a
// configured connector. `configure()` is the host's call, made once for the page — the session is
// not part of the application the boot starts.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { installListenerProbe, liveListeners } from "./helpers/listener-probe.js";
import { bootPage, installSignals, mountAndWait, unmount } from "./helpers/mount.js";

test.use({ baseURL: baseURL("full") });

/** Where an emitting position-share posts — intercepted, never reached. */
const SHARE_ENDPOINT = "https://positions.geoleaf-e2e.test/positions";
/** A connector base that collides with none of the application's own requests. */
const CONNECTOR_BASE = "https://api.geoleaf-e2e.test";
const HERE = { latitude: -32.95, longitude: -60.65 };

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
        let emptied = 0;
        await context.route(/\/dist\/geoleaf-geocoding\.plugin\.js$/, (route) => {
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
});
