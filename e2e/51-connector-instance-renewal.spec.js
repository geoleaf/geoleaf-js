// @ts-check
/**
 * e2e/51 — an instance of `createConnector()` leaves the singleton's session alone.
 *
 * 🛑 THE STORE HELD ONE RENEWAL DELEGATE FOR THE PAGE, and an instance installed and removed it.
 * After `createConnector({ getToken }).destroy()`, the singleton's next 401 found nothing to
 * renew its session with: the session was erased and `auth-error` emitted — a path only an
 * explicit refusal may take.
 *
 * 🛑 AND THE SESSION EVENTS WERE READ WITHOUT THEIR SESSION. The queue resume and the relaunch
 * listened to `token-refreshed` and `authenticated` whatever API they named: an instance
 * renewing the session of another API resumed the singleton's queue, and disarmed its relaunch
 * while its own session was still waiting.
 *
 * ⚠️ THE INSTANCE COMES FROM THE MODULE THE REGISTRY LOADED. An integrator imports the package
 * the page already runs; here, the URL the plugin registry fetched is imported as is, so both
 * share one module — the witness counts the connector bundle's resources, before and after. A
 * second copy would have its own store and listeners, and the cases would not be reproduced.
 *
 * Service Workers are blocked: every request this spec fills is routed (see
 * `helpers/connector.js`).
 */
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { withOffline } from "./helpers/offline.js";
import {
    bootWithoutServiceWorker,
    seedConnectorToken,
    readConnectorToken,
    recordConnectorEvents,
    connectorEvents,
    spyQueueResume,
} from "./helpers/connector.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const BASE = "https://api.geoleaf-e2e.test";
const AUTH = `${BASE}/auth`;
const OTHER = "https://other.geoleaf-e2e.test";
const OTHER_AUTH = `${OTHER}/auth`;
// Dotted values, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const RENEWED = "eyJyZW5ld2Vk.payload.sig";
const OTHER_STORED = "eyJvdGhlcg.payload.sig";
const OTHER_RENEWED = "eyJvdGhlclI.payload.sig";
const HOST_TOKEN = "eyJob3N0.payload.sig";
const HOUR = 3600 * 1000;

/**
 * What the fake servers answer, and what they received. `auth` is `"ok"` or `"unreachable"`.
 * @typedef {{ auth: string, renewals: number, otherRenewals: number }} ServerState
 */

/**
 * The two renewal endpoints, and the singleton's API — which refuses every token but the
 * renewed one, as a server that retired the stored session does.
 * @param {import('@playwright/test').Page} page
 * @param {ServerState} state
 */
async function routeServers(page, state) {
    await page.route(`${AUTH}/refresh*`, async (route) => {
        state.renewals += 1;
        if (state.auth === "unreachable") return route.abort("internetdisconnected");
        await route.fulfill({ json: { token: RENEWED, expiresIn: 3600 } });
    });
    await page.route(`${OTHER_AUTH}/refresh*`, async (route) => {
        state.otherRenewals += 1;
        await route.fulfill({ json: { token: OTHER_RENEWED, expiresIn: 3600 } });
    });
    await page.route(`${BASE}/data/**`, async (route) => {
        const authorization = route.request().headers()["authorization"] ?? null;
        await route.fulfill({
            status: authorization === `Bearer ${RENEWED}` ? 200 : 401,
            contentType: "application/json",
            body: "{}",
        });
    });
}

/**
 * Loads the plugin, configures the singleton in `auth.endpoint` mode, then imports the module the
 * registry loaded and keeps it on `window.__connectorModule`. Asserts the witness: one module.
 * @param {import('@playwright/test').Page} page
 */
async function configureAndImport(page) {
    const copies = await page.evaluate(
        async ({ baseUrl, endpoint }) => {
            const w = /** @type {any} */ (window);
            await w.GeoLeaf.plugins.load("connector");
            await w.GeoLeaf.Connector.configure({ baseUrl, auth: { endpoint } });
            const bundles = () =>
                performance
                    .getEntriesByType("resource")
                    .map((entry) => entry.name)
                    .filter((name) => /geoleaf-connector\.plugin\.js(\?|$)/.test(name));
            const before = bundles();
            w.__connectorModule = await import(before[0]);
            return {
                before,
                after: bundles(),
                exported: typeof w.__connectorModule.createConnector,
            };
        },
        { baseUrl: BASE, endpoint: AUTH }
    );
    // THE WITNESS: one connector module on the page, the one the registry loaded.
    expect(copies.exported).toBe("function");
    expect(copies.before).toHaveLength(1);
    expect(copies.after).toEqual(copies.before);
}

/**
 * An instance renews the session of ANOTHER API, then lets whatever its event started run.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string | null>} The token the instance read.
 */
function renewOtherApi(page) {
    return page.evaluate(
        async ({ other, endpoint }) => {
            const w = /** @type {any} */ (window);
            const instance = w.__connectorModule.createConnector({
                baseUrl: other,
                auth: { endpoint },
            });
            const token = await instance.getTokenAsync();
            await new Promise((resolve) => setTimeout(resolve, 200));
            return token;
        },
        { other: OTHER, endpoint: OTHER_AUTH }
    );
}

/**
 * One request to the singleton's API, through the page's (intercepted) `fetch`.
 * @param {import('@playwright/test').Page} page
 */
function callApi(page) {
    return page.evaluate(
        (url) => fetch(url).then((response) => response.status),
        `${BASE}/data/p.json`
    );
}

test.describe("51-connector-instance-renewal", () => {
    test.beforeEach(async ({ page, context }) => {
        // The basemap is not this spec's subject: its third-party latency must not decide it.
        await serveBasemapTilesLocally(context);
        // Whatever lies on the workstation must not configure the connector before the test does.
        await page.route("**/connector.local.js*", (route) =>
            route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
        );
    });

    test("le destroy() d'une instance laisse au singleton le renouvellement de sa session", async ({
        page,
    }) => {
        /** @type {ServerState} */
        const state = { auth: "ok", renewals: 0, otherRenewals: 0 };
        await routeServers(page, state);
        await bootWithoutServiceWorker(page);
        await seedConnectorToken(page, {
            baseUrl: BASE,
            token: STORED,
            expiresAt: Date.now() + HOUR,
        });
        await recordConnectorEvents(page);
        await configureAndImport(page);

        await page.evaluate(
            ({ other, hostToken }) =>
                /** @type {any} */ (window).__connectorModule
                    .createConnector({ baseUrl: other, getToken: () => hostToken })
                    .destroy(),
            { other: OTHER, hostToken: HOST_TOKEN }
        );
        const status = await callApi(page);

        // THE SUBJECT: the singleton renewed its session, and the request went through.
        expect(state.renewals).toBe(1);
        expect(status).toBe(200);
        expect(await connectorEvents(page)).not.toContain("geoleaf:connector:auth-error");
        expect((await readConnectorToken(page, BASE))?.token).toBe(RENEWED);
    });

    test("le renouvellement d'une instance d'une autre API ne relance pas la file du singleton", async ({
        page,
    }) => {
        /** @type {ServerState} */
        const state = { auth: "ok", renewals: 0, otherRenewals: 0 };
        await routeServers(page, state);
        await bootWithoutServiceWorker(page);
        await seedConnectorToken(page, {
            baseUrl: BASE,
            token: STORED,
            expiresAt: Date.now() + HOUR,
        });
        await seedConnectorToken(page, {
            baseUrl: OTHER,
            token: OTHER_STORED,
            expiresAt: Date.now() - 60000,
        });
        await recordConnectorEvents(page);
        await configureAndImport(page);
        await spyQueueResume(page);

        const token = await renewOtherApi(page);

        // THE WITNESS: the instance renewed its session, and announced it.
        expect(token).toBe(OTHER_RENEWED);
        expect(state.otherRenewals).toBe(1);
        expect(await connectorEvents(page)).toContain("geoleaf:connector:token-refreshed");
        // THE SUBJECT: the singleton's queue did not move.
        expect(await page.evaluate(() => /** @type {any} */ (window).__resume)).toEqual([]);

        // THE CONTROL: the singleton's own renewal does resume it — the spy sees what it must.
        expect(await callApi(page)).toBe(200);
        await expect
            .poll(() => page.evaluate(() => /** @type {any} */ (window).__resume), {
                timeout: 15000,
            })
            .toEqual(["requeueAll:authRequired", "pushOutbox"]);
    });

    test("le renouvellement d'une instance d'une autre API ne désarme pas la relance du singleton", async ({
        page,
        context,
    }) => {
        /** @type {ServerState} */
        const state = { auth: "unreachable", renewals: 0, otherRenewals: 0 };
        await routeServers(page, state);
        await bootWithoutServiceWorker(page);
        await seedConnectorToken(page, {
            baseUrl: BASE,
            token: STORED,
            expiresAt: Date.now() + HOUR,
        });
        await seedConnectorToken(page, {
            baseUrl: OTHER,
            token: OTHER_STORED,
            expiresAt: Date.now() - 60000,
        });
        await recordConnectorEvents(page);
        await configureAndImport(page);

        // The singleton's authentication server cannot be reached: its session is kept, and its
        // relaunch armed.
        expect(await callApi(page)).toBe(401);
        expect(state.renewals).toBe(1);

        // THE WITNESS: meanwhile, an instance renewed the session of another API.
        expect(await renewOtherApi(page)).toBe(OTHER_RENEWED);
        expect(state.otherRenewals).toBe(1);

        // The singleton's server is back before the device is: only `online` may retry.
        await withOffline(context, page, async () => {
            state.auth = "ok";
        });

        // THE SUBJECT: the relaunch was still armed, and renewed the singleton's session.
        await expect.poll(() => state.renewals, { timeout: 15000 }).toBe(2);
        await expect
            .poll(async () => (await readConnectorToken(page, BASE))?.token, { timeout: 15000 })
            .toBe(RENEWED);
    });
});
