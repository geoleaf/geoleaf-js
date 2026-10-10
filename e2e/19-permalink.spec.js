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

import { test, expect } from "./helpers/test.js";
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

    // ── the same restore on a profile that applies NO theme ───────────────────────
    test("restore: sur un profil sans `themes`, gl_filter est restauré quand même", async ({
        page,
        context,
    }) => {
        // A profile that declares no `themes` never emits `geoleaf:theme:applied`, the event
        // the restore above waits for: the filter of the URL was lost without a word.
        let served = 0;
        await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
            const bundle = await (await route.fetch()).json();
            delete bundle.themes;
            served += 1;
            await route.fulfill({ json: bundle });
        });
        // ⚠️ The DECLARATION goes too. A profile that still names `Files.themesFile` while its
        // bundle carries no themes is not a profile without themes: it is one with a missing
        // resource, and the boot holds on its « missing resources » screen — measured.
        await context.route("**/profiles/tourism/profile.json**", async (route) => {
            const profile = await (await route.fetch()).json();
            if (profile.Files) delete profile.Files.themesFile;
            await route.fulfill({ json: profile });
        });

        await page.goto("/#gl_lat=12.34&gl_lng=56.78&gl_zoom=7&gl_filter=montagne");
        await waitMapStyleReady(page);

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
        // The instrument: the profile the page booted on is the one without themes.
        expect(served).toBeGreaterThan(0);
        expect(
            await page.evaluate(
                () => /** @type {any} */ (window).GeoLeaf.Config.getActiveProfile()?.themes
            )
        ).toBeUndefined();
    });

    // ── the filter, ONE PARAMETER PER FIELD — written, then restored field by field ───────────
    test("filtre : le lien écrit un paramètre par champ, et se restaure champ par champ", async ({
        page,
        context,
    }) => {
        // 🛑 THE DEFECT. The permalink ranged the filter by KIND, in four slots: two fields of
        // the same kind shared one — both were restored with the same value —, and a range kept
        // its lower bound only. And the panel offered one slider for a range the engine filters
        // on both bounds.
        //
        // The shipped profile declares no `range` field: two are injected in the served bundle,
        // one of them with `bounds: "both"`. They filter on a property no layer carries — the
        // subject is what the URL and the panel hold, not what is drawn.
        let served = 0;
        await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
            const bundle = await (await route.fetch()).json();
            const fields = bundle.modules?.filter?.fields;
            if (!Array.isArray(fields)) throw new Error("le bundle ne porte plus `modules.filter`");
            fields.push(
                {
                    id: "altitude",
                    kind: "range",
                    label: "Altitude",
                    field: "properties.e2e_altitude",
                    min: 0,
                    max: 3000,
                    step: 50,
                    bounds: "both",
                },
                {
                    id: "surface",
                    kind: "range",
                    label: "Surface",
                    field: "properties.e2e_surface",
                    min: 0,
                    max: 100,
                }
            );
            served += 1;
            await route.fulfill({ json: bundle });
        });
        /** The panel's own reading of the three fields under test. */
        const active = () =>
            page.evaluate(() => {
                const state = /** @type {any} */ (window).GeoLeaf.Filter.getActiveFilter();
                return Object.fromEntries(
                    state.fields
                        .filter((/** @type {any} */ f) =>
                            ["searchText", "altitude", "surface"].includes(f.id)
                        )
                        .map((/** @type {any} */ f) => [f.id, f.text ?? f.range])
                );
            });
        const panelReady = () =>
            page.waitForFunction(
                () => !!document.querySelector('#gl-filter-panel [data-gl-filter-id="surface"]'),
                null,
                { timeout: 30000 }
            );
        const WANTED = {
            searchText: "lac",
            altitude: { min: 100, max: 500 },
            surface: { min: 20 },
        };

        await page.goto("/#gl_lat=-32.9&gl_lng=-60.6&gl_zoom=8");
        await waitMapStyleReady(page);
        await panelReady();
        expect(served, "le bundle injecté n'a pas été servi").toBeGreaterThan(0);

        // --- the panel: a declared range offers both bounds -----------------------------------
        // Soft, like the next one: on a bundle that predates the fix, a run names EVERY half
        // that is missing — the sliders, then the link — instead of stopping at the first.
        expect
            .soft(
                await page.evaluate(() => ({
                    altitude: document.querySelectorAll(
                        '[data-gl-filter-id="altitude"] input[type="range"]'
                    ).length,
                    surface: document.querySelectorAll(
                        '[data-gl-filter-id="surface"] input[type="range"]'
                    ).length,
                })),
                'un filtre `range` qui déclare `bounds: "both"` a deux curseurs, les autres un seul'
            )
            .toEqual({ altitude: 2, surface: 1 });

        // --- written: one parameter per field --------------------------------------------------
        await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Filter.applyFilter({
                fields: [
                    { id: "searchText", kind: "text", text: "lac" },
                    { id: "altitude", kind: "range", range: { min: 100, max: 500 } },
                    { id: "surface", kind: "range", range: { min: 20 } },
                ],
            })
        );
        expect.soft(await active(), "le panneau ne tient pas le filtre appliqué").toEqual(WANTED);
        await expect
            .poll(
                () =>
                    page.evaluate(() =>
                        Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)))
                    ),
                { timeout: 10000, message: "le lien n'écrit pas le filtre par champ" }
            )
            .toMatchObject({
                "gl_f.searchText": "lac",
                "gl_f.altitude": "100..500",
                "gl_f.surface": "20..",
            });
        const link = await page.evaluate(() => window.location.hash);
        for (const slot of ["gl_filter=", "gl_rating=", "gl_cats=", "gl_tags="]) {
            expect(link, `le lien écrit encore l'emplacement par genre ${slot}`).not.toContain(
                slot
            );
        }

        // --- restored: each field its own value, on a page opened on the link -----------------
        const fresh = await context.newPage();
        try {
            await fresh.goto(`/${link}`);
            await expect(fresh.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
            await fresh.waitForFunction(
                () => !!document.querySelector('#gl-filter-panel [data-gl-filter-id="surface"]'),
                null,
                { timeout: 30000 }
            );
            await expect
                .poll(
                    () =>
                        fresh.evaluate(() => {
                            const state = /** @type {any} */ (
                                window
                            ).GeoLeaf.Filter.getActiveFilter();
                            return Object.fromEntries(
                                state.fields
                                    .filter((/** @type {any} */ f) =>
                                        ["searchText", "altitude", "surface"].includes(f.id)
                                    )
                                    .map((/** @type {any} */ f) => [f.id, f.text ?? f.range])
                            );
                        }),
                    {
                        timeout: 20000,
                        message: "le lien n'a pas rendu à chaque champ sa propre valeur",
                    }
                )
                .toEqual(WANTED);
        } finally {
            await fresh.close();
        }
    });

    // ── a link written before 3.15.0 — the by-kind slots — is still restored ─────────────────
    test("filtre : un lien d'avant, rangé par genre, se restaure toujours", async ({ page }) => {
        // The second reader. Green before the per-field format as after: it is what guards
        // every link already shared.
        await page.goto("/#gl_lat=12.34&gl_lng=56.78&gl_zoom=7&gl_filter=montagne&gl_tags=e2e-tag");
        await waitMapStyleReady(page);
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const G = /** @type {any} */ (window).GeoLeaf;
                        const input = /** @type {HTMLInputElement | null} */ (
                            document.querySelector(
                                '[data-gl-filter-id="searchText"] input[type="text"]'
                            )
                        );
                        return { typed: input?.value ?? null, state: G.Permalink.getState() };
                    }),
                { timeout: 20000 }
            )
            .toMatchObject({
                typed: "montagne",
                state: { filter: "montagne", tags: ["e2e-tag"] },
            });
    });

    // ── _captureState + buildUrl + startSync: a move writes the URL ──────────────
    test("sync: un déplacement de la carte sérialise l'état dans l'URL", async ({ page }) => {
        await page.goto("/");
        await waitMapStyleReady(page);
        // 🛑 THE BOOT MUST BE OVER BEFORE THE MAP IS MOVED. `waitMapStyleReady` returns as soon
        // as the map exists, i.e. before the reveal — and the reveal frames the profile. A move
        // made before it is undone by that framing: this test used to pass on a TRANSIENT, the
        // URL being written with the requested zoom in the interval before a framing that then
        // came 120 ms after the announcement. The framing now precedes the announcement, and
        // the move was undone before the debounced write: red, eight runs out of eight.
        // The mark is the one the reveal sets as it announces the application ready.
        await page.waitForFunction(
            () => performance.getEntriesByName("geoleaf:initApp:ready").length > 0,
            null,
            { timeout: 20000 }
        );
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
