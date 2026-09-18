// @ts-check
/**
 * e2e/51 — an instance of `createConnector()` leaves the singleton's renewal alone.
 *
 * 🛑 THE STORE HELD ONE RENEWAL DELEGATE FOR THE PAGE, and an instance installed and removed it.
 * After `createConnector({ getToken }).destroy()`, the singleton's next 401 found nothing to
 * renew its session with: the session was erased and `auth-error` emitted — a path only an
 * explicit refusal may take.
 *
 * ⚠️ THE INSTANCE COMES FROM THE MODULE THE REGISTRY LOADED. An integrator imports the package
 * the page already runs; here, the URL the plugin registry fetched is imported as is, so both
 * share one module — the witness counts the connector bundle's resources, before and after. A
 * second copy would have its own store, and the case would not be reproduced.
 *
 * Service Workers are blocked: every request this spec fills is routed (see
 * `helpers/connector.js`).
 */
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import {
    bootWithoutServiceWorker,
    seedConnectorToken,
    readConnectorToken,
    recordConnectorEvents,
    connectorEvents,
} from "./helpers/connector.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const BASE = "https://api.geoleaf-e2e.test";
const AUTH = `${BASE}/auth`;
const OTHER = "https://other.geoleaf-e2e.test";
// Dotted values, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const RENEWED = "eyJyZW5ld2Vk.payload.sig";
const HOST_TOKEN = "eyJob3N0.payload.sig";
const HOUR = 3600 * 1000;

test.beforeEach(async ({ page, context }) => {
    // The basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
    // Whatever lies on the workstation must not configure the connector before the test does.
    await page.route("**/connector.local.js*", (route) =>
        route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
    );
});

test("[connector] le destroy() d'une instance laisse au singleton le renouvellement de sa session", async ({
    page,
}) => {
    const state = { renewals: 0 };
    await page.route(`${AUTH}/refresh*`, async (route) => {
        state.renewals += 1;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ token: RENEWED, expiresIn: 3600 }),
        });
    });
    // The protected API refuses every token but the renewed one.
    await page.route(`${BASE}/data/**`, async (route) => {
        const authorization = route.request().headers()["authorization"] ?? null;
        await route.fulfill({
            status: authorization === `Bearer ${RENEWED}` ? 200 : 401,
            contentType: "application/json",
            body: "{}",
        });
    });

    await bootWithoutServiceWorker(page);
    await seedConnectorToken(page, { baseUrl: BASE, token: STORED, expiresAt: Date.now() + HOUR });
    await recordConnectorEvents(page);

    const copies = await page.evaluate(
        async ({ baseUrl, endpoint, other, hostToken }) => {
            const w = /** @type {any} */ (window);
            await w.GeoLeaf.plugins.load("connector");
            await w.GeoLeaf.Connector.configure({ baseUrl, auth: { endpoint } });
            const bundles = () =>
                performance
                    .getEntriesByType("resource")
                    .map((entry) => entry.name)
                    .filter((name) => /geoleaf-connector\.plugin\.js(\?|$)/.test(name));
            const before = bundles();
            const module = await import(before[0]);
            module.createConnector({ baseUrl: other, getToken: () => hostToken }).destroy();
            return { before, after: bundles(), exported: typeof module.createConnector };
        },
        { baseUrl: BASE, endpoint: AUTH, other: OTHER, hostToken: HOST_TOKEN }
    );

    // THE WITNESS: one connector module on the page, the one the registry loaded.
    expect(copies.exported).toBe("function");
    expect(copies.before).toHaveLength(1);
    expect(copies.after).toEqual(copies.before);

    const status = await page.evaluate(
        (url) => fetch(url).then((response) => response.status),
        `${BASE}/data/p.json`
    );

    // THE SUBJECT: the singleton renewed its session, and the request went through.
    expect(state.renewals).toBe(1);
    expect(status).toBe(200);
    expect(await connectorEvents(page)).not.toContain("geoleaf:connector:auth-error");
    expect((await readConnectorToken(page, BASE))?.token).toBe(RENEWED);
});
