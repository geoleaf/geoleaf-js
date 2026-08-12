#!/usr/bin/env node
/**
 * Verify that no throwaway scripts, build artifacts, or oversized source files
 * have been accidentally committed to the repository.
 *
 * Categories checked:
 *   1. Throwaway scripts tracked in git (fix_*.py, tmp_*, analyze_*.py, etc.), and
 *      any `.cjs`/`.mjs` in root `scripts/` absent from SCRIPTS_ALLOWLIST.
 *   1b. `.cjs`/`.mjs` files OUTSIDE root `scripts/` with no declared owner (T3.5).
 *      Corpus is the index AND the untracked worktree — see getGitVisibleFiles().
 *   2. Build/test artifacts tracked in git (coverage*.txt, *_cov_run.txt, coverage-e2e/)
 *   3. Python bytecode tracked in git (__pycache__/, *.pyc)
 *   4. SOURCE files (.ts/.js/.css) exceeding 700 lines, across all 18 packages.
 *      Tests are OUT OF SCOPE — the limit constrains shipped code, not test suites
 *      (arbitrage MP 24/07/2026, R.16). WARNING, non-blocking.
 *   5. GENERATED artifacts under git control (T4.1) — three assertions:
 *      5a. no artifact path in the INDEX          → the T4 exit criterion
 *      5b. no artifact path untracked AND unignored → blocks the reconstitution
 *      5c. every DECLARED producer output is covered by a known form, and ignored
 *      Forms come from `lib/generated-artifacts.cjs`. Corpus is the index AND the
 *      untracked worktree — see getGitVisibleFiles().
 *
 * Usage: node scripts/verify-repo-hygiene.cjs (from repo root)
 * Exit code 0 = clean, 1 = violations found.
 */

"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// ─── Allowlist — scripts/ files that are legitimate tooling ──────────────────
//
// Renamed from CJS_ALLOWLIST when `.mjs` entered the register: new root tooling is
// written in ESM (`knip-hints-reporter.mjs` was added the day before this rename),
// so a set named "CJS" holding `.mjs` would have been a lying name. The register is
// what makes `scripts/` self-regulating — one register, both extensions.

const SCRIPTS_ALLOWLIST = new Set([
    "audit-ci.cjs",
    "audit-cleanup.cjs",
    "audit-dev-report.cjs", // gate audit-dev non bloquant (roadmap nettoyage S1) — CI + ci-local
    "audit-innerhtml.cjs",
    // Fraîcheur des rapports de `_docs_projet/travail/rapports/` : vérifie que chaque item
    // sourcé est encore vrai sur HEAD avant archivage (atelier, hors ci:local).
    "audit-report-freshness.cjs",
    // Instrument des sprints 2 à 5 de la roadmap COUVERTURE (`--triage` / `--prove-mocks`).
    // DÉLIBÉRÉMENT hors ci:local : il relance deux passes de couverture, ce que la roadmap
    // argumente d'éviter en permanence. La propriété durable est la baseline décroissante de
    // `verify-test-load-mode.cjs` ; celui-ci prouve, lot par lot, que la conversion a bien
    // changé l'ATTRIBUTION — ce qu'une suite verte ne peut pas montrer.
    //
    // ⚠️ Ce commentaire annonçait `--snapshot` et `--compare` : les DEUX ont été supprimées
    // au commit 3285f48e (COUVERTURE S6, unification du provider sur istanbul), et c'est
    // `--snapshot` qui écrivait les 117,6 Mio de `run-*` purgés au T4.6. Un commentaire qui
    // documente des sous-commandes mortes envoie chercher une capacité inexistante.
    "audit-test-load-conversion.cjs",
    "benchmark.cjs",
    "build-deploy-coverage.cjs",
    "build-deploy.cjs",
    "bundle-profiles.cjs",
    "check-bundle-size.cjs",
    // APP-PAYLOAD (socle-init S4.7) — pèse ce qu'un UTILISATEUR télécharge en ouvrant la page
    // (shell dérivé + données du premier écran), là où `check-bundle-size.cjs` pèse ce qu'un
    // INTÉGRATEUR embarque. Objets distincts, jamais comparés. CI + ci-local.
    "check-app-payload.cjs",
    "check-config-consumers.cjs",
    "check-config-coverage.cjs",
    "check-contracts-pure.cjs", // contracts/ type-only purity gate (socle S4) — CI + ci-local + pre-commit
    "check-facade-purity.cjs", // geoleaf.*.ts must stay a thin public surface (kernel S13.1) — CI + ci-local + pre-commit
    "check-dynamic-key-writes.cjs", // prototype-pollution ratchet on dynamic-key writes (kernel S13.2) — CI + ci-local + pre-commit
    "check-exact-optional-debt.cjs", // EXACT-OPTIONAL-DEBT (qualite Q4.5) — cliquet, CI + ci-local
    "check-nonnull-assertion-debt.cjs", // NONNULL-ASSERTION-DEBT (qualite Q5.5) — cliquet, CI + ci-local
    "check-js-test-debt.cjs", // JS-TEST-DEBT (Sprint 5, S5c/5.3) — cliquet D-23/D-24, CI + ci-local
    "check-doc-config-examples.cjs", // DOC-CONFIG-EXAMPLES (Sprint 5, S5c/5.8) — cliquet, CI + ci-local
    "check-dist-integrity.cjs", // DIST-INTEGRITY (Sprint 6, S6a/B-130) — 0 chunk double, 0 orphelin ; CI + ci-local
    "purge-dist.cjs", // versant préventif de B-130 — câblé en tête de `npm run build`
    "check-build-determinism.cjs", // déterminisme du build — coûteux (2 builds), hors pre-commit
    "check-dead-code.cjs",
    "check-dead-links.cjs",
    "check-e2e-wait-signature.cjs", // E2E-WAIT-SIG (B-100) — timeout perdu en 2e position
    "check-i18n-dict-shape.cjs", // filet de forme des dicos i18n / C-5 (roadmap nettoyage S8) — CI + ci-local
    "check-orphan-exports.cjs", // filet anti-code-mort du core / B3 (roadmap nettoyage S2) — CI + ci-local + pre-commit
    "check-consumer-bundle.cjs", // published-package gate (S6) — CI + ci-local + build-deploy
    "check-example-bundle.cjs", // tree-shaking gate (S5) — CI + ci-local + build-deploy
    "check-side-effects.cjs", // sideEffects honesty gate (S6) — CI + ci-local
    // SHIP-SPEC (passage public S1) — un specifier du tarball doit se résoudre HORS du
    // monorepo. Les symlinks de workspace masquent la classe : `@geoleaf/host-runtime` est
    // `private` et 404 sur npm, et il résolvait vert ici. CI + ci-local + pre-commit.
    "check-shipped-specifiers.cjs",
    // LIC-HEADERS (passage public S3) — la notice de licence, sur les sources ET sur les
    // fichiers expédiés. Le `LICENSE` racine exige qu'elle accompagne « all copies or
    // substantial portions » ; 405 des 540 `.js` du tarball n'en portaient aucune. LIC-05 y
    // garde en plus la VALEUR du champ `license`, que PC-05 ne regarde pas. CI + ci-local.
    // ⚠️ Volontairement HORS pre-commit — même motif que `check-subpath-resolve.cjs` : LIC-04
    // lit `dist/`, et `lint-staged` reformate les sources en cours de route.
    "check-license-headers.cjs",
    "check-test-failures.cjs",
    "check-versions.cjs",
    "ci-local.cjs",
    // La chambre propre : ci:local rejoué sur un worktree détaché + npm ci, en CI=true.
    // C'est ce vert-là qui autorise un push, pas celui de ci-local.
    "ci-push.cjs",
    "count-any.cjs",
    "create-plugin.cjs",
    "deploy-docs.cjs",
    // Doc V3, Étape 3 item 3 — génère `docs/reference/API_SURFACE.txt`, le manifeste
    // de la surface dérivée par TypeDoc sur les 14 paquets, et le gate en fraîcheur
    // (`--check`). Il gate le MODÈLE et non le rendu : ce dernier grave le SHA de HEAD (29
    // fichiers sur 54 mesurés), donc il n'a pas de point fixe, et pèse 1 806 fichiers / 24 Mo
    // pour le seul core. Câblé dans ci:local + ci.yml. Déclaré dans le commit qui le crée.
    // Doc V3, Étape 3 item 7 — le 2ᵉ générateur : `profiles/schemas/*.json` →
    // `docs/reference/PROFILE_SCHEMA_REFERENCE.md`, gaté en fraîcheur (`--check`) et
    // doté d'un mode `--audit` qui compare aux 128 paramètres du rédigé. Câblé dans ci:local
    // et ci.yml, déclaré dans le commit qui le crée.
    "gen-attributes-report.cjs",
    "gen-profile-schema-reference.cjs",
    "gen-api-surface.cjs",
    "gen-config-reference.cjs",
    // socle-init S8 — compose une entrée depuis une liste de capacités, en DÉRIVANT les cinq
    // choses qu'une entrée écrite à la main recopie (const installer, ordre de `FULL`, chemins
    // d'import, façades ré-exportables, dépendances). Pas câblé dans `ci:local` : sa garde est
    // portée par `packages/core/__tests__/guards/generated-entries.guard.test.ts`, que la suite
    // existante ramasse — voir l'en-tête de ce garde pour le motif (PARITY-11).
    "gen-entry.cjs",
    "generate-pwa-icons.cjs",
    "generate-vector-tiles.cjs",
    "golden-master.cjs",
    // Doc V3, Étape 3 sous-tâche 1 — mesure la surface que TypeDoc rendrait s'il était
    // élargi (`expand` + `packages`). DÉLIBÉRÉMENT hors ci:local : elle ne garde rien, elle
    // mesure. Elle est versionnée parce que la roadmap porte SES chiffres, et qu'un chiffre
    // sans commande qui le réimprime se fossilise (mode d'échec n° 5 de CLAUDE.md) — la
    // passe 21 a justement retiré trois chiffres de la roadmap pour ce motif, elle ne peut
    // pas en écrire quatre nouveaux du même régime. N'écrit rien dans le dépôt.
    "probe-typedoc-surface.mjs",
    "publish-plugins.cjs",
    // Portage de l'atelier vers le dépôt public `geoleaf/geoleaf-js` (passage public, S10.A).
    // DÉLIBÉRÉMENT hors ci:local : il parle au réseau et écrit sur un dépôt distant, ce
    // qu'aucune gate ne doit faire. Son `--dry-run` par défaut mesure sans écrire.
    //
    // ⚠️ Il remplace un `cp` à la main qui avait laissé le dépôt public **15 commits en
    // retard**, dont sept sur de la doc publique, sans que rien ne le signale : le clone
    // public est éphémère (créé, poussé, supprimé), donc il n'existait aucun endroit où
    // comparer les deux dépôts, ni où retrouver la liste d'exclusion.
    "port-to-public.cjs",
    // scripts/lib/ — la frontière atelier/public, et le seul domicile de ses quatre motifs.
    // Ils vivaient hors dépôt (`~/.claude/geoleaf-nuit/`), donc sur un seul poste : un
    // portage qui ne les retrouvait pas réintroduisait 39 fichiers d'atelier en sortant vert.
    // Gardé par `public-partition.guard.test.ts`, vu rougir sur deux mutations.
    "public-partition.cjs",
    // T4.5 — ramène `.turbo/cache` sous un budget de taille. DÉLIBÉRÉMENT hors ci:local :
    // le cache est ce qui rend la séquence tenable, un purgeur en tête garantirait le miss
    // sur ce qu'il vient d'évincer (l'argument complet est dans son en-tête). La cadence
    // vit dans `_docs_projet/HYGIENE_CHECKLIST.md`, en fin de sprint.
    "purge-turbo-cache.cjs",
    "purgecss-config.cjs", // scripts/lib/ — shared purgecss config (audit + CI gate)
    "side-effect-modules.cjs", // scripts/lib/ — derived side-effect truth (S6), shared by 2 gates
    "packages.cjs", // scripts/lib/ — derived package registry (ARCHI S9.4), shared by the gates that enumerate packages
    // lib/ — LA forme canonique du bandeau de licence (passage public S3), et son unique
    // domicile : le générateur `--write`, la gate LIC-01/02/04 et la bannière de sortie des
    // bundles (`build-config/rollup.mjs`) la lisent tous les trois ici. Une gate et son
    // générateur qui portent chacun leur copie de la règle divergent, et le désaccord se lit
    // comme « la gate rougit sur un bundle qu'on vient de bannériser ».
    "license-banner.cjs",
    // T4.1 — lib/ : les FORMES de répertoire d'artefact généré, plus la dérivation depuis
    // les producteurs. Trois lecteurs (check 4 et check 5 ici, check 2 de
    // check-package-files.cjs). Déclarée dans le commit qui la crée — le dépôt a raté ce
    // geste trois fois (voir verify-seam-drift.cjs, test-load-sites.cjs et les .mjs).
    "generated-artifacts.cjs",
    // T5.7 — lib/ : les 3 tables de motifs de CE fichier, plus leurs témoins à réponse
    // connue. Deuxième lecteur : `probe-gate-visibility.cjs`, qui ne pouvait pas les
    // interroger tant qu'elles vivaient ici (ce script s'exécute à l'import). Déclarée
    // dans le commit qui la crée — quatrième occasion de ne pas rater ce geste.
    "hygiene-patterns.cjs",
    // T5.8 — le pendant de CE fichier. Il vérifie qu'un script invoqué par `ci:local` est
    // SUIVI par git ; ici on vérifie qu'un script de `scripts/` est DÉCLARÉ. Les deux
    // moitiés sont nécessaires : un fichier non tracé est invisible du corpus du check 1,
    // et une entrée d'allowlist sans fichier n'est pas une erreur.
    "verify-ci-scripts-tracked.cjs",
    // L'autre moitié de la même propriété : `verify-ci-scripts-tracked` garantit que tout
    // script invoqué par `ci:local` est TRACÉ, celle-ci que toute gate de `ci.yml` est
    // INVOQUÉE — ou exemptée avec son motif et son témoin. La liste des gates reposait
    // jusqu'ici sur un commentaire « Keep this list in sync », c'est-à-dire sur rien.
    "verify-ci-parity.cjs",
    "ci-parity.cjs", // scripts/lib/ — parseur ci.yml + résolveur de feuilles, lu aussi par ci-local.cjs
    // La gate gitleaks de ci.yml rejouée localement par son BINAIRE (l'action, elle, n'est
    // pas reproductible). Épinglée sur la version exacte qu'installe l'action.
    "gitleaks-local.cjs",
    // T6.1 — gate de couverture du BOOT du bundle livré (pas « couverture E2E » : un seul
    // spec sur 36 la produit). Enveloppe `report:e2e` d'un plancher de témoin, parce que
    // `nyc report` est vert sur une donnée vide. Déclarée dans le commit qui la crée.
    "verify-e2e-coverage.cjs",
    "simplify-geojson.cjs",
    "smoke-test.cjs",
    "validate-docs-examples.cjs",
    "typecheck-docs-examples.cjs", // B.20 — compile les exemples ts de la doc (arité, exports fantômes)
    "validate-profiles.cjs",
    // TPL-CFG (7.1b) — refuse un `_config.json` pour une couche produite par
    // `layerTemplates` : son `inlineConfig` « skips the fetch entirely », donc le fichier
    // n'est lu par personne mais se fait éditer. 24 fantômes retirés. CI + ci-local.
    "check-template-layer-configs.cjs",
    "check-package-files.cjs",
    // ESM-PURITY (socle-init S2, tâche 2.1′) — aucun spécificateur NU dans un `dist/` publié,
    // hors allowlist dérivée des `peerDependencies`. CI + ci-local.
    // ⚠️ Inscrit ici par la session Sprint 1, au moment où `git add` a rendu le script SUIVI :
    // ce gate ne voit que les fichiers trackés, donc il ne pouvait pas rougir tant que le
    // script restait sur le disque sans être indexé. L'entrée précède donc son commit.
    "verify-esm-purity.cjs",
    "verify-core-standalone.cjs",
    // ARCHI S7 (7.4) — frontière symétrique : plugins → core.
    "verify-plugin-core-boundary.cjs",
    // PLUGINS S9 — les COPIES délibérées de part et d'autre de cette frontière, gelées par hash.
    // ⚠️ Déclarée au S11 seulement : elle rougissait ce gate depuis son commit au S9, exactement
    // comme `test-load-sites.cjs` plus bas. Poser une gate sans l'inscrire ici la fait passer
    // pour un script jetable — le réflexe est de faire les deux gestes dans le même commit.
    "verify-seam-drift.cjs",
    // PLUGINS S10 — tout `var(--gl-*)` référencé doit être défini, ou posé au runtime (allowlist).
    "verify-css-tokens.cjs",
    // PLUGINS S11.1 — la 3ᵉ frontière : re-définition locale d'un utilitaire canonique de
    // `@geoleaf/host-runtime` au lieu de l'importer.
    "verify-plugin-shared-fork.cjs",
    // 09/08/2026 — aucun secret dans une variante LIVRABLE de `deploy/`. Comble l'angle mort
    // entre `gitleaks` (qui scanne des plages de COMMITS) et `.gitignore` (qui couvre le canal
    // git) : `deploy/` est git-ignoré, donc invisible aux deux, tout en étant ce qui part chez
    // un client. Un JWT `geoleaf_editor` non expiré y a vécu jusqu'à cette date.
    "verify-deploy-no-secrets.cjs",
    // 09/08/2026 — ce qu'on LIVRE dit ce qu'il exige de son serveur (SC-01/02/03). Sœur de la
    // gate ci-dessus, et même angle mort d'origine : le fait « sans le type MIME de `.mjs`,
    // rien ne boote » était écrit dans `docker/nginx.dev.conf`, c'est-à-dire dans un fichier
    // de DEV qui ne part pas avec le dossier — son propre commentaire l'admettait. Un
    // `deploy-full` copié sur une prod nginx n'a pas booté ce jour-là.
    "verify-deploy-server-contract.cjs",
    // lib/ — le contrat serveur lui-même : les 3 fichiers émis dans chaque livrable, plus le
    // prédicat `declaresMjsType()` qui dit ce que « déclarer le type » veut dire. Un seul
    // corpus, deux lecteurs (build-deploy + la gate) — patron de `boot-assets.cjs`.
    "server-contract.cjs",
    // lib/ — retrait des liaisons vers le backend de PREUVE (`qgis.geoleaf.dev`) des variantes
    // livrables, gardé par DNS-05. ⚠️ Nomme les hôtes de dev, JAMAIS une allowlist de
    // fournisseurs : celle-ci supprimerait en silence le backend de prod d'un profil client.
    "dev-backend.cjs",
    // ARCHI S5 (5.3) — propriété du namespace GeoLeaf.
    "verify-globals-ownership.cjs",
    "verify-no-leaflet.cjs",
    "probe-gate-visibility.cjs", // ARCHI S10.2 — méta-gate : les gates voient-elles un package imbriqué ?
    "verify-plugin-contract.cjs",
    // 08/08/2026 — le gabarit de plugin est le seul paquet qu'aucune gate ne lit : ESLint
    // l'ignore (ses jetons `__PLUGIN_NAME__` ne sont pas du TS valide) ET il est hors des globs
    // `workspaces` (`!packages/_*`). Cette gate scaffolde deux formes et éprouve la SORTIE,
    // qui, elle, est du TS valide — seul canal par lequel un fichier à jetons peut être tenu à
    // la barre du code qu'il engendre.
    "verify-plugin-scaffold.cjs",
    "verify-purgecss.cjs",
    // T2.6 — le contrat HTML/JS de l'application extraite vers apps/geoleaf-app/. Recueille
    // les 2 assertions qui vivaient dans `bundle.test.js` (un test de la LIBRAIRIE qui lisait
    // un fichier de l'APP) et ajoute 3 invariants que rien ne gardait : le chemin d'icônes
    // dont dépend la réécriture du déploiement, et la forme MONO-LIGNE du commentaire
    // `Optional plugins` et des <script> de plugins gatés — tous patchés par des regex `/gm`
    // sans flag `/s`, donc un simple retour à la ligne les faisait manquer en silence.
    "verify-app-template.cjs",
    "verify-repo-hygiene.cjs", // this file
    // ARCHI S6 — les déclarations publiées doivent être ATTEIGNABLES (condition `types`).
    "verify-published-types.cjs",
    // API S2 — SUBPATH-RESOLVE : résout les DEUX branches (`types` et runtime) de chaque
    // cible d'`exports`. PUB-TYPES ne voyait que la première, d'où 13 sous-chemins
    // `./facades/*` qui typecheckaient puis levaient ERR_MODULE_NOT_FOUND.
    // ⚠️ Absent de cette liste jusqu'au T2 pour une raison simple : le fichier n'était pas
    // SUIVI PAR GIT, alors que ci-local.cjs l'invoquait — donc l'hygiène ne le voyait pas,
    // et un clone frais échouait au lancement (item 5.6 de roadmap_structure-monorepo).
    "check-subpath-resolve.cjs",
    // ARCHI S11 — l'arborescence commentée et sa gate. `lib/source-inventory.cjs` porte la
    // règle « documenté ou non » partagée par les deux : une seule définition, deux lecteurs.
    "generate-docs-tree.cjs",
    "check-module-headers.cjs",
    "check-tsdoc-conformity.cjs", // TSDOC-01/02/03 — @param ↔ signature, gate `check:tsdoc`
    "emit-ambient-types.cjs", // B-46 — publie le namespace global avec le paquet (post-build core)
    "source-inventory.cjs",
    // B-75 (30/07/2026) — moteur PARTAGÉ d'extraction des `@example` du TSDoc. Écrit pour
    // B-44 dans `typecheck-docs-examples.cjs`, extrait quand `validate-docs-examples.cjs` a
    // eu besoin du même corpus : une définition, deux lecteurs, comme `source-inventory.cjs`
    // ci-dessus. Le recopier aurait créé deux extracteurs à faire diverger.
    "tsdoc-examples.cjs",
    // lib/ — socle-init S4.7, MÊME motif que `tsdoc-examples.cjs` juste au-dessus, et il n'est
    // pas une coïncidence : la dérivation « ce que le premier chargement demande » vivait dans
    // `build-deploy.cjs`, qui l'INJECTE, et la gate de payload a eu besoin de la PESER. Deux
    // extracteurs auraient divergé, et celui des deux qui n'est pas maintenu serait sorti vert
    // en mesurant autre chose. Une définition, deux lecteurs.
    "boot-assets.cjs",
    // lib/ — socle-init S4.1, allègement des GeoJSON au déploiement (arrondi des coordonnées,
    // et un Douglas-Peucker DÉSARMÉ dont le relevé est écrit sur place). À part de
    // `build-deploy.cjs` parce que ses réglages sont des CHIFFRES qu'on veut pouvoir
    // ré-éprouver sans rebâtir un déployé entier — et c'est exactement ce qui a permis de
    // mesurer que DP ne rendait que 10 % du gain, puis de le retirer.
    "geojson-slim.cjs",
    // API publique S3.4 — cliquet sur les événements non typés (EM-01/EM-02).
    "check-event-map-coverage.cjs",
    // API publique S3.5 — `GeoLeafHost` ⊆ `GeoLeafGlobal` ⊆ oracle post-boot (HOST-01/02/03).
    "verify-host-contract-sync.cjs",
    // B.48 / Sprint 0 COUVERTURE — outillage de test borné.
    "run-tests.cjs", // lanceur des tests unitaires : borne l'essaimage turbo × workers vitest
    "test-scope.cjs", // lib/ — les 2 périmètres de test + l'invariant `ci:local ⊇ ci.yml`
    // lib/ — définition unique de « qu'est-ce qu'un site require() dans un test », partagée par
    // le gate `verify-test-load-mode.cjs` et l'instrument `audit-test-load-conversion.cjs`. Les
    // deux en portaient une copie et elles avaient déjà divergé (COUVERTURE S2.5). Extraite au
    // S5, elle n'avait pas été déclarée ici : le gate d'hygiène la voyait comme un script
    // jetable et rougissait, alors que `verify-test-load-mode.cjs` en DÉPEND.
    "test-load-sites.cjs",
    // Sprint 1 COUVERTURE — le garde-fou et l'étalonnage de la mesure.
    "verify-test-load-mode.cjs", // baseline des `require()` de source, ne peut que descendre
    "verify-coverage-attribution.cjs", // la gate qui vérifie l'APPAREIL de mesure, pas le code
    // ── Les .mjs de scripts/ ────────────────────────────────────────────────────
    //
    // Déclarés lors de l'extension du check 1 aux `.mjs`. Ils étaient tracés, invoqués
    // et JAMAIS contrôlés : le check ne testait que `.cjs`. `knip-hints-reporter.mjs`
    // est le témoin — créé et câblé dans `check-dead-code.cjs` la veille, déclaré dans
    // ARCHITECTURE.md et dans l'arborescence qualifiée, mais dans aucun registre
    // d'hygiène, faute de règle à violer. Troisième occurrence de la même défaillance
    // après `verify-seam-drift.cjs` et `test-load-sites.cjs` (voir leurs commentaires
    // ci-dessus) : le registre discipline 64 `.cjs` et disciplinait 0 `.mjs`, alors que
    // le nouvel outillage s'écrit en ESM.
    "check-fgb-index.mjs", // outil manuel de préparation de données FlatGeobuf (CDC_plugin-flatgeobuf §187)
    "probe-boot-contract.mjs", // sonde manuelle Chromium — seul oracle de l'ORDRE des marks de boot
    // Sonde manuelle Chromium — le SW est-il observable sous Playwright ? Elle PORTE le
    // piège qui coûte une journée à retrouver : `ignoreHTTPSErrors` est un drapeau de
    // CONTEXTE et ne couvre pas le fetch du SCRIPT de Service Worker, alors que
    // `isSecureContext` rend `true` quand même. Consommée par les helpers `e2e/helpers/
    // {offline,idb}.js`, qui reprennent ses réponses (trafic vu au niveau CONTEXTE, requête
    // coupée qui compte quand même).
    "probe-sw-observability.mjs",
    // Sonde manuelle Chromium — laquelle des DEUX branches de tuiles sert réellement ?
    // Elle existe parce que 3.13 ne se pré-vole PAS au grep de symbole : un décompte non
    // nul ne prouve pas la vie, un décompte nul ne prouve pas la mort. Elle porte le
    // relevé qui a REQUALIFIÉ la décision A7 (03/08/2026) : le Cache API porte 24 tuiles
    // et les SERT hors ligne, pendant que `cacheProfile()` en écrit 0 en IndexedDB.
    "probe-tile-cache-arbitration.mjs",
    // Sonde manuelle Chromium — le trim du cache de tuiles S'EXÉCUTE-T-IL VRAIMENT ?
    // (tâche 1.2 de `roadmap_socle-init`, 07/08/2026). VERSIONNÉE parce que sa section de
    // vérification pose la condition en toutes lettres : « une éviction jamais vue s'exécuter
    // ne borne rien ». Les suites unitaires exécutent le worker contre une Cache API SIMULÉE —
    // elles ne disent rien de l'ordre d'insertion rendu par un vrai `cache.keys()`, ni de
    // milliers de `cache.delete()` qui aboutissent, ni du fait que le bundle DÉPLOYÉ (copié,
    // patché par regex, minifié) porte encore le code écrit. Relevé qu'elle porte, rejouable :
    // cache semé à 2 100, une navigation, 2 100 → 1 623 — et 2 100 → 2 124 sur la mutation qui
    // retire l'appel au trim, soit exactement les 24 tuiles que sa voisine ci-dessus avait
    // comptées le 03/08. C'est le seul instrument du dépôt qui distingue les deux.
    "probe-tile-cache-trim.mjs",
    // Sonde manuelle Chromium — les origines tierces de BOOT sont-elles réellement à zéro, et
    // la CSP resserrée ne casse-t-elle rien ? (S5.4/5.5/5.6, 08/08/2026). VERSIONNÉE parce que
    // c'est le SEUL instrument qui couvre ce lot : `verify-app-template.cjs` ne lit ni la CSP ni
    // les balises tierces (0 occurrence de `unpkg|CSP|script-src|font|integrity`), et
    // `e2e/18-security.spec.js` n'asserte QUE des évènements `securitypolicyviolation`, donc il
    // est indifférent à la liste des origines autorisées — la roadmap l'avait cru gardien et
    // s'était trompée de fichier. Relevé qu'elle porte, rejouable : sur les 2 variantes, carte
    // rendue avec canvas, `maplibregl` présent, **0 violation CSP, 0 requête vers unpkg.com /
    // fonts.googleapis.com / fonts.gstatic.com**. Vue ROUGE en remettant la feuille Google Fonts
    // dans la source puis en rebâtissant : 1 violation `style-src-elem` + 1 origine, nommées.
    // ⚠️ Elle distingue les origines de BOOT des hôtes de RUNTIME (tuiles OpenTopoMap, USGS,
    // S3) — une première rédaction comptait tout ce qui n'était pas same-origin et rendait un
    // rouge faux sur des fetchs parfaitement légitimes.
    "probe-csp-origins.mjs",
    // Sonde manuelle Chromium — la CASCADE du premier chargement (tâche S11.1, 08/08/2026).
    // VERSIONNÉE pour le motif exact de ses deux voisines : les 5 chiffres que le CHANGELOG
    // devait publier venaient d'une sonde ad hoc JAMAIS committée, donc ni rejouables ni
    // contredisables — mode d'échec n° 5, un chiffre qui se fossilise faute de pouvoir se
    // périmer. Elle porte 6 assertions dérivées de la page, AUCUN décompte en dur : c'est
    // précisément un « 4 chunks » recopié qui s'est révélé faux (il y en a 3).
    // ⚠️ Comme `probe-csp-origins.mjs`, elle vise les vhosts nginx et n'est donc PAS câblée
    // dans `ci:local` — le gain qu'elle mesure est réel et n'est pas gardé, ce qui doit se
    // dire plutôt que se supposer.
    // 🛑 VUE ROUGE deux fois avant d'être crue. La seconde tranche : sur un `modulepreload`
    // retiré du déployé, W-06 rougit en NOMMANT le chunk pendant que W-02 et W-03 restent
    // vertes — elle voit ce qu'aucune autre ne voit. Le piège B-168 a dû être rejoué au
    // passage : sans écarter les `.gz`/`.br`, nginx sert l'ancien markup et la mutation
    // reste invisible.
    "probe-boot-waterfall.mjs",
    // Sonde manuelle Chromium — le rapatriement borné écrit-il RÉELLEMENT dans le store
    // `features` ? (tâche 4.1, 04/08/2026). VERSIONNÉE délibérément : 4.3 avait prouvé sa
    // lecture locale avec une sonde ad hoc jamais committée, dont la mesure ne peut donc plus
    // être rejouée ni contredite — le mode d'échec n° 5 du pré-vol, un chiffre qui se
    // fossilise faute de pouvoir se périmer. Elle porte quatre mesures que ni les tests
    // unitaires ni l'E2E ne peuvent rendre : store vide → 27 écrites (toutes `serverId` +
    // `VersionMarker` + `synced`), emprise discriminante → 11, et le plafond DUR — le
    // chargeur OGC rend 20 pour un plafond de 15, le store en porte 15. C'est aussi elle qui
    // a attrapé que `Config.Profile` n'est pas monté sur le namespace global, alors que le
    // test unitaire était vert en moquant la forme espérée.
    "probe-offline-pull.mjs",
    // Tâche 4.8/4.10 — VERSIONNÉE pour le même motif que sa voisine ci-dessus : une mesure
    // qu'on ne peut pas rejouer ne peut pas être contredite, donc elle se fossilise. Elle porte
    // six mesures dont UNE que ni l'unitaire ni l'E2E ne rendent — M6 : la purge de cache
    // retire-t-elle les entités `synced` en laissant l'OUTBOX INTACTE ? Le test unitaire éprouve
    // la règle ; la sonde éprouve que le bouton câblé au bundle LIVRÉ l'applique, à travers une
    // façade, un contrat de plugin et un chunk différé. C'est le défaut que B-115 décrivait, et
    // il ne se voit qu'ici de bout en bout : mesuré 26 entités purgées, outbox intacte.
    "probe-sync-report.mjs",
    // B-218/B-219 — l'instrument qui a établi que `performance.memory` est FIGÉE par Chrome, et
    // le seul qui puisse le rejouer : il compare les 4 candidats de mesure de tas à N = 0 / 10 000
    // / 30 000 entités, sur le déployé, dans un vrai Chromium. Sans lui, les deux lignes se
    // fossilisent — un verdict qu'on ne peut pas re-mesurer ne se périme pas. Elle n'est PAS
    // jetable : `e2e/helpers/perf-gate.js` et `e2e/helpers/README.md` la citent comme la source
    // des bandes qu'ils assertissent, et le §Re-mesure de B-219 en fait sa recette.
    "probe-heap-metrics.mjs",
    // B-217 — l'oracle de clustering DÉTERMINISTE qui a remplacé l'invariant de FPS, lequel
    // tranchait à 5 fps une grandeur dont le bruit mesuré va de 31 à 52. Citée par
    // `e2e/06-performance-baseline.spec.js`, qui en dépend pour son critère : la retirer
    // laisserait le spec sans la mesure qui justifie son seuil.
    "probe-cluster-oracle.mjs",
    "knip-hints-reporter.mjs", // lib/ — reporter knip des configurationHints, que le reporter `json` n'émet pas
    // API publique S4.1 — lib/ : LA description de la surface `globalThis.GeoLeaf`, et la
    // marche qui la mesure. Quatre lecteurs : les deux tests de surface, la sonde Chromium
    // (qui la transporte par sa SOURCE, d'où l'auto-suffisance de `walkNamespace`) et
    // `verify-host-contract-sync.cjs`, qui lit son AST au lieu de parser un fichier de test
    // au texte. Déclarée dans le commit qui la crée — cinquième occasion de ne pas rater ce
    // geste, et la première où le check l'a dit lui-même : il est resté VERT tant que le
    // fichier n'était pas suivi par git, ce que `verify-ci-scripts-tracked.cjs` existe pour
    // rattraper de l'autre côté.
    "namespace-surface.mjs",
    // API publique S4.2 — l'invariant inverse de HOST-SYNC : toute clé du namespace est
    // déclarée dans `GeoLeafGlobal` (HOST-04), la liste des non typées ne peut que rétrécir
    // (HOST-05), et une déclaration VIDE ne compte pas comme un typage (HOST-06).
    "check-namespace-typing-coverage.cjs",
    // lib/ — les deux lecteurs d'AST sortis de `verify-host-contract-sync.cjs` le jour où la
    // gate ci-dessus en a eu besoin des DEUX. Deux copies d'un lecteur dérivent, et la dérive
    // reste invisible tant que les deux gates sortent vertes.
    "ts-decl-read.cjs",
    // Contrat inverse S1.8 — le contrat INVERSE : ce dont l'aval DÉPEND n'a pas disparu.
    // CC-00 à CC-09. Elle saute avec un motif nommé quand `GEOLEAF_CONSUMERS` n'est pas défini.
    "verify-consumer-contract.cjs",
    // lib/ — le lecteur des manifestes de consommation, et le PLANCHER DE VERSION qui refuse
    // de conclure sur un fichier plus ancien que celui contre lequel la gate a été écrite. Le
    // manifeste vit dans un AUTRE dépôt, sur une branche : sans ce plancher, un `git checkout`
    // là-bas ferait sortir la gate verte en ayant lu autre chose.
    "consumer-manifest.cjs",
    // lib/ — le relevé de littéraux `geoleaf:*` et ses TROIS familles d'exclusion, sortis de
    // `check-event-map-coverage.cjs` le jour où CC-07 en a eu besoin des quatre. Même règle,
    // même motif : un second lecteur déclenche l'extraction.
    "event-names.cjs",
    // lib/ — les DEUX racines de la documentation, publique (`docs/`) et interne
    // (`_docs_projet/`), et le garde qui JETTE quand l'une manque. Onze scripts et trois
    // guards de test écrivaient `_docs_projet` en dur : un chemin en dur ne casse pas au
    // déplacement du répertoire, il rend `[]` — le générateur écrit alors où plus personne
    // ne lit, et la gate annonce « 0 résultat » en sortant 0. Quatorze lecteurs sur quinze
    // ont été VUS jeter dessus, avant le déplacement.
    "docs-paths.cjs",
]);

// ─── Allowlist — the .cjs/.mjs files that legitimately live OUTSIDE scripts/ ──
//
// PATH-keyed, and deliberately a SEPARATE set from SCRIPTS_ALLOWLIST above. That one
// is keyed by BASENAME: sharing it would let a package-level `benchmark.cjs` or
// `packages.cjs` inherit the exemption written for the root tooling script of the
// same name — an exemption nobody granted it. None of these is a maintenance script,
// and the list is expected to stay short: a package has no business carrying scripts
// of its own (that is what root `scripts/` is for).
const OUTSIDE_SCRIPTS_ALLOWLIST = new Set([
    // Filename imposed by nyc, read from the repo root for the e2e coverage run.
    "nyc.config.cjs",
    // Vitest manual mock — `require()`d by __tests__/setup.js and 3 adapter tests,
    // hence .cjs. Listed by PATH rather than exempting `__mocks__/` wholesale: a
    // directory rule would turn it into a hiding place.
    // (STRUCT S7: `setup-esm.js` dropped from this list — the file was deleted, it
    // had no referent in any config, only this comment.)
    "packages/core/__tests__/__mocks__/maplibre-gl.cjs",
    // Binary e2e fixture builders (GeoTIFF / KMZ), cited by 17-cog.spec.js and
    // 15-file-import.spec.js. They are the only way to regenerate two binary
    // fixtures — deleting them would leave files nobody can rebuild.
    "e2e/fixtures/_gen-cog.cjs",
    "e2e/fixtures/_gen-kmz.cjs",
    // Root tool configs — filenames imposed by ESLint and PostCSS.
    "eslint.config.mjs",
    "postcss.config.mjs",
    // `@geoleaf/build-config` IS the shared build configuration (private, never
    // published): its 6 modules are the thing itself, not scripts that happen to live
    // there. Listed by PATH rather than exempting the package directory wholesale —
    // same reasoning as `__mocks__/` above, a directory rule would be a hiding place.
    "packages/build-config/rollup.mjs",
    "packages/build-config/csp-style-inject.mjs",
    "packages/build-config/vitest/base.mjs",
    "packages/build-config/vitest/ensure-tsx-node-options.mjs",
    "packages/build-config/vitest/resolve-js-to-ts.mjs",
    "packages/build-config/vitest/worker-budget.mjs",
]);

// Per-package Rollup configs, recognised STRUCTURALLY by exact basename rather than
// listed: every package that builds carries one, so a list would need a new entry per
// package — precisely the failure mode this file avoids elsewhere by deriving from
// `REGISTRY.all()` instead of hard-coding (see the R.16 note further down). 19 files
// today (18 `rollup.config.mjs` + core's `rollup.consumer.mjs`).
//
// ⚠️ EXACT basenames, deliberately NOT a `rollup*.mjs` glob: a glob would make
// `rollup-quickfix.mjs` a hiding place. A throwaway must not be able to pass by
// choosing its prefix.
const PACKAGE_CONFIG_BASENAMES = new Set(["rollup.config.mjs", "rollup.consumer.mjs"]);

// ─── Patterns ────────────────────────────────────────────────────────────────

// T5.7 — les trois tables vivent désormais dans `lib/hygiene-patterns.cjs`, avec leurs
// témoins. Elles ont un SECOND lecteur (`probe-gate-visibility.cjs`), et ce fichier
// s'exécute à l'import : personne ne pouvait les interroger. Même patron que
// `lib/generated-artifacts.cjs` posé au T4.1 — une définition, plusieurs lecteurs.
//
// Deux corrections y ont été portées, et la seconde n'était pas dans l'énoncé du sprint :
//
//   • ÉLARGISSEMENT. `fix_[\w-]+\.(py|cjs)$` ratait `fix-deferred-paths.js` DEUX fois —
//     tiret au lieu d'underscore, et `.js` absent de l'alternative. C'est exactement la
//     forme du fichier supprimé au T3.2 : un CJS nu dans un paquet `type: module`, cassé
//     à l'exécution.
//
//   • ANCRAGE `\b`, mesuré indispensable. L'énoncé du sprint proposait
//     `/fix[-_][\w-]+\.(py|cjs|js)$/i`, SANS ancre — il prend `prefix-loader.js`,
//     `hotfix-runner.js` et `postfix-util.js`. Le motif d'avant portait déjà le défaut en
//     germe (`suffix_map.cjs` matchait) ; il n'avait jamais tiré faute de fichier de cette
//     forme dans l'index, ce qui est de la chance, pas une garantie. `\btmp_` et
//     `\bscratch_` étaient ancrés, `fix_` ne l'était pas : l'incohérence était le défaut.
const {
    THROWAWAY_PATTERNS,
    ARTIFACT_PATTERNS,
    BYTECODE_PATTERNS,
} = require("./lib/hygiene-patterns.cjs");

const MAX_LINES = 700;

// Files with explicit ESLint max-lines: off override (deliberate exception)
const OVERSIZED_ALLOWLIST = new Set(["packages/core/src/kernel/security/index.ts"]);

// ARCHI S10.2 — chemins dérivés du registre, jamais construits en dur sous
// `packages/` : après le regroupement du S10 ils n'auraient plus existé,
// `collectSourceFiles` serait sorti sur son `existsSync`, et le contrôle des 700
// lignes n'aurait plus rien mesuré — sans un mot.
//
// ─── R.16 (24/07/2026) — périmètre élargi de 3 à 18 packages ─────────────────
//
// Le périmètre était `["core", "plugin-storage", "plugin-addpoi"]` : le dépôt
// appliquait à 3 packages un contrôle dont il exemptait les 15 autres. Il couvre
// désormais les 18, via `REGISTRY.all()` — un package neuf y entre sans que
// personne ait à y penser, ce qu'une liste ne fait jamais.
//
// L'extension était l'autre cécité : seuls les `.ts` étaient comptés, alors que la
// règle projet porte sur `.ts`, `.js` ET `.css`.
//
// ─── La limite vise le CODE, jamais les TESTS (arbitrage MP, 24/07/2026) ─────
//
// L'élargissement a d'abord été mesuré tests compris : il remontait 15 fichiers,
// **tous des fichiers de test**, et AUCUN fichier source du dépôt ne dépasse 700
// lignes. Ce résultat a tranché la question plutôt que d'ouvrir un chantier : la
// limite existe pour tenir la lisibilité et la modularité du code livré, pas pour
// contraindre une suite de tests — un fichier de test long est souvent long parce
// qu'il couvre exhaustivement, ce qui est la propriété recherchée.
//
// Les tests sont donc HORS PÉRIMÈTRE, par répertoire ET par nom de fichier (voir
// `TEST_DIRS` / `TEST_FILE_RE`) : `packages/core/__tests__/` est à la racine du
// package, `src/__tests__/` chez les 15 autres, et un `*.test.ts` peut vivre
// ailleurs. Couvrir les trois formes évite qu'un déplacement — R.14 va justement
// en provoquer un — remette silencieusement des tests dans le périmètre.
const REGISTRY = require("./lib/packages.cjs");
const SOURCE_DIRS = REGISTRY.all().map((pkg) => path.join(pkg.absDir, "src"));

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".turbo"]);

/** Répertoires de test — hors périmètre de la limite de lignes. */
const TEST_DIRS = new Set(["__tests__", "__mocks__", "test-utils", "e2e", "fixtures"]);

/** Fichiers de test hors répertoire dédié — `foo.test.ts`, `foo.spec.js`. */
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]s$/;

// Répertoires d'artefacts GÉNÉRÉS : mesurer la taille d'un fichier que personne
// n'écrit à la main n'apprend rien et produit un warning permanent.
//
// ⚠️ T4.1 — la liste vivait ICI, sous la forme
// `/\/(docs\/api|docs\/public\/api|docs-dist)\//`, et elle matchait **zéro fichier** :
// son seul lecteur était `collectSourceFiles`, borné à `<pkg>/src`, où aucun de ces
// chemins ne vit. Le dépôt portait donc la liste de ses répertoires d'artefacts sans
// qu'elle regarde quoi que ce soit, pendant que 90 fichiers TypeDoc étaient suivis et
// publiés. Elle est désormais dans `lib/generated-artifacts.cjs`, avec le check 5 comme
// second lecteur — celui qui la rend enfin porteuse.
const {
    generatedRootOf,
    isGeneratedPath,
    declaredOutputs,
    gitIgnoredSet,
} = require("./lib/generated-artifacts.cjs");

/** Extensions soumises à la limite de lignes — la règle projet vise ces trois. */
const SOURCE_EXTENSIONS = [".ts", ".js", ".css"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

// `core.quotePath=false` : sans lui, git échappe les octets non-ASCII ET entoure le
// chemin de guillemets. Deux des fichiers TypeDoc du T4 sortaient en
// `"packages/core/docs/api/documents/PWA_\342\200\224_….html"` — guillemets compris. Le
// matching par segments y survit, l'AFFICHAGE non : le rapport nommait un chemin qu'on
// ne pouvait pas copier-coller. Sans effet sur les chemins ASCII, donc sans effet sur
// les checks 1/1b/2/3.
const LS_FILES = "git -c core.quotePath=false ls-files";

function getTrackedFiles() {
    try {
        return execSync(LS_FILES, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
        console.error("ERROR: git ls-files failed — not a git repository?");
        process.exit(1);
    }
}

/**
 * Every file git can see: the index PLUS the untracked-and-not-ignored worktree.
 *
 * Check 1b cannot use getTrackedFiles(), for two reasons:
 *   - `probe-gate-visibility.cjs` plants its fixture on DISK and never stages it. A
 *     check reading only the index is therefore unprobeable — and the only way to
 *     probe it would be to `git add` the fixture, which a crashed run would leave
 *     behind. That is worse than the blindness being hunted.
 *   - a throwaway script is worth catching BEFORE it is committed, not after.
 *
 * `--exclude-standard` is what makes the wider corpus safe: dist/, coverage/,
 * node_modules/, deploy/, .turbo/, and `tmp_*` / `scratch_*` / `_archive_local/`
 * are all git-ignored, so the sanctioned parking place for one-shot scripts stays
 * out of scope for free — there is no directory exclusion list to maintain, and
 * none to drift from .gitignore.
 */
function getGitVisibleFiles() {
    try {
        const out = execSync(`${LS_FILES} --cached --others --exclude-standard`, {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024,
        });
        // A Set because an unmerged path is listed once per conflict stage.
        return [...new Set(out.split("\n").filter(Boolean))];
    } catch {
        console.error("ERROR: git ls-files failed — not a git repository?");
        process.exit(1);
    }
}

function collectSourceFiles(dir, out) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !TEST_DIRS.has(entry.name)) {
                collectSourceFiles(full, out);
            }
        } else if (
            SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) &&
            !entry.name.endsWith(".d.ts") &&
            !TEST_FILE_RE.test(entry.name) &&
            !isGeneratedPath(full)
        ) {
            out.push(full);
        }
    }
}

function countLines(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

function matchesAny(filePath, patterns) {
    return patterns.find((p) => p.re.test(filePath));
}

// ─── Check 1+2+3 — Git-tracked files ─────────────────────────────────────────

const trackedFiles = getTrackedFiles();

const throwawayHits = [];
const artifactHits = [];
const bytecodeHits = [];

for (const f of trackedFiles) {
    const basename = path.basename(f);
    const isInScripts = f.startsWith("scripts/");

    // Throwaway: .cjs/.mjs in scripts/ not in the register
    const isScript = basename.endsWith(".cjs") || basename.endsWith(".mjs");
    if (isInScripts && isScript && !SCRIPTS_ALLOWLIST.has(basename)) {
        throwawayHits.push({ file: f, label: "unlisted scripts/ module" });
        continue;
    }

    const throwaway = matchesAny(f, THROWAWAY_PATTERNS);
    if (throwaway) {
        throwawayHits.push({ file: f, label: throwaway.label });
        continue;
    }

    const artifact = matchesAny(f, ARTIFACT_PATTERNS);
    if (artifact) {
        artifactHits.push({ file: f, label: artifact.label });
        continue;
    }

    const bytecode = matchesAny(f, BYTECODE_PATTERNS);
    if (bytecode) {
        bytecodeHits.push({ file: f, label: bytecode.label });
    }
}

// ─── Check 1b — .cjs outside root scripts/ ───────────────────────────────────
//
// Check 1 above governs `scripts/` and nothing else. Nothing governed a `.cjs`
// living anywhere else — and no other tool did either: knip narrows every package
// workspace to `project: ["src/**/*.ts"]` (knip.js), and ESLint ignored
// `**/scripts/**/*.{cjs,js}` plus `**/cov-*.cjs` outright. Five dead scripts sat in
// that gap for months with zero consumers and zero npm scripts:
// `packages/core/cov-check.cjs` and `cov-detail.cjs` at the PACKAGE ROOT, and three
// under `packages/core/scripts/` — one of which (`fix-deferred-paths.js`) was bare
// CommonJS inside a `"type": "module"` package, i.e. broken the moment anyone ran it.
// They were found by an audit, not by a gate. This is the gate (T3.5).
//
// The scope is the WHOLE repository minus `scripts/`, and not `<pkg>/scripts/`:
//   - two of the five were at a package root, so a `scripts/`-shaped rule would have
//     missed the majority of the very files it was written for;
//   - `packages/core/scripts/` was the ONLY package-level `scripts/` in the repo, so
//     that rule would have scanned zero files the day T3.2 deleted it, and stayed
//     vacuously green forever — green because it looked at nothing;
//   - a repo-wide scope needs no package enumeration, so it also covers the two
//     places `REGISTRY.all()` cannot see: `packages/_plugin-template/` (excluded by
//     the `!packages/_*` workspace glob, and copied VERBATIM into every new plugin
//     by `create-plugin.cjs`, so a stray there would multiply), and any future
//     directory outside the workspace globs.
//
// A vacuously-green gate is exactly the failure class `probe-gate-visibility.cjs`
// exists for: it plants `packages/plugins/__probe__/probe-throwaway.cjs` — untracked,
// at the package root — and asserts THIS check names it. Narrowing this scope back to
// `<pkg>/scripts/`, or reading only the index, turns the meta-gate red.

// Hissé : le check 5 partage ce corpus, et pour la même raison qu'ici. Un seul appel git.
const gitVisibleFiles = getGitVisibleFiles();

const strayCjsHits = [];

for (const f of gitVisibleFiles) {
    if (!f.endsWith(".cjs") && !f.endsWith(".mjs")) continue;
    if (f.startsWith("scripts/")) continue; // governed by check 1's basename register
    if (OUTSIDE_SCRIPTS_ALLOWLIST.has(f)) continue;
    if (PACKAGE_CONFIG_BASENAMES.has(path.basename(f))) continue;
    strayCjsHits.push({ file: f, label: "unlisted module outside scripts/" });
}

// ─── Check 4 — TypeScript files > 700 lines (warning only) ──────────────────

const sourceFiles = [];
for (const dir of SOURCE_DIRS) collectSourceFiles(dir, sourceFiles);

const oversizedHits = [];
const seenFiles = new Set();
for (const f of sourceFiles) {
    const rel = path.relative(ROOT, f).replaceAll("\\", "/");
    if (OVERSIZED_ALLOWLIST.has(rel)) continue;
    if (seenFiles.has(rel)) continue; // `src/__tests__` est atteint par deux entrées
    seenFiles.add(rel);
    const lineCount = countLines(f);
    if (lineCount > MAX_LINES) {
        oversizedHits.push({ file: rel, lines: lineCount });
    }
}

// ─── Check 5 — generated artifacts under git control (T4.1) ──────────────────
//
// Le check 2 ci-dessus s'appelle « Build/test artifacts tracked in git » et porte
// `coverage-e2e/`, `.nyc_output/`. Celui-ci pose la MÊME question sur les répertoires de
// doc générée — d'où sa place ici plutôt que dans un script à part, qui aurait porté une
// seconde liste vouée à diverger et qu'il aurait fallu câbler dans ci-local.cjs (49
// étapes) et ci.yml. Le dépôt compte quatre gates posées sans câblage ; l'une porte le
// commentaire « an unrun gate is indistinguishable from no gate ».
//
// ## Le corpus, et la propriété qui en découle
//
// `gitVisibleFiles` = index + worktree non ignoré (`--cached --others
// --exclude-standard`). Table de vérité :
//
//   suivi (l'état d'avant le T4, 91 chemins)      → dans le corpus → ROUGE 5a
//   non suivi ET non ignoré (règle .gitignore qui
//     a cessé de matcher, ou artefact tout neuf)   → dans le corpus → ROUGE 5b
//   non suivi et ignoré (l'état visé)              → hors corpus   → vert
//
// Donc : **la seule façon d'être vert est que chaque fichier généré soit explicitement
// ignoré.** Une gate qui ne peut être verte que grâce à une règle `.gitignore` VIVANTE
// ne peut pas devenir « verte en ne scannant rien » — si la règle meurt (déplacement du
// core, renommage), les fichiers reparaissent dans `--others` et 5b rougit. C'est ce qui
// distingue cette gate de la constante vide-verte qu'elle remplace.
//
// ⚠️ Corollaire pour `.gitignore` : les motifs doivent être ANCRÉS
// (`packages/core/docs/api/`) et non génériques (`**/docs/api/`). Un motif générique
// avalerait la fixture de `probe-gate-visibility.cjs`
// (`packages/plugins/__probe__/docs/api/`), qui n'est jamais indexée : l'assertion
// passerait verte sans plus rien prouver. Le générique PARAÎT plus robuste ; c'est le
// choix qui rend cette gate insondable.

const generatedRoots = new Map();
const trackedSet = new Set(trackedFiles);

for (const f of gitVisibleFiles) {
    const hit = generatedRootOf(f);
    if (!hit) continue;
    const group = generatedRoots.get(hit.root) ?? { ...hit, tracked: 0, loose: 0 };
    if (trackedSet.has(f)) group.tracked++;
    else group.loose++;
    generatedRoots.set(hit.root, group);
}

const generatedHits = [...generatedRoots.values()].sort((a, b) => a.root.localeCompare(b.root));

// 5c — la moitié dérivée du PRODUCTEUR, indépendante de l'état du disque : elle est donc
// vivante sur un clone frais où aucun artefact n'a encore été généré, ce que 5a/5b ne
// peuvent pas tenir (elles ont besoin que les fichiers existent).
const declared = declaredOutputs();
// `noIndex` est indispensable : la question est « une RÈGLE couvre-t-elle ce chemin ? »,
// pas « est-il suivi ? ». Sans lui, git refuse de qualifier d'ignoré un chemin présent
// dans l'index — et la phase ROUGE d'avant-désindexation serait muette sur 5c(ii).
const declaredIgnored = gitIgnoredSet(
    declared.filter((d) => d.rel).map((d) => `${d.rel}/`),
    { noIndex: true }
);

const producerHits = [];
for (const d of declared) {
    if (d.error) {
        producerHits.push({ producer: d.producer, reason: d.error });
    } else if (!generatedRootOf(d.rel)) {
        producerHits.push({
            producer: d.producer,
            reason: `écrit dans ${d.rel} — forme absente de GENERATED_DIR_FORMS`,
        });
    } else if (!declaredIgnored.has(`${d.rel}/`)) {
        producerHits.push({ producer: d.producer, reason: `${d.rel}/ n'est pas gitignoré` });
    }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const WIDTH = 72;
console.log("=".repeat(WIDTH));
console.log("  REPO HYGIENE SCAN");
console.log("=".repeat(WIDTH));
console.log();

function reportCategory(label, hits, formatter) {
    console.log(`--- ${label} (${hits.length}) ---`);
    if (hits.length === 0) {
        console.log("  (none)");
    } else {
        for (const h of hits) console.log("  " + formatter(h));
    }
    console.log();
}

reportCategory("Throwaway scripts tracked in git", throwawayHits, (h) => `${h.file}  [${h.label}]`);
reportCategory("Unlisted modules outside scripts/", strayCjsHits, (h) => `${h.file}  [${h.label}]`);
reportCategory(
    "Build/test artifacts tracked in git",
    artifactHits,
    (h) => `${h.file}  [${h.label}]`
);
reportCategory("Python bytecode tracked in git", bytecodeHits, (h) => `${h.file}  [${h.label}]`);
reportCategory(
    "Generated artifacts under git control",
    generatedHits,
    (h) =>
        `${h.root}  ${h.tracked} suivi(s), ${h.loose} non ignoré(s)  [${h.label}]` +
        (h.tracked > 0
            ? `\n      → git rm -r --cached ${h.root}`
            : "\n      → ajouter une règle .gitignore ANCRÉE")
);
reportCategory(
    "Producers writing outside the ignored set",
    producerHits,
    (h) => `${h.producer} — ${h.reason}`
);
reportCategory(
    `Source files > ${MAX_LINES} lines (WARNING)`,
    oversizedHits,
    (h) => `${h.file}  (${h.lines} lines)`
);

// ─── Summary ─────────────────────────────────────────────────────────────────

const errors =
    throwawayHits.length +
    strayCjsHits.length +
    artifactHits.length +
    bytecodeHits.length +
    generatedHits.length +
    producerHits.length;
const warnings = oversizedHits.length;

console.log("-".repeat(WIDTH));
console.log("  SUMMARY");
console.log("-".repeat(WIDTH));
const throwawayStatus = throwawayHits.length === 0 ? "OK" : throwawayHits.length + " ERROR(S)";
const strayCjsStatus = strayCjsHits.length === 0 ? "OK" : strayCjsHits.length + " ERROR(S)";
const artifactStatus = artifactHits.length === 0 ? "OK" : artifactHits.length + " ERROR(S)";
const bytecodeStatus = bytecodeHits.length === 0 ? "OK" : bytecodeHits.length + " ERROR(S)";
const oversizedStatus =
    oversizedHits.length === 0 ? "OK" : oversizedHits.length + " WARNING(S) — fragmenter";
const generatedTracked = generatedHits.reduce((n, h) => n + h.tracked + h.loose, 0);
const generatedStatus =
    generatedHits.length === 0
        ? "OK"
        : `${generatedHits.length} ERROR(S) — ${generatedTracked} fichier(s)`;
const producerStatus = producerHits.length === 0 ? "OK" : producerHits.length + " ERROR(S)";
console.log("  Throwaway scripts     " + throwawayStatus);
console.log("  Stray modules         " + strayCjsStatus);
console.log("  Build artifacts       " + artifactStatus);
console.log("  Python bytecode       " + bytecodeStatus);
console.log("  Generated artifacts   " + generatedStatus);
console.log("  Artifact producers    " + producerStatus);
console.log("  Source > " + MAX_LINES + "L       " + oversizedStatus);
console.log("-".repeat(WIDTH));
console.log();

if (errors === 0 && warnings === 0) {
    console.log("VERDICT: REPO HYGIENE OK");
    process.exit(0);
} else if (errors === 0) {
    console.log(`VERDICT: ${warnings} warning(s) — no blocking errors`);
    process.exit(0);
} else {
    console.log(`VERDICT: ${errors} error(s) found — fix before merging`);
    process.exit(1);
}
