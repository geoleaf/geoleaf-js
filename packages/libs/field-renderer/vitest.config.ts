/**
 * Vitest configuration
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf/field-renderer",
    // `src/helpers.ts` left the exclusion list at PLUGINS S2: `_el()` went from
    // 0 call sites in `src/types/` to 221, so the file is now core code, not an
    // unused export.
    // 🛑 `src/lang/**` excluded on 05/08/2026 — an ASYMMETRY HAD BEEN
    // INTRODUCED INTO ITS OWN MEASURING INSTRUMENT. `src/lang/` was created (7
    // files: a barrel + 6 translation catalogues); `editor/vitest.config.ts`
    // has always excluded `src/lang/**` from its coverage, this one did not.
    // The 7 files were thus counted, ALL AT 100% on all four metrics (checked
    // in `coverage/lcov.info` — a catalogue is an object literal: loading it
    // covers it entirely), inflating the aggregate with no test written. A
    // threshold ratcheted on a denominator enriched with free data measures
    // less than it looks. The corollary "the preflight carries the blindness
    // it measures", applied to a gate — and it had to be fixed BEFORE
    // re-ratcheting, not after.
    coverageExclude: ["src/index.ts", "src/__tests__/**", "src/lang/**"],
    setupFiles: ["./src/__tests__/canvas-setup.ts"],
    // Recalibrated on 23/07/2026 — UPWARD.
    //
    // A drop was anticipated: merging 6 `formRender`s into one factory
    // removes well-covered functions from the denominator, which can sink the
    // ratio with no test lost. Measured, it is the opposite — the refactor
    // also removed the UNcovered copies, and the two extracted modules
    // (`types/field-base.ts`, `types/field-media.ts`) sit at 100% on all four metrics.
    //
    //            before  →  after  (threshold set here)
    //   stmts      83,98        84,37        82
    //   branches   59,68        62,02        60
    //   functions  74,25        78,54        76
    //   lines      87,41        87,50        85
    //
    // ⚠️ istanbul's `text` report does NOT display files at 100%:
    // `field-base.ts`, `field-media.ts`, `helpers.ts`, `validators.ts` and
    // `registry.ts` are absent from the table while being measured and
    // counted in the totals. Read `coverage/lcov.info` before concluding a
    // measurement hole.
    //
    // ── Re-ratcheted on 24/07/2026 ────────────────────────────────────────────
    //
    // The debt contracted earlier — thresholds lowered to the measure to
    // unblock CI, target announced at 75 branches — is settled. Five test
    // files added (`sanitize`, `types-gallery`, `types-dropdown`,
    // `types-image`, `types-contact`, `types-list`), 307 → 528 tests:
    //
    //            before  →  after  (threshold set here)
    //   stmts      84,37        93,95         92
    //   branches   62,02        76,49         74
    //   functions  78,54        92,22         90
    //   lines      87,50        95,99         94
    //
    // The deposit was concentrated and stayed so: `gallery` 41.18 → 97.05
    // branches, `dropdown` 40 → 93.33, `image` 46.87 → 87.5 (functions 31.25
    // → 100), `list` 46.15 → 96.15, `sanitize` 45 → 95. What stays under 60 —
    // `metric`, `link`, `table`, `badge`, `price`, `rating`, `reviews`,
    // `hours` — is the next step, not a regression.
    //
    // ⚠️ Ratchet up, NEVER down. ~2 pts margin under the measure: it protects
    // against turbo's parallel load, not noise (nil under istanbul).
    // branches ratcheted 74 → 76: `types-rating.test.ts` takes `rating.ts` 59 → 98% (package 78.6%).
    thresholds: { branches: 76, functions: 90, lines: 94, statements: 92 },
});
