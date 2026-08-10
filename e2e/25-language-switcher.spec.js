// @ts-check
// E2E — capacité `language-switcher` (S2 de roadmap_feature-selecteurs-ui).
//
// Apport propre au navigateur :
//   • le bouton est réellement injecté dans le VRAI bandeau d'onglets, construit par le
//     vrai boot — le seam, le lifecycle et le panneau ne se rencontrent que là ;
//   • la bascule recharge la page ET l'UI ressort traduite : la chaîne
//     `?lang=` → `initI18n()` → libellés résolus à la construction du DOM ne peut être
//     jouée qu'en conditions réelles ;
//   • le `?lang=` de l'URL reste prioritaire sur la préférence enregistrée — la
//     propriété qui garantit qu'un lien partagé est reproductible.
//
// ⚠️ Opt-in : visible parce que `profiles/geoleaf.config.json` pose
// `modules.language-switcher.enabled: true`. Rouge après un changement de config →
// vérifier ce drapeau avant le code.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const LANG_BTN = ".gl-rp-lang-btn";
const POPOVER = ".gl-lang-popover";
const POPOVER_ITEM = ".gl-lang-popover__item";

/**
 * Attend l'état que ce fichier UTILISE — jamais un proxy, jamais un délai.
 *
 * ⚠️ La carte chargée seule est un proxy AMONT, pas un « boot terminé ». Elle est créée par le
 * module `core-map`, dont les dépendances DÉCLARÉES sont `["config"]`
 * (`app/boot-modules/core-map.module.ts:36`) ; `initI18n()` est appelé par le module `shared`
 * (`app/boot-modules/shared.module.ts:76`), et le bouton n'existe qu'une fois les panneaux bâtis
 * par `initUIPanels()` (`app/init-features.ts:256-275`), appelé par le module `ui` — le SEUL à
 * déclarer `shared` dans ses dépendances (`app/boot-modules/ui.module.ts:44`). Attendre la carte,
 * c'est donc attendre une étape que le graphe place AVANT tout ce qu'on lit ensuite. Le
 * `waitForTimeout(1200)` qui suivait était la seule chose qui couvrait l'écart : un délai déplace
 * une fenêtre, il ne la supprime pas (B-171), et MapLibre 6 les a toutes déplacées (le moteur est
 * un graphe de 3 modules → deux requêtes sérialisées de plus à chaque boot).
 *
 * Le bouton présent dans le DOM est l'état AVAL, et il est CAUSAL : ses deux voies d'injection
 * (`capabilities/language-switcher/lifecycle.ts`) partent l'une de la barre d'outils mobile,
 * l'autre du bandeau `.gl-rp-tabs` — toutes deux construites par `initUIPanels()`. Bouton présent
 * ⟹ `ui` a démarré ⟹ `shared` a fini ⟹ `initI18n()` a tourné. C'est exactement la garantie que
 * réclament `GeoLeaf.I18n.getActiveLang()` et `getLabel()` plus bas : sans initialisation,
 * `getActiveLang()` ne LÈVE PAS, il rend `"fr"` (`utils/i18n/i18n.ts:57-60`) — un faux
 * silencieux, le pire des symptômes.
 *
 * ⚠️ On teste la PRÉSENCE, pas la visibilité : à 1280 px (`playwright.config.js:50`, sous le seuil
 * `(min-width: 1440px)` de `kernel/ui/desktop/desktop-panel.ts:36`) le bandeau desktop est bâti
 * mais non activé, donc un bouton peut légitimement être caché. La visibilité reste l'affaire des
 * vérifications d'actionnabilité de Playwright, qui savent réessayer.
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

        // Le bandeau d'onglets n'existe qu'au-delà de 1440px ; la variante mobile vit
        // dans la barre d'outils. Au moins une des deux doit être montée.
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
        // Exactement une entrée porte l'état actif — la marque d'accessibilité et la
        // marque visuelle sont le même attribut, donc elles ne peuvent pas diverger.
        await expect(page.locator(`${POPOVER_ITEM}[aria-current="true"]`)).toHaveCount(1);
    });

    test("changer de langue recharge et traduit l'interface", async ({ page }) => {
        // ⏱ Seul test du fichier à booter DEUX fois, dans le budget de 60 s de
        // `playwright.config.js:41`. On n'attend donc pas l'événement `load` (toutes les
        // sous-ressources) de chaque côté pour attendre ENSUITE le vrai état : `bootReady`
        // porte la garantie, `load` ne portait qu'une facture. Même geste que
        // `30-sync-cycle.spec.js`, et c'est ce qui rend la marge insensible aux deux requêtes
        // sérialisées que MapLibre 6 ajoute — ici comptées deux fois, une par boot.
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await bootReady(page);

        await page.locator(LANG_BTN).first().click();
        await page.locator(`${POPOVER_ITEM}[data-gl-lang="en"]`).click();

        await page.waitForURL(/lang=en/, { waitUntil: "domcontentloaded", timeout: 25000 });
        // ⚠️ L'URL portant `?lang=en` ne dit RIEN de l'état i18n : `initI18n()` la lit
        // (`utils/i18n/i18n.ts:97`) au module `shared`, plusieurs étapes de boot plus loin. Le
        // rechargement rejoue TOUT le boot, donc c'est ici que la fenêtre est la plus large —
        // et c'est `bootReady` qui attend l'initialisation réellement lue en dessous.
        await bootReady(page);

        expect(await page.evaluate(() => window.GeoLeaf?.I18n?.getActiveLang?.())).toBe("en");

        // Preuve que la traduction est APPLIQUÉE, pas seulement sélectionnée : le titre
        // du gestionnaire de couches est un libellé i18n du core.
        const label = await page.evaluate(
            () => window.GeoLeaf?.I18n?.getLabel?.("ui.layer_manager.title") ?? null
        );
        expect(label).toBe("Layer manager");
    });

    test("le ?lang= de l'URL prime sur la préférence enregistrée", async ({ page }) => {
        // La propriété qui rend un lien partagé reproductible : le destinataire voit la
        // langue DU LIEN, pas la sienne.
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
