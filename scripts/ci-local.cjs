#!/usr/bin/env node
/**
 * Local CI runner — reproduces the `.github/workflows/ci.yml` gate sequence on
 * the developer machine. Useful when GitHub Actions is unavailable (frozen / no
 * runner tokens): one command validates the whole pipeline locally.
 *
 * Usage:
 *   node scripts/ci-local.cjs            # all gates except E2E (fast-ish)
 *   node scripts/ci-local.cjs --e2e      # also build deploy variants + Playwright
 *   node scripts/ci-local.cjs --bail     # stop at the first failing gate
 *
 * Exit code: 0 if every (required) gate passed, 1 otherwise. Each gate runs even
 * after a previous failure (unless --bail) so you get the full picture in one go.
 *
 * ## La propriété que ce script doit tenir : `ci:local ⊇ ci.yml`
 *
 * Le protocole de push de CLAUDE.md fait de ce script le SEUL critère avant de dépenser du
 * quota GitHub Actions. « Local vert → push sûr » n'est vrai que si le périmètre local
 * couvre celui du distant — sinon un vert local ne dit rien du run à venir.
 *
 * Elle est vérifiée, pas conventionnée — sur DEUX axes, et il a fallu les deux :
 *
 *   • le PÉRIMÈTRE DES TESTS, par `scripts/lib/test-scope.cjs`, qui jette si le gate unitaire
 *     local testait moins que celui de `ci.yml` ;
 *   • la LISTE DES GATES, par `scripts/verify-ci-parity.cjs` (étape « CI parity »), qui classe
 *     chaque commande de `ci.yml` en couverte / sous `--e2e` / exemptée-avec-témoin, et rougit
 *     sur toute quatrième catégorie.
 *
 * ⚠️ Ce paragraphe a longtemps annoncé la propriété comme vérifiée en ne citant que le premier
 * axe. C'était un SUR-ÉNONCÉ : la liste des gates reposait sur un commentaire « Keep this list
 * in sync with .github/workflows/ci.yml », c'est-à-dire sur un geste manuel là où le fichier
 * annonçait une garde. Le corriger était le vrai objet du 30/07/2026 — pas le rouge du jour.
 *
 * ⚠️ Divergence de FORME assumée, sur le gate unitaire : `ci.yml` lance
 * `npx vitest run` (mode `projects`, un seul processus, 11 paquets), ce script lance
 * `npm test` (essaimage turbo, 17 paquets). Mêmes fichiers de test, ordonnanceurs
 * différents. Le sens de l'inclusion est celui qui compte, et il est dans le bon sens.
 * Cette divergence est désormais une entrée d'`EXEMPTIONS` de la gate de parité, avec un
 * témoin qui rougit si `test-scope.cjs` cessait de porter l'inclusion.
 *
 * ## Ce que ce script ne couvre TOUJOURS pas, et qu'il ÉNONCE
 *
 * Trois choses restent hors de portée, et le résumé de fin de run les nomme désormais plutôt
 * que de les taire : les 4 `E2E_STEPS` (opt-in, coût réel), `check-test-failures.cjs` (il parse
 * un `test-results.json` que seul le reporter JSON de `ci.yml` produit), et le chemin
 * `pull_request` de gitleaks (aucun événement de PR n'existe sur un poste). Le chemin `push`
 * de gitleaks, lui, est rejoué par `npm run gitleaks:local`.
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// On Windows, `npm`/`npx` resolve to .cmd wrappers that Node refuses to spawn
// without a shell (CVE-2024-27980). On POSIX (the usual build env) shell:false.
const NPM_SHELL = process.platform === "win32";

const args = process.argv.slice(2);
const WITH_E2E = args.includes("--e2e");
const BAIL = args.includes("--bail");

/** @type {{name: string, run: string[]}[]} */
const STEPS = [
    { name: "Build (turbo)", run: ["npx", "turbo", "run", "build"] },
    {
        name: "Bundle exports validation",
        run: ["npm", "run", "test:bundle", "-w", "@geoleaf/core"],
    },
    // A plugin's bundle is asserted in the plugin's own package — that is where the artefact
    // ships. The core's rollup used to build a second, divergent copy of these two; it was
    // consumed by nobody, shipped ~660 KB of plugin code inside the public
    // @geoleaf/core npm package, and carried the CSP-violating styleInject. Deleted — the core's
    // own bundle gate now asserts that no geoleaf-*.plugin.js reappears in packages/core/dist/.
    {
        name: "Bundle validation — plugin Storage",
        run: ["npm", "run", "test:bundle", "-w", "@geoleaf-plugins/offline-ui"],
    },
    { name: "Tree-shaking proof (size:example)", run: ["npm", "run", "size:example"] },
    // S6 — the source graph tree-shaking (above) says nothing about the PUBLISHED package.
    // These two check the artifact an integrator actually downloads: the sideEffects field it
    // reads, and a witness bundle built through the real npm subpaths.
    { name: "sideEffects honesty (check:side-effects)", run: ["npm", "run", "check:side-effects"] },
    { name: "Published-package proof (size:consumer)", run: ["npm", "run", "size:consumer"] },
    { name: "Published recipe typechecks", run: ["npm", "run", "typecheck:consumer"] },
    // ARCHI S6 — the STRUCTURAL complement to the compile above. `typecheck:consumer`
    // proves the core's types are right; this proves every OTHER package's declarations
    // are reachable at all. 11 packages shipped .d.ts inside their tarball that no
    // consumer could resolve (TS7016) — invisible to a compiler that never imports them,
    // which is why `examples/consumer/published-types.ts` was added alongside this gate.
    // It also holds the "types first" convention, which is uniformity only: TypeScript
    // resolves the condition wherever it sits (measured at S6, both after `import` and
    // after `default`). Check 1 is the one with teeth.
    {
        name: "Published types are reachable (PUB-TYPES)",
        run: ["node", "scripts/verify-published-types.cjs"],
    },
    // API S2 — PUB-TYPES checks the `types` branch of `exports`; nothing checked the
    // runtime branch. The API audit (24/07) found `@geoleaf/core` advertising 13
    // `./facades/*` subpaths whose `.d.ts` resolved and whose `.js` did not: they
    // type-checked, then threw ERR_MODULE_NOT_FOUND. This gate resolves BOTH branches
    // of every target of every workspace, and fails on any asymmetry. It also fails if
    // it scanned nothing — its own prototype passed vacuously from the wrong cwd.
    {
        name: "Public subpaths resolve (SUBPATH-RESOLVE)",
        run: ["node", "scripts/check-subpath-resolve.cjs"],
    },
    // Passage public S1 — la troisième question qu'aucune des deux gates ci-dessus ne pose.
    // PUB-TYPES vérifie qu'une déclaration est ATTEIGNABLE, SUBPATH-RESOLVE que les deux
    // branches d'un sous-chemin RÉSOLVENT — les deux à l'intérieur du monorepo, où les
    // symlinks de workspace rendent `@geoleaf/host-runtime` parfaitement résoluble alors
    // qu'il est `private` et 404 sur le registre POUR TOUJOURS. Six `.d.ts` publiables
    // importaient des paquets absents de npm sans qu'aucune gate ne puisse le voir.
    // `typecheck:consumer` non plus : il compile depuis packages/core/examples/, donc dans
    // le monorepo. Un défaut qui n'existe que chez quelqu'un d'autre ne se compile pas ici.
    {
        name: "Shipped specifiers resolve off-monorepo (SHIP-SPEC)",
        run: ["node", "scripts/check-shipped-specifiers.cjs"],
    },
    // Passage public S3 — la licence est-elle portée par ce qui PART ? Le `LICENSE` racine
    // exige que la notice accompagne « all copies or substantial portions » ; le tarball la
    // satisfait via `files[]`, un `.js` servi seul depuis un CDN non. Mesuré le 10/08/2026
    // AVANT correctif : 405 fichiers expédiés sur 540 n'en portaient aucune, et le seul
    // paquet qui DÉCLARAIT une bannière ne la livrait pas — `legalComments: "none"` la
    // supprimait. LIC-05 garde en plus la VALEUR du champ `license`, que PC-05 ne regarde
    // pas (il n'exige qu'une chaîne non vide, donc "UNLICENSED" y sortait vert).
    // ⚠️ Doit passer APRÈS « Build (turbo) » : LIC-04 lit `dist/`.
    {
        name: "License headers & notice (LIC-HEADERS)",
        run: ["node", "scripts/check-license-headers.cjs"],
    },
    { name: "Lint (0 errors, 0 warnings enforced)", run: ["npm", "run", "lint"] },
    // ARCHI S5 (5.5, constat A-12) — la tâche `typecheck` existait dans turbo.json et les
    // 18 packages implémentaient le script, mais RIEN ne l'invoquait. Son premier run a
    // remonté 45 erreurs, dont 39 introduites la veille par le S7 sans que rien ne les
    // voie : plugin-storage typecheck via `tsconfig.typecheck.json`, un périmètre que
    // `tsc -p tsconfig.json` ne couvre pas. C'est le gate qui rend ce script utile.
    { name: "Typecheck (turbo, 18 packages)", run: ["npx", "turbo", "run", "typecheck"] },
    { name: "Security audit — prod deps (M7)", run: ["node", "scripts/audit-ci.cjs"] },
    {
        name: "Security audit — full tree (informational)",
        run: ["node", "scripts/audit-dev-report.cjs"],
    },
    // La gate `Secret scan (gitleaks)` de ci.yml, rejouée AVANT le push. Elle était la seule
    // gate de fond portée par une ACTION GitHub, donc la seule que ce script ne pouvait pas
    // exécuter — et elle a mordu deux fois de suite le 29/07/2026, chaque découverte coûtant
    // un run d'un quota rare. L'action n'est pas reproductible ; son binaire l'est, à la
    // version exacte qu'elle installe, sur la même plage (`origin/main..HEAD`).
    //
    // ⚠️ Ne rougit PAS si Docker est absent : une dépendance d'environnement manquante n'est
    // pas une gate en échec, et faire rougir ci:local pour ça pousserait à le contourner.
    // Le script l'annonce alors bruyamment. Il refuse aussi de conclure sur une plage vide,
    // où gitleaks imprimerait « no leaks found » sur zéro octet — le défaut exact de f15b0575.
    { name: "Secret scan (gitleaks, local)", run: ["node", "scripts/gitleaks-local.cjs"] },
    // ⚠️ Ces deux étapes sont distinctes et doivent le rester — même périmètre de paquets
    // depuis B.48, mais pas le même rôle, et les confondre a déjà coûté :
    //   - `npm test`                  → tâche `test`          → sans couverture, sans seuils
    //   - `npm run test:coverage:all` → tâche `test:coverage` → avec couverture ET seuils
    // Les deux passent par `scripts/run-tests.cjs` et couvrent les 17 paquets (34 tâches
    // turbo chacune, build inclus). Jusqu'au 19/07/2026 `ci:local` ne lançait que la
    // première, sous le nom trompeur
    // « Unit tests + coverage gate » — alors qu'elle ne mesure aucune couverture. Le gate de
    // couverture de `ci.yml` (« Coverage gate », gate DUR, sans continue-on-error) n'avait
    // donc aucun équivalent local, et il est resté ROUGE sur `main` sans que rien ne le
    // signale : `plugin-runtime` (branches 61,11 %) et `field-renderer` (59,68 %) échouaient
    // pendant que `ci:local` affichait 100 % vert. Un push aurait brûlé du quota sur un rouge
    // déjà connu de la CI et invisible en local. Voir backlog ARCHI B.14.
    { name: "Unit tests (npm test)", run: ["npm", "test"] },
    // B.48 — le `--concurrency=4` qui vivait ICI, en dur, et seulement pour ce gate, a
    // déménagé dans `scripts/run-tests.cjs` avec le second facteur qui lui manquait.
    //
    // Le diagnostic posé alors était juste — N tâches turbo × leurs pools de workers
    // sursouscrivent la machine, et ce sont les tests à contrainte temporelle qui cèdent,
    // un package différent à chaque run — mais le remède ne couvrait que la moitié du
    // produit, et que ce gate-ci. L'étape « Unit tests » juste au-dessus, elle, n'a jamais
    // rien porté : `npm test` lançait 12 paquets de front, chacun ouvrant ~23 workers.
    // Mesuré le 22/07/2026 : **81 processus Node, 11,3 Go de RSS** pour ~11 Go
    // disponibles. D'où un `ci:local` rouge une fois sur deux — toujours en timeout,
    // jamais en assertion, sur des paquets non touchés et verts en isolation.
    //
    // Les deux gates passent désormais par le même runner, qui pose ensemble la
    // concurrence turbo ET le plafond de workers de chaque vitest.
    {
        name: "Coverage gate (turbo test:coverage)",
        run: ["npm", "run", "test:coverage:all"],
    },
    { name: "Smoke test", run: ["node", "scripts/smoke-test.cjs"] },
    // T6.3 — remplace `benchmark.cjs --ci`, dont les 3 assertions étaient inertes (baseline
    // du 27/02, ère Leaflet ; les 2 autres nommaient un artefact supprimé au S4). Ce gate-ci
    // n'était étape nulle part : il n'était atteint que transitivement par `build-deploy.cjs`,
    // donc sous `--e2e` seulement. Le mode par défaut de `ci:local` n'avait aucun budget.
    { name: "Bundle size (boot payload gz + CSS, budget dur)", run: ["npm", "run", "size"] },
    // ── Le poids de l'APPLICATION (socle-init S4.7) ──────────────────────────
    //
    // La gate juste au-dessus mesure la clôture des imports statiques du CORE et sort verte à
    // ~183 / 300 KB gz. C'est 12 % de ce qu'une page charge : les données du profil, les
    // plugins eager, le CSS et les icônes n'étaient pesés par RIEN. Une favicon de 172,7 Ko gz
    // — plus lourde que le bundle core entier — a vécu sur le chemin critique sans qu'aucun
    // instrument ne la voie.
    //
    // ⚠️ Ces deux étapes sont dans le chemin PAR DÉFAUT, pas sous `--e2e`, et c'est le point.
    // La gate a besoin d'un `deploy/` bâti ; le construire coûte **8 s** (mesuré), contre une
    // suite qui se compte en minutes. La réserver à `--e2e` l'aurait rendue quasi jamais
    // exécutée, c'est-à-dire décorative — le défaut même que le Sprint 4 corrige.
    // Le doublon avec `E2E_STEPS` est assumé : 8 s payées deux fois sous `--e2e`, contre une
    // gate réelle tous les autres jours.
    {
        name: "Build deploy variants (sujet du budget applicatif)",
        run: ["npm", "run", "build:deploy:all"],
    },
    {
        name: "App payload (première page par variante, budget dur)",
        run: ["npm", "run", "size:app"],
    },
    // ── Aucun secret dans ce qu'on LIVRE ─────────────────────────────────────
    //
    // 🛑 CETTE GATE COMBLE UN ANGLE MORT ENTRE DEUX FILETS, pas une négligence. `gitleaks`
    // scanne des PLAGES DE COMMITS ; `.gitignore` couvre le canal git. `deploy/` est
    // git-ignoré, donc invisible aux deux — pendant qu'il est exactement ce qui part chez un
    // client ou en prod. Mesuré le 09/08/2026 : un JWT `geoleaf_editor` NON EXPIRÉ, contre un
    // hôte joignable depuis Internet, vivait à la racine de `deploy-core` et `deploy-full`,
    // plus dans leurs `.gz`/`.br`. Quatre gates regardaient `deploy/` — toutes pesaient des
    // octets, aucune ne lisait le contenu.
    //
    // ⚠️ Position couplée à l'étape « Build deploy variants » deux crans plus haut : elle
    // scanne CET artefact-là. Remontée avant lui, elle rendrait un verdict sur un `deploy/`
    // d'âge inconnu — ou sur rien, ce que DNS-04 fait rougir plutôt que de laisser passer.
    {
        name: "Aucun secret dans les livrables (DEPLOY-SECRETS)",
        run: ["node", "scripts/verify-deploy-no-secrets.cjs"],
    },
    // Le livrable emporte sa recette serveur (SC-01/02/03).
    //
    // 🛑 Même position, même motif que la gate ci-dessus : elle lit l'artefact que l'étape
    // « Build deploy variants » vient de produire. Remontée avant lui, elle rendrait un verdict
    // sur un `deploy/` d'âge inconnu — ou sur rien, ce que son SC-03 fait rougir.
    //
    // ⚠️ Ce qu'elle ferme n'est PAS un trou de connaissance. Le fait — « sans le type MIME de
    // `.mjs`, rien ne boote » — était déjà écrit dans `docker/nginx.dev.conf`, avec l'aveu que
    // personne ne pouvait le vérifier chez l'intégrateur. C'était un trou de DIFFUSION, et il a
    // coûté une prod muette le 09/08/2026.
    {
        name: "Le livrable emporte son contrat serveur (DEPLOY-SERVER-CONTRACT)",
        run: ["node", "scripts/verify-deploy-server-contract.cjs"],
    },
    // Déterminisme du DÉPLOYÉ — placé ICI, et la position est la raison d'être du câblage.
    //
    // 🛑 Cette gate a failli rester hors du chemin par défaut « parce qu'elle coûte deux
    // builds ». C'était accepter une gate décorative : trois sources de non-déterminisme ont
    // vécu des mois dans ce dépôt (`?v=<Date.now()>`, `CACHE_VERSION` horodaté, `_generatedAt`
    // d'un profil pré-caché), et aucune n'a jamais fait rougir quoi que ce soit — elles se
    // payaient en re-téléchargements chez chaque visiteur, ce que personne ne mesure.
    //
    // Le coût est ramené à **un seul build (~50 s)** par `--reuse-built` : l'étape juste
    // au-dessus vient de produire `deploy/`, qui sert de premier terme. ⚠️ Déplacer cette
    // entrée ailleurs dans la liste casse ce couplage sans rien signaler — elle comparerait un
    // `deploy/` d'âge inconnu à un build neuf, et rougirait en parlant de déterminisme.
    {
        name: "Déterminisme du déployé (BUILD-DET — deux builds, mêmes octets)",
        run: ["npm", "run", "check:determinism:deploy:ci"],
    },
    // Deux gates dead-code, désormais DISJOINTES — plus complémentaires, sans recouvrement.
    // knip (étape suivante) garde les fichiers morts, les dépendances et la config morte
    // bloquante ; sa baseline vaut 1 signal depuis le 26/07/2026, parce que la catégorie
    // exports/types est coupée sur `packages/core/src/**` (`ignoreIssues` dans knip.js) :
    // 157 des 158 signaux y vivaient, et leur triage un par un a donné 116 faux positifs de
    // baril pour 0 actionnable. Le filet B3 cherche par token dans tout le dépôt, y compris
    // les VALEURS littérales des const de type chaîne, qu'aucun graphe d'imports ne relie à
    // leur consommateur. Il couvrait 51 des 74 candidats seul (mesure 25/07/2026) ; il les
    // couvre maintenant tous les 74 — il est le SEUL gate sur les exports du core, pas un
    // doublon. Chacun porte sa classe (A/C/D), asservie par CLS-01/CLS-02 (API publique S4.8).
    { name: "Dead code (knip)", run: ["npm", "run", "dead-code"] },
    {
        name: "Dead-code filet B3 (core orphan exports)",
        run: ["npm", "run", "check-orphan-exports"],
    },
    // COUVERTURE S1 — un module source chargé par `require()` depuis un test voit sa
    // couverture attribuée aux MAUVAISES lignes et aux MAUVAISES fonctions. Rien n'échoue :
    // la suite est verte et le rapport plausible, ce qui a laissé le défaut vivre un mois.
    // La baseline gèle les 357 sites connus et ne bloque que sur un site NEUF — elle ne
    // peut que descendre. Preuve par mutation dans `probe-gate-visibility.cjs`, qui plante
    // un `require()` de source dans le package sonde et exige que cette gate le nomme.
    {
        name: "Mode de chargement des tests (require → couverture fausse)",
        run: ["node", "scripts/verify-test-load-mode.cjs"],
    },
    // COUVERTURE S1.7 — la SEULE gate qui vérifie l'appareil de mesure plutôt que le code.
    // Un rapport de couverture faux est bien formé et plausible : aucun test ne peut
    // l'attraper, et c'est ainsi que le défaut a vécu un mois. Témoin à 4 fonctions, un
    // test qui n'en appelle qu'une, assertion que le lcov crédite celle-là et pas les
    // trois autres. Le dépôt mesure en istanbul partout ; la sonde vérifie l'attribution sur
    // un témoin à réponse connue. ~2 s. Porte sur la branche `import` : la branche `require()`
    // a été éliminée (S2-S5) et gelée par `verify-test-load-mode.cjs`.
    {
        name: "Étalonnage de la couverture (attribution FNDA/DA)",
        run: ["node", "scripts/verify-coverage-attribution.cjs"],
    },
    // Socle S4 — contracts/ must stay a pure type surface (no runtime value export, no
    // non-type import, no top-level statement). Green at wiring (Sprint 2 purified the 2
    // membranes) ⇒ no baseline. Keep in sync with ci.yml and .husky/pre-commit.
    {
        name: "Contracts purity (type-only)",
        run: ["npm", "run", "check:contracts-pure"],
    },
    // S13.1 — `api/geoleaf.*.ts` expose the API, they do not implement it. The rule
    // is documented (ARCHITECTURE.md) and was broken twice: geoleaf.config.ts had drifted
    // into self-registration (removed S2), geoleaf.storage.ts held ~430 L of orchestration
    // (extracted S3). Green at wiring (S13.1 conformed events + introspection) ⇒ no
    // baseline. Keep in sync with ci.yml and .husky/pre-commit.
    {
        name: "Facade purity (geoleaf.*.ts)",
        run: ["npm", "run", "check:facade-purity"],
    },
    // S14 — the npm script existed since the docs sweep but was wired into NOTHING:
    // absent from this list AND from every GitHub workflow. That is how three APIs
    // stayed documented on npm after being deleted from the runtime
    // (`Helpers.createElement`, `Utils.escapeHtml`, the whole `AbstractRenderer` page):
    // an unrun gate is indistinguishable from no gate.
    // ⚠️ It is a hand-maintained DENY-list of known-bad patterns, not a check derived
    // from the real surface — so it catches a documented ghost only once someone adds
    // the rule. Deriving it from the real surface is backlogged; the source to derive
    // FROM is the generated `dist/types/` + the boot golden-master (ARCHI S6 removed the
    // root `index.d.ts`, which this comment used to name — it was never published and had
    // drifted, so deriving a gate from it would have encoded the drift).
    {
        name: "Docs examples (phantom APIs, stale package names)",
        run: ["npm", "run", "check:docs-examples"],
    },
    // ARCHI S11 — the two halves of the commented tree, and they fail differently.
    // MOD-HEADERS gates the SOURCE (a new file may not arrive undocumented, and the
    // 318-file baseline may only shrink); DOCS-TREE gates the ARTEFACT (the committed
    // markdown must match what the generator produces right now). Without the second,
    // a generated file is just a hand-maintained file with extra steps: it drifts, and
    // the drift is invisible because nobody re-runs the generator to notice.
    {
        name: "Module headers (new files must be documented)",
        run: ["npm", "run", "check:module-headers"],
    },
    // EXACT-OPTIONAL-DEBT (qualite Q4.5, 31/07/2026) — `exactOptionalPropertyTypes` est posé
    // depuis le Q4.4, et ses 95 erreurs ont été soldées SANS élargir un seul type. Rien, sinon
    // cette gate, ne distingue ensuite un `?: T | undefined` justifié d'un `?: T | undefined`
    // posé pour faire taire tsc — et l'élargissement rend à la propriété exactement la
    // sémantique d'avant l'option. Baseline 0, visite AST (un grep compte 83 faux positifs :
    // casts et unions de paramètres), périmètre dérivé de `lib/packages.cjs`. Vue rougir sur
    // ses deux règles avant d'être crue.
    {
        name: "Exact-optional debt (aucun type élargi pour faire taire tsc)",
        run: ["npm", "run", "check:exact-optional-debt"],
    },
    // NONNULL-ASSERTION-DEBT (qualite Q5.5) — le pendant de la précédente pour
    // `noUncheckedIndexedAccess`. NNA-04 est la règle qui compte : zéro `arr[i]!`, SANS
    // baseline, parce qu'une lecture indexée assertée est une erreur du palier qu'on a tue
    // — le sweep sort vert PARCE QUE l'assertion est là. Mesuré au Lot 0 : le seul
    // correctif à coût de complexité nul est justement celui-là, et `complexity: 20` est un
    // cliquet, donc la pression pousse structurellement vers l'assertion. Les 302 autres
    // entrées (dette `strictNullChecks`, palier Q3) sont gelées et ne peuvent que rétrécir.
    // Vue rougir sur ses TROIS règles avant d'être crue.
    {
        name: "Non-null assertion debt (aucune erreur Q5 soldée par un `!`)",
        run: ["npm", "run", "check:nonnull-debt"],
    },
    // JS-TEST-DEBT (Sprint 5, S5c/5.3) — le cliquet que `dette_technique.md` § D-23 réclamait
    // nommément depuis le 31/07/2026 (« le geste qui rendrait ce coût plat est connu […] Il
    // n'a pas été posé »). Sans lui, D-24 mesurait le core à 431 le 24/07, 447 le 31/07 et
    // 457 le 05/08 : la dette se creusait pendant qu'on l'instruisait.
    // 🛑 La règle qui compte n'est PAS le compteur, c'est JTD-04 — zéro suite non collectée,
    // sans baseline. Un cliquet sur un NOMBRE se retourne contre lui-même ici : les `include`
    // de vitest portent l'extension dans leur motif (`core/vitest.config.ts:39`,
    // `offline-ui/vitest.config.ts:37`), donc renommer un `.test.js` en `.test.ts` sans
    // élargir le motif rend le fichier INVISIBLE au runner — la suite reste verte avec un
    // test de moins, et la baseline RÉTRÉCIT en applaudissant la perte. JTD-04 est évaluée
    // AVANT la baseline, précisément pour que ce chemin soit inatteignable.
    // Vue rougir sur ses QUATRE règles avant d'être crue, et son premier run a trouvé un
    // défaut vivant : `maplibre-import-validation.test.ts` n'était collecté par aucun vitest
    // (456 fichiers listés, lui absent) NI compilé par aucun tsconfig — il n'affirmait rien
    // depuis le 21/03/2026.
    {
        name: "JS-test debt (D-23/D-24 gelées, et aucune suite invisible au runner)",
        run: ["npm", "run", "check:js-test-debt"],
    },
    // DIST-INTEGRITY (Sprint 6, S6a/B-130) — le déployé embarquait DEUX jeux de chunks, et le
    // registre n'attribuait ça qu'au cache turbo. La mesure a trouvé DEUX causes :
    //   1. turbo restaure son cache SANS vider `dist/` — prouvé par canari sur turbo 2.9.18 :
    //      un fichier posé à la main survit à un `cache hit` / `>>> FULL TURBO`. L'issue (a)
    //      du registre (« déclarer outputs ») est donc écartée : `outputs: ["dist/**"]` est
    //      déjà déclaré et ne suffit pas.
    //   2. 🛑 `build-deploy-coverage.cjs` appelait `npx rollup -c` DIRECTEMENT, aux étapes 1
    //      et 4, court-circuitant le `rimraf dist &&` que porte le script `build` du core.
    //      Rollup n'efface pas sa sortie : chaque passe superposait son jeu de chunks hashés.
    //      Mesuré : `core/dist/chunks/` sort PROPRE d'un `turbo run build --force` et redevient
    //      double après ce seul script. Cette cause-là n'était écrite nulle part.
    // Correctif mesuré : le déployé passe de 41010 à 40016 Ko. Et un chunk orphelin ne se
    // contente pas de peser — il PARTIRAIT dans le tarball npm (B-141 ②, 3,5 Mo sur un paquet).
    // ⚠️ Vue rougir avant d'être crue, et son PREMIER run a produit un FAUX POSITIF :
    // `maplibre-layer-builders` / `maplibre-layer-registry` rendus comme deux variantes, parce
    // que `builders` et `registry` font huit caractères comme un hash rollup. Resserrée deux
    // fois (hash exigeant majuscule + chiffre, et périmètre limité aux répertoires `chunks/`)
    // — une gate bruyante apprend à être ignorée, ce qui est pire qu'une gate absente.
    {
        name: "Intégrité de dist/ (DIST-INTEGRITY — 0 chunk en double, 0 orphelin)",
        run: ["npm", "run", "check:dist-integrity"],
    },
    // ESM-PURITY (socle-init S2, tâche 2.1′) — un spécificateur NU dans un `dist/` est
    // irrésoluble en navigateur : sans import map, `from 'gtfs-realtime-bindings'` n'a pas
    // d'URL. Le module se charge chez l'intégrateur, et il casse. Le témoin historique était
    // réel et copié dans les 4 variantes de `deploy/` ; `purge-dist.cjs` l'a emporté depuis,
    // donc la garde a été FABRIQUÉE rouge par mutation, pas trouvée rouge.
    // ⚠️ La ligne de partage est `peerDependencies`, pas `dependencies` : `maplibre-gl` est un
    // external VOULU (moteur hors bundle, déclaré aussi en `external:` du rollup), tandis que
    // le témoin `gtfs-realtime-bindings` était une `dependencies` qui fuyait. L'allowlist en
    // dérive, paquet par paquet — la tolérer globalement rendrait la déclaration décorative.
    // ⚠️ Et elle scanne par un SCANNER, pas un grep : le dépôt porte deux faux positifs qu'un
    // `grep from ['"]` signalerait — un `@example` TSDoc dans `legend.js` et une chaîne
    // d'erreur dans `geoleaf-print.plugin.js`. Ils vivent sur le disque, donc un vert les
    // traverse : c'est la non-régression permanente du neutraliseur.
    {
        name: "Pureté ESM de dist/ (ESM-PURITY — 0 spécificateur nu hors allowlist)",
        run: ["npm", "run", "check:esm-purity"],
    },
    // DOC-CONFIG-EXAMPLES (Sprint 5, S5c/5.8) — les deux gates d'exemples de doc regardent du
    // CODE : `validate-docs-examples` traque les API fantômes, `typecheck-docs-examples` compile
    // les blocs TS et les `@example`. Un bloc ```json décrivant un profil n'est ni l'un ni
    // l'autre — personne ne le lisait. Or les schémas de profil sont `additionalProperties:
    // false` : une clé retirée d'un schéma mais laissée dans un exemple produit un extrait
    // COPIABLE-COLLABLE qui fait échouer `validate:profiles` chez l'intégrateur.
    // 🛑 C'est la forme EXACTE du trou comblé le 31/07 (un `GeoLeaf.POI.add()` copiable dans les
    // deux README les plus lus) — sauf qu'ici le corpus était bon et que c'est le TYPE DE BLOC
    // qui s'arrêtait avant. Relevé au câblage : 169 clés invalides sur 24 documents produit, dont 46 au PREMIER NIVEAU,
    // dont 5 du Sprint 5 (corrigées) ; les 164 autres sont antérieures et
    // gelées en baseline décroissante. Vue rougir sur ses trois règles avant d'être crue.
    {
        name: "Exemples de config JSON de la doc produit (DOC-CONFIG-EXAMPLES)",
        run: ["npm", "run", "check:doc-config-examples"],
    },
    // TSDOC-CONFORMITY (27/07/2026) — le pendant de MOD-HEADERS sur le CONTENU du bloc,
    // pas sur sa présence. MH-01 garantit qu'un fichier neuf est documenté ; celle-ci
    // garantit que la documentation décrit la signature qu'elle surplombe. 47 violations
    // au câblage (15 `@param` fantômes, 31 documentations partielles, 1 `@throws` sans
    // `throw`), gelées en baseline décroissante — dont 7 où le paramètre documenté est
    // devenu `_`-préfixé, c'est-à-dire inutilisé, sans que la phrase le dise.
    {
        name: "TSDoc conformity (@param ↔ signature)",
        run: ["npm", "run", "check:tsdoc"],
    },
    // B-80 / reliquat doc V3 (31/07/2026) — le dernier trou de la règle ⛔ : `@param`,
    // `@throws` et l'arité sont gardés par TSDOC-CONFORMITY, les `@example` sont compilés par
    // `typecheck-docs-examples`, mais la PROSE des TSDoc ne l'était par rien. Une phrase qui
    // renvoie à `kernel/geojson/style-resolver.ts` reste lisible et convaincante longtemps
    // après que le fichier a bougé.
    //
    // ⚠️ **La baseline de 84 n'est PAS une file de dette à drainer, et c'est mesuré.** Trois
    // classes de faux positifs ont été fermées avant le câblage (absents 149 → 84 : segment
    // omis / préfixe en trop, specifier de paquet, chemin à placeholder) — mais l'instruction
    // du reliquat a montré que **la majorité des 84 nomme un chemin PARCE QU'il est mort** :
    // « Reclassified from … », « Absorbs the former … », « PROMOTED here from … ». C'est de la
    // provenance légitime, pas un défaut, et aucune regex ne l'en distingue de façon fiable —
    // le même verdict que l'en-tête du script avait déjà rendu pour les `.md` (précision 2/10).
    //
    // Ce que ce gate garde est donc précis et étroit : **aucune citation morte NEUVE ne peut
    // entrer**. C'est le vrai risque (quelqu'un déplace un fichier et laisse la référence),
    // tandis qu'une note de provenance s'écrit délibérément et rarement. TSDOC-PATHS-02
    // empêche en plus la baseline de se fossiliser. Vu rouge sur les DEUX axes avant d'être cru.
    {
        name: "Chemins cités par la prose des TSDoc (TSDOC-PATHS)",
        run: ["npm", "run", "check:tsdoc-paths"],
    },
    // Même cliquet, autre corpus — les renvois des 45 fiches de `docs/specs/`, posé le
    // 11/08/2026 (tâche 6.11, classes B et C).
    //
    // 🛑 **Le motif est un TROU MESURÉ, pas une précaution.** Par élimination sur les 78 gates
    // d'alors : `check-dead-links` n'extrait que `[texte](cible)` — un chemin en backticks lui
    // est invisible ; TSDOC-PATHS s'arrête aux `src/` de paquet et n'a pas `md` dans son
    // alternance ; les corpus `.md` de `validate-docs-examples` / `typecheck-docs-examples` se
    // prennent à profondeur 0 de la racine, donc jamais `docs/`. **546 paires (fiche→chemin)
    // n'étaient gardées par rien**, et c'est exactement ce que la roadmap constatait de la
    // classe B : « elle se périme sans jamais rougir ». Le premier run a trouvé 115 chemins
    // morts et 6 déménagés.
    //
    // ⚠️ La baseline est le DOMICILE des chemins nommés parce qu'ils sont morts (« ce
    // répertoire n'existe plus », les CDC consommés puis supprimés) : 15 sur 20 à la classe A.
    // Les y geler évite de « corriger » des phrases qui disaient juste.
    {
        name: "Chemins cités par les fiches docs/specs (SPECS-PATHS)",
        run: ["npm", "run", "check:specs-paths"],
    },
    // B-222 — la 3ᵉ sous-racine publique. `SPECS-PATHS` ne gardait que `docs/specs/`, alors
    // que `guides/` et `reference/` partent dans le MÊME dépôt public et sont lues par les
    // mêmes gens. Le trou était mesuré : `TESTING_GUIDE.md` a enseigné pendant des mois une
    // suite `poi.test.js` disparue avec le module POI, et aucune gate ne pouvait la voir —
    // `check-dead-links` n'extrait que `[texte](cible)`, jamais un nom en backticks.
    // Vue rougir sur ses DEUX axes avant d'être crue (01 chemin neuf, 02 baseline périmée).
    {
        name: "Chemins cités par docs/guides et docs/reference (GUIDES-PATHS)",
        run: ["npm", "run", "check:guides-paths"],
    },
    // API publique S3.4 — même patron de cliquet que MOD-HEADERS, sur un autre objet :
    // tout nom `geoleaf:*` relevé dans les sources doit exister dans `GeoLeafEventMap` ou
    // `GeoLeafRawEventMap`. 23 typés sur 76 relevés au câblage ; les 53 restants sont en
    // baseline et elle ne peut que rétrécir. Sans ce gate, le 54ᵉ événement non typé arrive
    // sans que rien ne le dise — ce qui est exactement comment `geoleaf:toolbar:action`,
    // le seam d'extension canonique, a pu rester hors typage pendant toute la vie du produit.
    {
        name: "Événements dispatchés typés (EVENT-MAP)",
        run: ["npm", "run", "check:event-map"],
    },
    // API publique S3.5 — les deux descriptions du namespace `GeoLeaf` (`GeoLeafGlobal` côté
    // core, `GeoLeafHost` côté host-runtime) ne peuvent pas être reliées par le compilateur :
    // host-runtime est bundlé dans chaque plugin et n'importe rien du core, pas même un type.
    // Elles ont donc dérivé sans témoin — `POI` est resté au contrat après la dissolution du
    // sous-système au S9, et `GeoJSON`, le membre le plus appelé des plugins, n'était décrit
    // ni d'un côté ni de l'autre. Ce gate compare les NOMS contre l'oracle post-boot ; la
    // conformité des FORMES est asservie par `typecheck:consumer` (extension-contract.ts).
    {
        name: "Contrats du namespace synchronisés (HOST-SYNC)",
        run: ["npm", "run", "check:host-sync"],
    },
    // API publique S4.2 — HOST-SYNC ci-dessus tient que tout membre DÉCLARÉ existe au
    // namespace ; celui-ci tient l'inverse : toute clé du namespace est déclarée. Sans lui,
    // une clé neuve tombe dans la traîne `[key: string]: unknown` de `GeoLeafGlobal` et rend
    // `unknown` — le compilateur n'a rien à vérifier sur son affectation. La liste des non
    // typées est nominative et ne peut que rétrécir ; le pourcentage n'asservit rien, il
    // MONTE quand on retire une clé (le lot S4.3 l'a fait passer de 27 à 31 % sans écrire une
    // ligne de type). ⚠️ HOST-06 refuse `unknown`/`any`/`Record<string, unknown>` nu : sans
    // elle, la baseline se solderait en déclarant 62 membres vides.
    {
        name: "Namespace GeoLeaf typé sous cliquet (NAMESPACE-TYPING)",
        run: ["npm", "run", "check:namespace-typing"],
    },
    // Contrat inverse S1.8 — l'invariant que ce dépôt n'avait PAS. Les trois gates ci-dessus
    // tiennent que ce que nous déclarons existe ; celle-ci tient que ce dont l'aval DÉPEND n'a
    // pas disparu. Neuf clés sont parties du namespace parce qu'aucun lecteur du monorepo ne
    // les lisait, et aucun vert d'ici ne pouvait le voir : le lecteur était dehors.
    // ⚠️ Elle SAUTE quand `GEOLEAF_CONSUMERS` n'est pas défini, ce qui est le cas par défaut —
    // le manifeste vit chez le consommateur (décision ④) et aucun chemin par défaut n'est écrit
    // dans `scripts/`, qui part intégralement dans le clone public. Le SKIP imprime le chemin
    // essayé et son motif ; il n'est jamais silencieux. Ce qui l'empêche de tout avaler est
    // l'assertion `GATE-PROBE` de `probe-gate-visibility.cjs`, qui plante un manifeste de
    // FIXTURE et exige de voir la gate rougir dessus — elle ne prouve pas que le vrai manifeste
    // est lu, elle prouve que la gate MORD ENCORE.
    {
        name: "Contrat inverse — ce dont l'aval dépend (CONSUMER-CONTRACT)",
        run: ["npm", "run", "check:consumer-contract"],
    },
    {
        name: "Qualified tree is up to date (docs:tree)",
        run: ["npm", "run", "docs:tree:check"],
    },
    // Refonte documentaire V3 §Étape 3 — la référence d'API dérivée cesse d'être un fossile.
    // Sa sortie datait du 25/07, le core avait bougé jusqu'au 26/07, et `docs:api` n'était
    // câblé NULLE PART. Pendant ce temps `API_REFERENCE.md` était édité à la main : voilà
    // toute la divergence entre les deux références du dépôt.
    // ⚠️ On gate un MANIFESTE, pas le rendu, et ce n'est pas un raccourci — le rendu grave
    // `git rev-parse HEAD` (29 fichiers sur 54 mesurés), donc il n'a pas de point fixe : la
    // gate rougirait au commit même qui vient de régénérer. Et il pèse 1 806 fichiers / 24 Mo
    // pour le seul core, à une ligne de HTML par fichier. Même leçon que
    // `generate-docs-tree.cjs`, qui l'a écrite : comparer le RENDU a laissé son `--check` vert
    // pendant que 31 annotations sur 129 étaient mortes.
    {
        name: "API surface manifest is up to date (gen:api-surface)",
        run: ["npm", "run", "gen:api-surface:check"],
    },
    // Refonte documentaire V3 §Étape 3 item 7 — le 2ᵉ générateur. `PROFILE_JSON_REFERENCE.md`
    // est écrit à la main et publié sur npm ; mesuré, il documente 128 paramètres quand les
    // 12 schémas en portent 381. Il n'est donc pas seulement exposé à la dérive, il est
    // INCOMPLET, et rien ne le disait. Cette gate garde la référence dérivée fraîche ;
    // `npm run gen:profile-schema:audit` imprime l'écart avec le rédigé dans les deux sens.
    {
        // ⚠️ Vue DÉRIVÉE, pas fichier concurrent — c'est ce qui distingue ce rapport du
        // `attributes.json` global que la décision Q1 a écarté : une vue ne peut pas
        // pointer une couche supprimée, et elle rougit si un profil bouge sans elle.
        name: "Attribute model report is up to date (gen:attributes-report)",
        run: ["npm", "run", "gen:attributes-report:check"],
    },
    {
        name: "Profile schema reference is up to date (gen:profile-schema)",
        run: ["npm", "run", "gen:profile-schema:check"],
    },
    // Refonte documentaire V3 §2.3bis — le SECOND maillon de la chaîne config.
    // `profiles/schemas/*.json` → inventaire → HTML : le premier maillon est gardé dans les
    // deux sens par `check-config-coverage` (ci-dessous), le second ne l'était PAS. Un
    // inventaire modifié sans régénération laissait un HTML périmé et commité, en exit 0.
    // ⚠️ Le préalable a été de rendre la sortie DÉTERMINISTE : elle embarquait `new Date()`,
    // donc elle divergeait d'elle-même chaque jour et aucune comparaison n'était possible.
    // La date vient maintenant du bandeau de l'inventaire — même régime que `docs:tree:check`.
    {
        name: "Config reference is up to date (gen:config-reference)",
        run: ["npm", "run", "gen:config-reference:check"],
    },
    // B.20 — le complément COMPILÉ du gate ci-dessus. La deny-list ne voit que ce qu'on
    // lui a écrit ; elle a laissé passer deux exemples de la même API qui passaient un
    // objet d'options en 3ᵉ argument là où la signature lit `duration?: number`, et
    // affectaient un retour déclaré `void`. Aucune regex ne les décrivait — un compilateur
    // n'a pas besoin qu'on les lui décrive. Compile les blocs ```ts de la doc contre les
    // `.d.ts` publiés, d'où sa place APRÈS le build (comme `typecheck:consumer`).
    // Baseline : ne bloque que sur une erreur NOUVELLE.
    {
        name: "Docs examples typecheck (arité, exports fantômes)",
        run: ["npm", "run", "check:docs-typecheck"],
    },
    // B-79 (30/07/2026) — le site VitePress se construit ICI, et pas seulement sur la
    // machine de qui y pense. `ignoreDeadLinks: false` fait ÉCHOUER le build sur un lien
    // mort ; c'était le second filet posé en S7bis.10, mais il ne protégeait que les runs
    // manuels. Mesuré : le build a échoué CINQ JOURS (25 → 30/07, `NOTICE.md`) sans que
    // rien ne le voie — le `docs-dist/` périmé servait encore, Vite refusant de vider un
    // `outDir` situé hors de sa racine (`emptyOutDir` non configuré).
    // ⚠️ Se place APRÈS `check:docs-typecheck` : les deux lisent le même corpus, et un
    // lien mort est moins urgent qu'un exemple qui ne compile pas.
    {
        name: "Docs site build (VitePress — liens morts)",
        run: ["npm", "run", "docs:build", "-w", "@geoleaf/core"],
    },
    // S13.2 — every `X[k] = …` with a non-literal `k` either calls the canonical
    // blocklist (utils/general/object-path-guard), sits in the script's ALLOWLIST with
    // a justification, or is frozen in the baseline. Blocks only NEW unguarded sinks:
    // the Sprint 5 hole was a sink an earlier sweep had not reached, and nothing stopped
    // the next one appearing the same way. Keep in sync with ci.yml and .husky/pre-commit.
    {
        name: "Dynamic-key writes (prototype pollution)",
        run: ["npm", "run", "check:dynamic-key-writes"],
    },
    { name: "Duplicate code (jscpd)", run: ["npm", "run", "dup:check"] },
    // S8/C-5 — la table i18n du cœur est plate ; un dico de plugin imbriqué rend ses
    // clés inatteignables SANS rien casser, et le fallback en dur masque la panne.
    // Le filet i18n existant ne balaie que `src/lang/` du cœur : aucun dico de plugin
    // n'était vérifié. Vert (50 dicos) au câblage ⇒ pas de baseline.
    { name: "i18n dict shape (flat keys)", run: ["npm", "run", "check-i18n-shape"] },
    // S7bis.10 — le gate existait depuis mars et n'était câblé nulle part : c'est le
    // trou par lequel MIGRATION_V1_V2.md est sorti (b3d85253, 30/03), laissant 4 liens
    // 404 en production. Vert (0/64) au câblage ⇒ pas de baseline, il ne mord que sur
    // une régression neuve.
    { name: "Dead links (public docs)", run: ["npm", "run", "check:links"] },
    { name: "Dead CSS (purgecss)", run: ["npm", "run", "verify:purgecss"] },
    { name: "CSS token vars defined (plugins/libs)", run: ["npm", "run", "verify:css-tokens"] },
    { name: "No Leaflet references", run: ["node", "scripts/verify-no-leaflet.cjs"] },
    // Archi roadmap S0 — `packages/core/src/` must never import `@geoleaf-plugins/*`.
    // Architecture boundary (the core stays autonomous and tree-shakeable), NOT a
    // licence one: it survived the all-MIT switch untouched. Until S0 this gate ran
    // ONLY in sync-core-public.yml — the rule CLAUDE.md calls non-negotiable had
    // exactly one enforcement point, inside a mirror workflow. That workflow is gone
    // (ARCHI S9.0); this wiring is now the primary one. Keep in sync with ci.yml and
    // .husky/pre-commit.
    { name: "Core is standalone", run: ["node", "scripts/verify-core-standalone.cjs"] },
    // ARCHI S7 (7.4) — frontière SYMÉTRIQUE de la précédente. `verify-core-standalone`
    // interdit core → plugins ; celle-ci encadre plugins → core, qui n'était surveillée
    // par rien : addpoi embarquait 404 Ko de copie du core, et quatre chemins lisaient
    // une instance que l'hôte n'initialise jamais.
    {
        name: "Plugin → core boundary",
        run: ["node", "scripts/verify-plugin-core-boundary.cjs"],
    },
    // PLUGINS S9 — le pendant de la frontière ci-dessus. Cette dernière INTERDIT
    // d'importer les sources du core ; il reste donc, par nécessité, des COPIES
    // délibérées (pill-search, storage-contract, field-renderer/sanitize). Une copie
    // que personne ne relit dérive en silence — c'est exactement ce qui est arrivé à
    // `coreConfigGet` au S1. Cette gate épingle un hash normalisé de chaque moitié et
    // force une re-confrontation humaine dès qu'un côté change.
    {
        name: "Seam drift (deliberate cross-boundary copies)",
        run: ["node", "scripts/verify-seam-drift.cjs"],
    },
    // PLUGINS S11.1 — le troisième gate de frontière, qui verrouille le S1. core-boundary
    // INTERDIT d'importer les sources du core ; seam-drift surveille les COPIES délibérées ;
    // celui-ci interdit de RE-DÉFINIR un utilitaire qui vit canoniquement dans
    // @geoleaf/host-runtime au lieu de l'importer — la classe de régression par laquelle
    // `coreConfigGet` avait dérivé de ses 9 copies au S1. À garder en phase avec ci.yml et
    // .husky/pre-commit.
    {
        name: "Plugin shared-util fork (host-runtime re-copies)",
        run: ["node", "scripts/verify-plugin-shared-fork.cjs"],
    },
    // ARCHI S10.2 — la méta-gate : les gates ci-dessus VOIENT-ELLES encore ce
    // qu'elles sont censées scanner ? Elles énuméraient `packages/` sur un seul
    // niveau, donc le regroupement du S10 les aurait laissées sortir en 0 après
    // n'avoir rien lu — vertes et aveugles. Une gate verte pour la bonne raison et
    // une gate verte parce qu'elle n'a rien regardé sont indiscernables de
    // l'extérieur ; celle-ci fait la différence, en plantant un package imbriqué
    // porteur de défauts connus et en vérifiant que chacune réagit.
    // ~0,4 s, sans `npm install` (le registre lit les répertoires). Preuve
    // bilatérale faite : rétablir l'ancien `readdirSync` à un niveau dans
    // verify-no-leaflet fait rougir la sonde, et le restaurer la reverdit.
    {
        name: "Gate visibility probe (nested package)",
        run: ["node", "scripts/probe-gate-visibility.cjs"],
    },
    // ARCHI S5 (5.3, constat A-07) — les 7 `globals.*.ts` échappaient au gate de pureté
    // des façades, et à juste titre : écrire sur le namespace EST leur métier. Le contrat
    // qui leur convient n'est pas la pureté mais la PROPRIÉTÉ — depuis le S7, cette
    // surface est le contrat public que les plugins lisent.
    {
        name: "Globals ownership (namespace GeoLeaf)",
        run: ["node", "scripts/verify-globals-ownership.cjs"],
    },
    // Archi roadmap S1 — npm silently drops a files[] entry pointing at nothing, so a
    // package can declare it ships a LICENSE and publish without one for months. That
    // is what happened: 10 packages declared an absent LICENSE and addpoi listed
    // "LICENCE" (FR spelling), an entry that could never match. Build outputs are
    // exempt (git-ignored). Keep in sync with ci.yml and .husky/pre-commit.
    { name: "Package files[] exist", run: ["node", "scripts/check-package-files.cjs"] },
    { name: "Repo hygiene", run: ["node", "scripts/verify-repo-hygiene.cjs"] },
    // T5.8 — le pendant de « Repo hygiene ». Celle-ci empêche un script non DÉCLARÉ
    // d'entrer ; celle-là empêche un script déclaré et invoqué de rester non TRACÉ, état
    // dans lequel ci:local est vert ici et mort sur un clone frais.
    {
        name: "CI scripts are tracked (CI-SCRIPTS-TRACKED)",
        run: ["node", "scripts/verify-ci-scripts-tracked.cjs"],
    },
    // Les deux gates gardent la MÊME propriété par les deux bouts, d'où leur voisinage :
    // celle du dessus vérifie que tout script invoqué ici est tracé, celle-ci que toute gate
    // de `ci.yml` est bien invoquée ici — ou exemptée avec son motif ET son témoin.
    //
    // C'est ce qui rend enfin vraie la propriété annoncée en tête de ce fichier. Elle était
    // vérifiée sur un seul axe (le périmètre des tests, par `lib/test-scope.cjs`) et
    // conventionnée sur l'autre : la liste des gates reposait sur un commentaire « Keep this
    // list in sync », c'est-à-dire sur un geste manuel là où le fichier annonçait une garde.
    {
        name: "CI parity (ci.yml ⊆ ci:local, ou exempté avec témoin)",
        run: ["node", "scripts/verify-ci-parity.cjs"],
    },
    // T2.6 — le contrat de l'application (apps/geoleaf-app). Reprend les 2 assertions
    // retirées de `bundle.test.js`, et plusieurs de ses invariants portent sur les formes que
    // `build-deploy.cjs` patche par regex `/gm` sans `/s` : un retour à la ligne inséré
    // dans le commentaire `Optional plugins` ou dans un <script> de plugin gaté faisait
    // manquer le patch, et le déploiement sortait faux en exit 0. Statique, ~instantané.
    // ⚠️ Ce commentaire a écrit « ajoute 3 invariants » jusqu'au 08/08/2026 ; il y en avait
    // dix. Le compte n'est PAS recopié ici — il est dérivé de la liste des noms côté script
    // (doctrine B-43) et s'imprime en fin de run.
    {
        name: "App template contract (APP-TEMPLATE)",
        run: ["node", "scripts/verify-app-template.cjs"],
    },
    { name: "Plugin Contract v1", run: ["node", "scripts/verify-plugin-contract.cjs", "--fail"] },
    // Le gabarit est le seul paquet qu'AUCUNE des gates ci-dessus ne voit : ESLint l'ignore
    // (ses jetons `__PLUGIN_NAME__` ne sont pas du TS valide) ET il est hors des globs
    // `workspaces` (`!packages/_*`), donc `registry.all()` ne le rend jamais. Deux exclusions
    // légitimes qui, ensemble, laissent sans lecteur le fichier dont naît tout plugin futur.
    // Coût mesuré deux fois : l'accesseur `as any` y a survécu jusqu'au 31/07/2026, et son
    // `profileKey` violait INV-CONFIG — un invariant GELÉ — jusqu'au 08/08/2026. Cette gate
    // scaffolde et éprouve la SORTIE, seul canal par lequel un fichier à jetons peut être tenu
    // à la même barre que le code qu'il engendre. ⚠️ Elle exige `dist/types/` du core, d'où sa
    // place APRÈS le build.
    { name: "Plugin scaffold (SCAFFOLD)", run: ["node", "scripts/verify-plugin-scaffold.cjs"] },
    // B-100 — un `waitForFunction` dont le timeout part en 2e position le PERD : il devient
    // un argument de la fonction de page, et l'attente retombe sur `actionTimeout`. Mesuré :
    // 41 sites, dont 28 qui demandaient 15 à 30 s et n'obtenaient que 10. Le dépôt connaissait
    // le piège et l'avait documenté SUR UNE SPEC — une gate est ce qui généralise une leçon.
    {
        name: "E2E wait signature (E2E-WAIT-SIG)",
        run: ["node", "scripts/check-e2e-wait-signature.cjs"],
    },
    // S7 — these four run in ci.yml but were missing here, so `ci:local` could be green
    // while CI failed. That defeats the whole "ci:local green before push" protocol, whose
    // point is to never burn a run of a scarce free-tier quota: a mirror that omits gates
    // does not validate, it guesses.
    //
    // ⚠️ Cette ligne disait « Keep this list in sync with .github/workflows/ci.yml ». C'était
    // la seule chose qui tenait la propriété, et c'était un GESTE MANUEL — exactement ce que
    // le paragraphe en tête de ce fichier annonçait pourtant comme vérifié. L'étape
    // « CI parity » le vérifie désormais : une gate ajoutée à `ci.yml` et absente d'ici fait
    // rougir `ci:local` au lieu d'attendre qu'un run distant le découvre.
    {
        name: "Config coverage (schema ↔ inventory)",
        run: ["npm", "run", "verify:config-coverage"],
    },
    {
        name: "Config consumers (citations)",
        run: ["npm", "run", "verify:config-consumers"],
    },
    {
        // TPL-CFG — une couche produite par `layerTemplates` ne doit pas porter de
        // `_config.json` : son `inlineConfig` « skips the fetch entirely », donc le fichier
        // n'est lu par personne mais se fait éditer. 24 fantômes retirés à la tâche 7.1b.
        name: "Template layer configs (TPL-CFG — aucune config fantôme)",
        run: ["npm", "run", "check:template-layer-configs"],
    },
    { name: "Profile contract (validate:profiles)", run: ["npm", "run", "validate:profiles"] },
    { name: "Version consistency", run: ["npm", "run", "versions:check"] },
];

/**
 * Étapes ajoutées par `--e2e`. Séparées de STEPS, et non plus poussées dedans au chargement.
 *
 * La table doit être LISIBLE sans être exécutée : `verify-ci-scripts-tracked.cjs` (T5.8)
 * l'importe pour vérifier que tout script invoqué ici est suivi par git. Un `STEPS.push()`
 * conditionné à `process.argv` au niveau module aurait donné à ce lecteur une table
 * différente de celle qui tourne — et il aurait manqué les 3 étapes E2E, soit exactement
 * `build-deploy.cjs`, `build-deploy-coverage.cjs` et la suite Playwright.
 */
const E2E_STEPS = [
    { name: "Build deploy variants", run: ["npm", "run", "build:deploy:all"] },
    // T6.7a — `build:coverage` renommé : il ne construit AUCUN rapport de couverture,
    // il construit une APPLICATION (deploy-core aux bundles instrumentés Istanbul).
    // Le nom empruntait le vocabulaire du sens « rapport » pour désigner le sens
    // « variante de déploiement » — deux des quatre sens que porte le mot ici.
    { name: "Build deploy-coverage", run: ["npm", "run", "build:deploy-coverage"] },
    { name: "E2E Playwright", run: ["npm", "run", "test:e2e"] },
    // T6.1 — le seul consommateur de `.nyc_output/` était `report:e2e`, appelé par RIEN
    // (ni ci.yml, ni ici, ni le hook). La donnée était produite puis jetée à chaque run.
    // ⚠️ On n'appelle PAS `report:e2e` nu : `nyc report` sort VERT sur un `.nyc_output/`
    // vide, donc l'étape nue serait verte exactement quand la mesure échoue. Le wrapper
    // pose d'abord un plancher de témoin. Voir son en-tête.
    {
        name: "Couverture du boot du bundle livré (plancher + seuils nyc)",
        run: ["node", "scripts/verify-e2e-coverage.cjs"],
    },
];

const ALL_STEPS = WITH_E2E ? [...STEPS, ...E2E_STEPS] : STEPS;

function runStep(step, index) {
    const label = `[${index + 1}/${ALL_STEPS.length}] ${step.name}`;
    console.log(`\n\x1b[36m── ${label} ──\x1b[0m`);
    console.log(`   $ ${step.run.join(" ")}`);
    const start = process.hrtime.bigint();
    const res = spawnSync(step.run[0], step.run.slice(1), {
        cwd: ROOT,
        stdio: "inherit",
        shell: NPM_SHELL,
    });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const ok = res.status === 0;
    return { name: step.name, ok, ms, code: res.status };
}

function main() {
    console.log(
        `\x1b[1mLocal CI runner\x1b[0m — ${ALL_STEPS.length} gates${WITH_E2E ? " (incl. E2E)" : ""}` +
            `${BAIL ? ", bail on first failure" : ""}`
    );

    const results = [];
    for (let i = 0; i < ALL_STEPS.length; i++) {
        const r = runStep(ALL_STEPS[i], i);
        results.push(r);
        if (!r.ok && BAIL) break;
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log(`\n\x1b[1m── Résumé CI local ──\x1b[0m`);
    for (const r of results) {
        const tag = r.ok ? "\x1b[32m✓ PASS\x1b[0m" : "\x1b[31m✗ FAIL\x1b[0m";
        const secs = (r.ms / 1000).toFixed(1).padStart(6);
        console.log(`  ${tag}  ${secs}s  ${r.name}`);
    }

    const failed = results.filter((r) => !r.ok);
    const skipped = ALL_STEPS.length - results.length;
    if (skipped > 0) console.log(`  \x1b[33m… ${skipped} gate(s) non exécuté(s) (--bail)\x1b[0m`);

    // ── Ce que la CI exécutera et qui n'a PAS tourné ici ─────────────────────
    //
    // NARRATION, jamais VERDICT. Le verdict appartient à la gate « CI parity » ci-dessus :
    // deux chemins capables de faire échouer la même propriété, c'est un chemin de trop, et
    // c'est celui qu'on oublie de prouver. Ici on ne fait que rendre le vert HONNÊTE — un
    // vert qui se sait partiel vaut mieux qu'un vert qui promet trop.
    //
    // Position : le SEUL point neutre du résumé. Les deux branches terminales ci-dessous
    // appellent `process.exit` immédiatement, donc c'est le seul endroit qui s'affiche en
    // succès COMME en échec.
    //
    // Calculée depuis `ci.yml` + les tables, et NON depuis `results` : elle reste donc vraie
    // sous `--bail`, où la gate de parité n'a peut-être jamais tourné — précisément le run où
    // cette ligne compte le plus.
    //
    // ⚠️ Le try/catch est obligatoire et ne touche AUCUN code de sortie. Un `ci.yml` illisible
    // fait déjà rougir la gate de parité ; laisser une exception remonter ici remplacerait le
    // résumé qu'on vient de gagner par une trace de pile, à quatre lignes de la fin.
    try {
        for (const line of require("./lib/ci-parity.cjs").formatRemoteOnly({ withE2E: WITH_E2E })) {
            console.log(line);
        }
    } catch (err) {
        console.log(`  \x1b[33m⚠ énonciation de parité indisponible : ${err.message}\x1b[0m`);
        console.log(
            `  \x1b[2m    (le verdict est porté par la gate « CI parity » ci-dessus)\x1b[0m`
        );
    }

    if (failed.length > 0) {
        console.log(
            `\n\x1b[31m✗ ${failed.length}/${results.length} gate(s) en échec :\x1b[0m ` +
                failed.map((r) => r.name).join(", ")
        );
        process.exit(1);
    }

    console.log(
        `\n\x1b[32m✓ Toutes les gates passent (${results.length}/${results.length}).\x1b[0m`
    );
    process.exit(0);
}

// ── Exécution vs lecture (T5.8) ──────────────────────────────────────────────
//
// Ce fichier s'exécutait à l'import. Il est désormais aussi une SOURCE DE DONNÉES :
// `verify-ci-scripts-tracked.cjs` importe les deux tables pour vérifier que tout script
// invoqué ici est suivi par git — l'angle mort symétrique de celui que T3.5 a fermé.
//
// ⚠️ Cette gate lit la table RÉELLE plutôt que d'analyser ce fichier à la regex. Un
// parseur textuel qui cesse de matcher après un refactor de STEPS ne rougit pas : il
// trouve zéro script, les déclare tous suivis, et sort vert — le défaut même que le
// dépôt traque depuis T3. Un `require` ne peut pas rendre une table vide en silence.
// ⚠️ L'EXPORT VIENT AVANT L'EXÉCUTION, et l'ordre est un correctif, pas un style.
//
// `main()` charge `lib/ci-parity.cjs` pour son énonciation de fin de run, et ce module
// re-`require` CE fichier pour lire les deux tables — un cycle. Avec `module.exports` placé
// après l'appel, le cycle se referme sur un `exports` encore VIDE : `STEPS` et `E2E_STEPS`
// arrivaient `undefined`, et l'énonciation mourait sur « Cannot read properties of undefined ».
//
// Mesuré le 30/07/2026, et c'est le try/catch de `main()` qui l'a rendu visible sans coûter le
// résumé — il a imprimé le motif à la place de l'énonciation, exactement ce pour quoi il est là.
// Exporter d'abord referme le cycle sur des tables complètes.
module.exports = { STEPS, E2E_STEPS };

if (require.main === module) {
    main();
}
