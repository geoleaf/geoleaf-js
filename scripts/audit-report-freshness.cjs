#!/usr/bin/env node
/*!
 * GeoLeaf — Fraîcheur des rapports de `_docs_projet/travail/rapports/` (atelier)
 * © 2026 Mattieu Pottier — MIT
 *
 * Répond, pour chaque item d'un rapport, à la seule question qui décide de son
 * archivage : **ce que le document affirme est-il encore vrai sur HEAD ?**
 *
 * ## Pourquoi un script et pas un grep
 *
 * Le corpus fait ~1 200 items sourcés (349 dans les 2 annexes JSON du triage S4,
 * 86 anomalies de config, 219 fichiers de capacités, ~130 réfs `fichier:ligne`
 * éparses). À la main, la vérification dériverait vers l'échantillon — et
 * l'échantillon est précisément ce qui a produit les faux ✅ que ce dépôt a déjà
 * payés (`rapport_backlog-code-mort-core.md` v3.0.0 : 5 consignes actives fausses,
 * dont un « ⛔ NE PAS PURGER » sur un module dissous).
 *
 * ## Les trois questions, et l'ordre dans lequel elles se posent
 *
 *   1. le chemin existe-t-il encore ?
 *   2. sinon, le fichier a-t-il simplement DÉMÉNAGÉ (même basename ailleurs) ?
 *   3. le symbole est-il encore déclaré, et a-t-il un consommateur réel ?
 *
 * ⚠️ **La question 2 est la raison d'être de ce script.** Sans elle, un chemin
 * absent se lit « purgé », et c'est faux deux fois dans ce dépôt : ARCHI S10.1 a
 * déplacé `packages/plugin-X/` → `packages/plugins/X/`, et le kernel a déplacé
 * `app/modules/` → `app/boot-modules/`. Un audit qui conclut « purgé » sur un
 * fichier déménagé produit un rapport vert en n'ayant rien vérifié — exactement la
 * classe d'erreur que `probe-gate-visibility.cjs` surveille sur les gates.
 *
 * ## Ce que ce script N'EST PAS — et l'exception, depuis le 31/07/2026
 *
 * Pour les sources `s4-triage`, `s4-low`, `refs` et `files` : ce n'est pas une gate, elles
 * ne sont pas câblées dans `ci:local`, et elles ne doivent pas l'être — elles mesurent la
 * fraîcheur de DOCUMENTS d'atelier, pas la santé du code livré. Pas d'exit code de
 * régression : 0 si la mesure a pu se faire, 2 sinon (corpus vide, source illisible).
 *
 * ⚠️ **`--source tsdoc --gate` fait exception, et la distinction n'est pas cosmétique** :
 * cette source-là lit la prose des TSDoc **des sources**, c'est-à-dire du code publié sur
 * npm — pas un rapport d'atelier. Elle est câblée dans `ci:local` sous le nom TSDOC-PATHS,
 * avec sa propre baseline décroissante (`audit-tsdoc-paths.baseline.json`) et deux axes
 * d'échec. Le drapeau est **refusé** sur toute autre source plutôt qu'ignoré : `--gate
 * --source refs` sortirait 0, c'est-à-dire « vert », en n'ayant rien gardé.
 *
 * Limite assumée, héritée de `check-orphan-exports.cjs` : recherche par token,
 * pas résolution de binding TypeScript. Un nom générique redéclaré ailleurs peut
 * produire un faux « vivant ». Le biais est délibéré et va vers la PRUDENCE — on
 * préfère garder un rapport de trop qu'archiver un backlog encore ouvert.
 *
 * ## Limites de l'extraction de chemins
 *
 * `sourceRefs()` extrait les chemins par une **alternance d'extensions**
 * (`tsx|mjs|cjs|json|html|css|ts|js`). Deux classes lui échappent donc par
 * construction, et l'en-tête de cette fonction a annoncé « toutes les réfs »
 * jusqu'au 29/07/2026 :
 *
 *   - **les `.md`** — `md` n'est pas dans l'alternance. Aucun commentaire du script
 *     ne motive cette absence ; elle est constatée, pas justifiée ici.
 *   - **les répertoires** (`docs/specs/rfc/`) — ils n'ont pas d'extension.
 *
 * En face, `check-dead-links.cjs` ne lit **que les liens markdown**. La classe non
 * couverte est donc étroite et nommable : **un chemin en code inline visant un `.md`
 * ou un répertoire**. Elle a déjà coûté un défaut — `roadmap_socle-init.md` citait
 * `_docs_projet/rfc/` au lieu de `specs/rfc/`, corrigé le 29/07/2026.
 *
 * ⚠️ **Élargir l'alternance à `md` n'est PAS le correctif, et c'est mesuré.** Sur
 * `roadmap_documentation-v3.md`, une sonde de cette classe rend 10 chemins non
 * résolus dont **8 sont l'usage exact** : ils nomment le chemin *parce qu'il est
 * mort* (table de décisions « supprimé » / « régénéré », énoncés faux cités comme
 * corrigés, `grep` mené SUR le répertoire disparu). **Précision 2/10** — une garde
 * dessus crierait au loup 8 fois sur 10, et la première correction automatique
 * effacerait un registre. Le geste juste est de LIRE : ce script borne où regarder,
 * il ne rend pas de verdict (cf. §Ce que ce script N'EST PAS). Doctrine complète et
 * les 10 verdicts : `roadmap_documentation-v3.md` §Règles d'exécution, règle 6.
 *
 * Usage :
 *   node scripts/audit-report-freshness.cjs --source s4-triage
 *   node scripts/audit-report-freshness.cjs --source s4-low
 *   node scripts/audit-report-freshness.cjs --source refs --doc <chemin.md>
 *   node scripts/audit-report-freshness.cjs --source files --doc <chemin.md>
 *   node scripts/audit-report-freshness.cjs --source tsdoc [--gate] [--update-baseline]
 *   node scripts/audit-report-freshness.cjs --source specs [--gate] [--update-baseline]
 *   [--out <chemin.json>] [--quiet]
 *
 * ⚠️ **`--source specs` est la seule qui ne dépend PAS de la racine interne** : son corpus est
 * `docs/specs/`, public. Le saut de tête l'épargne explicitement — sans quoi la gate qui garde
 * les 45 fiches sortirait 0 dans le dépôt public, le seul endroit où elles comptent.
 *
 * Exit codes — **ils diffèrent selon le mode**, et c'est le seul endroit où c'est vrai :
 *   · mesure (défaut)  : 0 mesuré · 2 impossible de mesurer. Jamais 1.
 *   · `--gate`         : 0 vert · 1 régression (TSDOC-PATHS-01/02) · 2 impossible de mesurer.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");
const ROOT = registry.ROOT;

// ⚠️ SAUT NOMMÉ — le corpus de cette gate est l'atelier, et le dépôt public ne le porte pas.
//
// `_docs_projet/` est retiré du dépôt public par décision (tâche 9.4 du passage public), pas
// par accident. Jeter ici n'apprendrait rien : ce n'est pas une racine perdue, c'est une
// racine que ce dépôt-là n'a jamais eue. Mesuré le 10/08/2026 — sans ce saut, cette gate et
// `check-config-consumers` sont les DEUX seules de `ci:local` qui ne peuvent pas passer sur
// le clone public, quoi qu'on y écrive.
//
// 🛑 Le saut est BRUYANT et il refuse de se lire comme un vert — patron
// `CONSUMER-CONTRACT/CC-00`. Une gate qui se tait en sortant 0 est le mode d'échec que ce
// dépôt traque ; celle-ci dit ce qu'elle n'a pas lu, et pourquoi.
//
// 🛑 **ET IL EST SOURCE-DÉPENDANT depuis le 11/08/2026 — sans quoi il aurait rendu
// SPECS-PATHS verte et aveugle exactement dans le dépôt qu'elle protège.** `--source specs`
// lit `docs/specs/`, qui est PUBLIC : il n'a besoin ni de `_docs_projet/`, ni des rapports
// d'atelier. Un saut inconditionnel aurait fait sortir 0 la seule gate qui garde les 45 fiches,
// sur le seul clone où elles comptent. Le saut ne vaut donc que pour les sources qui LISENT
// réellement l'atelier ; `tsdoc` et `specs` n'en sont pas, mais `tsdoc` le garde parce que son
// corpus dépend de `REPORTS_DIR` par `buildCorpus`/`probeItem` — c'est mesuré, pas supposé.
// `arg()` est une déclaration de fonction, donc hissée : l'appeler ici est licite.
const NEEDS_INTERNAL_ROOT = !["specs", "guides"].includes(arg("source"));
if (NEEDS_INTERNAL_ROOT && !docsPaths.internalRootExists()) {
    console.log(
        "⏭️  [TSDOC-PATHS] SAUTÉ — la racine INTERNE est absente : " +
            docsPaths.rel(docsPaths.INTERNAL_ROOT)
    );
    console.log(
        "    Ce n'est pas un vert : aucun rapport d'atelier n'a été relu, donc aucun chemin\n" +
            "    cité par une prose de TSDoc n'a été confronté. Sur le dépôt public c'est le\n" +
            "    comportement attendu — `_docs_projet/` y est retiré par décision. Ailleurs,\n" +
            "    c'est un défaut : corriger le chemin, ou poser GEOLEAF_INTERNAL_DOCS_ROOT.\n" +
            "    ⚠️ `--source specs` ne passe PAS par ici : son corpus est `docs/specs/`, public."
    );
    process.exit(0);
}

/**
 * Racine INTERNE des rapports d'atelier — **résolue à l'appel, pas au chargement**.
 *
 * `docsPaths.internal()` JETTE quand la racine est absente. En constante de module, elle
 * rendait le fichier inchargeable sur le dépôt public, ce qui obligeait le saut ci-dessus à
 * être inconditionnel. Paresseuse, elle laisse `--source specs` se charger et mesurer.
 *
 * @returns {string} chemin absolu de `_docs_projet/travail/rapports`.
 */
function reportsDir() {
    return docsPaths.internal("travail", "rapports");
}

// `.vitepress` est de l'outillage de documentation, pas du code livré : y trouver
// un `index.ts` n'apprend rien sur la survie d'un baril du core.
const EXCLUDED_DIRS = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".turbo",
    "docs-dist",
    ".vitepress",
]);
const TEST_DIRS = new Set(["__tests__", "__mocks__", "test-utils", "e2e"]);
const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const SOURCE_EXTS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".json"];

// ─── CLI ──────────────────────────────────────────────────────────────────────

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const QUIET = process.argv.includes("--quiet");

// `--gate` n'a de sens qu'avec `--source tsdoc` : c'est la seule source qui mesure le CODE
// (la prose des TSDoc des sources) et non la fraîcheur d'un document d'atelier. Les autres
// restent des instruments de mesure, sans code de sortie de régression — voir l'en-tête,
// §Ce que ce script N'EST PAS, qui reste vrai pour elles.
const GATE = process.argv.includes("--gate");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

function die(msg) {
    process.stderr.write(`audit-report-freshness: ${msg}\n`);
    process.exit(2);
}

/** Chemin relatif normalisé en `/` — `path.relative` rend `\` sous Windows. */
function normPath(p) {
    return p.split(path.sep).join("/");
}

// ─── Corpus ───────────────────────────────────────────────────────────────────

function collectFiles(dir, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) collectFiles(full, acc);
        else if (e.isFile() && SOURCE_EXTS.some((ext) => e.name.endsWith(ext))) acc.push(full);
    }
    return acc;
}

/**
 * Le corpus vient du REGISTRE des workspaces, jamais d'un `packages/<nom>` en dur.
 * Un chemin en dur ne casse pas au déplacement : il cesse silencieusement de
 * matcher, et l'audit sort vert en n'ayant rien scanné (CLAUDE.md §Arborescence).
 * Un registre en échec doit donc PROPAGER, pas retomber sur un corpus vide.
 */
function buildCorpus() {
    const acc = [];
    for (const pkg of registry.all()) collectFiles(pkg.absDir, acc);
    for (const extra of ["examples", "profiles", "scripts", "e2e", "apps"]) {
        collectFiles(path.join(ROOT, extra), acc);
    }
    if (acc.length === 0) {
        die(
            "corpus vide — refus de conclure « purgé » depuis un corpus qui n'a pas pu être construit."
        );
    }

    const byBasename = new Map();
    const entries = [];
    for (const abs of acc) {
        const rel = normPath(path.relative(ROOT, abs));
        const isTest =
            rel.split("/").some((seg) => TEST_DIRS.has(seg)) || /\.(test|spec)\./.test(rel);
        const base = path.basename(abs);
        if (!byBasename.has(base)) byBasename.set(base, []);
        byBasename.get(base).push(rel);
        entries.push({ abs, rel, isTest });
    }

    // ── Témoin à réponse connue ──────────────────────────────────────────────
    // Un audit de fraîcheur qui conclut « purgé » depuis un corpus amputé est pire
    // qu'un audit non fait : il est faux ET il a l'air complet. Le corpus doit donc
    // voir le cœur du dépôt AVANT qu'on lui pose la moindre question. Même esprit
    // que `verify-coverage-attribution.cjs` (CLAUDE.md §Tests).
    // T5.5 — le préfixe vient du registre, qui jette. Un témoin dont le chemin de
    // référence est écrit à la main peut échouer POUR LA MAUVAISE RAISON : le corpus
    // serait intact et le témoin rouge, ce qui apprend le contraire de ce qu'il mesure.
    const coreSrcPrefix = `${registry.requireByDirName("core").dir}/src/`;
    const coreSrc = entries.filter((e) => e.rel.startsWith(coreSrcPrefix)).length;
    if (coreSrc < 400) {
        die(
            `témoin en échec — ${coreSrc} fichiers vus sous ${coreSrcPrefix} (attendu ≥ 400). ` +
                `Le corpus est amputé : refus de conclure quoi que ce soit sur la survie d'un symbole.`
        );
    }
    return { entries, byBasename, coreSrc };
}

let _tokenCache = null;
/** Tokenise le corpus une seule fois — 3 500+ fichiers, relus par item sinon. */
function tokenize(corpus) {
    if (_tokenCache) return _tokenCache;
    _tokenCache = [];
    for (const e of corpus.entries) {
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(e.rel)) continue;
        let raw;
        try {
            raw = fs.readFileSync(e.abs, "utf8");
        } catch {
            continue;
        }
        // Retirer les commentaires : sans ça un symbole seulement CITÉ en JSDoc
        // passe pour vivant. C'est le piège « référencé ≠ vivant ».
        const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        _tokenCache.push({
            rel: e.rel,
            isTest: e.isTest,
            tokens: new Set(stripped.match(IDENTIFIER_RE) || []),
        });
    }
    return _tokenCache;
}

// ─── Les trois questions ──────────────────────────────────────────────────────

/**
 * Basenames qu'on ne peut PAS suivre par leur nom.
 *
 * `index.ts` existe des dizaines de fois dans ce dépôt. Le suivre par basename a
 * fait passer trois barils **supprimés** (`layer-manager/index.ts`,
 * `utils/general/index.ts`, `filter/panel/index.ts`, purgés au S4) pour des fichiers
 * « déménagés vers `docs/.vitepress/theme/index.ts` » — et l'audit posait alors ses
 * questions au mauvais fichier. Un fichier qu'on ne sait pas suivre doit être
 * déclaré absent, pas rattaché à un homonyme.
 */
const UNTRACKABLE_BASENAMES = new Set([
    "index.ts",
    "index.js",
    "types.ts",
    "constants.ts",
    "utils.ts",
    "helpers.ts",
    "config.ts",
    "install.ts",
    "lifecycle.ts",
    "public-api.ts",
]);

/**
 * Q1/Q2 — le chemin existe, est cité en RACCOURCI, a déménagé, ou a disparu.
 *
 * ⚠️ L'étape « raccourci » n'est pas un confort. Les rapports citent massivement des
 * fragments relatifs — `capabilities/route/apply.ts` pour
 * `packages/core/src/capabilities/route/apply.ts`. Résolus depuis la racine seule,
 * **51 fichiers parfaitement vivants** ressortaient « introuvables » dans le seul
 * rapport de code mort. Conclure « le document cite des chemins morts » sur cette
 * base aurait été un faux constat à l'appui d'un archivage.
 */
function locateFile(relPath, corpus) {
    if (!relPath) return { state: "no-path" };
    const clean = normPath(relPath).replace(/^\.\//, "");
    if (fs.existsSync(path.join(ROOT, clean))) return { state: "present", at: clean };

    // Raccourci : un seul fichier du corpus dont le chemin se termine par ce fragment.
    if (clean.includes("/")) {
        const suffix = "/" + clean;
        const hits = corpus.entries.filter((e) => e.rel.endsWith(suffix)).map((e) => e.rel);
        if (hits.length === 1) return { state: "present", at: hits[0], viaSuffix: true };
        if (hits.length > 1) return { state: "present", at: hits[0], viaSuffix: true, all: hits };
    }

    const base = path.basename(clean);
    if (UNTRACKABLE_BASENAMES.has(base)) return { state: "absent", ambiguous: true };

    const candidates = corpus.byBasename.get(base) || [];
    if (candidates.length === 1) return { state: "moved", at: candidates[0], all: candidates };
    if (candidates.length > 1) return { state: "absent", ambiguous: true, all: candidates };
    return { state: "absent" };
}

/** Q3a — le symbole est-il encore DÉCLARÉ dans ce fichier ? */
function isDeclaredIn(relFile, symbol) {
    const abs = path.join(ROOT, relFile);
    let text;
    try {
        text = fs.readFileSync(abs, "utf8");
    } catch {
        return false;
    }
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(relFile)) {
        return new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
    }
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
    let found = false;
    const visit = (node) => {
        if (found) return;
        if (
            (ts.isFunctionDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isInterfaceDeclaration(node) ||
                ts.isTypeAliasDeclaration(node) ||
                ts.isEnumDeclaration(node) ||
                ts.isMethodDeclaration(node) ||
                ts.isPropertyDeclaration(node) ||
                ts.isPropertyAssignment(node)) &&
            node.name &&
            ts.isIdentifier(node.name) &&
            node.name.text === symbol
        ) {
            found = true;
            return;
        }
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === symbol
        ) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

/**
 * Q3a-bis — le symbole est-il encore EXPORTÉ ?
 *
 * ⚠️ Distinction cardinale, et la seule qui rende le triage S4 lisible : son geste
 * `dead-purge` était le plus souvent « **dé-exporter** », pas « supprimer ». Un type
 * comme `AnyFn` reste déclaré et utilisé localement — c'est son `export` qui était
 * mort, pas lui. Mesurer la présence du symbole répondrait « toujours là » sur un
 * item parfaitement soldé, et rouvrirait 75 lignes qui n'ont jamais été ouvertes.
 *
 * Même extraction que `check-orphan-exports.cjs` (compilateur TS, statements de
 * module) — délibérément, pour que les deux ne puissent pas diverger sur ce qu'est
 * un export.
 */
function exportedNames(relFile) {
    const abs = path.join(ROOT, relFile);
    if (!/\.(ts|tsx)$/.test(relFile)) return null;
    let text;
    try {
        text = fs.readFileSync(abs, "utf8");
    } catch {
        return null;
    }
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
    const names = new Set();
    for (const stmt of sf.statements) {
        const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) || [] : [];
        if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
            if (
                (ts.isFunctionDeclaration(stmt) ||
                    ts.isClassDeclaration(stmt) ||
                    ts.isInterfaceDeclaration(stmt) ||
                    ts.isTypeAliasDeclaration(stmt) ||
                    ts.isEnumDeclaration(stmt)) &&
                stmt.name
            ) {
                names.add(stmt.name.text);
            } else if (ts.isVariableStatement(stmt)) {
                for (const d of stmt.declarationList.declarations) {
                    if (ts.isIdentifier(d.name)) names.add(d.name.text);
                }
            }
        }
        if (ts.isExportDeclaration(stmt) && stmt.exportClause) {
            if (ts.isNamedExports(stmt.exportClause)) {
                for (const s of stmt.exportClause.elements) names.add(s.name.text);
            } else if (ts.isNamespaceExport(stmt.exportClause)) {
                names.add(stmt.exportClause.name.text);
            }
        }
    }
    return names;
}

/**
 * Q3c — usages DANS son propre fichier, déclaration exclue.
 *
 * L'autre angle mort documenté par `check-orphan-exports.baseline.json` : un type
 * consommé uniquement par le module qui le déclare (`CirclePaint` en type de retour
 * de `toCirclePaint`, `LayerRegistryEntry` dans le `Map` de sa propre classe). Sans
 * ce compte, ils ressortent « plus aucun consommateur » — c'est-à-dire morts —
 * alors qu'ils sont la définition même du faux positif que le S4 avait écarté.
 */
function intraFileUses(relFile, symbol) {
    let text;
    try {
        text = fs.readFileSync(path.join(ROOT, relFile), "utf8");
    } catch {
        return 0;
    }
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hits = stripped.match(new RegExp(`\\b${esc}\\b`, "g")) || [];
    return Math.max(0, hits.length - 1); // la déclaration elle-même ne compte pas
}

/**
 * L'outillage d'audit n'est pas un consommateur — il est l'inverse.
 *
 * `check-orphan-exports.cjs` NOMME des symboles dans son `ALLOWLIST` précisément
 * pour déclarer qu'ils n'ont **aucun** consommateur et que c'est voulu. Les compter
 * comme consommateurs inverse le sens de la mesure : le gate qui certifie « cet
 * export est intentionnellement orphelin » ferait conclure « il est vivant ».
 */
const TOOLING_FILES = new Set([
    "scripts/check-orphan-exports.cjs",
    "scripts/audit-report-freshness.cjs",
]);

/**
 * L'`ALLOWLIST` de `check-orphan-exports.cjs` est le **registre des décisions déjà
 * prises** sur les exports sans consommateur : chaque entrée porte sa raison
 * (surface publique documentée, contrat de duck-typing, type nommé requis pour
 * l'émission des déclarations…). Un item de rapport qui y figure a donc été
 * **tranché après** l'écriture du rapport — il ne peut plus être « ouvert ».
 *
 * Cas d'école rencontré ici : le triage S4 classait `FetchHelperOptions` en
 * `dead-purge`, et l'allowlist explique que le dé-exporter **casserait la
 * déclaration de `GeoLeaf.Utils` (TS4023)`. C'est le verdict du rapport qui est
 * périmé, pas le code.
 */
let _allowlist = null;
function allowlistIndex() {
    if (_allowlist) return _allowlist;
    _allowlist = new Map();
    // ⚠️ Lecture TEXTUELLE, jamais `require()`. `check-orphan-exports.cjs` est une
    // gate : elle appelle `main()` au chargement et se termine par `process.exit()`.
    // La requérir ne l'importerait pas, elle l'EXÉCUTERAIT — et tuerait cet audit
    // au milieu de sa mesure, en affichant le rapport d'une tout autre gate.
    try {
        const src = fs.readFileSync(path.join(__dirname, "check-orphan-exports.cjs"), "utf8");
        const block = src.slice(src.indexOf("const ALLOWLIST = {"));
        const re = /"([^"]+\.ts)":\s*(\*?"?\*"?|\[[^\]]*\])/g;
        let m;
        while ((m = re.exec(block)) !== null) {
            const rel = m[1];
            const raw = m[2];
            _allowlist.set(
                rel,
                raw.includes("[") ? (raw.match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1)) : "*"
            );
        }
    } catch {
        /* absent : l'audit reste valide, il perd juste ce signal */
    }
    return _allowlist;
}

/** Le symbole est-il déclaré « orphelin intentionnel » par la gate ? */
function isAllowlisted(relFile, symbol) {
    const idx = allowlistIndex();
    const key = relFile.replace(/^packages\/core\/src\//, "");
    const entry = idx.get(key);
    if (!entry) return false;
    return entry === "*" || entry.includes(symbol);
}

/** Q3b — a-t-il un consommateur hors de son propre fichier ? prod et test séparés. */
function consumers(symbol, ownerRel, corpus) {
    let prod = 0;
    let test = 0;
    const sites = [];
    for (const e of tokenize(corpus)) {
        if (e.rel === ownerRel) continue;
        if (TOOLING_FILES.has(e.rel)) continue;
        if (!e.tokens.has(symbol)) continue;
        if (e.isTest) test++;
        else prod++;
        if (sites.length < 4) sites.push(e.rel);
    }
    return { prod, test, sites };
}

/**
 * Un token trop générique ne prouve rien. `destroy`, `init`, `render` matchent dans
 * des dizaines de fichiers sans aucun rapport avec le symbole visé — le triage S4
 * classait justement `BasemapSelector.destroy` en `uncertain`, et une mesure par
 * token répondrait « 71 consommateurs prod », ce qui est une non-réponse.
 */
const GENERIC_TOKENS = new Set([
    "init",
    "destroy",
    "render",
    "update",
    "reset",
    "start",
    "stop",
    "close",
    "open",
    "get",
    "set",
    "add",
    "remove",
    "clear",
    "load",
    "save",
    "show",
    "hide",
    "toggle",
    "config",
    "options",
    "state",
    "data",
    "value",
    "name",
    "type",
    "id",
    "apply",
]);

// ─── Verdicts ─────────────────────────────────────────────────────────────────

/**
 * Confronte ce que le rapport AFFIRME (`final`) à ce que HEAD montre.
 *
 * Les 11 classements des deux annexes, et l'attente de chacun :
 *
 *   dead-purge            → ABSENT. S'il survit : purge incomplète.
 *   false-positive-alive  → PRÉSENT et consommé. Absent : purgé au-delà du périmètre.
 *   public-api-breaking   → idem — API publique conservée sciemment.
 *   test-only-keep        → PRÉSENT, consommé UNIQUEMENT par des tests.
 *   keep-documented       → PRÉSENT — conservé et documenté comme tel.
 *   route-S5              → ABSENT — la capacité `route` a été dissoute au S5.
 *   closed-no-op          → l'item était DÉJÀ résolu au moment du triage (nature
 *                           `already-done`) : rien n'était à faire. Sa survivance
 *                           ne rouvre rien, mais son retour à la vie, si.
 *   fix-in-4.3            → un correctif a été appliqué pendant la tâche 4.3 —
 *                           le code doit donc être PRÉSENT (c'est un fix, pas une purge).
 *   consign-only          → ⚠️ LE CAS QUI DÉCIDE DE L'ARCHIVAGE. Consigné, jamais
 *                           traité. S'il est toujours là, c'est une ligne de backlog
 *                           OUVERTE, à extraire avant de geler le document.
 *   uncertain             → indécis au triage ; la disparition tranche, la survie non.
 */
const EXPECT_ABSENT = new Set(["dead-purge", "route-S5"]);
const EXPECT_PRESENT = new Set([
    "false-positive-alive",
    "public-api-breaking",
    "keep-documented",
    "fix-in-4.3",
]);

function judge(claim, obs) {
    if (obs.file === "no-path" && !obs.symbol) {
        return { verdict: "unverifiable", why: "l'item ne cite ni chemin ni symbole" };
    }
    if (obs.generic) {
        return {
            verdict: "unverifiable",
            why: "token trop générique — la mesure par nom ne décide rien",
        };
    }
    if (obs.allowlisted) {
        return {
            verdict: "closed",
            why: "tranché depuis par l'ALLOWLIST de check-orphan-exports (orphelin intentionnel, motif documenté)",
        };
    }
    const gone = obs.file === "absent" || (obs.file !== "no-path" && obs.declared === false);
    // Un symbole vit s'il est utilisé — par un autre fichier OU par le sien.
    const used = obs.prod > 0 || obs.test > 0 || obs.intra > 0;

    if (EXPECT_ABSENT.has(claim)) {
        if (gone) return { verdict: "closed", why: "supprimé comme annoncé" };
        // Le geste attendu était le plus souvent la dé-exportation, pas la suppression.
        if (obs.exported === false) {
            return {
                verdict: "closed",
                why: `dé-exporté comme annoncé (déclaration conservée, ${obs.intra} usage(s) local)`,
            };
        }
        return { verdict: "open", why: "annoncé purgé, TOUJOURS EXPORTÉ" };
    }
    if (EXPECT_PRESENT.has(claim)) {
        if (gone) return { verdict: "closed", why: "conservé à l'époque, retiré depuis" };
        if (used) {
            const where =
                obs.prod > 0
                    ? `${obs.prod} consommateur(s) prod`
                    : `${obs.intra} usage(s) intra-fichier`;
            return { verdict: "confirmed", why: `vivant — ${where}` };
        }
        return { verdict: "drift", why: "conservé mais AUCUN usage, ni externe ni local" };
    }
    switch (claim) {
        case "test-only-keep":
            if (gone) return { verdict: "closed", why: "retiré depuis" };
            return obs.prod === 0
                ? {
                      verdict: "confirmed",
                      why: `test-only confirmé (${obs.test} test(s), ${obs.intra} local)`,
                  }
                : { verdict: "drift", why: `annoncé test-only, ${obs.prod} consommateur(s) prod` };
        case "closed-no-op":
            return gone
                ? { verdict: "closed", why: "déjà résolu au triage, toujours absent" }
                : { verdict: "confirmed", why: "déjà résolu au triage — rien n'était à faire" };
        case "consign-only":
            return gone
                ? { verdict: "closed", why: "consigné sans traitement, mais disparu depuis" }
                : { verdict: "open", why: "CONSIGNÉ, JAMAIS TRAITÉ — toujours présent" };
        case "unknown":
            return { verdict: "unverifiable", why: "l'item ne porte aucun classement" };
        case "uncertain":
            return gone
                ? { verdict: "closed", why: "indécis au triage, levé par disparition" }
                : { verdict: "open", why: "toujours indécis — la survie ne tranche rien" };
        default:
            return { verdict: "unmodelled", why: `classement « ${claim} » non modélisé` };
    }
}

function probeItem(item, corpus) {
    const loc = locateFile(item.file, corpus);
    const at = loc.at || null;
    const obs = {
        file: loc.state,
        at,
        symbol: Boolean(item.symbol),
        generic: Boolean(item.symbol) && GENERIC_TOKENS.has(item.symbol),
        allowlisted: false,
        declared: null,
        exported: null,
        intra: 0,
        prod: 0,
        test: 0,
        sites: [],
    };

    if (item.symbol && at) {
        obs.allowlisted = isAllowlisted(at, item.symbol);
        obs.declared = isDeclaredIn(at, item.symbol);
        const exp = exportedNames(at);
        obs.exported = exp ? exp.has(item.symbol) : null;
        obs.intra = intraFileUses(at, item.symbol);
        const c = consumers(item.symbol, at, corpus);
        obs.prod = c.prod;
        obs.test = c.test;
        obs.sites = c.sites;
    } else if (item.symbol && loc.state === "absent") {
        obs.declared = false;
        obs.exported = false;
        const c = consumers(item.symbol, "", corpus);
        obs.prod = c.prod;
        obs.test = c.test;
        obs.sites = c.sites;
    }

    const j = judge(item.final || item.proposed || "unknown", obs);
    return { ...item, observed: obs, ...j };
}

// ─── Sources ──────────────────────────────────────────────────────────────────

function readJson(rel) {
    const abs = path.join(reportsDir(), rel);
    try {
        return JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
        die(`source illisible ${rel} — ${e.message}`);
    }
}

function sourceS4Triage() {
    const d = readJson("annexe_s4-triage-detail.json");
    return [...d.voletA, ...d.voletB].map((it) => ({
        id: `${it.volet}:${it.zone}:${it.symbol}`,
        ...it,
    }));
}

function sourceS4Low() {
    const d = readJson("annexe_s4-3-backlog-low.json");
    return d.items.map((it) => ({ id: it.id, ...it }));
}

/**
 * Les réfs `chemin.ext[:ligne]` d'un markdown dont l'extension est dans `re` ci-dessous
 * — le fichier existe-t-il encore ?
 *
 * ⚠️ **Pas « toutes » les réfs**, et l'écart est nommé parce qu'il a coûté un défaut réel :
 * cette extraction ne voit **ni les `.md`** (absent de l'alternance ci-dessous) **ni les
 * répertoires** (`docs/specs/rfc/`), qui n'ont pas d'extension. Un chemin de doc
 * cité en code inline lui est donc invisible. Motif et conduite à tenir :
 * §Limites de l'extraction de chemins, en tête de module.
 */
function sourceRefs(docRel) {
    const abs = path.isAbsolute(docRel) ? docRel : path.join(ROOT, docRel);
    let text;
    try {
        text = fs.readFileSync(abs, "utf8");
    } catch (e) {
        die(`document illisible ${docRel} — ${e.message}`);
    }
    // ⚠️ Extensions les plus LONGUES d'abord. En alternance regex, `js` matcherait
    // avant `json` et couperait `package.json` en « package.js » — un chemin qui
    // n'existe nulle part, donc un « fichier introuvable » entièrement fabriqué.
    const re = /([A-Za-z0-9_@./-]+\.(?:tsx|mjs|cjs|json|html|css|ts|js))(?::(\d+))?/g;
    const seen = new Map();
    let m;
    while ((m = re.exec(text)) !== null) {
        const key = `${m[1]}:${m[2] || ""}`;
        if (!seen.has(key))
            seen.set(key, { id: key, file: m[1], line: m[2] ? Number(m[2]) : null });
    }
    return [...seen.values()];
}

/** Les chemins cités en tête de ligne de table (registre CAPACITÉS, inventaire). */
function sourceFiles(docRel) {
    return sourceRefs(docRel).filter((r) => r.file.includes("/"));
}

/**
 * Les chemins cités dans la PROSE des blocs TSDoc de toutes les sources.
 *
 * Dernier trou de couverture de la règle ⛔ : `@param`, `@throws` et l'arité sont gardés par
 * TSDOC-CONFORMITY, les `@example` sont compilés par `typecheck-docs-examples` — mais la
 * PROSE ne l'était par rien. Une phrase qui renvoie à `kernel/geojson/style-resolver.ts`
 * reste lisible et convaincante longtemps après que le fichier a bougé, et c'est exactement
 * la classe de défaut que la refonte V3 a dû trouver à la main (7 fois, dont 3 API qui
 * n'existaient plus).
 *
 * ⚠️ **Les `@example` sont EXCLUS à dessein** : ils sont déjà compilés contre les `.d.ts`
 * publiés, et un chemin d'import y est vérifié bien mieux qu'ici. Les inclure ferait
 * doublonner deux gardes sur le même défaut, et diverger le jour où l'une changerait.
 *
 * ## ✅ CÂBLÉE dans `ci:local` depuis le 31/07/2026 — après fermeture de 5 classes de FP
 *
 * La condition que cet en-tête posait pour être gaté (« quand son taux de faux positifs aura
 * été mesuré et fermé ») est remplie. Historique des mesures :
 *
 * | Date | Items | Présents | Déplacés | Introuvables |
 * | --- | --- | --- | --- | --- |
 * | 30/07/2026 (câblage manuel) | 456 | 219 | 88 | **149** |
 * | 31/07/2026 (5 classes fermées) | 443 | 332 | 27 | **84** |
 *
 * **Les cinq classes de faux positifs, dans l'ordre où elles ont été trouvées** — les deux
 * premières pendant l'écriture, les trois suivantes en instruisant le reliquat :
 *
 *   1. juger le chemin littéral depuis la racine → **427 faux morts sur 456** ;
 *   2. ignorer la convention ESM `.js` ⇄ `.ts` → `app/boot.js` déclaré mort, `app/boot.ts` là ;
 *   3. **le segment omis / le préfixe en trop** — `scale/lifecycle.ts` pour
 *      `capabilities/scale/lifecycle.ts`. **73 occurrences**, résolues par index de suffixe
 *      ambiguë-safe. ⚠️ Cet en-tête annonçait ces deux-là comme des lacunes *distinctes* : ce
 *      sont les mêmes 73 ;
 *   4. **le specifier de paquet** — `@geoleaf/core/…`, `@core/…` : pas des chemins, écartés ;
 *   5. **le chemin à placeholder** — `profiles/<id>/profile.json` capturé comme `/profile.json`.
 *
 * ⚠️ **Ce que la baseline de 84 est, et ce qu'elle n'est PAS.** Ce n'est **pas** une file de
 * dette à drainer. En instruisant le reliquat, la majorité s'est révélée être de la
 * **provenance délibérée** — « Reclassified from `modules/built-in/ui/…` », « Absorbs the
 * former `app/init-notifications.ts` », « PROMOTED here from … ». Ces TSDoc nomment le chemin
 * **parce qu'il est mort** : c'est la trace de migration, et l'effacer serait une perte. Aucune
 * regex ne les distingue de façon fiable d'une citation périmée — c'est exactement le verdict
 * que le §Limites ci-dessus a déjà rendu pour les `.md` (précision 2/10).
 *
 * **Ce que le gate garde est donc étroit et vrai : aucune citation morte NEUVE ne peut
 * entrer.** C'est le risque réel — quelqu'un déplace un fichier et laisse la référence —,
 * alors qu'une note de provenance s'écrit délibérément et rarement.
 *
 * ⚠️ **Hors périmètre, assumé** : les bandeaux `/*!` de tête de fichier ne sont pas lus (seuls
 * les blocs `/** … *\/` le sont). Vérifié en posant la mutation de contrôle : injectée dans le
 * bandeau, la gate reste verte ; dans un bloc TSDoc, elle rougit. Les en-têtes de module ont
 * leur propre garde (`check-module-headers.cjs`).
 *
 *     node scripts/audit-report-freshness.cjs --source tsdoc            # mesure
 *     npm run check:tsdoc-paths                                         # gate
 *     npm run check:tsdoc-paths:update-baseline                         # après correction
 */
/**
 * Index paresseux « suffixe de chemin → fichiers du dépôt qui s'y terminent ».
 *
 * Construit une seule fois, depuis `git ls-files` : c'est la liste des fichiers SUIVIS, donc
 * ni `node_modules/`, ni `dist/`, ni les artefacts — un index bâti par parcours du disque
 * ferait résoudre des citations sur des sorties de build, et un chemin `dist/` doit
 * précisément rester non résolu (il n'existe pas dans un clone frais).
 *
 * @param {string} tail - suffixe de chemin normalisé, contenant au moins un `/`.
 * @returns {string[]} les chemins du dépôt qui se terminent par ce suffixe (0, 1 ou plusieurs).
 */
let _suffixMap = null;
function suffixIndex(tail) {
    if (_suffixMap === null) {
        _suffixMap = new Map();
        let tracked = [];
        try {
            tracked = require("node:child_process")
                .execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1e9 })
                .split("\n")
                .filter(Boolean);
        } catch {
            // Hors dépôt git : l'index reste vide, la classe n'est simplement pas fermée.
            // On ne jette pas — ce script mesure, il ne garde pas (cf. §Ce que ce script N'EST PAS).
            tracked = [];
        }
        for (const p of tracked) {
            const segs = normPath(p).split("/");
            // N'indexer que les suffixes de 2 segments et plus : un basename seul est trop
            // ambigu pour trancher, et `sourceTsdoc` écarte déjà les citations sans `/`.
            for (let i = segs.length - 2; i >= 0; i--) {
                const key = segs.slice(i).join("/");
                let bucket = _suffixMap.get(key);
                if (!bucket) _suffixMap.set(key, (bucket = []));
                bucket.push(p);
            }
        }
    }
    return _suffixMap.get(tail) || [];
}

function sourceTsdoc() {
    const files = [];
    for (const pkg of registry.all()) {
        const src = path.join(pkg.absDir, "src");
        if (fs.existsSync(src)) collectFiles(src, files);
    }

    // Mêmes extensions que le reste du script, mais les plus LONGUES d'abord — voir le
    // motif détaillé sur `sourceRefs` : en alternance, `js` couperait `package.json`.
    const refRe = /([A-Za-z0-9_@./-]+\.(?:tsx|mjs|cjs|json|html|css|ts|js))(?::(\d+))?/g;
    const seen = new Map();

    for (const abs of files) {
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(abs)) continue;
        const rel = normPath(path.relative(ROOT, abs));
        let text;
        try {
            text = fs.readFileSync(abs, "utf8");
        } catch {
            continue;
        }
        if (!text.includes("/**")) continue;

        // ⚠️ Les bases de résolution, et l'ORDRE compte. Un TSDoc cite presque toujours
        // relativement — à son propre répertoire (`./utils/general/dom-helpers.ts`,
        // `../kernel/map/facade.ts`) ou à la racine `src/` de son paquet
        // (`kernel/events/facade.ts`). Juger le chemin LITTÉRAL depuis la racine du dépôt
        // déclarerait morts 427 chemins sur 456, dont la quasi-totalité vivante : c'est la
        // première version de cette source, et l'échantillonnage l'a prise en défaut avant
        // qu'elle ne serve. Mesurer, puis regarder ce qu'on a mesuré.
        const pkgSrc = (() => {
            const i = rel.indexOf("/src/");
            return i === -1 ? null : rel.slice(0, i + 5);
        })();
        const bases = [normPath(path.dirname(rel)) + "/", pkgSrc, ""].filter((b) => b !== null);

        for (const block of text.match(/\/\*\*[\s\S]*?\*\//g) || []) {
            // Retirer les `@example` : leur contenu est du CODE, vérifié ailleurs, et ses
            // chemins d'import y sont résolus par `tsc` plutôt que devinés par une regex.
            const prose = block.replace(/@example[\s\S]*?(?=\n\s*\*\s*@|\*\/$)/g, "");
            let m;
            while ((m = refRe.exec(prose)) !== null) {
                const cited = m[1];

                // 4ᵉ classe de faux positifs, fermée le 31/07/2026 — LE SPECIFIER DE PAQUET.
                //
                // `@geoleaf/core/capabilities/offline/cache/tile-math.js`, `@core/utils/…` :
                // ce ne sont pas des chemins de système de fichiers, ce sont des specifiers
                // résolus par la carte `exports` du paquet ou par un alias de build. Les juger
                // comme des chemins revient à les déclarer morts **toujours** — la regex les
                // capturait, aucune base ne pouvait les résoudre, et ils gonflaient le compte
                // des « introuvables » sans qu'aucun geste ne puisse les corriger.
                //
                // ⚠️ Cette classe manquait à l'en-tête de cette fonction, qui n'en annonçait
                // que deux. Elle est écartée plutôt que résolue : vérifier un specifier demande
                // de dérouler la carte `exports`, ce que `check-subpath-resolve.cjs` fait déjà
                // et mieux (sur `dist/`, après build). Deux gardes sur le même défaut
                // divergeraient — c'est le motif qui a déjà exclu les `@example` d'ici.
                if (cited.startsWith("@")) continue;

                // 5ᵉ classe de faux positifs, fermée le 31/07/2026 — LE CHEMIN À PLACEHOLDER.
                //
                // Un TSDoc décrit très souvent une FAMILLE de fichiers, pas un fichier :
                // `profiles/<id>/profile.json`, `capabilities/<nom>/install.ts`,
                // `${baseUrl}/profile.json`. Les caractères `<`, `>`, `$`, `{` ne sont pas dans
                // la classe de la regex, qui redémarre donc au `/` suivant et capture
                // `/profile.json` — un chemin **absolu depuis la racine du système**, qui ne
                // peut évidemment jamais exister.
                //
                // La règle est sûre parce qu'elle est asymétrique : aucun TSDoc de ce dépôt ne
                // cite légitimement un chemin absolu depuis `/`. Un `cited` qui commence par
                // `/` est donc toujours un reliquat de découpe, jamais une cible.
                //
                // ⚠️ Trouvée en INSTRUISANT le reliquat, pas en le supposant : les 4 premiers
                // « introuvables » examinés à la main (`/install.ts`, `/profile.json`,
                // `/basemaps.json`, `/config-primitives.js`) étaient les quatre des
                // placeholders. Extrapoler aurait donné « 39 vrais morts » ; mesurer en donne
                // moins. C'est le corollaire « extrapoler n'est pas pré-voler » de `CLAUDE.md`.
                if (cited.startsWith("/")) continue;

                // Un chemin sans `/` est un simple nom de fichier — trop ambigu pour être
                // jugé, et `locateFile` le résoudrait par basename au hasard du dépôt.
                if (!cited.includes("/")) continue;

                // Résoudre contre chaque base ; la première qui existe gagne. Si aucune ne
                // donne un fichier réel, on transmet la forme normalisée depuis `src/` du
                // paquet — c'est celle qui rend le rapport lisible pour un humain.
                // ⚠️ `.js` → `.ts` : en ESM, une source `.ts` s'importe en `.js`, et les
                // TSDoc citent la forme d'import. Sans cette variante, `app/boot.js` est
                // déclaré mort alors que `app/boot.ts` est là — 2ᵉ classe de faux positifs
                // trouvée à l'échantillonnage, après celle des chemins relatifs.
                const forms = [cited];
                if (/\.js$/.test(cited)) forms.push(cited.replace(/\.js$/, ".ts"));
                if (/\.mjs$/.test(cited)) forms.push(cited.replace(/\.mjs$/, ".mts"));

                let resolved = null;
                outer: for (const form of forms) {
                    for (const b of bases) {
                        const cand = normPath(path.normalize(path.join(b, form)));
                        if (fs.existsSync(path.join(ROOT, cand))) {
                            resolved = cand;
                            break outer;
                        }
                    }
                }

                // 3ᵉ classe de faux positifs, fermée le 31/07/2026 — LE SEGMENT OMIS.
                //
                // Un TSDoc cite très souvent une forme raccourcie qui n'est complète depuis
                // aucune des trois bases ci-dessus : `scale/lifecycle.ts` pour
                // `capabilities/scale/lifecycle.ts`, `geojson/core.ts` pour
                // `kernel/geojson/core.ts`, ou au contraire un `src/` en trop. La citation
                // désigne un fichier BIEN VIVANT ; seul le chemin est abrégé.
                //
                // ⚠️ **Mesuré avant d'être codé, et c'est ce qui a décidé de la forme** : sur
                // les 149 « introuvables » du 30/07, **73 occurrences** se résolvent par simple
                // suffixe. Les déclarer mortes revenait à sur-compter d'un facteur ~2 — et
                // l'en-tête de cette fonction annonçait « au moins deux lacunes connues » en
                // décrivant précisément ces deux-là (préfixe `src/`, segment omis) : ce sont
                // les MÊMES 73, et non deux gisements distincts.
                //
                // La résolution par suffixe est volontairement AMBIGUË-SAFE : si deux fichiers
                // du dépôt terminent par le même suffixe, on refuse de trancher et le chemin
                // reste non résolu. Un faux « vivant » silencieux serait pire que le faux
                // « mort » qu'on corrige — c'est le biais de prudence que revendique l'en-tête
                // du script.
                if (!resolved) {
                    for (const form of forms) {
                        const tail = form.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
                        if (!tail.includes("/")) continue;
                        const hits = suffixIndex(tail);
                        if (hits.length === 1) {
                            resolved = hits[0];
                            break;
                        }
                    }
                }
                const file = resolved ?? normPath(path.normalize(path.join(pkgSrc || "", cited)));

                const key = `${rel}→${cited}`;
                if (!seen.has(key)) {
                    seen.set(key, {
                        id: key,
                        file,
                        line: m[2] ? Number(m[2]) : null,
                        citedIn: rel,
                        cited,
                    });
                }
            }
        }
    }
    return [...seen.values()];
}

/** Chemins cités par les 45 fiches de `docs/specs/` (SPECS-PATHS, B-221). */
function sourceSpecs() {
    const files = [];
    collectMd(docsPaths.specs(), files);
    if (files.length === 0) {
        die(
            "corpus `docs/specs/` vide — refus de conclure. Une gate qui ne lit rien sort verte " +
                "en n'ayant rien gardé ; c'est le mode d'échec que ce script existe pour éviter."
        );
    }
    return collectCitedPaths(files, specsBases);
}

/**
 * Chemins cités par `docs/guides/` et `docs/reference/` — la 3ᵉ sous-racine publique (B-222).
 *
 * `SPECS-PATHS` gardait `docs/specs/` **et rien d'autre**, alors que les deux autres partent
 * dans le même dépôt public et sont lues par les mêmes gens. Le coût était mesuré, pas
 * supposé : `TESTING_GUIDE.md` a énuméré pendant des mois une suite `poi.test.js` disparue
 * avec la dissolution du module POI, et **aucune gate ne pouvait la voir** —
 * `check-dead-links` n'extrait que la forme markdown `[texte](cible)`, jamais un nom de
 * fichier en backticks.
 *
 * @returns {object[]} items, mêmes forme et contrat que `sourceSpecs()`.
 */
function sourceGuides() {
    const files = [];
    collectMd(docsPaths.guides(), files);
    collectMd(docsPaths.reference(), files);
    const kept = files.filter((f) => !GUIDES_GENERATED.has(normPath(path.relative(ROOT, f))));
    if (kept.length === 0) {
        die(
            "corpus `docs/guides/` + `docs/reference/` vide — refus de conclure. Une gate qui ne " +
                "lit rien sort verte en n'ayant rien gardé."
        );
    }
    return collectCitedPaths(kept, guidesBases);
}

/**
 * Racines de résolution d'une fiche `docs/specs/`, la plus spécifique d'abord.
 *
 * ⚠️ **Cette fonction EST la 4ᵉ base, et sans elle la source ne mesure rien d'utile.** Une
 * fiche de capacité cite `lifecycle.ts`, `config.ts`, `public-api.ts` — les noms du contrat de
 * module, portés à l'identique par les 21 capacités et les 12 plugins. Résolus globalement ils
 * sont ambigus à 20-30 candidats et `suffixIndex` refuse de trancher (à raison) ; résolus
 * depuis le répertoire SUJET de la fiche, ils sont exacts. Mesuré le 11/08/2026 : la
 * racine-sujet seule résout **51,4 %** des 1592 chemins non-racinés, les bases communes
 * portent le cumul à **73,5 %**.
 *
 * 🛑 **Ce que ces bases NE font PAS** : elles ne lèvent pas l'ambiguïté pour le LECTEUR. Un
 * `config.ts` cité dans une fiche dont il n'est pas le sujet reste illisible même si la gate
 * le résout. Le racinage rédactionnel est un geste distinct (6.11 lot 3), et cette gate ne
 * prétend pas le porter — elle garde une propriété étroite : aucun chemin mort NEUF.
 *
 * @param {string} rel - chemin de la fiche, relatif à la racine du dépôt.
 * @returns {string[]} préfixes à essayer dans l'ordre, terminés par `/` (sauf la racine, `""`).
 */
function specsBases(rel) {
    const bases = [];
    let m;
    if ((m = rel.match(/\/capacites\/(.+)\.md$/))) {
        bases.push(`packages/core/src/capabilities/${m[1]}/`);
    } else if ((m = rel.match(/\/plugins\/CDC_(.+)\.md$/))) {
        bases.push(`packages/plugins/${m[1]}/src/`, `packages/plugins/${m[1]}/`);
    } else if ((m = rel.match(/\/libs\/(.+)\.md$/))) {
        bases.push(`packages/libs/${m[1]}/src/`, `packages/libs/${m[1]}/`);
    }
    // Bases communes : le core est cité par TOUTES les fiches (kernel, contrats, RFC compris),
    // puis les racines documentaires — un renvoi `CDC_kernel.md` depuis `capacites/` n'est
    // résoluble que par `docs/specs/`. La racine du dépôt vient en dernier : elle accepte les
    // chemins déjà repo-racinés, qui sont la forme cible.
    bases.push(
        "packages/core/src/",
        "packages/core/",
        normPath(path.dirname(rel)) + "/",
        "docs/specs/",
        "docs/reference/",
        ""
    );
    return bases;
}

/**
 * Chemins cités par les 45 fiches de `docs/specs/` — le corpus qu'AUCUNE gate ne lisait.
 *
 * ⚠️ **Constat qui motive cette source, mesuré le 11/08/2026 par élimination sur les 78 gates
 * de `ci:local`** : `check-dead-links` n'extrait que `[texte](cible)` (`:321`), TSDOC-PATHS
 * s'arrête aux `src/` des paquets et n'a pas `md` dans son alternance, les corpus `.md` de
 * `validate-docs-examples`/`typecheck-docs-examples` sont pris à profondeur 0 de la racine
 * (`lib/tsdoc-examples.cjs:162`, donc jamais `docs/`), et les 3 guards ne contrôlent que des
 * tables nommées. **546 paires (fiche→chemin) n'étaient gardées par rien** — d'où la classe B
 * de la tâche 6.11, qui « se périme sans jamais rougir ». Ce n'était pas une fatalité, c'était
 * un trou d'outillage.
 *
 * Trois écarts assumés avec `sourceTsdoc`, chacun mesuré :
 *
 *   1. **`md` entre dans l'alternance.** Les fiches se citent entre elles — `CDC_kernel.md`
 *      35 fois, `ARBORESCENCE_QUALIFIEE.md` 35 fois. Placé en DERNIER : l'alternance se lit
 *      dans l'ordre, et une extension courte placée trop tôt coupe les longues.
 *   2. **Un nom nu est accepté s'il est `.md`, refusé sinon.** `CDC_kernel.md` désigne un
 *      document réel et se résout par les racines documentaires ; `config.ts` sans répertoire
 *      est porté par 28 fichiers et ne se tranche pas — c'est le geste rédactionnel du lot 3,
 *      pas celui d'un résolveur.
 *   3. **Les URL sont retirées AVANT la regex.** `https://geoleaf.dev/x.json` ferait capturer
 *      `geoleaf.dev/x.json`, éternellement mort et incorrigible — la 4ᵉ classe de faux
 *      positifs de `sourceTsdoc` (le specifier de paquet) sous un autre nom.
 *
 * @returns {object[]} items `{ id, file, line, citedIn, cited }`, dédoublonnés par paire.
 */
/**
 * Moteur d'extraction PARTAGÉ par `--source specs` et `--source guides`.
 *
 * ⚠️ **Extrait de `sourceSpecs()` le 11/08/2026 (B-222), et pas par goût du facteur commun.**
 * La 3ᵉ source avait besoin de la même boucle à quelques lignes près ; la recopier aurait
 * créé **deux extracteurs libres de diverger** sur un dépôt qui a déjà payé ce défaut deux
 * fois (B-80 : une exclusion dupliquée corrigée d'un seul côté, une gate restée aveugle).
 * Un seul moteur, deux corpus, deux baselines.
 *
 * @param {string[]} files - documents à lire, chemins absolus.
 * @param {(rel: string) => string[]} basesFor - racines de résolution, par document.
 * @returns {object[]} items `{ id, file, line, citedIn, cited }`, dédoublonnés par paire.
 */
function collectCitedPaths(files, basesFor) {
    const refRe =
        /([A-Za-z0-9_@./-]+\.(?:tsx|mjs|cjs|json|html|yaml|css|yml|ts|js|md))(?::(\d+))?/g;
    const seen = new Map();

    for (const abs of files.sort()) {
        const rel = normPath(path.relative(ROOT, abs));
        let text;
        try {
            text = fs.readFileSync(abs, "utf8");
        } catch {
            continue;
        }
        const bases = basesFor(rel);

        // Les blocs clôturés portent du CODE d'exemple, pas des renvois : leurs chemins
        // d'import sont vérifiés par `typecheck-docs-examples` sur son propre corpus, et les
        // juger ici produirait deux gardes divergentes sur le même défaut — le motif qui a
        // déjà exclu les `@example` de `sourceTsdoc`.
        //
        // 🛑 **C'EST AUSSI L'ANGLE MORT DE CETTE SOURCE, et il a un coût mesuré.** La relecture
        // du 11/08/2026 a trouvé `"addpoi": "config/plugins/addpoi.json"` dans DEUX exemples
        // ```json copiables-collables (`CDC_kernel.md` §Le manifeste `Files`,
        // `PROFILE_CONTRACT_SPEC.md` §3 et §4) — un plugin fusionné dans `editor` au Sprint 5.
        // Invisible ici parce que clôturé, et invisible aux guards de profil parce qu'ils
        // valident la FORME contre `profile.schema.json`, où `Files.modules` a des clés
        // dynamiques. Deux gates vertes, un exemple mort. **Ne pas « corriger » en levant cette
        // exclusion** : elle éviterait ce cas au prix de juger tous les chemins d'import des
        // exemples de code, ce que `typecheck-docs-examples` fait déjà et mieux. Le trou est
        // réel, il est nommé, et il se ferme par la relecture — pas par cette regex.
        let inFence = false;
        for (const raw of text.split("\n")) {
            if (/^\s*(```|~~~)/.test(raw)) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;

            const line = raw.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
            let m;
            refRe.lastIndex = 0;
            while ((m = refRe.exec(line)) !== null) {
                const cited = m[1];
                if (cited.startsWith("@")) continue;
                if (cited.startsWith("/")) continue;
                if (!cited.includes("/") && !cited.endsWith(".md")) continue;

                const forms = [cited];
                if (/\.js$/.test(cited)) forms.push(cited.replace(/\.js$/, ".ts"));
                if (/\.mjs$/.test(cited)) forms.push(cited.replace(/\.mjs$/, ".mts"));

                let resolved = null;
                outer: for (const form of forms) {
                    for (const b of bases) {
                        const cand = normPath(path.normalize(path.join(b, form)));
                        if (cand.startsWith("..")) continue;
                        if (fs.existsSync(path.join(ROOT, cand))) {
                            resolved = cand;
                            break outer;
                        }
                    }
                }
                if (!resolved) {
                    for (const form of forms) {
                        const tail = form.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
                        if (!tail.includes("/")) continue;
                        const hits = suffixIndex(tail);
                        if (hits.length === 1) {
                            resolved = hits[0];
                            break;
                        }
                    }
                }
                const file = resolved ?? normPath(path.normalize(path.join(bases[0], cited)));

                const key = `${rel}→${cited}`;
                if (!seen.has(key)) {
                    seen.set(key, {
                        id: key,
                        file,
                        line: m[2] ? Number(m[2]) : null,
                        citedIn: rel,
                        cited,
                    });
                }
            }
        }
    }
    return [...seen.values()];
}

/** Collecte récursive des `.md` — `collectFiles` filtre sur `SOURCE_EXTS`, qui n'a pas `md`. */
/**
 * Racines de résolution d'un document de `docs/guides/` ou `docs/reference/`.
 *
 * ⚠️ **Volontairement différentes de `specsBases()`, et B-222 le dit** : celles-là sont
 * taillées pour la structure `capacites/` · `plugins/` · `libs/`, où le nom du fichier
 * désigne le sujet et donne donc une racine (`capabilities/<id>/`). Un guide n'a pas de
 * sujet déductible de son nom : il cite du code depuis n'importe où. Ses bases sont donc
 * génériques, ordonnées du plus spécifique au plus large.
 *
 * @param {string} rel - chemin du document, relatif à la racine du dépôt.
 * @returns {string[]} préfixes à essayer dans l'ordre.
 */
function guidesBases(rel) {
    return [
        normPath(path.dirname(rel)) + "/",
        "packages/core/src/",
        "packages/core/",
        // La doc du site : ces documents s'y renvoient par leur NOM NU (`ARCHITECTURE_GUIDE.md`,
        // `GeoLeaf_core_README.md`). Sans cette base, 4 renvois VIVANTS étaient comptés morts —
        // l'instrument aurait porté la cécité qu'il mesure, et la baseline aurait figé du faux.
        "packages/core/docs/",
        // Les chemins `config/core/*.json` et `layers/<id>/…` sont relatifs à un PROFIL, pas au
        // dépôt. `_reference` est le profil canonique, celui dont la structure fait foi.
        "profiles/_reference/",
        "docs/",
        "docs/reference/",
        "docs/specs/",
        "",
    ];
}

/**
 * Les artefacts GÉNÉRÉS de `docs/reference/`, hors corpus — et le motif n'est pas le confort.
 *
 * Ils sont **vrais par construction** : `generate-docs-tree.cjs`, `gen-attributes-report.cjs`
 * et `gen-profile-schema-reference.cjs` les dérivent du disque et des schémas, et chacun
 * porte déjà sa gate `--check` dans `ci:local`. Les inclure ici ferait entrer les ~1 900
 * lignes de l'arborescence — c'est-à-dire **un chemin par fichier du dépôt** — dans une
 * baseline que personne ne pourrait plus lire, pour garder une propriété déjà gardée
 * ailleurs, et mieux.
 *
 * 🛑 Ne pas y ajouter un fichier RÉDIGÉ : ce serait le soustraire à la seule gate qui le
 * regarde. La liste se justifie fichier par fichier, jamais par un glob.
 */
const GUIDES_GENERATED = new Set([
    "docs/reference/ARBORESCENCE_QUALIFIEE.md",
    "docs/reference/MODELE_ATTRIBUTAIRE.md",
    "docs/reference/PROFILE_SCHEMA_REFERENCE.md",
]);

function collectMd(dir, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) collectMd(full, acc);
        else if (e.isFile() && e.name.endsWith(".md")) acc.push(full);
    }
    return acc;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

function main() {
    const source = arg("source");
    if (!source) die("--source requis (s4-triage | s4-low | refs | files | tsdoc | specs | guides)");

    const corpus = buildCorpus();
    let items;
    let label = source;

    if (source === "s4-triage") items = sourceS4Triage();
    else if (source === "s4-low") items = sourceS4Low();
    else if (source === "tsdoc") items = sourceTsdoc();
    else if (source === "specs") items = sourceSpecs();
    else if (source === "guides") items = sourceGuides();
    else if (source === "refs" || source === "files") {
        const doc = arg("doc");
        if (!doc) die("--doc requis avec --source refs|files");
        label = `${source}:${path.basename(doc)}`;
        items = source === "refs" ? sourceRefs(doc) : sourceFiles(doc);
    } else die(`source inconnue « ${source} »`);

    // Refuser explicitement plutôt que d'ignorer le drapeau : `--gate --source refs` sortirait
    // 0 en silence, c'est-à-dire « vert » — exactement la classe de faux vert que ce script
    // existe pour éviter. Les deux sources gatées sont celles qui mesurent le DÉPÔT (la prose
    // des TSDoc, les renvois des fiches) et non la fraîcheur d'un document d'atelier.
    if (GATE && !GATES[source]) {
        die(`--gate n'est disponible qu'avec --source ${Object.keys(GATES).join(" | ")}`);
    }

    const results = items.map((it) => probeItem(it, corpus));

    const tally = {};
    for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
    const fileTally = {};
    for (const r of results) fileTally[r.observed.file] = (fileTally[r.observed.file] || 0) + 1;

    const report = {
        source: label,
        measuredAt: "HEAD",
        corpusFiles: corpus.entries.length,
        itemCount: results.length,
        tally,
        fileTally,
        results,
    };

    const out = arg("out");
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

    if (!QUIET) {
        process.stdout.write(
            `\n── ${label} — ${results.length} items · corpus ${corpus.entries.length} fichiers\n`
        );
        process.stdout.write(`   chemins : ${JSON.stringify(fileTally)}\n`);
        process.stdout.write(`   verdicts: ${JSON.stringify(tally)}\n`);
        const notable = results.filter((r) => r.verdict === "open" || r.verdict === "drift");
        if (notable.length) {
            process.stdout.write(`\n   ⚠️  ${notable.length} item(s) à instruire :\n`);
            for (const r of notable.slice(0, 60)) {
                process.stdout.write(
                    `   · [${r.verdict}] ${r.id || r.file} — ${r.why}` +
                        (r.observed.at && r.observed.file === "moved"
                            ? ` (déménagé → ${r.observed.at})`
                            : "") +
                        `\n`
                );
            }
            if (notable.length > 60)
                process.stdout.write(`   … +${notable.length - 60} autres (voir --out)\n`);
        }
        if (out) process.stdout.write(`\n   → ${out}\n`);
    }

    if (GATE) process.exit(runGate(results, GATES[source]));
    process.exit(0);
}

// ─── Mode gate — `--source tsdoc|specs --gate` ────────────────────────────────

/**
 * Les deux cliquets, un par source gatée. Mêmes mécanique et contrat, corpus différents :
 * `tsdoc` mesure la prose des TSDoc des `src/` de paquet, `specs` les renvois des 45 fiches
 * de `docs/specs/`. Séparer les baselines est délibéré — une baseline unique mêlerait deux
 * gisements dont les gestes de correction n'ont rien de commun, et son décompte cesserait de
 * vouloir dire quelque chose.
 */
const GATES = {
    tsdoc: {
        code: "TSDOC-PATHS",
        baseline: path.join(__dirname, "audit-tsdoc-paths.baseline.json"),
        what: "dans la prose des blocs TSDoc",
        cmd: "--source tsdoc --gate",
        hint:
            "    Un TSDoc qui renvoie à un fichier absent reste lisible et convaincant\n" +
            "    longtemps après que le fichier a bougé. Corriger la citation.\n",
    },
    specs: {
        code: "SPECS-PATHS",
        baseline: path.join(__dirname, "audit-specs-paths.baseline.json"),
        what: "dans les renvois des fiches `docs/specs/`",
        cmd: "--source specs --gate",
        hint:
            "    Ces 45 fiches partent dans le dépôt public et les tarballs npm sont immuables :\n" +
            "    un renvoi faux y devient définitif. ⚠️ Avant de « corriger », LIRE LA PHRASE —\n" +
            "    une fiche nomme souvent un chemin PARCE QU'IL EST MORT (« ce répertoire n'existe\n" +
            "    plus », « supprimé au Sprint 5 »). Ceux-là entrent en baseline, ils ne se\n" +
            "    réécrivent pas : mesuré 15 sur 20 à la classe A de la tâche 6.11.\n",
    },
    guides: {
        code: "GUIDES-PATHS",
        baseline: path.join(__dirname, "audit-guides-paths.baseline.json"),
        what: "dans les renvois de `docs/guides/` et `docs/reference/`",
        cmd: "--source guides --gate",
        hint:
            "    La 3ᵉ sous-racine publique, restée SANS gate jusqu'au 11/08/2026 (B-222) —\n" +
            "    `SPECS-PATHS` ne gardait que `docs/specs/`. Ce trou a laissé `TESTING_GUIDE.md`\n" +
            "    enseigner une suite `poi.test.js` disparue avec le module POI.\n" +
            "    ⚠️ Même précaution qu'en `specs` : LIRE LA PHRASE avant de corriger — un guide\n" +
            "    nomme souvent un chemin PARCE QU'IL A DISPARU. Ceux-là entrent en baseline.\n" +
            "    Les artefacts GÉNÉRÉS de `docs/reference/` sont hors corpus (voir\n" +
            "    `GUIDES_GENERATED`) : vrais par construction, et déjà gatés par leur `--check`.\n",
    },
};

/**
 * Cliquet DÉCROISSANT sur les chemins morts cités dans la prose des TSDoc.
 *
 * Sur le patron de TSD-04 (`check-tsdoc-conformity`) et du cliquet posé en B-78(b) : la
 * baseline ne peut que **rétrécir**. Deux échecs, pas un :
 *
 *   - **TSDOC-PATHS-01** — un chemin mort NEUF, absent de la baseline. Le défaut normal.
 *   - **TSDOC-PATHS-02** — une entrée de la baseline qui ne correspond plus à rien
 *     (chemin réparé, ou TSDoc supprimé) et qui n'a pas été retirée. Sans ce second axe,
 *     une baseline se fossilise : elle finit par décrire un dépôt qui n'existe plus, et
 *     personne ne s'en aperçoit puisqu'elle sort verte. C'est le mode d'échec n° 5.
 *
 * ⚠️ **Pourquoi une baseline plutôt qu'un zéro immédiat.** Les 84 occurrences restantes au
 * câblage sont de vrais chemins morts, mais leur correction touche ~40 fichiers et relève de
 * gestes distincts (le répertoire `modules/` dissous, des en-têtes de test d'avant migration,
 * des citations `dist/`). Les geler laisse le gain acquis — **aucune citation morte NEUVE ne
 * peut plus entrer** — et rend la dette visible et décroissante, au lieu de bloquer sur un
 * chantier qui n'a rien à voir avec le prochain commit.
 *
 * @param {object[]} results - les items mesurés.
 * @param {object} cfg - l'entrée de `GATES` correspondant à la source (code, baseline, hint…).
 * @returns {number} code de sortie (0 vert, 1 rouge).
 */
function runGate(results, cfg) {
    const { code, baseline: BASELINE, what, cmd, hint } = cfg;
    const dead = results
        .filter((r) => r.observed.file === "absent")
        .map((r) => r.id)
        .sort();

    if (UPDATE_BASELINE) {
        fs.writeFileSync(
            BASELINE,
            JSON.stringify(
                {
                    _comment:
                        `Chemins morts CONNUS ${what}, figés par ` +
                        `\`audit-report-freshness.cjs ${cmd}\`. Clé = ` +
                        "`<fichier citant>→<chemin cité>`. Le gate rougit sur une entrée ABSENTE " +
                        `d'ici (${code}-01) ET sur une entrée d'ici qui n'existe plus ` +
                        `(${code}-02) : la baseline ne peut que RÉTRÉCIR. Régénérer via ` +
                        "`--update-baseline` après avoir corrigé un lot.",
                    generatedCount: dead.length,
                    paths: dead,
                },
                null,
                4
            ) + "\n"
        );
        process.stdout.write(
            `\n✓ ${code}: baseline régénérée (${dead.length} chemin(s) figé(s)).\n`
        );
        return 0;
    }

    let baseline = [];
    if (fs.existsSync(BASELINE)) {
        baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")).paths || [];
    }
    const known = new Set(baseline);
    const current = new Set(dead);

    const fresh = dead.filter((k) => !known.has(k));
    const stale = baseline.filter((k) => !current.has(k));

    // Une gate qui ne scanne rien doit crier, pas passer.
    if (results.length === 0) {
        process.stderr.write(
            `\n❌  ${code} — 0 item mesuré. Le corpus a bougé ou l'extracteur est cassé ;\n` +
                `    une sortie verte ici signifierait « rien à vérifier », pas « tout est bon ».\n`
        );
        return 1;
    }

    if (fresh.length === 0 && stale.length === 0) {
        process.stdout.write(
            `\n✓ ${code} — aucun chemin mort neuf ; baseline ${baseline.length} ` +
                `(ne peut que rétrécir).\n`
        );
        return 0;
    }

    if (fresh.length) {
        process.stderr.write(`\n❌  ${code}-01 — ${fresh.length} chemin(s) mort(s) NEUF(S) :\n`);
        for (const k of fresh.slice(0, 40)) process.stderr.write(`      ${k}\n`);
        if (fresh.length > 40) process.stderr.write(`      … +${fresh.length - 40}\n`);
        process.stderr.write(`\n${hint}`);
    }
    if (stale.length) {
        process.stderr.write(
            `\n❌  ${code}-02 — ${stale.length} entrée(s) PÉRIMÉE(S) dans la baseline :\n`
        );
        for (const k of stale.slice(0, 40)) process.stderr.write(`      ${k}\n`);
        if (stale.length > 40) process.stderr.write(`      … +${stale.length - 40}\n`);
        process.stderr.write(
            `\n    Ces chemins ne sont plus morts — c'est une bonne nouvelle, et elle doit être\n` +
                `    ACTÉE : régénérer via --update-baseline, pour que le cliquet descende.\n`
        );
    }
    return 1;
}

main();
