// @ts-check
// S5.3 — E2E table (@geoleaf-plugins/table) sur deploy-coverage (port 8769).
//
// Garde de bout en bout pour l'extraction de la table core → plugin : prouve que,
// une fois le plugin chargé, la façade GeoLeaf.Table se monte, le panneau bottom-sheet
// s'attache au DOM via le cycle de vie du plugin (geoleaf:map:ready), et que
// l'ouverture/fermeture + le câblage de l'action toolbar (`geoleaf:toolbar:action` →
// Table.open) tiennent en navigateur.
//
// 2026-07-02 — table converti en plugin LAZY (registerLazy + registerLazyForAction
// dans init.js, comme print/measure/editor — cf. 14-print.spec.js). Le bundle
// `dist/geoleaf-table.plugin.js` n'est plus chargé au boot : le bouton d'onglet
// apparaît immédiatement (registerLazyForAction), mais GeoLeaf.Table n'existe
// qu'après chargement (clic réel ou GeoLeaf.plugins.load('table')).
//
// DEUX paresses distinctes, ne pas les confondre :
//   1. le BUNDLE est lazy (registerLazy)                → levé par plugins.load('table')
//   2. le PANNEAU DOM est lazy (CDC §2.3bis, d2e3187a)  → levé par l'action `table`
// `defaultVisible: false` ⇒ `geoleaf:map:ready` ne construit rien ;
// `TableLifecycle.ensureInitialized()` bâtit le DOM au 1er déclenchement de
// l'action, puis `entry.ts` appelle `GeoLeaf.Table.open()`. Charger le bundle seul
// ne fait donc PAS apparaître `.gl-table-panel` — voir le helper `fireTableAction`.
//
// Cible : deploy-coverage (roadmap S5.3) — copie de deploy-core (profil actif `tourism`,
// `modules.table.showButton` non désactivé). Le port 8769 est démarré par le
// webServer de playwright.config.js ; `npm run build:deploy-coverage` doit avoir peuplé
// `deploy/deploy-coverage` au préalable (après `build:deploy:all`).
//
// Périmètre : garde déterministe de l'extraction (montage + façade + ouverture + UI). Le
// flux riche pilotée par les données (sélection couche → lignes, tri, sélection ligne →
// surbrillance/zoom carte, export GeoJSON/CSV/KML/GPX/Excel) est volontairement laissé au
// test MANUEL desktop+mobile de S7.3 : il dépend d'une couche `table.enabled` *visible* au
// boot et chargée en GeoJSON plein (les couches vectorTiles n'exposent pas `features`), ce
// qui n'est pas déterministe ici — même posture que 04-core-ui-features / 05-accessibility qui
// n'assertent que la présence du panneau.
//
// `serviceWorkers: 'block'` : même précaution que les autres specs plugin sur variante PWA.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

const TABLE_CHUNK = /geoleaf-table\.plugin\.js/;

/** Returns whether a resource matching `re` has been requested by the page. */
function resourceLoaded(page, re) {
    return page.evaluate(
        (src) => performance.getEntriesByType("resource").some((e) => new RegExp(src).test(e.name)),
        re.source
    );
}

async function bootMap(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.loaded === "function" && native.loaded());
        },
        null,
        { timeout: 20000 }
    );
    await page
        .locator("#gl-loader")
        .waitFor({ state: "hidden", timeout: 10000 })
        .catch(() => {});
}

/** Loads the lazy table plugin (what the toolbar action does) and waits for its API. */
async function armTable(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("table"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Table) === "object",
        null,
        { timeout: 10000 }
    );
}

/**
 * Déclenche l'action toolbar `table` — le SEUL chemin qui construit le panneau.
 *
 * CDC_plugin-table §2.3bis (commit `d2e3187a`, 28/06/2026) : avec
 * `modules.table.defaultVisible: false`, `geoleaf:map:ready` ne construit plus le
 * panneau ; `TableLifecycle.ensureInitialized()` le bâtit au PREMIER déclenchement
 * de l'action `"table"`, et `entry.ts` enchaîne sur `GeoLeaf.Table.open()`.
 * Charger le bundle ne suffit donc pas à faire exister `.gl-table-panel`.
 */
async function fireTableAction(page) {
    await expect(page.locator('[data-gl-toolbar-action="table"]').first()).toBeAttached({
        timeout: 10000,
    });
    await page.evaluate(() => {
        /** @type {HTMLElement|null} */ (
            document.querySelector('[data-gl-toolbar-action="table"]')
        )?.click();
    });
}

test.describe("21-table — lazy boundary (registerLazy + registerLazyForAction)", () => {
    test("the namespace and the lazy bundle are both absent at boot", async ({ page }) => {
        await bootMap(page);
        const ns = await page.evaluate(() => typeof (/** @type {any} */ (window).GeoLeaf?.Table));
        expect(ns).toBe("undefined");
        expect(await resourceLoaded(page, TABLE_CHUNK)).toBe(false);
    });

    test("the table toolbar button is rendered at boot (lazy action)", async ({ page }) => {
        await bootMap(page);
        // registerLazyForAction shows the tab immediately via getLazyUISlots().
        await expect(page.locator('[data-gl-toolbar-action="table"]').first()).toBeVisible({
            timeout: 10000,
        });
    });
});

test.describe("21-table — façade + panneau + ouverture (deploy-coverage, tourism)", () => {
    test("le plugin se charge et le panneau se monte (chargement lazy)", async ({ page }) => {
        await bootMap(page);
        await armTable(page);
        expect(await resourceLoaded(page, TABLE_CHUNK)).toBe(true);

        // Le bundle plugin est injecté et la façade est montée sur le namespace public.
        const api = await page.evaluate(() => {
            const T = /** @type {any} */ (window).GeoLeaf?.Table;
            if (!T) return null;
            return [
                "open",
                "show",
                "hide",
                "toggle",
                "setLayer",
                "sortByField",
                "getSelectedIds",
            ].map((m) => typeof T[m]);
        });
        expect(api).not.toBeNull();
        expect(api).toEqual([
            "function",
            "function",
            "function",
            "function",
            "function",
            "function",
            "function",
        ]);

        // §2.3bis — `defaultVisible: false` sous sa forme FORTE : charger le bundle ne
        // construit AUCUN DOM. (Avant d2e3187a, panel.ts attachait le panneau caché au
        // boot du plugin ; ce n'est plus le contrat — cf. lifecycle.ts `_onMapReady`.)
        await expect(page.locator(".gl-table-panel")).toHaveCount(0);

        // Le premier déclenchement de l'action construit le panneau (ensureInitialized).
        await fireTableAction(page);
        await expect(page.locator(".gl-table-panel")).toBeAttached({ timeout: 10000 });
    });

    test("open() révèle un panneau fonctionnel, toggle() le referme", async ({ page }) => {
        await bootMap(page);
        await armTable(page);
        // §2.3bis : le panneau n'existe qu'après le 1er déclenchement de l'action, qui le
        // construit ET l'ouvre. On le referme par la façade pour retrouver EXACTEMENT la
        // précondition testée ci-dessous (panneau monté, fermé) avant d'exercer open().
        await fireTableAction(page);
        const panel = page.locator(".gl-table-panel");
        await expect(panel).toBeAttached({ timeout: 10000 });
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Table.hide());
        await expect(panel).not.toHaveClass(/gl-is-visible/);

        // Ouverture via la façade publique (équivalent au clic du bouton toolbar `action:table`).
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Table.open());
        await expect(panel).toHaveClass(/gl-is-visible/, { timeout: 10000 });

        // La toolbar et ses contrôles sont rendus.
        await expect(page.locator(".gl-table-panel__toolbar")).toBeVisible();
        await expect(page.locator("[data-table-layer-select]")).toBeAttached();
        await expect(page.locator("[data-table-search]")).toBeAttached();

        // Sans sélection, les actions dépendantes de la sélection sont désactivées.
        await expect(page.locator("[data-table-btn='zoom']")).toBeDisabled();
        await expect(page.locator("[data-table-btn='highlight']")).toBeDisabled();

        // Fermeture via la façade.
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Table.toggle());
        await expect(panel).not.toHaveClass(/gl-is-visible/);
    });

    test("l'action toolbar `table` déclenche le chargement lazy PUIS l'ouverture", async ({
        page,
    }) => {
        await bootMap(page);
        expect(await resourceLoaded(page, TABLE_CHUNK)).toBe(false);

        // Simule le clic réel : dispatche l'action toolbar sans pré-charger le plugin.
        // desktop-panel-slots.ts intercepte via plugins.isLazyAction()/ensureLoadedForAction()
        // avant de redispatcher l'événement une fois le bundle chargé.
        await page.evaluate(() => {
            const btn = /** @type {any} */ (document).querySelector(
                '[data-gl-toolbar-action="table"]'
            );
            btn?.click();
        });

        const panel = page.locator(".gl-table-panel");
        await expect(panel).toBeAttached({ timeout: 10000 });
        await expect(panel).toHaveClass(/gl-is-visible/, { timeout: 10000 });
        expect(await resourceLoaded(page, TABLE_CHUNK)).toBe(true);
    });
});
