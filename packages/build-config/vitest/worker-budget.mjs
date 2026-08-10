/**
 * @description
 * Le budget de processus des runs Vitest — source unique, dérivée (B.48).
 *
 * ## Le défaut que ce module corrige
 *
 * Un run de tests de ce dépôt coûte `processus_vitest_concurrents × workers_par_processus`
 * processus Node. Les deux facteurs vivaient à des endroits différents, et **le produit
 * n'était borné nulle part** :
 *
 * - `npm test` lançait `turbo run test` **sans `--concurrency`** ;
 * - aucune config de package ne déclarait `maxWorkers`, si bien que chaque `vitest run`
 *   retombait sur le défaut de Vitest 4 — `Math.max(numCpus - 1, 1)`, soit **23** sur
 *   une machine à 24 cœurs (`resolveMaxWorkers`, `vitest/dist/chunks/cli-api.*.js`).
 *
 * Chaque processus croyait donc posséder la machine seul. **Mesuré le 22/07/2026** sur
 * l'hôte WSL de référence (24 cœurs, 15 Go de RAM) : pic à **81 processus Node et 11,3 Go
 * de RSS cumulée**, pour ~11 Go réellement disponibles. Le run passait *au bord* — d'où
 * un `ci:local` rouge une fois sur deux, toujours en **timeout** et jamais en assertion,
 * sur des paquets non touchés et verts en isolation.
 *
 * ⚠️ Le facteur qui cède n'est pas le CPU mais la **mémoire** : sous pression, les workers
 * `vmForks` atteignent leur seuil de recyclage, et un recyclage = contexte VM neuf =
 * ré-import et re-transpilation complets. C'est ainsi qu'un fichier de 72 lignes **sans
 * le moindre minuteur** (`plugin-websocket/src/__tests__/entry.test.ts`) dépasse 10 s.
 *
 * ## Les invariants
 *
 *     fanout × maxWorkers()                    ≤ availableParallelism()
 *     fanout × maxWorkers() × vmMemoryLimit()  ≤ MEMORY_HEADROOM   (de la RAM totale)
 *
 * ⚠️ Le premier invariant a **une exception assumée** : `maxWorkers()` ne descend jamais
 * sous 2, pour qu'un runner CI à 4 cœurs garde du parallélisme intra-paquet. Quand ce
 * plancher mord, le total plafonne à `2 × fanout` — donc au pire à **2 × cœurs**, atteint
 * quand `fanout = cœurs`. C'est le pire cas LÉGITIME, et il reste meilleur que l'état
 * d'avant B.48 (un runner 4 cœurs ouvrait 4 × 3 = 12 workers, il en ouvre 8).
 *
 * `oversubscribed` ne se déclenche donc qu'**au-delà** de ce pire cas légitime, c'est-à-dire
 * pour un `--fanout` forcé à une valeur que la machine ne peut pas tenir. Le seuil n'est pas
 * arbitraire : c'est la frontière exacte entre « le plancher me protège » et « j'ai demandé
 * l'impossible ». Une alerte qui se déclencherait à chaque run CI ne serait plus lue —
 * précisément le défaut que ce module corrige.
 *
 * Le premier borne les processus, le second borne la mémoire qu'ils peuvent atteindre
 * avant recyclage. Les deux se déduisent d'**une seule** entrée : `GEOLEAF_TEST_FANOUT`,
 * le nombre de processus `vitest` concurrents, posé par `scripts/run-tests.cjs` (qui le
 * passe aussi à `turbo --concurrency`). Absente, elle vaut `1` : un run solitaire.
 *
 * ## Deux règles héritées de ce répertoire
 *
 * **`.mjs`, jamais `.ts`** — comme tout ce dossier : ne dépendre d'aucun transpileur pour
 * lire des modules dont l'un installe précisément ce transpileur (cf. `base.mjs`).
 *
 * **Une valeur identique partout** — Vitest 4 abat le run `projects` AVANT tout test si
 * deux projets déclarent des `maxWorkers` différents sous le même `sequence.groupOrder`
 * (`cli-api.*.js`, « Projects X and Y have different 'maxWorkers'… »). Il ne refuse que la
 * **divergence**, pas le cap lui-même — d'où ce module, appelé par les 18 configs, qui
 * rend l'uniformité structurelle plutôt que disciplinaire.
 */

import { availableParallelism, totalmem } from "node:os";

/** Nom de la variable d'environnement portant le nombre de processus vitest concurrents. */
export const FANOUT_ENV = "GEOLEAF_TEST_FANOUT";

/**
 * Part de la RAM **totale** que l'ensemble des workers peut atteindre avant recyclage.
 *
 * Ce n'est pas une réservation : le seuil déclenche un recyclage, il ne préalloue rien.
 * Mais s'il vaut 1, le « plafond » est une tautologie — il autorise les workers à occuper
 * toute la machine, ce qui n'est pas un filet. Le reste paie ce que la mesure du 22/07
 * montre autour des workers : les processus principaux (un par tâche turbo), le cache de
 * pages, et le simple fait que sur 15 Go de RAM cet hôte n'en avait que ~11 de libres.
 *
 * `0.5` place le seuil par worker à ~650 Mo en solo et ~325 Mo en essaim, quand la RSS
 * moyenne mesurée par worker était de ~140 Mo. Le recyclage reste donc l'exception qu'il
 * doit être : c'est la RÉDUCTION DU NOMBRE de workers qui fait le travail, pas ce seuil.
 */
const MEMORY_HEADROOM = 0.5;

/**
 * Nombre de processus `vitest` qui tournent en parallèle sur cette machine.
 *
 * `1` par défaut — un `npx vitest run` racine, ou un `npm test -w <paquet>` isolé, est
 * seul et peut prendre la machine. Seul `scripts/run-tests.cjs` pose autre chose, parce
 * que c'est lui qui crée l'essaimage.
 *
 * Interne : les trois fonctions publiques ci-dessous en dérivent tout ce dont les configs
 * ont besoin. L'exposer sans consommateur en ferait un export orphelin, que le gate
 * `dead-code` (knip) refuse — à juste titre.
 *
 * @returns {number} Entier ≥ 1.
 */
function fanout() {
    const n = Number(process.env[FANOUT_ENV]);
    return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Plafond de workers pour CE processus vitest.
 *
 * - **Seul** (`fanout === 1`) : la formule adaptative historique de la config racine —
 *   jamais sous 4 (runners CI à 2-4 cœurs), jamais au-dessus de 12 (au-delà, Vitest
 *   note lui-même que le thread principal s'étrangle ; un hôte à 24 cœurs tournait
 *   83 % à vide avec l'ancien 4 fixe).
 * - **En essaim** : la part de la machine qui revient à ce processus, plancher à 2 pour
 *   qu'un runner CI à 4 cœurs garde du parallélisme intra-paquet.
 *
 * ⚠️ Changement assumé : un `npm test -w <paquet>` isolé passe de 23 workers (défaut
 * Vitest non plafonné) à 12 — c'est le plafond que le run racine appliquait déjà, étendu
 * au cas solitaire qui, lui, n'en avait aucun. **Mesuré sur `@geoleaf/core` seul** (423
 * fichiers de test) : 29 → 16 processus, 3 494 → 1 496 Mo, 52 → 55 s. Moitié moins de
 * processus et 57 % de mémoire en moins pour 3 s — le parallélisme excédentaire ne
 * payait pas.
 *
 * @returns {number} Entier ≥ 2.
 */
export function maxWorkers() {
    const cores = availableParallelism();
    const n = fanout();

    return n === 1 ? Math.min(12, Math.max(4, cores - 2)) : Math.max(2, Math.floor(cores / n));
}

/**
 * Seuil de recyclage d'un worker `vmForks`, en **fraction de la RAM totale**.
 *
 * Vitest le lit sous la clé **`vmMemoryLimit`** et n'accepte qu'un nombre dans `]0, 1]`
 * (fraction), un pourcentage (`"50%"`) ou une taille (`"512MB"`).
 *
 * ⚠️ Ne jamais réécrire ceci en `"1/2"` : `stringToBytes` parse cette chaîne via
 * `parseFloat` → **1** → `Math.floor(1 × totalmem)`, soit **100 % de la RAM** et plus
 * aucun recyclage. C'est exactement le piège dans lequel la config précédente était
 * tombée — sous une clé (`memoryLimit`) que Vitest 4 ne lit même pas, ce qui masquait
 * l'erreur en la rendant inoffensive.
 *
 * Sans effet sur les pools `forks` (core, addpoi, storage) : Vitest ne consulte cette
 * valeur que pour `vmForks` / `vmThreads`.
 *
 * @returns {number} Fraction dans `]0, 1]`.
 */
export function vmMemoryLimit() {
    return MEMORY_HEADROOM / (fanout() * maxWorkers());
}

/**
 * Le budget résolu, pour journalisation. Aucun consommateur de production — sert à
 * afficher ce que le run va coûter avant qu'il le coûte.
 *
 * `oversubscribed` signale un budget au-delà du pire cas légitime (`2 × cœurs`) — voir
 * l'exception du plancher, en tête de module. Faux dans tout usage normal, y compris sur
 * un runner CI à 4 cœurs.
 *
 * @returns {{fanout: number, maxWorkers: number, vmMemoryLimit: number, cores: number,
 *   peakWorkers: number, peakMemoryMb: number, oversubscribed: boolean}}
 */
export function describeBudget() {
    const n = fanout();
    const workers = maxWorkers();
    const cores = availableParallelism();

    return {
        fanout: n,
        maxWorkers: workers,
        vmMemoryLimit: vmMemoryLimit(),
        cores,
        peakWorkers: n * workers,
        peakMemoryMb: Math.round((totalmem() * (n * workers * vmMemoryLimit())) / 1024 / 1024),
        oversubscribed: n * workers > 2 * cores,
    };
}
