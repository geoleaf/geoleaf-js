// @ts-check
// The suite's `test`: Playwright's, with the demo's 3D relief left off at boot unless a spec
// asks for it.
//
// 🛑 THE RELIEF COST EVERY WAIT OF THE SUITE, AND IT IS MEASURED. The demo profile's default
// basemap declares `terrain.default3D` (relief, `pitch: 60`, elevation tiles). Since core
// 3.6.1 the default basemap applies at boot instead of at the first gesture, and under software
// GL the relief's first render burst kept a page busy for 12 to 19 s on a 4-core runner
// (trace of the public nightly run 35837949935). Everything that waits for the map paid it: ten
// `networkidle` loads overran 120 s, a theme switch overran its 10 s, and the E2E step went from
// about 56 min to 1.0-1.3 h. Measured on 2 cores, the same load: 8 s with the relief, 2.4 s
// without. A spec whose subject is not the relief must not have the relief as its verdict.
//
// ⚠️ WHY AN INIT SCRIPT AND NOT A ROUTE. Specs intercept `profile-bundle.json` to rewrite it —
// `page.route` or `context.route`, then `route.fetch()`. `route.fetch()` goes straight to the
// network: a route laid here, before theirs, is BYPASSED — measured, a context route's rewrite
// did not reach the page once a page route fetched the same bundle. Rewriting the RESPONSE inside
// the page composes with every route whatever its order, and no such spec has to remember it.
// `cfg-c2-ui-controls.spec.js` already rewrites the bundle this way.
//
// ⚠️ IT REACHES THE TEST'S `context` ONLY. A page opened elsewhere — `browser.newPage()`, a
// `launchPersistentContext()` — boots with the relief unless the spec calls
// `turnReliefOff(context)` on it.
//
// ⚠️ WHAT IS TURNED OFF IS `default3D`, NOT THE RELIEF. The basemaps keep their `terrain` block:
// nothing activates it at boot any more, and a spec can still activate it on purpose.
//
// A spec whose SUBJECT is the relief, or the real boot, opts back in:
//
//     test.use({ relief: true });

import { test as base, expect } from "@playwright/test";

/**
 * Turns off, in every `profile-bundle.json` the page receives, the boot activation of the
 * relief: `terrain.default3D` becomes `false` on every basemap that sets it.
 *
 * Runs in the page, before any of its scripts. Only a successful JSON `GET` of the bundle is
 * rewritten; any other response goes through untouched, the same object. Status and headers are
 * kept — the loader reads `ok`, `status` and `content-type` — minus the length and encoding
 * headers, which described the original body.
 *
 * `window.__glReliefOff` counts the basemaps turned off: the witness that the rewrite bit.
 */
function turnReliefOffInPage() {
    const w = /** @type {any} */ (window);
    const nativeFetch = w.fetch.bind(w);
    w.__glReliefOff = 0;
    w.fetch = async (/** @type {any} */ input, /** @type {any} */ init) => {
        const response = await nativeFetch(input, init);
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
        const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
        if (!url || !url.includes("profile-bundle.json") || method !== "GET" || !response.ok) {
            return response;
        }
        try {
            const bundle = await response.clone().json();
            let off = 0;
            for (const basemap of Object.values(bundle?.basemaps?.basemaps ?? {})) {
                const terrain = /** @type {any} */ (basemap)?.terrain;
                if (terrain?.default3D === true) {
                    terrain.default3D = false;
                    off += 1;
                }
            }
            if (off === 0) return response;
            w.__glReliefOff += off;
            const headers = new Headers(response.headers);
            headers.delete("content-length");
            headers.delete("content-encoding");
            return new Response(JSON.stringify(bundle), {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
        } catch {
            return response;
        }
    };
}

/**
 * Turns the relief off at boot in a context the suite's fixture does not reach — one a spec
 * opened itself (`launchPersistentContext()`, `browser.newContext()`). Call it before the first
 * navigation.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @returns {Promise<void>}
 * @example
 * const context = await playwright.chromium.launchPersistentContext(dir, options);
 * await turnReliefOff(context);
 */
export async function turnReliefOff(context) {
    await context.addInitScript(turnReliefOffInPage);
}

/**
 * @typedef {object} ReliefOption
 * @property {boolean} relief `true` keeps the demo's 3D relief at boot — for a spec whose
 *   subject is the relief, or the real boot. Defaults to `false`.
 */

/** @typedef {import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions} TestArgs */
/** @typedef {import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions} WorkerArgs */

export const test = base.extend(
    /** @type {import("@playwright/test").Fixtures<ReliefOption & { _relief: void }, {}, TestArgs, WorkerArgs>} */ ({
        relief: [false, { option: true }],
        _relief: [
            async ({ context, relief }, use) => {
                if (!relief) await turnReliefOff(context);
                await use();
            },
            { auto: true },
        ],
    })
);

export { expect };
