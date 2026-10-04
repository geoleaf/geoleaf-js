#!/usr/bin/env node
/**
 * PROBE — what four plugins leave behind an `unmount()`, and whether they come back at the next
 * `mount()`: `connector`, `table`, `editor`, `position-share`. Measured in a real Chromium against
 * `deploy-full`, the only variant that ships all four.
 *
 * WHY IT EXISTS. `GeoLeaf.mount()` takes the application down by destroying the core's module
 * registry, and brings it back by a new boot. `e2e/71-mount-remount.spec.js` proves that for the
 * core, on `deploy-core`, and for the two plugins that variant loads at boot. These four were
 * left unmeasured: three of them are LAZY — a page that merely boots holds nothing of them — so
 * the same spec pointed at `deploy-full` is green and says nothing about them.
 *
 * WHAT IT MEASURES, in three runs:
 *   A. as shipped — the plugins brought to their BUILT state on a mounted application (the
 *      credential button, the table panel open, the editor armed, position-share loaded, a
 *      measure started, the print area selector open), then three readings: built, after
 *      `unmount()`, after the next `mount()`. Each reading counts the plugins' DOM, the toolbar
 *      buttons, the drawing layers, the live listeners, timers and mutation observers. Then what
 *      each plugin still DOES on the new map.
 *   B. activated — what the shipped profile does not turn on: a configured connector (is
 *      `window.fetch` given back? does the NEW map get the request hook?) and position-share
 *      EMITTING (do positions still leave after the application is gone?) — read twice, with
 *      the geolocation seam the probe poses, then with the application's own.
 *   C. loaded late — `geocoding`, which the shipped application always preloads at boot: its
 *      preload is emptied, and the bundle is evaluated once the application runs, as a host
 *      loading it on demand would. Is its control taken down by `unmount()`?
 *
 * 🖐 IT IS A MEASURE, NOT A GUARD: it prints its readings and asserts nothing about the product.
 * A part it could not measure is named and makes it exit 1 — a table must not look complete
 * when it is not.
 *
 * ⚠️ RUN THE FOUR-STEP REGENERATION FIRST: it reads whatever nginx serves.
 *
 * Usage:  E2E_TARGET=nginx node scripts/probe-remount-plugins.mjs
 * Exit:   0 = the three runs were measured · 1 = a part could not be measured (named in the
 *         output)
 *
 * ⚠️ `E2E_TARGET=nginx` is NOT optional: `baseURL()` defaults to the `ports` target, whose
 * servers this probe must never start.
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL } from "../e2e/helpers/base-url.js";
import { installListenerProbe } from "../e2e/helpers/listener-probe.js";

const ORIGIN = process.env.GEOLEAF_PROBE_URL || baseURL("full");
const MAP_ID = "geoleaf-map";
const WAIT_MS = 60_000;
/** Where the emitting position-share posts — intercepted here, never reached. */
const SHARE_ENDPOINT = "https://positions.geoleaf-probe.test/positions";
/** A connector base that collides with none of the application's own requests. */
const CONNECTOR_BASE = "https://api.geoleaf-probe.test";
const HERE = { latitude: -32.95, longitude: -60.65 };

/** @type {string[]} */
const unmeasured = [];

/**
 * Counts what the listener probe cannot see — live intervals and mutation observers — keeps the
 * page's first `fetch`, and counts `geoleaf:app:ready`.
 *
 * @param {import("@playwright/test").Page} page
 */
async function instrument(page) {
    await installListenerProbe(page);
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
                // ⚠️ Only an observer created by a script of the PAGE counts. Playwright's own
                // injected script keeps one on `document` for the life of the page: counted, it
                // read as an observer the product never gave back — one alive before any plugin
                // was loaded, and still alive once the application was unmounted.
                if (String(new Error().stack).includes(location.origin)) observers.add(this);
                return super.observe(...args);
            }
            disconnect() {
                observers.delete(this);
                return super.disconnect();
            }
        };
        w.__probeCounts = () => ({ intervals: intervals.size, observers: observers.size });
        w.__probeFetch = w.fetch;
        w.__probeReady = 0;
        document.addEventListener("geoleaf:app:ready", () => {
            w.__probeReady += 1;
        });
    });
}

/**
 * One reading of the page: what the four plugins, and the witness, hold right now.
 *
 * @param {import("@playwright/test").Page} page
 */
function reading(page) {
    return page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const G = w.GeoLeaf;
        const count = (/** @type {string} */ sel) => document.querySelectorAll(sel).length;
        const values = (/** @type {string} */ attr) =>
            [...document.querySelectorAll(`[${attr}]`)].map((e) => e.getAttribute(attr)).sort();
        /** @type {string[]} */
        let layers = [];
        try {
            layers = G.Core.getMap()
                .getNativeMap()
                .getStyle()
                .layers.map((/** @type {any} */ l) => l.id);
        } catch {
            /* no map: the application is unmounted */
        }
        const counts = w.__probeCounts();
        /** The request hook a configured connector puts on the engine map. */
        let hook = "pas de carte";
        try {
            const native = G.Core.getMap().getNativeMap();
            hook = String(typeof native._requestManager._transformRequestFn === "function");
        } catch {
            /* no map: the application is unmounted */
        }
        const panel = document.querySelector(".gl-table-panel");
        const shown = (/** @type {string} */ sel) =>
            [...document.querySelectorAll(sel)].filter(
                (e) => getComputedStyle(e).display !== "none"
            ).length;
        return {
            "cartes vivantes": (() => {
                try {
                    return G.Core.listMaps().length;
                } catch {
                    return -1;
                }
            })(),
            "connector · bouton d'identification": count(".gc-credential-btn"),
            "connector · séparateur": count(".gc-credential-separator"),
            "table · panneau dans le document": count(".gl-table-panel"),
            "table · classe gl-table-open sur body":
                document.body.classList.contains("gl-table-open"),
            // `offsetParent` is null for a `position: fixed` element whatever it shows: the
            // panel is read by the class that slides it in.
            "table · panneau visible (gl-is-visible)": panel
                ? panel.classList.contains("gl-is-visible")
                : "pas de panneau",
            "editor · racine du menu": count(".gl-editor-root"),
            "editor · racine dans la carte courante": count(`#geoleaf-map .gl-editor-root`),
            "editor · couches de dessin (td-*)": layers.filter((id) => id.startsWith("td-")).length,
            "position-share · badge": count(".gl-position-share-badge"),
            "measure · couches (gl-measure-*)": layers.filter((id) => id.startsWith("gl-measure-"))
                .length,
            "measure · racine du menu": count(".gl-measure-root"),
            "print · sélecteurs d'emprise": count(".gl-emprise-overlay"),
            "print · sélecteurs d'emprise affichés": shown(".gl-emprise-overlay"),
            "geocoding · contrôle": count(".gl-geocoding-ctrl"),
            "connector · crochet de requête sur la carte courante": hook,
            "boutons · actions de barre": values("data-gl-toolbar-action").join(" "),
            "boutons · feuilles mobiles": values("data-gl-sheet").join(" "),
            "boutons · onglets de bureau": values("data-gl-desktop-tab").join(" "),
            "window.fetch remplacé": w.fetch !== w.__probeFetch,
            "intervalles vivants": counts.intervals,
            "observateurs de mutation vivants": counts.observers,
            "écouteurs DOM vivants": w.__glLiveListeners,
        };
    });
}

/** Prints the readings side by side, marking every line that is not the same across them. */
function printTable(/** @type {Record<string, Record<string, unknown>>} */ columns) {
    const names = Object.keys(columns);
    const rows = Object.keys(columns[names[0] ?? ""] ?? {});
    for (const row of rows) {
        const cells = names.map((n) => String(columns[n]?.[row]));
        const moved = new Set(cells).size > 1 ? "≠" : " ";
        console.log(`  ${moved} ${row}`);
        names.forEach((n, i) => console.log(`        ${n.padEnd(22)} ${cells[i]}`));
    }
}

/**
 * Opens the page, waits for the application `init.js` booted, and takes it over with a
 * `mount()` — the handle stays on `window.__probeHandle`.
 *
 * @param {import("@playwright/test").BrowserContext} context
 */
async function mountedPage(context) {
    const page = await context.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).split("\n")[0] ?? ""));
    await instrument(page);
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /** @type {any} */ (window).__probeReady >= 1, null, {
        timeout: WAIT_MS,
    });
    await settle(page);
    // ⚠️ Read BEFORE the takeover: a plugin the page preloads at boot is built by `boot()`, and
    // the `mount()` below is already a teardown and a remount for it.
    const booted = await reading(page);
    await mount(page);
    return { page, errors, booted };
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
    await settle(page);
}

/** `unmount()` on the kept handle. */
async function unmount(/** @type {import("@playwright/test").Page} */ page) {
    await page.evaluate(() => /** @type {any} */ (window).__probeHandle.unmount());
    await page.waitForTimeout(1500);
}

/** Lets the layers that keep loading after `app:ready` land: two equal readings, 500 ms apart. */
async function settle(/** @type {import("@playwright/test").Page} */ page) {
    let previous = "";
    for (let i = 0; i < 40; i++) {
        const current = JSON.stringify(await reading(page));
        if (current === previous) return;
        previous = current;
        await page.waitForTimeout(500);
    }
}

/**
 * Runs one named step; a failure is recorded and printed, never swallowed.
 *
 * @param {string} name
 * @param {() => Promise<unknown>} step
 */
async function attempt(name, step) {
    try {
        const said = await step();
        console.log(`  · ${name}${said === undefined ? "" : ` — ${said}`}`);
        return true;
    } catch (e) {
        const reason = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
        unmeasured.push(`${name} : ${reason}`);
        console.log(`  ✗ ${name} — NON MESURÉ : ${reason}`);
        return false;
    }
}

/** Brings the four plugins, and the witness, to their built state. */
async function buildAsShipped(/** @type {import("@playwright/test").Page} */ page) {
    const load = (/** @type {string} */ name) =>
        page.evaluate((n) => /** @type {any} */ (window).GeoLeaf.plugins.load(n), name);
    await attempt("table : chargé, panneau ouvert", async () => {
        await load("table");
        // The panel is built by the toolbar ACTION — `Table.open()` alone toggles a panel that
        // does not exist yet.
        await page.evaluate(() =>
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "table" } })
            )
        );
        await page
            .locator(".gl-table-panel")
            .first()
            .waitFor({ state: "attached", timeout: 15_000 });
    });
    await attempt("editor : chargé, menu ouvert, outil armé", async () => {
        await load("editor");
        await page.waitForFunction(
            () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
            null,
            { timeout: 20_000 }
        );
        const tool = page.locator('button.gl-editor-tool-btn[data-tool="select"]');
        for (let i = 0; i < 3 && !(await tool.isVisible()); i++) {
            await page.evaluate(() => {
                const w = /** @type {any} */ (window);
                w.GeoLeaf.Editor.toggleMenu();
            });
            await page.waitForTimeout(300);
        }
        await tool.click();
        await page.waitForFunction(
            () => {
                try {
                    const w = /** @type {any} */ (window);
                    return !!w.GeoLeaf.Core.getMap().getNativeMap().getLayer("td-point");
                } catch {
                    return false;
                }
            },
            null,
            { timeout: 30_000 }
        );
    });
    await attempt("position-share : chargé (livré désactivé)", () => load("position-share"));
    await attempt("measure (témoin, hors des quatre) : chargé, une mesure commencée", async () => {
        await load("measure");
        await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Measure.startMeasure("distance")
        );
    });
    await attempt("print : chargé, sélecteur d'emprise ouvert", async () => {
        await load("print");
        await page.evaluate(() =>
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "print" } })
            )
        );
        await page
            .locator(".gl-emprise-overlay")
            .first()
            .waitFor({ state: "attached", timeout: 15_000 });
    });
    await settle(page);
}

/** What the plugins still DO after the remount — asked of each, on the new map. */
async function functionAfterRemount(/** @type {import("@playwright/test").Page} */ page) {
    await attempt("table : l'action de barre après remontage", () =>
        page.evaluate(() => {
            const w = /** @type {any} */ (window);
            // ⚠️ The action TOGGLES: what it leaves is read against what it found, never alone.
            const state = () => {
                const panel = document.querySelector(".gl-table-panel");
                return (
                    `isOpen()=${w.GeoLeaf.Table.isOpen()}, ` +
                    `panneaux=${document.querySelectorAll(".gl-table-panel").length}, ` +
                    `visible=${panel ? panel.classList.contains("gl-is-visible") : "—"}`
                );
            };
            const before = state();
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "table" } })
            );
            const once = state();
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "table" } })
            );
            return `avant [${before}] ; après une action [${once}] ; après deux [${state()}]`;
        })
    );
    await attempt("measure : commencer une mesure après remontage", async () => {
        await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "measure" } })
            );
            w.GeoLeaf.Measure.startMeasure("distance");
        });
        await page.waitForTimeout(1000);
        return page.evaluate(() => {
            const w = /** @type {any} */ (window);
            const native = w.GeoLeaf.Core.getMap().getNativeMap();
            const layers = native
                .getStyle()
                .layers.filter((/** @type {any} */ l) => l.id.startsWith("gl-measure-")).length;
            const inMap = native.getContainer().querySelectorAll(".gl-measure-root").length;
            return (
                `couches gl-measure-* sur la NOUVELLE carte : ${layers} ; racine du menu dans ` +
                `le conteneur de la carte : ${inMap}`
            );
        });
    });
    await attempt("print : ouvrir le flux après remontage", async () => {
        const before = await page.evaluate(
            () =>
                [...document.querySelectorAll(".gl-emprise-overlay")].filter(
                    (e) => getComputedStyle(e).display !== "none"
                ).length
        );
        await page.evaluate(() =>
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "print" } })
            )
        );
        await page.waitForTimeout(1000);
        const after = await page.evaluate(
            () =>
                [...document.querySelectorAll(".gl-emprise-overlay")].filter(
                    (e) => getComputedStyle(e).display !== "none"
                ).length
        );
        return `sélecteurs d'emprise affichés ${before} → ${after}`;
    });
    await attempt("editor : armer un outil après remontage", async () => {
        const tool = page.locator('button.gl-editor-tool-btn[data-tool="select"]');
        for (let i = 0; i < 3 && !(await tool.isVisible()); i++) {
            await page.evaluate(() => {
                const w = /** @type {any} */ (window);
                w.GeoLeaf.Editor.toggleMenu();
            });
            await page.waitForTimeout(300);
        }
        const visible = await tool.isVisible();
        if (visible) await tool.click();
        const armed = await page
            .waitForFunction(
                () => {
                    try {
                        const w = /** @type {any} */ (window);
                        return !!w.GeoLeaf.Core.getMap().getNativeMap().getLayer("td-point");
                    } catch {
                        return false;
                    }
                },
                null,
                { timeout: 8000 }
            )
            .then(
                () => true,
                () => false
            );
        return (
            `outil ${visible ? "atteignable" : "INATTEIGNABLE"} ; ` +
            `couche de dessin sur la NOUVELLE carte : ${armed ? "oui" : "NON, en 8 s"}`
        );
    });
}

const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
try {
    // ── A — as shipped ───────────────────────────────────────────────────────────────────────
    console.log("── A. tel que livré : profil `tourism`, quatre greffons construits ──");
    {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const { page, errors, booted } = await mountedPage(context);
        const mounted = await reading(page);
        await buildAsShipped(page);
        const built = await reading(page);
        await unmount(page);
        const gone = await reading(page);
        await attempt("mount() après le démontage", () => mount(page));
        const back = await reading(page);
        console.log("\n  Lectures (≠ = la ligne change d'une lecture à l'autre) :");
        printTable({
            "démarré par boot()": booted,
            "repris par mount()": mounted,
            "greffons construits": built,
            "après unmount()": gone,
            "après mount()": back,
        });
        console.log("\n  Fonction, après le remontage :");
        await functionAfterRemount(page);
        console.log(`\n  Erreurs de page pendant le parcours : ${errors.length}`);
        for (const e of errors.slice(0, 6)) console.log(`    ${e.slice(0, 200)}`);
        await context.close();
    }

    // ── B — activated ────────────────────────────────────────────────────────────────────────
    console.log("\n── B. états activés ──");
    {
        const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            permissions: ["geolocation"],
            geolocation: HERE,
        });
        let posts = 0;
        await context.route(`${SHARE_ENDPOINT}**`, (route) => {
            posts += 1;
            return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        });
        await context.route(`${CONNECTOR_BASE}/**`, (route) =>
            route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
        );
        const { page } = await mountedPage(context);
        /** POSTs seen during the next `ms`. */
        const postsDuring = async (/** @type {number} */ ms) => {
            const start = posts;
            await page.waitForTimeout(ms);
            return posts - start;
        };

        const emitting = await attempt("position-share : émission HTTP démarrée", async () => {
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
                    // The seam the emitter reads, made deterministic — as `probe-position-share`.
                    const geo = gl.Geolocation;
                    /** @type {any} */ (window).__probeGeolocation = geo;
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
            const sent = await postsDuring(3000);
            if (sent === 0) throw new Error("aucune position n'est partie en 3 s : rien à mesurer");
            return `${sent} position(s) en 3 s`;
        });
        const configured = await attempt("connector : configure() appelé", async () => {
            const replaced = await page.evaluate(
                async ({ base }) => {
                    const w = /** @type {any} */ (window);
                    await w.GeoLeaf.plugins.load("connector");
                    // Not awaited: with no stored session it waits on a login nobody gives.
                    void Promise.resolve(
                        w.GeoLeaf.Connector.configure({
                            baseUrl: base,
                            auth: { endpoint: `${base}/login`, ui: false },
                        })
                    ).catch(() => {});
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                    return w.fetch !== w.__probeFetch;
                },
                { base: CONNECTOR_BASE }
            );
            if (!replaced)
                throw new Error("configure() n'a pas remplacé window.fetch : rien à mesurer");
            return "window.fetch est remplacé";
        });

        const active = await reading(page);
        await unmount(page);
        const gone = await reading(page);
        const afterUnmount = emitting ? await postsDuring(4000) : -1;
        // ⚠️ The seam above answers « active » for ever: it measures the LOOP, not what leaves an
        // application whose geolocation was torn down with it. Read again on the real seam.
        await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            if (w.__probeGeolocation) w.GeoLeaf.Geolocation = w.__probeGeolocation;
        });
        const afterUnmountReal = emitting ? await postsDuring(4000) : -1;
        const stillEmitting = await page.evaluate(() => {
            try {
                return /** @type {any} */ (window).GeoLeaf.PositionShare.isEmitting();
            } catch (e) {
                return `lecture impossible : ${e}`;
            }
        });
        await attempt("mount() après le démontage", () => mount(page));
        const back = await reading(page);
        const afterRemount = emitting ? await postsDuring(4000) : -1;

        console.log("\n  Lectures :");
        printTable({ "états activés": active, "après unmount()": gone, "après mount()": back });
        if (emitting) {
            console.log(
                `\n  position-share · positions parties dans les 4 s APRÈS unmount() : ${afterUnmount}`
            );
            console.log(
                "  position-share · positions parties dans les 4 s suivantes, la couture de " +
                    `géolocalisation de l'application remise : ${afterUnmountReal}`
            );
            console.log(`  position-share · isEmitting() application démontée : ${stillEmitting}`);
            console.log(
                `  position-share · positions parties dans les 4 s après le remontage : ${afterRemount}` +
                    " — ⚠️ NON INTERPRÉTABLE : le remontage remet à zéro la configuration et la" +
                    " couture de géolocalisation que cette sonde pose pour faire émettre."
            );
        }
        if (configured) {
            console.log(
                `  connector · window.fetch remplacé — configuré : ${active["window.fetch remplacé"]}, ` +
                    `démonté : ${gone["window.fetch remplacé"]}, remonté : ${back["window.fetch remplacé"]}`
            );
            const hookKey = "connector · crochet de requête sur la carte courante";
            console.log(
                `  connector · crochet de requête — configuré : ${active[hookKey]}, ` +
                    `remonté (nouvelle carte) : ${back[hookKey]}`
            );
        }
        await context.close();
    }

    // ── C — geocoding, loaded late ───────────────────────────────────────────────────────────
    console.log("\n── C. `geocoding` chargé après le boot ──");
    {
        // The service worker is blocked: a request it serves is not seen by the route below.
        const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            serviceWorkers: "block",
        });
        // The application preloads the plugin at boot whenever its profile enables it — the
        // late path does not exist as shipped. Its preload gets an EMPTY module, and the real
        // bundle is evaluated below under another URL: a module is cached by its URL.
        let emptied = 0;
        await context.route(/\/dist\/geoleaf-geocoding\.plugin\.js$/, (route) => {
            emptied += 1;
            return route.fulfill({
                status: 200,
                contentType: "text/javascript",
                body: "export {};",
            });
        });
        const { page, booted } = await mountedPage(context);
        const key = "geocoding · contrôle";
        const late = await attempt("geocoding : évalué une fois l'application montée", async () => {
            if (emptied === 0) throw new Error("le préchargement n'a pas été intercepté");
            const before = await page.evaluate(
                () => typeof (/** @type {any} */ (window).GeoLeaf.Geocoding)
            );
            if (before !== "undefined")
                throw new Error("le greffon est déjà chargé : le chemin tardif n'est pas mesuré");
            // Nothing is returned: a module namespace does not cross the evaluation boundary.
            await page.evaluate(async (url) => {
                await import(url);
            }, `${ORIGIN}/dist/geoleaf-geocoding.plugin.js?late`);
            await page
                .locator(".gl-geocoding-ctrl")
                .first()
                .waitFor({ state: "attached", timeout: 15_000 });
            return `${emptied} préchargement(s) vidé(s)`;
        });
        if (late) {
            const built = await reading(page);
            await unmount(page);
            const gone = await reading(page);
            await attempt("mount() après le démontage", () => mount(page));
            const back = await reading(page);
            console.log(
                `  geocoding · contrôle — démarré par boot() : ${booted[key]}, chargé tard : ` +
                    `${built[key]}, après unmount() : ${gone[key]}, après mount() : ${back[key]}`
            );
            console.log(
                "  geocoding · module inscrit au registre : " +
                    (await page.evaluate(() =>
                        /** @type {any} */ (window).GeoLeaf.registry.has("geocoding")
                    ))
            );
        }
        await context.close();
    }
} finally {
    await browser.close();
}

if (unmeasured.length > 0) {
    console.log(`\n✗ ${unmeasured.length} part(s) non mesurée(s) :`);
    for (const line of unmeasured) console.log(`  - ${line}`);
    process.exit(1);
}
console.log("\n✓ Les trois parcours sont mesurés.");
