// @ts-check
// E2E Performance Baseline
// Measures init time, GeoJSON render, FPS, and heap memory under MapLibre GL JS.
// Results populate perf-baseline.json — the post-migration performance contract.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";
import { useHardwareGl } from "./helpers/launch-options.js";
import { injectWebVitals, readWebVitals } from "./helpers/web-vitals.js";
import { installFeatureFactory, makeFeatureCollection } from "./helpers/feature-factory.js";
import {
    baselineIsCaptured,
    geojsonCeilingMs,
    heapDeltaBandMb,
    heapRetentionBandMb,
} from "./helpers/perf-gate.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERF_BASELINE_PATH = path.join(__dirname, "..", "perf-baseline.json");
const MAP_SELECTOR = "#geoleaf-map";
const MAP_TIMEOUT = 20_000;

// Runtime regression gate. ON under software GL (the CI/WSL default),
// where measurements are comparable to the committed contract; OFF under E2E_HW_GL=1,
// where the host's real GL makes absolute values non-comparable. See
// helpers/perf-gate.js for the GL-independence rationale.
const gating = !useHardwareGl;

// T6.4 — two orthogonal facts, two switches. Until now `E2E_HW_GL` carried BOTH:
// which GL to use (measurement fidelity) AND whether this run may rewrite a
// git-tracked file (repo mutation). Consequence: on a GPU host a plain
// `npm run test:e2e` silently dirtied perf-baseline.json — incident b3d85253,
// "fix BOM perf-baseline".
//
//   E2E_HW_GL=1           → use the host's real GL.        Measurement fidelity.
//   PERF_BASELINE_WRITE=1 → this run may rewrite the file. Repo mutation.
//
// Capturing under forced software GL would commit meaningless numbers. That case was
// previously a silent no-op; a silent no-op on an EXPLICIT operator intent is the
// defect family this sprint closes, so it is a hard failure at module load instead —
// before ten page loads, not after.
const captureBaseline = process.env.PERF_BASELINE_WRITE === "1";

if (captureBaseline && !useHardwareGl) {
    throw new Error(
        "[perf] PERF_BASELINE_WRITE=1 exige E2E_HW_GL=1 — des mesures sous GL logiciel ne sont " +
            "pas un contrat valide. Relancer avec : npm run perf:capture"
    );
}

/** Wait for the GeoLeaf map to be visible and fully initialized. */
// Local on purpose — the delta vs `helpers/boot.js#bootMap`, named: this one accepts a
// map whose style has not resolved yet (native !== null), because the perf baseline
// TIMES the boot — waiting for a live style inside the helper would fold part of the
// measured interval into the wait and shift every number this spec records.
async function waitForMap(page) {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator(MAP_SELECTOR).waitFor({ state: "visible", timeout: MAP_TIMEOUT });
    // Wait for the native MapLibre map to be ready via the adapter
    await page.waitForFunction(
        () => {
            try {
                const adapter =
                    window.GeoLeaf && window.GeoLeaf.Core && window.GeoLeaf.Core.getMap();
                return adapter && adapter.getNativeMap && adapter.getNativeMap() !== null;
            } catch {
                return false;
            }
        },
        null,
        { timeout: MAP_TIMEOUT }
    );
}

/**
 * Read current perf-baseline.json. Guarantees runtime.{initTime,geojsonRender,
 * fps,memory} exist as objects even when the file is present but partial — a
 * committed baseline may carry initTime/memory but not geojsonRender/fps, and
 * the per-test writers index those sub-objects directly.
 */
function readBaseline() {
    const ensure = (b) => {
        b.runtime = b.runtime || {};
        for (const k of ["initTime", "geojsonRender", "fps", "memory", "webVitals"]) {
            b.runtime[k] = b.runtime[k] || {};
        }
        return b;
    };
    if (!fs.existsSync(PERF_BASELINE_PATH)) return ensure({ runtime: {} });
    return ensure(JSON.parse(fs.readFileSync(PERF_BASELINE_PATH, "utf-8")));
}

/**
 * Write updated perf-baseline.json — ONLY when the operator asked for it
 * (PERF_BASELINE_WRITE=1, which implies E2E_HW_GL=1, checked at module load).
 *
 * T6.4 — every other run now leaves the committed baseline byte-identical, including
 * a plain `npm run test:e2e` on a GPU host. Before, `E2E_HW_GL=1` alone was enough to
 * rewrite it: the flag that says "use the real GPU" also said "you may commit over the
 * contract". A test must not regenerate its own reference as a side effect — same
 * family as the benchmark gate removed at T6.3, a device that makes itself true.
 */
function writeBaseline(data) {
    if (!captureBaseline) {
        console.info(
            "[perf] run en lecture seule — perf-baseline.json NON modifié (`npm run perf:capture` pour capturer)"
        );
        return;
    }
    fs.writeFileSync(PERF_BASELINE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ─── 6.2.1 — Init time measurement ─────────────────────────────────────────

// The synthetic-feature generator is mounted on EVERY page of this file, before any
// navigation — `addInitScript` applies to the next `goto`, and `waitForMap` is the goto.
// One hook rather than a call per block: five blocks build features, and five call sites
// is exactly how the file ended up with five divergent inline loops in the first place.
test.beforeEach(async ({ page }) => {
    await installFeatureFactory(page);
});

test.describe("6.2.1 — Init time", () => {
    test.use({ baseURL: baseURL("core") });

    test("GeoLeaf.init() completes in <500ms (10 runs)", async ({ page }) => {
        test.setTimeout(120_000); // 10 full page loads can take a while
        const times = [];
        const RUNS = 10;

        for (let i = 0; i < RUNS; i++) {
            await page.goto("/", { waitUntil: "networkidle" });
            await page.locator(MAP_SELECTOR).waitFor({ state: "visible", timeout: MAP_TIMEOUT });
            // Wait for the startup-total measure to be recorded by init.ts
            await page.waitForFunction(
                () => performance.getEntriesByName("geoleaf:startup-total", "measure").length > 0,
                null,
                { timeout: MAP_TIMEOUT }
            );

            const duration = await page.evaluate(() => {
                const entries = performance.getEntriesByName("geoleaf:startup-total", "measure");
                return entries.length > 0 ? entries.at(-1).duration : null;
            });

            if (duration !== null) {
                times.push(duration);
            }
        }

        expect(times.length).toBeGreaterThan(0);

        times.sort((a, b) => a - b);
        const min = times[0];
        const max = times.at(-1);
        const avg = times.reduce((s, t) => s + t, 0) / times.length;
        const median = times[Math.floor(times.length / 2)];

        console.log(
            `[perf] Init time — ${times.length} runs: min=${min.toFixed(1)}ms, max=${max.toFixed(1)}ms, avg=${avg.toFixed(1)}ms, median=${median.toFixed(1)}ms`
        );

        // Update perf-baseline.json
        const baseline = readBaseline();
        baseline.runtime.initTime = {
            min: Math.round(min * 10) / 10,
            max: Math.round(max * 10) / 10,
            avg: Math.round(avg * 10) / 10,
            median: Math.round(median * 10) / 10,
            runs: times.length,
            target_ms: 500,
        };
        writeBaseline(baseline);

        // 6.4.1 — Timing assertion
        // Note: The startup-total measure includes all network fetches (profiles, GeoJSON,
        // taxonomy, sprites, styles). The 500ms target from the roadmap is for JS parsing/exec
        // on production CDN. In E2E with local http-server, network adds ~3-4s.
        // Gate: <10s E2E (catches regressions), <500ms is the production target.
        expect(avg).toBeLessThan(10_000);
    });
});

// ─── 6.2.2 — GeoJSON render time ───────────────────────────────────────────

test.describe("6.2.2 — GeoJSON render time", () => {
    test.use({ baseURL: baseURL("core") });

    for (const count of [1000, 5000, 10000]) {
        const label = count >= 1000 ? `${count / 1000}k` : String(count);

        test(`render ${label} random point features`, async ({ page }) => {
            test.setTimeout(90_000);
            await waitForMap(page);

            const results = await page.evaluate((n) => {
                const times = [];
                const ITERATIONS = 3;
                // One cast per callback rather than one unchecked member access per line:
                // `window.GeoLeaf` and the injected factory are untyped in this tooling
                // project, and TOOLING-TS counts every occurrence.
                const win = /** @type {any} */ (window);
                const map = win.GeoLeaf.Core.getMap().getNativeMap();

                for (let iter = 0; iter < ITERATIONS; iter++) {
                    // Points within the map's current bounds. `properties: 1` reproduces the
                    // `{ id, name }` payload this block has always measured — the shared
                    // factory replaces the loop, not the dose.
                    const b = map.getBounds();
                    const geojson = win.__geoleafMakeFeatures({
                        count: n,
                        properties: 1,
                        seed: iter + 1,
                        bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
                    });

                    const sourceId = "_perf_geojson_" + iter + "_" + Date.now();
                    const t0 = performance.now();
                    map.addSource(sourceId, { type: "geojson", data: geojson });
                    map.addLayer({
                        id: sourceId,
                        type: "circle",
                        source: sourceId,
                        paint: { "circle-radius": 3, "circle-color": "#3b82f6" },
                    });
                    const t1 = performance.now();
                    times.push(t1 - t0);

                    // Cleanup to avoid accumulation
                    map.removeLayer(sourceId);
                    map.removeSource(sourceId);
                }

                const min = Math.min(...times);
                const max = Math.max(...times);
                const avg = times.reduce((s, t) => s + t, 0) / times.length;
                return { min, max, avg };
            }, count);

            console.log(
                `[perf] GeoJSON ${label}: avg=${results.avg.toFixed(1)}ms, min=${results.min.toFixed(1)}ms, max=${results.max.toFixed(1)}ms`
            );

            // Update perf-baseline.json — capture the committed entry BEFORE overwriting
            // it, so the gate compares live-vs-committed (not live-vs-live).
            const baseline = readBaseline();
            const committed = baseline.runtime.geojsonRender[label];
            baseline.runtime.geojsonRender[label] = {
                avg_ms: Math.round(results.avg * 10) / 10,
                min: Math.round(results.min * 10) / 10,
                max: Math.round(results.max * 10) / 10,
            };
            writeBaseline(baseline);

            expect(results.avg).toBeGreaterThan(0);

            // Runtime regression gate (verify mode only) — geojsonRender is GL-independent.
            if (gating && baselineIsCaptured(baseline)) {
                const ceiling = geojsonCeilingMs(committed);
                if (ceiling !== null) {
                    expect(
                        results.avg,
                        `geojsonRender ${label} regressed: ${results.avg.toFixed(2)}ms > ${ceiling.toFixed(2)}ms ceiling`
                    ).toBeLessThanOrEqual(ceiling);
                }
            }
        });
    }
});

// ─── 6.2.3 — FPS at zoom/pan ───────────────────────────────────────────────

test.describe("6.2.3 — FPS during zoom", () => {
    test.use({ baseURL: baseURL("core") });

    for (const count of [100, 1000, 5000, 10000]) {
        const label = count >= 1000 ? `${count / 1000}k` : String(count);
        const key = `${label}_markers`;

        test(`FPS with ${label} markers (plain + clustered)`, async ({ page }) => {
            test.setTimeout(120_000);
            await waitForMap(page);

            // Measure both plain and clustered in one browser context
            const result = await page.evaluate(async (n) => {
                const map = window.GeoLeaf.Core.getMap().getNativeMap();
                const bounds = map.getBounds();
                const west = bounds.getWest(),
                    east = bounds.getEast();
                const south = bounds.getSouth(),
                    north = bounds.getNorth();
                const DURATION = 2000;
                const originalZoom = map.getZoom();

                // Helper: count FPS during a 2s zoom animation
                function measureFpsDuringZoom() {
                    return new Promise((resolve) => {
                        let frames = 0;
                        const start = performance.now();
                        function countFrame() {
                            frames++;
                            if (performance.now() - start < DURATION) {
                                requestAnimationFrame(countFrame);
                            } else {
                                resolve(Math.round((frames / DURATION) * 1000));
                            }
                        }
                        requestAnimationFrame(countFrame);
                        map.setZoom(map.getZoom() + 2, {
                            animate: true,
                            duration: DURATION / 1000,
                        });
                    });
                }

                // --- Warm-up, discarded ---
                // The FIRST zoom animation of a fresh page pays the compositor / software-GL warm-up:
                // shader compilation, tile raster upload, first RAF cadence. On the smallest fixture
                // (100 markers, which runs first) that cost landed inside the measured window and
                // produced 16 FPS against a floor of 17 — a ~6 % miss that flaked the suite while the
                // 1k / 5k / 10k cases, warmed by the runs before them, stayed green. Burning one
                // unmeasured animation removes the artefact WITHOUT touching the threshold: what is
                // asserted below is still the real steady-state frame rate.
                await measureFpsDuringZoom();
                map.setZoom(originalZoom, { animate: false });

                // --- Plain markers (MapLibre Marker API) ---
                const plainMarkers = [];
                for (let i = 0; i < n; i++) {
                    plainMarkers.push(
                        new maplibregl.Marker()
                            .setLngLat([
                                west + Math.random() * (east - west),
                                south + Math.random() * (north - south),
                            ])
                            .addTo(map)
                    );
                }
                const plainFps = await measureFpsDuringZoom();
                plainMarkers.forEach((m) => m.remove());
                map.setZoom(originalZoom, { animate: false });

                // --- Clustered markers (MapLibre GeoJSON cluster source) ---
                const clusterSrcId = "_perf_cluster_" + Date.now();
                // `properties: 0` reproduces the `{ id }` payload this block has always used.
                const clusterData = /** @type {any} */ (window).__geoleafMakeFeatures({
                    count: n,
                    properties: 0,
                    seed: 7,
                    bounds: [west, south, east, north],
                });
                map.addSource(clusterSrcId, {
                    type: "geojson",
                    data: clusterData,
                    cluster: true,
                    clusterMaxZoom: 14,
                });
                map.addLayer({
                    id: clusterSrcId + "-c",
                    type: "circle",
                    source: clusterSrcId,
                    filter: ["has", "point_count"],
                    paint: { "circle-radius": 10, "circle-color": "#51bbd6" },
                });
                map.addLayer({
                    id: clusterSrcId + "-p",
                    type: "circle",
                    source: clusterSrcId,
                    filter: ["!", ["has", "point_count"]],
                    paint: { "circle-radius": 4, "circle-color": "#f28cb1" },
                });
                // --- Clustering census — the ORACLE, read BEFORE the FPS measurement ---
                // This block replaces a literal: the spec returned a hard-coded
                // `hasClustering: true` and printed it as if it were a measurement.
                // The word "clustered" qualifying the FPS below was thus backed by
                // nothing.
                //
                // The census is taken at the source's CREATION zoom, never after the
                // measurement: `measureFpsDuringZoom()` zooms +2, and at 100 points
                // that zoom undoes the grouping (measured by
                // scripts/probe-cluster-oracle.mjs: 30 clusters at z4.23 → 0 at
                // z6.23). Reading after would make the oracle false on the smallest
                // case.
                //
                // The loop waits for the source to be LOADED, not for clusters to
                // appear: exiting at the first cluster seen would yield a PARTIAL
                // census (a few tiles), and the "grouped points / rendered features"
                // ratio asserted below would collapse on healthy code. It returns
                // its last census if the source never settles — a source whose
                // clustering is broken cannot become green by waiting.
                let census = { rendered: 0, clusters: 0, grouped: 0 };
                for (let waited = 0; waited <= 3000; waited += 150) {
                    const rendered = map.querySourceFeatures(clusterSrcId);
                    const clusters = rendered.filter(
                        (f) => f.properties && f.properties.point_count > 0
                    );
                    census = {
                        rendered: rendered.length,
                        clusters: clusters.length,
                        grouped: clusters.reduce((s, f) => s + f.properties.point_count, 0),
                    };
                    if (map.isSourceLoaded(clusterSrcId) && census.rendered > 0) break;
                    await new Promise((r) => setTimeout(r, 150));
                }

                const clusteredFps = await measureFpsDuringZoom();
                map.removeLayer(clusterSrcId + "-c");
                map.removeLayer(clusterSrcId + "-p");
                map.removeSource(clusterSrcId);
                map.setZoom(originalZoom, { animate: false });

                return { plain: plainFps, clustered: clusteredFps, cluster: census };
            }, count);

            console.log(
                `[perf] FPS ${label}: plain=${result.plain} fps, clustered=${result.clustered} fps ` +
                    `(source clusterisée : ${result.cluster.clusters} clusters, ${result.cluster.grouped} points groupés, ` +
                    `${result.cluster.rendered} features rendues)`
            );

            // Update perf-baseline.json
            const baseline = readBaseline();
            baseline.runtime.fps[key] = {
                avg: result.plain,
                clustered: result.clustered,
            };
            writeBaseline(baseline);

            expect(result.plain).toBeGreaterThan(0);
            expect(result.clustered).toBeGreaterThan(0);

            // ─── What is asserted here, and why it is NO LONGER the FPS ────────────────
            //
            // Absolute FPS are not gated: under software/virtualised GL (WSLg/CI)
            // they are not representative (measured under software GL). Until
            // 2026-08-10 a DIRECTIONAL invariant gated them anyway —
            // `clustered ≥ plain − 5 fps` — on the ground that a clustering
            // regression would yield `clustered << plain`.
            //
            // 🛑 THAT INVARIANT COULD NOT KEEP THAT PROMISE, and three INDEPENDENT
            // reasons each suffice. Measured over 5 runs (same code, same deploy,
            // same nginx target), 3 of them with the machine at rest:
            //
            //  ① It decided on noise. The range of the margin
            //     `clustered − (plain − 5)` is 52 fps at 100 markers, 46 at 1k, 32
            //     at 5k, 31 at 10k — for a threshold of 5. The threshold is ONE
            //     TENTH of the noise of the quantity it judges. Both terms vary by
            //     a factor of ~2 to ~2.8 run to run, and the margin being their
            //     DIFFERENCE, it accumulates both noises. The only known red
            //     (08-10, 11:34 vs 14:58) is a draw, not a product event.
            //  ② It was hollow where clustering counts. At 5k and 10k, `plain` is
            //     1 fps in 5 runs out of 5 (the DOM path collapses), so
            //     `clustered ≥ plain − 5` is true no matter what. It only had bite
            //     at 100 and 1k — i.e. exactly where clustering serves nothing.
            //  ③ It compared two rendering paths FOREIGN to each other: `plain`
            //     stacks DOM markers (`maplibregl.Marker`), `clustered` lays a
            //     GeoJSON source and two GL `circle` layers. "plain ≈ clustered"
            //     was not a product property but a coincidence of regimes — which
            //     the measurement undid.
            //
            // ⚠️ AND ABOVE ALL: this test does NOT touch GeoLeaf's clustering. It
            // calls `map.addSource(..., { cluster: true })` directly on the native
            // map. A red here would have implicated MapLibre, never GeoLeaf. The
            // PRODUCT clustering — profile → `getClusteringStrategy` → clustered
            // native source — is guarded deterministically by the
            // native-source-is-clustered test of `e2e/cfg-c4-layers.spec.js` and
            // by `packages/core/__tests__/capabilities/cluster/`.
            //
            // WHAT IS ASSERTED INSTEAD — deterministic, GL-independent, and bearing
            // on what this test REALLY BUILDS: the source it just added did
            // cluster. Two assertions, because ONE ALONE was SEEN LETTING a real
            // outage through. Measurements taken at the test's zoom (4.23),
            // `clusters` / `grouped points` / `rendered`:
            //
            //   mutation                        | 100          | 1k             | 5k              | 10k
            //   --------------------------------|--------------|----------------|-----------------|------------------
            //   none (healthy)                  | 30 / 76 / 98 | 196/1189/278   | 335/6871/355    | 361/14167/374
            //   `cluster: false`                |  0 /  0 /215 |   0/   0/2204  |   0/   0/10924  |   0/    0/21737
            //   `clusterMaxZoom: 2` (dissolved) | 15 / 52 /107 |  30/ 456/930   |  32/2178/4620   |  33/ 4727/9152
            //
            //  (A) ≥ 1 cluster. Separates the TOTAL outage — `cluster: false`
            //      yields 0 on all four cases. ⚠️ But it is HOLLOW for DISSOLVED
            //      clustering: at `clusterMaxZoom: 2` 15 to 33 clusters remain, and
            //      this assertion alone stays green 4 times out of 4.
            //  (B) grouped points > rendered features — "clustering COMPRESSES".
            //      Healthy: 4.3× to 37.9×. Dissolved: 0.47× to 0.52×. A ~9× factor
            //      separates the two regimes, with no arbitrary constant: the
            //      threshold is the point where compression ceases.
            //      ⚠️ (B) only holds for n ≥ 1000, and that is MEASURED, not
            //      conceded: at 100 points spread over the window, healthy
            //      clustering groups 76 points into 30 clusters for 98 rendered
            //      features — it does not compress, legitimately. Asserting (B) at
            //      100 would redden on healthy code. The 100 case thus carries only
            //      (A), and it is the only one of the four not to see dissolution.
            //
            // 🛑 WHAT THIS CHOICE MAKES UNABLE TO SEE, and nothing here will:
            //   · the clustering's rendering COST — clustering that groups
            //     correctly but becomes slow stays invisible. Under software GL it
            //     already was: the effect would drown in a 30-to-50-fps noise band.
            //     It would show on hardware GL, through a capture
            //     (`npm run perf:capture`, E2E_HW_GL=1) compared to a baseline
            //     captured on the same host — never through a WSL/CI run;
            //   · clustering dissolution AT THE 100 CASE — assertion (A) alone,
            //     cf. above;
            //   · a reduced `clusterRadius` that would still group, but worse, as
            //     long as compression stays > 1;
            //   · and, restated but essential: ANY regression of GEOLEAF's
            //     clustering, this test calling only MapLibre. It is
            //     `cfg-c4-layers.spec.js` that sees it.
            // These blind spots are NAMED rather than covered by an assertion that
            // could not be seen red.
            expect(
                result.cluster.clusters,
                `FPS ${label}: la source « clustered » n'a produit AUCUN cluster ` +
                    `(${result.cluster.rendered} features rendues, 0 portant point_count) — ` +
                    `le clustering ne prend pas effet, le FPS « clustered » ci-dessus ne mesure ` +
                    `donc pas ce que son nom dit`
            ).toBeGreaterThan(0);

            if (count >= 1000) {
                expect(
                    result.cluster.grouped,
                    `FPS ${label}: le clustering ne COMPRESSE plus — ${result.cluster.grouped} points ` +
                        `groupés pour ${result.cluster.rendered} features rendues (${result.cluster.clusters} ` +
                        `clusters). Un clustering sain rend ici 4× à 38× plus de points groupés que de ` +
                        `features ; sous ce rapport, la source est dissoute en points individuels.`
                ).toBeGreaterThan(result.cluster.rendered);
            }
        });
    }
});

// ─── 6.2.4 — Heap memory after 10K features ────────────────────────────────
//
// 🛑 2026-08-10 — THIS BLOCK MEASURED THE PAGE'S AMBIENT HEAP, NOT THE FEATURES.
// It read `performance.memory.usedJSHeapSize` before and after the add, and
// yielded `delta = 0` in the SIX known runs. No accident: without
// `--enable-precise-memory-info`, Chrome quantises this value AND freezes it for
// the page's lifetime — measured over 10 fresh pages, null delta at N = 0,
// 10,000 AND 30,000. The `committed × 1.5` ceiling thus judged the ambient
// heap, whose measured dispersion (24.8 → 45.2 MB, ×1.8) overflowed it: a red
// expected by construction, with no product regression. Same family as the
// FPS — a threshold inside the noise band — with this in addition: the metric
// itself did not vary with its object, so widening the ceiling would have
// repaired nothing.
//
// WHAT REPLACES IT, and why it is not a tweak:
//   1. THE INSTRUMENT changes. CDP `Runtime.getHeapUsage` after
//      `HeapProfiler.collectGarbage` on both sides → what is measured is what is
//      RETAINED, not what was allocated. Measured: 1.54–1.57 MB for 10k features
//      (5 fresh pages, 0.03 range), 0.09–0.15 MB at N = 0, 4.12 MB at
//      N = 30,000. The quantity follows its dose; the missing condition, and
//      without it every threshold is decorative.
//      ⚠️ The forced GC is no refinement: without it, the raw measured delta was
//      NEGATIVE (−3.8 MB at 10k), a GC landing between the two reads. Changing
//      tools without changing protocol would not have sufficed.
//   2. THE GESTURE changes. The add goes through `adapter.addGeoJSONLayer` — the
//      GeoLeaf API — and no longer native `map.addSource`. The old one touched
//      no GeoLeaf code: a regression there would have implicated MapLibre (the
//      4th fact of the investigation, found again here). Measured gap between
//      the two paths: +0.06 MB, the layer registry.
//   3. THE BAND no longer reads the baseline. `perf-baseline.json` carries an
//      ambient heap captured on 06-26 with the retired instrument: it cannot
//      serve as a contract for the new one, and recapturing under software GL is
//      forbidden. The band is absolute and lives in `helpers/perf-gate.js` with
//      the table justifying it.
//   4. A FLOOR appears, and it is the demanded assertion: a null delta now
//      REDDENS instead of passing in silence.
//
// ⛔ WHAT THIS GATE STILL DOES NOT SEE — named, not covered:
//   - The WORKER's heap. `Runtime.getHeapUsage` only sees the page's isolate;
//     MapLibre tiles the GeoJSON in a worker. Supporting measurement: under
//     `--enable-precise-memory-info`, `performance.memory` (process-scale)
//     yields ~2× the CDP delta — 2.99 vs 1.49 MB at 10k, 9.07 vs 4.03 at 30k. A
//     worker-side regression is invisible here.
//   - LEAKS. This test never removes the layer; it measures a cost, not a
//     retention after teardown. Intended home: 6.2.6 — itself blind, see its
//     note.
//   - GeoLeaf's BOOT FOOTPRINT. The "before" read is remarkably stable
//     (15.65–15.79 MB over 10 fresh pages, ±0.5 %) but is NOT asserted: the
//     guard reads only the difference. A doubling of the boot's retained heap
//     would pass.
//   - NON-JS memory cost (GPU buffers, textures) — beyond any JS heap metric,
//     under any instrument.

const HEAP_FEATURES = 10_000;

/** Retained heap (bytes): forced GC (×2, V8 collects in several passes) then read. */
async function retainedHeapBytes(client, page) {
    for (let i = 0; i < 2; i++) await client.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(200);
    const { usedSize } = await client.send("Runtime.getHeapUsage");
    return usedSize;
}

test.describe("6.2.4 — Heap memory", () => {
    test.use({ baseURL: baseURL("core") });

    test("measure JS heap after loading 10K features", async ({ page }) => {
        await waitForMap(page);

        // CDP: available unconditionally here. ⚠️ The motive changed on
        // 2026-08-14 — it is no longer "the config has a single project" (it has
        // two since `chromium-touch`), it is that **both projects are Chromium**,
        // this repo's only channel. On a non-Chromium project this would throw,
        // and that is the right behaviour: a memory gate that skips itself in
        // silence is the defect settled here.
        const client = await page.context().newCDPSession(page);

        const beforeBytes = await retainedHeapBytes(client, page);
        const pmBefore = await page.evaluate(() =>
            performance.memory ? performance.memory.usedJSHeapSize : null
        );

        await page.evaluate((n) => {
            const adapter = window.GeoLeaf.Core.getMap();
            const bounds = adapter.getNativeMap().getBounds();
            const west = bounds.getWest(),
                east = bounds.getEast();
            const south = bounds.getSouth(),
                north = bounds.getNorth();
            // `properties: 2` reproduces the `{ id, name, category }` payload the band in
            // `perf-gate.js` was calibrated on — the loop moves, the dose does not.
            adapter.addGeoJSONLayer(
                "_perf_mem_" + Date.now(),
                /** @type {any} */ (window).__geoleafMakeFeatures({
                    count: n,
                    properties: 2,
                    seed: 3,
                    bounds: [west, south, east, north],
                })
            );
        }, HEAP_FEATURES);

        await page.waitForTimeout(1000);
        const afterBytes = await retainedHeapBytes(client, page);
        const pmAfter = await page.evaluate(() =>
            performance.memory ? performance.memory.usedJSHeapSize : null
        );

        const mb = (b) => Math.round((b / (1024 * 1024)) * 100) / 100;
        const deltaMb = mb(afterBytes - beforeBytes);
        // Both instruments are logged side by side ON PURPOSE: the `perf.memory`
        // column prints the known symptom (a null delta) at every run, which
        // keeps the fact re-readable without re-reading the register.
        console.log(
            `[perf] Heap (CDP, retenu): before=${mb(beforeBytes)}MB, after 10K=${mb(afterBytes)}MB, delta=${deltaMb}MB` +
                (pmBefore !== null && pmAfter !== null
                    ? ` | perf.memory delta=${mb(pmAfter - pmBefore)}MB (figé par Chrome)`
                    : " | perf.memory indisponible")
        );

        // Recording, NOT a contract: no guard reads this block anymore (the band
        // lives in perf-gate.js). It documents a capture's environment for a
        // human reader and cannot fossilise — every `npm run perf:capture`
        // rewrites it. The `after10kFeatures_mb: 29.6` still committed describes
        // the RETIRED instrument; it is not hand-edited here, the next capture
        // will replace it.
        const baseline = readBaseline();
        baseline.runtime.memory = {
            heapBefore_mb: mb(beforeBytes),
            heapAfter10k_mb: mb(afterBytes),
            heapDelta10k_mb: deltaMb,
            _instrument: "CDP Runtime.getHeapUsage + HeapProfiler.collectGarbage",
        };
        writeBaseline(baseline);

        const { floorMb, ceilMb } = heapDeltaBandMb(HEAP_FEATURES);

        // FLOOR — asserted UNCONDITIONALLY, including under hardware GL: it does
        // not speak of performance but of the instrument. "The heap did not move"
        // must never be a green again. The hollow instrument in one line.
        expect(
            deltaMb,
            `la mesure de heap ne voit pas les ${HEAP_FEATURES} features : delta=${deltaMb}MB < ${floorMb}MB. ` +
                "Instrument creux ou ajout sans effet — ne PAS abaisser ce plancher pour faire verdir."
        ).toBeGreaterThanOrEqual(floorMb);

        // CEILING — regression gate, under the file's regime (software GL).
        if (gating) {
            expect(
                deltaMb,
                `heap retenu pour ${HEAP_FEATURES} features: ${deltaMb}MB > ${ceilMb}MB — ` +
                    "bande mesurée 1,51–1,57MB sur 8 relevés, donc ceci est un changement réel, pas un tirage."
            ).toBeLessThanOrEqual(ceilMb);
        }
    });
});

// ─── 6.2.5 — WCAG 2.1 AA baseline scan ─────────────────────────────────────

test.describe("6.2.5 — Accessibility baseline", () => {
    test.use({ baseURL: baseURL("core") });

    test("[a11y] page passes WCAG 2.1 AA axe scan after map load", async ({ page }) => {
        await waitForMap(page);
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });
});

// ─── 6.2.6 — Memory-leak detection (profiler, F-TOOL-4) ────────────────────
//
// 🛑 2026-08-10 — THIS BLOCK WAS GREEN BY CONSTRUCTION, AND ITS CAUSE WAS IN
// THE PRODUCT, NOT THE TEST. It asserted `status !== "critical"` on the verdict
// of `GeoLeaf.Utils.PerformanceProfiler.analyzeMemoryLeaks()` — a PUBLIC API —
// which consumes `getMemoryUsage()`, which reads
// `performance.memory.usedJSHeapSize`. Chrome QUANTISES this value and FREEZES
// it for the page's lifetime outside `--enable-precise-memory-info`: the ~17
// samples of a run were thus rigorously equal, `growthRate` was exactly 0, and
// `warning`/`critical` were UNREACHABLE. Measured 8 runs out of 8, and 14 fresh
// probe pages with the "distinct" column at 1 without exception.
//
// 🔥 THE FACT THAT SETTLED IT, and it cannot be deduced from the code: on a page
// RETAINING 9.0 to 9.2 MB of deliberate leak (the collections stay referenced),
// the API returned
//     {"status":"normal","growthRate":0,"memoryTrend":"decreasing",
//      "recommendation":"No action needed"}
// "No action needed" on a 9 MB leak, measured 4 times. So the defect was not
// first a test defect: an integrator calling this API to watch their
// application receives "no leak" no matter what.
//
// WHAT REPLACES IT — two distinct guards, on two distinct objects:
//   1. THE PRODUCT'S HONESTY. `analyzeMemoryLeaks()` now returns
//      `unavailable`/`heap-readings-constant` when all its samples are equal to
//      the byte — an arithmetic fact on its window, with no tolerance to tune.
//      This test asserts it, and that assertion is what reddens if the fix is
//      reverted.
//   2. A REAL LEAK GUARD, through CDP. The RETAINED heap
//      (`Runtime.getHeapUsage` after `HeapProfiler.collectGarbage` ×2) is read
//      before, at PEAK (last layer still in place) and after removal. The hole
//      the investigation named explicitly: §6.2.4 measures a COST and never
//      removes the layer, so nobody measured RETENTION. Calibration table in
//      `helpers/perf-gate.js`.
//   3. THE GESTURE goes through `adapter.addGeoJSONLayer` /
//      `adapter.removeLayer` — the GeoLeaf API — and no longer native
//      `map.addSource`. The 4th fact already cited, found again on this file's
//      THIRD test: the old churn touched no GeoLeaf code, so a layer-registry
//      leak was invisible to it.
//
// ⛔ WHAT THIS BLOCK STILL DOES NOT SEE:
//   - The WORKER's heap (MapLibre tiles the GeoJSON outside the page's isolate).
//   - A leak under ~4 MB over 14 cycles, i.e. about 4 collections out of 14. The
//     ceiling catches an order of magnitude, not a slow drift — and it is NOT
//     tightenable at will: the healthy dispersion measured by this very spec
//     runs from −0.12 to +1.22 MB over 11 runs, four times wider than the
//     probe's.
//   - The fact that the product API stays, at the integrator's, UNABLE TO
//     MEASURE: it no longer lies, it says "I don't know". It is CDP, outside the
//     product, that measures here — and CDP is not available at the
//     integrator's.

const CHURN_CYCLES = 14; // ≥10 samples for analyzeMemoryLeaks; the band's dose

test.describe("6.2.6 — Memory leak detection", () => {
    test.use({ baseURL: baseURL("core") });

    test("no abnormal heap growth over add/remove churn (profiler)", async ({ page }) => {
        test.setTimeout(90_000);
        await waitForMap(page);

        // CDP: available unconditionally here (a single project, `chromium`). A
        // leak gate that skips itself in silence is exactly the defect the
        // investigation settled.
        const client = await page.context().newCDPSession(page);
        const beforeBytes = await retainedHeapBytes(client, page);

        // PHASE 1 — the add→remove cycles, then one LAST add left IN PLACE: it is
        // what the PEAK read must see. Without that measuring point, a null
        // retention would be indistinguishable from a churn that did nothing —
        // the anti-hollow floor's lesson, transposed to a quantity that must be
        // zero when all is well.
        await page.evaluate(async (cycles) => {
            const adapter = window.GeoLeaf.Core.getMap();
            const bounds = adapter.getNativeMap().getBounds();
            const west = bounds.getWest(),
                east = bounds.getEast();
            const south = bounds.getSouth(),
                north = bounds.getNorth();
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            // A FRESH collection per cycle, as before: the churn must allocate, or it would
            // measure nothing. The seed varies with the cycle for the same reason.
            let seed = 0;
            const collection = () =>
                /** @type {any} */ (window).__geoleafMakeFeatures({
                    count: 10000,
                    properties: 0,
                    seed: ++seed,
                    bounds: [west, south, east, north],
                });

            // Fast-interval instance — startMonitoring() forces collection regardless of
            // dev-mode; samples land in the shared module-level performanceData singleton.
            window.__leakProfiler = new window.GeoLeaf.Utils.PerformanceProfiler({
                monitoring: { enabled: true, interval: 200, maxDataPoints: 60 },
            });
            window.__leakProfiler.startMonitoring();

            // DIRECT witness of the profiler's input, read at the same source as
            // it: how many DISTINCT values does `performance.memory` yield over
            // the churn's duration? That counter is what authorises — or not —
            // believing a verdict.
            window.__leakSamples = [];
            for (let c = 0; c < cycles; c++) {
                if (performance.memory)
                    window.__leakSamples.push(performance.memory.usedJSHeapSize);
                const id = "_leak_" + c;
                adapter.addGeoJSONLayer(id, collection());
                await sleep(120);
                adapter.removeLayer(id);
                await sleep(120);
            }
            adapter.addGeoJSONLayer("_leak_peak", collection());
            await sleep(400);
        }, CHURN_CYCLES);

        const peakBytes = await retainedHeapBytes(client, page);

        // PHASE 2 — removal of the held layer, then the product's verdict.
        const analysis = await page.evaluate(async () => {
            const adapter = window.GeoLeaf.Core.getMap();
            adapter.removeLayer("_leak_peak");
            await new Promise((r) => setTimeout(r, 300));
            if (performance.memory) window.__leakSamples.push(performance.memory.usedJSHeapSize);
            const result = window.__leakProfiler.analyzeMemoryLeaks();
            window.__leakProfiler.stopMonitoring();
            return {
                ...result,
                _samples: window.__leakSamples.length,
                _distinct: new Set(window.__leakSamples).size,
            };
        });

        const afterBytes = await retainedHeapBytes(client, page);
        const mb = (b) => Math.round((b / (1024 * 1024)) * 100) / 100;
        const peakMb = mb(peakBytes - beforeBytes);
        const retainedMb = mb(afterBytes - beforeBytes);

        console.log(
            `[perf] Memory-leak analysis: ${JSON.stringify(analysis)}\n` +
                `[perf] Heap churn (CDP, retenu): before=${mb(beforeBytes)}MB, ` +
                `pic=${mb(peakBytes)}MB (+${peakMb}), après retrait=${mb(afterBytes)}MB (+${retainedMb})`
        );

        // ── (1) THE PRODUCT VERDICT'S HONESTY ─────────────────────────────────────
        // Closed vocabulary: an unknown status is a contract regression, not a
        // wording detail.
        expect(
            ["insufficient_data", "unavailable", "normal", "warning", "critical"],
            `statut hors vocabulaire : ${JSON.stringify(analysis)}`
        ).toContain(analysis.status);

        // The condition is MEASURED in this run, not assumed: if the profiler's
        // input did not vary by one byte, no growth verdict is computable, and
        // the API must SAY so. On this environment `_distinct` is 1 (measured on
        // 14 fresh pages); if Chrome one day stops freezing
        // `performance.memory`, the branch stops applying instead of reddening
        // wrongly — and the log above keeps it readable.
        if (analysis._samples > 0 && analysis._distinct <= 1) {
            expect(
                analysis.status,
                `l'entrée du profiler n'a rendu qu'UNE valeur sur ${analysis._samples} relevés : ` +
                    "aucun verdict de croissance n'est calculable dessus. Un « normal » ici est le " +
                    "le défaut d'origine — une fuite mesurée à 15,1 Mo par CDP recevait « No action needed »."
            ).toBe("unavailable");
            expect(["heap-readings-constant", "heap-api-unavailable"]).toContain(analysis.reason);
            expect(
                analysis.growthRate,
                "aucun chiffre de croissance ne doit être publié quand il n'y en a pas"
            ).toBeUndefined();
        }

        // F-TOOL-4 gate, UNCHANGED: a "critical" verdict fails the run.
        expect(analysis.status, `memory leak detected: ${JSON.stringify(analysis)}`).not.toBe(
            "critical"
        );

        // ── (2) THE LEAK GUARD, through CDP ───────────────────────────────────────
        const { peakFloorMb, retentionCeilMb } = heapRetentionBandMb(CHURN_CYCLES);

        // Anti-hollow FLOOR — asserted UNCONDITIONALLY, including under hardware
        // GL: it does not speak of performance but of the instrument and the
        // gesture. If the held layer weighs nothing, the null retention measured
        // right after proves nothing.
        expect(
            peakMb,
            `le churn est invisible à l'instrument : pic=${peakMb}MB < ${peakFloorMb}MB. ` +
                "Instrument creux ou ajout sans effet — ne PAS abaisser ce plancher pour faire verdir."
        ).toBeGreaterThanOrEqual(peakFloorMb);

        // Retention CEILING — the leak guard proper, under the file's regime
        // (software GL).
        if (gating) {
            expect(
                retainedMb,
                `fuite : ${retainedMb}MB retenus après ${CHURN_CYCLES} cycles add→remove ` +
                    `(> ${retentionCeilMb}MB). Bande mesurée PAR CE SPEC : churn sain −0,12 à ` +
                    "+1,22MB sur 11 runs, fuite délibérée 13,78 à 13,85MB — ceci est un " +
                    "changement réel, pas un tirage."
            ).toBeLessThanOrEqual(retentionCeilMb);
        }
    });
});

// ─── 6.2.7 — Web Vitals (LCP / INP / CLS, F-TOOL-3) ───────────────────────

test.describe("6.2.7 — Web Vitals", () => {
    test.use({ baseURL: baseURL("core") });

    test("captures LCP / INP / CLS via web-vitals (informational, non-gating)", async ({
        page,
    }) => {
        test.setTimeout(60_000);

        // Arm web-vitals BEFORE navigation so LCP and the first interactions are caught.
        await injectWebVitals(page);
        await waitForMap(page);

        // INP needs a real interaction. Drive a click + wheel zoom on the map canvas so
        // web-vitals records an interaction → next-paint latency. reportAllChanges:true
        // makes onINP/onLCP fire immediately rather than only on page hide.
        const mapBox = await page.locator(MAP_SELECTOR).boundingBox();
        if (mapBox) {
            const cx = mapBox.x + mapBox.width / 2;
            const cy = mapBox.y + mapBox.height / 2;
            await page.mouse.move(cx, cy);
            await page.mouse.click(cx, cy);
            await page.mouse.wheel(0, -240); // zoom in
            await page.waitForTimeout(400);
            await page.mouse.click(cx + 20, cy + 20);
        }

        // Let the metrics settle (LCP candidate + INP after interaction processing).
        await page.waitForTimeout(1500);

        const wv = await readWebVitals(page);
        const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : null);
        const lcp = round(wv.lcp);
        const inp = round(wv.inp);
        const cls = round(wv.cls);

        console.log(
            `[perf] Web Vitals — LCP=${lcp ?? "n/a"}ms, INP=${inp ?? "n/a"}ms, CLS=${cls ?? "n/a"}`
        );

        // Persist under capture only (hardware GL). Like FPS, these are NOT gated:
        // under the WSLg virtualized GPU paint/interaction timings are not representative.
        const baseline = readBaseline();
        baseline.runtime.webVitals = {
            lcp_ms: lcp,
            inp_ms: inp,
            cls,
            _note:
                "LCP/INP/CLS captured in e2e via web-vitals (devDependency, injected at test runtime — NOT bundled). " +
                "Informational / non-gating: under the WSLg virtualized GPU paint & interaction timings are not " +
                "representative of native end-user perf (same caveat as runtime.fps). A true Web Vitals contract " +
                "needs native Windows + a real display. INP may be null if no interaction registered.",
        };
        writeBaseline(baseline);

        // Sanity only: the collector ran and exposed the three keys. Values may be null
        // under headless/software GL — that is logged, never failed (non-gating).
        expect(wv).toHaveProperty("lcp");
        expect(wv).toHaveProperty("inp");
        expect(wv).toHaveProperty("cls");
    });
});

// ─── 6.2.8 — Basemap rebuild cost (F-RENDER-1) — REMOVED ───────────────────
//
// The instrumented rebuild this block measured no longer exists: RM-P1b(c)
// replaced the `map.setStyle()` teardown + `geoleaf:style:rebuild` re-injection
// with `transformStyle` (a `setStyle` option since v5), which preserves the GeoLeaf sources/layers
// natively. There is no `geoleaf:basemap-rebuild` measure to record anymore, so
// the F-RENDER-1 spike is moot and the block was removed.

// ─── 6.2.9 — Scale, through the REAL loader (R6, task 2.1) ──────────────────
//
// WHAT THIS BLOCK MEASURES THAT NO OTHER ONE DOES. Every block above builds its
// features and hands them to the map DIRECTLY: §6.2.2 calls native
// `map.addSource`/`addLayer` through `getNativeMap()`, §6.2.4 and §6.2.6 call
// `adapter.addGeoJSONLayer`. None of them crosses the loader. So the pipeline a
// profile actually goes through — fetch in the GeoJSON worker, chunked reassembly,
// `applyDataMapping`, POI taxonomy symbol injection, cluster strategy resolution,
// adapter options, sub-layer construction, label initialisation, `state.layers` —
// has never been timed at any dose. This block enters through
// `GeoLeaf.Layers.create()`, which is that whole path.
//
// THE ORACLE IS A RATIO, NOT A DURATION, and the choice is the point. An absolute
// millisecond budget under SwiftShader on a virtualised GPU is the mistake this file
// has already paid for twice (the FPS gate, the frozen-heap gate): a threshold inside
// the noise band. What R6 changed is a SHAPE — the cost of one unit mutation stopped
// being proportional to the layer's size — and a shape shows up as a ratio between two
// gestures measured back to back on the same page, at the same dose, on the same
// machine. `setData` re-feeds N features; `addFeature` sends a diff of one. The
// quotient is machine-independent, GL-independent, and it collapses to ~1 the moment
// the diff path stops being taken — which is precisely the silent failure mode.
//
// ⚠️ WHAT IT DOES NOT SEE, named rather than implied:
//   - Which TILES were reloaded. Both gestures are timed to the worker's answer, so
//     the re-index is included; but `shouldReloadTile` decides tile reloads after that
//     event, and nothing here counts them.
//   - Any cost paid after `sourcedata`/`content` — repaint, symbol collision. The
//     figure is a data-path cost, not a frame budget.
//   - CPU degradation beyond the main thread. `Emulation.setCPUThrottlingRate` throttles
//     the JS thread while SwiftShader keeps rasterising in parallel — measured in this
//     repo (see `playwright.config.js`: 2 cores + ×4 costs 8 093 ms where 24 cores + ×8
//     costs 1 887 ms, on the same action). The throttle is applied because R6 asks for
//     it and because it degrades the thread the ratio is measured on; the honest
//     degradation is `taskset -c 0,1` on the whole run, which is a shell decision, not
//     a spec one.

/** URL the bench's layer is fetched from — intercepted, never a file on disk. */
const SCALE_URL = "**/__geoleaf_scale_bench.geojson";

/**
 * Doses. 30 000 is gated: twice the largest layer this repo ships (14 725 features),
 * and the order of magnitude the product is aimed at.
 *
 * 100 000 is MEASURED BUT NOT GATED, behind `GEOLEAF_SCALE=full`. The report asks for
 * both figures and both are produced; gating the higher one would put a permanent red
 * on a horizon nobody has dated (question 7 of the report's §11 is still open), and a
 * gate that reddens on a parc no user has is a gate that gets disarmed within the week.
 * That trade has already been paid here twice.
 */
const SCALE_DOSES = [
    { count: 30_000, gated: true },
    ...(process.env.GEOLEAF_SCALE === "full" ? [{ count: 100_000, gated: false }] : []),
];

test.describe("6.2.9 — Scale through the real loader", () => {
    // Mobile viewport: the target device, and the one whose label collision and
    // sub-layer work is heaviest per visible feature.
    test.use({ baseURL: baseURL("core"), viewport: { width: 390, height: 844 } });

    for (const { count, gated } of SCALE_DOSES) {
        test(`${count} features through GeoLeaf.Layers.create, then one unit mutation`, async ({
            page,
        }) => {
            // The suite's 60 s default is a budget for interactions, not for parsing tens
            // of megabytes of GeoJSON under a ×4 throttle.
            test.setTimeout(count >= 100_000 ? 600_000 : 240_000);

            const layerId = `_scale_${count}`;
            // Generated per run, never committed: 30 000 features with 11 properties is
            // ~10 MB of JSON, 100 000 is ~34 MB. The seed is what makes that safe — the
            // bytes are reproducible without being stored.
            const body = JSON.stringify(
                makeFeatureCollection({ count, seed: 1, clumps: Math.ceil(count / 150) })
            );

            // Routed on the CONTEXT, not the page: the loader fetches through the GeoJSON
            // Web Worker, and worker requests do not reliably cross a page-level route.
            // Getting this wrong would not fail — it would silently serve a 404 and time
            // the error path.
            await page
                .context()
                .route(SCALE_URL, (route) =>
                    route.fulfill({ contentType: "application/geo+json", body })
                );
            await waitForMap(page);

            const client = await page.context().newCDPSession(page);
            await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

            const before = await retainedHeapBytes(client, page);

            const result = await page.evaluate(
                async ({ id, url }) => {
                    const win = /** @type {any} */ (window);
                    const t0 = performance.now();
                    const created = await win.GeoLeaf.Layers.create({ id, label: id, url });
                    const loadMs = performance.now() - t0;

                    const map = win.GeoLeaf.Core.getMap().getNativeMap();
                    const sourceId = `gl-src-${id}`;

                    // 🛑 EACH GESTURE IS TIMED TO COMPLETION, and the first version of this
                    // block was not — it timed the CALL. `GeoJSONSource.setData` and
                    // `.updateData` both hand their work to a promise chain and return, so a
                    // full re-feed of 30 000 features measured **0.2 ms**: two empty calls,
                    // and a ratio between them would have been a number about nothing. The
                    // anti-hollow floor below is what caught it.
                    //
                    // `sourcedata` with `sourceDataType === "content"` is what
                    // `_dispatchWorkerUpdate` fires once the worker has answered — so this
                    // captures the structured clone, the re-index and the tile decision,
                    // which is where the whole cost lives.
                    const settled = () =>
                        new Promise((resolve) => {
                            const onData = (e) => {
                                if (e.sourceId !== sourceId || e.sourceDataType !== "content")
                                    return;
                                map.off("sourcedata", onData);
                                resolve();
                            };
                            map.on("sourcedata", onData);
                        });

                    const mutate = async (n) => {
                        const f = win.__geoleafMakeFeatures({ count: 1, seed: n }).features[0];
                        f.id = `${id}-x${n}`;
                        f.properties.id = f.id;
                        const t = performance.now();
                        const done = settled();
                        win.GeoLeaf.Layers.addFeature(id, f);
                        await done;
                        return performance.now() - t;
                    };

                    // 🛑 THE FIRST DIFF AND THE ONES AFTER IT ARE DIFFERENT OBJECTS, and
                    // measuring only the first is how this bench first got the wrong answer.
                    // `_applyDiffToSource` converts the whole collection into an id-keyed map
                    // the first time a diff reaches a source (`toUpdateable`), on both sides
                    // of the worker boundary — an O(N) price paid ONCE per source. Averaging
                    // it into the steady state would report a diff as slower than a re-feed,
                    // which is true of the first mutation and false of every one after it.
                    // Both are recorded: the conversion is a real cost the product pays.
                    const firstDiffMs = await mutate(1);
                    const steady = [];
                    for (let i = 2; i <= 6; i++) steady.push(await mutate(i));
                    steady.sort((a, b) => a - b);
                    const diffMs = steady[Math.floor(steady.length / 2)];

                    const all = win.GeoLeaf.Layers.getFeatures(id);
                    const t2 = performance.now();
                    const refeedDone = settled();
                    win.GeoLeaf.Layers.setData(id, all);
                    await refeedDone;
                    const refeedMs = performance.now() - t2;

                    return {
                        loadMs,
                        firstDiffMs,
                        diffMs,
                        refeedMs,
                        featureCount: created?.featureCount ?? 0,
                    };
                },
                { id: layerId, url: "/__geoleaf_scale_bench.geojson" }
            );

            const after = await retainedHeapBytes(client, page);
            await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });

            const heapMb = Math.round(((after - before) / (1024 * 1024)) * 100) / 100;
            const ratio = result.refeedMs / Math.max(result.diffMs, 0.001);
            console.log(
                `[perf] scale ${count}: load=${result.loadMs.toFixed(0)}ms ` +
                    `first-diff=${result.firstDiffMs.toFixed(1)}ms ` +
                    `diff=${result.diffMs.toFixed(3)}ms refeed=${result.refeedMs.toFixed(3)}ms ` +
                    `ratio=${ratio.toFixed(1)}x heap=${heapMb}MB`
            );

            const baseline = readBaseline();
            baseline.runtime.scale = baseline.runtime.scale || {};
            baseline.runtime.scale[String(count)] = {
                loadMs: Math.round(result.loadMs),
                firstDiffMs: Math.round(result.firstDiffMs * 10) / 10,
                diffMs: Math.round(result.diffMs * 1000) / 1000,
                refeedMs: Math.round(result.refeedMs * 1000) / 1000,
                ratio: Math.round(ratio * 10) / 10,
                heapDelta_mb: heapMb,
                _instrument: "GeoLeaf.Layers.create through the loader, CPU throttle x4, 390x844",
            };
            writeBaseline(baseline);

            // The loader actually ran, and ran on the whole dose. Without this the three
            // timings below could all be measuring a 404.
            expect(result.featureCount).toBe(count);

            if (!gated) return;

            // ANTI-HOLLOW FLOOR. A ratio between two numbers that are both noise is not a
            // measurement. `setData` re-feeds `count` features; if that costs nothing
            // measurable, the instrument is not resolving the quantity and everything below
            // means nothing. This floor has already earned its place: the first version of
            // this block timed the CALLS rather than their completion, and a full re-feed of
            // 30 000 features came back at **0.2 ms**. The floor is what said so.
            expect(
                result.refeedMs,
                `re-feeding ${count} features must cost something measurable`
            ).toBeGreaterThan(1);

            // 🛑 WHAT THIS BLOCK MEASURED, AND WHAT IT REFUTED. Five runs, 04/09/2026,
            // throttle ×4, viewport 390×844, software GL, nginx target:
            //
            //     N = 30 000    load 1 002–1 243 ms · first diff 102–149 ms
            //                   steady diff 44–65 ms · re-feed 37–59 ms · ratio 0.8–1.1×
            //     N = 100 000   load 2 797–3 512 ms · first diff 411–465 ms
            //                   steady diff 93–108 ms · re-feed 142–154 ms · ratio 1.3–1.6×
            //
            // 📌 **The gain GROWS with N, and at 30 000 there is none.** That is the opposite
            // of what "a mutation becomes independent of N" predicts, and it is the single
            // most useful thing this block produces.
            //
            // The premise this bench was written to verify — "a unit mutation becomes
            // independent of N once it goes through `updateData`" — is **FALSE at this dose**,
            // and only a measurement could have said so. The reason is in the engine, not in
            // GeoLeaf: `GeoJSONVTIndex.updateIndex` invalidates only the affected tiles, then
            // rebuilds the ROOT TILE from the whole source (`createTile(source, 0, 0, 0)`);
            // the clustered index is blunter still and re-runs `initialize(features)`. So
            // `updateData` saves the structured clone across the worker boundary and the
            // re-parse — real work, and all of it main-thread — but not the re-index, which
            // dominates at 30 000.
            //
            // The gain R6 does buy is therefore MAIN-THREAD and deterministic: no fresh array
            // of N+1 per mutation, no full collection serialised per mutation. That is
            // asserted exactly, without a stopwatch, by the array-identity test in
            // `packages/core/__tests__/geojson/layers-public-api-diff.test.ts`.
            //
            // ⚠️ **The `ratio > 5` this block first asserted was therefore a threshold on a
            // premise, not on a measurement.** It is replaced by two guards that bear on
            // mechanisms this bench can actually see.

            // GUARD 1 — the conversion is amortised, not repeated. The first diff on a source
            // pays `toUpdateable` over the whole collection, on both sides of the worker
            // boundary; every later one must not. Measured steady ÷ first over five runs:
            // 0.49 · 0.35 · 0.43 · 0.49 · 0.31 at 30 000, and 0.24 · 0.21 · 0.24 · 0.21 at
            // 100 000 — worst case 0.49, so the 0.85 ceiling sits ×1.7 clear of it. A
            // regression that reset `_data.updateable` between writes — or a fallback
            // silently re-feeding and re-converting — drives the quotient to 1.0.
            expect(
                result.diffMs,
                "the one-off updateable conversion must be amortised, not paid per mutation"
            ).toBeLessThan(result.firstDiffMs * 0.85);

            // GUARD 2 — a unit mutation never costs dramatically more than restating the whole
            // layer. Measured 0.8–1.1× at 30 000 and 1.3–1.6× at 100 000; the floor at 0.5
            // sits ×1.6 below the worst reading, far enough to redden on a real change rather
            // than on a slow afternoon.
            // 🛑 Do not raise it to "prove" the diff is faster: at this dose it is not, and a
            // threshold that asserts something the measurement denies is the fault this file
            // has already paid for twice.
            expect(
                ratio,
                `a unit mutation on ${count} features must not cost more than a full re-feed`
            ).toBeGreaterThan(0.5);
        });
    }
});
