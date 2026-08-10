// @ts-check
// Boot primitives shared by the browser-verification specs (`vn-*.spec.js`).
//
// These two functions are currently RE-DECLARED in 13 spec files, verbatim or near. This
// helper is the single copy; the `vn-*` specs consume it. The 13 existing declarations are
// deliberately left alone — the suite is green, and churning 13 files to save 13 small
// functions is a refactor, not a verification. Noted, not silently duplicated.

import { expect } from "@playwright/test";

/**
 * Waits until GeoLeaf has resolved a native maplibregl.Map with a live style.
 * Under happy-dom this can never be observed — which is precisely why the scenarios that
 * call it belong to the browser table and not to the unit suite.
 * @param {import('@playwright/test').Page} page
 */
async function bootMap(page) {
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(
        () => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            const native = gl?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.getStyle === "function" && native.getStyle());
        },
        null,
        { timeout: 20000 }
    );
}

/**
 * Waits for the map to be fully LOADED (tiles + style settled), not merely styled.
 * Needed by the scenarios that observe a re-render (style reload, basemap switch, zoom).
 * @param {import('@playwright/test').Page} page
 */
async function waitMapLoaded(page) {
    await page.waitForFunction(
        () => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            const native = gl?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.loaded === "function" && native.loaded());
        },
        null,
        { timeout: 25000 }
    );
}

/**
 * Pins the profile the app will boot with. Must be called BEFORE `page.goto`.
 * @param {import('@playwright/test').Page} page
 * @param {string} profileId — a directory name under `profiles/`. Never a hard count here:
 *   this line said "8 of them ship" from the day six profiles were removed (backlog C.14) and
 *   was wrong by five, then by six after S7 of the public switch. `ls profiles/` is the oracle;
 *   `build-deploy.cjs` drops `schemas/` and every `_`-prefixed directory.
 */
async function selectProfile(page, profileId) {
    await page.addInitScript((id) => {
        try {
            sessionStorage.setItem("gl-selected-profile", id);
        } catch (e) {
            console.warn("[e2e] sessionStorage unavailable:", e);
        }
    }, profileId);
}

/**
 * Collects console output and page errors. `serviceWorkers: 'block'` makes register()
 * resolve undefined, so the SWRegister line is a TEST ARTEFACT and is filtered out here —
 * a scenario asserting "no console error" would otherwise fail on the harness, not the app.
 * @param {import('@playwright/test').Page} page
 * @returns {{ errors: string[], all: string[] }} live arrays, filled as the page runs
 */
function captureConsole(page) {
    const errors = [];
    const all = [];
    const KNOWN_NOISE = [/\[SWRegister\] Registration failed/i];
    const isNoise = (t) => KNOWN_NOISE.some((re) => re.test(t));

    page.on("console", (msg) => {
        const text = msg.text();
        all.push(`${msg.type()}: ${text}`);
        if (msg.type() === "error" && !isNoise(text)) errors.push(text);
    });
    page.on("pageerror", (err) => {
        const text = String(err);
        all.push(`pageerror: ${text}`);
        if (!isNoise(text)) errors.push(text);
    });

    return { errors, all };
}

export { bootMap, waitMapLoaded, selectProfile, captureConsole };
