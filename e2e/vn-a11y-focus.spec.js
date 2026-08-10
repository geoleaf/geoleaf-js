// @ts-check
// VÉRIFICATION NAVIGATEUR — accessibilité calculée et focus réel. Scénarios B.1 et B.6 de
// `_docs_projet/travail/rapports/rapport_table-verification-navigateur.md` (backlog R.7b).
//
// Ces deux scénarios sont le CŒUR de ce que happy-dom ne peut pas décider :
//   - B.1 : le **nom accessible calculé** d'une région ne se lit pas dans un `getAttribute` —
//           il faut l'arbre d'accessibilité, que seul un vrai navigateur construit. On l'atteint
//           ici via le moteur de rôles de Playwright (`getByRole`), pas via le DOM brut.
//   - B.6 : le filtre `offsetParent !== null` du piège de focus est INTESTABLE sous happy-dom —
//           `offsetParent` y vaut `undefined`, donc le filtre garde tout et l'assertion
//           passerait quoi qu'il arrive. `focus-trap.ts:40-45` le documente noir sur blanc
//           (« It cannot be covered by a test […] Blocked on the browser verification pass »).
//           C'est précisément cette passe.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, waitMapLoaded } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

test.describe("VN — accessibilité calculée et focus réel (B.1, B.6)", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await bootMap(page);
        await waitMapLoaded(page);
    });

    // ── B.1 🔴 ────────────────────────────────────────────────────────────────────────
    // Contre-épreuve B.38 : le panneau de filtres sans `modules.filter.title` annonçait
    // « Filter » (aria-label) alors qu'il affichait « Filtrer » (WCAG 2.5.3, Label in Name).
    // `render.ts:49-63` fait désormais venir l'`aria-label` de la région ET le `<h2>` visible
    // de la MÊME source (`_title(config)`).
    //
    // ⚠️ Le test lit le titre VISIBLE puis demande la région PAR CE NOM à l'arbre
    // d'accessibilité (`getByRole`). Si les deux divergeaient — le défaut B.38 — la région ne
    // serait pas trouvée sous le nom visible. C'est la seule façon de le prouver : `getByRole`
    // calcule le nom accessible (aria-label l'emporte), ce qu'un `getAttribute` ne fait pas.
    test("B.1 — le nom accessible du panneau de filtres égale son titre visible", async ({
        page,
    }) => {
        // Le panneau est `visibility: hidden` au boot ; l'ouvrir le fait entrer dans l'arbre.
        await page.getByRole("button", { name: "Filtres" }).first().click();

        const panel = page.locator(".gl-filter-panel.gl-is-open");
        await expect(panel).toBeVisible({ timeout: 10000 });

        // Le titre tel qu'un voyant le lit.
        const visibleTitle = (await panel.locator(".gl-filter-panel__title").textContent())?.trim();
        expect(visibleTitle, "titre visible introuvable").toBeTruthy();

        // La région telle qu'un lecteur d'écran la nomme. Si l'aria-label divergeait du titre
        // (« Filter » ≠ « Filtrer »), ce `getByRole` ne trouverait rien.
        await expect(
            page.getByRole("region", { name: visibleTitle }),
            `le nom accessible de la région ≠ le titre visible "${visibleTitle}" (WCAG 2.5.3)`
        ).toBeVisible({ timeout: 10000 });
    });

    // ── B.6 🔴 ────────────────────────────────────────────────────────────────────────
    // Contre-épreuve S2 : le sélecteur du piège de focus n'écoutait que `button` — un lien
    // (crédit photo, source) était donc SAUTÉ, et `Tab` sortait de la modale. Le sélecteur
    // inclut désormais `[href]` (`focus-trap.ts:30-31`). Second volet, invérifiable ailleurs :
    // le filtre `offsetParent !== null` ne garde que les focusables réellement VISIBLES, ce
    // qui n'a de sens que dans un moteur de rendu.
    //
    // On ouvre une galerie forgée (2 images) via l'API publique, on ouvre la lightbox, on y
    // injecte un lien, et on prouve que `Tab` depuis le lien (dernier focusable) revient au
    // bouton de fermeture (premier) — le focus reste piégé.
    test("B.6 — Tab dans la lightbox avec un lien reste piégé dans la modale", async ({ page }) => {
        await page.evaluate(() => {
            window.GeoLeaf.FeatureInfo.openSidePanel(
                {
                    layerId: "l1",
                    featureId: "f1",
                    properties: { gal: ["https://e.com/1.jpg", "https://e.com/2.jpg"] },
                    geometry: null,
                    lngLat: { lat: -48, lng: -58 },
                    point: { x: 10, y: 10 },
                },
                { layerId: "l1", fields: [{ field: "gal", type: "gallery" }] }
            );
        });

        await page.locator(".gl-poi-gallery__main img").click();
        const lightbox = page.locator(".gl-poi-lightbox-global");
        await expect(lightbox).toBeVisible({ timeout: 5000 });

        // Un lien légitime dans la modale (crédit / source) — exactement le cas que l'ancien
        // sélecteur `button` seul laissait échapper.
        await page.evaluate(() => {
            const box = document.querySelector(".gl-poi-lightbox-global");
            const a = document.createElement("a");
            a.href = "https://e.com/credit";
            a.textContent = "crédit";
            a.className = "gl-vn-credit";
            box.appendChild(a);
        });

        // Focus sur le lien (dernier focusable), puis Tab → doit revenir dans la modale.
        await page.locator("a.gl-vn-credit").focus();
        await page.keyboard.press("Tab");

        const stillTrapped = await page.evaluate(
            () => !!document.activeElement?.closest?.(".gl-poi-lightbox-global")
        );
        expect(
            stillTrapped,
            "Tab depuis le lien s'est échappé de la lightbox (sélecteur tronqué ?)"
        ).toBe(true);

        // Et le point de bouclage précis : Tab depuis le dernier focusable revient au premier
        // (le bouton de fermeture), pas ailleurs.
        const focusedClass = await page.evaluate(() => document.activeElement?.className ?? "");
        expect(focusedClass).toContain("gl-poi-lightbox__close");

        // Symétrie : Shift+Tab depuis le bouton de fermeture (premier) part vers le lien
        // (dernier). Le cycle est fermé aux DEUX bouts, pas seulement à un.
        await page.locator(".gl-poi-lightbox__close").focus();
        await page.keyboard.press("Shift+Tab");
        const wrappedToLast = await page.evaluate(
            () => document.activeElement?.className === "gl-vn-credit"
        );
        expect(wrappedToLast, "Shift+Tab depuis le premier ne boucle pas vers le dernier").toBe(
            true
        );
    });
});
