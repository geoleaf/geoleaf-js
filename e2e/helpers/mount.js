// @ts-check
// `GeoLeaf.mount()` in a spec — shared by the two remount specs (`71-mount-remount`,
// `75-remount-plugins`).
//
// The page boots as it always does: `init.js` calls `GeoLeaf.boot()`, nothing served is
// rewritten. A spec then takes that application over with `mountAndWait()`, which exercises
// `boot() → unmount` on the way, and keeps the handle on `window.__glHandle`.

import { expect } from "./test.js";

/** The id of the map container of the deployed application. */
export const MAP_ID = "geoleaf-map";

/** How long a boot may take before a spec gives up on it. */
export const BOOT_TIMEOUT = 60_000;

/**
 * Counts `geoleaf:app:ready` (`window.__glReady`) and records every `geoleaf:boot:aborted`
 * reason (`window.__glAborted`). To install before the page loads.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function installSignals(page) {
    await page.addInitScript(() => {
        Object.assign(window, { __glReady: 0, __glAborted: [] });
        document.addEventListener("geoleaf:app:ready", () => {
            /** @type {any} */ (window).__glReady++;
        });
        document.addEventListener("geoleaf:boot:aborted", (e) => {
            /** @type {any} */ (window).__glAborted.push(
                String(/** @type {CustomEvent} */ (e).detail?.reason)
            );
        });
    });
}

/**
 * Loads the page and waits for the application `init.js` booted.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function bootPage(page) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /** @type {any} */ (window).__glReady >= 1, null, {
        timeout: BOOT_TIMEOUT,
    });
}

/**
 * `GeoLeaf.mount()`, awaited to `ready`; the handle stays on `window.__glHandle`. A `ready` that
 * never settles is NAMED here rather than left to the test timeout: it is what a registry left
 * initialised by the previous unmount produces — the next boot starts no module.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function mountAndWait(page) {
    const outcome = await page.evaluate(async (id) => {
        const handle = /** @type {any} */ (window).GeoLeaf.mount(id);
        Object.assign(window, { __glHandle: handle });
        const timeout = new Promise((resolve) =>
            setTimeout(() => resolve("never settled"), 45_000)
        );
        return Promise.race([
            handle.ready.then(
                () => "ready",
                (/** @type {any} */ e) => `rejected: ${e.name} ${e.reason}`
            ),
            timeout,
        ]);
    }, MAP_ID);
    expect(outcome, "the mounted application's `ready`").toBe("ready");
}

/**
 * `unmount()` on the handle `mountAndWait()` kept, awaited.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function unmount(page) {
    await page.evaluate(() => /** @type {any} */ (window).__glHandle.unmount());
}
