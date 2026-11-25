/**
 * The runtime metrics readers exist on the shipped bundle, and give the two boot durations.
 *
 * ## The defect
 *
 * `GeoLeaf.getPerformanceMetrics()` and `getRuntimeMetrics()` are documented public members, and
 * their code shipped — but they existed in no bundle: their module mounted them at its own
 * evaluation, under `if (GeoLeaf)`, and the shipped chunk order evaluates it before the chunk
 * that creates the namespace.
 *
 * ## What the spec demands
 *
 * After the boot, both are functions on `window.GeoLeaf`, and the metrics carry the two
 * durations of the boot (`timeToMapReadyMs`, `timeToAppReadyMs`) as numbers.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

test("getPerformanceMetrics et getRuntimeMetrics existent et rendent les durées du boot", async ({
    page,
}) => {
    await installSignals(page);
    await bootPage(page);
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });

    const read = await page.evaluate(() => {
        const gl = /** @type {any} */ (window).GeoLeaf;
        const kinds = {
            performance: typeof gl.getPerformanceMetrics,
            runtime: typeof gl.getRuntimeMetrics,
        };
        const m = kinds.runtime === "function" ? gl.getRuntimeMetrics() : null;
        return { kinds, map: m?.timeToMapReadyMs ?? null, app: m?.timeToAppReadyMs ?? null };
    });
    expect(read.kinds).toEqual({ performance: "function", runtime: "function" });
    expect(typeof read.app).toBe("number");
    expect(typeof read.map).toBe("number");
});
