// @ts-check
// Runtime regression gate: tolerances + comparison helpers.
//
// Companion to perf-baseline.json. Defines how far a live e2e capture may drift
// from the committed baseline before the run fails.
//
// The gate is keyed on GL COMPARABILITY, and on nothing else:
//   - gate ON  (software GL, the CI/WSL default) — measurements are comparable to the
//              committed contract, so they are asserted.
//   - gate OFF (E2E_HW_GL=1) — the host's real GL; absolute values are not comparable
//              to a contract captured elsewhere, so nothing is asserted.
//
// ⚠️ T6.4 — WRITING the baseline is a THIRD, INDEPENDENT switch: PERF_BASELINE_WRITE=1
// (which requires E2E_HW_GL=1). This header used to describe a BIMODAL contract —
// "capture mode (E2E_HW_GL=1) → spec writes the baseline" — and that description was
// the defect, not just a wording issue: one variable carried both the GL choice and
// write permission, so a plain `npm run test:e2e` on a GPU host dirtied a git-tracked
// file (incident b3d85253). The two are now separate; see the header of
// e2e/06-performance-baseline.spec.js for the truth table.
//
// Only GL-INDEPENDENT metrics gate: geojsonRender (addSource/addLayer JS timing)
// and JS heap. ⚠️ Since 2026-08-10, "JS heap" means the RETAINED DELTA read via
// CDP (`Runtime.getHeapUsage` + `HeapProfiler.collectGarbage`), and no longer
// `performance.memory` — which Chrome quantises and freezes for the page's
// lifetime, hence unable to see 10,000 features. The measured detail sits at the
// `heapDelta` block below.
// FPS captured under virtualized/software GL (WSLg/CI) are NON representative
// (measured under software GL) — and since 2026-08-10 they are not gated AT
// ALL, not even directionally: the `clustered` vs `plain` comparison judged at
// 5 fps a quantity whose measured noise runs from 31 to 52 fps, and it compared
// two unrelated render paths (DOM markers vs GL layers). What the spec asserts
// in their place is a deterministic clustering oracle, and the full motive —
// with what it leaves invisible — lives in the spec, at the assertion.
// initTime is network-inclusive on the local http-server (spread 1.6–3.3 s), so it
// keeps an absolute soft ceiling rather than a baseline-relative gate.

/**
 * Tolerance configuration. Generous factors + absolute floors keep the gate
 * anti-flake against sub-millisecond render timings and heap-sampling jitter.
 */
const TOLERANCES = {
    // geojsonRender[label].avg_ms — ceiling = max(committed.max * factor, floorMs).
    // floorMs absorbs the sub-ms noise where a pure ratio is meaningless (~0.2 ms).
    geojsonRender: { factor: 3, floorMs: 5 },
    // RETAINED memory cost of 10,000 features — absolute band, NO baseline.
    //
    // ⚠️ This block was `memory: { factor: 1.5 }` — a `committed × 1.5` ceiling
    // set on `memory.after10kFeatures_mb` — until 2026-08-10, and it guarded the
    // VOID: the quantity it judged was `performance.memory.usedJSHeapSize`,
    // which Chrome renders quantised AND frozen for the page's lifetime (without
    // `--enable-precise-memory-info`). Measured: `delta = 0` in 6 consecutive
    // runs, then in 10 fresh probe pages, at N = 0, 10,000 AND 30,000 features.
    // The test thus asserted not the features' cost but the page's AMBIENT
    // heap, whose dispersion (24.8 → 45.2 MB, ×1.8) overflowed the tolerated
    // ×1.5: a red by construction, with no product regression.
    //
    // Its replacement bears on the RETAINED DELTA, read via CDP
    // `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage` on both sides.
    // Table from the probe `scripts/probe-heap-metrics.mjs`, fresh pages, nginx
    // target, software GL:
    //
    //     N = 10,000 (GeoLeaf API) : 1.54 · 1.55 · 1.55 · 1.56 · 1.57 MB → spread 0.03
    //     N = 10,000 (native)      : 1.48 · 1.50 MB
    //     N = 0      (control)     : 0.09 · 0.15 MB
    //     N = 30,000               : 4.12 MB          (the quantity follows its dose)
    //     and by the spec itself   : 1.51 · 1.54 · 1.54 MB (3 runs, incl. the full 06 suite)
    //     → 8 healthy readings in all: 1.51 → 1.57 MB, spread 0.06 (±2%).
    //
    // - `floorMb` is the ANTI-HOLLOW assertion, and it is the frozen
    //   instrument's lesson: a null delta must now REDDEN instead of passing.
    //   0.5 MB is the geometric centre between the control (0.15) and the
    //   signal (1.54) — ×3.3 above, ×3.1 below.
    // - `ceilMb` is NOT calibrated on the noise (it is 100× the measured
    //   spread) but on a dependency's legitimate drift: it tolerates +90% on
    //   MapLibre/V8 and catches a doubling of the per-feature cost. A red here
    //   thus reads as a REAL CHANGE as first hypothesis, not as a draw — the
    //   exact inverse of the old gate.
    //
    // 🛑 Do not widen the band to green: re-measure first with the probe
    // (`E2E_TARGET=nginx PROBE_MODE=bande node scripts/probe-heap-metrics.mjs`),
    // and only move a threshold with the table justifying it, beside it.
    heapDelta: { features: 10_000, floorMb: 0.5, ceilMb: 3 },
    // Retention AFTER add→remove churn — absolute band, NO baseline (retention).
    //
    // A DISTINCT object from `heapDelta` above, and that is the whole point:
    // `heapDelta` measures a layer's COST and never removes it; this one
    // measures what stays RETAINED once the layer is removed. The instruction
    // named this hole explicitly ("The LEAKS. This test never removes the layer
    // […] Intended home — 6.2.6 — itself blind"), and §6.2.6 indeed was: it
    // judged on `performance.memory`, which Chrome freezes for the page's
    // lifetime.
    //
    // 🛑 THE BAND IS MEASURED BY THE SPEC ITSELF, AND THAT IS A CORRECTION, NOT
    // A METHOD DETAIL. The probe and the spec do NOT render the same dispersion
    // on the same gesture and dose: healthy probe −0.07 to +0.36 MB (n=5),
    // healthy spec −0.12 to +1.22 MB (n=11) — four times wider. A band set on
    // the probe would have given a 1.5 MB ceiling, i.e. ×1.2 margin over the
    // spec's worst healthy run: the threshold inside the noise band, the fault
    // already paid twice. **Calibrate with the instrument that judges, never
    // with its neighbour.**
    //
    // Spec readings (`06-performance-baseline.spec.js` §6.2.6), nginx target,
    // software GL, dose 14 cycles, GC forced ×2 on both sides, n = 11 healthy
    // churns:
    //
    //     PEAK     1.03 · 1.09 · 1.09 · 1.12 · 1.32 · 1.36 · 1.37 · 1.48 · 1.50 · 2.21 · 2.35
    //     RETAINED −0.12 · −0.05 · 0.24 · 0.34 · 0.36 · 0.44 · 0.77 · 1.02 · 1.05 · 1.09 · 1.22
    //
    //     Deliberate LEAK (the collections stay referenced)
    //                  PEAK 15.25 · 15.36   RETAINED 13.78 · 13.85   (spec, n=2)
    //                                       RETAINED 14.81 · 15.07   (probe, n=2)
    //     control without churn   PEAK 0.03   RETAINED 0.04          (probe, n=1)
    //
    // - `peakFloorMb` is the ANTI-HOLLOW assertion. It CANNOT bear on
    //   retention — a HEALTHY retention is zero, and sometimes even less
    //   (−0.12 measured) —, so it bears on the PEAK: if the held layer weighs
    //   nothing, the null retention that follows proves nothing. 0.2 MB is the
    //   geometric centre between the no-churn control (0.03) and the weakest
    //   healthy peak (1.03): ×6.7 above, ×5.2 below.
    // - `retentionCeilMb` = 4 MB, geometric centre between the worst healthy
    //   reading (1.22) and the smallest measured leak (13.78): ×3.3 above one,
    //   ×3.4 below the other. It catches a leak of about 4 collections out of
    //   14 — no finer drift, and that is named in the spec.
    //
    // 🛑 Do not widen the band to green: re-measure first, and with the SPEC
    // (`E2E_TARGET=nginx npx playwright test e2e/06-performance-baseline.spec.js -g "Memory leak"`,
    // several times), the probe serving only to produce the scenarios the spec
    // does not play (deliberate leak, no-churn control). Only move a threshold
    // with the table justifying it, beside it.
    heapRetention: { cycles: 14, peakFloorMb: 0.2, retentionCeilMb: 4 },
    // initTime.avg — absolute soft ceiling (ms). Network-inclusive on local
    // http-server, NOT baseline-relative. Catches only gross regressions.
    initTimeCeilingMs: 10_000,
    // ⚠️ NO FPS tolerance here, and that is a motivated REMOVAL (2026-08-10).
    // `fpsDirectionSlack: 5` carried the invariant `clustered ≥ plain − 5`.
    // Measured over 5 runs: the spread of the margin it judged runs from 31 to
    // 52 fps depending on the case — the threshold was worth a tenth of the
    // noise. Do not reintroduce it, under any value: widening it would hollow
    // the assertion in four cases instead of two, narrowing it would redden it
    // at random. The full reasoning and what it leaves invisible are in the
    // clustering block of e2e/06-performance-baseline.spec.js.
};

/**
 * True only when the committed baseline is a real captured contract we may gate
 * against. A fresh / empty / pending baseline must never fail the run.
 * @param {{ runtime?: { _status?: string } }} baseline
 */
function baselineIsCaptured(baseline) {
    return !!(baseline && baseline.runtime && baseline.runtime._status === "captured");
}

/**
 * geojsonRender ceiling (ms) for a committed baseline entry, or null when the
 * baseline lacks a usable value (→ caller skips the gate).
 * @param {{ max?: number } | undefined} committedEntry
 * @returns {number | null}
 */
function geojsonCeilingMs(committedEntry) {
    if (!committedEntry || typeof committedEntry.max !== "number") return null;
    return Math.max(
        committedEntry.max * TOLERANCES.geojsonRender.factor,
        TOLERANCES.geojsonRender.floorMs
    );
}

/**
 * Band (MB) of the RETAINED heap delta for `featureCount` features —
 * anti-hollow floor and regression ceiling. Reads NO baseline: the band is
 * absolute, measured, and lives in TOLERANCES with its table.
 *
 * ⚠️ Throws if the caller changes the dose: the band was measured at 10,000
 * features and the relation is not proportional (≈ 0.1 MB fixed cost). A
 * threshold silently surviving a change of its object is exactly the defect
 * the floor settles; the error points to the probe that knows how to
 * re-measure.
 *
 * @param {number} featureCount
 * @returns {{ floorMb: number, ceilMb: number }}
 */
function heapDeltaBandMb(featureCount) {
    const { features, floorMb, ceilMb } = TOLERANCES.heapDelta;
    if (featureCount !== features) {
        throw new Error(
            `[perf-gate] bande de heap mesurée pour ${features} features, appelée avec ${featureCount}. ` +
                "Re-mesurer avant de la réutiliser : " +
                "E2E_TARGET=nginx PROBE_MODE=bande node scripts/probe-heap-metrics.mjs"
        );
    }
    return { floorMb, ceilMb };
}

/**
 * Band (MB) of the RETENTION after `cycles` add→remove cycles of 10,000
 * features — anti-hollow floor on the PEAK, leak ceiling on what stays
 * RETAINED after removal. Reads NO baseline: the band is absolute, measured,
 * and lives in TOLERANCES with its table.
 *
 * ⚠️ Throws if the caller changes the dose: the measured deliberate leak grows
 * with the cycle count (9.1 MB at 8 cycles, 15.0 MB at 14), so a ceiling
 * measured at one dose says nothing at another. A threshold silently surviving
 * a change of its object is the defect the floor settles; the error points to
 * the probe that knows how to re-measure.
 *
 * @param {number} cycles
 * @returns {{ peakFloorMb: number, retentionCeilMb: number }}
 */
function heapRetentionBandMb(cycles) {
    const { cycles: mesuree, peakFloorMb, retentionCeilMb } = TOLERANCES.heapRetention;
    if (cycles !== mesuree) {
        throw new Error(
            `[perf-gate] bande de rétention mesurée pour ${mesuree} cycles, appelée avec ${cycles}. ` +
                "Re-mesurer avant de la réutiliser : " +
                `E2E_TARGET=nginx PROBE_MODE=fuite PROBE_CYCLES=${cycles} node scripts/probe-heap-metrics.mjs`
        );
    }
    return { peakFloorMb, retentionCeilMb };
}

export { TOLERANCES, baselineIsCaptured, geojsonCeilingMs, heapDeltaBandMb, heapRetentionBandMb };
