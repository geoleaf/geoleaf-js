// @ts-check
// Config-contract Phase C / C3 — targeted E2E (real map/DOM state) for the B4
// config family (basemaps / themes / taxonomy), on deploy-core (tourism profile).
//
// The EXHAUSTIVE per-value coverage lives in Vitest (__tests__/config/s12-*):
// each basemap type (tile/raster/maplibre/image/hillshade/wmts/wms) → layer
// created, terrain/hillshade/wms defaults, themes _validateConfig, getIconsConfig
// + TaxonomyManager. Here we only confirm, in a real browser (SwiftShader
// software WebGL rendering), that the config → effect chain holds end to end for
// the deployed profile, through STABLE anchors (source/layer ids = code
// constants, theme selectors = code classes) — no pixel assertion.
//
// Scope decision: assertions on map/DOM state, no screenshot/pixel comparison
// (fragile under headless SwiftShader).
//
// The `cfg-` prefix marks the config-contract spec family.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/** Boot the map and wait until GeoLeaf has resolved a native maplibregl.Map. */
// Contract: goto + shared-boot contract (visible + live style).
async function bootMapStyleReady(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    // ⚠️ The signature is `waitForFunction(fn, arg, options)`: the options MUST be
    // the 3rd argument. Passed 2nd, they are serialised as `arg` and the wait
    // silently falls back onto the default timeout (`actionTimeout` — value in
    // `playwright.config.js`, not to be copied here: it moved on 2026-08-01).
    await page.waitForFunction(
        () => {
            const m = /** @type {any} */ (window).GeoLeaf;
            const native = m?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.getStyle === "function" && native.getStyle());
        },
        undefined,
        { timeout: 20000 }
    );
}

/** Read the native map style sources/layers + terrain + registered images. */
async function readMapState(page) {
    return page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const style = native.getStyle() || {};
        let images;
        try {
            images = typeof native.listImages === "function" ? native.listImages() : [];
        } catch {
            images = [];
        }
        let terrain;
        try {
            terrain = typeof native.getTerrain === "function" ? native.getTerrain() : null;
        } catch {
            terrain = null;
        }
        return {
            sourceIds: Object.keys(style.sources || {}),
            layerIds: (style.layers || []).map((l) => l.id),
            images,
            hasTerrain: !!terrain,
        };
    });
}

test.describe("cfg-c3 — basemaps/themes/taxonomy (état map/DOM réel)", () => {
    // ── basemaps[].type tile → basemap layer actually created ──────────────────
    test("basemaps: la couche de fond est ajoutée à la carte native", async ({ page }) => {
        await bootMapStyleReady(page);
        // The raster basemap is injected below the data layers (registry.ts BASEMAP_*_ID).
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                const style = native.getStyle() || {};
                const hasSource = !!(style.sources && style.sources["__geoleaf_basemap__"]);
                const hasLayer = (style.layers || []).some(
                    (l) => l.id === "__geoleaf_basemap_layer__"
                );
                return hasSource || hasLayer;
            },
            undefined,
            { timeout: 15000 }
        );
        const state = await readMapState(page);
        expect(
            state.sourceIds.includes("__geoleaf_basemap__") ||
                state.layerIds.includes("__geoleaf_basemap_layer__")
        ).toBeTruthy();
    });

    // ── 3D terrain: the default basemap (terrain-terrarium, default3D) ──────────
    test("terrain 3D: le relief est activé pour le basemap par défaut", async ({ page }) => {
        await bootMapStyleReady(page);
        // terrain-terrarium has default3D:true → setTerrain + raster-dem source "terrain-dem".
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                const style = native.getStyle() || {};
                const hasDem = !!(style.sources && style.sources["terrain-dem"]);
                let terrain;
                try {
                    terrain = native.getTerrain ? native.getTerrain() : null;
                } catch {
                    terrain = null;
                }
                return hasDem || !!terrain;
            },
            undefined,
            { timeout: 15000 }
        );
        const state = await readMapState(page);
        expect(state.hasTerrain || state.sourceIds.includes("terrain-dem")).toBeTruthy();
    });

    // ── taxonomy.icons: sprite resolved/injected + icons registered ─────────────
    test("taxonomy: le sprite profil est injecté et des icônes sont enregistrées", async ({
        page,
    }) => {
        // Capture BEFORE any page script: both theme-engine events fire DURING
        // boot, so subscribing after `goto()` misses them. Both are dispatched on
        // `document` with a `{ themeId }` detail — `geoleaf:theme:applying`
        // SYNCHRONOUSLY on entering `applyTheme`
        // (kernel/themes/theme-applier/core.ts), `geoleaf:theme:applied` at
        // the end of its last layer batch (core.ts). They are the only two
        // emitters of these names in the repo.
        await page.addInitScript(() => {
            const w = /** @type {any} */ (window);
            w.__glThemeEvents = { applying: [], applied: [] };
            document.addEventListener("geoleaf:theme:applying", (ev) => {
                const id = /** @type {any} */ (ev).detail?.themeId;
                if (typeof id === "string") w.__glThemeEvents.applying.push(id);
            });
            document.addEventListener("geoleaf:theme:applied", (ev) => {
                const id = /** @type {any} */ (ev).detail?.themeId;
                if (typeof id === "string") w.__glThemeEvents.applied.push(id);
            });
        });

        await bootMapStyleReady(page);

        // 🛑 THE PROXY MAPLIBRE 6 TIPPED OVER — "the theme button exists" descends
        // from `revealApp()` (app/init-reveal.ts), and `revealApp()` is armed by
        // an OR one branch of which is a
        //
        // ⚠️ A first draft of this comment ALSO attributed `#geoleaf-map` being
        // visible to `revealApp()`. That is wrong, and re-read in the code:
        // `#geoleaf-map` is static markup (`apps/geoleaf-app/index.html`), styled
        // `position:absolute; inset:0` (`css/geoleaf-ui-base.css`) — visible from
        // the first layout on. What depends on `revealApp()` is the clearing of
        // `#gl-loader`, a DISTINCT overlay (`position:fixed; z-index:9999`), and
        // Playwright's `toBeVisible()` does not account for occlusion. Only the
        // SECOND proxy is concerned. The fix stays right; its explanation was
        // wrong, and a wrong mechanism makes someone redo the bad diagnosis six
        // months later.
        // TIMER: it listens to `geoleaf:theme:applied` (line 161) *and* arms
        // `setTimeout(revealApp, 5000)` as a safety net (line 177). The same
        // `revealApp()` dispatches `geoleaf:app:ready`, and it is that event —
        // and it alone, `{ once: true }` — that MOUNTS the theme bar
        // (capabilities/theme-selector/lifecycle.ts).
        //
        // Consequence: as soon as boot exceeds 5 s, the buttons become clickable
        // WHILE `ThemeEngineModule` is still applying the default theme. The 8
        // "environnement" layers (config/core/themes.json) are then in flight,
        // and a click opens a SECOND `applyTheme` on the same `_ThemeApplier`
        // singleton, whose first gesture is `_hideAllLayers()` +
        // `resetAllUserOverrides()` (theme-applier/visibility.ts). The click
        // itself moreover lands on a saturated main thread — the measured cause
        // of the `locator.click: Timeout` already documented in
        // playwright.config.js.
        //
        // And MapLibre 6 pushes boot precisely toward that 5 s threshold: the
        // engine went from one file to a GRAPH of 3 modules loaded in cascade,
        // i.e. two more serialised requests before the first profile byte
        // departs.
        //
        // So we wait for the STATE actually used — the applier has committed the
        // default theme, it is at rest — instead of the reveal, which can be a
        // mere timer. "environnement" is profiles/tourism's `config.defautTheme`
        // (same anchor as the "themes" test below).
        await page.waitForFunction(
            () =>
                /** @type {any} */ (window).__glThemeEvents?.applied?.includes("environnement") ===
                true,
            undefined,
            { timeout: 20000 }
        );

        // profile-sprite-loader injects <svg data-geoleaf-sprite="profile">
        // (icons.spriteUrl). A SINGLE copy: the loader is called once PER LAYER
        // and every consumer (legend-symbols, maplibre-poi-icons,
        // isProfileSpriteReady) reads it via `document.querySelector` — several
        // roots and they resolve against an arbitrary copy. `toHaveCount(1)`
        // locks uniqueness on top of presence (the previous `toBeAttached` could
        // not even evaluate: 40 roots = strict mode violation).
        const sprite = page.locator('svg[data-geoleaf-sprite="profile"]');
        await expect(sprite).toHaveCount(1, { timeout: 15000 });
        const symbolCount = await sprite.locator("symbol").count();
        expect(symbolCount).toBeGreaterThan(0);

        // ⚠️ PRECONDITION to establish explicitly — it was missing, and that is
        // what reddened the rest of the test. It is NOT the sprite-injection
        // memoisation: that removes no `registerSpriteIcons` call (each caller
        // still chains its own `.then()`), and the switch below does register
        // its 38 `tourism-poi-cat-*` images WITH the memoisation in place.
        //
        // `map.addImage` is only called by `ensureLayerSpriteIcons`
        // (maplibre-poi-icons.ts), which returns immediately when the data
        // carries NO `symbolId` feature — and `symbolId` is only injected
        // (`loader/single-layer.ts`, `injectSymbolIds`) for a
        // `showIconsOnMap: true` layer. Yet tourism's DEFAULT theme
        // ("environnement": aires_protegees_nationales_sib,
        // zones_de_conservation_wdpa, sites_de_conservation_wdpa — explicitly
        // `false` —, provinces, routes_principales, villes_principales) contains
        // none: the profile's only 3 are `cultures` and `hebergements` (theme
        // "tourisme") and `sites_rosario` (outside any theme). The test thus
        // expected an effect whose cause it had never set.
        //
        // We switch to "tourisme": exactly the scenario `ensureLayerSpriteIcons`
        // documents ("a POI layer loaded without a basemap change (e.g. a
        // data-theme switch) would render no icons"). The assertion itself is
        // unchanged.
        const tourisme = page.locator('.gl-theme-btn[data-theme-id="tourisme"]');
        await expect(tourisme).toBeVisible({ timeout: 10000 });
        await tourisme.click();

        // Did the click REACH `ThemeSelector.setTheme`? `geoleaf:theme:applying`
        // is dispatched in the same turn as the handler (core.ts, before any
        // await), so its absence signs a swallowed click — not a broken icon
        // registrar. Without this anchor point, the failure landed 15 s later on
        // `listImages()`, naming the wrong cause: exactly the documented failure
        // mode.
        await page.waitForFunction(
            () =>
                /** @type {any} */ (window).__glThemeEvents?.applying?.includes("tourisme") ===
                true,
            undefined,
            { timeout: 10000 }
        );

        // maplibre-poi-icons registers each <symbol id> via map.addImage →
        // taxonomy.icons.symbolPrefix prefix ("tourism-poi-cat-").
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                let imgs;
                try {
                    imgs = native.listImages ? native.listImages() : [];
                } catch {
                    imgs = [];
                }
                return imgs.some((id) => String(id).startsWith("tourism-poi-cat-"));
            },
            undefined,
            { timeout: 15000 }
        );
        const state = await readMapState(page);
        expect(state.images.some((id) => String(id).startsWith("tourism-poi-cat-"))).toBeTruthy();
    });

    // ── themes: default theme applied + primary switch (DOM state) ──────────────
    test("themes: thème par défaut actif puis bascule primary (sélecteur)", async ({ page }) => {
        await bootMapStyleReady(page);
        const primary = page.locator(".gl-theme-selector-primary");
        await expect(primary).toBeAttached({ timeout: 15000 });

        // tourism: defaultTheme "environnement" → button active at boot.
        const active = page.locator(".gl-theme-btn--active");
        await expect(active).toHaveAttribute("data-theme-id", "environnement", { timeout: 10000 });

        // Switch to another primary theme ("tourisme") → the active one follows the click.
        const target = page.locator('.gl-theme-btn[data-theme-id="tourisme"]');
        await expect(target).toBeVisible({ timeout: 10000 });
        await target.click();
        await expect(target).toHaveClass(/gl-theme-btn--active/, { timeout: 10000 });
        await expect(page.locator('.gl-theme-btn[data-theme-id="environnement"]')).not.toHaveClass(
            /gl-theme-btn--active/
        );
    });
});
