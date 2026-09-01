/**
 * Vitest configuration
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/editor",
    coverageExclude: [
        "src/entry.ts",
        "src/lang/**",
        "src/public-api.ts",
        "src/internal.ts",
        "src/__tests__/**",
        // PLUGINS S1 — the two S3 entries that stood here are gone. `touch-drag.ts` moved
        // to @geoleaf/host-runtime, which carries the exclusion (and its motive) now.
        // `tooltips.ts` never existed: it matched no file in any commit, so it excluded
        // nothing — the tooltip code lived inside floating-menu.ts and was always measured.
    ],
    setupFiles: ["./src/__tests__/canvas-setup.ts", "./src/__tests__/setup.ts"],
    // branches ratcheted 70 → 77: `layer-picker-branches.test.ts` takes `layer-picker.ts` 59 → 94% (package 79.2%).
    //
    // ── Re-ratcheted on 05/08/2026 ────────────────────────────────
    //
    // The `addpoi` merge brought 6 suites and ~120 tests into this package with
    // the thresholds unmoved: three of them sat at the FLOOR inherited from the
    // common factory (`build-config/vitest/base.mjs`, 75/75/75/75), i.e.
    // they no longer guarded anything of what the package really does.
    //
    //   ⚠️ The roadmap line announced "inherit the thresholds from both sides"
    //   (addpoi 82/81/80 vs editor 75/77) — MOOT: there is only one package
    //   left. There was nothing to reconcile, there was ratcheting to do.
    //
    //            before merge  →  after the batches   (threshold set here)
    //   stmts        75              93,43                91
    //   branches     77              82,42                80
    //   functions    75              89,72                87
    //   lines        75              95,51                93
    //
    // ⚠️ ~2 pts margin under the measure, like `field-renderer`: it protects
    // against turbo's parallel load, not noise (nil under istanbul). Ratchet
    // up, NEVER down.
    //
    // What stays under the bar and makes the next step, not a regression:
    // `terra-draw-adapter.ts` (branches 46,66), `placement-api.ts` (50/100/50/50),
    // `auto-adapter.ts` (fonctions 63,15).
    thresholds: { branches: 80, functions: 87, lines: 93, statements: 91 },
});
