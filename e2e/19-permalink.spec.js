// @ts-check
// E2E permalink restore/sync in a real browser (software WebGL).
//
// Validates the refactored permalink hot-path (helper extraction, 0
// behaviour change) end to end on deploy-core (tourism profile,
// ui.permalink.enabled = true, hash mode):
//   - _parseParams (verbose, all fields)   → readUrl at boot (hook 1)
//   - applyState (immediate view)          → centre/zoom restore at boot (hook 2)
//   - _applyLayersAndFilter (text filter)  → _applyPermalinkTextFilter (deferred theme:applied)
//   - _captureState + buildUrl + startSync → URL write on move
//
// The exhaustive per-value coverage (validation/caps/anti-XSS, compact) is
// in Vitest (__tests__/ui/permalink*, __tests__/security/permalink-injection).
// Here the real chain is confirmed through STABLE anchors (GeoLeaf.Permalink
// API, native maplibregl state, DOM input value) — no pixel assertion.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/** Boot the map and wait until GeoLeaf has resolved a native maplibregl.Map. */
// Contract: style live, NO goto — these tests navigate with their own params first.
async function waitMapStyleReady(page) {
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(
        () => {
            const m = /** @type {any} */ (window).GeoLeaf;
            const native = m?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.getStyle === "function" && native.getStyle());
        },
        null,
        { timeout: 20000 }
    );
}

test.describe("19 — permalink restore/sync (état map/DOM réel)", () => {
    // ── _parseParams + applyState: the view is restored from the URL at boot ─────
    test("restore: une URL #gl_lat/lng/zoom restaure le centre + le zoom de la carte", async ({
        page,
    }) => {
        // IN-BOUNDS coordinates (tourism profile: lat [-55,-21.78],
        // lng [-73.5,-53.5]), distinctive from the default centre
        // (~-38.4,-63.5) and the fit zoom.
        await page.goto("/#gl_lat=-48&gl_lng=-58&gl_zoom=8");
        await waitMapStyleReady(page);

        // applyStoredState (hook 2) calls map.setView immediately; wait for
        // the native centre to converge on the permalink's coordinates
        // (≠ profile view).
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                const c = native.getCenter();
                return (
                    Math.abs(c.lat - -48) < 0.3 &&
                    Math.abs(c.lng - -58) < 0.3 &&
                    Math.abs(native.getZoom() - 8) < 0.6
                );
            },
            null,
            { timeout: 20000 }
        );

        const view = await page.evaluate(() => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const c = native.getCenter();
            return { lat: c.lat, lng: c.lng, zoom: native.getZoom() };
        });
        expect(view.lat).toBeCloseTo(-48, 1);
        expect(view.lng).toBeCloseTo(-58, 1);
        expect(view.zoom).toBeCloseTo(8, 0);
    });

    // ── _parseParams: every verbose field is parsed (lists + scalars) ────────────
    test("parse: GeoLeaf.Permalink.getState() reflète tous les champs de l'URL", async ({
        page,
    }) => {
        await page.goto(
            "/#gl_lat=45.5&gl_lng=-73.6&gl_zoom=10&gl_layers=alpha,beta&gl_filter=parc&gl_rating=3"
        );
        await waitMapStyleReady(page);

        const state = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Permalink.getState()
        );
        expect(state).not.toBeNull();
        expect(state.lat).toBeCloseTo(45.5, 3);
        expect(state.lng).toBeCloseTo(-73.6, 3);
        expect(state.zoom).toBe(10);
        // _parseListStateFields (split/trim/cap)
        expect(state.layers).toEqual(["alpha", "beta"]);
        // _parseScalarStateFields (texte + note)
        expect(state.filter).toBe("parc");
        expect(state.rating).toBe(3);
    });

    // ── _applyLayersAndFilter → _applyPermalinkTextFilter: text filter restored ──
    test("restore: gl_filter réinjecte la valeur dans le champ de recherche", async ({ page }) => {
        await page.goto("/#gl_lat=12.34&gl_lng=56.78&gl_zoom=7&gl_filter=montagne");
        await waitMapStyleReady(page);

        // _applyLayersAndFilter is deferred to the boot's
        // geoleaf:theme:applied; wait for the value to be re-injected into
        // the searchText input (real or ghost).
        await page.waitForFunction(
            () => {
                const input = /** @type {HTMLInputElement|null} */ (
                    document.querySelector('[data-gl-filter-id="searchText"] input[type="text"]')
                );
                return !!input && input.value === "montagne";
            },
            null,
            { timeout: 20000 }
        );
        const value = await page.evaluate(
            () =>
                /** @type {HTMLInputElement} */ (
                    document.querySelector('[data-gl-filter-id="searchText"] input[type="text"]')
                ).value
        );
        expect(value).toBe("montagne");
    });

    // ── _captureState + buildUrl + startSync: a move writes the URL ──────────────
    test("sync: un déplacement de la carte sérialise l'état dans l'URL", async ({ page }) => {
        await page.goto("/");
        await waitMapStyleReady(page);
        const before = await page.evaluate(() => window.location.hash);

        // startSync is attached at boot (hook 2). The map is moved to
        // distinctive IN-BOUNDS coordinates via the adapter API (same path
        // as production).
        await page.evaluate(() => {
            /** @type {any} */ (window).GeoLeaf.Core.getMap().setView({ lat: -45, lng: -60 }, 5);
        });

        // The write is debounced (~400 ms) via history.replaceState → window.location.hash.
        await page.waitForFunction(
            (prev) => /gl_zoom=5\b/.test(window.location.hash) && window.location.hash !== prev,
            before,
            { timeout: 8000 }
        );

        const hash = await page.evaluate(() => window.location.hash);
        expect(hash).toMatch(/gl_lat=-4[0-9]/); // ~ -45 (captured from the map)
        expect(hash).toMatch(/gl_lng=-[56][0-9]/); // ~ -60
        expect(hash).toMatch(/gl_zoom=5\b/);
        expect(hash).not.toBe(before);
    });
});
