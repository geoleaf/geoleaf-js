// @ts-check
// Config-contract Phase C / C4 — targeted E2E (real map/DOM state) for the B5
// config family (layers.json + {id}_config.json), on deploy-core (tourism
// profile).
//
// The EXHAUSTIVE per-value coverage lives in Vitest (__tests__/config/s13-*):
// index/templates (expandLayerTemplates), popup/tooltip/sidepanel fields
// (LoaderConfigHelpers), clustering (getClusteringStrategy), data.vectorTiles
// + scheme (VectorTiles), styles/legends (LayerConfigManager), @anomaly
// locks. Here we confirm, in a real browser (SwiftShader software WebGL),
// that the layers.json + {id}_config.json → effect chain holds end to end for
// the deployed profile, through STABLE anchors (runtime layer registry,
// clustered native source, sidepanel API, DOM classes) — no pixel assertion.
//
// Scope decision: deterministic LIVE = runtime APIs + map/DOM state (no
// non-deterministic canvas hover/click in headless).
//
// The `cfg-` prefix marks the config-contract spec family.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/**
 * Boot the map, wait for a native maplibregl.Map, then wait for PHASE 1 of smart
 * loading (all default-theme layers) to be complete.
 *
 * Waiting for `getAllLayers().length > 0` does not suffice: the loader loads
 * the default theme in parallel batches of 3 (geojson/loader/profile.ts
 * `_loadLayersByBatch`, batchSize 3 / 200 ms), so the registry becomes
 * non-empty as soon as the FIRST layer resolves — the batch's smallest,
 * `villes_principales` (23 KB vs 838 KB for
 * `aires_protegees_nationales_sib`). A read at that instant sees one layer,
 * and per-layer assertions become a lottery.
 *
 * `geoleaf:layers:initial-loaded` (profile.ts) is emitted exactly once,
 * at the end of phase 1. The listener is set via `addInitScript` — hence
 * BEFORE any page script — so missing the event is impossible.
 */
// Contract: style live PLUS __glPhase1 — layer assertions need phase-1 layers landed.
async function bootMapUntilLayersPhase(page) {
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
}

test.describe("cfg-c4 — layers + {id}_config (état map/DOM réel)", () => {
    // ── layers.json → layers really loaded into the runtime registry ─────────────
    test("layers.json: les couches du profil sont chargées (registre runtime)", async ({
        page,
    }) => {
        await bootMapUntilLayersPhase(page);
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

    // ── {id}_config.json → interaction blocks wired into the live layers ─────────
    test("{id}_config.json: popup/tooltip/sidepanel atteignent le registre runtime", async ({
        page,
    }) => {
        await bootMapUntilLayersPhase(page);
        await page.waitForFunction(
            () => /** @type {any} */ (window.GeoLeaf.GeoJSON?.getAllLayers?.() || []).length > 0,
            undefined,
            { timeout: 20000 }
        );
        // Smart loading loads the default theme's layers first; the runtime
        // registry (getLayerData(id).config) of every LOADED layer is
        // inspected, proving the interaction blocks of {id}_config.json reach
        // it — without depending on one specific deferred layer.
        //
        // CANONICAL shape of the attribute declaration: the ROOT `attributes`
        // block, a single field list where each field names its surfaces.
        // Exactly what the runtime reads — `feature-info/convert.ts`
        // (`resolveSurfaceFields`) then `attributes-binding.ts`
        // (`fieldsForSurface`).
        //
        // ⚠️ This block used to read `capabilities["feature-info"]` until
        // 2026-08-02, with `tooltip` / `popup` / `sidepanel` as three parallel
        // lists. That old block is removed from all 48 configs AND from the
        // schema: the assertion is RE-POINTED at the successor, not relaxed.
        // What it guards is unchanged — that a declaration written in an
        // `{id}_config.json` does reach the runtime registry, and that the
        // three surfaces are wired there.
        const configs = await page.evaluate(() => {
            const G = /** @type {any} */ (window).GeoLeaf.GeoJSON;
            return (G.getAllLayers() || []).map((l) => G.getLayerData(l.id)?.config || {});
        });
        expect(configs.length).toBeGreaterThan(0);
        const blocks = configs
            .map((c) => c.attributes)
            .filter((a) => a && Array.isArray(a.fields) && a.fields.length > 0);
        // ≥1 loaded layer does carry an `attributes` block from {id}_config.json
        expect(blocks.length).toBeGreaterThan(0);

        /** The surfaces actually declared, all layers taken together. */
        const surfaces = new Set(
            blocks.flatMap((a) => a.fields.flatMap((f) => f.display?.surfaces || []))
        );
        expect(surfaces.has("popup")).toBeTruthy();
        expect(surfaces.has("tooltip")).toBeTruthy();
        expect(surfaces.has("sidepanel")).toBeTruthy();

        // ⚠️ And the type pair arrives INTACT at the runtime: it is what the
        // whitelist checks at build, so losing it on the way would render the
        // guard decorative.
        const withPair = blocks
            .flatMap((a) => a.fields)
            .filter((f) => typeof f.primitive === "string" && typeof f.widget === "string");
        expect(withPair.length).toBeGreaterThan(0);
    });

    // ── clustering.enabled → clustered native source + dissolve (clusterMaxZoom) ──
    test("clustering: une source GeoJSON native est clusterisée (cluster + clusterMaxZoom)", async ({
        page,
    }) => {
        await bootMapUntilLayersPhase(page);
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
        // disableClusteringAtZoom → MapLibre clusterMaxZoom (dissolve threshold).
        expect(clustered.some((z) => typeof z === "number")).toBeTruthy();
    });

    // ── capabilities.feature-info.sidepanel → panel opening via the runtime API ────
    //
    // `GeoLeaf.POI.showPoiDetails` no longer exists: the `GeoLeaf.POI`
    // namespace was DISSOLVED (commit 02c6a8d0, 0 `.POI =` assignments in the
    // repo). The replacement is
    // `GeoLeaf.FeatureInfo.openSidePanel(detail, layout)` — a core capability,
    // not a plugin (capabilities/feature-info/public-api.ts). The payload
    // changes shape with it: `GeoLeafFeatureClickDetail` ({layerId, featureId,
    // properties, geometry, lngLat, point}, types.ts), no longer the old
    // flat POI.
    //
    // ⚠️ The `.gl-poi-sidepanel` container is created LAZILY
    // (surfaces/sidepanel.ts, `ensureContainer`): it is absent from the DOM
    // while no opening has happened — the `toBeAttached` after the call is
    // thus a proof, not a tautology.
    test("sidepanel: GeoLeaf.FeatureInfo.openSidePanel ouvre le panneau latéral", async ({
        page,
    }) => {
        await bootMapUntilLayersPhase(page);
        const hasApi = await page.evaluate(
            () =>
                typeof (/** @type {any} */ (window).GeoLeaf.FeatureInfo?.openSidePanel) ===
                "function"
        );
        expect(hasApi).toBeTruthy();

        // The container does not exist before the first opening — proven here.
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
