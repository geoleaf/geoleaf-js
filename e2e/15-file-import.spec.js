// @ts-check
// E2E: 15-file-import (@geoleaf-plugins/file-import) — deploy-core (port 8766), LAZY.
//
// Plugin-validation suite. ⚠️ This header said "EAGER … no `plugins.load`
// needed" until 2026-08-07: the plugin's <script> tag left index.html
// (17.9 KB gz). Pure API, no listener and no slot — the consumer loads it,
// as this suite does.
//
// The plugin is API-only (no UI, no toolbar, no config). The host app wires a file
// input → GeoLeaf.FileImport. This spec reproduces that: it injects a hidden
// <input type=file>, drives it with real on-disk fixtures via setInputFiles, and
// exercises the two public journeys:
//   - convert(file)         → {data: FeatureCollection, warnings}  (CDC Parcours 2)
//   - importAsLayer(file)   → GeoLeaf.GeoJSON.addData → map layer   (CDC Parcours 1)
//
// The 6 fixtures (e2e/fixtures/sample.*) exercise every converter through the REAL
// deployed bundle (DOMParser GPX, @tmcw/togeojson KML, fflate KMZ, papaparse
// CSV/TSV, topojson-client). sample.kmz is a binary ZIP built by fixtures/_gen-kmz.cjs.
//
// NOTE: deploy-core ships a PWA service worker → serviceWorkers:'block'. Run after
// `npm run build:deploy:all`.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const INPUT_ID = "__e2e_fi";
const FIX = (name) => path.join(__dirname, "fixtures", name);

// deploy-core registers a PWA service worker; under serviceWorkers:'block' that
// registration fails with a benign console error unrelated to the plugin. Filter
// it out so the assertion still catches any *plugin* console error.
const SW_NOISE = /SWRegister|ServiceWorker|serviceworker/i;
const pluginErrors = (arr) => arr.filter((t) => !SW_NOISE.test(t));

/**
 * Navigates, waits for the state the journey ACTUALLY uses, injects the integrator file
 * input, LOADS the lazy FileImport plugin, and returns the page-error + console-error
 * collectors.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ waitForMap?: boolean }} [opts] `waitForMap` is only true for the
 *   ONE journey that touches the map (`importAsLayer`). Everywhere else,
 *   waiting for it is not neutral — see the block below: it is what made the
 *   `convert()` tests unstable.
 */
async function boot(page, { waitForMap = false } = {}) {
    const errors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/");
    // Page guard (the div is in the markup) — not a state wait: it fails fast
    // if the served document is not the application, and says nothing about
    // what booted.
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

    // ⚠️ WAIT FOR THE STATE ACTUALLY USED — THE LAZY RESOLVER — AND ABOVE ALL
    // NOT THE MAP.
    //
    // What was awaited here until 2026-08-08: `native.loaded()`, then
    // `#gl-loader` hidden. Both are PROXIES, and the first lies about its
    // name. Measured on this deploy (21 loads): `loaded()` returns `true` from
    // ~130-230 ms on a style carrying 0 to 3 layers OUT OF 18 and ZERO `error`
    // listener — i.e. on an EMPTY map, before even `geoleaf:app:ready`
    // (~250-440 ms). `SourceCache.loaded()` is true when no tile is requested
    // yet: "loaded" there means "nothing to load". The second ends in
    // `.catch(() => {})`: it guarantees nothing at all, it WAITS — ~1.1 s of
    // the ~1.3 s this boot cost, by accident.
    //
    // Yet `convert()` does NOT touch the map: it is a pure API (see this
    // file's header). The state it depends on is the `file-import` resolver,
    // registered by `init.js`'s IIFE BEFORE `GeoLeaf.boot()` — hence before
    // the map exists. Waiting for the map was waiting later and worse.
    //
    // 🛑 AND IT IS NOT JUST LOST TIME — it is what reddened this test.
    // `boot({ config })` applies the basemap LAST (`setBaseLayer:
    // terrain-terrarium`, then `Terrain 3D activated`, the boot's last lines).
    // The `tourism` profile pulls its tiles from THIRD PARTIES:
    // `*.tile.opentopomap.org`, `s3.amazonaws.com` (terrarium DEM),
    // `earthquake.usgs.gov`. First third-party shot measured at ~390-660 ms,
    // then a burst of ~30 requests. This file's three `toEqual([])` thus
    // concluded over a window CONTAINING third-party network — and Chromium
    // logs its network failures as `console.error`
    // ("Failed to load resource: net::ERR_…"), which no application listener
    // can intercept. Measured: 2 loads out of 25 produced some, with no plugin
    // defect whatsoever. Over a full suite these hosts take ~213 loads — the
    // shared state Playwright's per-context isolation cannot see, because it
    // is OUTSIDE the browser, and why this test never fails in isolation.
    //
    // Measure of the gesture (6 runs per arm, same host, same target): the
    // window drops from ~1,300 ms to ~230 ms, and from 1-10 third-party
    // requests emitted before the conclusion to 0-1. This is not "a shorter
    // delay" — it is an ORDER: the resolver is set by `init.js`'s IIFE, which
    // runs before `GeoLeaf.boot()`, hence before a basemap can exist. Do NOT
    // put the map wait back here "to be safe": it is the very thing being
    // removed.
    await page.waitForFunction(
        () => {
            const p = /** @type {any} */ (window).GeoLeaf?.plugins;
            return (
                typeof p?.load === "function" &&
                typeof p?.getAvailableModules === "function" &&
                p.getAvailableModules().includes("file-import")
            );
        },
        null,
        { timeout: 20000 }
    );

    if (waitForMap) {
        // Reserved for the `importAsLayer` journey, which READS the map
        // (`getStyle()`, source delta). Waits and order unchanged for it —
        // only their home moves.
        await page.waitForFunction(
            () => {
                const m = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
                return !!m && typeof m.loaded === "function" && m.loaded();
            },
            null,
            { timeout: 15000 }
        );
        await page
            .locator("#gl-loader")
            .waitFor({ state: "hidden", timeout: 10000 })
            .catch(() => {});
    }
    // The plugin is API-only — the host app provides the file input. Inject one.
    await page.evaluate((id) => {
        if (document.getElementById(id)) return;
        const inp = document.createElement("input");
        inp.type = "file";
        inp.id = id;
        inp.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(inp);
    }, INPUT_ID);
    // `file-import` is no longer eager (17.9 KB gz removed from the first
    // load). Pure API, no listener and no slot: the consumer loads it.
    //
    // This `await` suffices, and it calls for no extra wait on
    // `GeoLeaf.FileImport`: `entry.ts` mounts the namespace AT MODULE
    // EVALUATION, so the `import()` that `PluginRegistry.load()` awaits only
    // resolves AFTER the mount. One more wait here would be decorative — and
    // this file wants none.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("file-import"));
    return { errors, consoleErrors };
}

/** Sets the fixture on the injected input and runs convert() with the real File. */
async function convertFixture(page, fileName) {
    await page.setInputFiles("#" + INPUT_ID, FIX(fileName));
    return page.evaluate(async (id) => {
        const f = /** @type {any} */ (document.getElementById(id)).files[0];
        const r = await /** @type {any} */ (window).GeoLeaf.FileImport.convert(f);
        const feats = (r && r.data && r.data.features) || [];
        return {
            name: f.name,
            count: feats.length,
            warnings: r.warnings || [],
            types: [...new Set(feats.map((x) => x.geometry && x.geometry.type))],
        };
    }, INPUT_ID);
}

// ── Boot & API surface ──────────────────────────────────────────────────────────

test("charge à la demande : GeoLeaf.FileImport présent, 6 formats, 0 erreur console", async ({
    page,
}) => {
    const { errors, consoleErrors } = await boot(page);
    const api = await page.evaluate(() => {
        const fi = /** @type {any} */ (window).GeoLeaf.FileImport;
        return {
            present: typeof fi === "object" && fi !== null,
            methods: [
                "convert",
                "importAsLayer",
                "getSupportedFormats",
                "registerConverter",
            ].filter((m) => typeof fi[m] === "function"),
            formats: fi.getSupportedFormats(),
        };
    });
    expect(api.present).toBe(true);
    expect(api.methods).toHaveLength(4);
    expect(api.formats).toEqual(
        expect.arrayContaining([".gpx", ".kml", ".kmz", ".csv", ".tsv", ".topojson"])
    );
    expect(errors).toEqual([]);
    expect(pluginErrors(consoleErrors)).toEqual([]);
});

// ── convert() per format — real conversion through the deployed bundle ───────────

const CASES = [
    { file: "sample.gpx", minCount: 2, types: ["Point", "LineString"] },
    { file: "sample.kml", minCount: 2, types: ["Point", "LineString"] },
    { file: "sample.csv", minCount: 2, types: ["Point"] },
    { file: "sample.tsv", minCount: 2, types: ["Point"] },
    { file: "sample.topojson", minCount: 2, types: ["Point"] },
    { file: "sample.kmz", minCount: 2, types: ["Point", "LineString"] },
];

for (const c of CASES) {
    test(`convert(${c.file}) → GeoJSON features through the real bundle`, async ({ page }) => {
        const { errors, consoleErrors } = await boot(page);
        const res = await convertFixture(page, c.file);
        console.log("CONVERT", JSON.stringify(res));
        expect(res.count).toBeGreaterThanOrEqual(c.minCount);
        for (const t of c.types) expect(res.types).toContain(t);
        expect(res.warnings).toEqual([]);
        expect(errors).toEqual([]);
        expect(pluginErrors(consoleErrors)).toEqual([]);
    });
}

// ── importAsLayer() — CDC Parcours 1 (map rendering), the rendering fix ──────────
//
// The fix: importAsLayer() renders through the core map adapter
// (GeoLeaf.Core.getMap().addGeoJSONLayer) — the working MapLibre path the core layer
// loader uses — instead of the dead GeoLeaf.GeoJSON.addData (a no-op:
// `state.geoJsonLayer` is never instantiated). It now returns a layer id, creates a
// `gl-src-<id>` source + sub-layers on the native map, and no longer logs "Module
// not initialized". (The layer renders but is NOT registered in the layer-manager
// panel — that path is core-internal.) See FI-11 in
// docs/specs/plugins/CDC_file-import.md.

test("importAsLayer(sample.kml): renders a GeoJSON layer on the map (S9 correctif)", async ({
    page,
}) => {
    // `waitForMap: true` — the file's ONLY journey that reads the map (source
    // delta, `getStyle()`), hence the only one that must wait for it. The
    // waits are those `boot()` imposed on everyone before 2026-08-08; they did
    // not change, they only joined the test that needs them.
    const { errors } = await boot(page, { waitForMap: true });
    const warns = [];
    page.on("console", (msg) => {
        if (msg.type() === "warning" || msg.type() === "error") warns.push(msg.text());
    });
    await page.setInputFiles("#" + INPUT_ID, FIX("sample.kml"));
    const res = await page.evaluate(async (id) => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const beforeSources = Object.keys(map.getStyle().sources).length;
        const beforeLayers = map.getStyle().layers.length;
        const f = /** @type {any} */ (document.getElementById(id)).files[0];
        let layerId;
        let err;
        try {
            layerId = await /** @type {any} */ (window).GeoLeaf.FileImport.importAsLayer(f, {
                layerName: "e2e-kml",
            });
        } catch (e) {
            err = String((e && e.message) || e);
        }
        await new Promise((r) => setTimeout(r, 300));
        const src = layerId ? map.getSource("gl-src-" + layerId) : null;
        const serialized = src && src.serialize ? src.serialize() : null;
        const data = serialized && serialized.data;
        return {
            layerId,
            err,
            sourceDelta: Object.keys(map.getStyle().sources).length - beforeSources,
            layerDelta: map.getStyle().layers.length - beforeLayers,
            hasSource: !!src,
            featureCount: data && data.features ? data.features.length : null,
        };
    }, INPUT_ID);
    console.log("IMPORTASLAYER", JSON.stringify(res), "WARNS", JSON.stringify(warns));
    expect(res.err).toBeUndefined();
    expect(errors).toEqual([]);
    // The fix: a real GeoJSON layer is rendered on the map.
    expect(typeof res.layerId).toBe("string");
    expect(res.layerId.length).toBeGreaterThan(0);
    expect(res.hasSource).toBe(true);
    expect(res.sourceDelta).toBe(1);
    expect(res.layerDelta).toBeGreaterThanOrEqual(1);
    expect(res.featureCount).toBe(2);
    // The dead-path guard must NOT fire anymore.
    expect(warns.some((w) => /GeoJSON\] Module not initialized/.test(w))).toBe(false);
});
