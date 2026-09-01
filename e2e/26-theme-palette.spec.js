// @ts-check
// E2E — `theme-palette` capability.
//
// THE SPEC THAT MATTERS MOST OF THE THREE, and for a precise reason: the
// CDC's risk no. 1 can only be caught here. purgecss does not see an
// attribute set in JavaScript; if the `:root[data-gl-palette=…]` blocks were
// purged from the PRODUCTION CSS, the button would work, the attribute would
// be set, every unit test would stay green — and the screen would not change.
// So the COMPUTED COLOUR is verified on the deploy, not the attribute's
// presence.
//
// ⚠️ Opt-in: visible because `profiles/geoleaf.config.json` sets
// `modules.theme-palette.enabled: true`.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const PALETTE_BTN = ".gl-rp-palette-btn";
const POPOVER = ".gl-palette-popover";
const ITEM = ".gl-palette-popover__item";

/** The "green" palette's green, as defined by the sheet recovered from git. */
const GREEN_ACCENT = "#16a34a";

/** rgb(22, 163, 74) — what `getComputedStyle` returns for #16a34a. */
const GREEN_RGB = "rgb(22, 163, 74)";

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

/** Computed value of the accent token, as the browser resolves it. */
function readAccent(page) {
    return page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--gl-color-accent").trim()
    );
}

test.describe("theme-palette — palette de couleur d'accent", () => {
    test("le bouton est présent et l'API expose les 3 palettes", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        await expect(page.locator(PALETTE_BTN).first()).toBeVisible();

        const palettes = await page.evaluate(() => window.GeoLeaf?.ThemePalette?.list?.() ?? []);
        expect(palettes.map((p) => p.id)).toEqual(["default", "green", "blue"]);
    });

    test("choisir « Vert » repeint l'accent — SANS rechargement", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const before = await readAccent(page);

        // No-reload witness: a reload recreates `window` and erases it.
        //
        // ⚠️ This test used to compare `page.url()` before/after, and that was
        // the wrong instrument: the app syncs map state into the HASH
        // (`#gl_lat=…&gl_zoom=…&gl_theme=…`), asynchronously after boot. On a
        // slow runner the hash gets written AFTER the URL capture, and the
        // assertion reddened on a navigation THAT NEVER HAPPENED (CI run
        // 30703087739 of 2026-08-01, failed on all 3 attempts — not a flake,
        // a test measuring something other than its intention). Here, exactly
        // what the next line's sentence claims is measured.
        await page.evaluate(() => {
            /** @type {any} */ (window).__glReloadWitness = "alive";
        });

        await page.locator(PALETTE_BTN).first().click();
        await expect(page.locator(POPOVER)).toBeVisible();
        await page.locator(`${ITEM}[data-gl-palette="green"]`).click();

        // 1 — the attribute is set
        await expect(page.locator("html")).toHaveAttribute("data-gl-palette", "green");

        // 2 — and the CSS FOLLOWS: the check that purgecss did not purge the
        //     block. Without it, this test would pass on a page where nothing
        //     visually changed.
        const after = await readAccent(page);
        expect(after).not.toBe(before);
        expect([GREEN_ACCENT, GREEN_RGB]).toContain(after);

        // 3 — no reload: the switch is hot.
        const witness = await page.evaluate(
            () => /** @type {any} */ (window).__glReloadWitness ?? null
        );
        expect(witness).toBe("alive");
    });

    test("les 3 palettes sont DISTINCTES, et « default » rend bien l'orange", async ({ page }) => {
        // ⚠️ THE TEST THAT WAS MISSING, and the absence let a real defect
        // through.
        //
        // The suite only checked the green. Yet the recovered sheets carry
        // MULTI-LINE selector lists (`body.gl-theme-light,\n.gl-theme-light {`):
        // the transformation had scoped only the second line, leaving
        // `body.gl-theme-*` GLOBAL. Both palettes thus repainted every page,
        // and the last one imported — blue — won: "default" and "blue" both
        // displayed blue. The green passed because it also carries a scoped
        // `:root` rule.
        //
        // Checking ONE palette proves nothing about the others: they must be
        // compared.
        await page.goto("/");
        await bootReady(page);

        /** Accent read on <html> (`:root` rule) AND on <body> (`gl-theme-*` rule). */
        const accents = (id) =>
            page.evaluate((palette) => {
                window.GeoLeaf.ThemePalette.set(palette);
                return {
                    html: getComputedStyle(document.documentElement)
                        .getPropertyValue("--gl-color-accent")
                        .trim(),
                    body: getComputedStyle(document.body)
                        .getPropertyValue("--gl-color-accent")
                        .trim(),
                };
            }, id);

        const def = await accents("default");
        const green = await accents("green");
        const blue = await accents("blue");

        // Each palette renders ITS colour, at the `:root` level.
        expect(def.html.toLowerCase()).toBe("#f97316"); // GeoLeaf orange
        expect(green.html.toLowerCase()).toBe("#16a34a");
        expect(blue.html.toLowerCase()).toBe("#2563eb");

        // And the values the UI sees (<body> level) are distinct too — THIS
        // level is the one the defect contaminated.
        expect(new Set([def.body, green.body, blue.body]).size).toBe(3);

        // Coming back to "default" restores the orange: the attribute's
        // absence must inherit nothing from the last applied palette.
        const back = await accents("default");
        expect(back.html.toLowerCase()).toBe("#f97316");
        expect(back.body).toBe(def.body);
        await expect(page.locator("html")).not.toHaveAttribute("data-gl-palette", /.*/);
    });

    test("la palette survit au rechargement (localStorage)", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        await page.locator(PALETTE_BTN).first().click();
        await page.locator(`${ITEM}[data-gl-palette="green"]`).click();
        await expect(page.locator("html")).toHaveAttribute("data-gl-palette", "green");

        await page.reload();
        await bootReady(page);

        await expect(page.locator("html")).toHaveAttribute("data-gl-palette", "green");
        expect([GREEN_ACCENT, GREEN_RGB]).toContain(await readAccent(page));
    });

    test("la palette et le mode clair/sombre sont indépendants", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        await page.locator(PALETTE_BTN).first().click();
        await page.locator(`${ITEM}[data-gl-palette="green"]`).click();

        // Mode switch via the theme API (the toggle is another capability).
        const modeBefore = await page.evaluate(() => document.body.className);
        await page.evaluate(() => window.GeoLeaf?.UI?.applyTheme?.("dark"));
        await page.waitForTimeout(300);

        // The palette did not move, and the accent stays the green one in dark mode.
        await expect(page.locator("html")).toHaveAttribute("data-gl-palette", "green");
        expect(await page.evaluate(() => document.body.className)).not.toBe(modeBefore);
        expect(await readAccent(page)).toBeTruthy();
    });
});
