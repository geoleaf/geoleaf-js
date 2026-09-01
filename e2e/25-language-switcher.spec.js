// @ts-check
// E2E — `language-switcher` capability.
//
// Browser-specific contribution:
//   • the button is really injected into the REAL tab strip, built by the
//     real boot — the seam, the lifecycle and the panel only meet there;
//   • the switch reloads the page AND the UI comes out translated: the
//     `?lang=` → `initI18n()` → labels-resolved-at-DOM-build chain can only
//     be played in real conditions;
//   • the URL's `?lang=` stays prioritary over the saved preference — the
//     property guaranteeing a shared link is reproducible.
//
// ⚠️ Opt-in: visible because `profiles/geoleaf.config.json` sets
// `modules.language-switcher.enabled: true`. Red after a config change →
// check that flag before the code.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const LANG_BTN = ".gl-rp-lang-btn";
const POPOVER = ".gl-lang-popover";
const POPOVER_ITEM = ".gl-lang-popover__item";

/**
 * Waits for the state this file USES — never a proxy, never a delay.
 *
 * ⚠️ The loaded map alone is an UPSTREAM proxy, not a "boot done". It is
 * created by the `core-map` module, whose DECLARED dependencies are
 * `["config"]` (`app/boot-modules/core-map.module.ts`); `initI18n()` is
 * called by the `shared` module (`app/boot-modules/shared.module.ts`), and
 * the button only exists once the panels are built by `initUIPanels()`
 * (`app/init-features.ts`), called by the `ui` module — the ONLY one
 * declaring `shared` among its dependencies
 * (`app/boot-modules/ui.module.ts`). Waiting for the map is thus waiting
 * for a step the graph places BEFORE everything read afterwards. The
 * `waitForTimeout(1200)` that followed was the only thing covering the gap: a
 * delay moves a window, it does not remove it, and MapLibre 6 moved them all
 * (the engine is a graph of 3 modules → two more serialised requests at every
 * boot).
 *
 * The button present in the DOM is the DOWNSTREAM state, and it is CAUSAL:
 * its two injection routes (`capabilities/language-switcher/lifecycle.ts`)
 * start one from the mobile toolbar, the other from the `.gl-rp-tabs` strip —
 * both built by `initUIPanels()`. Button present ⟹ `ui` started ⟹ `shared`
 * finished ⟹ `initI18n()` ran. Exactly the guarantee
 * `GeoLeaf.I18n.getActiveLang()` and `getLabel()` below demand: without
 * initialisation, `getActiveLang()` does NOT throw, it returns `"fr"`
 * (`utils/i18n/i18n.ts`) — a silent falsehood, the worst of symptoms.
 *
 * ⚠️ PRESENCE is tested, not visibility: at 1280 px
 * (`playwright.config.js`, below the `(min-width: 1440px)` threshold of
 * `kernel/ui/desktop/desktop-panel.ts`) the desktop strip is built but not
 * activated, so a button can legitimately be hidden. Visibility stays the
 * business of Playwright's actionability checks, which know how to retry.
 */
async function bootReady(page) {
    await page.waitForFunction(
        (sel) => {
            const n = window.GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            if (!(n && typeof n.loaded === "function" && n.loaded())) return false;
            return document.querySelector(sel) !== null;
        },
        LANG_BTN,
        { timeout: 25000 }
    );
}

test.describe("language-switcher — sélecteur de langue", () => {
    test("le bouton est présent et expose les langues compilées", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        // The tab strip only exists beyond 1440px; the mobile variant lives in
        // the toolbar. At least one of the two must be mounted.
        await expect(page.locator(LANG_BTN).first()).toBeVisible();

        const langs = await page.evaluate(() => window.GeoLeaf?.LanguageSwitcher?.list?.() ?? []);
        expect(langs.length).toBeGreaterThanOrEqual(2);
        expect(langs.map((l) => l.code)).toContain("en");
    });

    test("le popover s'ouvre et marque la langue active", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        await page.locator(LANG_BTN).first().click();
        await expect(page.locator(POPOVER)).toBeVisible();

        const items = page.locator(POPOVER_ITEM);
        expect(await items.count()).toBeGreaterThan(1);
        // Exactly one entry carries the active state — the accessibility mark
        // and the visual mark are the same attribute, so they cannot diverge.
        await expect(page.locator(`${POPOVER_ITEM}[aria-current="true"]`)).toHaveCount(1);
    });

    test("changer de langue recharge et traduit l'interface", async ({ page }) => {
        // ⏱ The file's only test to boot TWICE, within the 60 s budget of
        // `playwright.config.js`. So the `load` event (every sub-resource)
        // is not awaited on each side only to then await the real state:
        // `bootReady` carries the guarantee, `load` only carried a bill. Same
        // gesture as `30-sync-cycle.spec.js`, and what makes the margin
        // insensitive to the two serialised requests MapLibre 6 adds — here
        // counted twice, once per boot.
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await bootReady(page);

        await page.locator(LANG_BTN).first().click();
        await page.locator(`${POPOVER_ITEM}[data-gl-lang="en"]`).click();

        await page.waitForURL(/lang=en/, { waitUntil: "domcontentloaded", timeout: 25000 });
        // ⚠️ The URL carrying `?lang=en` says NOTHING about the i18n state:
        // `initI18n()` reads it (`utils/i18n/i18n.ts`) at the `shared`
        // module, several boot steps later. The reload replays the WHOLE boot,
        // so this is where the window is widest — and `bootReady` is what
        // waits for the initialisation actually read below.
        await bootReady(page);

        expect(await page.evaluate(() => window.GeoLeaf?.I18n?.getActiveLang?.())).toBe("en");

        // Proof the translation is APPLIED, not merely selected: the layer
        // manager's title is a core i18n label.
        const label = await page.evaluate(
            () => window.GeoLeaf?.I18n?.getLabel?.("ui.layer_manager.title") ?? null
        );
        expect(label).toBe("Layer manager");
    });

    test("le ?lang= de l'URL prime sur la préférence enregistrée", async ({ page }) => {
        // The property that makes a shared link reproducible: the recipient
        // sees the LINK's language, not their own.
        await page.addInitScript(() => {
            try {
                localStorage.setItem("gl-lang", "de");
            } catch (e) {
                void e;
            }
        });

        await page.goto("/?lang=es");
        await bootReady(page);

        expect(await page.evaluate(() => window.GeoLeaf?.I18n?.getActiveLang?.())).toBe("es");
    });
});
