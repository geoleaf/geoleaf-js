// @ts-check
// E2E feature-info — CAPACITÉ CORE (`packages/core/src/capabilities/feature-info/`)
// sur deploy-coverage (port 8769).
//
// ⚠️ feature-info N'EST PAS un plugin. Il n'existe aucun package
// `@geoleaf-plugins/feature-info` : c'est une capacité in-core, installée par
// `capabilities/feature-info/install.ts` et montée sur `GeoLeaf.FeatureInfo` par son
// `registerGlobals` (install.ts:49). L'en-tête S2 de ce fichier annonçait un plugin —
// c'était faux, corrigé ici.
//
// Garde de bout en bout des trois surfaces d'attributs GeoJSON : tooltip (survol),
// popup (clic) et side-panel (« Voir plus »), pilotées par le seam noyau
// `geoleaf:feature:hover` / `geoleaf:feature:click` (capabilities/feature-info/lifecycle.ts).
//
// Sélecteurs réellement émis par le code (inspection CAPACITÉS S11) :
//   - tooltip   → `.gl-fi-tooltip`      (surfaces/tooltip.ts:45)
//   - popup     → `.gl-fi-popup-ml`     (enveloppe MapLibre, surfaces/popup.ts:128)
//                 contenant `.gl-poi-popup` (racine du contenu, render/popup-content.ts:205)
//   - fermeture → touche Échap          (surfaces/popup.ts:135-138)
// Le popup est construit avec `closeButton: false` (popup.ts:125) : il N'Y A PAS de
// bouton de fermeture. Les classes `.gl-fi-popup` et `.gl-fi-close` que ce spec visait
// ne sont émises NULLE PART (grep = 0) — ces trois tests ne pouvaient donc pas passer.
//
// Cible : deploy-coverage (port 8769), profil `tourism` (deploy/deploy-core/profiles/
// geoleaf.config.json → data.activeProfile). `npm run build:deploy-coverage` doit avoir été
// exécuté avant ce spec.
//
// `serviceWorkers: 'block'` : empêche le SW PWA de médier le chargement.
//
// Run navigateur : `E2E_TARGET=nginx` vise les vhosts persistants et ne lance AUCUN serveur
// (e2e/helpers/base-url.js) ; le défaut `ports` reste la cible de référence, celle de la CI.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

// ⚠️ Les trois tests de rendu ci-dessous visaient `layerId: "reference-points"`, une couche
// du profil `_reference` qui n'est PAS déployée — le profil actif est `tourism`. Ils ne
// passaient donc que par le REPLI IMPLICITE : une couche inconnue peignait tout son sac de
// propriétés. La décision U2 (02/08/2026) retire ce repli, et c'est le trou qu'elle ferme —
// une couche inconnue ne doit rien peindre. Les tests sont RE-POINTÉS sur une couche
// réellement déployée et réellement déclarée, ce qui est plus fort qu'avant : ils
// éprouvent maintenant la chaîne complète déclaration → résolution → rendu.
// ⚠️ La couche doit être CHARGÉE au boot, pas seulement déclarée : le chargement
// intelligent ne monte que les couches du thème par défaut, et une couche déclarée mais
// non montée rend `unknown-layer` — donc rien. Celle-ci est vérifiée chargée dans un vrai
// navigateur contre le vhost, avec `properties.Name` déclaré sur les TROIS surfaces.
const LAYER = "aires_protegees_nationales_sib";
const FIELD = "Name";
const FIELD_VALUE = "Parc national des Écrins";

/** Boots the page and waits until GeoLeaf resolved a loaded native maplibregl.Map. */
async function bootMap(page) {
    await page.goto("/");
    await page.waitForSelector(".maplibregl-canvas", { timeout: 15000 });
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.loaded === "function" && native.loaded());
        },
        null,
        { timeout: 20000 }
    );
}

/**
 * Dispatches a kernel-seam `CustomEvent` until `selector` shows up in the DOM.
 *
 * The seam is EDGE-triggered, and its listeners are attached by
 * `FeatureInfoLifecycle.init()` — called from `FeatureInfoModule.init()`, which the
 * registry runs in the CAPABILITY pass: `app/boot-install.ts:117-128` registers the 6
 * kernel modules first, `app/boot-core.ts:210` registers the capability ones after
 * them, and `ModuleRegistry.init()` awaits each in that topological order. So the
 * listeners are wired strictly AFTER `UIModule` revealed the map and fired
 * `geoleaf:app:ready`. A single dispatch fired as soon as `.maplibregl-canvas` exists
 * races that wiring and is silently dropped — which is precisely what these tests were
 * doing (the surfaces are created lazily on first event, hence "element(s) not found",
 * not "hidden").
 *
 * Re-dispatching on a bounded poll removes the race WITHOUT touching any assertion:
 * the surface must still appear within the timeout, or the wait fails. Each dispatch is
 * synchronous end-to-end (`showTooltip` / `popup.addTo(map)` insert the node in the same
 * tick), so the very first poll that lands after the wiring returns true — no build-up.
 */
async function dispatchSeamUntil(page, type, detail, selector) {
    await page.waitForFunction(
        (arg) => {
            document.dispatchEvent(new CustomEvent(arg.type, { detail: arg.detail }));
            return !!document.querySelector(arg.selector);
        },
        { type, detail, selector },
        { timeout: 15000, polling: 250 }
    );
}

test.describe("feature-info (capacité core) — surfaces GeoJSON", () => {
    test("capacité chargée — GeoLeaf.FeatureInfo disponible", async ({ page }) => {
        await bootMap(page);

        // Le titre l'a toujours affirmé ; l'assertion, elle, se contentait de
        // `typeof window.GeoLeaf !== 'undefined'` — vraie même si la capacité était
        // absente. On vérifie la façade réelle : les 5 méthodes de
        // `FeatureInfoPublicApi` (types.ts:159, v2.1.0).
        const api = await page.evaluate(() => {
            const fi = /** @type {any} */ (window).GeoLeaf?.FeatureInfo;
            return fi ? Object.keys(fi).sort() : null;
        });
        expect(api).toEqual(["close", "getConfig", "isEnabled", "openPopup", "openSidePanel"]);
    });

    test("tooltip apparaît au survol d'une feature GeoJSON", async ({ page }) => {
        await bootMap(page);

        // Dispatch a synthetic geoleaf:feature:hover event (move phase).
        await dispatchSeamUntil(
            page,
            "geoleaf:feature:hover",
            {
                layerId: LAYER,
                featureId: "pt-1",
                properties: { [FIELD]: FIELD_VALUE },
                lngLat: { lat: 48.8, lng: 2.3 },
                point: { x: 200, y: 200 },
                zIndex: 0,
                phase: "move",
            },
            ".gl-fi-tooltip"
        );

        await expect(page.locator(".gl-fi-tooltip")).toBeVisible({ timeout: 3000 });
        await expect(page.locator(".gl-fi-tooltip")).toContainText(FIELD_VALUE);
    });

    test("popup apparaît au clic d'une feature GeoJSON", async ({ page }) => {
        await bootMap(page);

        await dispatchSeamUntil(
            page,
            "geoleaf:feature:click",
            {
                layerId: LAYER,
                featureId: "pt-1",
                properties: { [FIELD]: FIELD_VALUE },
                geometry: null,
                lngLat: { lat: 42.9, lng: 0.1 },
                point: { x: 300, y: 300 },
            },
            ".gl-fi-popup-ml"
        );

        const popup = page.locator(".gl-fi-popup-ml");
        await expect(popup).toBeVisible({ timeout: 3000 });
        // Le contenu construit par feature-info est la racine `.gl-poi-popup`,
        // à l'intérieur de l'enveloppe MapLibre.
        await expect(popup.locator(".gl-poi-popup")).toContainText(FIELD_VALUE);
    });

    test("popup se ferme via Échap (le popup est construit closeButton: false)", async ({
        page,
    }) => {
        await bootMap(page);

        await dispatchSeamUntil(
            page,
            "geoleaf:feature:click",
            {
                layerId: LAYER,
                featureId: "pt-1",
                properties: { [FIELD]: "Sommet" },
                geometry: null,
                lngLat: { lat: 45.0, lng: 6.0 },
                point: { x: 250, y: 250 },
            },
            ".gl-fi-popup-ml"
        );

        await expect(page.locator(".gl-fi-popup-ml")).toBeVisible({ timeout: 3000 });
        // Le seul chemin de fermeture au clavier : `_keyHandler` sur `document`
        // (surfaces/popup.ts:135-138) → `closePopup()` → `Popup.remove()`, qui
        // détache l'élément — d'où `toHaveCount(0)` plutôt qu'un simple "non visible".
        await page.keyboard.press("Escape");
        await expect(page.locator(".gl-fi-popup-ml")).toHaveCount(0);
    });
});
