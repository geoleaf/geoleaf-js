#!/usr/bin/env node
/**
 * verify-ci-scripts-tracked.cjs — tout script que `ci:local` invoque est suivi par git.
 *
 * ## L'angle mort SYMÉTRIQUE de celui que T3.5 a fermé
 *
 * `verify-repo-hygiene.cjs` empêche un script NON DÉCLARÉ d'entrer : tout `.cjs`/`.mjs`
 * de `scripts/` absent de `SCRIPTS_ALLOWLIST` fait rougir le check 1. Il ne dit rien du
 * cas inverse — un script DÉCLARÉ et INVOQUÉ mais **non tracé** passe les deux checks
 * sans un mot : un fichier absent de l'index est simplement ignoré du corpus, et une
 * entrée d'allowlist sans fichier n'est pas une erreur.
 *
 * Ce n'est pas une hypothèse. `check-subpath-resolve.cjs` a vécu exactement cet état :
 * câblé dans `ci:local`, déclaré, présent sur le disque du seul poste qui l'avait écrit,
 * et **absent de l'index**. Sur un clone frais, `ci:local` échouait au lancement — sur le
 * poste d'origine, il était vert. C'est le pire profil de panne du dépôt : celui qui ne se
 * manifeste que chez quelqu'un d'autre. (Découvert au T2, item 5.6 de la roadmap.)
 *
 * ## Ce que la gate lit, et pourquoi pas autrement
 *
 * Elle **importe** `ci-local.cjs` (qui exporte ses tables depuis le T5.8) et suit les
 * invocations de façon transitive :
 *
 *   STEPS / E2E_STEPS  ─┬─→  `node scripts/<x>`         ── directement
 *                       └─→  `npm run <x>` ─→ package.json#scripts ─→ `scripts/<y>` …
 *                                            (les chaînages `npm run` sont suivis aussi)
 *
 * puis, depuis chaque script atteint, la clôture de ses `require`/`import` RELATIFS vers
 * `scripts/` — c'est là que vivait l'incident `knip-hints-reporter.mjs` du T3.7 : un
 * module créé, câblé et documenté le jour même, mais dans aucun registre d'hygiène.
 *
 * ⚠️ Elle **n'analyse pas** `ci-local.cjs` à la regex. Un parseur textuel qui cesse de
 * matcher après un refactor de la table ne rougit pas : il trouve zéro script, les déclare
 * tous suivis et sort vert. C'est la classe de défaut que T3, T4 et T6 documentent chacun
 * à leur tour — une gate n'a pas besoin de disparaître pour être aveugle, il suffit que
 * son périmètre soit vide.
 *
 * ## Le témoin à réponse connue
 *
 * Un `require` ne peut pas rendre une table vide en silence, mais la RÉSOLUTION, elle, le
 * peut : un `npm run` renommé, un `package.json#scripts` restructuré, et le graphe se
 * réduit sans erreur. D'où le plancher (`MIN_RESOLVED`) — même patron que
 * `audit-report-freshness.cjs` (« ≥ 400 fichiers sous core/src ») et
 * `verify-coverage-attribution.cjs`. Sous le plancher, la gate REFUSE de conclure.
 *
 * ⚠️ Elle se prouve depuis l'arbre de travail, PAS sur un clone frais : elle interroge
 * l'INDEX (`git ls-files`), donc elle voit le défaut avant le push plutôt qu'après. C'est
 * précisément ce qui la rend utile — un contrôle qui exige un clone frais ne serait jamais
 * lancé au bon moment.
 *
 * Usage : node scripts/verify-ci-scripts-tracked.cjs [--verbose]
 * Exit 0 = tout script invoqué est tracé, 1 sinon.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

// T6.7a — résolution des `npm run <x> -w <paquet>` : le registre, jamais un chemin en dur.
const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const VERBOSE = process.argv.includes("--verbose");

/**
 * Plancher du témoin.
 *
 * Mesure du 25/07/2026 : 42 scripts atteints depuis `ci:local` sans `--e2e`, 45 avec.
 * Le plancher est délibérément SOUS la mesure — il n'est pas un cliquet de couverture,
 * il détecte l'effondrement du graphe de résolution. Le relever à la mesure exacte le
 * ferait rougir au premier gate retiré à bon escient (T6.3 retire `benchmark --ci`).
 */
const MIN_RESOLVED = 30;

const C = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

// ── Résolution ───────────────────────────────────────────────────────────────

const SCRIPT_RE = /(?:^|[\s"'=])(scripts\/[\w./-]+\.(?:cjs|mjs))/g;
const NPM_RUN_RE = /npm run ([\w:.-]+)/g;
/** `-w <spec>` / `--workspace <spec>` / `--workspace=<spec>` — le script vit alors dans CE paquet. */
const WORKSPACE_RE = /(?:-w|--workspace)[= ]([@\w./-]+)/;

/** Les scripts nommés directement dans une ligne de commande npm. */
function scriptsInCommand(cmd) {
    return [...cmd.matchAll(SCRIPT_RE)].map((m) => m[1]);
}

/**
 * Specifiers de module RÉELS d'un fichier — par l'AST, jamais par regex sur le texte.
 *
 * ⚠️ La première version de cette fonction lisait la source à la regex. Mesuré à la pose :
 * **6 faux positifs sur 7 signalements**, tous de la même famille — du code cité qui n'est
 * pas du code exécuté :
 *
 *   • `packages.cjs` documente `require("./lib/packages.cjs")` dans son propre en-tête
 *     → résolu en `scripts/lib/lib/packages.cjs` ;
 *   • `check-dynamic-key-writes.cjs` porte `const GUARD_MODULE = "object-path-guard.js"`
 *     → une donnée, pas un import ;
 *   • `probe-gate-visibility.cjs` embarque `await import("./eslint.config.mjs")` dans un
 *     TEMPLATE LITERAL exécuté par un processus fils, avec un autre `cwd`.
 *
 * Une gate qui crie sur du commentaire se fait désarmer en une semaine. L'AST ne voit que
 * les vrais nœuds d'import ; `typescript` est déjà la dépendance de 3 autres gates
 * (`check-facade-purity`, `check-orphan-exports`, `check-contracts-pure`).
 */
function moduleSpecifiers(absPath, text) {
    const ts = require("typescript");
    const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const out = [];

    const visit = (node) => {
        // `import x from "…"` / `export … from "…"`
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            out.push(node.moduleSpecifier.text);
        }
        // `require("…")` et `import("…")` — un seul argument, littéral de chaîne.
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const isRequire = ts.isIdentifier(callee) && callee.text === "require";
            const isDynImport = callee.kind === ts.SyntaxKind.ImportKeyword;
            const [arg] = node.arguments;
            if ((isRequire || isDynImport) && arg && ts.isStringLiteral(arg)) out.push(arg.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

/**
 * Clôture des `require`/`import` RELATIFS d'un script vers `scripts/`.
 *
 * Seuls les specifiers relatifs sont suivis : un `require("typescript")` est une
 * dépendance npm, pas un fichier du dépôt. L'extension est obligatoire dans ce dépôt
 * (CJS explicite, ESM strict), donc aucune résolution d'index à deviner.
 */
function localRequires(relPath, seen) {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) return [];
    const out = [];
    for (const spec of moduleSpecifiers(abs, fs.readFileSync(abs, "utf8"))) {
        if (!spec.startsWith(".")) continue;
        const resolved = path.posix.join(path.posix.dirname(relPath), spec);
        if (resolved.startsWith("scripts/") && !seen.has(resolved)) out.push(resolved);
    }
    return out;
}

/** Résout la table d'étapes en l'ensemble des scripts du dépôt qu'elle finit par exécuter. */
function resolveInvokedScripts() {
    const { STEPS, E2E_STEPS } = require("./ci-local.cjs");
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const npmScripts = pkg.scripts || {};

    const found = new Set();
    const visitedNpm = new Set();
    const origin = new Map(); // script → comment on y est arrivé (pour le rapport)
    const dangling = []; // `npm run <x>` qui ne résout nulle part — check 2

    const note = (script, from) => {
        if (!origin.has(script)) origin.set(script, from);
        found.add(script);
    };

    /**
     * Corps d'un `npm run <name>`, résolu dans le BON package.json.
     *
     * `-w <spec>` déplace la résolution vers le paquet nommé : `npm run test:bundle
     * -w @geoleaf/core` ne cherche PAS dans la racine. Sans ce cas, le check 2
     * ci-dessous crierait au loup sur une étape parfaitement valide de `ci:local`.
     */
    const bodyOf = (name, hostCmd) => {
        const ws = hostCmd && hostCmd.match(WORKSPACE_RE);
        if (!ws) return npmScripts[name];
        const entry = registry.byName(ws[1]);
        if (!entry) return undefined; // paquet inconnu — `check-versions` couvre ce cas
        const wsPkg = JSON.parse(fs.readFileSync(path.join(entry.absDir, "package.json"), "utf8"));
        return (wsPkg.scripts || {})[name];
    };

    const walkNpm = (name, from, hostCmd) => {
        const key = `${name} ${(hostCmd.match(WORKSPACE_RE) || [, ""])[1]}`;
        if (visitedNpm.has(key)) return;
        visitedNpm.add(key);
        const cmd = bodyOf(name, hostCmd);
        if (cmd === undefined) {
            // T6.7a — c'était un `return` muet, sous le commentaire « affaire de
            // check-versions ». Vérifié : check-versions ne regarde QUE les versions et
            // les dépendances inter-paquets, il ne lit aucun `scripts`. Cette délégation
            // n'existait pas. Conséquence mesurée : renommer un script npm sans suivre
            // son appelant dans ci-local.cjs faisait sortir CE gate VERT, en résolvant
            // simplement un script de moins (54 → 53, « 53/53 suivis »).
            dangling.push({ name, from });
            return;
        }
        for (const s of scriptsInCommand(cmd)) note(s, `${from} → npm run ${name}`);
        for (const m of cmd.matchAll(NPM_RUN_RE)) walkNpm(m[1], `${from} → npm run ${name}`, cmd);
    };

    for (const step of [...STEPS, ...E2E_STEPS]) {
        const cmd = step.run.join(" ");
        for (const s of scriptsInCommand(cmd)) note(s, `ci:local « ${step.name} »`);
        for (const m of cmd.matchAll(NPM_RUN_RE)) walkNpm(m[1], `ci:local « ${step.name} »`, cmd);
    }

    // Clôture des requires locaux — parcours en largeur jusqu'à saturation.
    const queue = [...found];
    while (queue.length) {
        const current = queue.shift();
        for (const dep of localRequires(current, found)) {
            note(dep, `requis par ${current}`);
            queue.push(dep);
        }
    }

    return { scripts: [...found].sort(), origin, dangling };
}

// ── Contrôle ─────────────────────────────────────────────────────────────────

function trackedScripts() {
    const out = execSync("git ls-files scripts/", { cwd: ROOT, encoding: "utf8" });
    return new Set(out.split("\n").filter(Boolean));
}

const { scripts, origin, dangling } = resolveInvokedScripts();
const tracked = trackedScripts();

console.log(`${C.cyan}── CI-SCRIPTS-TRACKED ──${C.reset}`);
console.log(
    `  ${scripts.length} script(s) atteignable(s) depuis ci:local (directs + npm run + requires locaux)`
);

if (VERBOSE) {
    for (const s of scripts) console.log(`    ${C.dim}${s}  ←  ${origin.get(s)}${C.reset}`);
}

const errors = [];

// ── Check 1 — le témoin ──────────────────────────────────────────────────────
// Il passe AVANT le contrôle de traçage, délibérément : sur un graphe effondré, « 0 script
// non tracé » est vrai et ne veut rien dire. Refuser de conclure vaut mieux que conclure
// juste par accident.
if (scripts.length < MIN_RESOLVED) {
    errors.push(
        `témoin en échec — ${scripts.length} scripts résolus (plancher ${MIN_RESOLVED}).\n` +
            `    La table de ci-local.cjs ou les scripts npm ont changé de forme et la\n` +
            `    résolution ne suit plus. Un « 0 non tracé » depuis ce corpus serait faux.`
    );
}

// ── Check 2 — aucun `npm run` pendant ────────────────────────────────────────
// Un `npm run <x>` que rien ne définit ne fait pas rougir ce gate par lui-même : il
// résout simplement un script de moins, et le rapport annonce « N/N suivis ». Le
// plancher du check 1 ne le voit pas non plus (il détecte un effondrement, pas une
// unité). C'est exactement ce qui rendait un renommage de script npm indétectable —
// la panne n'apparaissait qu'à l'exécution de l'étape, donc pour les étapes `--e2e`
// seulement quand on passe `--e2e`.
for (const d of dangling) {
    errors.push(
        `npm run ${d.name} — AUCUNE définition (ni racine, ni workspace ciblé par -w).\n` +
            `    Origine : ${d.from}\n` +
            `    ci:local échouera à cette étape avec « Missing script ».`
    );
}

// ── Check 3 — la propriété ───────────────────────────────────────────────────
const untracked = scripts.filter((s) => !tracked.has(s));
for (const s of untracked) {
    const onDisk = fs.existsSync(path.join(ROOT, s));
    errors.push(
        `${s} — invoqué mais NON SUIVI par git (${onDisk ? "présent sur ce disque" : "absent du disque"}).\n` +
            `    Origine : ${origin.get(s)}\n` +
            `    ${onDisk ? "Sur un clone frais, ci:local échouerait ici." : "ci:local échoue déjà."}`
    );
}

// ── Rapport ──────────────────────────────────────────────────────────────────
if (errors.length) {
    console.error(`\n${C.red}✗ CI-SCRIPTS-TRACKED — ${errors.length} problème(s)${C.reset}\n`);
    for (const e of errors) console.error(`  ${C.red}•${C.reset} ${e}\n`);
    process.exit(1);
}

console.log(
    `${C.green}✓${C.reset}  ${scripts.length}/${scripts.length} suivis par git — ci:local démarre sur un clone frais.`
);
process.exit(0);
