// @ts-check
// E2E feature-info — CORE CAPABILITY
// (`packages/core/src/capabilities/feature-info/`) on deploy-coverage
// (port 8769).
//
// ⚠️ feature-info is NOT a plugin. No `@geoleaf-plugins/feature-info` package
// exists: it is an in-core capability, installed by
// `capabilities/feature-info/install.ts` and mounted on `GeoLeaf.FeatureInfo`
// by its `registerGlobals` (install.ts). An earlier header of this file
// announced a plugin — that was wrong, fixed here.
//
// End-to-end guard of the three GeoJSON attribute surfaces: tooltip (hover),
// popup (click) and side-panel ("Voir plus"), driven by the kernel seam
// `geoleaf:feature:hover` / `geoleaf:feature:click`
// (capabilities/feature-info/lifecycle.ts).
//
// Selectors actually emitted by the code (verified by inspection):
//   - tooltip   → `.gl-fi-tooltip`      (surfaces/tooltip.ts)
//   - popup     → `.gl-fi-popup-ml`     (MapLibre envelope, surfaces/popup.ts)
//                 containing `.gl-poi-popup` (content root, render/popup-content.ts)
//   - close     → Escape key            (surfaces/popup.ts)
// The popup is built with `closeButton: false` (popup.ts): there IS NO
// close button. The `.gl-fi-popup` and `.gl-fi-close` classes this spec used
// to target are emitted NOWHERE (grep = 0) — those three tests could not
// pass.
//
// Target: deploy-coverage (port 8769), `tourism` profile
// (deploy/deploy-core/profiles/geoleaf.config.json → data.activeProfile).
// `npm run build:deploy-coverage` must have run before this spec.
//
// `serviceWorkers: 'block'`: keeps the PWA SW from mediating the load.
//
// Browser run: `E2E_TARGET=nginx` targets the persistent vhosts and launches
// NO server (e2e/helpers/base-url.js); the `ports` default stays the
// reference target, the CI one.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { registerCoverageCollection } from "./helpers/coverage.js";
import { bootMapUntilLoaded } from "./helpers/boot.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

// This spec already TARGETED the instrumented variant without ever yielding
// its coverage: the bundle was measured, the data thrown away at page close.
// The wiring below pours it in. ⚠️ It only has value since the istanbul
// `include` covers `src/capabilities/**`: before that, the code exercised
// here was OUTSIDE the denominator, and three more dumps would have moved
// nothing.
registerCoverageCollection(test, "feature-info");

// ⚠️ The three render tests below used to target
// `layerId: "reference-points"`, a layer of the `_reference` profile that is
// NOT deployed — the active profile is `tourism`. They thus only passed
// through the IMPLICIT FALLBACK: an unknown layer painted its whole property
// bag. The fallback's removal (2026-08-02) closes precisely that hole — an
// unknown layer must paint nothing. The tests are RE-POINTED at a layer
// really deployed and really declared, which is stronger than before: they
// now prove the full declaration → resolution → render chain.
// ⚠️ The layer must be LOADED at boot, not merely declared: smart loading
// only mounts the default theme's layers, and a declared-but-unmounted layer
// renders `unknown-layer` — hence nothing. This one is verified loaded in a
// real browser against the vhost, with `properties.Name` declared on ALL
// THREE surfaces.
const LAYER = "aires_protegees_nationales_sib";
const FIELD = "Name";
const FIELD_VALUE = "Parc national des Écrins";

/**
 * Dispatches a kernel-seam `CustomEvent` until `selector` shows up in the DOM.
 *
 * The seam is EDGE-triggered, and its listeners are attached by
 * `FeatureInfoLifecycle.init()` — called from `FeatureInfoModule.init()`, which the
 * registry runs in the CAPABILITY pass: `app/boot-install.ts` registers the 6
 * kernel modules first, `app/boot-core.ts` registers the capability ones after
 * them, and `ModuleRegistry.init()` awaits each in that topological order. So the
 * listeners are wired strictly AFTER `UIModule` revealed the map and fired
 * `geoleaf:app:ready`. A single dispatch fired as soon as `.maplibregl-canvas` exists
 * races that wiring and is silently dropped — which is precisely what these tests were
 * doing (the surfaces are created lazily on first event, hence "element(s) not found",
 * not "hidden").
 *
 * Re-dispatching on a bounded poll removes the race WITHOUT touching any assertion:
 * the surface must still appear within the timeout, or the wait fails. Each dispatch is
 * synchronous end-to-end (`showTooltip` / `popup.addTo(map)` insert the node in the same
 * tick), so the very first poll that lands after the wiring returns true — no build-up.
 */
async function dispatchSeamUntil(page, type, detail, selector) {
    await page.waitForFunction(
        (arg) => {
            document.dispatchEvent(new CustomEvent(arg.type, { detail: arg.detail }));
            return !!document.querySelector(arg.selector);
        },
        { type, detail, selector },
        { timeout: 15000, polling: 250 }
    );
}

test.describe("feature-info (capacité core) — surfaces GeoJSON", () => {
    test("capacité chargée — GeoLeaf.FeatureInfo disponible", async ({ page }) => {
        await bootMapUntilLoaded(page);

        // The title always claimed it; the assertion settled for
        // `typeof window.GeoLeaf !== 'undefined'` — true even with the
        // capability absent. The real facade is verified: the 5 methods of
        // `FeatureInfoPublicApi` (types.ts, v2.1.0).
        const api = await page.evaluate(() => {
            const fi = /** @type {any} */ (window).GeoLeaf?.FeatureInfo;
            return fi ? Object.keys(fi).sort() : null;
        });
        expect(api).toEqual(["close", "getConfig", "isEnabled", "openPopup", "openSidePanel"]);
    });

    test("tooltip apparaît au survol d'une feature GeoJSON", async ({ page }) => {
        await bootMapUntilLoaded(page);

        // Dispatch a synthetic geoleaf:feature:hover event (move phase).
        await dispatchSeamUntil(
            page,
            "geoleaf:feature:hover",
            {
                layerId: LAYER,
                featureId: "pt-1",
                properties: { [FIELD]: FIELD_VALUE },
                lngLat: { lat: 48.8, lng: 2.3 },
                point: { x: 200, y: 200 },
                zIndex: 0,
                phase: "move",
            },
            ".gl-fi-tooltip"
        );

        await expect(page.locator(".gl-fi-tooltip")).toBeVisible({ timeout: 3000 });
        await expect(page.locator(".gl-fi-tooltip")).toContainText(FIELD_VALUE);
    });

    test("popup apparaît au clic d'une feature GeoJSON", async ({ page }) => {
        await bootMapUntilLoaded(page);

        await dispatchSeamUntil(
            page,
            "geoleaf:feature:click",
            {
                layerId: LAYER,
                featureId: "pt-1",
                properties: { [FIELD]: FIELD_VALUE },
                geometry: null,
                lngLat: { lat: 42.9, lng: 0.1 },
                point: { x: 300, y: 300 },
            },
            ".gl-fi-popup-ml"
        );

        const popup = page.locator(".gl-fi-popup-ml");
        await expect(popup).toBeVisible({ timeout: 3000 });
        // The content feature-info builds is the `.gl-poi-popup` root, inside
        // the MapLibre envelope.
        await expect(popup.locator(".gl-poi-popup")).toContainText(FIELD_VALUE);
    });

    test("popup se ferme via Échap (le popup est construit closeButton: false)", async ({
        page,
    }) => {
        await bootMapUntilLoaded(page);

        await dispatchSeamUntil(
            page,
            "geoleaf:feature:click",
            {
                layerId: LAYER,
                featureId: "pt-1",
                properties: { [FIELD]: "Sommet" },
                geometry: null,
                lngLat: { lat: 45.0, lng: 6.0 },
                point: { x: 250, y: 250 },
            },
            ".gl-fi-popup-ml"
        );

        await expect(page.locator(".gl-fi-popup-ml")).toBeVisible({ timeout: 3000 });
        // The only keyboard close path: `_keyHandler` on `document`
        // (surfaces/popup.ts) → `closePopup()` → `Popup.remove()`,
        // which detaches the element — hence `toHaveCount(0)` rather than a
        // mere "not visible".
        await page.keyboard.press("Escape");
        await expect(page.locator(".gl-fi-popup-ml")).toHaveCount(0);
    });
});
