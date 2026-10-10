// @ts-check
/**
 * 79 — A NEW SERVICE WORKER WAITS FOR THE USER, AND THE PAGE SAYS SO
 *
 * 🛑 THE DEFECT. `sw-core.js` called `skipWaiting()` at every install, unconditionally: a worker
 * shipped by a new deployment took the page over as soon as it was downloaded — purging the
 * caches of the version the page was running on, under a user in the middle of a capture. The
 * worker knew how to receive `SKIP_WAITING`, and nothing in the application ever sent it: there
 * was no moment at which anybody consented to anything.
 *
 * WHAT IS GUARDED, on the deployed bundle, through TWO SUCCESSIVE VERSIONS of the worker:
 *
 *   · the FIRST install still takes control at once — a page with no worker has nothing to
 *     protect, and waiting there would leave its first visit without offline support;
 *   · an UPDATE waits: the new worker stays `waiting`, the page keeps the worker it booted with;
 *   · the page is told — `geoleaf:sw:update-waiting`, `GeoLeaf.PWA.isUpdateWaiting()` — and the
 *     offline plugin shows a banner;
 *   · the gesture — the banner's button, i.e. `GeoLeaf.PWA.applyUpdate()` — activates the new
 *     worker and reloads the page ONCE, even in a browser that changes the controller again
 *     while the page is leaving.
 *
 * ⚠️ THE PREVIOUS VERSION IS THE SAME SCRIPT UNDER ANOTHER URL. The first visit registers
 * `sw-core.js?previous`; the next one registers `sw-core.js`, as the application does. A worker
 * whose URL changes is a new worker for the browser, whatever its bytes: the second visit finds
 * an update the way a visit after a deployment does, and which worker holds the page reads in
 * its `scriptURL`. Nothing is intercepted, nothing is rewritten.
 *
 * 🛑 PLAYWRIGHT DOES NOT INSTRUMENT THE WORKERS' NETWORK IN THIS SPEC, and the switch below is
 * not a convenience. With it — the suite's default, which is what lets a `context.route` see a
 * worker's requests — this browser stops behaving like a browser once a worker has been
 * UPDATED: navigations install one more byte-identical worker, which takes the page at once.
 * It is what DevTools' « Update on reload » does, and nothing here asks for it. Measured on the
 * first test, six runs each way: four failures with the instrumentation — the page judged
 * after the reload was a page whose worker had just changed AGAIN — none without. A first
 * instrument, which served the previous version through a route rewriting the worker's cache
 * version, made it systematic. No user's browser is instrumented; the spec judges the
 * product in a browser that is not either.
 *
 * ⚠️ And a route could not have served the NEW version anyway: Chromium checks a worker for an
 * update from the browser process, and that request belongs to no page and no worker.
 *
 * 🛑 WHICH LEAVES THE BASEMAP TO THE NETWORK, SO THE NETWORK IS CLOSED. Without that
 * instrumentation no route sees what a worker requests: `serveBasemapTilesLocally` cannot answer
 * the tiles the worker fetches, and they went to the third-party server. A browser activates a
 * worker that skipped the wait only once the worker it replaces has NO request in flight:
 * measured, the gesture then did nothing for more than thirty seconds — the old worker was
 * waiting for tiles. This file's browser therefore resolves no host but the application's:
 * a third-party request fails at once, in the page and in the worker alike.
 *
 * What that accident showed is kept, on purpose, as the third test: « Update on reload » set
 * EXPLICITLY, the hostile case in which a second change of controller reaches a page that is
 * already reloading.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL, hostResolverArgs } from "./helpers/base-url.js";
import { launchOptions } from "./helpers/launch-options.js";

/** The flag that carries the suite's own host rules, when the target has any. */
const RESOLVER_FLAG = "--host-resolver-rules=";

/**
 * The suite's launch arguments, with every host but the application's made unresolvable.
 *
 * ⚠️ ONE flag: Chromium honours a single `--host-resolver-rules`, so the suite's rules — the
 * vhosts of the `nginx` target — are kept in front of the refusal, and the first rule that
 * matches wins. `EXCLUDE` exempts the `ports` target's hosts from every rule.
 *
 * @returns {string[]}
 */
function argsWithoutThirdParties() {
    const suite = [...(launchOptions.args ?? []), ...hostResolverArgs];
    const own = suite
        .filter((arg) => arg.startsWith(RESOLVER_FLAG))
        .map((arg) => arg.slice(RESOLVER_FLAG.length));
    const rules = [...own, "MAP * ~NOTFOUND", "EXCLUDE localhost", "EXCLUDE 127.0.0.1"];
    return [
        ...suite.filter((arg) => !arg.startsWith(RESOLVER_FLAG)),
        RESOLVER_FLAG + rules.join(", "),
    ];
}

// `launchOptions` is a worker-scoped option: this file gets a browser of its own.
test.use({
    baseURL: baseURL("full"),
    launchOptions: { ...launchOptions, args: argsWithoutThirdParties() },
});

/**
 * Playwright reads this when it attaches to a service worker, in this very process: set for
 * this file's tests, and put back as it was — see the header.
 */
const WORKER_NETWORK_SWITCH = "PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK";
/** @type {string | undefined} */
let switchBefore;

test.beforeAll(() => {
    switchBefore = process.env[WORKER_NETWORK_SWITCH];
    process.env[WORKER_NETWORK_SWITCH] = "1";
});

test.afterAll(() => {
    if (switchBefore === undefined) delete process.env[WORKER_NETWORK_SWITCH];
    else process.env[WORKER_NETWORK_SWITCH] = switchBefore;
});

/** What marks the previous version, in its worker's URL. */
const PREVIOUS = "?previous";

/**
 * Makes the FIRST document of the tab register the worker under the previous version's URL,
 * and installs the witnesses every document carries: the two worker events, counted, and the
 * number of documents this tab loaded.
 *
 * @param {import("@playwright/test").Page} page
 */
async function installWitnesses(page) {
    await page.addInitScript((previous) => {
        const w = /** @type {any} */ (window);
        w.__glSw = { waiting: 0, updated: 0 };
        document.addEventListener("geoleaf:sw:update-waiting", () => (w.__glSw.waiting += 1));
        document.addEventListener("geoleaf:sw:updated", () => (w.__glSw.updated += 1));
        const loads = Number(sessionStorage.getItem("e2e79-loads") ?? "0") + 1;
        sessionStorage.setItem("e2e79-loads", String(loads));
        if (loads > 1) return;
        const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register = (url, options) =>
            register(String(url) + previous, options);
    }, PREVIOUS);
}

/**
 * The worker side of the page, read from the page.
 *
 * @param {import("@playwright/test").Page} page
 */
function workers(page) {
    return page.evaluate(async (previous) => {
        const w = /** @type {any} */ (window);
        const registration = await navigator.serviceWorker.getRegistration();
        const controller = navigator.serviceWorker.controller;
        return {
            // Which version holds the page: none, the previous one, or the deployed one.
            heldBy: !controller
                ? "none"
                : controller.scriptURL.endsWith(previous)
                  ? "previous"
                  : "deployed",
            waiting: !!registration?.waiting,
            announced: w.__glSw.waiting,
            apiSaysWaiting: w.GeoLeaf?.PWA?.isUpdateWaiting?.() ?? null,
            loads: Number(sessionStorage.getItem("e2e79-loads")),
        };
    }, PREVIOUS);
}

/**
 * The first visit installs the previous version; the next one finds the deployed one.
 *
 * @param {import("@playwright/test").Page} page
 */
async function visitThenFindUpdate(page) {
    await installWitnesses(page);

    // --- first install: control at once ---------------------------------------------------------
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await expect
        .poll(async () => (await workers(page)).heldBy, {
            timeout: 30000,
            message: "la première installation ne prend plus le contrôle de la page",
        })
        .toBe("previous");
    expect(await workers(page)).toMatchObject({ waiting: false, announced: 0, loads: 1 });

    // --- the next visit registers the worker the application names: an update ------------------
    await page.reload();
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
}

/**
 * Sets DevTools' « Update on reload » for this browser — see the header.
 *
 * @param {import("@playwright/test").Page} page
 */
async function forceUpdateOnReload(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.setForceUpdateOnPageLoad", { forceUpdateOnPageLoad: true });
}

test("[pwa] un service worker neuf attend, la page le dit, et le geste l'applique", async ({
    page,
}) => {
    test.setTimeout(150000);
    await visitThenFindUpdate(page);

    // --- the new version is installed, and WAITS -----------------------------------------------
    await expect
        .poll(
            async () => {
                const now = await workers(page);
                return { waiting: now.waiting, heldBy: now.heldBy };
            },
            {
                timeout: 30000,
                message: "le worker neuf n'attend pas : il a pris la page de la version en cours",
            }
        )
        .toEqual({ waiting: true, heldBy: "previous" });

    // --- the page is told ----------------------------------------------------------------------
    await expect
        .poll(
            async () => {
                const now = await workers(page);
                return { announced: now.announced, apiSaysWaiting: now.apiSaysWaiting };
            },
            { timeout: 15000, message: "la page n'annonce pas la mise à jour en attente" }
        )
        .toEqual({ announced: 1, apiSaysWaiting: true });
    const banner = page.locator("#gl-sw-update-banner");
    await expect(banner, "le bandeau de mise à jour n'est pas affiché").toBeVisible({
        timeout: 15000,
    });
    // It stays that way: nothing takes the page while nobody answers, nothing reloads it, and
    // the announcement is not repeated.
    await page.waitForTimeout(3000);
    expect(await workers(page)).toEqual({
        heldBy: "previous",
        waiting: true,
        announced: 1,
        apiSaysWaiting: true,
        loads: 2,
    });

    // --- the gesture: the new worker takes over, and the page reloads ONCE ---------------------
    await banner.locator('[data-gl-action="sw-update-apply"]').click();
    await expect
        .poll(async () => (await workers(page).catch(() => null))?.loads ?? 0, {
            timeout: 30000,
            message: "la page ne s'est pas rechargée après le geste",
        })
        .toBe(3);
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await expect
        .poll(
            async () => {
                const now = await workers(page);
                return { heldBy: now.heldBy, waiting: now.waiting };
            },
            { timeout: 30000, message: "le worker neuf n'a pas pris la page après le geste" }
        )
        .toEqual({ heldBy: "deployed", waiting: false });

    // And it stops there: the updated page asks nothing, and does not reload again.
    await page.waitForTimeout(3000);
    expect(await workers(page)).toEqual({
        heldBy: "deployed",
        waiting: false,
        announced: 0,
        apiSaysWaiting: false,
        loads: 3,
    });
    await expect(page.locator("#gl-sw-update-banner")).toHaveCount(0);
});

test("[pwa] sans le geste, la mise à jour attend encore à la visite suivante — et se redit", async ({
    page,
}) => {
    // A waiting worker is not lost when the tab is reloaded: it is still waiting, and a page that
    // boots onto it must say so — the event of the previous page is gone with it.
    test.setTimeout(150000);
    await visitThenFindUpdate(page);
    await expect
        .poll(async () => (await workers(page)).waiting, {
            timeout: 30000,
            message: "le worker neuf n'attend pas",
        })
        .toBe(true);
    const banner = page.locator("#gl-sw-update-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });

    // « Later »: the banner leaves, the update keeps waiting.
    await banner.locator('[data-gl-action="sw-update-later"]').click();
    await expect(banner).toHaveCount(0);
    expect(await workers(page)).toMatchObject({ heldBy: "previous", waiting: true, loads: 2 });

    await page.reload();
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await expect
        .poll(() => workers(page), {
            timeout: 30000,
            message: "à la visite suivante, la mise à jour en attente n'est pas redite",
        })
        .toEqual({
            heldBy: "previous",
            waiting: true,
            announced: 1,
            apiSaysWaiting: true,
            loads: 3,
        });
    await expect(banner).toBeVisible({ timeout: 15000 });
});

test("[pwa] le geste recharge UNE fois, même si le contrôleur change encore pendant le rechargement", async ({
    page,
}) => {
    // « Update on reload », ON: the reload's own navigation installs one more worker, which
    // takes the page at once — a second `controllerchange` on a page that is leaving. An
    // unlatched `reload()` answered it by reloading again, which ABORTS the navigation under
    // way: seen on the deployed bundle, the page never left — one aborted navigation and one
    // more worker installed every hundred milliseconds.
    test.setTimeout(150000);
    await visitThenFindUpdate(page);
    await expect
        .poll(async () => (await workers(page)).waiting, {
            timeout: 30000,
            message: "le worker neuf n'attend pas",
        })
        .toBe(true);
    const banner = page.locator("#gl-sw-update-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await forceUpdateOnReload(page);

    await banner.locator('[data-gl-action="sw-update-apply"]').click();

    await expect
        .poll(async () => (await workers(page).catch(() => null))?.loads ?? 0, {
            timeout: 30000,
            message: "la page ne s'est pas rechargée : boucle de navigations annulées",
        })
        .toBe(3);
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    // The worker may well change again under this page, in such a browser: it is not
    // reloaded for it.
    await page.waitForTimeout(4000);
    expect((await workers(page)).loads, "la page s'est rechargée d'elle-même").toBe(3);
});
