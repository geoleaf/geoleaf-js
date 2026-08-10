// @ts-check
// Config-contract Phase C / C4 — E2E ciblés (état map/DOM réel) pour B5
// (layers.json + {id}_config.json), sur deploy-core (profil tourism).
//
// La couverture EXHAUSTIVE par-valeur est en Vitest (__tests__/config/s13-*) :
// index/templates (expandLayerTemplates), popup/tooltip/sidepanel fields
// (LoaderConfigHelpers), clustering (getClusteringStrategy), data.vectorTiles +
// scheme (VectorTiles), styles/legends (LayerConfigManager), verrous @anomaly.
// Ici on confirme, en navigateur réel (WebGL logiciel SwiftShader), que la chaîne
// layers.json + {id}_config.json → effet tient de bout en bout pour le profil
// déployé, via des ancrages STABLES (registre runtime des couches, source native
// clusterisée, API sidepanel, classes DOM) — pas d'assertion pixel.
//
// Décision scope (S13) : LIVE déterministe = APIs runtime + état map/DOM
// (pas de hover/clic canvas non-déterministe en headless).
//
// Préfixe `cfg-` (convention roadmap config-contract).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/**
 * Boot the map, wait for a native maplibregl.Map, then wait for PHASE 1 of smart
 * loading (all default-theme layers) to be complete.
 *
 * Attendre `getAllLayers().length > 0` ne suffit pas : le loader charge le thème par
 * défaut par lots de 3 en parallèle (geojson/loader/profile.ts `_loadLayersByBatch`,
 * batchSize 3 / 200 ms), donc le registre devient non vide dès la PREMIÈRE couche
 * résolue — la plus petite du lot, `villes_principales` (23 Ko contre 838 Ko pour
 * `aires_protegees_nationales_sib`). Une lecture faite à cet instant ne voit qu'une
 * couche, et les assertions par-couche deviennent une loterie.
 *
 * `geoleaf:layers:initial-loaded` (profile.ts:386) est émis exactement une fois, à la
 * fin de la phase 1. Le listener est posé via `addInitScript` — donc AVANT tout script
 * de page — pour qu'il soit impossible de manquer l'événement.
 */
async function bootMap(page) {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__glPhase1 = -1;
        document.addEventListener(
            "geoleaf:layers:initial-loaded",
            (e) => {
                /** @type {any} */ (window).__glPhase1 = /** @type {any} */ (e).detail?.count ?? 0;
            },
            { once: true }
        );
    });
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    // ⚠️ `waitForFunction(fn, arg, options)` : les options sont le 3e argument. Passées
    // en 2e, elles partent comme `arg` et le wait retombe sur `actionTimeout` — dont la
    // valeur se lit dans `playwright.config.js`, jamais ici (elle a bougé le 01/08/2026).
    await page.waitForFunction(
        () => {
            const m = /** @type {any} */ (window).GeoLeaf;
            const native = m?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.getStyle === "function" && native.getStyle());
        },
        undefined,
        { timeout: 20000 }
    );
    await page.waitForFunction(() => /** @type {any} */ (window).__glPhase1 >= 0, undefined, {
        timeout: 30000,
    });
}

test.describe("cfg-c4 — layers + {id}_config (état map/DOM réel)", () => {
    // ── layers.json → couches réellement chargées dans le registre runtime ──────
    test("layers.json: les couches du profil sont chargées (registre runtime)", async ({
        page,
    }) => {
        await bootMap(page);
        await page.waitForFunction(
            () => /** @type {any} */ (window.GeoLeaf.GeoJSON?.getAllLayers?.() || []).length > 0,
            undefined,
            { timeout: 20000 }
        );
        const ids = await page.evaluate(() =>
            /** @type {any} */ (window.GeoLeaf.GeoJSON.getAllLayers() || []).map((l) => l.id)
        );
        expect(ids.length).toBeGreaterThan(0);
    });

    // ── {id}_config.json → blocs d'interaction câblés dans les couches vivantes ──
    test("{id}_config.json: popup/tooltip/sidepanel atteignent le registre runtime", async ({
        page,
    }) => {
        await bootMap(page);
        await page.waitForFunction(
            () => /** @type {any} */ (window.GeoLeaf.GeoJSON?.getAllLayers?.() || []).length > 0,
            undefined,
            { timeout: 20000 }
        );
        // Smart loading charge d'abord les couches du thème par défaut ; on inspecte le
        // registre runtime (getLayerData(id).config) de toutes les couches CHARGÉES et on
        // prouve que les blocs d'interaction de {id}_config.json y arrivent — sans dépendre
        // d'une couche différée précise.
        //
        // Forme CANONIQUE de la déclaration attributaire : le bloc RACINE `attributes`,
        // une liste unique de champs dont chacun nomme ses surfaces. C'est exactement ce
        // que lit le runtime — `feature-info/convert.ts` (`resolveSurfaceFields`) puis
        // `attributes-binding.ts` (`fieldsForSurface`).
        //
        // ⚠️ Ce bloc lisait `capabilities["feature-info"]` jusqu'au 02/08/2026, avec
        // `tooltip` / `popup` / `sidepanel` en trois listes parallèles. La bascule du
        // Sprint 2 a retiré ce bloc des 48 configs ET du schéma : l'assertion est
        // RE-POINTÉE sur le successeur, pas relâchée. Ce qu'elle garde est inchangé —
        // qu'une déclaration écrite dans un `{id}_config.json` atteigne bien le registre
        // runtime, et que les trois surfaces y soient câblées.
        const configs = await page.evaluate(() => {
            const G = /** @type {any} */ (window).GeoLeaf.GeoJSON;
            return (G.getAllLayers() || []).map((l) => G.getLayerData(l.id)?.config || {});
        });
        expect(configs.length).toBeGreaterThan(0);
        const blocks = configs
            .map((c) => c.attributes)
            .filter((a) => a && Array.isArray(a.fields) && a.fields.length > 0);
        // ≥1 couche chargée porte bien un bloc `attributes` issu de {id}_config.json
        expect(blocks.length).toBeGreaterThan(0);

        /** Les surfaces réellement déclarées, toutes couches confondues. */
        const surfaces = new Set(
            blocks.flatMap((a) => a.fields.flatMap((f) => f.display?.surfaces || []))
        );
        expect(surfaces.has("popup")).toBeTruthy();
        expect(surfaces.has("tooltip")).toBeTruthy();
        expect(surfaces.has("sidepanel")).toBeTruthy();

        // ⚠️ Et le couple de type arrive INTACT jusqu'au runtime : c'est lui que la liste
        // blanche oppose au build, donc le perdre en route rendrait la garde décorative.
        const withPair = blocks
            .flatMap((a) => a.fields)
            .filter((f) => typeof f.primitive === "string" && typeof f.widget === "string");
        expect(withPair.length).toBeGreaterThan(0);
    });

    // ── clustering.enabled → source native clusterisée + dissolve (clusterMaxZoom) ─
    test("clustering: une source GeoJSON native est clusterisée (cluster + clusterMaxZoom)", async ({
        page,
    }) => {
        await bootMap(page);
        await page.waitForFunction(
            () => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                const sources = (native.getStyle() || {}).sources || {};
                return Object.values(sources).some((s) => /** @type {any} */ (s).cluster === true);
            },
            undefined,
            { timeout: 20000 }
        );
        const clustered = await page.evaluate(() => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const sources = (native.getStyle() || {}).sources || {};
            return Object.values(sources)
                .filter((s) => /** @type {any} */ (s).cluster === true)
                .map((s) => /** @type {any} */ (s).clusterMaxZoom);
        });
        expect(clustered.length).toBeGreaterThan(0);
        // disableClusteringAtZoom → MapLibre clusterMaxZoom (seuil de dissolution).
        expect(clustered.some((z) => typeof z === "number")).toBeTruthy();
    });

    // ── capabilities.feature-info.sidepanel → ouverture du panneau via l'API runtime ─
    //
    // `GeoLeaf.POI.showPoiDetails` n'existe plus : le namespace `GeoLeaf.POI` a été
    // DISSOUS (commit 02c6a8d0, 0 assignation `.POI =` dans le dépôt). Le remplaçant est
    // `GeoLeaf.FeatureInfo.openSidePanel(detail, layout)` — capacité core, pas plugin
    // (capabilities/feature-info/public-api.ts:32). Le payload change de forme avec lui :
    // `GeoLeafFeatureClickDetail` ({layerId, featureId, properties, geometry, lngLat,
    // point}, types.ts:117), plus le POI plat d'avant.
    //
    // ⚠️ Le conteneur `.gl-poi-sidepanel` est créé PARESSEUSEMENT (surfaces/sidepanel.ts,
    // `ensureContainer`) : il est absent du DOM tant qu'aucune ouverture n'a eu lieu — le
    // `toBeAttached` d'après l'appel est donc bien une preuve, pas une tautologie.
    test("sidepanel: GeoLeaf.FeatureInfo.openSidePanel ouvre le panneau latéral", async ({
        page,
    }) => {
        await bootMap(page);
        const hasApi = await page.evaluate(
            () =>
                typeof (/** @type {any} */ (window).GeoLeaf.FeatureInfo?.openSidePanel) ===
                "function"
        );
        expect(hasApi).toBeTruthy();

        // Le conteneur n'existe pas avant la première ouverture — on le prouve.
        await expect(page.locator(".gl-poi-sidepanel")).toHaveCount(0);

        await page.evaluate(() => {
            /** @type {any} */ (window).GeoLeaf.FeatureInfo.openSidePanel({
                layerId: "cfg-c4-layer",
                featureId: "cfg-c4-poi",
                properties: { name: "POI de test cfg-c4", title: "POI de test cfg-c4" },
                geometry: { type: "Point", coordinates: [-60.64, -32.95] },
                lngLat: { lat: -32.95, lng: -60.64 },
                point: { x: 0, y: 0 },
            });
        });

        const panel = page.locator(".gl-poi-sidepanel");
        await expect(panel).toBeAttached({ timeout: 10000 });
        await expect(panel).toHaveAttribute("aria-hidden", "false", { timeout: 10000 });
    });
});
