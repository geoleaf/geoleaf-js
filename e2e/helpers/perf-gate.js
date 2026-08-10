// @ts-check
// Sprint 3 (perf roadmap) — Runtime regression gate: tolerances + comparison helpers.
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
// and JS heap. ⚠️ Depuis B-218 (10/08/2026), « JS heap » désigne le DELTA RETENU lu par
// CDP (`Runtime.getHeapUsage` + `HeapProfiler.collectGarbage`), et plus du tout
// `performance.memory` — que Chrome rend quantifié et figé pour la durée de la page, donc
// incapable de voir 10 000 features. Le détail mesuré est au bloc `heapDelta` ci-dessous.
// FPS captured under virtualized/software GL (WSLg/CI) are NON
// representative (perf roadmap Sprint 2 finding) — and depuis B-217 (10/08/2026) ils
// ne sont plus gatés DU TOUT, pas même en direction : la comparaison `clustered` vs
// `plain` tranchait à 5 fps une grandeur dont le bruit mesuré va de 31 à 52 fps, et
// elle comparait deux chemins de rendu étrangers (marqueurs DOM vs couches GL). Ce
// que le spec asserte à leur place est un oracle de clustering déterministe, et le
// motif complet — avec ce qu'il rend invisible — vit dans le spec, à l'assertion.
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
    // Coût mémoire RETENU de 10 000 features — bande absolue, SANS baseline (B-218).
    //
    // ⚠️ Ce bloc a été `memory: { factor: 1.5 }` — un plafond `committé × 1,5` posé sur
    // `memory.after10kFeatures_mb` — jusqu'au 10/08/2026, et il gardait le VIDE : la
    // grandeur qu'il tranchait était `performance.memory.usedJSHeapSize`, que Chrome rend
    // quantifié ET figé pour la durée de la page (sans `--enable-precise-memory-info`).
    // Mesuré : `delta = 0` dans 6 runs de suite, puis dans 10 pages fraîches de sonde, à
    // N = 0, 10 000 ET 30 000 features. Le test n'asserait donc pas le coût des features
    // mais le heap AMBIANT de la page, dont la dispersion (24,8 → 45,2 Mo, ×1,8) débordait
    // le ×1,5 toléré : un rouge par construction, sans régression produit.
    //
    // Ce qui le remplace porte sur le DELTA RETENU, lu par CDP `Runtime.getHeapUsage`
    // après `HeapProfiler.collectGarbage` des deux côtés. Table de la sonde
    // `scripts/probe-heap-metrics.mjs`, pages fraîches, cible nginx, GL logiciel :
    //
    //     N = 10 000 (API GeoLeaf) : 1,54 · 1,55 · 1,55 · 1,56 · 1,57 Mo → étendue 0,03
    //     N = 10 000 (natif)       : 1,48 · 1,50 Mo
    //     N = 0      (témoin)      : 0,09 · 0,15 Mo
    //     N = 30 000               : 4,12 Mo          (la grandeur suit sa dose)
    //     et par le spec lui-même  : 1,51 · 1,54 · 1,54 Mo (3 runs, dont la suite 06 complète)
    //     → 8 relevés sains au total : 1,51 → 1,57 Mo, étendue 0,06 (±2 %).
    //
    // - `floorMb` est l'assertion ANTI-CREUX, et c'est la leçon de B-218 : un delta nul
    //   doit désormais ROUGIR au lieu de passer. 0,5 Mo est le centre géométrique entre
    //   le témoin (0,15) et le signal (1,54) — ×3,3 au-dessus, ×3,1 en dessous.
    // - `ceilMb` n'est PAS calibré sur le bruit (il vaut 100× l'étendue mesurée) mais sur
    //   la dérive légitime d'une dépendance : il tolère +90 % sur MapLibre/V8 et attrape
    //   un doublement du coût par feature. Un rouge ici se lit donc comme un CHANGEMENT
    //   RÉEL en première hypothèse, pas comme un tirage — l'inverse exact de l'ancien.
    //
    // 🛑 Ne pas élargir la bande pour faire verdir : re-mesurer d'abord avec la sonde
    // (`E2E_TARGET=nginx PROBE_MODE=bande node scripts/probe-heap-metrics.mjs`), et ne
    // bouger un seuil qu'avec la table qui le justifie, à côté.
    heapDelta: { features: 10_000, floorMb: 0.5, ceilMb: 3 },
    // Rétention APRÈS churn add→remove — bande absolue, SANS baseline (B-219).
    //
    // Objet DISTINCT de `heapDelta` ci-dessus, et c'est tout l'intérêt : `heapDelta`
    // mesure le COÛT d'une couche et ne la retire jamais ; celle-ci mesure ce qui reste
    // RETENU une fois la couche retirée. B-218 nommait ce trou explicitement (« Les
    // FUITES. Ce test n'enlève jamais la couche […] Domicile prévu — 6.2.6 — qui est
    // lui-même aveugle »), et §6.2.6 l'était en effet : il jugeait sur
    // `performance.memory`, que Chrome fige pour la durée de la page.
    //
    // 🛑 LA BANDE EST MESURÉE PAR LE SPEC LUI-MÊME, ET C'EST UNE CORRECTION, PAS UN
    // DÉTAIL DE MÉTHODE. La sonde et le spec ne rendent PAS la même dispersion sur le
    // même geste et la même dose : sonde saine −0,07 à +0,36 Mo (n=5), spec sain −0,12 à
    // +1,22 Mo (n=11) — quatre fois plus large. Une bande posée sur la sonde aurait donné
    // un plafond à 1,5 Mo, soit ×1,2 de marge sur le pire run sain du spec : le seuil
    // dans la bande de bruit, la faute exacte de B-217 puis de B-218. **Calibrer avec
    // l'instrument qui juge, jamais avec son voisin.**
    //
    // Relevés du spec (`06-performance-baseline.spec.js` §6.2.6), cible nginx, GL
    // logiciel, dose 14 cycles, GC forcé ×2 des deux côtés, n = 11 churns sains :
    //
    //     PIC     1,03 · 1,09 · 1,09 · 1,12 · 1,32 · 1,36 · 1,37 · 1,48 · 1,50 · 2,21 · 2,35
    //     RETENU  −0,12 · −0,05 · 0,24 · 0,34 · 0,36 · 0,44 · 0,77 · 1,02 · 1,05 · 1,09 · 1,22
    //
    //     FUITE délibérée (les collections restent référencées)
    //                  PIC 15,25 · 15,36   RETENU 13,78 · 13,85   (spec, n=2)
    //                                      RETENU 14,81 · 15,07   (sonde, n=2)
    //     témoin sans churn   PIC 0,03   RETENU 0,04              (sonde, n=1)
    //
    // - `peakFloorMb` est l'assertion ANTI-CREUX. Elle ne peut PAS porter sur la
    //   rétention — une rétention SAINE vaut zéro, et vaut même parfois moins (−0,12
    //   mesuré) —, donc elle porte sur le PIC : si la couche tenue ne pèse rien, la
    //   rétention nulle qui suit ne prouve rien. 0,2 Mo est le centre géométrique entre
    //   le témoin sans churn (0,03) et le plus faible pic sain (1,03) : ×6,7 au-dessus,
    //   ×5,2 en dessous.
    // - `retentionCeilMb` = 4 Mo, centre géométrique entre le pire relevé sain (1,22) et
    //   la plus petite fuite mesurée (13,78) : ×3,3 au-dessus de l'un, ×3,4 en dessous de
    //   l'autre. Il attrape une fuite d'environ 4 collections sur 14 — pas une dérive
    //   plus fine, et c'est nommé dans le spec.
    //
    // 🛑 Ne pas élargir la bande pour faire verdir : re-mesurer d'abord, et avec le SPEC
    // (`E2E_TARGET=nginx npx playwright test e2e/06-performance-baseline.spec.js -g "Memory leak"`,
    // plusieurs fois), la sonde ne servant qu'à produire les scénarios que le spec ne
    // joue pas (fuite délibérée, témoin sans churn). Ne bouger un seuil qu'avec la table
    // qui le justifie, à côté.
    heapRetention: { cycles: 14, peakFloorMb: 0.2, retentionCeilMb: 4 },
    // initTime.avg — absolute soft ceiling (ms). Network-inclusive on local
    // http-server, NOT baseline-relative. Catches only gross regressions.
    initTimeCeilingMs: 10_000,
    // ⚠️ PAS de tolérance FPS ici, et c'est un RETRAIT motivé (B-217, 10/08/2026).
    // `fpsDirectionSlack: 5` portait l'invariant `clustered ≥ plain − 5`. Mesuré sur
    // 5 runs : l'étendue de la marge qu'il tranchait va de 31 à 52 fps selon le cas —
    // le seuil valait un dixième du bruit. Ne pas le réintroduire, sous aucune valeur :
    // l'élargir rendrait l'assertion creuse aux quatre cas au lieu de deux, le rétrécir
    // la rendrait rouge au hasard. Le raisonnement complet et ce qu'il rend invisible
    // sont dans le bloc B-217 de e2e/06-performance-baseline.spec.js.
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
 * Bande (Mo) du delta de heap RETENU pour `featureCount` features — plancher
 * anti-creux et plafond de régression. Ne lit AUCUN baseline : la bande est absolue,
 * mesurée, et vit dans TOLERANCES avec sa table (B-218).
 *
 * ⚠️ Jette si l'appelant change la dose : la bande a été mesurée à 10 000 features et
 * la relation n'est pas proportionnelle (≈ 0,1 Mo de coût fixe). Un seuil qui survit
 * en silence à un changement de son objet est exactement le défaut que B-218 solde ;
 * l'erreur pointe la sonde qui sait re-mesurer.
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
 * Bande (Mo) de la RÉTENTION après `cycles` cycles add→remove de 10 000 features —
 * plancher anti-creux sur le PIC, plafond de fuite sur ce qui reste RETENU après
 * retrait. Ne lit AUCUN baseline : la bande est absolue, mesurée, et vit dans
 * TOLERANCES avec sa table (B-219).
 *
 * ⚠️ Jette si l'appelant change la dose : la fuite délibérée mesurée croît avec le
 * nombre de cycles (9,1 Mo à 8 cycles, 15,0 Mo à 14), donc un plafond mesuré à une
 * dose ne dit rien à une autre. Un seuil qui survit en silence à un changement de son
 * objet est le défaut que B-218 solde ; l'erreur pointe la sonde qui sait re-mesurer.
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
