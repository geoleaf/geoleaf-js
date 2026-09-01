// @ts-check
// BROWSER VERIFICATION — family A, map rendering and style cycle. Scenarios
// A.1, A.2, A.3 of the internal browser-verification table.
//
// These scenarios are in the table for the first of the four reasons it names:
// **there is no rendering engine under happy-dom**. MapLibre does not
// initialise, so no style reload, no real zoom cycle, no `symbol` layer —
// nothing of what is observed here.
//
// Contract actually emitted (measured, not deduced from the doc):
//   - the labels are NOT DOM: `label-renderer.ts` adds a MapLibre `symbol`
//     layer with id `gl-<layerId>-label-text`. We read `getStyle().layers`,
//     not the DOM.
//   - `tourism` profile: `villes_principales` has its labels active at boot;
//     its symbol layer is present at zooms 7/10/12 and **absent** at zoom 5 as
//     at the boot zoom (4.23). That range is what makes the cycle observable.
//
// ⚠️ TWO TRAPS RULED OUT AT PRE-FLIGHT, both measured:
//   1. Switching the THEME (the other adapter-swap path A.3 cites) makes the
//      symbol layer disappear. That is NOT a defect: the "tourisme" theme does
//      not contain `villes_principales`, the layer leaves the field for a
//      legitimate reason.
//   2. Switching the BASEMAP was, at pre-flight, **broken** on this profile —
//      the switch cancelled itself about a second later, undone by the boot's
//      stale deferral. The table's three scenarios assume it possible; it was
//      not until the fix. The defect was found and corrected while building
//      this file (see the A.1/A.3 block below), whose first assertion now
//      proves the switch HOLDS. (An earlier revision of this header pointed to
//      a `test.fixme` at the bottom of the file; no committed version ever
//      carried one — the planned fixme became the passing A.1/A.3 test.)

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, waitMapLoaded, captureConsole } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const LABEL_LAYER = "gl-villes_principales-label-text";
const ZOOM_IN = 10; // the layer is inside its scale range
const ZOOM_OUT = 5; // it leaves it
const ALT_BASEMAP = "positron"; // ≠ terrain-terrarium, active at boot

/** Is the labels' symbol layer in the native style? */
const labelLayerPresent = (page) =>
    page.evaluate(
        (id) =>
            window.GeoLeaf.Core.getMap()
                .getNativeMap()
                .getStyle()
                .layers.some((l) => l.id === id),
        LABEL_LAYER
    );

/** Sets a zoom and waits for the symbol layer to reach the expected state. */
async function zoomAndExpectLabels(page, zoom, present) {
    await page.evaluate((z) => window.GeoLeaf.Core.getMap().getNativeMap().setZoom(z), zoom);
    await expect
        .poll(() => labelLayerPresent(page), {
            timeout: 15000,
            message: `au zoom ${zoom}, la couche ${LABEL_LAYER} devrait être ${present ? "présente" : "absente"}`,
        })
        .toBe(present);
}

/**
 * Waits for the basemap subsystem to be really ready.
 *
 * ⚠️ MEASURED at this family's pre-flight: `nativeMap.loaded()` can be `true`
 * while the basemap registry is still **EMPTY** (0 keys, no active basemap) —
 * the profile's 8 basemaps only arrive about 1.5 s later. Requesting
 * `setBaseLayer("positron")` in that interval yields
 * `[Baselayers] Unknown layer: positron`, and the boot then applies its own:
 * from outside it looks exactly like a cancelled switch, when the switch never
 * happened. That is what kept this family's tests intermittent AFTER the
 * stale-deferral fix — two distinct causes, one symptom.
 */
async function waitBasemapsReady(page) {
    await page.waitForFunction(
        () => {
            const bl = window.GeoLeaf?.Baselayers;
            if (!bl?.getBaseLayers) return false;
            return Object.keys(bl.getBaseLayers() ?? {}).length > 0 && !!bl.getActiveId?.();
        },
        null,
        { timeout: 25000 }
    );
}

test.describe("VN — rendu carte et cycle de style (A.1, A.2, A.3)", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await bootMap(page);
        await waitMapLoaded(page);
        await waitBasemapsReady(page);
    });

    // ── A.2 🔴 (verifiable part, without basemap switch) ──────────────────────────────
    // Counter-proof: "the `catch` goes **inside** the `forEach`, `.clear()`
    // outside; wrapping it would leave the Map non-empty and the labels would
    // never come back". The discriminating assertion is thus the RETURN, not
    // the disappearance: a misplaced `.clear()` leaves the Map populated with
    // dead entries, and the rebuild on zoom-in no longer happens. A test
    // checking only the disappearance would pass over the bug.
    //
    // The table writes this scenario "after the basemap switch"; the switch
    // being broken at the time, the cycle was proven here on the original
    // adapter. That half stays valuable — it keeps the targeted defect visible
    // independently of the switch, whose own cycle A.1/A.3 replays below.
    // Determinism measured before writing: 5/5.
    test("A.2 — les labels sortent du champ au dézoom et REVIENNENT au zoom entrant", async ({
        page,
    }) => {
        const console_ = captureConsole(page);

        await zoomAndExpectLabels(page, ZOOM_IN, true);
        await zoomAndExpectLabels(page, ZOOM_OUT, false); // leaves the scale range
        await zoomAndExpectLabels(page, ZOOM_IN, true); // ← THE point of the scenario

        expect(
            console_.errors,
            `exceptions pendant le cycle : ${console_.errors.join(" | ")}`
        ).toEqual([]);
    });

    // ── A.1 + A.3 🔴 ─────────────────────────────────────────────────────────────────
    //
    // Counter-proofs: for the label rebuild, "the `Map`'s closures throw on a
    // reloaded style"; for the zoom reaction after adapter swap,
    // `_ensureZoomListener` returned early without comparing the map.
    //
    // ⚠️ WHAT TUNING THIS TEST TAUGHT — two causes, one symptom, and they must
    // not be conflated:
    //
    //   1. **A REAL product defect**, found here and fixed: `setBaseLayer`
    //      defers onto `map.once("idle")` when the style is not loaded,
    //      capturing its key in the closure. Nothing there noticed a later
    //      request had replaced it, so the BOOT's activation could re-apply
    //      **over the user's choice**. Fixed by an activation ticket
    //      (`_nextActivationRequest`, `basemaps-state.ts`). **Its
    //      counter-proof is at the UNIT tier** —
    //      `__tests__/baselayers/registry.test.js`, "a deferral on idle does
    //      NOT overwrite a more recent activation" —, seen red before the fix
    //      (`Received: "boot"`).
    //
    //   2. **A missing precondition IN THIS TEST**: `nativeMap.loaded()` can be
    //      `true` while the basemap registry is still empty. The switch then
    //      failed on `Unknown layer`, and the boot applied its own — from
    //      outside, indistinguishable from a cancelled switch.
    //      `waitBasemapsReady()` settles it.
    //
    // ⚠️ **This test does NOT prove the fix of point 1**: mutation done, the
    // ticket's guard neutralised then deployed, it stays green 3/3 — because
    // with the precondition above the boot's deferral has already been
    // consumed, so the defect's window is no longer open. That window hangs on
    // a millisecond-level sequence; pinning it here would give an intermittent
    // test, which is worse than no test. **The unit tier is the right home for
    // that guard, and it has it.**
    //
    // ⚠️ METHOD TAKEAWAY. This test's first versions sometimes passed exactly
    // when `setBaseLayer` had NO effect — so no style reload, no label
    // removed, nothing to rebuild. **It was green when the manipulation had
    // failed.** Hence assertion no. 1 below: a scenario must assert its
    // manipulation happened before judging its effect.
    test("A.1/A.3 — la bascule de fond tient et les labels sont reconstruits", async ({ page }) => {
        await zoomAndExpectLabels(page, ZOOM_IN, true);

        const console_ = captureConsole(page);
        await page.evaluate((id) => window.GeoLeaf.Baselayers.setBaseLayer(id), ALT_BASEMAP);

        // 1 — PRECONDITION: the switch must HOLD. Before the fix it reverted to
        // the boot's basemap in ~1 s, and that cancellation is what made the
        // rest unobservable.
        await expect
            .poll(() => page.evaluate(() => window.GeoLeaf.Baselayers.getActiveId()), {
                timeout: 20000,
                message: "la bascule de fond a été annulée toute seule (report périmé ?)",
            })
            .toBe(ALT_BASEMAP);

        // 2 — A.1: the labels are rebuilt on the new style.
        await expect
            .poll(() => labelLayerPresent(page), {
                timeout: 20000,
                message: "les labels n'ont pas été reconstruits après le rechargement de style",
            })
            .toBe(true);

        // 3 — A.3: zoom still drives the labels after the adapter swap — the
        // `zoomend` subscription did follow the new map.
        await zoomAndExpectLabels(page, ZOOM_OUT, false);
        await zoomAndExpectLabels(page, ZOOM_IN, true);

        expect(console_.errors, `exceptions : ${console_.errors.join(" | ")}`).toEqual([]);
    });
});
