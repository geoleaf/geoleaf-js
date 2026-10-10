// @ts-check
/**
 * 76 — A BASEMAP THE OFFLINE PREPARATION WILL REFUSE SAYS SO IN THE SELECTOR
 *
 * 🛑 THE DEFECT THIS SPEC EXISTS FOR. The offline preparation downloads ahead of use only from
 * an origin declared for it (`modules.offline.dataOrigins`, `cacheable` and `prefetch`). The
 * selector of `@geoleaf-plugins/offline-ui` did not know that rule: a basemap marked
 * `offline: true` on an origin nobody declared was listed, ticked, counted in the size
 * estimate — and left out by the download, with a console warning. The user left believing
 * the basemap prepared. Read red on the bundle built before the fix: the row of the undeclared
 * basemap was a row like any other.
 *
 * The row now asks the core (`GeoLeaf.Storage.prefetchVerdict`) and says the refusal where the
 * choice is made: greyed, unticked, inert, the origin named in its tooltip.
 *
 * ⚠️ THE PROFILE IS REWRITTEN, in the served bundle: no profile of the repository has an
 * offline basemap, and the shipped one switches the tile cache off. Two basemaps are marked
 * for the preparation — one on a declared origin, the witness that the rule is read and not
 * every basemap greyed; one on an origin left undeclared, the subject.
 *
 * ⚠️ WHAT IT DOES NOT PLAY: the download itself, and the notice that names what was left out.
 * That half is held by the plugin's unit suite — a download of tiles from a third party is
 * not something a spec should depend on.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap's tiles are not this spec's subject: their latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** The basemap whose origin the profile declares for the preparation. */
const DECLARED = "street";
/** The basemap whose origin nobody declares. */
const UNDECLARED = "topo";

/**
 * Marks two basemaps for the offline preparation and declares the origin of ONE of them.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ undeclaredHost: string }>} the host the undeclared basemap is served from.
 */
async function armBasemaps(page) {
    const seen = { undeclaredHost: "" };
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const basemaps = bundle.basemaps?.basemaps ?? {};
        const declared = basemaps[DECLARED];
        const undeclared = basemaps[UNDECLARED];
        if (!declared?.url || !undeclared?.url) {
            throw new Error("le bundle ne porte plus les deux fonds de cette spec");
        }
        const zone = {
            offline: true,
            offlineBounds: { north: -32.9, south: -33.0, east: -60.6, west: -60.7 },
            cacheMinZoom: 10,
            cacheMaxZoom: 11,
        };
        Object.assign(declared, zone);
        Object.assign(undeclared, zone);
        seen.undeclaredHost = new URL(String(undeclared.url).replace("{s}", "a")).hostname;
        bundle.modules = bundle.modules ?? {};
        bundle.modules.offline = {
            ...(bundle.modules.offline ?? {}),
            enabled: true,
            cache: { ...(bundle.modules.offline?.cache ?? {}), enableTileCache: true },
            dataOrigins: [
                // ⚠️ `roles` is not decoration: a declaration without one is DROPPED by the core,
                // and the witness below then reads the declared basemap as refused too.
                {
                    origin: new URL(declared.url).origin,
                    roles: ["tiles"],
                    cacheable: true,
                    prefetch: true,
                },
            ],
        };
        await route.fulfill({ json: bundle });
    });
    return seen;
}

test("[offline] le sélecteur dit qu'un fond ne sera pas préparé, faute d'origine déclarée", async ({
    page,
}) => {
    const seen = await armBasemaps(page);
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 20000 });

    await page.locator('[data-gl-toolbar-action="offline-ui"]').first().click();
    await expect(page.locator("#gl-cache-modal")).toBeVisible({ timeout: 8000 });

    // The rows are built asynchronously, once the profile's layers have been read.
    const declared = page.locator(`#geoleaf-cache-basemap-${DECLARED}`);
    const undeclared = page.locator(`#geoleaf-cache-basemap-${UNDECLARED}`);
    await expect(declared).toBeAttached({ timeout: 20000 });
    await expect(undeclared).toBeAttached({ timeout: 20000 });

    // --- the witness: the rule is READ, a declared origin stays offered -------------------------
    await expect(declared, "le fond d'une origine déclarée n'est plus proposé").toBeEnabled();
    await expect(declared).toBeChecked();
    const declaredRow = page.locator("tr.gl-cache-layers__row", { has: declared });
    await expect(declaredRow).not.toHaveAttribute("data-origin-refused", /.+/);

    // --- the subject ----------------------------------------------------------------------------
    // 🛑 THE HEADLINE. Read red on the bundle built before the fix: enabled, and ticked.
    await expect(
        undeclared,
        "un fond que la préparation refusera est proposé comme les autres"
    ).toBeDisabled();
    await expect(undeclared).not.toBeChecked();
    const row = page.locator("tr.gl-cache-layers__row", { has: undeclared });
    await expect(row).toHaveAttribute("data-origin-refused", "undeclared");
    // The motive names the origin: "not prepared" alone does not say what to declare.
    expect(seen.undeclaredHost, "l'hôte du fond non déclaré n'a pas été relevé").not.toBe("");
    await expect(row).toHaveAttribute(
        "title",
        new RegExp(seen.undeclaredHost.replace(/\./g, "\\."))
    );
});
