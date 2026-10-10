#!/usr/bin/env node
/**
 * PROBE — what the seven plugins `probe-remount-plugins.mjs` does not reach leave behind an
 * `unmount()`, and what the next `mount()` finds: `navigation`, `offline-ui`, `routing`,
 * `websocket`, `flatgeobuf`, `cog`, `file-import`. Measured in a real Chromium against
 * `deploy-full`.
 *
 * WHY IT EXISTS. The first probe covers the plugins that declare a lazy toolbar slot, plus
 * `connector`. These seven declare none: nothing told what a guidance session, an open offline
 * window, a hosted pane, an open socket or a layer added by a call become when the application
 * is unmounted. What they hold is not in the DOM for half of them — a position watch, a screen
 * wake lock, a socket, a request on a camera move — so each plugin gets its own fixture and its
 * own readings.
 *
 * WHAT IT MEASURES, one plugin per page: the plugin is brought to its BUILT state on a mounted
 * application, then four readings — before, built, after `unmount()`, after the next `mount()` —
 * and, where it means something, a fifth after a gesture on the new map. `routing` is read
 * twice, once per pane host: the mobile sheet below 1440 px, the desktop panel above.
 *
 *   navigation    a guidance session on a synthetic itinerary, fed two positions
 *   offline-ui    the offline window, opened by its toolbar button
 *   routing       the itinerary pane, opened by its toolbar button
 *   websocket     a connection to a simulated server, one channel subscribed
 *   flatgeobuf    a layer loaded by extent, auto-refreshing on camera moves
 *   cog           a raster layer added on the map
 *   file-import   a GPX file imported as a layer
 *
 * 🖐 IT IS A MEASURE, NOT A GUARD: it prints its readings and asserts nothing about the product.
 * What it showed and what was fixed is guarded by `e2e/75-remount-plugins.spec.js`. A plugin it
 * could not measure is named and makes it exit 1 — a table must not look complete when it is
 * not.
 *
 * ⚠️ RUN THE FOUR-STEP REGENERATION FIRST: it reads whatever nginx serves.
 *
 * Usage:  E2E_TARGET=nginx node scripts/probe-remount-other-plugins.mjs [plugin…]
 *         (no argument: the seven; `routing` runs under both hosts)
 * Exit:   0 = every plugin asked for was measured · 1 = one could not be (named in the output)
 *
 * ⚠️ `E2E_TARGET=nginx` is NOT optional: `baseURL()` defaults to the `ports` target, whose
 * servers this probe must never start.
 */

import fs from "node:fs";
import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL } from "../e2e/helpers/base-url.js";
import { installListenerProbe, livePageListeners } from "../e2e/helpers/listener-probe.js";

const ORIGIN = process.env.GEOLEAF_PROBE_URL || baseURL("full");
const MAP_ID = "geoleaf-map";
const WAIT_MS = 60_000;
/** A socket endpoint that exists nowhere — answered here, never reached. */
const WS_URL = "wss://ws.geoleaf-probe.test/live";
/** A FlatGeobuf file the deployed application serves. */
const FGB_PATH = "/profiles/tourism/layers/eco_regions_fgb/data/eco_regions.fgb";
const COG_BYTES = fs.readFileSync(new URL("../e2e/fixtures/sample-cog.tif", import.meta.url));
const GPX =
    '<?xml version="1.0"?><gpx version="1.1" creator="probe">' +
    '<wpt lat="-32.95" lon="-60.66"><name>p</name></wpt></gpx>';
/** A synthetic itinerary along one parallel. */
const LINE = [
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
    provider: "probe",
    waypoints: [
        { coordinates: LINE[0], name: "Départ" },
        { coordinates: LINE[4], name: "Arrivée" },
    ],
    legs: [{ distance: 400, duration: 40, steps: [] }],
};
/** A 1-pixel image: the basemap tiles are not the subject. */
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
);

/** @type {string[]} */
const unmeasured = [];

/**
 * Counts what a plugin holds outside the DOM — intervals, position watches, wake locks, open
 * sockets —, lets the probe feed positions, and counts `geoleaf:app:ready`. Installed before
 * any page script.
 *
 * @param {import("@playwright/test").Page} page
 */
async function instrument(page) {
    await installListenerProbe(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__probeReady = 0;
        document.addEventListener("geoleaf:app:ready", () => (w.__probeReady += 1));

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
        w.__probeFix = (
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

        const sockets = new Set();
        const NativeSocket = w.WebSocket;
        w.WebSocket = class extends NativeSocket {
            /** @param {any[]} args */
            constructor(...args) {
                super(...args);
                sockets.add(this);
            }
        };

        w.__probeHeld = () => ({
            intervalles: intervals.size,
            "veilles de position": watches.size,
            "verrous d'écran": locks,
            "sockets ouverts": [...sockets].filter((s) => s.readyState <= 1).length,
            "sockets créés": sockets.size,
        });
    });
}

/**
 * Lays the routes a plugin's fixture needs on the context: basemap tiles, the realtime feed of
 * the default theme, the raster file by ranges, the simulated socket server.
 *
 * @param {import("@playwright/test").BrowserContext} context
 */
async function layFixtures(context) {
    await context.route(/arcgisonline|opentopomap|cartocdn|amazonaws/, (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: PNG })
    );
    await context.route("https://earthquake.usgs.gov/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"type":"FeatureCollection","features":[]}',
        })
    );
    await context.route("**/sample-cog.tif*", (route) => {
        const total = COG_BYTES.length;
        const base = {
            "Content-Type": "image/tiff",
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
        };
        const asked = /bytes=(\d+)-(\d*)/.exec(route.request().headers()["range"] ?? "");
        if (!asked) {
            return route.fulfill({
                status: 200,
                headers: { ...base, "Content-Length": String(total) },
                body: COG_BYTES,
            });
        }
        const start = parseInt(asked[1] ?? "0", 10);
        const end = asked[2] ? Math.min(parseInt(asked[2], 10), total - 1) : total - 1;
        const chunk = COG_BYTES.subarray(start, end + 1);
        return route.fulfill({
            status: 206,
            headers: {
                ...base,
                "Content-Range": `bytes ${start}-${end}/${total}`,
                "Content-Length": String(chunk.length),
            },
            body: chunk,
        });
    });
    await context.routeWebSocket(WS_URL, (socket) => {
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
}

/** `GeoLeaf.mount()`, awaited to `ready`. */
async function mount(/** @type {import("@playwright/test").Page} */ page) {
    const outcome = await page.evaluate(async (id) => {
        const w = /** @type {any} */ (window);
        w.__probeHandle = w.GeoLeaf.mount(id);
        return Promise.race([
            w.__probeHandle.ready.then(
                () => "ready",
                (/** @type {any} */ e) => `rejetée : ${e?.reason ?? e?.message ?? e}`
            ),
            new Promise((resolve) => setTimeout(() => resolve("jamais résolue en 45 s"), 45_000)),
        ]);
    }, MAP_ID);
    if (outcome !== "ready") throw new Error(`mount() — ready ${outcome}`);
    await page.waitForTimeout(2500);
}

/** `unmount()` on the kept handle. */
async function unmount(/** @type {import("@playwright/test").Page} */ page) {
    await page.evaluate(() => /** @type {any} */ (window).__probeHandle.unmount());
    await page.waitForTimeout(2000);
}

/** How many elements match, in the page. */
function count(/** @type {import("@playwright/test").Page} */ page, /** @type {string} */ sel) {
    return page.locator(sel).count();
}

/** Clicks a toolbar button through the DOM — whichever toolbar the viewport shows. */
async function clickToolbar(
    /** @type {import("@playwright/test").Page} */ page,
    /** @type {string} */ action
) {
    const clicked = await page.evaluate((a) => {
        const button = /** @type {HTMLElement | null} */ (
            document.querySelector(`[data-gl-toolbar-action="${a}"]`)
        );
        button?.click();
        return button !== null;
    }, action);
    if (!clicked) throw new Error(`aucun bouton de barre « ${action} »`);
    await page.waitForTimeout(900);
}

/**
 * @typedef {object} Subject
 * @property {{ width: number, height: number }} [viewport]
 * @property {(page: import("@playwright/test").Page) => Promise<void>} build
 * @property {(page: import("@playwright/test").Page) => Promise<Record<string, unknown>>} read
 * @property {(page: import("@playwright/test").Page) => Promise<string | void>} [gesture]
 */

/**
 * Requests of the FlatGeobuf file, as they happen.
 *
 * @type {number[]}
 */
const fgbAsked = [];

/** Where the roots of the itinerary pane sit: `<tag>.<class>@<parent>`. */
function routingReading(/** @type {import("@playwright/test").Page} */ page) {
    return page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const roots = /** @type {HTMLElement[]} */ ([
            ...document.querySelectorAll(".gl-routing-panel"),
        ]);
        // Each pane is marked at its first reading: a pane read « déjà vu » after an unmount is
        // the SAME element brought back, not a new one.
        const marks = roots.map((el) => el.dataset["probeMark"] ?? "neuf");
        for (const el of roots) el.dataset["probeMark"] ??= "déjà vu";
        return {
            "volets d'itinéraire": roots.length,
            "où ils sont": roots.map(
                (el) => el.parentElement?.id || el.parentElement?.className || "?"
            ),
            marques: marks,
            "boutons de barre": document.querySelectorAll('[data-gl-toolbar-action="routing"]')
                .length,
            "module au registre": w.GeoLeaf.registry?.has?.("routing") ?? false,
        };
    });
}

/** @type {Subject} */
const ROUTING = {
    build: (page) => clickToolbar(page, "routing"),
    read: routingReading,
    gesture: async (page) => {
        await clickToolbar(page, "routing");
        return "rouvrir le volet";
    },
};

/** @type {Record<string, Subject>} */
const SUBJECTS = {
    navigation: {
        build: async (page) => {
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
                        w.__probeFix(lng, lat, at);
                    }
                },
                { route: ROUTE, line: LINE }
            );
            await page.waitForTimeout(800);
        },
        read: async (page) => ({
            "bandeau de guidage": await count(page, ".gl-nav-banner"),
            "flèche de position": await count(page, ".gl-nav-arrow-marker"),
            "session en cours": await page.evaluate(
                () => /** @type {any} */ (window).GeoLeaf.Navigation?.isGuiding?.() ?? false
            ),
            "module au registre": await page.evaluate(
                () => /** @type {any} */ (window).GeoLeaf.registry?.has?.("navigation") ?? false
            ),
        }),
        gesture: async (page) => {
            await page.evaluate(
                ({ line }) => {
                    let at = 1_700_000_100_000;
                    for (const [lng, lat] of line.slice(2, 4)) {
                        at += 5000;
                        /** @type {any} */ (window).__probeFix(lng, lat, at);
                    }
                },
                { line: LINE }
            );
            await page.waitForTimeout(600);
            return "deux positions de plus";
        },
    },

    "offline-ui": {
        build: async (page) => {
            await clickToolbar(page, "offline-ui");
            await page.locator("#gl-cache-modal").waitFor({ state: "visible", timeout: 8000 });
            // The window keeps rendering after it shows: its listeners are read once it is done.
            await page.waitForTimeout(1500);
        },
        read: async (page) => ({
            "fenêtre hors-ligne": await count(page, "#gl-cache-modal"),
            "boutons de barre": await count(page, '[data-gl-toolbar-action="offline-ui"]'),
        }),
        gesture: async (page) => {
            await clickToolbar(page, "offline-ui");
            await page.waitForTimeout(1500);
            return "rouvrir la fenêtre";
        },
    },

    "routing (feuille mobile)": { ...ROUTING, viewport: { width: 1280, height: 720 } },
    "routing (panneau de bureau)": { ...ROUTING, viewport: { width: 1600, height: 900 } },

    websocket: {
        build: async (page) => {
            await page.evaluate(() =>
                /** @type {any} */ (window).GeoLeaf.plugins.load("websocket")
            );
            await page.waitForFunction(() => !!(/** @type {any} */ (window).GeoLeaf?.Ws), null, {
                timeout: 10_000,
            });
            await page.evaluate(
                (url) =>
                    /** @type {any} */ (window).GeoLeaf.Ws.init({
                        transport: "native-ws",
                        url,
                        reconnect: { initialDelayMs: 50, maxRetries: 5 },
                    }),
                WS_URL
            );
            await page.waitForFunction(
                () => /** @type {any} */ (window).GeoLeaf.Ws.state === "connected",
                null,
                { timeout: 20_000 }
            );
            await page.evaluate(() =>
                /** @type {any} */ (window).GeoLeaf.Ws.subscribe("t", () => {})
            );
        },
        read: (page) =>
            page.evaluate(() => {
                const ws = /** @type {any} */ (window).GeoLeaf.Ws;
                return {
                    état: ws?.state ?? "greffon absent",
                    abonnements: ws?.getSubscriptions?.() ?? [],
                };
            }),
    },

    flatgeobuf: {
        build: async (page) => {
            await page.evaluate(() =>
                /** @type {any} */ (window).GeoLeaf.plugins.load("flatgeobuf")
            );
            await page.waitForFunction(
                () => !!(/** @type {any} */ (window).GeoLeaf?.FlatGeobuf),
                null,
                { timeout: 10_000 }
            );
            // ⚠️ The handle stays on the page, and nothing is returned: handed back to the
            // probe, the promise of this call was « garbage collected » before it settled.
            await page.evaluate(async (path) => {
                const w = /** @type {any} */ (window);
                w.__probeFgb = await w.GeoLeaf.FlatGeobuf.loadBboxAsLayer(
                    location.origin + path,
                    { minX: -73.5, minY: -55, maxX: -53.5, maxY: -21.78 },
                    { layerId: "probe-fgb", autoRefresh: true, debounceMs: 50 }
                );
            }, FGB_PATH);
            await page.waitForTimeout(600);
        },
        read: async (page) => {
            const from = Date.now();
            // A camera move: an auto-refreshing layer asks its file again.
            await page.evaluate(() => {
                try {
                    /** @type {any} */ (window).GeoLeaf.Core.getMap()
                        .getNativeMap()
                        .jumpTo({ center: [-60 + Math.random(), -33], zoom: 6 });
                } catch {
                    /* no map: the application is unmounted */
                }
            });
            await page.waitForTimeout(900);
            return {
                "requêtes du fichier sur un déplacement": fgbAsked.filter((at) => at >= from)
                    .length,
                "source sur la carte": await page.evaluate(() => {
                    try {
                        return !!(
                            /** @type {any} */ (window).GeoLeaf.Core.getMap()
                                .getNativeMap()
                                .getSource("gl-src-probe-fgb")
                        );
                    } catch {
                        return "pas de carte";
                    }
                }),
                "chargeur inscrit": await page.evaluate(
                    () =>
                        typeof (
                            /** @type {any} */ (window).GeoLeaf.plugins.getLayerLoader?.(
                                "flatgeobuf"
                            )
                        ) === "function"
                ),
            };
        },
    },

    cog: {
        build: async (page) => {
            await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("cog"));
            await page.waitForFunction(() => !!(/** @type {any} */ (window).GeoLeaf?.COG), null, {
                timeout: 10_000,
            });
            await page.evaluate(async () => {
                const w = /** @type {any} */ (window);
                const map = w.GeoLeaf.Core.getMap().getNativeMap();
                w.__probeCog = await w.GeoLeaf.COG.addLayer(
                    `${location.origin}/sample-cog.tif`,
                    map
                );
            });
            await page.waitForTimeout(500);
        },
        read: async (page) => ({
            "couche sur la carte": await page.evaluate(() => {
                const w = /** @type {any} */ (window);
                try {
                    const id = w.__probeCog?.id;
                    return id ? !!w.GeoLeaf.Core.getMap().getNativeMap().getLayer(id) : "aucune";
                } catch {
                    return "pas de carte";
                }
            }),
        }),
        gesture: (page) =>
            page.evaluate(async () => {
                const w = /** @type {any} */ (window);
                /** @type {string[]} */
                const said = [];
                try {
                    w.__probeCog.remove();
                    said.push("ancienne poignée retirée sans erreur");
                } catch (e) {
                    said.push(`retrait de l'ancienne poignée : ${String(e).slice(0, 80)}`);
                }
                try {
                    const map = w.GeoLeaf.Core.getMap().getNativeMap();
                    w.__probeCog = await w.GeoLeaf.COG.addLayer(
                        `${location.origin}/sample-cog.tif`,
                        map
                    );
                    said.push("ajout sur la carte neuve sans erreur");
                } catch (e) {
                    said.push(`ajout sur la carte neuve : ${String(e).slice(0, 80)}`);
                }
                return said.join(" ; ");
            }),
    },

    "file-import": {
        build: async (page) => {
            await page.evaluate(() =>
                /** @type {any} */ (window).GeoLeaf.plugins.load("file-import")
            );
            await page.waitForFunction(
                () => !!(/** @type {any} */ (window).GeoLeaf?.FileImport),
                null,
                { timeout: 10_000 }
            );
            await page.evaluate(async (gpx) => {
                const w = /** @type {any} */ (window);
                w.__probeImported = await w.GeoLeaf.FileImport.importAsLayer(
                    new File([gpx], "probe.gpx"),
                    { layerName: "probe-gpx" }
                );
            }, GPX);
            await page.waitForTimeout(500);
        },
        read: async (page) => ({
            // The import goes to the map through the adapter, not to the layer store: its
            // source is what tells it is there.
            "source de l'import sur la carte": await page.evaluate(() => {
                const w = /** @type {any} */ (window);
                if (!w.__probeImported) return "aucun import";
                try {
                    return !!w.GeoLeaf.Core.getMap()
                        .getNativeMap()
                        .getSource(`gl-src-${w.__probeImported}`);
                } catch {
                    return "pas de carte";
                }
            }),
        }),
        gesture: (page) =>
            page.evaluate(async (gpx) => {
                const w = /** @type {any} */ (window);
                try {
                    const id = await w.GeoLeaf.FileImport.importAsLayer(
                        new File([gpx], "probe-2.gpx"),
                        { layerName: "probe-gpx-2" }
                    );
                    w.__probeImported = id;
                    return `nouvel import sur la carte neuve : ${id}`;
                } catch (e) {
                    return `nouvel import sur la carte neuve : ${String(e).slice(0, 80)}`;
                }
            }, GPX),
    },
};

/**
 * Prints the readings side by side — the lines that MOVE from one reading to the next, then, on
 * one line, those that never did.
 */
function printTable(/** @type {Record<string, Record<string, unknown>>} */ columns) {
    const names = Object.keys(columns);
    const rows = Object.keys(columns[names[0] ?? ""] ?? {});
    /** @type {string[]} */
    const still = [];
    for (const row of rows) {
        const cells = names.map((n) => JSON.stringify(columns[n]?.[row]));
        if (new Set(cells).size === 1) {
            still.push(`${row} (${cells[0]})`);
            continue;
        }
        console.log(`  ≠ ${row}`);
        names.forEach((n, i) => console.log(`        ${n.padEnd(22)} ${cells[i]}`));
    }
    console.log(`  inchangé d'une lecture à l'autre : ${still.join(" · ") || "rien"}`);
}

/**
 * One plugin, on its own page: built, unmounted, mounted again.
 *
 * @param {import("@playwright/test").Browser} browser
 * @param {Subject} subject
 */
async function measure(browser, subject) {
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        // A request the service worker serves is seen by no route of the page.
        serviceWorkers: "block",
        viewport: subject.viewport ?? { width: 1280, height: 720 },
    });
    try {
        await layFixtures(context);
        const page = await context.newPage();
        /** @type {string[]} */
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e).split("\n")[0] ?? ""));
        page.on("request", (request) => {
            if (request.url().includes(".fgb")) fgbAsked.push(Date.now());
        });
        await instrument(page);
        await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => /** @type {any} */ (window).__probeReady >= 1, null, {
            timeout: WAIT_MS,
        });
        await mount(page);

        const reading = async () => ({
            ...(await subject.read(page)),
            ...(await page.evaluate(() => /** @type {any} */ (window).__probeHeld())),
            "écouteurs de la page": await livePageListeners(page),
        });
        /** @type {Record<string, Record<string, unknown>>} */
        const columns = {};
        columns["avant de construire"] = await reading();
        await subject.build(page);
        columns["construit"] = await reading();
        await unmount(page);
        columns["après unmount()"] = await reading();
        await mount(page);
        columns["après mount()"] = await reading();
        if (subject.gesture) {
            const said = await subject.gesture(page);
            columns["puis un geste"] = await reading();
            console.log(`  geste sur la carte neuve : ${said ?? ""}`);
        }
        printTable(columns);
        console.log(`  erreurs de page : ${errors.length ? errors.slice(0, 4).join(" | ") : 0}`);
    } finally {
        await context.close();
    }
}

const asked = process.argv.slice(2);
const names = Object.keys(SUBJECTS).filter(
    (name) => asked.length === 0 || asked.some((a) => name === a || name.startsWith(`${a} (`))
);
if (names.length === 0) {
    console.error(`Aucun greffon de ce nom. Connus : ${Object.keys(SUBJECTS).join(", ")}`);
    process.exit(1);
}

console.log(`Cible : ${ORIGIN}`);
const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
try {
    for (const name of names) {
        console.log(`\n── ${name} ──`);
        const subject = SUBJECTS[name];
        if (!subject) continue;
        try {
            await measure(browser, subject);
        } catch (e) {
            const reason = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
            unmeasured.push(`${name} : ${reason}`);
            console.log(`  ✗ NON MESURÉ : ${reason}`);
        }
    }
} finally {
    await browser.close();
}

if (unmeasured.length > 0) {
    console.log(`\n✗ ${unmeasured.length} greffon(s) non mesuré(s) :`);
    for (const line of unmeasured) console.log(`  - ${line}`);
    process.exit(1);
}
console.log(`\n✓ ${names.length} lecture(s) faite(s).`);
