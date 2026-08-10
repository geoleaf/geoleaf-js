#!/usr/bin/env node
/**
 * Le lanceur des tests unitaires du monorepo — et le seul endroit qui crée un essaim de
 * processus vitest, donc le seul qui puisse le borner (B.48).
 *
 * Usage :
 *   node scripts/run-tests.cjs              # `turbo run test`          (gate unitaire)
 *   node scripts/run-tests.cjs --coverage   # `turbo run test:coverage` (gate couverture)
 *   node scripts/run-tests.cjs --force      # ignore le cache turbo (mesures, contrôles)
 *   node scripts/run-tests.cjs --fanout=2   # essaimage forcé, pour re-mesurer le budget
 *
 * ## Le défaut corrigé
 *
 * `npm test` était `turbo run test --filter=…` × 12, **sans `--concurrency`**, et aucune
 * config de package ne déclarait `maxWorkers` : chaque `vitest run` croyait posséder la
 * machine et ouvrait ~23 workers. Mesuré le 22/07/2026 sur l'hôte de référence (24 cœurs,
 * 15 Go) : **81 processus Node, 11,3 Go de RSS cumulée** pour ~11 Go disponibles. D'où un
 * `ci:local` rouge une fois sur deux, toujours en timeout et jamais en assertion.
 *
 * Ce script pose les DEUX facteurs du produit depuis une source unique :
 *   - `--concurrency=TEST_FANOUT` côté turbo ;
 *   - `GEOLEAF_TEST_FANOUT` dans l'environnement enfant, que `worker-budget.mjs` lit pour
 *     en déduire `maxWorkers` et `vmMemoryLimit` dans chacune des 18 configs.
 *
 * ⚠️ La variable est posée ici, dans l'environnement du processus fils, et pas en préfixe
 * du script npm (`VAR=x turbo …`) : cette syntaxe est du shell POSIX et casse sous
 * `cmd.exe`, où tourne une partie du poste de développement (cf. la garde `NPM_SHELL` de
 * `ci-local.cjs`, reprise ici).
 *
 * ## La liste de paquets est dérivée, jamais écrite
 *
 * Elle vient de `scripts/lib/test-scope.cjs`. La liste de 12 `--filter` qu'elle remplace
 * était écrite à la main et avait dérivé : elle sautait **5 paquets / 27 fichiers de
 * test**, non par arbitrage mais par accrétion — chaque paquet y avait été ajouté le jour
 * où il recevait des tests, et cinq ne l'avaient jamais été. C'est le mode d'échec que
 * CLAUDE.md décrit : une liste en dur ne casse pas, elle cesse silencieusement de matcher.
 */

"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const testScope = require("./lib/test-scope.cjs");

const ROOT = path.resolve(__dirname, "..");

/**
 * Nombre de tâches turbo — donc de processus `vitest` — menées de front.
 *
 * `4`, pas un réglage de confort : c'est le premier facteur du produit qui a rendu
 * `ci:local` incroyable. La contre-épreuve du 21/07 donnait 34/34 à `--concurrency=2` ;
 * `4` est retenu parce que le second facteur est désormais borné lui aussi
 * (`maxWorkers = cœurs / fanout`), ce qui n'était pas le cas quand `2` a été mesuré.
 * Le gate de couverture portait déjà ce `4` en dur, dans DEUX fichiers — il n'existe plus
 * qu'ici.
 *
 * Produit résultant, **mesuré sur 5 exécutions consécutives** : 27 à 31 processus et
 * 4,8 Go de RSS cumulée au pire, contre 81 processus et 11,3 Go avant — en testant 17
 * paquets au lieu de 12, pour une durée quasi inchangée (71 s → 74-84 s).
 */
const DEFAULT_FANOUT = 4;

const args = process.argv.slice(2);
const WITH_COVERAGE = args.includes("--coverage");
const FORCE = args.includes("--force");

/**
 * `--fanout=N` — pour MESURER une autre valeur, pas pour en vivre.
 *
 * Le chiffre retenu ci-dessus doit rester le fruit d'une mesure ; ce drapeau existe pour
 * qu'en refaire une ne demande pas d'éditer ce fichier, donc pour qu'on la refasse.
 */
const fanoutArg = args.find((a) => a.startsWith("--fanout="));
const parsedFanout = fanoutArg ? Number(fanoutArg.slice("--fanout=".length)) : NaN;

if (fanoutArg && !(Number.isInteger(parsedFanout) && parsedFanout > 0)) {
    console.error(`run-tests.cjs : --fanout attend un entier ≥ 1, reçu "${fanoutArg}".`);
    process.exit(1);
}

const TEST_FANOUT = fanoutArg ? parsedFanout : DEFAULT_FANOUT;

// Sous Windows, `npx` est un .cmd que Node refuse de spawner sans shell (CVE-2024-27980).
const NPM_SHELL = process.platform === "win32";

/**
 * L'invariant qui rend vraie la phrase « `ci:local` vert → push sûr ».
 *
 * Jette si le gate local testait moins que `ci.yml`. Vérifié à CHAQUE run, et pas dans une
 * gate séparée qu'on oublierait de câbler : le protocole de push de CLAUDE.md fait de
 * `ci:local` le seul critère avant de dépenser du quota GitHub Actions, et un périmètre
 * plus étroit en local viderait cette garantie sans rien afficher.
 */
try {
    testScope.assertUnitScopeCoversRoot();
} catch (err) {
    // Message sans pile : il est écrit pour être lu et suivi, pas pour être débogué.
    console.error(`\n${err.message}\n`);
    process.exit(1);
}

const packages = testScope.unitScope();
const parked = Object.entries(testScope.PARKED);

if (packages.length === 0) {
    console.error("run-tests.cjs : aucun paquet testable — la dérivation a échoué.");
    process.exit(1);
}

const task = WITH_COVERAGE ? "test:coverage" : "test";

/**
 * Lance turbo avec les deux facteurs du budget posés ensemble.
 *
 * ⚠️ `worker-budget.mjs` est en ESM et ce script en CJS : le nom de la variable
 * d'environnement est donc **importé**, jamais recopié. Une chaîne écrite en dur des deux
 * côtés dégraderait silencieusement le run vers `fanout = 1` — c'est-à-dire vers l'absence
 * de borne — le jour où l'une des deux serait renommée. Un `import()` coûte 2 ms et
 * supprime la classe entière.
 *
 * @returns {Promise<number>} Code de sortie de turbo.
 */
async function main() {
    const budget = await import("@geoleaf/build-config/vitest/worker-budget.mjs");

    // Posée sur CE processus, puis héritée par turbo et par chaque `vitest run` : le budget
    // affiché ci-dessous est donc calculé par le même code, et depuis la même valeur, que
    // celui que les enfants appliqueront. Pas de description qui puisse mentir sur le run.
    process.env[budget.FANOUT_ENV] = String(TEST_FANOUT);
    const described = budget.describeBudget();

    console.log(
        `\n▶ ${task} — ${packages.length} paquets, ${TEST_FANOUT} de front\n` +
            `  budget : ${described.fanout} × ${described.maxWorkers} workers = ` +
            `${described.peakWorkers} sur ${described.cores} cœurs, ` +
            `plafond mémoire collectif ${described.peakMemoryMb} Mo`
    );
    // Un budget qu'on ne peut pas tenir doit se dire. N'arrive qu'avec un `--fanout` forcé
    // au-delà de la moitié des cœurs, où le plancher de 2 workers l'emporte sur l'invariant.
    if (described.oversubscribed) {
        console.log(
            `  ⚠️ SURSOUSCRIT : ${described.peakWorkers} workers pour ${described.cores} cœurs — ` +
                `le plancher de ${described.maxWorkers} workers l'emporte sur la borne. ` +
                `À réserver à une mesure ponctuelle.`
        );
    }
    // Une gate qui rétrécit son périmètre doit le DIRE : c'est en se taisant que la liste
    // précédente a perdu 5 paquets sans que personne ne le voie.
    for (const [name, reason] of parked) console.log(`  ⏸ au parc : ${name} — ${reason}`);

    const result = spawnSync(
        "npx",
        [
            "turbo",
            "run",
            task,
            `--concurrency=${TEST_FANOUT}`,
            ...(FORCE ? ["--force"] : []),
            ...packages.map((p) => `--filter=${p.name}`),
        ],
        { cwd: ROOT, stdio: "inherit", shell: NPM_SHELL, env: process.env }
    );

    return result.status === null ? 1 : result.status;
}

main().then(
    (code) => process.exit(code),
    (err) => {
        console.error(`run-tests.cjs : ${err.message}`);
        process.exit(1);
    }
);
