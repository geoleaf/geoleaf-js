// @ts-check
// B.6 (batch F) — E2E permalink restore/sync en navigateur réel (WebGL logiciel).
//
// Valide le hot-path permalink refactorisé en B.6 (extraction de helpers, 0
// changement de comportement) de bout en bout sur deploy-core (profil tourism,
// ui.permalink.enabled = true, mode hash) :
//   - _parseParams (verbose, tous champs)  → readUrl au boot (hook 1)
//   - applyState (vue immédiate)           → restauration centre/zoom au boot (hook 2)
//   - _applyLayersAndFilter (filtre texte) → _applyPermalinkTextFilter (deferred theme:applied)
//   - _captureState + buildUrl + startSync → écriture de l'URL sur déplacement
//
// La couverture par-valeur exhaustive (validation/caps/anti-XSS, compact) est en
// Vitest (__tests__/ui/permalink*, __tests__/security/permalink-injection). Ici on
// confirme la chaîne réelle via des ancrages STABLES (API GeoLeaf.Permalink,
// état natif maplibregl, valeur d'input DOM) — pas d'assertion pixel.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/** Boot the map and wait until GeoLeaf has resolved a native maplibregl.Map. */
async function bootMap(page) {
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
    // ── _parseParams + applyState : la vue est restaurée depuis l'URL au boot ────
    test("restore: une URL #gl_lat/lng/zoom restaure le centre + le zoom de la carte", async ({
        page,
    }) => {
        // Coordonnées IN-BOUNDS (profil tourism : lat [-55,-21.78], lng [-73.5,-53.5]),
        // distinctives du centre par défaut (~-38.4,-63.5) et du zoom de fit.
        await page.goto("/#gl_lat=-48&gl_lng=-58&gl_zoom=8");
        await bootMap(page);

        // applyStoredState (hook 2) appelle map.setView immédiatement ; on attend que
        // le centre natif converge vers les coordonnées du permalink (≠ vue profil).
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

    // ── _parseParams : tous les champs verbeux sont parsés (listes + scalaires) ──
    test("parse: GeoLeaf.Permalink.getState() reflète tous les champs de l'URL", async ({
        page,
    }) => {
        await page.goto(
            "/#gl_lat=45.5&gl_lng=-73.6&gl_zoom=10&gl_layers=alpha,beta&gl_filter=parc&gl_rating=3"
        );
        await bootMap(page);

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

    // ── _applyLayersAndFilter → _applyPermalinkTextFilter : filtre texte restauré ─
    test("restore: gl_filter réinjecte la valeur dans le champ de recherche", async ({ page }) => {
        await page.goto("/#gl_lat=12.34&gl_lng=56.78&gl_zoom=7&gl_filter=montagne");
        await bootMap(page);

        // _applyLayersAndFilter est différé au geoleaf:theme:applied du boot ; on attend
        // que la valeur soit réinjectée dans l'input searchText (réel ou ghost).
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

    // ── _captureState + buildUrl + startSync : un déplacement écrit l'URL ────────
    test("sync: un déplacement de la carte sérialise l'état dans l'URL", async ({ page }) => {
        await page.goto("/");
        await bootMap(page);
        const before = await page.evaluate(() => window.location.hash);

        // startSync est attaché au boot (hook 2). On déplace la carte vers des
        // coordonnées IN-BOUNDS distinctives via l'API adaptateur (même chemin prod).
        await page.evaluate(() => {
            /** @type {any} */ (window).GeoLeaf.Core.getMap().setView({ lat: -45, lng: -60 }, 5);
        });

        // L'écriture est débouncée (~400 ms) via history.replaceState → window.location.hash.
        await page.waitForFunction(
            (prev) => /gl_zoom=5\b/.test(window.location.hash) && window.location.hash !== prev,
            before,
            { timeout: 8000 }
        );

        const hash = await page.evaluate(() => window.location.hash);
        expect(hash).toMatch(/gl_lat=-4[0-9]/); // ~ -45 (capturé depuis la carte)
        expect(hash).toMatch(/gl_lng=-[56][0-9]/); // ~ -60
        expect(hash).toMatch(/gl_zoom=5\b/);
        expect(hash).not.toBe(before);
    });
});
