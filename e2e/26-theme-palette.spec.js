// @ts-check
// E2E — capacité `theme-palette` (S3 de roadmap_feature-selecteurs-ui).
//
// C'EST LE SPEC QUI COMPTE LE PLUS DES TROIS, et pour une raison précise : le risque n°1
// du CDC ne peut être attrapé qu'ici. purgecss ne voit pas un attribut posé en
// JavaScript ; si les blocs `:root[data-gl-palette=…]` étaient purgés du CSS de
// PRODUCTION, le bouton fonctionnerait, l'attribut se poserait, tous les tests unitaires
// resteraient verts — et l'écran ne changerait pas. On vérifie donc la COULEUR CALCULÉE
// sur le déployé, pas la présence de l'attribut.
//
// ⚠️ Opt-in : visible parce que `profiles/geoleaf.config.json` pose
// `modules.theme-palette.enabled: true`.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const PALETTE_BTN = ".gl-rp-palette-btn";
const POPOVER = ".gl-palette-popover";
const ITEM = ".gl-palette-popover__item";

/** Vert de la palette « green », tel que défini par la feuille récupérée de git. */
const GREEN_ACCENT = "#16a34a";

/** rgb(22, 163, 74) — ce que `getComputedStyle` renvoie pour #16a34a. */
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

/** Valeur calculée du token d'accent, telle que le navigateur la résout. */
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

        // Témoin de non-rechargement : un rechargement recrée `window` et l'efface.
        //
        // ⚠️ Ce test comparait `page.url()` avant/après, et c'était le mauvais instrument :
        // l'app synchronise l'état carte dans le HASH (`#gl_lat=…&gl_zoom=…&gl_theme=…`),
        // de façon asynchrone après le boot. Sur un runner lent, le hash s'écrit APRÈS la
        // capture de l'URL, et l'assertion rougissait sur une navigation QUI N'A PAS EU LIEU
        // (CI 30703087739 du 01/08/2026, échoué aux 3 tentatives — ce n'était pas un flake,
        // c'était un test qui mesurait autre chose que son intention). Ici, on mesure
        // exactement ce que la phrase de la ligne suivante affirme.
        await page.evaluate(() => {
            /** @type {any} */ (window).__glReloadWitness = "alive";
        });

        await page.locator(PALETTE_BTN).first().click();
        await expect(page.locator(POPOVER)).toBeVisible();
        await page.locator(`${ITEM}[data-gl-palette="green"]`).click();

        // 1 — l'attribut est posé
        await expect(page.locator("html")).toHaveAttribute("data-gl-palette", "green");

        // 2 — et le CSS SUIT : c'est la vérification que purgecss n'a pas purgé le bloc.
        //     Sans elle, ce test passerait sur une page où rien n'a changé visuellement.
        const after = await readAccent(page);
        expect(after).not.toBe(before);
        expect([GREEN_ACCENT, GREEN_RGB]).toContain(after);

        // 3 — aucun rechargement : la bascule est à chaud.
        const witness = await page.evaluate(
            () => /** @type {any} */ (window).__glReloadWitness ?? null
        );
        expect(witness).toBe("alive");
    });

    test("les 3 palettes sont DISTINCTES, et « default » rend bien l'orange", async ({ page }) => {
        // ⚠️ LE TEST QUI MANQUAIT, et l'absence a laissé passer un vrai défaut.
        //
        // La suite ne vérifiait que le vert. Or les feuilles récupérées portent des listes
        // de sélecteurs MULTI-LIGNES (`body.gl-theme-light,\n.gl-theme-light {`) : la
        // transformation n'avait scopé que la seconde ligne, laissant `body.gl-theme-*`
        // GLOBAL. Les deux palettes repeignaient donc toutes les pages, et la dernière
        // importée — le bleu — gagnait : « default » et « blue » affichaient tous deux du
        // bleu. Le vert passait, lui, parce qu'il porte aussi une règle `:root` scopée.
        //
        // Vérifier UNE palette ne prouve rien sur les autres : il faut les comparer.
        await page.goto("/");
        await bootReady(page);

        /** Accent lu sur <html> (règle `:root`) ET sur <body> (règle `gl-theme-*`). */
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

        // Chaque palette rend SA couleur, au niveau `:root`.
        expect(def.html.toLowerCase()).toBe("#f97316"); // orange GeoLeaf
        expect(green.html.toLowerCase()).toBe("#16a34a");
        expect(blue.html.toLowerCase()).toBe("#2563eb");

        // Et les valeurs vues par l'UI (niveau <body>) sont elles aussi distinctes —
        // c'est CE niveau que le défaut contaminait.
        expect(new Set([def.body, green.body, blue.body]).size).toBe(3);

        // Revenir à « default » restaure l'orange : l'absence d'attribut ne doit rien
        // hériter de la dernière palette appliquée.
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

        // Bascule du mode via l'API du thème (le toggle est une autre capacité).
        const modeBefore = await page.evaluate(() => document.body.className);
        await page.evaluate(() => window.GeoLeaf?.UI?.applyTheme?.("dark"));
        await page.waitForTimeout(300);

        // La palette n'a pas bougé, et l'accent reste celui du vert en mode sombre.
        await expect(page.locator("html")).toHaveAttribute("data-gl-palette", "green");
        expect(await page.evaluate(() => document.body.className)).not.toBe(modeBefore);
        expect(await readAccent(page)).toBeTruthy();
    });
});
