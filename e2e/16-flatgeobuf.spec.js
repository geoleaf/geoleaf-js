// @ts-check
// E2E: 16-flatgeobuf (@geoleaf-plugins/flatgeobuf) — deploy-core (port 8766), LAZY.
//
// Plugin-validation suite. ⚠️ This header said "EAGER … no `plugins.load`
// needed" until 2026-08-07: the plugin's <script> tag was removed
// (13.6 KB gz). TWO paths since: a profile layer declaring
// `"plugin": "flatgeobuf"` is served without any load, through the core's
// `ensurePluginLoaded` seam; the API called directly is loaded by hand.
//
// ⚠️ A SINGLE dataset since 2026-07-27: `tourism eco_regions.fgb`.
//
// This spec used to exercise TWO files — `eco_regions.fgb` for the full load,
// and `france-rail zones_desserte.fgb` (~5 KB) for bbox + Range + autoRefresh.
// The `france-rail` profile was among the 6 removed demos: the spec was
// looking for a file absent from the deploy. Everything is carried over to
// `eco_regions.fgb`, which is possible because the R-tree index and partial
// requests are properties of the FORMAT, not of that particular file.
//
// What the conversion costs, said plainly: the file is ~1 MB instead of
// ~5 KB, so the bbox/Range/autoRefresh tests transfer more — slower, not less
// probing. And the declarative-dispatch test loses the "config carrying a
// bbox" variant: `tourism`'s `eco_regions_fgb` layer declares none.
// `loadBbox` stays covered by its own tests, passing the bbox in memory.
//
// Coverage:
//   - load()/loadBbox()  → FeatureCollection (data-only, was already conformant)
//   - HTTP Range 206     → bbox mode issues Range requests (http-server replies 206)
//   - loadAsLayer/loadBboxAsLayer → render via adapter.addGeoJSONLayer  (rendering fix A)
//   - autoRefresh        → moveend re-fetches (adapter.updateLayerData)
//   - declarative `plugin: "flatgeobuf"` profile layer → core dispatch  (dispatch fix B)
//
// NOTE: deploy-core ships a PWA service worker → serviceWorkers:'block'. Run after
// `npm run build:deploy:all`.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

// Deployed .fgb files (root-relative; made absolute in-page via location.origin).
const ECO_PATH = "/profiles/tourism/layers/eco_regions_fgb/data/eco_regions.fgb";

// One bbox that CONTAINS features, and one containing none. The first takes
// up the bounds declared by `profiles/tourism/profile.json` (`map.bounds`,
// South America) — not an invented value: if the profile's bounds moved
// without this bbox following, the test would say "0 features" and blame the
// plugin.
const DATA_BBOX = { minX: -73.5, minY: -55, maxX: -53.5, maxY: -21.78 };
// North Atlantic: outside the profile's bounds, hence 0 features by construction.
const OCEAN_BBOX = { minX: -40, minY: 20, maxX: -39, maxY: 21 };

const SW_NOISE = /SWRegister|ServiceWorker|serviceworker/i;
const pluginErrors = (arr) => arr.filter((t) => !SW_NOISE.test(t));

/** Primes the profile selected at boot (read from sessionStorage by boot.ts). */
async function selectProfile(page, profileId) {
    await page.addInitScript((id) => {
        try {
            sessionStorage.setItem("gl-selected-profile", id);
        } catch (e) {
            console.warn("[e2e] sessionStorage unavailable:", e);
        }
    }, profileId);
}

/**
 * Navigates, waits for the map, LOADS the lazy FlatGeobuf plugin, and returns the
 * page-error, console-error and `.fgb` network-response collectors.
 */
async function boot(page) {
    const errors = [];
    const consoleErrors = [];
    const fgbResponses = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("response", (resp) => {
        if (resp.url().includes(".fgb"))
            fgbResponses.push({ url: resp.url(), status: resp.status() });
    });
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
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
    // `flatgeobuf` is no longer eager. ⚠️ TWO paths, not to be conflated: a
    // profile layer declaring `"plugin": "flatgeobuf"` is served WITHOUT this
    // load, through the core's `ensurePluginLoaded` seam (`globals.geojson.ts`)
    // — the product path, and the "declarative layer" test below exercises it
    // as is. This load only serves the tests calling `GeoLeaf.FlatGeobuf.*`
    // DIRECTLY, without a layer: they stand where an integrator driving the
    // API by hand stands.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("flatgeobuf"));
    return { errors, consoleErrors, fgbResponses };
}

// ── Boot & API surface ──────────────────────────────────────────────────────────

test("charge à la demande : GeoLeaf.FlatGeobuf présent, 5 fonctions, 0 erreur console", async ({
    page,
}) => {
    const { errors, consoleErrors } = await boot(page);
    const api = await page.evaluate(() => {
        const fgb = /** @type {any} */ (window).GeoLeaf.FlatGeobuf;
        return {
            present: typeof fgb === "object" && fgb !== null,
            methods: [
                "load",
                "loadBbox",
                "loadAsLayer",
                "loadBboxAsLayer",
                "loadLayerFromConfig",
            ].filter((m) => typeof fgb[m] === "function"),
        };
    });
    expect(api.present).toBe(true);
    expect(api.methods).toHaveLength(5);
    expect(errors).toEqual([]);
    expect(pluginErrors(consoleErrors)).toEqual([]);
});

// ── load() — full-file streaming through the real bundle ─────────────────────────

test("load() streams the full eco_regions.fgb to a FeatureCollection (HTTP 200)", async ({
    page,
}) => {
    const { errors, fgbResponses } = await boot(page);
    const res = await page.evaluate(async (path) => {
        const url = location.origin + path;
        const r = await /** @type {any} */ (window).GeoLeaf.FlatGeobuf.load(url);
        return { count: r.featureCount, type: r.data && r.data.type };
    }, ECO_PATH);
    console.log("LOAD", JSON.stringify(res));
    expect(res.type).toBe("FeatureCollection");
    expect(res.count).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    // Full-file load is a plain GET → 200 (not a Range request).
    expect(fgbResponses.some((r) => r.status === 200)).toBe(true);
});

// ── loadBbox() — spatial filtering via the R-tree index ──────────────────────────

test("loadBbox() filters spatially: france bbox > 0 features, ocean bbox = 0", async ({ page }) => {
    const { errors } = await boot(page);
    const res = await page.evaluate(
        async (args) => {
            const url = location.origin + args.path;
            const fgb = /** @type {any} */ (window).GeoLeaf.FlatGeobuf;
            const inFrance = await fgb.loadBbox(url, args.france);
            const inOcean = await fgb.loadBbox(url, args.ocean);
            return { france: inFrance.featureCount, ocean: inOcean.featureCount };
        },
        { path: ECO_PATH, france: DATA_BBOX, ocean: OCEAN_BBOX }
    );
    console.log("LOADBBOX", JSON.stringify(res));
    expect(res.france).toBeGreaterThan(0);
    expect(res.ocean).toBe(0);
    expect(errors).toEqual([]);
});

// ── HTTP Range 206 — proof the bbox mode does partial fetches ─────────────────────

test("loadBbox() triggers HTTP Range requests (206 Partial Content)", async ({ page }) => {
    const { fgbResponses } = await boot(page);
    await page.evaluate(
        async (args) => {
            const url = location.origin + args.path;
            await /** @type {any} */ (window).GeoLeaf.FlatGeobuf.loadBbox(url, args.france);
        },
        { path: ECO_PATH, france: DATA_BBOX }
    );
    await page.waitForTimeout(300);
    console.log("RANGE", JSON.stringify(fgbResponses));
    expect(fgbResponses.some((r) => r.status === 206)).toBe(true);
});

// ── loadAsLayer() — renders on the map via the adapter (rendering fix A) ──────────

test("loadAsLayer() renders a GeoJSON layer on the map (S10 correctif A)", async ({ page }) => {
    const { errors } = await boot(page);
    const warns = [];
    page.on("console", (msg) => {
        if (msg.type() === "warning" || msg.type() === "error") warns.push(msg.text());
    });
    const res = await page.evaluate(async (path) => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const beforeSources = Object.keys(map.getStyle().sources).length;
        const beforeLayers = map.getStyle().layers.length;
        let layerId;
        let err;
        try {
            layerId = await /** @type {any} */ (window).GeoLeaf.FlatGeobuf.loadAsLayer(
                location.origin + path,
                { layerId: "e2e-eco", layerName: "e2e eco-regions", geometry: "polygon" }
            );
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
    }, ECO_PATH);
    console.log("LOADASLAYER", JSON.stringify(res), "WARNS", JSON.stringify(warns));
    expect(res.err).toBeUndefined();
    expect(res.layerId).toBe("e2e-eco");
    expect(res.hasSource).toBe(true);
    expect(res.sourceDelta).toBe(1);
    expect(res.layerDelta).toBeGreaterThanOrEqual(1);
    expect(res.featureCount).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    // The dead-path guard must NOT fire.
    expect(warns.some((w) => /GeoJSON\] Module not initialized/.test(w))).toBe(false);
});

// ── loadBboxAsLayer() + autoRefresh — render + re-fetch on viewport change ─────────

test("loadBboxAsLayer() renders, and autoRefresh re-fetches on moveend", async ({ page }) => {
    const { errors, fgbResponses } = await boot(page);
    const rendered = await page.evaluate(
        async (args) => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const layerId = await /** @type {any} */ (window).GeoLeaf.FlatGeobuf.loadBboxAsLayer(
                location.origin + args.path,
                args.france,
                { layerId: "e2e-zones", autoRefresh: true, debounceMs: 50 }
            );
            await new Promise((r) => setTimeout(r, 300));
            const src = map.getSource("gl-src-" + layerId);
            return { layerId, hasSource: !!src };
        },
        { path: ECO_PATH, france: DATA_BBOX }
    );
    expect(rendered.layerId).toBe("e2e-zones");
    expect(rendered.hasSource).toBe(true);

    const before = fgbResponses.length;
    // Programmatic camera move fires `moveend` (unlike synthetic mouse drag).
    await page.evaluate(() => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        map.jumpTo({ center: [3.0, 46.5], zoom: 6 });
    });
    await page.waitForTimeout(800);
    console.log("AUTOREFRESH", "before", before, "after", fgbResponses.length);
    expect(fgbResponses.length).toBeGreaterThan(before);
    expect(errors).toEqual([]);
});

// ── Guards — invalid bbox / disallowed URL reject ─────────────────────────────────

test("rejects an invalid bbox and a disallowed URL", async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(
        async (args) => {
            const fgb = /** @type {any} */ (window).GeoLeaf.FlatGeobuf;
            const out = { bboxErr: null, urlErr: null };
            try {
                await fgb.loadBbox(location.origin + args.path, {
                    minX: 5,
                    minY: 5,
                    maxX: 1,
                    maxY: 1,
                });
            } catch (e) {
                out.bboxErr = String((e && e.message) || e);
            }
            try {
                await fgb.load("ftp://example.com/data.fgb");
            } catch (e) {
                out.urlErr = String((e && e.message) || e);
            }
            return out;
        },
        { path: ECO_PATH }
    );
    expect(res.bboxErr).toMatch(/Invalid bbox/);
    expect(res.urlErr).toMatch(/Invalid or disallowed URL/);
});

// ── Declarative dispatch — profile `plugin: "flatgeobuf"` layer (dispatch fix B) ──
//
// Proves the dispatch fix end-to-end on a REAL bundled profile: the core registers the
// plugin's layer loader (GeoLeaf.plugins.registerLayerLoader), and dispatching the
// `tourism` `eco_regions_fgb` declarative config (plugin:"flatgeobuf") through it renders
// the layer from the indexed .fgb — config → core dispatch → URL resolution → rendered source.
//
// ⚠️ Carried over from `france-rail zones_desserte` to `tourism eco_regions_fgb`
// on 2026-07-27 (with the demo-profile purge). The target layer declares
// **no** `bbox`, so this test no longer covers the "declarative config
// CARRYING a bbox" variant — `loadBbox` stays covered by its dedicated tests,
// which pass the bbox in memory. The carry-over's only coverage loss.
//
// NOTE (finding): the bundled-profile theme orchestration does not yet auto-trigger
// plugin-typed layers at boot (it spans the profile/theme/visibility loaders, each
// assuming a standard GeoJSON data URL). So this test invokes the registered dispatch
// loader directly — the exact function the core calls once a plugin layer reaches
// `_loadSingleLayer`. Auto-load wiring in the theme orchestration is a documented follow-up.

test("core's registered dispatch renders a declarative `plugin: flatgeobuf` config (tourism)", async ({
    page,
}) => {
    await selectProfile(page, "tourism");
    const { errors, consoleErrors, fgbResponses } = await boot(page);
    const res = await page.evaluate(async () => {
        const gl = /** @type {any} */ (window).GeoLeaf;
        const map = gl.Core.getMap().getNativeMap();
        // Pull the declarative config straight from the loaded profile.
        const prof = gl.Config.getActiveProfile();
        const lists = [
            prof && prof.layers,
            prof && prof.geojsonLayers,
            prof && prof.geojson && prof.geojson.layers,
            gl.Config.Profile && gl.Config.Profile.getActiveProfileLayersConfig
                ? gl.Config.Profile.getActiveProfileLayersConfig()
                : null,
        ];
        let cfg = null;
        for (const arr of lists) {
            if (Array.isArray(arr)) {
                const z = arr.find((l) => l && l.id === "eco_regions_fgb" && l.plugin);
                if (z) {
                    cfg = z;
                    break;
                }
            }
        }
        if (!cfg) return { error: "eco_regions_fgb config with plugin not found in profile" };
        const loader = gl.plugins.getLayerLoader("flatgeobuf");
        if (typeof loader !== "function") return { error: "no registered flatgeobuf layer loader" };
        const beforeSources = Object.keys(map.getStyle().sources).length;
        const id = await loader({ ...cfg, _profileId: "tourism" });
        // The loader resolves as soon as it has SCHEDULED the source; the .fgb is streamed
        // over HTTP Range requests, so `addSource` lands a variable number of ticks later.
        // A fixed sleep here made this test flake at ~50% (measured: 2 green / 2 red over 4
        // isolated runs, zero code change in between). Poll for the condition instead — the
        // assertion below is unchanged, only the deadline stops being arbitrary.
        const _deadline = Date.now() + 10000;
        while (!map.getSource("gl-src-" + id) && Date.now() < _deadline) {
            await new Promise((r) => setTimeout(r, 50));
        }
        const src = map.getSource("gl-src-" + id);
        const ser = src && src.serialize ? src.serialize() : null;
        const feats = ser && ser.data && ser.data.features ? ser.data.features.length : null;
        return {
            id,
            registered: true,
            hasPlugin: !!cfg.plugin,
            hasBbox: !!(cfg.data && cfg.data.bbox),
            hasSource: !!src,
            featureCount: feats,
            sourceDelta: Object.keys(map.getStyle().sources).length - beforeSources,
        };
    });
    console.log("DECLARATIVE", JSON.stringify(res));
    expect(res.error).toBeUndefined();
    expect(res.hasPlugin).toBe(true);
    // ⚠️ `false`, and it is ASSERTED, not worked around (2026-07-27). This
    // line used to require `true`: `france-rail zones_desserte`'s declarative
    // config carried a `bbox`. `tourism eco_regions_fgb`'s declares none.
    // Asserting `false` states the target layer's REAL shape — removing the
    // assertion would have left the test mute on the point, and setting it to
    // `true` would require changing a SHIPPED profile to satisfy a test.
    expect(res.hasBbox).toBe(false);
    expect(res.id).toBe("eco_regions_fgb");
    expect(res.hasSource).toBe(true);
    expect(res.sourceDelta).toBe(1);
    expect(res.featureCount).toBeGreaterThan(0);
    // ⚠️ 200, not 206 — the DIRECT CONSEQUENCE of the carry-over (2026-07-27).
    // This line used to require a 206: `france-rail`'s declarative config
    // carried a `bbox`, so the load went through partial requests. `tourism`'s
    // declares none → full load, status 200. Softening to "200 or 206" would
    // have made the assertion true in both cases, hence unable to tell one
    // mode from the other: the target layer's REAL mode is asserted. The 206
    // stays covered by the "loadBbox() triggers HTTP Range requests" test
    // above, which passes its bbox in memory.
    expect(fgbResponses.some((r) => r.status === 200)).toBe(true);
    expect(errors).toEqual([]);
    // No flatgeobuf-specific console error. (The note about `france-rail`'s
    // boot 404 fell with that profile: `tourism` is the one the other tests of
    // this suite already require with no console error at all.)
    const fgbErrors = pluginErrors(consoleErrors).filter((t) => /flatgeobuf|fgb/i.test(t));
    expect(fgbErrors).toEqual([]);
});
