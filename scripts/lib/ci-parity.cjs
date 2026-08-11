"use strict";
/**
 * ci-parity.cjs — le périmètre de `ci.yml`, comparé FEUILLE À FEUILLE à celui de `ci:local`.
 *
 * ## Ce que ce module existe pour rendre vrai
 *
 * `ci-local.cjs` déclare en tête la propriété `ci:local ⊇ ci.yml`, et la dit « vérifiée, pas
 * conventionnée ». C'était un sur-énoncé : `lib/test-scope.cjs` vérifie le périmètre des
 * TESTS UNITAIRES, et rien ne vérifiait la LISTE DES GATES. Une seule ligne de commentaire
 * (« Keep this list in sync with .github/workflows/ci.yml ») tenait lieu de garde, c'est-à-dire
 * un geste manuel là où le fichier annonçait une garantie. Le coût est direct : le quota
 * GitHub Actions est rare, et le protocole de push de CLAUDE.md fait du vert local le SEUL
 * critère avant d'en dépenser.
 *
 * ## Pourquoi par FEUILLE et jamais par étape
 *
 * Une étape de `ci.yml` peut enchaîner plusieurs commandes, et elles ne tombent pas dans la
 * même catégorie. L'étape E2E en enchaîne quatre :
 *
 *     node scripts/build-deploy.cjs           → équivalente à `build:deploy:all` (témoin)
 *     node scripts/build-deploy-coverage.cjs  → couverte, mais sous `--e2e` seulement
 *     playwright install --with-deps chromium → environnement, pas une gate
 *     playwright test                         → couverte, mais sous `--e2e` seulement
 *
 * Un classement par étape l'aurait déclarée « couverte » sur deux feuilles sur quatre et
 * perdu les deux autres en silence. Le classement par feuille est la CONDITION pour que la
 * catégorie « non couverte » puisse être vide sans mentir.
 *
 * ## Pourquoi un parseur maison plutôt que `yaml`
 *
 * `js-yaml` est absent, et `yaml` ne résout qu'en TRANSITIF (hissé depuis knip/lint-staged).
 * L'utiliser serait une dépendance fantôme : la catégorie « imports non déclarés » de knip la
 * signalerait — cette gate casserait donc la gate `dead-code` qui tourne avant elle — et un
 * `npm install` qui de-hisse `yaml` la tuerait en `MODULE_NOT_FOUND`, c'est-à-dire une gate
 * qui disparaît.
 *
 * ⚠️ L'objection sérieuse est que c'est exactement le « parseur textuel qui cesse de matcher »
 * que `verify-ci-scripts-tracked.cjs` interdit dans son propre en-tête. La réponse n'est PAS
 * « ce parseur sera bon ». C'est que la propriété n'est pas portée par le parseur, mais par
 * trois instruments autour de lui :
 *
 *   1. Il est STRICT — il ne saute jamais. Toute ligne du bloc `jobs:` qu'il ne sait pas
 *      classer JETTE. Sauter, c'est devenir aveugle en silence ; jeter, c'est refuser de
 *      conclure.
 *   2. Un CONTRE-INSTRUMENT de nature différente, sur le même corpus : un comptage brut au
 *      grep doit rendre exactement autant de `run:`/`uses:` que le parcours structuré. Un
 *      parseur qui cesse de matcher rend MOINS, le grep rend autant, et l'écart fait rougir.
 *      Un `yaml` déclaré ne dispenserait pas de ce contrôle : il rend un arbre correct, pas
 *      la preuve que l'arbre est bien le fichier entier.
 *   3. Des PLANCHERS TÉMOINS, pour l'effondrement que la strictesse ne voit pas (toute
 *      l'indentation décalée d'un cran, uniformément et validement).
 *
 * ## Ce module n'exécute rien à l'import
 *
 * Même contrainte que `lib/hygiene-patterns.cjs`, extrait de `verify-repo-hygiene.cjs` pour
 * qu'un second lecteur puisse l'interroger : `ci-local.cjs` lit ces données pour son
 * énonciation de fin de run, et ne doit ni spawn, ni risquer un `process.exit` à l'import.
 * Aucune fonction d'ici n'appelle `process.exit` — elles jettent, l'appelant décide.
 */

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./packages.cjs");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Répertoire des workflows. Surchargeable pour que la gate soit PROUVABLE : sans ce crochet,
 * la seule façon de la voir rougir serait de modifier le vrai `ci.yml` — donc on ne le ferait
 * qu'une fois, à la pose, et jamais plus. Précédent établi ×3 dans le dépôt
 * (`GEOLEAF_NYC_OUTPUT`, `GEOLEAF_DOCS_SITE_ROOT`, `GEOLEAF_LOAD_AUDIT_DIR`).
 *
 * ⚠️ Le corpus est LU, jamais codé en dur fichier par fichier : un chemin en dur cesse
 * silencieusement de matcher au moindre renommage, et la gate sort verte en n'ayant rien
 * scanné (CLAUDE.md §Pré-vol).
 */
function workflowDir() {
    const override = process.env.GEOLEAF_CI_WORKFLOW_DIR;
    return override ? path.resolve(ROOT, override) : path.join(ROOT, ".github", "workflows");
}

/**
 * Planchers témoins — mesure du 30/07/2026 : 1 workflow, 1 job, 55 étapes (48 `run:`,
 * 7 `uses:`), et 56 entrées dans `STEPS`.
 *
 * ⚠️ Ils portent sur le CORPUS, jamais sur le VERDICT. Un plancher sur « N étapes couvertes »
 * serait un cliquet de couverture : il rougirait au premier gate retiré à bon escient, ce que
 * `MIN_RESOLVED` de `verify-ci-scripts-tracked.cjs` refuse explicitement. Ils sont
 * délibérément SOUS la mesure — ils détectent un effondrement, pas une unité — et ne se
 * recliquettent pas à chaque gate ajoutée : `ci.yml` en a gagné une pendant la rédaction.
 */
const FLOOR = {
    workflows: 1,
    jobs: 1,
    steps: 45,
    runKeys: 38,
    ciLeaves: 35,
    localSteps: 45,
};

// ── Parseur strict ───────────────────────────────────────────────────────────

/** Formes YAML que ce parseur ne modélise pas, et sur lesquelles il refuse de deviner. */
const UNMODELLED = [
    [/(^|\s)&[A-Za-z0-9_-]+\s*$/, "ancre YAML (`&nom`)"],
    [/:\s*\*[A-Za-z0-9_-]+\s*$/, "alias YAML (`*nom`)"],
    [/^\s*<<\s*:/, "clé de fusion (`<<:`)"],
    [/^\s*[A-Za-z0-9_.-]+:\s*\{/, "mapping en flot (`{…}`)"],
];

/**
 * Parse un workflow en `{ jobs: [{ id, steps: [...] }] }`.
 *
 * @param {string} text Contenu du fichier.
 * @param {string} file Nom du fichier, pour les messages d'erreur.
 * @returns {{jobs: {id: string, line: number, steps: object[]}[]}} L'arbre des jobs.
 * @throws {Error} Sur toute ligne du bloc `jobs:` que le parseur ne sait pas classer.
 */
function parseWorkflow(text, file) {
    const raw = text.split(/\r?\n/);
    const err = (i, msg) => {
        throw new Error(`${file}:${i + 1} — ${msg}`);
    };

    // Les commentaires sont retirés AVANT toute détection de forme : `ci.yml` porte des
    // commentaires en français avec du **gras** markdown, et un `*mot*` y déclencherait un
    // faux « alias YAML ». On ne retire que les lignes entièrement commentées ; un `# v4` en
    // fin de `uses:` est traité par le lecteur de valeur, pas ici.
    const lines = raw.map((l) => (/^\s*#/.test(l) ? "" : l));

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        for (const [re, what] of UNMODELLED) {
            if (re.test(lines[i])) err(i, `${what} — non modélisé, ce parseur refuse de deviner`);
        }
    }

    const indentOf = (l) => l.match(/^ */)[0].length;
    const isBlank = (l) => !l.trim();

    // `jobs:` à l'indentation racine.
    let jobsLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^jobs:\s*$/.test(lines[i])) {
            jobsLine = i;
            break;
        }
    }
    if (jobsLine === -1) throw new Error(`${file} — aucun bloc \`jobs:\` à l'indentation 0`);

    // Bornes du bloc `jobs:` : jusqu'à la prochaine clé d'indentation 0.
    let jobsEnd = lines.length;
    for (let i = jobsLine + 1; i < lines.length; i++) {
        if (!isBlank(lines[i]) && indentOf(lines[i]) === 0) {
            jobsEnd = i;
            break;
        }
    }

    // Indentation des identifiants de job — DÉRIVÉE, jamais supposée à 4.
    let jobIdIndent = -1;
    for (let i = jobsLine + 1; i < jobsEnd; i++) {
        if (isBlank(lines[i])) continue;
        jobIdIndent = indentOf(lines[i]);
        break;
    }
    if (jobIdIndent <= 0) throw new Error(`${file} — bloc \`jobs:\` vide`);

    const jobs = [];
    for (let i = jobsLine + 1; i < jobsEnd; i++) {
        if (isBlank(lines[i])) continue;
        if (indentOf(lines[i]) !== jobIdIndent) continue;
        const m = lines[i].match(/^\s*([A-Za-z0-9_.-]+):\s*$/);
        if (!m) err(i, `identifiant de job attendu à l'indentation ${jobIdIndent}`);
        let end = jobsEnd;
        for (let j = i + 1; j < jobsEnd; j++) {
            if (!isBlank(lines[j]) && indentOf(lines[j]) <= jobIdIndent) {
                end = j;
                break;
            }
        }
        jobs.push({ id: m[1], line: i + 1, steps: parseSteps(lines, i + 1, end, file, err) });
    }

    if (!jobs.length) throw new Error(`${file} — aucun job`);
    return { jobs };
}

/** Extrait les étapes d'un bloc de job. Un job SANS `steps:` fait rougir plutôt que d'être sauté. */
function parseSteps(lines, from, to, file, err) {
    const indentOf = (l) => l.match(/^ */)[0].length;
    const isBlank = (l) => !l.trim();

    let stepsLine = -1;
    for (let i = from; i < to; i++) {
        if (/^\s*steps:\s*$/.test(lines[i])) {
            stepsLine = i;
            break;
        }
    }
    if (stepsLine === -1) {
        // Un job sans `steps:` est un workflow réutilisable (`jobs.<id>.uses:`) : son contenu
        // est hors de portée de ce parseur. Le sauter en silence mettrait la moitié de la CI
        // hors du champ tout en affichant « 0 non couverte » — le mode d'échec « périmètre
        // vide » que tout ce fichier existe pour interdire.
        throw new Error(
            `${file}:${from} — job sans \`steps:\` (workflow réutilisable ?). Ce parseur ne le ` +
                `modélise pas, et le sauter mettrait ses gates hors du champ sans le dire.`
        );
    }

    // Indentation des éléments de la séquence — DÉRIVÉE du premier tiret rencontré.
    let itemIndent = -1;
    for (let i = stepsLine + 1; i < to; i++) {
        if (isBlank(lines[i])) continue;
        if (/^\s*- /.test(lines[i])) {
            itemIndent = indentOf(lines[i]);
            break;
        }
        err(i, "élément de séquence attendu sous `steps:`");
    }
    if (itemIndent === -1) err(stepsLine, "`steps:` sans aucune étape");

    const steps = [];
    for (let i = stepsLine + 1; i < to; i++) {
        if (isBlank(lines[i]) || indentOf(lines[i]) !== itemIndent) continue;
        if (!/^\s*- /.test(lines[i]))
            err(i, `élément de séquence attendu à l'indentation ${itemIndent}`);
        let end = to;
        for (let j = i + 1; j < to; j++) {
            if (!isBlank(lines[j]) && indentOf(lines[j]) <= itemIndent) {
                end = j;
                break;
            }
        }
        steps.push(parseStep(lines, i, end, itemIndent, file, err));
    }
    return steps;
}

/** Une étape : `name`, `run` (commande complète, scalaires de bloc inclus), `uses`, `if`. */
function parseStep(lines, start, end, itemIndent, file, err) {
    const indentOf = (l) => l.match(/^ */)[0].length;
    const keyIndent = itemIndent + 2; // YAML : les clés d'un mapping s'alignent après « - »
    const step = {
        line: start + 1,
        name: null,
        run: null,
        uses: null,
        hasIf: false,
        hasEnv: false,
    };

    for (let i = start; i < end; i++) {
        if (!lines[i].trim()) continue;
        const ind = i === start ? itemIndent : indentOf(lines[i]);
        // Le premier `- clé:` et les clés suivantes vivent au même niveau logique.
        if (i !== start && ind !== keyIndent) continue; // sous-bloc (`with:`, `env:`) — ignoré
        const body = i === start ? lines[i].replace(/^\s*- /, "") : lines[i].trim();
        const m = body.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (!m) err(i, "clé d'étape attendue");
        const [, key, rest] = m;

        if (key === "run") step.run = readScalar(lines, i, rest, keyIndent);
        else if (key === "uses") step.uses = stripTrailingComment(rest).trim();
        else if (key === "name")
            step.name = stripTrailingComment(rest)
                .trim()
                .replace(/^["']|["']$/g, "");
        // ⚠️ La CONDITION est retenue, pas seulement sa présence. `hasIf` seul ne permettait
        // pas de distinguer `if: always()` de `if: github.event_name == 'workflow_dispatch'`,
        // et c'est exactement la distinction dont PARITY-11 a besoin pour vérifier que les
        // étapes E2E restent hors du chemin `push`.
        else if (key === "if") {
            step.hasIf = true;
            step.ifCond = stripTrailingComment(rest).trim();
        } else if (key === "env") step.hasEnv = true;
        // `with:`, `id:`, `continue-on-error:`… — sans effet sur le périmètre.
    }

    if (!step.run && !step.uses) {
        err(start, "étape sans `run:` ni `uses:` — forme non modélisée");
    }
    return step;
}

/** Lit une valeur scalaire, en absorbant un scalaire de bloc (`|`, `>`) s'il y en a un. */
function readScalar(lines, i, inline, keyIndent) {
    const head = inline.trim();
    if (!/^[|>][-+]?$/.test(head)) return stripTrailingComment(head).trim();
    const parts = [];
    for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (lines[j].match(/^ */)[0].length <= keyIndent) break;
        parts.push(lines[j].trim());
    }
    return parts.join(" ");
}

/**
 * Retire un commentaire de fin de ligne (` # v4`).
 *
 * ⚠️ Ne coupe que sur un `#` précédé d'un espace ET hors guillemets — sinon `--flag=a#b` ou
 * une chaîne contenant un `#` serait tronquée, et la feuille produite ne serait pas la
 * commande réellement exécutée.
 */
function stripTrailingComment(s) {
    let quote = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === "#" && i > 0 && /\s/.test(s[i - 1])) {
            return s.slice(0, i);
        }
    }
    return s;
}

/**
 * Contre-instrument : comptage BRUT des clés `run:`/`uses:`, sans passer par le parseur.
 *
 * ⚠️ La forme `- run:` (première clé d'un élément de séquence) compte autant que ` run:`.
 * Un `grep '^\s*uses:'` en rate deux sur sept dans le `ci.yml` actuel — c'est très exactement
 * l'erreur de mesure que ce module doit refuser de commettre.
 */
function rawCounts(text) {
    const body = text
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
    return {
        runKeys: (body.match(/^ +(?:- )?run:/gm) || []).length,
        usesKeys: (body.match(/^ +(?:- )?uses:/gm) || []).length,
    };
}

// ── Résolveur de feuilles ────────────────────────────────────────────────────

const NPM_RUN_RE = /^npm run ([\w:.-]+)(.*)$/;
const WORKSPACE_RE = /(?:-w|--workspace)[= ]([@\w./-]+)/;

/** Découpe une commande shell sur ses enchaînements de premier niveau. */
function splitChain(cmd) {
    return cmd
        .split(/&&|\|\||;/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Normalise un segment de commande vers une forme canonique comparable.
 *
 * Chaque normalisation a un coût, nommé ici :
 *  • `npx ` retiré — `npx eslint` et `eslint` résolvent le même binaire local. Coût : un
 *    `npx paquet@version` visant un binaire NON installé deviendrait indiscernable du local.
 *    Aucun cas aujourd'hui ; à re-décider s'il en apparaît un.
 *  • `npm test` / `npm t` → `npm run test`, sans quoi le gate unitaire local ne résout pas.
 *  • espaces collapsés. Rien d'autre : l'ORDRE et le CONTENU de l'argv restent significatifs,
 *    et c'est ce qui empêche `--plugins=addpoi` de matcher `--plugins=all`.
 */
function normalize(seg) {
    let s = seg.replace(/\s+/g, " ").trim();
    s = s.replace(/^npx (?:--yes |-y )?/, "");
    s = s.replace(/^npm (?:test|t)\b/, "npm run test");
    return s;
}

function scriptsOf(pkgDir) {
    const file = path.join(pkgDir, "package.json");
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8")).scripts || {};
}

/**
 * Déplie une commande jusqu'à ses commandes FEUILLES canoniques.
 *
 * Un `npm run <x>` est remplacé par le corps du script, résolu dans le BON `package.json` :
 * `-w`/`--workspace` déplace la résolution vers le paquet nommé, et sans ce cas
 * `test:bundle --workspace=@geoleaf/core` (CI) et `test:bundle -w @geoleaf/core` (local)
 * seraient deux feuilles différentes — trois faux rouges d'entrée.
 *
 * Un `npm run` que rien ne définit devient `UNRESOLVED:<nom>` plutôt qu'une feuille ordinaire.
 * La distinction compte : classé « non couvert », on lirait un défaut de parité là où le vrai
 * défaut est un `ci.yml` cassé, qui mourra en « Missing script » sur le runner.
 *
 * @param {string} cmd Commande complète, enchaînements compris.
 * @param {string|null} [ws] Paquet de résolution courant.
 * @param {Set<string>} [seen] Garde-fou de récursion sur des scripts npm cycliques.
 * @returns {string[]} Feuilles canoniques, dans l'ordre d'exécution.
 */
function resolveLeaves(cmd, ws = null, seen = new Set()) {
    const out = [];
    for (const rawSeg of splitChain(cmd)) {
        const seg = normalize(rawSeg);
        const m = seg.match(NPM_RUN_RE);
        if (!m) {
            out.push(ws ? `${seg} @${ws}` : seg);
            continue;
        }
        const [, name, tail] = m;
        const wsMatch = tail.match(WORKSPACE_RE);
        const nextWs = wsMatch ? wsMatch[1] : ws;
        const key = `${name} @${nextWs || ""}`;
        if (seen.has(key)) continue; // cycle — déjà déplié
        seen.add(key);

        let dir = ROOT;
        if (nextWs) {
            const entry = registry.byName(nextWs);
            if (!entry) {
                out.push(`UNRESOLVED:${name} @${nextWs}`);
                continue;
            }
            dir = entry.absDir;
        }
        const body = scriptsOf(dir)[name];
        if (body === undefined) {
            out.push(`UNRESOLVED:${name}${nextWs ? ` @${nextWs}` : ""}`);
            continue;
        }
        out.push(...resolveLeaves(body, nextWs, seen));
    }
    return out;
}

/** Feuilles atteintes par une table d'étapes de `ci-local.cjs`. */
function leavesOfSteps(steps) {
    const set = new Set();
    for (const step of steps) {
        for (const leaf of resolveLeaves(step.run.join(" "))) set.add(leaf);
    }
    return set;
}

// ── Les trois tables ─────────────────────────────────────────────────────────
//
// Une allowlist en dur redeviendrait le « Keep this list in sync » qu'on remplace, avec un
// nom plus noble. D'où deux propriétés, sur les trois tables :
//
//   • elles sont KEYÉES sur la feuille canonique — une clé qui ne désigne plus rien dans
//     `ci.yml` fait ROUGIR (même asymétrie que `assertExclusionKeysAlive` de test-scope.cjs :
//     une clé qui ne dispense plus de rien est toujours une erreur, alors qu'une étape absente
//     des tables est le cas normal) ;
//   • chaque entrée porte un TÉMOIN, évalué à chaque run, qui rend `false` quand la CAUSE de
//     l'exemption tombe. C'est l'inversion du `PENDING` de `probe-gate-visibility.cjs` :
//     là-bas un item attendu-rouge qui passe au vert fait rougir « pour qu'il ne pourrisse pas
//     en mensonge » ; ici c'est une dispense dont la raison d'être a disparu.
//
// `gateReelle` sépare « incouvrable et inerte » (installer Node, publier un artefact) de
// « incouvrable mais gate réelle » (gitleaks). L'énonciation de fin de run ne compte que les
// secondes : y mêler les premières gonflerait le chiffre annoncé, et plus personne ne le lirait.

/** @type {Record<string, {classe: string, gateReelle: boolean, motif: string, temoin: (ctx: object) => boolean}>} */
const EXEMPTIONS = {
    "npm ci": {
        classe: "ENV",
        gateReelle: false,
        motif: "installation des dépendances — le poste local les a déjà.",
        // Si `npm ci` cesse d'être la première commande du workflow, l'ordre a changé assez
        // pour que cette dispense mérite d'être relue plutôt que reconduite.
        temoin: (ctx) => ctx.firstLeaf === "npm ci",
    },
    "playwright install --with-deps chromium": {
        classe: "ENV",
        gateReelle: false,
        motif: "runner neuf à chaque run ; le poste local présuppose les navigateurs installés.",
        // Sans suite E2E locale, installer des navigateurs ne dispense plus de rien.
        temoin: (ctx) => ctx.e2eLeaves.has("playwright test"),
    },
    "vitest run --reporter=json --outputFile=test-results.json --reporter=verbose": {
        classe: "FORME",
        gateReelle: false,
        motif:
            "même corpus, ordonnanceur différent — `ci.yml` lance vitest en mode `projects`, " +
            "`ci:local` essaime par turbo. L'INCLUSION des périmètres est vérifiée par " +
            "test-scope.cjs, pas conventionnée.",
        temoin: () => {
            const ts = require("./test-scope.cjs");
            ts.assertUnitScopeCoversRoot(); // jette si l'inclusion tombe
            // ⚠️ …et l'inclusion est vraie À VIDE si les deux périmètres rétrécissent de
            // concert. Un témoin doit vérifier que ce à quoi il délègue n'est pas vide, sinon
            // la doctrine s'arrête d'un niveau trop tôt.
            return ts.rootProjectScope().length >= 8;
        },
    },
    "node scripts/check-test-failures.cjs": {
        classe: "CI-SEULE",
        gateReelle: true,
        motif:
            "parse `test-results.json`, que seul le reporter JSON de `ci.yml` produit. " +
            "`ci:local` se fie aux codes de sortie de turbo/vitest.",
        temoin: (ctx) =>
            [...ctx.ciLeaves].some((l) => l.includes("--outputFile=test-results.json")),
    },
    "node scripts/build-deploy.cjs": {
        classe: "ÉQUIVALENCE",
        gateReelle: false,
        motif:
            "PAS un surensemble de `build:deploy:all` — la MÊME exécution. Sans argument, " +
            'resolvePluginMode rend null, et `buildsAllVariants(null) === buildsAllVariants("all")`.',
        // Le témoin appelle le prédicat que le build utilise LUI-MÊME (build-deploy.cjs
        // l'exporte et en dérive BUILD_ALL_VARIANTS) : une copie de la formule ici
        // continuerait de dire « équivalent » après que la règle a changé.
        temoin: () => {
            const { resolvePluginMode, buildsAllVariants } = require("../build-deploy.cjs");
            return (
                buildsAllVariants(resolvePluginMode([])) === true &&
                buildsAllVariants(resolvePluginMode(["--plugins=all"])) === true
            );
        },
    },
};

/**
 * Actions externes. KEYÉES sur `owner/repo`, JAMAIS sur le SHA : épingler le SHA ferait
 * rougir la gate à chaque bump dependabot, et une gate bruyante finit désarmée. Le SHA est
 * imprimé dans le rapport — visible sans être bloquant.
 *
 * ⚠️ `uses:` n'est PAS une exemption automatique, et c'est le trou principal de cette
 * conception : migrer `npm run lint` vers un `uses: reviewdog/action-eslint` ferait
 * disparaître une gate RÉELLE dans une catégorie muette. Une action non listée ROUGIT.
 * Résiduel non fermable : quelqu'un qui l'ajoute ici avec un motif faux. Seule une relecture
 * l'attrape — l'écrire plutôt que prétendre l'avoir résolu.
 */
const ACTION_EXEMPTIONS = {
    "actions/checkout": {
        gateReelle: false,
        motif: "récupération des sources — sans objet en local.",
    },
    "actions/setup-node": {
        gateReelle: false,
        motif: "provisionne Node depuis .nvmrc — le poste l'a déjà.",
    },
    "actions/upload-artifact": {
        gateReelle: false,
        motif: "publication de rapports — ne contrôle rien, ne peut pas faire échouer une gate.",
    },
    // 🗑️ `gitleaks/gitleaks-action` — entrée RETIRÉE le 11/08/2026, avec l'action elle-même.
    //
    // Elle portait le seul `partialMotif` du fichier : l'action couvrait un chemin
    // `pull_request` que le local ne pouvait pas rejouer. **Ce partage n'existe plus** — la
    // gate est désormais `run: node scripts/gitleaks-local.cjs` des DEUX côtés, donc une
    // étape ordinaire, couverte par PARITY sans exemption.
    //
    // Le motif du retrait n'est pas l'élégance : `gitleaks-action` est **payante en
    // organisation**, et elle échouait sur 100 % des runs du dépôt public
    // (`[geoleaf] is an organization. License key is required.`). Le binaire, lui, est libre.
    //
    // 📌 C'est PARITY-04 qui a exigé cette suppression, le jour même : une exemption dont
    // plus aucune étape n'use est périmée, et la gate a rougi dessus. C'est exactement ce
    // qu'elle existe pour attraper — une énonciation qui survit à son objet.
};

/**
 * Étapes de `ci.yml` que `ci:local` ne couvre QUE sous `--e2e`.
 *
 * L'ensemble est DÉRIVÉ (appartenance à `E2E_STEPS`) ; cette table en est l'AUTORISATION.
 * Les deux écarts rougissent : dérivé ∖ déclaré (une gate a glissé sous `--e2e` sans que ce
 * soit écrit), déclaré ∖ dérivé (entrée périmée).
 *
 * ⚠️ **Ces trois-là ne sont plus un ÉCART depuis le 01/08/2026, mais une SYMÉTRIE.** Tant que
 * `ci.yml` les lançait à chaque push alors que `ci:local` les réservait à `--e2e`, cette table
 * documentait le seul trou structurel de la promesse « local vert ⟹ push vert » : le drapeau
 * est local, GitHub ne le connaît pas, et aucune discipline ne pouvait combler ça. Les trois
 * étapes portent désormais `if: github.event_name == 'workflow_dispatch'` côté workflow — les
 * deux côtés sont donc manuels, et l'écart est fermé PAR CONSTRUCTION.
 *
 * Le prix est nommé dans `ci.yml` à côté de l'étape : le runner était le seul endroit qui
 * éprouvait la suite sur clone frais ET sur 2-4 cœurs.
 */
const DEFERRED_TO_E2E = {
    "node scripts/build-deploy-coverage.cjs":
        "construit l'application instrumentée Istanbul — une seconde build complète, hors du mode rapide.",
    "playwright test":
        "la suite E2E et ses navigateurs — le coût qui justifie l'existence du drapeau.",
    "node scripts/verify-e2e-coverage.cjs":
        "⚠️ étape TOP-LEVEL de ci.yml, PAS un morceau de la chaîne E2E — mais elle en lit la " +
        "sortie (`.nyc_output/`), donc elle suit le même déclencheur manuel depuis le " +
        "01/08/2026. Cette entrée a affirmé « la CI la lance à CHAQUE run » jusqu'à cette date : " +
        "c'était vrai, ça ne l'est plus. Sans données, elle refuse de conclure.",
};

/** Étapes portant un `env:` propre, tolérées parce que mesurées et motivées. */
const ENV_ALLOWLIST = new Set(["Secret scan (gitleaks)"]);

// ── Classement ───────────────────────────────────────────────────────────────

/**
 * Lit le corpus, classe chaque feuille, et rend les faits ET les problèmes.
 *
 * ⚠️ L'appelant doit traiter les planchers et l'accord parseur/grep AVANT de lire le
 * classement : sur un corpus effondré, « 0 feuille non couverte » est vrai par accident.
 * L'ordre des codes ci-dessous suit cette exigence.
 *
 * @returns {{corpus: object, entries: object[], problems: object[], remoteOnly: object[]}} Le rapport.
 * @throws {Error} Si le répertoire de workflows est illisible, ou un fichier non parsable.
 */
function classify() {
    const dir = workflowDir();
    if (!fs.existsSync(dir)) throw new Error(`répertoire de workflows introuvable : ${dir}`);
    const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

    const corpus = {
        dir,
        workflows: files.length,
        jobs: 0,
        steps: 0,
        runKeys: 0,
        usesKeys: 0,
        rawRunKeys: 0,
        rawUsesKeys: 0,
    };
    const problems = [];
    const ciSteps = [];

    for (const f of files) {
        const txt = fs.readFileSync(path.join(dir, f), "utf8");
        const wf = parseWorkflow(txt, f);
        const raw = rawCounts(txt);
        corpus.rawRunKeys += raw.runKeys;
        corpus.rawUsesKeys += raw.usesKeys;
        for (const job of wf.jobs) {
            corpus.jobs++;
            for (const s of job.steps) {
                corpus.steps++;
                if (s.run) corpus.runKeys++;
                if (s.uses) corpus.usesKeys++;
                ciSteps.push({ ...s, file: f });
            }
        }
    }

    // PARITY-07 — l'accord des deux instruments, avant tout verdict.
    if (corpus.runKeys !== corpus.rawRunKeys || corpus.usesKeys !== corpus.rawUsesKeys) {
        problems.push({
            code: "PARITY-07",
            message:
                `parseur désaccordé du grep — structuré ${corpus.runKeys} run:/${corpus.usesKeys} uses:, ` +
                `brut ${corpus.rawRunKeys}/${corpus.rawUsesKeys}. Le périmètre lu n'est pas le fichier.`,
        });
    }

    // Feuilles CI, dans l'ordre, avec les étapes qui les portent.
    const ciLeaves = new Map();
    /** @type {Map<string, object[]>} feuille → étapes structurées (pour lire leur `if:`). */
    const ciLeafSteps = new Map();
    let firstLeaf = null;
    for (const s of ciSteps) {
        if (!s.run) continue;
        for (const leaf of resolveLeaves(s.run)) {
            if (firstLeaf === null) firstLeaf = leaf;
            if (!ciLeaves.has(leaf)) ciLeaves.set(leaf, []);
            ciLeaves.get(leaf).push(s.name || "(anonyme)");
            // L'ÉTAPE elle-même, et pas seulement son nom : PARITY-11 doit lire son `if:`.
            if (!ciLeafSteps.has(leaf)) ciLeafSteps.set(leaf, []);
            ciLeafSteps.get(leaf).push(s);
        }
    }
    corpus.ciLeaves = ciLeaves.size;

    const { STEPS, E2E_STEPS } = require("../ci-local.cjs");
    corpus.localSteps = STEPS.length;
    corpus.e2eSteps = E2E_STEPS.length;
    const localLeaves = leavesOfSteps(STEPS);
    const e2eLeaves = leavesOfSteps(E2E_STEPS);

    const ctx = { ciLeaves: new Set(ciLeaves.keys()), localLeaves, e2eLeaves, firstLeaf };

    // PARITY-01 — planchers témoins. Sous le plancher, on REFUSE DE CONCLURE.
    for (const [key, min] of Object.entries(FLOOR)) {
        const got = corpus[key];
        if (typeof got === "number" && got < min) {
            problems.push({
                code: "PARITY-01",
                message:
                    `témoin en échec — ${key} = ${got} (plancher ${min}). REFUSE DE CONCLURE : ` +
                    `un « 0 feuille non couverte » depuis ce corpus serait vrai et vide de sens.`,
            });
        }
    }

    // Classement, feuille par feuille.
    const entries = [];
    for (const [leaf, owners] of ciLeaves) {
        const steps = [...new Set(owners)];
        if (leaf.startsWith("UNRESOLVED:")) {
            problems.push({
                code: "PARITY-02",
                message:
                    `\`${leaf.slice("UNRESOLVED:".length)}\` — \`npm run\` défini nulle part, ` +
                    `atteint depuis « ${steps.join(" | ")} ». L'étape mourra sur le runner en ` +
                    `« Missing script » : ce n'est pas un défaut de parité, c'est un ci.yml cassé.`,
            });
            entries.push({ leaf, category: "UNRESOLVED", steps });
            continue;
        }
        if (localLeaves.has(leaf)) {
            entries.push({ leaf, category: "COVERED", steps });
            continue;
        }
        const ex = EXEMPTIONS[leaf];
        if (ex) {
            let alive = false;
            let why = "";
            try {
                alive = ex.temoin(ctx) === true;
            } catch (err) {
                why = ` (${err.message})`;
            }
            if (!alive) {
                problems.push({
                    code: "PARITY-05",
                    message:
                        `EXEMPTIONS[« ${leaf} »] — TÉMOIN EN ÉCHEC${why}. La cause qui justifiait ` +
                        `la dispense est tombée : « ${ex.motif} » n'est plus vrai, et la feuille ` +
                        `redevient non couverte sans que personne ne l'ait décidé.`,
                });
            }
            entries.push({ ...ex, leaf, category: "EXEMPT", steps, alive });
            continue;
        }
        if (e2eLeaves.has(leaf)) {
            const declared = DEFERRED_TO_E2E[leaf];
            if (!declared) {
                problems.push({
                    code: "PARITY-08",
                    message:
                        `« ${leaf} » est couverte SEULEMENT sous \`--e2e\` mais n'est pas déclarée ` +
                        `dans DEFERRED_TO_E2E. Une gate a glissé hors du mode par défaut sans que ` +
                        `ce soit écrit — c'est-à-dire sans que le vert par défaut le dise.`,
                });
            }
            entries.push({
                leaf,
                category: "E2E",
                steps,
                motif: declared || null,
                gateReelle: true,
            });
            continue;
        }
        problems.push({
            code: "PARITY-03",
            message:
                `« ${leaf} » — NON COUVERTE ET NON EXPLIQUÉE.\n` +
                `      portée par : ${steps.join(" | ")}\n` +
                `      La CI exécutera cette commande ; \`ci:local\` ne la lance dans aucun mode.\n` +
                `      Trois issues, et une seule serait un mensonge : l'ajouter à STEPS, ` +
                `l'ajouter à E2E_STEPS + DEFERRED_TO_E2E, ou écrire une entrée d'EXEMPTIONS ` +
                `avec son témoin.`,
        });
        entries.push({ leaf, category: "ORPHAN", steps, gateReelle: true });
    }

    // PARITY-11 — les étapes différées à `--e2e` doivent rester HORS du chemin `push`.
    //
    // ⚠️ C'est le témoin de la promesse « ci:local vert ⟹ push vert », et sans lui cette
    // promesse serait une phrase. Tant que `ci.yml` lançait l'E2E à chaque push pendant que
    // `ci:local` la réservait à `--e2e`, l'écart était STRUCTUREL : le drapeau est local,
    // GitHub ne le connaît pas. Le 01/08/2026 les trois étapes sont passées sous
    // `workflow_dispatch` — mais retirer ce `if:` rouvrirait le trou en SILENCE, et la table
    // DEFERRED_TO_E2E continuerait d'annoncer « 3 sous --e2e » comme si de rien n'était.
    // Une dispense dont la condition n'est pas vérifiée est une dispense qui pourrit.
    const DISPATCH_RE = /github\.event_name\s*==\s*['"]workflow_dispatch['"]/;
    for (const leaf of Object.keys(DEFERRED_TO_E2E)) {
        for (const s of ciLeafSteps.get(leaf) || []) {
            if (DISPATCH_RE.test(s.ifCond || "")) continue;
            problems.push({
                code: "PARITY-11",
                message:
                    `« ${leaf} » est déclarée dans DEFERRED_TO_E2E — donc NON lancée par ` +
                    `\`ci:local\` sans \`--e2e\` — mais son étape « ${s.name || "(anonyme)"} » ` +
                    `de ci.yml tourne sur le chemin \`push\`` +
                    (s.ifCond ? ` (if: ${s.ifCond})` : " (aucun `if:`)") +
                    `.\n      C'est le trou exact que le 01/08/2026 a fermé : un push exécute ` +
                    `alors une gate qu'aucun vert local n'a éprouvée.\n      Deux issues : ` +
                    `poser \`if: github.event_name == 'workflow_dispatch'\` sur l'étape, ou ` +
                    `sortir la feuille de E2E_STEPS pour que \`ci:local\` la lance par défaut.`,
            });
        }
    }

    // PARITY-04 — clés mortes, sur les trois tables. Une dispense qui ne dispense plus de
    // rien est toujours une erreur : personne ne le saurait, et elle survivrait à sa cause.
    const seenLeaves = new Set(ciLeaves.keys());
    for (const key of Object.keys(EXEMPTIONS)) {
        if (!seenLeaves.has(key)) {
            problems.push({
                code: "PARITY-04",
                message: `EXEMPTIONS[« ${key} »] — PÉRIMÉE : la clé ne désigne plus aucune feuille de ci.yml.`,
            });
        }
    }
    for (const key of Object.keys(DEFERRED_TO_E2E)) {
        if (!seenLeaves.has(key)) {
            problems.push({
                code: "PARITY-04",
                message: `DEFERRED_TO_E2E[« ${key} »] — PÉRIMÉE : la clé ne désigne plus aucune feuille de ci.yml.`,
            });
        }
    }

    // Actions externes — PARITY-06 pour toute action non listée, et clé morte pour l'inverse.
    const actions = [];
    const seenActions = new Set();
    for (const s of ciSteps) {
        if (!s.uses) continue;
        const [ref, sha] = s.uses.split("@");
        seenActions.add(ref);
        const known = ACTION_EXEMPTIONS[ref];
        if (!known) {
            problems.push({
                code: "PARITY-06",
                message:
                    `action externe non listée : \`${ref}\` (« ${s.name || "(anonyme)"} »). Une ` +
                    `action n'est PAS une exemption automatique : si celle-ci porte une gate ` +
                    `réelle, elle vient de disparaître du champ sans un mot.`,
            });
        }
        actions.push({ ref, sha: sha || "", step: s.name || "(anonyme)", ...(known || {}) });

        // PARITY-10 — une promesse d'équivalent local doit être TENUE. L'énonciation dit
        // « → npm run gitleaks:local » ; si cette gate quittait STEPS, la phrase continuerait
        // de s'afficher en désignant une couverture qui n'existe plus. Une affirmation
        // affichée sur parole est exactement ce que les témoins d'EXEMPTIONS interdisent
        // ailleurs dans ce fichier, et il n'y a pas de raison qu'elle soit tolérée ici.
        if (known && known.localLeaf && !localLeaves.has(known.localLeaf)) {
            problems.push({
                code: "PARITY-10",
                message:
                    `ACTION_EXEMPTIONS[« ${ref} »] promet l'équivalent local ` +
                    `« ${known.localEquivalent} », mais la feuille « ${known.localLeaf} » n'est ` +
                    `atteinte par AUCUNE entrée de STEPS. L'énonciation annoncerait une ` +
                    `couverture qui n'existe pas.`,
            });
        }
    }
    for (const key of Object.keys(ACTION_EXEMPTIONS)) {
        if (!seenActions.has(key)) {
            problems.push({
                code: "PARITY-04",
                message: `ACTION_EXEMPTIONS[« ${key} »] — PÉRIMÉE : plus aucune étape n'utilise cette action.`,
            });
        }
    }

    // PARITY-09 — un `env:` d'étape rend les feuilles identiques et les exécutions
    // différentes. La gate ne peut pas comparer les environnements ; elle peut exiger qu'un
    // nouvel `env:` soit une décision, pas un glissement.
    for (const s of ciSteps) {
        if (s.hasEnv && !ENV_ALLOWLIST.has(s.name)) {
            problems.push({
                code: "PARITY-09",
                message:
                    `« ${s.name || "(anonyme)"} » porte un \`env:\` non recensé. Deux exécutions ` +
                    `aux feuilles identiques peuvent différer par leur environnement, et cette ` +
                    `gate ne le voit pas — donc un nouvel env: doit être décidé, pas glissé.`,
            });
        }
    }

    // Ce que la CI exécutera et qui n'a pas tourné ici. Les ACTIONS en font partie — gitleaks
    // est la gate distante la plus importante du lot, et la filtrer avec les `run:` l'aurait
    // laissée hors de l'énonciation, c'est-à-dire hors de vue précisément là où elle compte.
    // Dédoublonné par LIBELLÉ : une étape qui porte deux feuilles distantes (l'étape E2E en
    // porte deux) est une seule chose à dire, pas deux.
    const remoteOnly = [];
    const seenLabel = new Set();
    const push = (label, kind, motif, localEquivalent) => {
        if (seenLabel.has(label)) return;
        seenLabel.add(label);
        remoteOnly.push({ label, kind, motif, localEquivalent });
    };
    for (const e of entries) {
        if (e.category === "COVERED" || e.category === "UNRESOLVED") continue;
        if (e.gateReelle === false) continue;
        push(
            e.steps[0] || e.leaf,
            e.category === "E2E" ? "sous --e2e" : e.classe || "non couverte",
            e.motif
        );
    }
    for (const a of actions) {
        if (a.gateReelle === false) continue;
        push(a.step, a.partialMotif || "action externe", a.motif, a.localEquivalent);
    }
    return { corpus, entries, problems, actions, remoteOnly };
}

/**
 * Les lignes de l'énonciation de fin de run de `ci:local`.
 *
 * NARRATION, jamais VERDICT — le verdict appartient à la gate `verify-ci-parity.cjs`. Deux
 * chemins qui peuvent faire échouer la même propriété, c'est un chemin de trop, et c'est
 * celui qu'on oublie de prouver.
 *
 * Dérivée de `ci.yml` + des tables, et NON de la liste des gates qui viennent de tourner :
 * elle reste donc vraie sous `--bail`, où la gate de parité n'a peut-être jamais tourné —
 * précisément le run où cette ligne compte le plus.
 *
 * @param {{withE2E?: boolean}} [options] `withE2E` retire les gates que `--e2e` a couvertes.
 * @returns {string[]} Lignes prêtes à imprimer (vide s'il n'y a rien à dire).
 */
function formatRemoteOnly(options = {}) {
    const withE2E = options.withE2E === true;
    const { remoteOnly } = classify();
    const shown = remoteOnly.filter((e) => !(withE2E && e.kind === "sous --e2e"));
    if (!shown.length) return [];

    const C = { y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
    const width = Math.max(...shown.map((e) => e.label.length));
    // « pas ENTIÈREMENT couverte » et non « n'a pas tourné » : gitleaks a bien un équivalent
    // local pour son chemin `push`. Sur-avertir use un avertissement aussi sûrement que le
    // taire, et celui-ci doit rester lu.
    const out = [
        `  ${C.y}⚠ ${shown.length} gate(s) de la CI que ce run ne couvre pas entièrement :${C.x}`,
    ];
    for (const e of shown) {
        // Un équivalent local est nommé sur place : dire « non couverte » sans dire par quoi
        // la couvrir laisse le lecteur devant un constat, pas devant un geste.
        const hint = e.localEquivalent ? ` ${C.d}→ ${e.localEquivalent}${C.x}` : "";
        out.push(`      ${C.d}•${C.x} ${e.label.padEnd(width)}  ${C.d}${e.kind}${C.x}${hint}`);
    }
    const deferred = shown.filter((e) => e.kind === "sous --e2e").length;
    if (deferred > 0) {
        out.push(
            `    ${C.d}\`--e2e\` en couvrirait ${deferred} sur ${shown.length} ; ` +
                `le reste n'est vu qu'à distance.${C.x}`
        );
    }
    return out;
}

module.exports = {
    ROOT,
    FLOOR,
    workflowDir,
    parseWorkflow,
    parseSteps,
    rawCounts,
    normalize,
    splitChain,
    resolveLeaves,
    leavesOfSteps,
    EXEMPTIONS,
    ACTION_EXEMPTIONS,
    DEFERRED_TO_E2E,
    classify,
    formatRemoteOnly,
};
