// @ts-check
/**
 * 60 — A DROPDOWN LOADING ITS CHOICES FROM A URL FILLS OFF-NETWORK, ON THE SHIPPED BUNDLE.
 *
 * The gesture this proves: the profile is prepared for offline use while the network is there;
 * the network is cut; the technician opens a form, and the field whose choices come from a URL
 * (`fetchOptions`) offers them — with no request.
 *
 * What no unit suite can give: the real preparation (`CacheManager.cacheProfile`, enumerating
 * the RAW layer configurations), the core keeping the list in IndexedDB, the editor plugin
 * wiring the field renderer's resolver to the core, and a real form.
 *
 * 🛑 THE DEFECT IT CLOSES. The dropdown re-fetched its URL at every render, with no copy the
 * device keeps: off the network it showed its placeholder alone, and a form was incomplete by
 * construction.
 *
 * ⚠️ THREE TRAPS THIS SPEC IS BUILT AROUND.
 * 1. The field's STATIC list is removed. A static list declared beside `fetchOptions` is the
 *    documented fallback: left in place, it would fill the dropdown off-network by itself and
 *    this spec would come out green having proved nothing.
 * 2. Service workers are BLOCKED. Under `deploy-full` the worker serves same-origin resources
 *    from its own cache: it would prove the worker, not the kept list.
 * 3. The list's route REFUSES while the network is cut: a `context.route` still answers under
 *    `setOffline(true)` (measured by spec 53), which would let a request that should not
 *    exist succeed.
 *
 * ⚠️ The preparation reads the RAW `sites_rosario_config.json`, the runtime reads the inlined
 * `profile-bundle.json`: both are patched, or each half would see a different field.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { goOffline, recordRequests } from "./helpers/offline.js";

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

/** Same origin, and a path no file answers: only the route below does. */
const LIST_PATH = "/e2e-lists/statut.json";
const LIST = [
    { value: "Ouvert", label: "Ouvert" },
    { value: "Fermé", label: "Fermé" },
    { value: "En travaux", label: "En travaux" },
];

/** Replaces the static choices of `statut` by a list loaded from `LIST_PATH`. */
function patchStatut(/** @type {any} */ cfg) {
    const statut = (cfg?.attributes?.fields ?? []).find(
        (/** @type {any} */ f) => f.field === "properties.statut"
    );
    if (!statut?.edit) throw new Error("`sites_rosario` no longer carries an editable `statut`");
    statut.edit.options = { fetchOptions: LIST_PATH };
}

test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

test.describe("60 — an option list loaded by URL fills off-network", () => {
    test.setTimeout(180_000);

    test("prepared online, the list fills the form with the network cut", async ({
        page,
        context,
    }) => {
        let offline = false;
        // Only a GET answered 200 carries a body to rewrite: the preparation also SIZES its
        // resources (HEAD), and a revalidation can answer 304 — both pass through untouched.
        const rewrite =
            (/** @type {(json: any) => void} */ patch) =>
            async (/** @type {import("@playwright/test").Route} */ route) => {
                const response = await route.fetch();
                if (route.request().method() !== "GET" || response.status() !== 200) {
                    return route.fulfill({ response });
                }
                const json = await response.json();
                patch(json);
                return route.fulfill({ response, json });
            };
        await context.route(
            "**/profiles/tourism/profile-bundle.json**",
            rewrite((bundle) => patchStatut(bundle.layerConfigs?.sites_rosario))
        );
        await context.route(
            "**/layers/sites_rosario/sites_rosario_config.json**",
            rewrite((cfg) => patchStatut(cfg))
        );
        await context.route(`**${LIST_PATH}`, (route) =>
            offline ? route.abort("internetdisconnected") : route.fulfill({ json: LIST })
        );

        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20_000 });
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Storage.whenReady());

        // The preparation, online — the real one, as the offline window's button runs it.
        const kept = await page.evaluate(async (path) => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            await gl.Storage.CacheManager.cacheProfile("tourism", {
                selection: { layers: ["sites_rosario"], basemaps: [], includeTiles: false },
            });
            // Read the STORE, not `resolveOptions`: resolving online keeps a list by itself — the
            // second writer — and would hide a preparation that kept nothing.
            const key = "offline.optionList:" + new URL(path, document.baseURI).href;
            return (await gl.Storage.DB.getPreference(key, null))?.options ?? null;
        }, LIST_PATH);
        expect(kept, "the preparation kept no list").toEqual(LIST);

        // Arm the editor ONLINE: service workers are blocked, so its lazy modules (the plugin,
        // then the drawing engine on the first tool) could not load once the network is cut —
        // an application in use has them already.
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

        await goOffline(context, page);
        offline = true;
        const asked = recordRequests(context, { filter: (url) => url.includes(LIST_PATH) });

        // Open a creation form on `sites_rosario` — the path specs 39 and 53 take.
        await page.locator(".maplibregl-canvas").click({ position: { x: 250, y: 180 } });
        await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 10_000 });
        await page.locator(".gl-form-modal__layer select").selectOption("sites_rosario");

        // The list is offered — the three choices, not the placeholder alone.
        const statut = page.locator("select#gl-field-statut");
        await expect(statut).toBeVisible({ timeout: 10_000 });
        await expect
            .poll(
                async () =>
                    statut.evaluate((/** @type {HTMLSelectElement} */ el) =>
                        [...el.options].map((o) => o.value).filter(Boolean)
                    ),
                { timeout: 10_000 }
            )
            .toEqual(LIST.map((o) => o.value));

        asked.stop();
        expect(asked.urls, "the list was asked of the network while it was cut").toEqual([]);
    });
});
