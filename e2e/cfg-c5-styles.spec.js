// @ts-check
// Config-contract Phase C / C5 — targeted E2E (real map/DOM state) for the B6
// config family (styles/{style}.json), on deploy-core (tourism profile).
//
// The EXHAUSTIVE per-value coverage lives in Vitest (__tests__/config/s14-*):
// flat converter → paint/layout (maplibre-style-converter), styleRules per
// operator (conditionToExpression + GeoJSONStyleResolver),
// scaleConfig/labelScale (scale-utils), legend (LegendGenerator), @anomaly
// locks (style.schema.json). Here we confirm, in a real browser (SwiftShader
// software WebGL), that the styles/{style}.json → render chain holds end to
// end: colour resolved into the native MapLibre paint, conditional rule
// applied (data-driven expression + runtime engine), style switch
// (styles.available + setLayerStyle), legend rendered in the DOM. No pixel
// assertion.
//
// The `cfg-` prefix marks the config-contract spec family.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/**
 * Boot the map, wait for a native maplibregl.Map, then wait for PHASE 1 of smart
 * loading (every default-theme layer) — not merely for the first one.
 *
 * `getAllLayers().length > 0` is TOO WEAK a wait and it is what reddened the
 * "static colours" test: the loader loads the default theme in parallel
 * batches of 3 (geojson/loader/profile.ts, `_loadLayersByBatch`), so the
 * registry becomes non-empty as soon as the first layer resolves — i.e. the
 * smallest, `villes_principales` (23 KB, vs 838 KB and 277 KB for the batch's
 * other two). Yet that is precisely a POINT layer bound to the taxonomy
 * (`modules.taxonomy.layers.villes_principales`), so its `circle-color` is
 * REPLACED by the taxonomy's `match` expression
 * (adapters/maplibre/maplibre-taxonomy-paint.ts → marker-paint.ts). Read
 * alone, the map thus exposes ONLY expressions: the first assertion
 * (`length > 0`) passed, the second (at least one static colour) fell — the
 * neighbouring layers' flat style was not there yet.
 *
 * `geoleaf:layers:initial-loaded` (profile.ts) is emitted once, at the
 * end of phase 1. The listener is set by `addInitScript`, hence before any
 * page script: the event cannot be missed.
 */
// Contract: style live + phase-1 + at least one GeoJSON layer — style assertions read them.
async function bootMapUntilStyledLayers(page) {
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
    // ⚠️ `waitForFunction(fn, arg, options)`: the options are the 3rd
    // argument. Passed 2nd, they leave as `arg` and the wait falls back to
    // `actionTimeout` — whose value is read in `playwright.config.js`, never
    // here (it moved on 2026-08-01).
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
    // ── flat style → native MapLibre paint (colour rendering) ────────────────────
    test("style: les couleurs du style atteignent le paint natif des couches", async ({ page }) => {
        await bootMapUntilStyledLayers(page);
        const colors = await page.evaluate(collectDataLayerColors);
        expect(colors.length).toBeGreaterThan(0);
        // At least one static colour resolved (hex/CSS string) → flat style
        // applied. The default theme (environnement) provides several once
        // phase 1 is done: routes_principales line-color "#ffffff" (+ casing
        // "#000000"), provinces line-color "#000000", aires_protegees
        // line-color "#232323", zones_de_conservation_wdpa fill-color
        // "transparent" (hatch pattern_only).
        expect(colors.some((c) => typeof c === "string" && c.length > 0)).toBeTruthy();
    });

    // ── styleRules → data-driven paint, colours really shipped ───────────────────
    //
    // ⚠️ This version no longer probes `GeoLeaf._StyleRules`: that global was
    // deliberately removed (kernel/geojson/style-resolver.ts) — it had
    // no production reader, only this spec and some tests read it. The path
    // REALLY shipped for styleRules is `styleRulesToPaint` →
    // adapters/maplibre/maplibre-style-applier.ts → native MapLibre
    // expression (case/match/step). Per-operator semantics stay covered under
    // Node by __tests__/config/s14-style-rules-operators.test.js; here only
    // the last link is confirmed: loaded config → native paint.
    test("styleRules: couleurs du profil retrouvées dans le paint data-driven natif", async ({
        page,
    }) => {
        await bootMapUntilStyledLayers(page);

        // Discovers a REALLY loaded layer carrying styleRules with ≥2 distinct
        // colours (never a hard-coded layer id — the default theme can
        // change) and verifies each colour declared in its
        // style/{style}.json is found in the expression sent to the native
        // `gl-{layerId}-{type}` sub-layer (maplibre-layer-registry.ts
        // convention).
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
                // It takes ≥2 branches to prove CONDITIONAL rendering, not a constant.
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
                    if (!Array.isArray(paint)) continue; // not a data-driven expression

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
        // Each colour the profile's styleRules declare must be found in the
        // native expression — not merely "at least one expression exists
        // somewhere".
        expect(probe.matchedColors).toEqual(probe.declaredColors);
    });

    // ── styles.available → configurable alternates + switch via setLayerStyle ────
    test("styles.available: alternates exposés + API setLayerStyle câblée", async ({ page }) => {
        await bootMapUntilStyledLayers(page);
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

        // The style switch must not throw on a loaded layer.
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

    // ── legend.* / styleRules[].legend → legend rendered in the DOM ──────────────
    test("legend: des entrées de légende sont rendues dans le DOM", async ({ page }) => {
        await bootMapUntilStyledLayers(page);
        // The legend is generated from the active style (legend.label + styleRules[].legend).
        await expect(page.locator(".gl-legend__item").first()).toBeAttached({ timeout: 20000 });
        const count = await page.locator(".gl-legend__item").count();
        expect(count).toBeGreaterThan(0);
    });
});
