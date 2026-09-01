// @ts-check
// E2E — `profile-switcher` capability.
//
// What this spec brings, and that no unit test can give:
//
//   • The selector is really injected into the REAL layer manager, built by the
//     real boot — not into a hand-rebuilt test DOM. The only place where the
//     kernel seam, the capability lifecycle and the panel meet.
//   • `data.availableProfiles` is really HARVESTED by `build-deploy.cjs` and
//     read at runtime. A unit test stubs that list; here it comes from the
//     deploy, so a harvest defect shows.
//   • The switch really reloads onto the right profile (sessionStorage +
//     reload + SW purge), a chain happy-dom cannot execute.
//
// ⚠️ The capability is opt-in: it is only visible because
// `profiles/geoleaf.config.json` sets `modules.profile-switcher.enabled: true`.
// If this spec turns red after a config change, check that flag first — not
// the code.
//
// ═══ MEASURED PRECONDITION — 2026-08-10 ═══
//
// 🛑 This file was 4/4 RED on 2026-08-10, and it was describing the CONFORMING
// PRODUCT. The client profile left the repo (`f218691e`): the harvest went from
// 2 profiles to 1, and PS-04 says that with a single profile the selector
// **does not render** — a one-option list announces a choice that does not
// exist. The four assertions below all assume a choice exists.
//
// ⚠️ NONE of these assertions was relaxed, and that is the point. Turning
// `>= 2` into `>= 1` would have made this spec unable to see what it exists
// for. It thus keeps its full requirement, and it is its PRECONDITION that
// became explicit: it is **measured on the variant actually served**, at every
// run, and the file **re-arms itself** the day a second profile ships. Nothing
// to uncomment, nothing to remember.
//
// 🛑 And this spec is NO LONGER the harvest's only oracle: it never was on a
// default path (`ci-local.cjs` reserves E2E for `--e2e`, `ci.yml` reserves it
// for `workflow_dispatch`), which is the harvest guard's real subject. The eye
// that stays LIT permanently is a unit one —
// `packages/core/__tests__/capabilities/profile-switcher/
// profile-harvest.guard.test.ts` (PH-01…PH-04) — and it reddens on any SILENT
// degradation of the harvest. Neutralising this file without it would have
// closed the red AND the eye.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

// Viewport ≥ 1440 px: the selector lives INSIDE the layer manager, and the
// manager is only reachable through the desktop side panel. Below 1440 the
// control is `display:none` (it goes through the mobile sheet) — measured, not
// assumed.
test.use({
    baseURL: baseURL("core"),
    serviceWorkers: "block",
    viewport: { width: 1600, height: 900 },
});

const SWITCHER = ".gl-profile-switcher";
const SELECT = ".gl-profile-switcher__select";
const LAYERS_TAB = '[data-gl-rp-tab="layers"]';

/** Waits for full boot (native map loaded) then the deferred capabilities. */
async function bootReady(page) {
    await page.waitForFunction(
        () => {
            const n = window.GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!(n && typeof n.loaded === "function" && n.loaded());
        },
        null,
        { timeout: 25000 }
    );
    await page.waitForTimeout(1200);
}

/**
 * Opens the side panel's layers tab (labelled « Couches »).
 *
 * The layer manager is **collapsed by default** (`gl-layer-manager--collapsed`)
 * and its pane stays closed while no tab is active: the selector is thus in
 * the DOM but zero-width. That is the intended behaviour — a user opens the
 * manager before choosing their dataset — so this gesture is part of the
 * journey under test, not scenery.
 */
async function openLayersPanel(page) {
    const tab = page.locator(LAYERS_TAB);
    await tab.first().click();
    await page.waitForTimeout(400);
}

// ─────────────────────────────────────────────────────────────────────────────
// Precondition — measured on the SERVED VARIANT, never deduced from sources.
//
// The pattern of `30-sync-cycle.spec.js`: a `beforeAll` that measures, a named
// motive, a WITNESS outside the `describe` so a fully-skipped file does not
// read as a fully-green one. Here the measurement bears on the root config's
// `data.availableProfiles` as SERVED — the only thing the page has,
// `build-deploy.cjs` being the only one able to enumerate `profiles/` (a
// browser does not list a server directory).
// ─────────────────────────────────────────────────────────────────────────────

/** Number of profiles harvested in the served variant, or `null` if the measurement failed. */
let harvested = null;
/** Skip motive, named and dated. `null` ⇒ the file plays. */
let skipReason = null;

test.beforeAll(async ({ request }) => {
    try {
        const r = await request.get(`${baseURL("core")}/profiles/geoleaf.config.json`, {
            timeout: 8000,
        });
        if (!r.ok()) {
            skipReason = `config racine de la variante servie : HTTP ${r.status()} — déployé absent ou vhost non servi`;
            return;
        }
        const list = (await r.json())?.data?.availableProfiles;
        harvested = Array.isArray(list) ? list.length : null;
    } catch (e) {
        skipReason = `config racine de la variante servie illisible (${String(e).slice(0, 80)})`;
        return;
    }

    if (harvested === null) {
        skipReason =
            "`data.availableProfiles` absente ou non-tableau dans la variante servie — le " +
            "déployé n'est pas passé par `build-deploy.cjs`, ou sa récolte a été écrasée";
        return;
    }
    if (harvested < 2) {
        // ⚠️ MOTIVATED AND DATED SKIP.
        // WHY: the served variant harvests only one profile, and PS-04 (sheet
        // `docs/specs/capacites/profile-switcher.md`) prescribes that below two
        // profiles the selector does NOT render. The 4 tests would then
        // describe a conforming product as a defect. WHEN it re-arms: by
        // itself, at the first run where the served variant harvests ≥ 2
        // profiles — the condition is re-measured at every execution, there is
        // no flag to reset. Shipping that second profile is a product decision
        // that belongs to Mattieu, not to this file.
        skipReason =
            `la variante servie ne récolte que ${harvested} profil : PS-04 prescrit qu'en ` +
            "dessous de 2 le sélecteur ne se rende pas, donc ces 4 tests décriraient le produit " +
            "conforme comme un défaut. Réarmé AUTOMATIQUEMENT dès qu'un second profil est livré " +
            "(condition re-mesurée à chaque run). La dégradation SILENCIEUSE de la récolte reste " +
            "vue, elle, par `profile-harvest.guard.test.ts` — chemin par défaut, PH-01…PH-04";
    }
});

test("TÉMOIN — si ce fichier se saute, le motif est NOMMÉ et la récolte n'est pas à zéro", async () => {
    // ⚠️ OUTSIDE the `describe`, hence out of reach of its `beforeEach`: the
    // only test that must run even when the precondition does not hold. Without
    // it, this file would pass for green in a quickly-read report while having
    // played nothing — exactly what the annotation requirement blames silence
    // for.
    if (skipReason) {
        test.info().annotations.push({ type: "skip-reason", description: skipReason });
        expect(skipReason.length, "un saut doit porter un motif lisible").toBeGreaterThan(20);
    }
    // An EMPTY harvest is never an acceptable state, skipped or not:
    // `build-deploy.cjs` already exits via `log.err` on it. The skip covers
    // "1 profile", not "none".
    expect(
        harvested,
        "la variante servie ne récolte AUCUN profil — ce n'est pas la dégradation prévue par " +
            "PS-04, c'est une récolte cassée (voir `profile-harvest.guard.test.ts`)"
    ).not.toBe(0);
});

test.describe("profile-switcher — sélecteur de profil", () => {
    test.beforeEach(() => {
        test.skip(skipReason !== null, skipReason ?? "");
    });

    test("la liste des profils est récoltée au build et lisible au runtime", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const profiles = await page.evaluate(() => window.GeoLeaf?.ProfileSwitcher?.list?.() ?? []);

        // The harvest runs on the profile folders actually shipped: at least
        // the two needed for the selector to make sense.
        expect(profiles.length).toBeGreaterThanOrEqual(2);
        expect(profiles.every((p) => typeof p.id === "string" && p.id.length > 0)).toBe(true);
        expect(profiles.every((p) => typeof p.displayLabel === "string")).toBe(true);
        expect(profiles.map((p) => p.id)).toContain("tourism");
    });

    test("le sélecteur est monté en TÊTE du gestionnaire de couches", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const el = page.locator(SWITCHER).first();
        await expect(el).toHaveCount(1);

        // Structural position: right after the header, hence OUTSIDE the body
        // that renderSections() empties at every render.
        const placement = await page.evaluate((sel) => {
            const node = document.querySelector(sel);
            return {
                prev: node?.previousElementSibling?.className ?? null,
                next: node?.nextElementSibling?.className ?? null,
                insideBody: !!node?.closest(".gl-layer-manager__body"),
            };
        }, SWITCHER);

        expect(placement.prev).toContain("gl-layer-manager__header-wrapper");
        expect(placement.next).toContain("gl-layer-manager__body-wrapper");
        expect(placement.insideBody).toBe(false);
    });

    test("il reflète le profil actif et n'est jamais dupliqué", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const active = await page.evaluate(() => window.GeoLeaf?.Config?.getActiveProfileId?.());
        await expect(page.locator(SELECT).first()).toHaveValue(String(active));
        await expect(page.locator(SWITCHER)).toHaveCount(1);
    });

    test("changer de profil recharge sur le profil choisi", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const target = await page.evaluate(() => {
            const active = window.GeoLeaf?.Config?.getActiveProfileId?.();
            const list = window.GeoLeaf?.ProfileSwitcher?.list?.() ?? [];
            return list.map((p) => p.id).find((id) => id !== active) ?? null;
        });
        expect(target, "il faut au moins 2 profils livrés pour ce scénario").not.toBeNull();

        // The real journey: open the manager, THEN choose.
        await openLayersPanel(page);
        await expect(page.locator(SELECT).first()).toBeVisible();

        await page.locator(SELECT).first().selectOption(String(target));

        // The switch navigates: wait for the new boot, then check the active profile.
        await page.waitForURL(new RegExp(`profile=${target}`), { timeout: 25000 });
        await bootReady(page);

        const nowActive = await page.evaluate(() => window.GeoLeaf?.Config?.getActiveProfileId?.());
        expect(nowActive).toBe(target);
    });
});
