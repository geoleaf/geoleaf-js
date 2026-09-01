// @ts-check
// E2E: 11-connector — @geoleaf-plugins/connector on deploy-core (port 8766).
// The connector is eager-loaded in every variant and the tourism boot profile sets
// ui.showCredentialButton:true, so the credential button auto-bootstraps in UI-only
// mode at boot WITHOUT configure(). The full auth flow (login modal -> token in IDB
// -> Authorization header injection -> 401 handling) is driven from the test via a
// page-evaluated GeoLeaf.Connector.configure() plus page.route() mocks — exactly as
// 09-editor drives plugins.load(). Validates CDC_plugin-connector.md §1.2-1.4 (auth
// flow), §5 (credential button), §6 (login modal), §15 (interceptor), §24 (events).
//
// Network note: a fake HTTPS baseUrl (api.geoleaf-e2e.test) is used so the interceptor
// scope never collides with the app's own asset requests, whichever origin serves the
// deploy-core variant (see e2e/helpers/base-url.js — port or vhost). Playwright
// page.route() fulfills these at the network layer, below the captured _originalFetch,
// so injected Authorization headers are observable via route.request().headers().

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanComponent } from "./helpers/axe-config.js";

// serviceWorkers:'block' — deploy-core ships a PWA SW that intercepts fetch; without
// blocking it, page.route() does not see the connector's requests (they fail "Failed to
// fetch"). Blocking the SW makes page.route authoritative for the mocked backend.
test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

// Fake protected origin — distinct from the app origin, on either target.
const BASE = "https://api.geoleaf-e2e.test";
const AUTH = BASE + "/auth";
// Dotted value so the interceptor's "static token" heuristic (no '.') stays quiet.
const TOKEN = "eyJhbGc.payload.signature";

/** Waits for map + connector auto-bootstrap (credential button rendered). */
async function bootReady(page) {
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".gc-credential-btn").first()).toBeVisible({ timeout: 10000 });
}

/** Mocks the auth endpoint: POST {endpoint} -> { token, expiresIn }. */
async function mockAuth(page) {
    await page.route(AUTH, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ token: TOKEN, expiresIn: 3600 }),
        })
    );
}

/**
 * Fires configure({ auth: { ui: true } }) WITHOUT awaiting (it blocks on the modal
 * until login), then fills and submits the login modal, and waits for the
 * geoleaf:connector:authenticated event.
 */
async function configureAndLogin(page) {
    await page.evaluate(
        ({ baseUrl, endpoint }) => {
            const w = /** @type {any} */ (window);
            w.__authed = null;
            document.addEventListener("geoleaf:connector:authenticated", (e) => {
                w.__authed = /** @type {any} */ (e).detail?.baseUrl ?? true;
            });
            // Not awaited: with auth.ui:true and no token, configure() awaits the modal.
            w.__cfg = w.GeoLeaf.Connector.configure({
                baseUrl,
                auth: { endpoint, ui: true },
            }).catch((err) => {
                w.__cfgErr = String(err);
            });
        },
        { baseUrl: BASE, endpoint: AUTH }
    );

    const overlay = page.locator(".gc-overlay");
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await page.fill("#gc-login", "demo-user");
    await page.fill("#gc-password", "demo-pass"); // test fixture, not a real secret
    await overlay.locator('button[type="submit"]').click();
    // ⚠️ TWO SUPERIMPOSED DEFECTS HERE, and fixing one without the other
    // makes things WORSE.
    //
    // 1. The signature is `waitForFunction(fn, arg, options)`. The
    //    `{ timeout: 5000 }` left in 2nd position, hence as the page
    //    function's ARGUMENT: it was silently ignored, and the wait fell
    //    back to `actionTimeout` (10 s).
    // 2. 5 s do not suffice anyway on a 2-4 core runner.
    //
    // Fixing the signature alone would have REDUCED the effective budget
    // from 10 s to 5 s and made the failure MORE frequent. So both are
    // fixed together: right shape, measured budget.
    await page.waitForFunction(() => /** @type {any} */ (window).__authed !== null, null, {
        timeout: 30000,
    });
}

test.describe("11-connector", () => {
    // Neutralize the machine-specific, git-ignored dev bootstrap (connector.local.js).
    // init.js imports it BEFORE GeoLeaf.boot() and, when present, calls configure() in
    // getToken mode before the profile loads — which sets _currentInstance and thereby
    // suppresses the profile's ui.showCredentialButton auto-bootstrap (documented
    // finding). Stubbing it to an empty module makes these tests validate the connector's
    // intrinsic behavior reproducibly, whether or not the dev file exists on the host.
    //
    // ⚠️ THIS STUB BECAME REDUNDANT ON 2026-08-09, AND IT STAYS.
    // `build-deploy.cjs` no longer writes anything but the inert stub into the
    // deliverable variants — the ones this spec targets —, so
    // `window.GEOLEAF_DEV_CONNECTOR` is already `undefined` at boot. Removing
    // it would make these tests' reproducibility depend on a property of
    // ANOTHER script: the day someone targets `deploy-local` from this file,
    // or restores a copy of the bootstrap, the tests would become sensitive
    // again to whatever lies on the host, without a line saying so. A
    // redundancy that costs two lines and removes a coupling is not a
    // redundancy.
    test.beforeEach(async ({ page }) => {
        await page.route("**/connector.local.js", (route) =>
            route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
        );
    });

    test("boot: map + auto-bootstrapped credential button, no critical console error", async ({
        page,
    }) => {
        const errors = [];
        page.on("pageerror", (err) => errors.push(err.message));
        await page.goto("/");
        await bootReady(page);
        const critical = errors.filter(
            (e) => !e.includes("favicon") && !e.includes("chrome-extension")
        );
        expect(critical).toHaveLength(0);
    });

    test("credential button is styled and labelled (CDC §5)", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);
        const btn = page.locator(".gc-credential-btn").first();
        await expect(btn).toBeVisible();
        expect(await btn.getAttribute("aria-label")).toBe("Connexion");
        // Connector stylesheet injected — B.7: via a constructable stylesheet
        // (document.adoptedStyleSheets), not a <style> element (CSP-safe).
        const hasStyle = await page.evaluate(() =>
            Array.from(document.adoptedStyleSheets || []).some((s) => {
                try {
                    return Array.from(s.cssRules).some((r) =>
                        r.cssText.includes(".gc-credential-btn")
                    );
                } catch {
                    return false;
                }
            })
        );
        expect(hasStyle).toBe(true);
        // Desktop variant keeps the connector's own 28px sizing (the mobile variant is
        // re-sized to the toolbar's 44px button by the core, so assert on desktop).
        const deskCss = await page
            .locator('.gc-credential-btn[data-variant="desktop"]')
            .evaluate((el) => {
                const s = getComputedStyle(el);
                return { display: s.display, width: s.width, height: s.height };
            });
        expect(deskCss.display).not.toBe("none");
        expect(deskCss.width).toBe("28px");
        expect(deskCss.height).toBe("28px");
    });

    test("runtime API GeoLeaf.Connector is exposed (CDC §11)", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);
        const api = await page.evaluate(() => {
            const G = /** @type {any} */ (window).GeoLeaf || {};
            return {
                configure: typeof G.Connector?.configure,
                openLoginModal: typeof G.Connector?.openLoginModal,
            };
        });
        expect(api.configure).toBe("function");
        expect(api.openLoginModal).toBe("function");
    });

    test("UI-only click dispatches event and opens the login modal (CDC §20/§21)", async ({
        page,
    }) => {
        await page.goto("/");
        await bootReady(page);
        await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            w.__btnClicked = null;
            document.addEventListener("geoleaf:connector:credential-button-clicked", (e) => {
                w.__btnClicked = /** @type {any} */ (e).detail;
            });
        });
        await page.locator(".gc-credential-btn").first().click();
        await page.waitForFunction(() => /** @type {any} */ (window).__btnClicked !== null, null, {
            timeout: 30000,
        });
        await expect(page.locator(".gc-overlay")).toBeVisible({ timeout: 5000 });
        const detail = await page.evaluate(() => /** @type {any} */ (window).__btnClicked);
        expect(detail.authenticated).toBe(false);
    });

    test("full auth flow: login -> geoleaf:connector:authenticated + token persisted in IDB (CDC §1.2/§6/§13)", async ({
        page,
    }) => {
        const errors = [];
        page.on("pageerror", (err) => errors.push(err.message));
        await mockAuth(page);
        await page.goto("/");
        await bootReady(page);
        await configureAndLogin(page);

        // Modal dismissed after success
        await expect(page.locator(".gc-overlay")).toHaveCount(0);

        // authenticated event carried the right baseUrl
        const authedBaseUrl = await page.evaluate(() => /** @type {any} */ (window).__authed);
        expect(authedBaseUrl).toBe(BASE);

        // Token persisted in IndexedDB (geoleaf-connector / auth-tokens / keyPath baseUrl)
        const record = await page.evaluate(
            (baseUrl) =>
                new Promise((resolve) => {
                    const open = indexedDB.open("geoleaf-connector");
                    open.onsuccess = () => {
                        const db = open.result;
                        try {
                            const tx = db.transaction("auth-tokens", "readonly");
                            const get = tx.objectStore("auth-tokens").get(baseUrl);
                            get.onsuccess = () => resolve(get.result || null);
                            get.onerror = () => resolve(null);
                        } catch {
                            resolve(null);
                        }
                    };
                    open.onerror = () => resolve(null);
                }),
            BASE
        );
        expect(record).toBeTruthy();
        expect(/** @type {any} */ (record).token).toBe(TOKEN);

        const critical = errors.filter(
            (e) => !e.includes("favicon") && !e.includes("chrome-extension")
        );
        expect(critical).toHaveLength(0);
    });

    test("injects Authorization: Bearer header on baseUrl fetch (CDC §15)", async ({ page }) => {
        await mockAuth(page);
        let capturedAuth;
        await page.route(BASE + "/data.json", (route) => {
            capturedAuth = route.request().headers()["authorization"];
            route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
        });
        await page.goto("/");
        await bootReady(page);
        await configureAndLogin(page);

        await page.evaluate((url) => fetch(url).then((r) => r.json()), BASE + "/data.json");
        expect(capturedAuth).toBe("Bearer " + TOKEN);
    });

    test("getToken mode: 401 triggers one retry with a rotated token then succeeds (CDC §15)", async ({
        page,
    }) => {
        const seen = [];
        await page.route(BASE + "/g.json", (route) => {
            seen.push(route.request().headers()["authorization"]);
            route.fulfill({
                status: seen.length === 1 ? 401 : 200,
                contentType: "application/json",
                body: "{}",
            });
        });
        await page.goto("/");
        await bootReady(page);
        await page.evaluate(
            async ({ baseUrl }) => {
                let n = 0;
                // getToken rotates the value each call so the retry uses a fresh token.
                await /** @type {any} */ (window).GeoLeaf.Connector.configure({
                    baseUrl,
                    getToken: () => "tok." + ++n,
                });
            },
            { baseUrl: BASE }
        );

        const status = await page.evaluate((u) => fetch(u).then((r) => r.status), BASE + "/g.json");
        expect(status).toBe(200);
        expect(seen.length).toBe(2);
        expect(seen[0]).not.toBe(seen[1]); // token rotated on retry
    });

    test("token mode: 401 clears token and emits geoleaf:connector:auth-error (CDC §15/§24)", async ({
        page,
    }) => {
        await mockAuth(page);
        await page.route(BASE + "/p.json", (route) => route.fulfill({ status: 401, body: "" }));
        await page.goto("/");
        await bootReady(page);
        await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            w.__authErr = null;
            document.addEventListener("geoleaf:connector:auth-error", (e) => {
                w.__authErr = /** @type {any} */ (e).detail;
            });
        });
        await configureAndLogin(page);

        const status = await page.evaluate((u) => fetch(u).then((r) => r.status), BASE + "/p.json");
        expect(status).toBe(401);
        await page.waitForFunction(() => /** @type {any} */ (window).__authErr !== null, null, {
            timeout: 30000,
        });
        const detail = await page.evaluate(() => /** @type {any} */ (window).__authErr);
        expect(detail.baseUrl).toBe(BASE);
    });

    test("[a11y] login modal passes WCAG 2.1 AA (CDC §6)", async ({ page }) => {
        await mockAuth(page);
        await page.goto("/");
        await bootReady(page);
        // Open the modal via the configure() auth.ui path (do not log in).
        await page.evaluate(
            ({ baseUrl, endpoint }) => {
                /** @type {any} */ (window).GeoLeaf.Connector.configure({
                    baseUrl,
                    auth: { endpoint, ui: true },
                }).catch(() => {});
            },
            { baseUrl: BASE, endpoint: AUTH }
        );
        await expect(page.locator(".gc-overlay")).toBeVisible({ timeout: 5000 });
        const results = await scanComponent(page, ".gc-overlay");
        expect(results.violations).toEqual([]);
    });
});
