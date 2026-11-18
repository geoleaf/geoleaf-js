// @ts-check
// A layer whose data is written INLINE (`inlineData`), off the default theme, is created by the
// theme that shows it — and its data written afterwards by `Layers.setData` is displayed.
// Measured on the delivered bundle, in the real engine.
//
// 🛑 THE DEFECT. Smart loading creates at boot only the layers the default theme shows; every
// other one is created by the theme engine when a theme showing it is applied. That engine
// resolved ADDRESSES only (`data.url` of a plugin, `data.dataUrl`, `vectorTiles.tilesUrl`,
// `dataFile`): an inline layer resolved to nothing, its configuration went to the pending map,
// and waited for a registration nobody would make. The layer never existed, under any theme, and
// nothing said so. The boot loader, meanwhile, accepted the very same layer.
//
// ⚠️ WHY NO EXISTING SPEC SAW IT. `91-remount-layers-wait-for-style` rewrites layers to
// `inlineData` too, but asserts only the DEFAULT theme's: those go through the boot loader.
//
// THE FIXTURE. The tourism bundle is rewritten: `zones` (a polygon layer in no theme) carries an
// empty `inlineData`, as a host that fills its layers itself writes them; it is declared hidden
// in the default theme and shown in `tourisme`. `hebergements`, an address-backed layer shown by
// `tourisme` only, is the control: its behaviour must not change.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { selectProfile } from "./helpers/boot.js";
import { BOOT_TIMEOUT, bootPage, installSignals } from "./helpers/mount.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const PROFILE = "tourism";
const INLINE = "zones";
const BY_ADDRESS = "hebergements";
const THEME_B = "tourisme";

/** One polygon, written by the "host" once the layer exists. */
const FEATURES = [
    {
        type: "Feature",
        id: "e2e-inline-1",
        properties: { nom: "Zone e2e", categorie: "etude" },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [-60.7, -32.98],
                    [-60.66, -32.98],
                    [-60.66, -32.95],
                    [-60.7, -32.95],
                    [-60.7, -32.98],
                ],
            ],
        },
    },
];

/**
 * Rewrites the tourism bundle as described in the header. Throws when the bundle no longer has
 * the shape the spec relies on — a spec that silently stopped biting is worse than a red one.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<{ routed: () => number, defaultTheme: () => string }>}
 */
async function routeInlineLayer(context) {
    let routed = 0;
    let defaultTheme = "";
    await context.route(`**/profiles/${PROFILE}/profile-bundle.json**`, async (route) => {
        const bundle = await (await route.fetch()).json();
        const layer = bundle.layerConfigs?.[INLINE];
        if (!layer) throw new Error(`le bundle ne porte plus la couche \`${INLINE}\``);
        if (layer.data) {
            delete layer.data.file;
            delete layer.data.dataUrl;
            delete layer.data.format;
        }
        delete layer.url;
        delete layer.dataFile;
        delete layer.offline;
        delete layer.write;
        layer.inlineData = { type: "FeatureCollection", features: [] };

        const themes = bundle.themes?.themes ?? [];
        defaultTheme = bundle.themes?.defaultTheme;
        const a = themes.find((t) => t.id === defaultTheme);
        const b = themes.find((t) => t.id === THEME_B);
        if (!a || !b || a === b) {
            throw new Error(`le bundle n'a plus deux thèmes distincts (défaut, ${THEME_B})`);
        }
        if (a.layers.some((l) => l.id === BY_ADDRESS && l.visible !== false)) {
            throw new Error(`\`${BY_ADDRESS}\` est visible au thème par défaut : témoin perdu`);
        }
        for (const t of themes) t.layers = t.layers.filter((l) => l.id !== INLINE);
        a.layers.push({ id: INLINE, visible: false, style: "defaut" });
        b.layers.push({ id: INLINE, visible: true, style: "defaut" });
        routed++;
        await route.fulfill({ json: bundle });
    });
    return { routed: () => routed, defaultTheme: () => defaultTheme };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
function layerState(page, id) {
    return page.evaluate((layerId) => {
        const L = /** @type {any} */ (window).GeoLeaf.Layers;
        const exists = L.hasLayer(layerId);
        return {
            exists,
            visible: exists ? L.isVisible(layerId) === true : false,
            count: exists ? L.getFeatureCount(layerId) : 0,
        };
    }, id);
}

/**
 * Features the ENGINE holds for the layer — what is drawn, not what the registry claims.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
function engineFeatureCount(page, id) {
    return page.evaluate((layerId) => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const sources = Object.keys(native.getStyle()?.sources ?? {}).filter((s) =>
            s.includes(layerId)
        );
        return sources.reduce((n, s) => n + native.querySourceFeatures(s).length, 0);
    }, id);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} themeId
 */
async function applyTheme(page, themeId) {
    const button = page.locator(`.gl-theme-btn[data-theme-id="${themeId}"]`);
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
    await expect(page.locator(".gl-theme-btn--active")).toHaveAttribute("data-theme-id", themeId, {
        timeout: 15_000,
    });
}

test("a theme creates the inline layer it shows, hides it on leaving, and displays its later data", async ({
    page,
    context,
}) => {
    test.setTimeout(120_000);
    const { routed, defaultTheme } = await routeInlineLayer(context);
    await selectProfile(page, PROFILE);
    await installSignals(page);
    await bootPage(page);

    // Non-vacuity: the bundle was rewritten, and neither layer is created at boot — otherwise the
    // theme engine is not the path under test.
    expect(routed(), "le bundle du profil n'a pas été réécrit").toBeGreaterThan(0);
    expect((await layerState(page, INLINE)).exists, "boot: inline layer").toBe(false);
    expect((await layerState(page, BY_ADDRESS)).exists, "boot: address layer").toBe(false);

    // Theme B: both layers exist and are painted.
    await applyTheme(page, THEME_B);
    await expect
        .poll(() => layerState(page, BY_ADDRESS), { timeout: BOOT_TIMEOUT })
        .toMatchObject({ exists: true, visible: true });
    await expect
        .poll(() => layerState(page, INLINE), {
            message: `theme ${THEME_B}: the inline layer is never created`,
            timeout: BOOT_TIMEOUT,
        })
        .toMatchObject({ exists: true, visible: true });

    // The host writes the layer's data: it is held and drawn.
    await page.evaluate(
        ({ id, features }) => /** @type {any} */ (window).GeoLeaf.Layers.setData(id, features),
        { id: INLINE, features: FEATURES }
    );
    await expect.poll(() => layerState(page, INLINE)).toMatchObject({ count: FEATURES.length });
    await expect
        .poll(() => engineFeatureCount(page, INLINE), { timeout: 15_000 })
        .toBeGreaterThan(0);

    // Back to the default theme: the inline layer is hidden, the address layer too.
    await applyTheme(page, defaultTheme());
    await expect
        .poll(() => layerState(page, INLINE))
        .toMatchObject({ exists: true, visible: false });
    await expect
        .poll(() => layerState(page, BY_ADDRESS))
        .toMatchObject({ exists: true, visible: false });
});
