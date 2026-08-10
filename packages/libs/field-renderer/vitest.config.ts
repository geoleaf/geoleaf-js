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
    // 🛑 `src/lang/**` exclu le 05/08/2026 (S5c, tâche 5.4) — le Sprint 5 avait introduit
    // une ASYMÉTRIE DANS SON PROPRE INSTRUMENT DE MESURE. S5a/5.1c a créé `src/lang/`
    // (7 fichiers : un baril + 6 catalogues de traduction) ; `editor/vitest.config.ts:11`
    // exclut `src/lang/**` de sa couverture depuis toujours, celui-ci ne l'excluait pas.
    // Les 7 fichiers y étaient donc comptés, TOUS À 100 % sur les quatre métriques
    // (vérifié dans `coverage/lcov.info` — un catalogue est un objet littéral : le charger
    // le couvre entièrement), ce qui gonflait l'agrégat sans qu'aucun test soit écrit.
    // Un seuil cliqueté sur un dénominateur enrichi de données gratuites mesure moins
    // qu'il n'en a l'air. C'est le corollaire « le pré-vol porte la cécité qu'il mesure »,
    // appliqué à une gate — et il fallait le corriger AVANT de recliqueter, pas après.
    coverageExclude: ["src/index.ts", "src/__tests__/**", "src/lang/**"],
    setupFiles: ["./src/__tests__/canvas-setup.ts"],
    // Recalibrés au PLUGINS S2 (23/07/2026) — vers le HAUT.
    //
    // Le sprint anticipait une baisse : fusionner 6 `formRender` en une factory
    // retire du dénominateur des fonctions bien couvertes, ce qui peut faire
    // chuter le ratio sans qu'aucun test soit perdu. Mesure faite, c'est
    // l'inverse — la refacto a aussi retiré les copies NON couvertes, et les
    // deux modules extraits (`types/field-base.ts`, `types/field-media.ts`) sont à 100 %
    // sur les quatre métriques.
    //
    //            avant S2  →  après S2  (seuil posé ici)
    //   stmts      83,98        84,37        82
    //   branches   59,68        62,02        60
    //   functions  74,25        78,54        76
    //   lines      87,41        87,50        85
    //
    // ⚠️ Le rapport `text` d'istanbul n'affiche PAS les fichiers à 100 % :
    // `field-base.ts`, `field-media.ts`, `helpers.ts`, `validators.ts` et `registry.ts`
    // sont absents du tableau alors qu'ils sont bien mesurés et comptés dans les
    // totaux. Lire `coverage/lcov.info` avant de conclure à un trou de mesure.
    //
    // ── Re-cliquetés au backlog résiduel R.2 (24/07/2026) ─────────────────────
    //
    // La dette contractée au S2 — seuils abaissés à la mesure pour débloquer la
    // CI, cible annoncée à 75 de branches — est soldée. Cinq fichiers de tests
    // ajoutés (`sanitize`, `types-gallery`, `types-dropdown`, `types-image`,
    // `types-contact`, `types-list`), 307 → 528 tests :
    //
    //            après S2  →  après R.2  (seuil posé ici)
    //   stmts      84,37        93,95         92
    //   branches   62,02        76,49         74
    //   functions  78,54        92,22         90
    //   lines      87,50        95,99         94
    //
    // Le gisement était concentré et il l'est resté : `gallery` 41,18 → 97,05 de
    // branches, `dropdown` 40 → 93,33, `image` 46,87 → 87,5 (fonctions 31,25 →
    // 100), `list` 46,15 → 96,15, `sanitize` 45 → 95. Ce qui reste sous 60 —
    // `metric`, `link`, `table`, `badge`, `price`, `rating`, `reviews`, `hours` —
    // est le prochain palier, pas une régression.
    //
    // ⚠️ Cliqueter vers le haut, JAMAIS vers le bas. Marge de ~2 pts sous la
    // mesure : elle protège de la charge parallèle de turbo, pas du bruit (nul
    // sous istanbul).
    // branches cliqueté 74 → 76 : `types-rating.test.ts` porte `rating.ts` 59 → 98 % (paquet 78,6 %).
    thresholds: { branches: 76, functions: 90, lines: 94, statements: 92 },
});
