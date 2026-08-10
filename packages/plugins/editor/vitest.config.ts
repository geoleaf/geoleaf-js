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
    // branches cliqueté 70 → 77 : `layer-picker-branches.test.ts` porte `layer-picker.ts` 59 → 94 % (paquet 79,2 %).
    //
    // ── Recliquetés le 05/08/2026 (Sprint 5, S5c/5.4) ─────────────────────────────────
    //
    // La fusion d'`addpoi` a fait entrer 6 suites et ~120 tests dans ce paquet sans que les
    // seuils bougent : trois d'entre eux étaient au PLANCHER hérité de la fabrique commune
    // (`build-config/vitest/base.mjs:68`, 75/75/75/75), c'est-à-dire qu'ils ne gardaient
    // plus rien de ce que le paquet fait réellement.
    //
    //   ⚠️ La ligne 5.4 de la roadmap annonçait « hériter les seuils des deux côtés »
    //   (addpoi 82/81/80 contre editor 75/77) — SANS OBJET : il n'y a plus qu'un paquet.
    //   Il n'y avait rien à réconcilier, il y avait à cliqueter.
    //
    //            avant fusion  →  après S5a+S5b+5.9  (seuil posé ici)
    //   stmts        75              93,43                91
    //   branches     77              82,42                80
    //   functions    75              89,72                87
    //   lines        75              95,51                93
    //
    // ⚠️ Marge de ~2 pts sous la mesure, comme `field-renderer` : elle protège de la charge
    // parallèle de turbo, pas du bruit (nul sous istanbul). Cliqueter vers le haut, JAMAIS
    // vers le bas.
    //
    // Ce qui reste sous la barre et fait le prochain palier, pas une régression :
    // `terra-draw-adapter.ts` (branches 46,66), `placement-api.ts` (50/100/50/50),
    // `auto-adapter.ts` (fonctions 63,15).
    thresholds: { branches: 80, functions: 87, lines: 93, statements: 91 },
});
