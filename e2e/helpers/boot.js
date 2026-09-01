// @ts-check
// Boot primitives shared by the browser-verification specs (`vn-*.spec.js`).
//
// One boot wait used to be re-declared in eleven spec files under a single name that covered
// THREE different contracts — the exact failure mode the perf-baseline line warns against
// (trusting a name), reformed inside the tooling. Consolidated on 25/08/2026: the two
// byte-identical families now live here as named exports (`bootMapUntilIdle`,
// `bootMapUntilLoaded`), and every local declaration that remains carries a name that SAYS its
// contract (`waitMapStyleReady`, `bootMapVisibleOnly`, composed cfg variants). A failure now
// names its stage and its contract on every consumer.
//
// The count is DERIVED, never written here, because it moved once already: this note said 13 and
// measured 11 on 18/08/2026 — two files had been migrated without the note following.
//
//   grep -rlE '^(async )?function (bootMap|waitForMap|waitMapLoaded)' e2e/*.spec.js | wc -l
//   grep -rln 'helpers/boot' e2e/*.spec.js | wc -l
//
// ## Waiting on a SIGNAL instead of a polled predicate — instructed 25/08/2026, not converted
//
// The boot announces itself: `geoleaf:map:ready` (two emitters — init-reveal and the maplibre
// adapter) and `geoleaf:app:ready` fire on `document`. A signal wait would replace the polled
// `waitForFunction` with an event listener PLUS a predicate pre-check (the event may fire
// before the listener attaches — the classic late-listener race, so the check comes first and
// the listener is the fallback). It was NOT converted here, on a measured ground: the polled
// wait expired zero times in three 24-core passes and zero times under `taskset -c 0,1`
// (perf baseline, 25/08) — converting would trade a proven wait for a subtler one with no
// measured failure to fix. The trigger that reopens this: a measured expiry of stage 2 whose
// `reached` map shows the map WAS live — that is the polling cadence blaming an innocent, and
// the signal wait is its fix.

import { expect } from "@playwright/test";

/** Budget of a single boot wait, in ms. The value the suite has always used. */
const DEFAULT_BOOT_BUDGET_MS = 20_000;

/**
 * Reports HOW FAR boot got, for the failure message of `bootMap`.
 *
 * 🛑 This exists because the raw Playwright timeout ENDORSES THE IDENTITY OF ITS CALLER. Measured
 * twice: `Timeout 20000ms exceeded` surfaced once under « render 1k random point features » and
 * once under « Heap memory, 10K features », and both were read as a rendering and a memory
 * regression. Neither was: the map had simply never booted, and the perf line the test claims to
 * measure was never printed. A symptom that names an innocent costs more than a slow test.
 *
 * Never throws: a diagnosis that can fail is a diagnosis that disappears exactly when it is
 * needed. If the probe itself cannot run, that fact IS the diagnosis.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Record<string, boolean|string>>} ordered flags — the first `false` is the stop.
 */
async function _bootReach(page) {
    try {
        return await page.evaluate(() => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            const map = gl?.Core?.getMap?.();
            const native = map?.getNativeMap?.();
            // `getStyle()` can throw on a half-initialised map — and that IS "no live style",
            // so both branches below assign. No initialiser: it would be dead (no-useless-assignment).
            let style;
            try {
                style = !!(native && typeof native.getStyle === "function" && native.getStyle());
            } catch {
                style = false;
            }
            return {
                windowGeoLeaf: !!gl,
                Core: !!gl?.Core,
                getMap: !!map,
                getNativeMap: !!native,
                liveStyle: style,
            };
        });
    } catch (e) {
        return { probeUnavailable: String(e) };
    }
}

/**
 * Waits until GeoLeaf has resolved a native maplibregl.Map with a live style.
 * Under happy-dom this can never be observed — which is precisely why the scenarios that
 * call it belong to the browser table and not to the unit suite.
 *
 * The budget is a PARAMETER, and the two waits below share it rather than each carrying its own
 * literal. That matters on a constrained runner: the suite has a documented class of specs that
 * pass on many cores and fail on two, and the fix for those is never a blanket increase — it is
 * a budget raised at ONE named call site, with the measurement that justifies it written next to
 * it. A literal repeated inside the helper makes that impossible to express: raising it here
 * would silently move every caller, and the one spec that needed it would stop being visible.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [budgetMs] Overrides the default budget. Raise it only with a measured reason.
 */
async function bootMap(page, budgetMs = DEFAULT_BOOT_BUDGET_MS) {
    try {
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: budgetMs });
    } catch (cause) {
        throw new Error(
            `[bootMap] BOOT FAILURE — stage 1/2: the map container '#geoleaf-map' never became ` +
                `visible within ${budgetMs}ms. Nothing was measured, and this is NOT a failure of ` +
                `the calling test. Look at the page load, not at what the test asserts.\n` +
                `  cause: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
            { cause }
        );
    }
    try {
        await page.waitForFunction(
            () => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                const native = gl?.Core?.getMap?.()?.getNativeMap?.();
                return !!(native && typeof native.getStyle === "function" && native.getStyle());
            },
            null,
            { timeout: budgetMs }
        );
    } catch (cause) {
        throw new Error(
            `[bootMap] BOOT FAILURE — stage 2/2: GeoLeaf never resolved a native map with a live ` +
                `style within ${budgetMs}ms. Nothing was measured, and this is NOT a failure of ` +
                `the calling test.\n` +
                `  reached: ${JSON.stringify(await _bootReach(page))}\n` +
                `  Read that map left to right: the first \`false\` is where boot stopped.`,
            { cause }
        );
    }
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

/**
 * Waits until the NATIVE map reports `loaded()` — the contract of the interaction specs that
 * drive the click seam (feature-info, routing, navigation): a click into a map whose canvas
 * exists but whose data has not landed goes into the void. ⚠️ Waiting on `window.GeoLeaf.plugins`
 * instead is NOT enough and cost seven identical reds once: the namespace exists before the map
 * is ready.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [budgetMs] Overrides the default budget. Raise it only with a measured reason.
 */
export async function bootMapUntilLoaded(page, budgetMs = DEFAULT_BOOT_BUDGET_MS) {
    await page.goto("/");
    try {
        await page.waitForSelector(".maplibregl-canvas", { timeout: Math.min(budgetMs, 15_000) });
    } catch (cause) {
        throw new Error(
            `[bootMapUntilLoaded] BOOT FAILURE — stage 1/2: no maplibre canvas within ` +
                `${Math.min(budgetMs, 15_000)}ms. Nothing was measured; look at the page load.\n` +
                `  cause: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
            { cause }
        );
    }
    try {
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (
                    window
                ).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
                return !!(native && typeof native.loaded === "function" && native.loaded());
            },
            null,
            { timeout: budgetMs }
        );
    } catch (cause) {
        throw new Error(
            `[bootMapUntilLoaded] BOOT FAILURE — stage 2/2: the native map never reported ` +
                `loaded() within ${budgetMs}ms.\n` +
                `  reached: ${JSON.stringify(await _bootReach(page))}\n` +
                `  Read that map left to right: the first \`false\` is where boot stopped.`,
            { cause }
        );
    }
}

/**
 * `bootMapUntilLoaded`, PLUS the loader overlay gone — the contract of the UI-driving specs
 * (security, geocoding, table): a toolbar under `#gl-loader` swallows the click without a
 * word. The loader wait is best-effort on purpose (the overlay may already be unmounted).
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [budgetMs] Overrides the default budget. Raise it only with a measured reason.
 */
export async function bootMapUntilIdle(page, budgetMs = DEFAULT_BOOT_BUDGET_MS) {
    await page.goto("/");
    try {
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: budgetMs });
    } catch (cause) {
        throw new Error(
            `[bootMapUntilIdle] BOOT FAILURE — stage 1/3: '#geoleaf-map' never became visible ` +
                `within ${budgetMs}ms. Nothing was measured; look at the page load.\n` +
                `  cause: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
            { cause }
        );
    }
    try {
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (
                    window
                ).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
                return !!(native && typeof native.loaded === "function" && native.loaded());
            },
            null,
            { timeout: budgetMs }
        );
    } catch (cause) {
        throw new Error(
            `[bootMapUntilIdle] BOOT FAILURE — stage 2/3: the native map never reported ` +
                `loaded() within ${budgetMs}ms.\n` +
                `  reached: ${JSON.stringify(await _bootReach(page))}\n` +
                `  Read that map left to right: the first \`false\` is where boot stopped.`,
            { cause }
        );
    }
    await page
        .locator("#gl-loader")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {});
}
