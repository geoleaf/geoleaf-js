// @ts-check
// Config-contract Phase C / C5 — E2E ciblés (état map/DOM réel) pour B6
// (styles/{style}.json), sur deploy-core (profil tourism).
//
// La couverture EXHAUSTIVE par-valeur est en Vitest (__tests__/config/s14-*) :
// converter flat → paint/layout (maplibre-style-converter), styleRules par opérateur
// (conditionToExpression + GeoJSONStyleResolver), scaleConfig/labelScale (scale-utils),
// legend (LegendGenerator), verrous @anomaly (style.schema.json). Ici on confirme, en
// navigateur réel (WebGL logiciel SwiftShader), que la chaîne styles/{style}.json → rendu
// tient de bout en bout : couleur résolue dans le paint MapLibre natif, règle
// conditionnelle appliquée (expression data-driven + moteur runtime), bascule de style
// (styles.available + setLayerStyle), légende rendue dans le DOM. Pas d'assertion pixel.
//
// Préfixe `cfg-` (convention roadmap config-contract).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/**
 * Boot the map, wait for a native maplibregl.Map, then wait for PHASE 1 of smart
 * loading (every default-theme layer) — not merely for the first one.
 *
 * `getAllLayers().length > 0` est une attente TROP FAIBLE et c'est elle qui faisait
 * rougir le test « couleurs statiques » : le loader charge le thème par défaut par
 * lots de 3 EN PARALLÈLE (geojson/loader/profile.ts, `_loadLayersByBatch`), donc le
 * registre devient non vide dès la première couche résolue — soit la plus petite,
 * `villes_principales` (23 Ko, contre 838 Ko et 277 Ko pour les deux autres du lot).
 * Or c'est justement une couche de POINTS liée à la taxonomie
 * (`modules.taxonomy.layers.villes_principales`), donc son `circle-color` est REMPLACÉ
 * par l'expression `match` de la taxonomie (adapters/maplibre/maplibre-taxonomy-paint.ts
 * → marker-paint.ts:66). Lue seule, la carte n'expose donc QUE des expressions : la
 * première assertion (`length > 0`) passait, la seconde (au moins une couleur statique)
 * tombait — le style flat des couches voisines n'était pas encore là.
 *
 * `geoleaf:layers:initial-loaded` (profile.ts:386) est émis une fois, à la fin de la
 * phase 1. Le listener est posé par `addInitScript`, donc avant tout script de page :
 * l'événement ne peut pas être manqué.
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
    await page.waitForFunction(
        () => /** @type {any} */ (window.GeoLeaf.GeoJSON?.getAllLayers?.() || []).length > 0,
        undefined,
        { timeout: 20000 }
    );
}

/** Collect the color paint of every native data layer (fill/line/circle/fill-extrusion). */
function collectDataLayerColors() {
    const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
    const COLOR_KEY = {
        fill: "fill-color",
        line: "line-color",
        circle: "circle-color",
        "fill-extrusion": "fill-extrusion-color",
    };
    const layers = (native.getStyle() || {}).layers || [];
    const colors = [];
    for (const lyr of layers) {
        const key = COLOR_KEY[lyr.type];
        if (!key) continue; // skip raster basemap / background
        try {
            const v = native.getPaintProperty(lyr.id, key);
            if (v !== undefined && v !== null) colors.push(v);
        } catch {
            /* layer without that paint key */
        }
    }
    return colors;
}

test.describe("cfg-c5 — styles/{style}.json (état map/DOM réel)", () => {
    // ── style flat → paint MapLibre natif (rendu couleur) ───────────────────────
    test("style: les couleurs du style atteignent le paint natif des couches", async ({ page }) => {
        await bootMap(page);
        const colors = await page.evaluate(collectDataLayerColors);
        expect(colors.length).toBeGreaterThan(0);
        // Au moins une couleur statique résolue (string hex/CSS) → style flat appliqué.
        // Le thème par défaut (environnement) en fournit plusieurs une fois la phase 1
        // terminée : routes_principales line-color "#ffffff" (+ casing "#000000"),
        // provinces line-color "#000000", aires_protegees line-color "#232323",
        // zones_de_conservation_wdpa fill-color "transparent" (hatch pattern_only).
        expect(colors.some((c) => typeof c === "string" && c.length > 0)).toBeTruthy();
    });

    // ── styleRules → paint data-driven, couleurs réellement livrées ─────────────
    //
    // ⚠️ Cette version ne sonde plus `GeoLeaf._StyleRules` : ce global a été retiré
    // délibérément (API publique S4.3b, kernel/geojson/style-resolver.ts:114-121) — il
    // n'avait aucun lecteur de production, seuls ce spec et des tests le lisaient. Le
    // chemin RÉELLEMENT livré pour les styleRules est `styleRulesToPaint` →
    // adapters/maplibre/maplibre-style-applier.ts → expression MapLibre native
    // (case/match/step). Les sémantiques par opérateur restent couvertes sous Node par
    // __tests__/config/s14-style-rules-operators.test.js ; ici on ne confirme que le
    // dernier maillon : config chargée → paint natif.
    test("styleRules: couleurs du profil retrouvées dans le paint data-driven natif", async ({
        page,
    }) => {
        await bootMap(page);

        // Découvre une couche RÉELLEMENT chargée qui porte des styleRules à ≥2 couleurs
        // distinctes (jamais un id de couche codé en dur — le thème par défaut peut
        // changer) et vérifie que chaque couleur déclarée dans son style/{style}.json se
        // retrouve dans l'expression envoyée au sous-layer natif `gl-{layerId}-{type}`
        // (convention maplibre-layer-registry.ts).
        const probe = await page.evaluate(() => {
            const G = /** @type {any} */ (window).GeoLeaf.GeoJSON;
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const COLOR_KEY = { fill: "fill-color", line: "line-color", circle: "circle-color" };

            const summaries = G.getAllLayers() || [];
            for (const summary of summaries) {
                const rules = G.getLayerData(summary.id)?.config?.styleRules;
                if (!Array.isArray(rules) || rules.length === 0) continue;

                const declaredColors = Array.from(
                    new Set(
                        rules
                            .map((r) => r?.style?.fillColor || r?.style?.color)
                            .filter((c) => typeof c === "string" && c.length > 0)
                    )
                );
                // Il faut ≥2 branches pour prouver un rendu CONDITIONNEL, pas une constante.
                if (declaredColors.length < 2) continue;

                const nativeLayers = (native.getStyle() || {}).layers || [];
                for (const lyr of nativeLayers) {
                    if (!lyr.id.startsWith(`gl-${summary.id}-`)) continue;
                    const key = COLOR_KEY[lyr.type];
                    if (!key) continue;
                    let paint;
                    try {
                        paint = native.getPaintProperty(lyr.id, key);
                    } catch {
                        continue;
                    }
                    if (!Array.isArray(paint)) continue; // pas une expression data-driven

                    const serialized = JSON.stringify(paint);
                    const matchedColors = declaredColors.filter((c) => serialized.includes(c));
                    return {
                        layerId: summary.id,
                        nativeLayerId: lyr.id,
                        declaredColors,
                        matchedColors,
                    };
                }
            }
            return null;
        });

        expect(
            probe,
            "aucune couche chargée ne porte de styleRules à ≥2 couleurs avec paint en expression native"
        ).not.toBeNull();
        // Chaque couleur déclarée par les styleRules du profil doit se retrouver dans
        // l'expression native — pas seulement « au moins une expression existe quelque part ».
        expect(probe.matchedColors).toEqual(probe.declaredColors);
    });

    // ── styles.available → alternates configurables + bascule via setLayerStyle ──
    test("styles.available: alternates exposés + API setLayerStyle câblée", async ({ page }) => {
        await bootMap(page);
        const probe = await page.evaluate(() => {
            const G = /** @type {any} */ (window).GeoLeaf.GeoJSON;
            const layers = G.getAllLayers() || [];
            const configs = layers.map((l) => G.getLayerData(l.id)?.config || {});
            const withAlternates = configs.filter(
                (c) =>
                    c.styles && Array.isArray(c.styles.available) && c.styles.available.length > 0
            ).length;
            return {
                count: layers.length,
                withAlternates,
                hasApi: typeof G.setLayerStyle === "function",
            };
        });
        expect(probe.count).toBeGreaterThan(0);
        expect(probe.hasApi).toBeTruthy();
        expect(probe.withAlternates).toBeGreaterThan(0);

        // La bascule de style ne doit pas jeter sur une couche chargée.
        const switched = await page.evaluate(() => {
            const G = /** @type {any} */ (window).GeoLeaf.GeoJSON;
            const first = (G.getAllLayers() || [])[0];
            try {
                G.setLayerStyle(first.id, { fillColor: "#123456" });
                return true;
            } catch {
                return false;
            }
        });
        expect(switched).toBeTruthy();
    });

    // ── legend.* / styleRules[].legend → légende rendue dans le DOM ─────────────
    test("legend: des entrées de légende sont rendues dans le DOM", async ({ page }) => {
        await bootMap(page);
        // La légende est générée à partir du style actif (legend.label + styleRules[].legend).
        await expect(page.locator(".gl-legend__item").first()).toBeAttached({ timeout: 20000 });
        const count = await page.locator(".gl-legend__item").count();
        expect(count).toBeGreaterThan(0);
    });
});
