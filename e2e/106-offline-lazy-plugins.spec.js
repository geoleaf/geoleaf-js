// @ts-check
/**
 * 106 — A ZONE PREPARED FOR OFFLINE USE CARRIES THE PLUGINS THE APPLICATION LOADS ON DEMAND.
 *
 * The gesture this proves: the technician prepares the zone while the network is there, WITHOUT
 * having opened the editor; the network is cut; the editor's button is pressed — and the editor
 * opens, drawing engine included.
 *
 * 🛑 THE DEFECT IT CLOSES. The preparation wrote the zone into IndexedDB, and the worker's
 * pre-cache carries only what the FIRST page load requests. A plugin loaded on demand is an
 * `import()`: it is served by the worker's static cache, never by IndexedDB, and it only entered
 * that cache the first time it was loaded online. A technician who had not opened the editor
 * before leaving had a prepared zone and no way to write into it — the click did nothing.
 *
 * ⚠️ WHY THE SAME PAGE, AND NOT A RELOAD. The reload offline is spec 31's subject. What is
 * proved here is that the plugin's code is kept: the page stays up, the network goes, and the
 * plugin is asked for for the first time.
 *
 * ⚠️ NO URL IS WRITTEN HERE. The plugin's entry is read off the served `init.js`, and its chunks
 * off the entry itself, exactly as the browser follows them — content-hashed names change at
 * every build.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { goOffline } from "./helpers/offline.js";

test.use({ baseURL: baseURL("full") });

test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/**
 * The editor's files as the browser would follow them: the entry `init.js` imports, then every
 * `./geoleaf-editor.*.js` each file imports, statically or not.
 *
 * 🛑 READ FROM NODE, NEVER FROM THE PAGE. A `fetch()` issued by the page goes through the
 * worker, which keeps every static file it serves: reading the closure there put the editor in
 * the cache by itself, and the spec came out green on the faulty build. The request context of
 * the test runner is outside the browser, and outside the worker.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} origin The deploy's base URL, ending with a slash.
 * @returns {Promise<string[]>}
 */
async function readEditorClosure(request, origin) {
    const text = async (/** @type {string} */ url) => (await request.get(origin + url)).text();
    const init = (await text("init.js"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const entry = /import\(\s*["']\.\/(dist\/geoleaf-editor\.plugin\.js[^"']*)["']/.exec(init)?.[1];
    if (!entry) return [];
    const seen = new Set([entry]);
    const queue = [entry];
    while (queue.length > 0) {
        const url = /** @type {string} */ (queue.shift());
        const code = await text(url);
        const dir = url.slice(0, url.lastIndexOf("/") + 1);
        for (const m of code.matchAll(/["']\.\/(geoleaf-editor\.[^"']+\.js)["']/g)) {
            const next = dir + m[1];
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }
    return [...seen];
}

test.describe("106 — the offline preparation keeps the plugins loaded on demand", () => {
    test.setTimeout(180_000);

    test("prepared online, the editor opens with the network cut", async ({
        page,
        context,
        request,
    }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20_000 });
        await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
            timeout: 45_000,
        });
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Storage.whenReady());

        // The witness: the editor has never been loaded on this page. Without it, a pass could
        // be a module the browser already held.
        expect(
            await page.evaluate(() => typeof (/** @type {any} */ (window).GeoLeaf?.Editor)),
            "the editor is already loaded — the spec would prove nothing"
        ).toBe("undefined");

        const origin = new URL("./", page.url()).href;
        const closure = await readEditorClosure(request, origin);
        expect(closure.length, "init.js no longer loads the editor on demand").toBeGreaterThan(1);

        // The preparation, online — the real one, as the offline window's button runs it.
        await page.evaluate(async () => {
            await /** @type {any} */ (window).GeoLeaf.Storage.CacheManager.cacheProfile("tourism", {
                selection: { layers: ["sites_rosario"], basemaps: [], includeTiles: false },
            });
        });

        const missing = await page.evaluate(async (urls) => {
            const out = [];
            for (const url of urls) if (!(await caches.match(url))) out.push(url);
            return out;
        }, closure);
        expect(missing, "files of the editor the preparation did not keep").toEqual([]);

        await goOffline(context, page);

        // The plugin and its drawing engine, asked for the FIRST time, with the network cut.
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
        await page.waitForFunction(
            () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
            null,
            { timeout: 15_000 }
        );
        const pointBtn = page.locator('button.gl-editor-tool-btn[data-tool="point"]');
        for (let i = 0; i < 3 && !(await pointBtn.isVisible()); i++) {
            await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
            await page.waitForTimeout(300);
        }
        await pointBtn.click();
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (
                    window
                ).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
                try {
                    return !!native?.getLayer?.("td-point");
                } catch {
                    return false;
                }
            },
            null,
            { timeout: 20_000 }
        );
    });
});
