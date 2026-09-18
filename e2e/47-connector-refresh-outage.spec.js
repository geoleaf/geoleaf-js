// @ts-check
// E2E: 47 — `auth.endpoint` mode: a renewal that cannot conclude keeps the session, and the
// session coming back puts the queue back on the wire.
//
// Four cases, each on the delivered bundle:
//   • a 401 whose renewal answers 503, or cannot be reached, keeps the stored session — no
//     `auth-error`, no login window: only an explicit refusal ends a session;
//   • opening the application with no network and an expired token does not block on a login
//     window that needs the network — with `auth.ui` or without it;
//   • when the network returns, the renewal is retried without a gesture, and the connector
//     asks the core to requeue what the dead session set aside, then to push.
//
// The routing of every request below was measured before this spec was written: with the
// Service Worker blocked, `page.route` sees them all — see `helpers/connector.js`. The network
// is cut by aborting the renewal route: `setOffline` alone still lets a routed request through.

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

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const BASE = "https://api.geoleaf-e2e.test";
const AUTH = `${BASE}/auth`;
// Dotted values, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const RENEWED = "eyJyZW5ld2Vk.payload.sig";
const HOUR = 3600 * 1000;

/**
 * What the fake servers answer. The spec flips these fields; the handlers read them at request
 * time.
 * `renewal` is `"ok"`, `"unavailable"` (503) or `"unreachable"` (aborted).
 * @typedef {{ renewal: string, renewals: number, apiAuth: (string|null)[] }} ServerState
 */

/**
 * @param {string} renewal
 * @returns {ServerState}
 */
function servers(renewal) {
    return { renewal, renewals: 0, apiAuth: [] };
}

/**
 * The renewal endpoint, `${AUTH}/refresh`, answering what `state.renewal` says.
 * @param {import('@playwright/test').Page} page
 * @param {ServerState} state
 */
async function routeRenewal(page, state) {
    await page.route(`${AUTH}/refresh*`, async (route) => {
        state.renewals += 1;
        if (state.renewal === "unreachable") return route.abort("internetdisconnected");
        if (state.renewal === "unavailable") return route.fulfill({ status: 503, body: "" });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ token: RENEWED, expiresIn: 3600 }),
        });
    });
}

/**
 * The protected API: it refuses every token but the renewed one, which is how a server that
 * has retired the stored session answers.
 * @param {import('@playwright/test').Page} page
 * @param {ServerState} state
 */
async function routeApi(page, state) {
    await page.route(`${BASE}/data/**`, async (route) => {
        const authorization = route.request().headers()["authorization"] ?? null;
        state.apiAuth.push(authorization);
        await route.fulfill({
            status: authorization === `Bearer ${RENEWED}` ? 200 : 401,
            contentType: "application/json",
            body: "{}",
        });
    });
}

/**
 * Calls `configure()` in `auth.endpoint` mode and reports how it settled within 10 s —
 * `"pending"` is how a login window that never closes shows up.
 * @param {import('@playwright/test').Page} page
 * @param {{ ui: boolean }} opts
 * @returns {Promise<string>}
 */
function configure(page, { ui }) {
    return page.evaluate(
        ({ baseUrl, endpoint, ui }) =>
            Promise.race([
                /** @type {any} */ (window).GeoLeaf.Connector.configure({
                    baseUrl,
                    auth: { endpoint, ui },
                }).then(
                    () => "resolved",
                    (/** @type {any} */ e) => `rejected: ${e?.message ?? e}`
                ),
                new Promise((resolve) => setTimeout(() => resolve("pending"), 10000)),
            ]),
        { baseUrl: BASE, endpoint: AUTH, ui }
    );
}

/**
 * One request to the protected API through the page's (intercepted) `fetch`.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
function callApi(page, name) {
    return page.evaluate(
        (url) =>
            fetch(url).then(
                (r) => r.status,
                (e) => `rejected: ${e.message}`
            ),
        `${BASE}/data/${name}`
    );
}

test.describe("47-connector-refresh-outage", () => {
    test.beforeEach(async ({ page }) => {
        // Same neutralisation as `11-connector.spec.js`: whatever lies on the workstation must
        // not configure the connector before the test does.
        await page.route("**/connector.local.js*", (route) =>
            route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
        );
    });

    for (const renewal of ["unavailable", "unreachable"]) {
        test(`un 401 dont le renouvellement est ${renewal === "unavailable" ? "en 503" : "injoignable"} garde la session — ni auth-error ni fenêtre`, async ({
            page,
        }) => {
            const state = servers(renewal);
            await routeRenewal(page, state);
            await routeApi(page, state);
            await bootWithoutServiceWorker(page);
            await seedConnectorToken(page, {
                baseUrl: BASE,
                token: STORED,
                expiresAt: Date.now() + HOUR,
            });
            await recordConnectorEvents(page);
            expect(await configure(page, { ui: true })).toBe("resolved");

            expect(await callApi(page, "p.json")).toBe(401);
            // The positive witness first: an absence asserted before the renewal was even
            // attempted would prove nothing.
            await expect.poll(() => state.renewals, { timeout: 15000 }).toBeGreaterThan(0);

            expect(
                await readConnectorToken(page, BASE),
                "the stored session was destroyed by a renewal that did not conclude"
            ).toMatchObject({ token: STORED });
            expect(await connectorEvents(page)).not.toContain("geoleaf:connector:auth-error");
            await expect(page.locator(".gc-overlay")).toHaveCount(0);
        });
    }

    for (const ui of [true, false]) {
        test(`démarrage hors réseau à jeton expiré, ${ui ? "avec" : "sans"} interface : configure se résout, sans fenêtre ni ConfigError`, async ({
            page,
            context,
        }) => {
            const state = servers("unreachable");
            await routeRenewal(page, state);
            await routeApi(page, state);
            await bootWithoutServiceWorker(page);
            await seedConnectorToken(page, {
                baseUrl: BASE,
                token: STORED,
                expiresAt: Date.now() - 60000,
            });

            const settled = await withOffline(context, page, () => configure(page, { ui }));

            expect(settled).toBe("resolved");
            expect(state.renewals, "the renewal was never attempted").toBeGreaterThan(0);
            await expect(page.locator(".gc-overlay")).toHaveCount(0);
            expect(await readConnectorToken(page, BASE)).toMatchObject({ token: STORED });
        });
    }

    test("démarrage hors réseau : au retour du réseau, la session revient sans geste et la file repart", async ({
        page,
        context,
    }) => {
        const state = servers("unreachable");
        await routeRenewal(page, state);
        await routeApi(page, state);
        await bootWithoutServiceWorker(page);
        await seedConnectorToken(page, {
            baseUrl: BASE,
            token: STORED,
            expiresAt: Date.now() - 60000,
        });
        await recordConnectorEvents(page);
        await spyQueueResume(page);

        await withOffline(context, page, async () => {
            expect(await configure(page, { ui: true })).toBe("resolved");
            // The server is back before the device is: only `online` may trigger the retry.
            state.renewal = "ok";
        });

        await expect
            .poll(() => connectorEvents(page), { timeout: 15000 })
            .toContain("geoleaf:connector:token-refreshed");
        expect(await readConnectorToken(page, BASE)).toMatchObject({ token: RENEWED });
        await expect
            .poll(() => page.evaluate(() => /** @type {any} */ (window).__resume), {
                timeout: 15000,
            })
            .toEqual(["requeueAll:authRequired", "pushOutbox"]);
        expect(await callApi(page, "after.json")).toBe(200);
    });

    test("un 401 dont le renouvellement est injoignable : au retour du réseau, la session revient sans geste", async ({
        page,
        context,
    }) => {
        const state = servers("unreachable");
        await routeRenewal(page, state);
        await routeApi(page, state);
        await bootWithoutServiceWorker(page);
        await seedConnectorToken(page, {
            baseUrl: BASE,
            token: STORED,
            expiresAt: Date.now() + HOUR,
        });
        await recordConnectorEvents(page);
        await spyQueueResume(page);
        expect(await configure(page, { ui: true })).toBe("resolved");

        expect(await callApi(page, "p.json")).toBe(401);
        await expect.poll(() => state.renewals, { timeout: 15000 }).toBeGreaterThan(0);

        // A coverage flap: the device drops, the renewal endpoint is back when it returns.
        await withOffline(context, page, async () => {
            state.renewal = "ok";
        });

        await expect
            .poll(() => connectorEvents(page), { timeout: 15000 })
            .toContain("geoleaf:connector:token-refreshed");
        expect(await readConnectorToken(page, BASE)).toMatchObject({ token: RENEWED });
        await expect
            .poll(() => page.evaluate(() => /** @type {any} */ (window).__resume), {
                timeout: 15000,
            })
            .toEqual(["requeueAll:authRequired", "pushOutbox"]);
        expect(await callApi(page, "after.json")).toBe(200);
    });
});
