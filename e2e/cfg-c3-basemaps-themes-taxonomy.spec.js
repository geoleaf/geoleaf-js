// @ts-check
// Config-contract Phase C / C3 — E2E ciblés (état map/DOM réel) pour B4
// (basemaps / themes / taxonomy), sur deploy-core (profil tourism).
//
// La couverture EXHAUSTIVE par-valeur est en Vitest (__tests__/config/s12-*) :
// chaque type basemap (tile/raster/maplibre/image/hillshade/wmts/wms) → couche
// créée, défauts terrain/hillshade/wms, _validateConfig themes, getIconsConfig +
// TaxonomyManager. Ici on confirme seulement, en navigateur réel (rendu WebGL
// logiciel SwiftShader), que la chaîne config → effet tient de bout en bout pour
// le profil déployé, via des ancrages STABLES (ids de source/couche = constantes
// du code, sélecteurs de thème = classes du code) — pas d'assertion pixel.
//
// Décision scope (S12) : assertions sur l'état map/DOM, pas de screenshot/pixel
// (fragiles en SwiftShader headless).
//
// Préfixe `cfg-` (convention roadmap config-contract).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/** Boot the map and wait until GeoLeaf has resolved a native maplibregl.Map. */
async function bootMap(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    // ⚠️ La signature est `waitForFunction(fn, arg, options)` : les options DOIVENT être
    // le 3e argument. Passées en 2e, elles sont sérialisées comme `arg` et le wait
    // retombe silencieusement sur le timeout par défaut (`actionTimeout` — valeur dans
    // `playwright.config.js`, à ne pas recopier ici : elle a bougé le 01/08/2026).
    await page.waitForFunction(
        () => {
            const m = /** @type {any} */ (window).GeoLeaf;
            const native = m?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.getStyle === "function" && native.getStyle());
        },
        undefined,
        { timeout: 20000 }
    );
}

/** Read the native map style sources/layers + terrain + registered images. */
async function readMapState(page) {
    return page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const style = native.getStyle() || {};
        let images;
        try {
            images = typeof native.listImages === "function" ? native.listImages() : [];
        } catch {
            images = [];
        }
        let terrain;
        try {
            terrain = typeof native.getTerrain === "function" ? native.getTerrain() : null;
        } catch {
            terrain = null;
        }
        return {
            sourceIds: Object.keys(style.sources || {}),
            layerIds: (style.layers || []).map((l) => l.id),
            images,
            hasTerrain: !!terrain,
        };
    });
}

test.describe("cfg-c3 — basemaps/themes/taxonomy (état map/DOM réel)", () => {
    // ── basemaps[].type tile → couche basemap réellement créée ─────────────────
    test("basemaps: la couche de fond est ajoutée à la carte native", async ({ page }) => {
        await bootMap(page);
        // Le fond raster est injecté sous les couches data (registry.ts BASEMAP_*_ID).
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                const style = native.getStyle() || {};
                const hasSource = !!(style.sources && style.sources["__geoleaf_basemap__"]);
                const hasLayer = (style.layers || []).some(
                    (l) => l.id === "__geoleaf_basemap_layer__"
                );
                return hasSource || hasLayer;
            },
            undefined,
            { timeout: 15000 }
        );
        const state = await readMapState(page);
        expect(
            state.sourceIds.includes("__geoleaf_basemap__") ||
                state.layerIds.includes("__geoleaf_basemap_layer__")
        ).toBeTruthy();
    });

    // ── terrain 3D : le basemap par défaut (terrain-terrarium, default3D) ───────
    test("terrain 3D: le relief est activé pour le basemap par défaut", async ({ page }) => {
        await bootMap(page);
        // terrain-terrarium a default3D:true → setTerrain + source raster-dem "terrain-dem".
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                const style = native.getStyle() || {};
                const hasDem = !!(style.sources && style.sources["terrain-dem"]);
                let terrain;
                try {
                    terrain = native.getTerrain ? native.getTerrain() : null;
                } catch {
                    terrain = null;
                }
                return hasDem || !!terrain;
            },
            undefined,
            { timeout: 15000 }
        );
        const state = await readMapState(page);
        expect(state.hasTerrain || state.sourceIds.includes("terrain-dem")).toBeTruthy();
    });

    // ── taxonomy.icons : sprite résolu/injecté + icônes enregistrées ───────────
    test("taxonomy: le sprite profil est injecté et des icônes sont enregistrées", async ({
        page,
    }) => {
        // Capture AVANT tout script de page : les deux événements du moteur de thèmes
        // partent PENDANT le boot, donc s'y abonner après `goto()` les rate. Les deux sont
        // dispatchés sur `document` avec un détail `{ themeId }` — `geoleaf:theme:applying`
        // SYNCHRONEMENT à l'entrée d'`applyTheme` (kernel/themes/theme-applier/core.ts:315),
        // `geoleaf:theme:applied` à la fin de son dernier lot de couches (core.ts:356). Ce
        // sont les deux seuls émetteurs de ces noms dans le dépôt.
        await page.addInitScript(() => {
            const w = /** @type {any} */ (window);
            w.__glThemeEvents = { applying: [], applied: [] };
            document.addEventListener("geoleaf:theme:applying", (ev) => {
                const id = /** @type {any} */ (ev).detail?.themeId;
                if (typeof id === "string") w.__glThemeEvents.applying.push(id);
            });
            document.addEventListener("geoleaf:theme:applied", (ev) => {
                const id = /** @type {any} */ (ev).detail?.themeId;
                if (typeof id === "string") w.__glThemeEvents.applied.push(id);
            });
        });

        await bootMap(page);

        // 🛑 LE PROXY QUE MAPLIBRE 6 A FAIT BASCULER — « le bouton de thème existe » descend
        // de `revealApp()` (app/init-reveal.ts), et `revealApp()` est armé par un OU dont une
        // branche est un
        //
        // ⚠️ Une première rédaction de ce commentaire attribuait AUSSI `#geoleaf-map` visible
        // à `revealApp()`. C'est faux, et relu dans le code : `#geoleaf-map` est du markup
        // statique (`apps/geoleaf-app/index.html`), stylé `position:absolute; inset:0`
        // (`css/geoleaf-ui-base.css`) — il est visible dès la première mise en page. Ce qui
        // dépend de `revealApp()` est l'effacement de `#gl-loader`, un overlay DISTINCT
        // (`position:fixed; z-index:9999`), et `toBeVisible()` de Playwright ne tient pas
        // compte de l'occlusion. Seul le SECOND proxy est concerné. Le correctif reste juste ;
        // c'est son explication qui était fausse, et un mécanisme faux fait refaire le mauvais
        // diagnostic six mois plus tard.
        // MINUTEUR : il écoute `geoleaf:theme:applied` (ligne 161) *et* arme
        // `setTimeout(revealApp, 5000)` en filet de sécurité (ligne 177). Le même
        // `revealApp()` dispatche `geoleaf:app:ready`, et c'est cet événement — et lui seul,
        // en `{ once: true }` — qui MONTE la barre de thèmes
        // (capabilities/theme-selector/lifecycle.ts:70).
        //
        // Conséquence : dès que le boot dépasse 5 s, les boutons deviennent cliquables
        // PENDANT que `ThemeEngineModule` applique encore le thème par défaut. Les 8 couches
        // d'« environnement » (config/core/themes.json) sont alors en vol, et un clic ouvre
        // un SECOND `applyTheme` sur le même singleton `_ThemeApplier`, dont le premier geste
        // est `_hideAllLayers()` + `resetAllUserOverrides()` (theme-applier/visibility.ts:80).
        // Le clic lui-même part de surcroît sur un thread principal saturé — la cause
        // mesurée des `locator.click: Timeout` déjà documentés dans playwright.config.js.
        //
        // Et MapLibre 6 pousse précisément le boot vers ce seuil de 5 s : le moteur est passé
        // d'un fichier à un GRAPHE de 3 modules chargés en cascade, soit deux requêtes
        // sérialisées de plus avant que le premier octet de profil ne parte.
        //
        // On attend donc l'ÉTAT réellement utilisé — l'applier a commité le thème par défaut,
        // il est au repos — au lieu de la révélation, qui peut n'être qu'un minuteur.
        // "environnement" est le `config.defautTheme` de profiles/tourism (même ancrage que
        // le test « themes » ci-dessous).
        await page.waitForFunction(
            () =>
                /** @type {any} */ (window).__glThemeEvents?.applied?.includes("environnement") ===
                true,
            undefined,
            { timeout: 20000 }
        );

        // profile-sprite-loader injecte <svg data-geoleaf-sprite="profile"> (icons.spriteUrl).
        // UN SEUL exemplaire : le loader est appelé une fois PAR COUCHE et tous les
        // consommateurs (legend-symbols, maplibre-poi-icons, isProfileSpriteReady) le lisent
        // au `document.querySelector` — plusieurs racines et ils résolvent contre une copie
        // arbitraire. `toHaveCount(1)` verrouille l'unicité en plus de la présence (le
        // `toBeAttached` précédent ne pouvait même pas s'évaluer : 40 racines = strict mode
        // violation).
        const sprite = page.locator('svg[data-geoleaf-sprite="profile"]');
        await expect(sprite).toHaveCount(1, { timeout: 15000 });
        const symbolCount = await sprite.locator("symbol").count();
        expect(symbolCount).toBeGreaterThan(0);

        // ⚠️ PRÉCONDITION à établir explicitement — elle manquait, et c'est ce qui faisait
        // rougir la suite du test. Ce n'est PAS la mémoïsation de l'injection du sprite :
        // celle-ci ne supprime aucun appel à `registerSpriteIcons` (chaque appelant continue
        // d'enchaîner son propre `.then()`), et la bascule ci-dessous enregistre bien ses
        // 38 images `tourism-poi-cat-*` AVEC la mémoïsation en place.
        //
        // `map.addImage` n'est appelé que par `ensureLayerSpriteIcons` (maplibre-poi-icons.ts),
        // qui sort immédiatement quand la donnée ne porte AUCUNE feature `symbolId` — et
        // `symbolId` n'est injecté (`loader/single-layer.ts`, `injectSymbolIds`) que pour une
        // couche `showIconsOnMap: true`. Or le thème PAR DÉFAUT de tourism ("environnement" :
        // aires_protegees_nationales_sib, zones_de_conservation_wdpa, sites_de_conservation_wdpa
        // — explicitement `false` —, provinces, routes_principales, villes_principales) n'en
        // contient aucune : les 3 seules du profil sont `cultures` et `hebergements` (thème
        // "tourisme") et `sites_rosario` (hors thème). Le test attendait donc un effet dont il
        // n'avait jamais posé la cause.
        //
        // On bascule sur "tourisme" : c'est exactement le scénario que documente
        // `ensureLayerSpriteIcons` (« a POI layer loaded without a basemap change (e.g. a
        // data-theme switch) would render no icons »). L'assertion, elle, est inchangée.
        const tourisme = page.locator('.gl-theme-btn[data-theme-id="tourisme"]');
        await expect(tourisme).toBeVisible({ timeout: 10000 });
        await tourisme.click();

        // Le clic a-t-il ATTEINT `ThemeSelector.setTheme` ? `geoleaf:theme:applying` est
        // dispatché dans le même tour que le handler (core.ts:315, avant tout await), donc
        // son absence signe un clic avalé — et non un registrar d'icônes en panne. Sans ce
        // point d'ancrage, l'échec tombait 15 s plus loin sur `listImages()`, en désignant la
        // mauvaise cause : c'est exactement le mode d'échec que documente B-171.
        await page.waitForFunction(
            () =>
                /** @type {any} */ (window).__glThemeEvents?.applying?.includes("tourisme") ===
                true,
            undefined,
            { timeout: 10000 }
        );

        // maplibre-poi-icons enregistre chaque <symbol id> via map.addImage → préfixe
        // taxonomy.icons.symbolPrefix ("tourism-poi-cat-").
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                let imgs;
                try {
                    imgs = native.listImages ? native.listImages() : [];
                } catch {
                    imgs = [];
                }
                return imgs.some((id) => String(id).startsWith("tourism-poi-cat-"));
            },
            undefined,
            { timeout: 15000 }
        );
        const state = await readMapState(page);
        expect(state.images.some((id) => String(id).startsWith("tourism-poi-cat-"))).toBeTruthy();
    });

    // ── themes : thème par défaut appliqué + bascule primary (état DOM) ─────────
    test("themes: thème par défaut actif puis bascule primary (sélecteur)", async ({ page }) => {
        await bootMap(page);
        const primary = page.locator(".gl-theme-selector-primary");
        await expect(primary).toBeAttached({ timeout: 15000 });

        // tourism: defaultTheme "environnement" → bouton actif au boot.
        const active = page.locator(".gl-theme-btn--active");
        await expect(active).toHaveAttribute("data-theme-id", "environnement", { timeout: 10000 });

        // Bascule vers un autre thème primary ("tourisme") → l'actif suit le clic.
        const target = page.locator('.gl-theme-btn[data-theme-id="tourisme"]');
        await expect(target).toBeVisible({ timeout: 10000 });
        await target.click();
        await expect(target).toHaveClass(/gl-theme-btn--active/, { timeout: 10000 });
        await expect(page.locator('.gl-theme-btn[data-theme-id="environnement"]')).not.toHaveClass(
            /gl-theme-btn--active/
        );
    });
});
