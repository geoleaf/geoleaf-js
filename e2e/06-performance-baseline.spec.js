// @ts-check
// Sprint 6 — E2E Performance Baseline
// Measures init time, GeoJSON render, FPS, and heap memory under MapLibre GL JS.
// Results populate perf-baseline.json — the post-migration performance contract.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";
import { useHardwareGl } from "./helpers/launch-options.js";
import { injectWebVitals, readWebVitals } from "./helpers/web-vitals.js";
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

// Sprint 3 — runtime regression gate. ON under software GL (the CI/WSL default),
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
                const map = window.GeoLeaf.Core.getMap().getNativeMap();

                for (let iter = 0; iter < ITERATIONS; iter++) {
                    // Generate random points within map bounds
                    const bounds = map.getBounds();
                    const west = bounds.getWest(),
                        east = bounds.getEast();
                    const south = bounds.getSouth(),
                        north = bounds.getNorth();
                    const features = [];
                    for (let i = 0; i < n; i++) {
                        features.push({
                            type: "Feature",
                            geometry: {
                                type: "Point",
                                coordinates: [
                                    west + Math.random() * (east - west),
                                    south + Math.random() * (north - south),
                                ],
                            },
                            properties: { id: i, name: "Pt " + i },
                        });
                    }
                    const geojson = { type: "FeatureCollection", features };

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
                const clusterFeatures = [];
                for (let i = 0; i < n; i++) {
                    clusterFeatures.push({
                        type: "Feature",
                        geometry: {
                            type: "Point",
                            coordinates: [
                                west + Math.random() * (east - west),
                                south + Math.random() * (north - south),
                            ],
                        },
                        properties: { id: i },
                    });
                }
                map.addSource(clusterSrcId, {
                    type: "geojson",
                    data: { type: "FeatureCollection", features: clusterFeatures },
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
                // --- Recensement du clustering — l'ORACLE, relevé AVANT la mesure de FPS ---
                // B-217. Ce bloc remplace un littéral : la spec renvoyait `hasClustering: true`
                // en dur et l'imprimait comme si c'était une mesure. Le mot « clustered » qui
                // qualifie le FPS ci-dessous n'était donc adossé à rien.
                //
                // Le relevé se fait au zoom de CRÉATION de la source, jamais après la mesure :
                // `measureFpsDuringZoom()` zoome de +2, et à 100 points ce zoom défait le
                // groupement (mesuré par scripts/probe-cluster-oracle.mjs : 30 clusters à
                // z4,23 → 0 à z6,23). Lire après rendrait l'oracle faux sur le plus petit cas.
                //
                // La boucle attend que la source soit CHARGÉE, pas que des clusters
                // apparaissent : sortir au premier cluster vu rendrait un relevé PARTIEL
                // (quelques tuiles), et le rapport « points groupés / features rendues »
                // asserté plus bas s'effondrerait sur du code sain. Elle rend son dernier
                // relevé si la source ne se stabilise pas — une source dont le clustering
                // est cassé ne peut pas devenir verte en attendant.
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

            // ─── B-217 — ce qui est asserté ici, et pourquoi ce n'est PLUS le FPS ───────
            //
            // Les FPS absolus ne sont pas gatés : sous GL logiciel/virtualisé (WSLg/CI) ils ne
            // sont pas représentatifs (finding Sprint 2 de la roadmap perf). Jusqu'au 10/08/2026
            // un invariant DIRECTIONNEL les gatait quand même — `clustered ≥ plain − 5 fps` —
            // au motif qu'une régression de clustering donnerait `clustered << plain`.
            //
            // 🛑 CET INVARIANT NE POUVAIT PAS TENIR CETTE PROMESSE, et trois raisons
            // INDÉPENDANTES suffisent chacune. Mesuré sur 5 runs (même code, même déployé,
            // même cible nginx), dont 3 machine au repos :
            //
            //  ① Il décidait sur du bruit. L'étendue de la marge `clustered − (plain − 5)` est
            //     de 52 fps à 100 marqueurs, 46 à 1k, 32 à 5k, 31 à 10k — pour un seuil de 5.
            //     Le seuil vaut UN DIXIÈME du bruit de la grandeur qu'il tranche. Les deux
            //     termes varient d'un facteur ~2 à ~2,8 d'un run à l'autre, et la marge étant
            //     leur DIFFÉRENCE, elle cumule les deux bruits. Le seul rouge connu (10/08,
            //     11:34 vs 14:58) est un tirage, pas un événement produit.
            //  ② Il était creux là où le clustering compte. À 5k et 10k, `plain` vaut 1 fps
            //     dans 5 runs sur 5 (le chemin DOM s'écroule), donc `clustered ≥ plain − 5`
            //     est vrai quoi qu'il arrive. Il n'avait de mordant qu'à 100 et 1k — c'est-à-dire
            //     exactement là où le clustering ne sert à rien.
            //  ③ Il comparait deux chemins de rendu ÉTRANGERS l'un à l'autre : `plain` empile
            //     des marqueurs DOM (`maplibregl.Marker`), `clustered` pose une source GeoJSON
            //     et deux couches GL `circle`. « plain ≈ clustered » n'était pas une propriété
            //     du produit, mais une coïncidence de régimes — que la mesure a défaite.
            //
            // ⚠️ ET SURTOUT : ce test ne touche PAS le clustering de GeoLeaf. Il appelle
            // `map.addSource(..., { cluster: true })` directement sur la carte native. Un rouge
            // ici aurait mis en cause MapLibre, jamais GeoLeaf. Le clustering PRODUIT — profil →
            // `getClusteringStrategy` → source native clusterisée — est gardé déterministiquement
            // par `e2e/cfg-c4-layers.spec.js` (« une source GeoJSON native est clusterisée ») et
            // par `packages/core/__tests__/capabilities/cluster/`.
            //
            // CE QUI EST ASSERTÉ À LA PLACE — déterministe, indépendant du GL, et portant sur ce
            // que ce test CONSTRUIT vraiment : la source qu'il vient d'ajouter a bien clusterisé.
            // Deux assertions, parce qu'UNE SEULE a été VUE LAISSER PASSER une vraie panne.
            // Mesures faites au zoom du test (4,23), `clusters` / `points groupés` / `rendues` :
            //
            //   mutation                       | 100          | 1k             | 5k              | 10k
            //   -------------------------------|--------------|----------------|-----------------|------------------
            //   aucune (sain)                  | 30 / 76 / 98 | 196/1189/278   | 335/6871/355    | 361/14167/374
            //   `cluster: false`               |  0 /  0 /215 |   0/   0/2204  |   0/   0/10924  |   0/    0/21737
            //   `clusterMaxZoom: 2` (dissous)  | 15 / 52 /107 |  30/ 456/930   |  32/2178/4620   |  33/ 4727/9152
            //
            //  (A) ≥ 1 cluster. Sépare la panne TOTALE — `cluster: false` rend 0 sur les quatre
            //      cas. ⚠️ Mais elle est CREUSE pour le clustering DISSOUS : à `clusterMaxZoom: 2`
            //      il reste 15 à 33 clusters, et cette assertion seule reste verte 4 fois sur 4.
            //  (B) points groupés > features rendues — « le clustering COMPRESSE ». Sain : 4,3× à
            //      37,9×. Dissous : 0,47× à 0,52×. Un facteur ~9 sépare les deux régimes, sans
            //      constante arbitraire : le seuil est le point où la compression cesse.
            //      ⚠️ (B) ne vaut que pour n ≥ 1000, et c'est MESURÉ, pas concédé : à 100 points
            //      étalés sur la fenêtre, un clustering sain groupe 76 points en 30 clusters pour
            //      98 features rendues — il ne compresse pas, légitimement. Asserter (B) à 100
            //      rougirait sur du code sain. Le cas 100 ne porte donc que (A), et il est le seul
            //      des quatre à ne pas voir la dissolution.
            //
            // 🛑 CE QUE CE CHOIX REND INCAPABLE DE VOIR, et rien ici ne le verra :
            //   · le COÛT de rendu du clustering — un clustering qui groupe correctement mais
            //     devient lent reste invisible. Sous GL logiciel il l'était déjà : l'effet serait
            //     noyé dans une bande de bruit de 30 à 50 fps. Il se verrait sur GL matériel, par
            //     une capture (`npm run perf:capture`, E2E_HW_GL=1) comparée à un baseline capturé
            //     sur le même hôte — jamais par un run WSL/CI ;
            //   · la dissolution du clustering AU CAS 100 — assertion (A) seule, cf. ci-dessus ;
            //   · un `clusterRadius` réduit qui grouperait toujours, mais moins bien, tant que la
            //     compression reste > 1 ;
            //   · et, redite mais essentielle : TOUTE régression du clustering de GEOLEAF, ce
            //     test n'appelant que MapLibre. C'est `cfg-c4-layers.spec.js` qui la voit.
            // Ces angles morts sont NOMMÉS plutôt que couverts par une assertion qu'on ne pourrait
            // pas voir rougir.
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
// 🛑 B-218 (10/08/2026) — CE BLOC A MESURÉ LE HEAP AMBIANT DE LA PAGE, PAS LES FEATURES.
// Il lisait `performance.memory.usedJSHeapSize` avant et après l'ajout, et rendait
// `delta = 0` dans les SIX runs connus. Ce n'était pas un hasard : sans
// `--enable-precise-memory-info`, Chrome quantifie cette valeur ET la fige pour la durée
// de la page — mesuré sur 10 pages fraîches, delta nul à N = 0, 10 000 ET 30 000. Le
// plafond `committé × 1,5` tranchait donc le heap ambiant, dont la dispersion mesurée
// (24,8 → 45,2 Mo, ×1,8) le débordait : un rouge attendu par construction, sans aucune
// régression produit. Même famille que B-217 — un seuil dans la bande de bruit — avec
// ceci en plus : la métrique elle-même ne variait pas avec son objet, donc élargir le
// plafond n'aurait rien réparé.
//
// CE QUI LE REMPLACE, et pourquoi ce n'est pas un réglage :
//   1. L'INSTRUMENT change. CDP `Runtime.getHeapUsage` après `HeapProfiler.collectGarbage`
//      des deux côtés → on mesure ce qui est RETENU, pas ce qui a été alloué. Mesuré :
//      1,54–1,57 Mo pour 10k features (5 pages fraîches, étendue 0,03), 0,09–0,15 Mo à
//      N = 0, 4,12 Mo à N = 30 000. La grandeur suit sa dose ; c'est la condition qui
//      manquait, et sans elle tout seuil est décoratif.
//      ⚠️ Le GC forcé n'est pas un raffinement : sans lui, le delta brut mesuré était
//      NÉGATIF (−3,8 Mo à 10k), un GC tombant entre les deux lectures. Changer d'outil
//      sans changer de protocole n'aurait pas suffi.
//   2. LE GESTE change. L'ajout passe par `adapter.addGeoJSONLayer` — l'API GeoLeaf —
//      et non plus par `map.addSource` natif. L'ancien ne touchait aucun code GeoLeaf :
//      une régression y aurait mis en cause MapLibre (c'est le 4ᵉ fait de B-217, retrouvé
//      ici). Écart mesuré entre les deux chemins : +0,06 Mo, le registre de couches.
//   3. LA BANDE ne lit plus le baseline. `perf-baseline.json` porte un heap ambiant
//      capturé le 26/06 avec l'instrument retiré : il ne peut pas servir de contrat à
//      l'instrument neuf, et le recapturer sous GL logiciel est interdit. La bande est
//      absolue et vit dans `helpers/perf-gate.js` avec la table qui la justifie.
//   4. UN PLANCHER apparaît, et c'est l'assertion que B-218 réclamait : un delta nul
//      ROUGIT désormais au lieu de passer en silence.
//
// ⛔ CE QUE CE GATE NE VOIT TOUJOURS PAS — nommé, pas couvert :
//   - Le heap du WORKER. `Runtime.getHeapUsage` ne voit que l'isolat de la page ; MapLibre
//     tuile le GeoJSON dans un worker. Mesure à l'appui : sous `--enable-precise-memory-info`,
//     `performance.memory` (à l'échelle du processus) rend ~2× le delta CDP — 2,99 contre
//     1,49 Mo à 10k, 9,07 contre 4,03 à 30k. Une régression côté worker est invisible ici.
//   - Les FUITES. Ce test n'enlève jamais la couche ; il mesure un coût, pas une rétention
//     après teardown. Domicile prévu : 6.2.6 — qui est lui-même aveugle, voir sa note.
//   - L'EMPREINTE DE BOOT de GeoLeaf. La lecture « avant » est remarquablement stable
//     (15,65–15,79 Mo sur 10 pages fraîches, ±0,5 %) mais n'est PAS assertée : la garde ne
//     lit que la différence. Un doublement du heap retenu au boot passerait.
//   - Le coût mémoire NON-JS (buffers GPU, textures) — hors de portée de toute métrique de
//     heap JS, sous n'importe quel instrument.

const HEAP_FEATURES = 10_000;

/** Heap retenu (octets) : GC forcé (×2, V8 collecte en plusieurs passes) puis lecture. */
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

        // CDP : disponible sans condition ici. ⚠️ Le motif a changé le 14/08/2026 — ce
        // n'est plus « la config n'a qu'un projet » (elle en a deux depuis `chromium-touch`),
        // c'est que **les deux projets sont Chromium**, seul canal de ce dépôt. Sur un projet
        // non-Chromium ceci jetterait, et c'est le bon comportement : un gate mémoire qui se
        // saute en silence est le défaut soldé ici.
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
            const features = [];
            for (let i = 0; i < n; i++) {
                features.push({
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [
                            west + Math.random() * (east - west),
                            south + Math.random() * (north - south),
                        ],
                    },
                    properties: { id: i, name: "Pt " + i, category: "test" },
                });
            }
            adapter.addGeoJSONLayer("_perf_mem_" + Date.now(), {
                type: "FeatureCollection",
                features,
            });
        }, HEAP_FEATURES);

        await page.waitForTimeout(1000);
        const afterBytes = await retainedHeapBytes(client, page);
        const pmAfter = await page.evaluate(() =>
            performance.memory ? performance.memory.usedJSHeapSize : null
        );

        const mb = (b) => Math.round((b / (1024 * 1024)) * 100) / 100;
        const deltaMb = mb(afterBytes - beforeBytes);
        // Les deux instruments sont journalisés côte à côte À DESSEIN : la colonne
        // `perf.memory` imprime le symptôme de B-218 (un delta nul) à chaque run, ce qui
        // rend le fait re-lisible sans relire le registre.
        console.log(
            `[perf] Heap (CDP, retenu): before=${mb(beforeBytes)}MB, after 10K=${mb(afterBytes)}MB, delta=${deltaMb}MB` +
                (pmBefore !== null && pmAfter !== null
                    ? ` | perf.memory delta=${mb(pmAfter - pmBefore)}MB (figé — cf. B-218)`
                    : " | perf.memory indisponible")
        );

        // Enregistrement, PAS contrat : plus aucune garde ne lit ce bloc (la bande est dans
        // perf-gate.js). Il documente l'environnement d'une capture pour un lecteur humain
        // et ne peut pas fossiliser — chaque `npm run perf:capture` le réécrit. Le
        // `after10kFeatures_mb: 29,6` encore commité décrit l'instrument RETIRÉ ; il n'est
        // pas édité à la main ici, il sera remplacé par la prochaine capture.
        const baseline = readBaseline();
        baseline.runtime.memory = {
            heapBefore_mb: mb(beforeBytes),
            heapAfter10k_mb: mb(afterBytes),
            heapDelta10k_mb: deltaMb,
            _instrument: "CDP Runtime.getHeapUsage + HeapProfiler.collectGarbage (B-218)",
        };
        writeBaseline(baseline);

        const { floorMb, ceilMb } = heapDeltaBandMb(HEAP_FEATURES);

        // PLANCHER — asserté SANS condition, y compris sous GL matériel : il ne parle pas
        // de performance mais de l'instrument. « Le heap n'a pas bougé » ne doit plus
        // jamais être un vert. C'est B-218 en une ligne.
        expect(
            deltaMb,
            `la mesure de heap ne voit pas les ${HEAP_FEATURES} features : delta=${deltaMb}MB < ${floorMb}MB. ` +
                "Instrument creux (cf. B-218) ou ajout sans effet — ne PAS abaisser ce plancher pour faire verdir."
        ).toBeGreaterThanOrEqual(floorMb);

        // PLAFOND — gate de régression, sous le régime du fichier (GL logiciel).
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
// 🛑 B-219 (10/08/2026) — CE BLOC ÉTAIT VERT PAR CONSTRUCTION, ET SA CAUSE ÉTAIT DANS
// LE PRODUIT, PAS DANS LE TEST. Il assertait `status !== "critical"` sur le verdict de
// `GeoLeaf.Utils.PerformanceProfiler.analyzeMemoryLeaks()` — une API PUBLIQUE — qui
// consomme `getMemoryUsage()`, qui lit `performance.memory.usedJSHeapSize`. Chrome
// QUANTIFIE cette valeur et la FIGE pour la durée de la page hors
// `--enable-precise-memory-info` : les ~17 échantillons d'un run étaient donc
// rigoureusement égaux, `growthRate` valait exactement 0, et `warning`/`critical`
// étaient INATTEIGNABLES. Mesuré 8 runs sur 8, et 14 pages fraîches de sonde avec la
// colonne « distincts » à 1 sans exception.
//
// 🔥 LE FAIT QUI A TRANCHÉ, et il ne se déduit pas du code : sur une page qui RETIENT
// 9,0 à 9,2 Mo de fuite délibérée (les collections restent référencées), l'API rendait
//     {"status":"normal","growthRate":0,"memoryTrend":"decreasing",
//      "recommendation":"No action needed"}
// « No action needed » sur une fuite de 9 Mo, mesurée 4 fois. Le défaut n'était donc
// pas d'abord de test : un intégrateur qui appelle cette API pour surveiller son
// application reçoit « aucune fuite » quoi qu'il arrive.
//
// CE QUI LE REMPLACE — deux gardes distinctes, sur deux objets distincts :
//   1. L'HONNÊTETÉ DU PRODUIT. `analyzeMemoryLeaks()` rend désormais
//      `unavailable`/`heap-readings-constant` quand tous ses échantillons sont égaux à
//      l'octet — un fait arithmétique sur sa fenêtre, sans tolérance à régler. Ce test
//      l'asserte, et c'est l'assertion qui rougit si le correctif est reverté.
//   2. UNE VRAIE GARDE DE FUITE, par CDP. Le heap RETENU (`Runtime.getHeapUsage` après
//      `HeapProfiler.collectGarbage` ×2) est lu avant, au PIC (dernière couche encore
//      en place) et après retrait. C'est le trou que B-218 nommait explicitement :
//      §6.2.4 mesure un COÛT et ne retire jamais la couche, donc personne ne mesurait
//      la RÉTENTION. Table de calibration dans `helpers/perf-gate.js`.
//   3. LE GESTE passe par `adapter.addGeoJSONLayer` / `adapter.removeLayer` — l'API
//      GeoLeaf — et non plus par `map.addSource` natif. C'est le 4ᵉ fait de B-217,
//      retrouvé sur le TROISIÈME test de ce fichier : l'ancien churn ne touchait aucun
//      code GeoLeaf, donc une fuite du registre de couches y était invisible.
//
// ⛔ CE QUE CE BLOC NE VOIT TOUJOURS PAS :
//   - Le heap du WORKER (MapLibre tuile le GeoJSON hors de l'isolat de la page).
//   - Une fuite de moins de ~4 Mo sur 14 cycles, soit environ 4 collections sur 14. Le
//     plafond attrape un ordre de grandeur, pas une dérive lente — et il n'est PAS
//     resserrable à volonté : la dispersion saine mesurée par ce spec lui-même va de
//     −0,12 à +1,22 Mo sur 11 runs, quatre fois plus large que celle de la sonde.
//   - Le fait que l'API produit reste, chez l'intégrateur, INCAPABLE DE MESURER : elle
//     ne ment plus, elle dit « je ne sais pas ». C'est CDP, hors du produit, qui mesure
//     ici — et CDP n'est pas disponible chez l'intégrateur.

const CHURN_CYCLES = 14; // ≥10 échantillons pour analyzeMemoryLeaks ; dose de la bande

test.describe("6.2.6 — Memory leak detection", () => {
    test.use({ baseURL: baseURL("core") });

    test("no abnormal heap growth over add/remove churn (profiler)", async ({ page }) => {
        test.setTimeout(90_000);
        await waitForMap(page);

        // CDP : disponible sans condition ici (un seul projet, `chromium`). Un gate de
        // fuite qui se saute en silence est exactement le défaut soldé par B-218.
        const client = await page.context().newCDPSession(page);
        const beforeBytes = await retainedHeapBytes(client, page);

        // PHASE 1 — les cycles add→remove, puis un DERNIER ajout laissé EN PLACE : c'est
        // lui que la lecture de PIC doit voir. Sans ce point de mesure, une rétention
        // nulle serait indiscernable d'un churn qui n'a rien fait — la leçon de plancher
        // de B-218, transposée à une grandeur qui, elle, doit valoir zéro quand tout va bien.
        await page.evaluate(async (cycles) => {
            const adapter = window.GeoLeaf.Core.getMap();
            const bounds = adapter.getNativeMap().getBounds();
            const west = bounds.getWest(),
                east = bounds.getEast();
            const south = bounds.getSouth(),
                north = bounds.getNorth();
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const collection = () => {
                const features = [];
                for (let i = 0; i < 10000; i++) {
                    features.push({
                        type: "Feature",
                        geometry: {
                            type: "Point",
                            coordinates: [
                                west + Math.random() * (east - west),
                                south + Math.random() * (north - south),
                            ],
                        },
                        properties: { id: i },
                    });
                }
                return { type: "FeatureCollection", features };
            };

            // Fast-interval instance — startMonitoring() forces collection regardless of
            // dev-mode; samples land in the shared module-level performanceData singleton.
            window.__leakProfiler = new window.GeoLeaf.Utils.PerformanceProfiler({
                monitoring: { enabled: true, interval: 200, maxDataPoints: 60 },
            });
            window.__leakProfiler.startMonitoring();

            // Témoin DIRECT de l'entrée du profiler, relevé à la même source que lui :
            // combien de valeurs DISTINCTES `performance.memory` rend-il sur la durée du
            // churn ? C'est ce compteur qui autorise — ou non — à croire un verdict.
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

        // PHASE 2 — retrait de la couche tenue, puis verdict du produit.
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

        // ── (1) L'HONNÊTETÉ DU VERDICT PRODUIT ────────────────────────────────────
        // Vocabulaire fermé : un statut inconnu est une régression de contrat, pas un
        // détail de rédaction.
        expect(
            ["insufficient_data", "unavailable", "normal", "warning", "critical"],
            `statut hors vocabulaire : ${JSON.stringify(analysis)}`
        ).toContain(analysis.status);

        // La condition est MESURÉE dans ce run, pas supposée : si l'entrée du profiler
        // n'a pas varié d'un octet, aucun verdict de croissance n'est calculable, et
        // l'API doit le DIRE. Sur cet environnement `_distinct` vaut 1 (mesuré sur 14
        // pages fraîches) ; si Chrome cesse un jour de figer `performance.memory`, la
        // branche ne s'applique plus au lieu de rougir à tort — et le log ci-dessus le
        // rend lisible.
        if (analysis._samples > 0 && analysis._distinct <= 1) {
            expect(
                analysis.status,
                `l'entrée du profiler n'a rendu qu'UNE valeur sur ${analysis._samples} relevés : ` +
                    "aucun verdict de croissance n'est calculable dessus. Un « normal » ici est le " +
                    "défaut B-219 — une fuite mesurée à 15,1 Mo par CDP recevait « No action needed »."
            ).toBe("unavailable");
            expect(["heap-readings-constant", "heap-api-unavailable"]).toContain(analysis.reason);
            expect(
                analysis.growthRate,
                "aucun chiffre de croissance ne doit être publié quand il n'y en a pas"
            ).toBeUndefined();
        }

        // F-TOOL-4 gate, INCHANGÉ : un verdict « critical » fait échouer le run.
        expect(analysis.status, `memory leak detected: ${JSON.stringify(analysis)}`).not.toBe(
            "critical"
        );

        // ── (2) LA GARDE DE FUITE, par CDP ────────────────────────────────────────
        const { peakFloorMb, retentionCeilMb } = heapRetentionBandMb(CHURN_CYCLES);

        // PLANCHER anti-creux — asserté SANS condition, y compris sous GL matériel : il
        // ne parle pas de performance mais de l'instrument et du geste. Si la couche
        // tenue ne pèse rien, la rétention nulle mesurée juste après ne prouve rien.
        expect(
            peakMb,
            `le churn est invisible à l'instrument : pic=${peakMb}MB < ${peakFloorMb}MB. ` +
                "Instrument creux ou ajout sans effet — ne PAS abaisser ce plancher pour faire verdir."
        ).toBeGreaterThanOrEqual(peakFloorMb);

        // PLAFOND de rétention — la garde de fuite proprement dite, sous le régime du
        // fichier (GL logiciel).
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
// with `transformStyle` (option de `setStyle` depuis la v5), qui préserve les sources/couches GeoLeaf
// natively. There is no `geoleaf:basemap-rebuild` measure to record anymore, so
// the F-RENDER-1 spike is moot and the block was removed.
