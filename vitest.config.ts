/**
 * Root Vitest configuration — GeoLeaf-JS monorepo (Vitest 4)
 *
 * Replaces the deprecated standalone `vitest.workspace.ts` (array export +
 * `--workspace` CLI flag, both removed in Vitest 4) with the canonical
 * `test.projects` field. Each entry points to a per-package vitest.config.ts.
 *
 * Run:
 *   npm run test:vitest          — all projects
 *   npm run test:vitest:core     — @geoleaf/core only (--project filter)
 *   npm run test:vitest:coverage — coverage report
 *
 * tsx propagation: Vitest 4 does NOT honor per-project execArgv for forked
 * workers (verified in S1 — tsx loaded via poolOptions.forks.execArgv left 1148
 * `.js → .ts` imports failing with ERR_MODULE_NOT_FOUND). Setting NODE_OPTIONS at
 * config-load time propagates tsx (ESM .js → .ts resolution + tsconfig paths) to
 * every forked worker. This is essential and stays. (S2 node18-cleanup removed the
 * dead Node 24 `--no-experimental-require-module` branch; engines require Node ≥ 22.)
 */
// Side effect — MUST run before workers spawn. Shared with the 17 package configs
// since ARCHI S9.3; this file used to carry its own copy of the same four lines.
import "@geoleaf/build-config/vitest/ensure-tsx-node-options.mjs";

import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";

import { maxWorkers } from "@geoleaf/build-config/vitest/worker-budget.mjs";

/**
 * Le périmètre de ce run vient de `scripts/lib/test-scope.cjs` — B.48.
 *
 * La liste d'exclusions (`EXCLUDED_FROM_ROOT_RUN`) y a déménagé, avec sa justification :
 * c'est une connaissance de PÉRIMÈTRE, pas de configuration Vitest, et le runner qui
 * vérifie l'invariant `ci:local ⊇ ci.yml` doit pouvoir la lire depuis CJS. La garder ici
 * aurait imposé d'en écrire une seconde copie côté runner — soit exactement la dérive que
 * `packages.cjs` et ce module existent pour tuer.
 */
const testScope = createRequire(import.meta.url)("./scripts/lib/test-scope.cjs");

export default defineConfig({
    test: {
        // Plafond de workers du run. Dérivé, et surtout IDENTIQUE à celui que déclarent
        // les 18 configs de package : Vitest 4 abat le run `projects` avant tout test si
        // deux projets d'un même `sequence.groupOrder` divergent sur cette valeur.
        // Ici `GEOLEAF_TEST_FANOUT` est absente (un seul processus vitest) → le run prend
        // la machine, comme avant B.48.
        maxWorkers: maxWorkers(),
        projects: testScope
            .rootProjectScope()
            .map((p: { dir: string }) => `${p.dir}/vitest.config.ts`),
        // Vitest 4 resolves the coverage provider from the ROOT config when running
        // `--coverage` across projects — il faut donc le déclarer ici. Standard du monorepo :
        // istanbul (chaque config de projet le pose aussi).
        coverage: {
            provider: "istanbul",
            // ⚠️ PAS de `reportsDirectory` ici, et c'est un résultat de mesure (T6.2).
            //
            // Le relevé du sprint attribuait les 23 Mo de `coverage/` à la racine à
            // « `vitest run --coverage`, chemin implicite ». **Faux, vérifié.** En mode
            // `projects`, chaque projet applique SON `reportsDirectory` — et les 19 le
            // déclarent tous à `"./coverage"`, relatif à leur propre racine
            // (`packages/build-config/vitest/base.mjs:139` + 4 surcharges). Mesure :
            // après `rm -rf coverage`, `npm run test:vitest:coverage` écrit dans
            // `packages/core/coverage/` et NE recrée PAS `coverage/` à la racine.
            //
            // Ce `coverage/` racine était donc un RÉSIDU d'une invocation d'une autre
            // époque, sans producteur actuel — supprimé, il ne revient pas. Déclarer un
            // `reportsDirectory` ici pour le « relocaliser » créait un `artifacts/`
            // vide : une déclaration qui prétend déplacer ce que rien ne produit, soit
            // exactement la classe de défaut que ce sprint retire. Elle a été écrite,
            // mesurée sans effet, puis retirée.
            //
            // Ne pas la remettre sans avoir d'abord mesuré qu'un rapport RACINE existe.
            //
            // Les SIX objets nommés « coverage » dans ce dépôt (et leurs quatre sens) :
            // voir `docs/reference/ARCHITECTURE.md`, section « coverage — six objets,
            // quatre sens ». Ce fichier-ci n'en gouverne qu'un. (Le renvoi disait
            // `_docs_projet/ARCHITECTURE.md`, chemin mort AVANT la scission.)
        },
    },
});
