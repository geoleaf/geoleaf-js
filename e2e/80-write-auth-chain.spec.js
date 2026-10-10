// @ts-check
/**
 * 80 — `write.auth`, THE WHOLE CHAIN IN A BROWSER
 *
 * A layer declares whether its write endpoint takes the session's token. The declaration
 * crosses a seam: the core's drain writes it on the request (`geoleafWriteAuth`, a member of its
 * `init`), the connector's `fetch` patch reads it. Each half had its tests — the drain against a
 * controlled `fetch`, the patch against an `init` written by hand — and a guard held the two
 * names equal. Nothing sent a capture through both.
 *
 * What is judged here is the request THE SERVER RECEIVES, and what the operator is told while
 * a capture waits:
 *
 * - `none` — the write leaves WITHOUT a token, under the connector's `baseUrl`, a session open;
 * - `bearer` — with no session the write does not leave, the pass counts it in
 *   `heldForSession`, and the sync strip says signing in is what it waits for; at sign-in it
 *   leaves, with the token.
 *
 * 🛑 THE BACKEND IS ROUTED, AND THE REAL PROOF BENCH COULD NOT STAND IN FOR IT. That bench is
 * reached in host-token mode (`getToken`), where the connector registers no session reader:
 * a pass can never hold a capture for want of a session there. The hold exists in `auth.endpoint` mode only,
 * which needs a sign-in endpoint — routed here, like the API it protects.
 *
 * ⚠️ RUN ON THE `core` VARIANT: the strip that speaks is the core's, and `deploy-core` ships no
 * editor. A capture is made by `Storage.applyEdit`, the entry the editor itself goes through.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { wipeOnOrigin } from "./helpers/db-seed.js";
import { bootWithoutServiceWorker, seedConnectorToken } from "./helpers/connector.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const ORIGIN = baseURL("core");
const LAYER = "sites_rosario";
const BASE = "https://backend.test";
const AUTH = `${BASE}/auth`;
const WRITE = `${BASE}/rows/${LAYER}`;
// Dotted values, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const SIGNED_IN = "eyJzaWduZWQ.payload.sig";
const HOUR = 3600 * 1000;

/**
 * What the routed backend received, in arrival order.
 * @typedef {{ writes: (string|null)[], probes: (string|null)[], signIns: number }} Backend
 */

/**
 * Routes the protected origin: the write endpoint, a plain data URL used as a witness, and the
 * sign-in endpoint.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Backend>}
 */
async function routeBackend(page) {
    /** @type {Backend} */
    const backend = { writes: [], probes: [], signIns: 0 };
    await page.route(`${BASE}/**`, async (route) => {
        const request = route.request();
        const url = request.url();
        const authorization = (await request.allHeaders())["authorization"] ?? null;
        if (url.startsWith(AUTH)) {
            backend.signIns += 1;
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ token: SIGNED_IN, expiresIn: 3600 }),
            });
        }
        if (url.startsWith(WRITE)) {
            backend.writes.push(authorization);
            return route.fulfill({
                status: 201,
                contentType: "application/json",
                body: `[{"id":${backend.writes.length}}]`,
            });
        }
        backend.probes.push(authorization);
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    return backend;
}

/**
 * Declares the layer's write target on the active profile — the deliverable ships none.
 * @param {import('@playwright/test').Page} page
 * @param {"none"|"bearer"} auth
 */
async function declareWrite(page, auth) {
    const posed = await page.evaluate(
        ({ layer, endpoint, auth }) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const cfg = gl?.Config?.getActiveProfile?.()?.layers?.find(
                (/** @type {any} */ l) => l.id === layer
            );
            if (!cfg) return false;
            cfg.write = {
                enabled: true,
                endpoint,
                dialect: "collection",
                auth,
                geometryProperty: "geom",
                properties: ["nom"],
            };
            return true;
        },
        { layer: LAYER, endpoint: WRITE, auth }
    );
    expect(posed, `layer ${LAYER} is in the active profile`).toBe(true);
}

/**
 * Queues one capture, as the editor does.
 * @param {import('@playwright/test').Page} page
 * @param {string} nom
 */
async function capture(page, nom) {
    await page.evaluate(
        async ({ layer, nom }) => {
            await /** @type {any} */ (globalThis).GeoLeaf.Storage.applyEdit({
                layerId: layer,
                kind: "create",
                feature: {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                    properties: { nom },
                },
            });
        },
        { layer: LAYER, nom }
    );
}

/**
 * Runs one pass and hands back what it reports.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ attempted: number, pushed: number, heldForSession: number }>}
 */
function drain(page) {
    return page.evaluate(async () => {
        const report = await /** @type {any} */ (globalThis).GeoLeaf.Storage.pushOutbox();
        return {
            attempted: report.attempted,
            pushed: report.pushed,
            heldForSession: report.heldForSession ?? 0,
        };
    });
}

test.describe("80 — write.auth, du drain du core à la requête reçue", () => {
    /** @type {Backend} */
    let backend;

    test.beforeEach(async ({ page }) => {
        // The machine's own dev bootstrap would configure the connector before the spec does.
        await page.route("**/connector.local.js*", (route) =>
            route.fulfill({ status: 200, contentType: "text/javascript", body: "" })
        );
        backend = await routeBackend(page);
        await wipeOnOrigin(page, ORIGIN);
        await bootWithoutServiceWorker(page);
        await page.waitForSelector(".gl-sync-banner", { state: "attached", timeout: 15000 });
        await page.evaluate(() =>
            /** @type {any} */ (globalThis).GeoLeaf.plugins.load("connector")
        );
    });

    test("🛑 `none` : la saisie part SANS jeton sous le `baseUrl`, session ouverte", async ({
        page,
    }) => {
        await seedConnectorToken(page, {
            baseUrl: BASE,
            token: STORED,
            expiresAt: Date.now() + HOUR,
        });
        await page.evaluate(
            ({ baseUrl, endpoint }) =>
                /** @type {any} */ (globalThis).GeoLeaf.Connector.configure({
                    baseUrl,
                    auth: { endpoint, ui: false },
                }),
            { baseUrl: BASE, endpoint: AUTH }
        );

        // 🛑 THE WITNESS, WITHOUT WHICH "NO TOKEN" PROVES NOTHING: an ordinary request under
        // the same `baseUrl` DOES carry the session's token. A patch that was never installed
        // would send the write without one too.
        await page.evaluate((url) => fetch(url), `${BASE}/data/witness.json`);
        expect(backend.probes).toEqual([`Bearer ${STORED}`]);

        await declareWrite(page, "none");
        await capture(page, "sans-jeton");
        await drain(page);
        await expect.poll(() => backend.writes.length, { timeout: 12000 }).toBe(1);
        expect(backend.writes[0], "a `none` layer's write carries no token").toBeNull();

        // Same page, same session, same endpoint: the DECLARATION alone changes, and the
        // token is back. What the first write lacked, it lacked because the layer said so.
        await declareWrite(page, "bearer");
        await capture(page, "avec-jeton");
        await drain(page);
        await expect.poll(() => backend.writes.length, { timeout: 12000 }).toBe(2);
        expect(backend.writes[1]).toBe(`Bearer ${STORED}`);
    });

    test("🛑 `bearer` sans session : la saisie attend, le bandeau dit pourquoi, et elle part à la connexion", async ({
        page,
    }) => {
        // Not awaited: with no stored session, `configure()` waits on the sign-in window.
        await page.evaluate(
            ({ baseUrl, endpoint }) => {
                const w = /** @type {any} */ (window);
                w.__authed = false;
                document.addEventListener("geoleaf:connector:authenticated", () => {
                    w.__authed = true;
                });
                void w.GeoLeaf.Connector.configure({
                    baseUrl,
                    auth: { endpoint, ui: true },
                }).catch(() => {});
            },
            { baseUrl: BASE, endpoint: AUTH }
        );
        const overlay = page.locator(".gc-overlay");
        await expect(overlay).toBeVisible({ timeout: 10000 });

        await declareWrite(page, "bearer");
        await capture(page, "en-attente");
        const held = await drain(page);

        expect(held.heldForSession).toBe(1);
        // Held BEFORE the request: nothing attempted, nothing received.
        expect(held.attempted).toBe(0);
        expect(backend.writes).toEqual([]);

        // The capture is still owed, and the strip says what it waits for.
        const mention = page.locator(".gl-sync-banner__session");
        await expect(mention).toBeVisible({ timeout: 8000 });
        await expect(mention).not.toBeEmpty();
        await expect(page.locator(".gl-sync-banner__pending")).toContainText("1");

        // Signing in is enough: nobody presses "send".
        await page.fill("#gc-login", "demo-user");
        await page.fill("#gc-password", "demo-pass"); // test fixture, not a real secret
        await overlay.locator('button[type="submit"]').click();
        await page.waitForFunction(() => /** @type {any} */ (window).__authed === true, null, {
            timeout: 30000,
        });

        await expect.poll(() => backend.writes.length, { timeout: 15000 }).toBe(1);
        expect(backend.writes[0]).toBe(`Bearer ${SIGNED_IN}`);
        await expect(mention).toBeHidden({ timeout: 8000 });
        await expect(page.locator(".gl-sync-banner")).toBeHidden();
    });
});
