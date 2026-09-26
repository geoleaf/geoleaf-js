// @ts-check
/**
 * 66 — "CAN I LEAVE?" SAYS THE WRITE SESSION, ON THE SHIPPED BUNDLE.
 *
 * The gesture this proves: before leaving, the user opens the offline window. When the connector
 * manages the session (`auth.endpoint`), the check says whether it is valid and until when, or
 * that it expired or is absent — and a session that captures cannot use degrades the verdict.
 *
 * What no unit suite can give: the link between TWO module graphs. The connector is a separate
 * bundle, loaded lazily; it tells the core through `GeoLeaf.Sync.registerSessionReader` — the
 * slot the core opens — and never by import. A connector that imported the core's seam would
 * register into a second, never-read instance, and every unit suite would stay green. Here the
 * core's `Storage.preflight()` of the shipped bundle reads what the shipped connector told it.
 *
 * 🛑 WHAT MAKES THE VERDICT FALSIFIABLE. Headless Chromium refuses persistent storage, which
 * alone makes every check `degraded` — a spec asserting `degraded` for an expired session would
 * then pass with the session ignored. The browser's persistence answer is therefore pinned to
 * "granted" (an init script, the only fact altered), so that the check is `ready` with a valid
 * session and turns `degraded` only through the session. The shipped profile declares no pull
 * source and the device is never prepared: nothing else weighs on the verdict.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootWithoutServiceWorker, seedConnectorToken } from "./helpers/connector.js";

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

const BASE = "https://api.geoleaf-e2e.test";
const AUTH = `${BASE}/auth`;
// Dotted, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const HOUR = 3600 * 1000;

test.beforeEach(async ({ page }) => {
    // Whatever lies on the workstation must not configure the connector before the test does.
    await page.route("**/connector.local.js*", (route) =>
        route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
    );
    // The renewal is unreachable: an expired session stays expired — `configure()` resolves
    // anyway (a stored session whose renewal cannot be reached is not an absence).
    await page.route(`${AUTH}**`, (route) => route.abort("internetdisconnected"));
    await page.addInitScript(() => {
        Object.defineProperty(StorageManager.prototype, "persisted", {
            configurable: true,
            value: () => Promise.resolve(true),
        });
    });
});

/**
 * Loads the connector (lazy on the shipped app) and configures it in `auth.endpoint` mode.
 * @param {import('@playwright/test').Page} page
 */
async function configureConnector(page) {
    await page.evaluate(
        async ({ baseUrl, endpoint }) => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            await gl.plugins.load("connector");
            await gl.Connector.configure({ baseUrl, auth: { endpoint } });
        },
        { baseUrl: BASE, endpoint: AUTH }
    );
}

/**
 * Opens the offline window, where the check lives.
 * @param {import('@playwright/test').Page} page
 */
async function openOfflineWindow(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Storage.whenReady());
    await page.locator('[data-gl-toolbar-action="offline-ui"]').first().click();
    await expect(page.locator("#gl-cache-modal")).toHaveCount(1, { timeout: 5_000 });
    const check = page.locator(".gl-cache-preflight");
    await expect(check).toBeVisible({ timeout: 10_000 });
    return check;
}

test("[offline] the check says a valid session and until when — and its end when signed out", async ({
    page,
}) => {
    await bootWithoutServiceWorker(page);
    const expiresAt = Date.now() + HOUR;
    await seedConnectorToken(page, { baseUrl: BASE, token: STORED, expiresAt });
    await configureConnector(page);

    // ① The core's check carries what the connector told it — read, not guessed.
    const report = await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Storage.preflight()
    );
    expect(report?.session).toEqual({ state: "valid", expiresAt });

    // ② The window says it, as a clock reading, and the device is ready.
    const check = await openOfflineWindow(page);
    const line = page.locator(".gl-cache-preflight__session");
    await expect(line).toHaveAttribute("data-session", "valid");
    const clock = await page.evaluate(
        (at) =>
            new Date(at).toLocaleString(document.documentElement.lang || undefined, {
                dateStyle: "short",
                timeStyle: "short",
            }),
        expiresAt
    );
    await expect(line).toContainText(clock);
    await expect(check).toHaveAttribute("data-verdict", "ready");

    // ③ Signed out from the page: the window follows at once — no session, captures will wait.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Connector.logout());
    await expect(line).toHaveAttribute("data-session", "absent");
    await expect(check).toHaveAttribute("data-verdict", "degraded");
});

test("[offline] an expired session degrades the check", async ({ page }) => {
    await bootWithoutServiceWorker(page);
    await seedConnectorToken(page, {
        baseUrl: BASE,
        token: STORED,
        expiresAt: Date.now() - 60_000,
    });
    await configureConnector(page);

    const check = await openOfflineWindow(page);
    await expect(page.locator(".gl-cache-preflight__session")).toHaveAttribute(
        "data-session",
        "expired"
    );
    await expect(check).toHaveAttribute("data-verdict", "degraded");
});
