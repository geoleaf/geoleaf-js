/**
 * The endpoint markers of a route follow their layer — first browser test of the `route` capability.
 *
 * ## The defects
 *
 * 1. **Hidden layer, markers still there.** Switching the decorated layer off in the layer manager
 *    hid the line, but the endpoint sub-layer stayed visible: markers without a line, which misread
 *    the map. The capability listened to no visibility change.
 * 2. **Drawn under everything.** The endpoint sub-layer was inserted at the bottom of GeoLeaf's
 *    layers (rank 1, the decorated layer at 14 to 16): the layer's own grey points covered the
 *    coloured start / end markers.
 * 3. **`gl-` twice.** The sub-layer id was built `gl-route-<id>-endpoints`, and the adapter
 *    prefixes `gl-` again: `gl-gl-route-<id>-endpoints-circle` in the style.
 *
 * `parcours` of the `tourism` profile is decorated by the profile; no theme shows it, so the spec
 * adds it to the default theme by rewriting the served bundle, and counts the rewrites.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({
    baseURL: baseURL("core"),
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
});

const LAYER = "parcours";

/** @param {import('@playwright/test').Page} page */
function state(page) {
    return page.evaluate((layer) => {
        const m = /** @type {any} */ (window).GeoLeaf.Core.getAdapter().getNativeMap();
        const ids = m.getStyle().layers.map((l) => l.id);
        const endpoints = ids.filter((id) => id.includes(`route-${layer}-endpoints`));
        const own = ids.filter((id) => id.startsWith(`gl-${layer}-`));
        return {
            endpoints,
            endpointsRank: Math.min(...endpoints.map((id) => ids.indexOf(id))),
            ownTopRank: Math.max(...own.map((id) => ids.indexOf(id))),
            visible: /** @type {any} */ (window).GeoLeaf.Layers.isVisible(layer),
            endpointsVisibility: endpoints.map(
                (id) => m.getLayoutProperty(id, "visibility") ?? "visible"
            ),
        };
    }, LAYER);
}

/** @param {import('@playwright/test').Page} page */
async function toggleInLayerManager(page) {
    // A click on the already-active tab folds the panel: open it only when it is not selected.
    const tab = page.locator("#gl-rp-tab-layers");
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    const toggle = page.locator(
        `#gl-rp-pane-layers [data-layer-id='${LAYER}'] .gl-layer-manager__item-toggle`
    );
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    // The button drops a click that follows the previous one within its anti-double-click
    // window: click again until it has flipped, never assume the first click took.
    const want = (await toggle.getAttribute("aria-pressed")) === "true" ? "false" : "true";
    await expect(async () => {
        if ((await toggle.getAttribute("aria-pressed")) !== want) await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", want, { timeout: 500 });
    }).toPass({ timeout: 10_000 });
}

test("les marqueurs de route suivent leur couche, au-dessus d'elle, sans double préfixe", async ({
    page,
    context,
}) => {
    let routed = 0;
    await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const theme = bundle.themes?.themes?.find((t) => t.id === bundle.themes.defaultTheme);
        if (!theme) throw new Error("le bundle n'a plus de thème par défaut");
        theme.layers.push({ id: LAYER, visible: true, style: "defaut" });
        routed++;
        await route.fulfill({ json: bundle });
    });
    await installSignals(page);
    await bootPage(page);
    expect(routed, "la retouche du profil n'a pas mordu").toBeGreaterThan(0);
    await expect
        .poll(async () => (await state(page)).endpoints.length, { timeout: 15_000 })
        .toBeGreaterThan(0);

    const shown = await state(page);
    expect(
        shown.endpoints.every((id) => !id.startsWith("gl-gl-")),
        shown.endpoints.join(", ")
    ).toBe(true);
    expect(shown.endpointsRank, "marqueurs sous la couche qu'ils décorent").toBeGreaterThan(
        shown.ownTopRank
    );

    await toggleInLayerManager(page);
    await expect.poll(async () => (await state(page)).visible).toBe(false);
    await expect
        .poll(async () => (await state(page)).endpointsVisibility.every((v) => v === "none"))
        .toBe(true);

    await toggleInLayerManager(page);
    await expect.poll(async () => (await state(page)).visible).toBe(true);
    await expect
        .poll(async () => (await state(page)).endpointsVisibility.every((v) => v === "visible"))
        .toBe(true);
});
