// @ts-check
// Tâche 1.5.9 — Tests WCAG automatisés via @axe-core/playwright
//
// Suite dédiée accessibilité : scans axe approfondis sur les 3 variantes de
// déploiement + tests comportementaux (focus trap, keyboard nav, ARIA).
//
// Références :
//   - RGAA 4.1 / WCAG 2.1 AA (obligatoire organismes publics)
//   - packages/core/docs/ACCESSIBILITY.md — patterns ARIA implémentés
//   - Décision : scans page entière, exclusion canvas MapLibre, runOnly wcag2aa

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage, scanComponent } from "./helpers/axe-config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Groupe 1 — Baseline axe scans sur les 2 variantes de déploiement
// Vérifie qu'aucun plugin tiers n'introduit de régression WCAG.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][baseline] axe scans — 2 deploy variants", () => {
    test("core (deploy-core) passes WCAG 2.1 AA", async ({ page }) => {
        page.context().setDefaultTimeout(30000);
        await page.goto(`${baseURL("core")}/`);
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        // Allow secondary modules to attach their DOM before scanning
        await page.waitForTimeout(3000);
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });

    // ⚠️ 5.5 — UN SCAN A DISPARU, ET C'EST UNE SUPPRESSION, PAS UN REPOINTAGE.
    // Il visait `deploy-addpoi`, avec ce motif : « cette variante n'avait AUCUN scan a11y, et
    // c'est la seule où le bouton et le formulaire d'ajout de POI sont rendus ». Le motif est
    // tombé avec la variante — le bouton `poi-add` et son formulaire vivent maintenant sur
    // `deploy-full`, que le scan ci-dessous couvre déjà. Le repointer aurait produit un
    // DOUBLON à l'octet près, exactement ce que le commentaire d'ARCHI S8 refusait de faire
    // pour `deploy-storage`. La surface a11y du parcours POI n'est donc pas perdue : elle est
    // dans le scan `full`, et `09-editor.spec.js` porte son propre scan de l'éditeur.

    test("full (deploy-full) passes WCAG 2.1 AA", async ({ page }) => {
        page.context().setDefaultTimeout(30000);
        await page.goto(`${baseURL("full")}/`);
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Groupe 2 — Composants UI : layer manager, légende, table, zoom controls
// Tests ciblés sur les composants toujours présents dans le profil tourism.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][ui-components] ARIA sur composants UI actifs", () => {
    test.use({ baseURL: baseURL("core") });

    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);
    });

    test("layer manager (.gl-layer-manager) passe axe scan", async ({ page }) => {
        await expect(page.locator(".gl-layer-manager")).toBeAttached({ timeout: 5000 });
        const results = await scanComponent(page, ".gl-layer-manager");
        expect(results.violations).toEqual([]);
    });

    test("légende (.gl-map-legend) passe axe scan", async ({ page }) => {
        await expect(page.locator(".gl-map-legend")).toBeAttached({ timeout: 5000 });
        const results = await scanComponent(page, ".gl-map-legend");
        expect(results.violations).toEqual([]);
    });

    test("contrôles zoom MapLibre ont des labels accessibles", async ({ page }) => {
        // GeoLeaf toolbar zoom controls must have accessible names for screen readers.
        // Use toBeAttached (not toBeVisible) — controls exist in DOM but may be
        // considered "hidden" by Playwright due to toolbar overflow in headless.
        const zoomIn = page.locator('[data-gl-toolbar-action="zoom-in"]');
        const zoomOut = page.locator('[data-gl-toolbar-action="zoom-out"]');
        await expect(zoomIn).toBeAttached({ timeout: 5000 });
        await expect(zoomOut).toBeAttached({ timeout: 5000 });
        // Verify aria-label or title is present
        const zoomInLabel =
            (await zoomIn.getAttribute("aria-label")) ?? (await zoomIn.getAttribute("title"));
        const zoomOutLabel =
            (await zoomOut.getAttribute("aria-label")) ?? (await zoomOut.getAttribute("title"));
        expect(zoomInLabel).toBeTruthy();
        expect(zoomOutLabel).toBeTruthy();
    });

    test("tableau (.gl-table-panel) passe axe scan quand présent", async ({ page }) => {
        // DEUX paresses à lever (cf. 21-table.spec.js) :
        //  1. le BUNDLE est lazy (registerLazy)  → plugins.load('table')
        //  2. le PANNEAU DOM est lazy : CDC_plugin-table §2.3bis (commit d2e3187a) —
        //     avec `modules.table.defaultVisible: false` (profil tourism),
        //     `geoleaf:map:ready` ne construit rien ; `TableLifecycle.ensureInitialized()`
        //     bâtit le DOM au 1er déclenchement de l'action toolbar `table`.
        // Charger le bundle seul laisse donc `.gl-table-panel` absent du DOM.
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("table"));
        await page.waitForFunction(
            () => typeof (/** @type {any} */ (window).GeoLeaf?.Table) === "object",
            null,
            { timeout: 10000 }
        );
        await expect(page.locator('[data-gl-toolbar-action="table"]').first()).toBeAttached({
            timeout: 10000,
        });
        await page.evaluate(() => {
            /** @type {HTMLElement|null} */ (
                document.querySelector('[data-gl-toolbar-action="table"]')
            )?.click();
        });
        const tablePanel = page.locator(".gl-table-panel");
        await expect(tablePanel).toBeAttached({ timeout: 10000 });
        const results = await scanComponent(page, ".gl-table-panel");
        expect(results.violations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Groupe 3 — Focus management et navigation clavier
// Tests comportementaux : Escape, Tab, focus trap, retour focus.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][keyboard] navigation clavier / focus management", () => {
    test.use({ baseURL: baseURL("core") });

    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);
    });

    test("contrôles carte atteignables au clavier (Tab depuis body)", async ({ page }) => {
        // Press Tab from body — at least one visible interactive map control must receive focus
        await page.keyboard.press("Tab");
        const focused = page.locator(":focus");
        // The focused element should be inside the MapLibre container or GeoLeaf controls
        const focusedCount = await focused.count();
        expect(focusedCount).toBeGreaterThan(0);
    });

    test("side panel s'ouvre programmatiquement et ariahidden=false", async ({ page }) => {
        // Le conteneur `.gl-poi-sidepanel` est créé PARESSEUSEMENT à la première ouverture
        // (capabilities/feature-info/surfaces/sidepanel.ts:47 — `if (_el && _content) return _el;`) :
        // il n'existe pas dans le DOM au boot. On l'ouvre donc par la façade publique
        // `GeoLeaf.FeatureInfo.openSidePanel(detail, layout)` (feature-info/public-api.ts:32),
        // ce que dit le titre du test. `modules.feature-info.enabled: true` dans tourism.
        await page.evaluate(() => {
            /** @type {any} */ (window).GeoLeaf.FeatureInfo.openSidePanel(
                {
                    layerId: "a11y-e2e",
                    featureId: "a11y-1",
                    properties: { title: "Panneau a11y" },
                    geometry: { type: "Point" },
                    lngLat: { lat: -32.95, lng: -60.64 },
                    point: { x: 0, y: 0 },
                },
                { layerId: "a11y-e2e", fields: [{ field: "title", type: "text", label: "Titre" }] }
            );
        });

        const sidepanel = page.locator(".gl-poi-sidepanel");
        await expect(sidepanel).toBeAttached({ timeout: 10000 });
        await expect(sidepanel).toHaveClass(/(^|\s)open(\s|$)/);

        // Exposition aux technologies d'assistance une fois OUVERT — ce que dit le titre.
        // Le shell est un landmark nommé, et `openSidePanel` repasse `aria-hidden` à
        // "false" + retire `inert` (sidepanel.ts) : fermé, le tiroir reste dans le DOM,
        // masqué par un simple `transform: translateX(100%)`, donc hors écran ≠ masqué —
        // c'est la paire aria-hidden/inert qui le sort de l'arbre a11y et du tab order.
        expect(await sidepanel.getAttribute("role")).toBe("complementary");
        expect(await sidepanel.getAttribute("aria-label")).toBeTruthy();
        expect(await sidepanel.getAttribute("aria-hidden")).toBe("false");
        expect(await sidepanel.getAttribute("inert")).toBeNull();

        // Focus management (objet de ce groupe) : l'ouverture déplace le focus sur
        // « Fermer » (sidepanel.ts), donc les utilisateurs clavier/lecteur d'écran
        // atterrissent DANS le panneau — impossible si le sous-arbre était resté inert.
        await expect(sidepanel.locator("[data-action='close']")).toBeFocused();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Groupe 4 — Mobile viewport (375×667)
// Vérifie WCAG sur les composants spécifiquement mobiles.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][mobile] viewport 375×667", () => {
    test.use({
        baseURL: baseURL("core"),
        viewport: { width: 375, height: 667 },
    });

    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);
    });

    test("page entière passe axe scan en viewport mobile", async ({ page }) => {
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });

    test("mobile toolbar (.gl-map-toolbar) a role=toolbar si présent", async ({ page }) => {
        // The mobile toolbar is always initialized by initMobileToolbar() when .gl-main exists.
        const toolbar = page.locator(".gl-map-toolbar");
        await expect(toolbar).toBeAttached({ timeout: 10000 });
        const role = await toolbar.getAttribute("role");
        expect(role).toBe("toolbar");
        const results = await scanComponent(page, ".gl-map-toolbar");
        expect(results.violations).toEqual([]);
    });

    test("sheet modal ([role=dialog][aria-modal]) passe axe si ouvert", async ({ page }) => {
        // The sheet overlay is created at initMobileToolbar() init time.
        // Open it via the layers toolbar button (showLayerManager: true in tourism profile).
        const sheetTrigger = page.locator('[data-gl-sheet="layers"]').first();
        await expect(sheetTrigger).toBeAttached({ timeout: 10000 });
        await sheetTrigger.click();
        const sheet = page.locator('.gl-sheet-overlay[aria-modal="true"]').first();
        await expect(sheet).toBeVisible({ timeout: 5000 });
        // Verify required ARIA attributes
        const ariaLabel =
            (await sheet.getAttribute("aria-labelledby")) ??
            (await sheet.getAttribute("aria-label"));
        expect(ariaLabel).toBeTruthy();
        const results = await scanComponent(page, ".gl-sheet-overlay");
        expect(results.violations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Groupe 5 — Lightbox
// Conditionnel : profil tourism ne contient pas de POI avec images.
// Ce test est un placeholder ; il sera activé quand des données images
// seront présentes dans un profil de déploiement.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][lightbox] dialog ARIA (conditionnel)", () => {
    test.use({ baseURL: baseURL("core") });

    test("lightbox passe axe scan si déclenchable", async () => {
        // Skip: the tourism profile (deploy-core) has no POI with image galleries.
        // To enable: use a deploy profile where poiConfig.enabled=true and a POI
        // has at least one image in its content → click the image thumbnail to open
        // the lightbox, then run axe on [role="dialog"].gl-poi-lightbox-global.
        //
        // 🎫 B-188 (`_docs_projet/registres/backlog_technique.md`) — POURQUOI et QUAND.
        // ⚠️ Cette référence manquait, et ce `skip` était le SEUL du corpus e2e à violer la
        // règle de `CLAUDE.md` : « aucun .skip / .todo committé sans un commentaire pointant
        // un ticket, une ligne de registre ou une ligne de roadmap ». Les cinq autres citent
        // B-55 (08-realtime), B-04 (vn-toasts) ou la garde complémentaire NGINX-01
        // (18-security). Mesuré au pré-vol du Sprint 11 (S11.2, 08/08/2026).
        // ⚠️ Ce qui reste ouvert n'est PAS « ajouter ce commentaire » : c'est de décider s'il
        // faut fournir un profil de test portant un POI avec image. Sans lui la lightbox n'a
        // AUCUNE couverture a11y, et elle ouvre un `role="dialog"`.
        test.skip(
            true,
            "Lightbox skipped: no POI with images in the tourism profile. " +
                "Enable poiConfig and add image data to a POI to activate this test. " +
                "Tracked as B-188."
        );
    });
});
