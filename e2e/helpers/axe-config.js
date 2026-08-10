// @ts-check
// Shared axe-core configuration for all GeoLeaf E2E accessibility tests.
// Uses @axe-core/playwright (AxeBuilder) — WCAG 2.1 A+AA tags, MapLibre canvas excluded.

import { AxeBuilder } from "@axe-core/playwright";

const WCAG_TAGS = ["wcag2a", "wcag2aa"];

/**
 * Selectors for MapLibre GL internals that cannot have accessible names by design.
 * Excluding them prevents false positives unrelated to application code.
 */
const MAPLIBRE_EXCLUDES = [".maplibregl-canvas", ".maplibregl-canvas-container"];

/**
 * axe rules disabled globally:
 * - svg-img-alt: MapLibre SVG icon sprites carry no text alternative by design.
 */
const DISABLED_RULES = ["svg-img-alt"];

/**
 * Waits until no CSS animation or transition is still RUNNING in the scanned scope.
 *
 * ⚠️ POURQUOI CETTE ATTENTE EXISTE — diagnostic du 24/07/2026 (backlog R.7b).
 * `10-addpoi.spec.js:172` ([a11y] add form modal) échouait **3 fois sur 4**, sur des
 * violations `color-contrast` *serious*. Ce n'était pas un défaut de contraste :
 *
 *   | Moment du scan            | opacity du panneau | violations |
 *   | ------------------------- | ------------------ | ---------- |
 *   | dès `toBeVisible()`       | **0**              | 3/5 sales  |
 *   | après stabilisation       | 1                  | **0/5**    |
 *
 * `expect(locator).toBeVisible()` est satisfait dès que l'élément a une boîte non vide :
 * **l'opacité n'entre pas dans ce critère**. Le scan tombait donc au milieu du fondu
 * d'ouverture, et `axe` mesurait des couleurs INTERPOLÉES — d'où des ratios différents à
 * chaque exécution (2,84 · 2,12 · 4,35) et des couleurs (`#8a909b` sur `#f1f1f1`) qui ne
 * sont l'état final de rien. Stabilisé : `rgb(15,23,42)` sur blanc, ~16:1.
 *
 * Le prédicat porte sur les ANIMATIONS, pas sur une valeur d'opacité cible : un élément
 * peut légitimement finir à `opacity: 0.5` (contrôle désactivé), et exiger `1` ferait
 * attendre pour rien. **Best-effort et borné** : une animation infinie (spinner) ne doit
 * pas bloquer le scan, donc l'expiration est avalée et le scan a lieu quand même.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [selector] scope; toute la page si omis
 */
async function waitAnimationsSettled(page, selector) {
    await page
        .waitForFunction(
            (sel) => {
                const roots = sel
                    ? [...document.querySelectorAll(sel)]
                    : [document.documentElement];
                if (!roots.length) return true;
                return roots.every((el) =>
                    typeof el.getAnimations === "function"
                        ? el
                              .getAnimations({ subtree: true })
                              .every((a) => a.playState !== "running")
                        : true
                );
            },
            selector,
            { timeout: 2000 }
        )
        .catch(() => {
            /* animation sans fin, ou sélecteur absent : on scanne l'état courant */
        });
}

/**
 * Runs a full-page WCAG 2.1 AA axe scan, excluding MapLibre GL internals.
 * Waits for in-flight animations to settle first (see {@link waitAnimationsSettled}).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('axe-core').AxeResults>}
 */
async function scanPage(page) {
    await waitAnimationsSettled(page);
    let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS).disableRules(DISABLED_RULES);
    for (const sel of MAPLIBRE_EXCLUDES) {
        builder = builder.exclude(sel);
    }
    return builder.analyze();
}

/**
 * Runs a WCAG 2.1 AA axe scan scoped to a single component by CSS selector.
 * Useful for modal dialogs, panels, or toolbars in isolation — c'est-à-dire précisément
 * les surfaces qui s'ouvrent en fondu, d'où l'attente de stabilisation.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector CSS selector to scope the scan to
 * @returns {Promise<import('axe-core').AxeResults>}
 */
async function scanComponent(page, selector) {
    await waitAnimationsSettled(page, selector);
    return new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .disableRules(DISABLED_RULES)
        .include(selector)
        .analyze();
}

export { scanPage, scanComponent, waitAnimationsSettled };
