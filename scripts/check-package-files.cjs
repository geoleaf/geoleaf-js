#!/usr/bin/env node
/**
 * PKG-FILES: every entry of a package's `files[]` must exist on disk.
 *
 * npm silently drops a `files[]` entry that points at nothing, so a package can
 * declare it ships a LICENSE and publish without one for months. That is exactly
 * what happened here: 10 packages declared a LICENSE that was not on disk, and
 * plugin-addpoi listed "LICENCE" (French spelling) — an entry that could never
 * have matched. This gate catches the class, not the ten instances.
 *
 * Build outputs are exempt: an entry that git ignores (typically "dist/") is an
 * artifact whose absence is normal on a fresh clone or before a build. Checking
 * it would make the gate fail in pre-commit for a reason that is not a defect.
 *
 * Usage: node scripts/check-package-files.cjs (from repo root)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

// `gitIgnoredSet` vivait ici. Déplacée au T4.3 dans `lib/generated-artifacts.cjs` avec
// son commentaire sur la barre oblique finale porteuse : `verify-repo-hygiene.cjs` en a
// besoin pour le même usage (check 5c), et deux copies de 10 lignes de code + 12 de
// commentaire sont exactement ce que le gate `dup:check` de `ci:local` remonte.
const {
    generatedRootOf,
    declaredOutputs,
    gitIgnoredSet,
} = require("./lib/generated-artifacts.cjs");

// ARCHI S9.5 — from the workspace registry, not a one-level `readdirSync`. The
// registry already applies the root "!packages/_*" negation, so _plugin-template
// stays excluded for the same reason as before: it is a scaffold, never built and
// never published, and its files[] describes what a GENERATED plugin ships.
//
// The previous form enumerated direct children of packages/ only. After ARCHI S10
// moves packages under `packages/plugins/`, it would have found no package.json at
// that level and validated ZERO packages — green, and blind to every phantom
// files[] entry it exists to catch.
const registry = require("./lib/packages.cjs");
const packages = registry.all();

// Collect every (package, entry) pair first so ignore status is resolved in one call.
const candidates = [];
/** Les `files[]` intacts, dans l'ORDRE — le check 2 en dépend (dernière règle gagnante). */
const filesByPkg = [];
for (const pkgEntry of packages) {
    const name = pkgEntry.dirName;
    const pkgPath = path.join(pkgEntry.absDir, "package.json");
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch (e) {
        console.error(
            `ERROR [PKG-FILES]: ${pkgEntry.dir}/package.json is not valid JSON — ${e.message}`
        );
        process.exit(1);
    }
    if (!Array.isArray(pkg.files)) continue;
    filesByPkg.push({ pkgEntry, files: pkg.files });
    for (const entry of pkg.files) {
        if (typeof entry !== "string" || entry.length === 0) continue;
        // T4.3 — une entrée NIÉE est une exclusion, pas une livraison. Le réflexe de la
        // sauter serait la cécité même que ce sprint combat : un `!docs/apis/` fautif
        // (au pluriel) ne retire RIEN et npm publie l'artefact sans un mot. Ce qui doit
        // exister — ou être ignoré — c'est sa CIBLE ; on la valide comme les autres.
        const target = entry.startsWith("!") ? entry.slice(1) : entry;
        // A glob cannot be resolved by existence alone — npm expands it at pack time.
        if (/[*?[\]]/.test(target)) continue;
        const clean = target.replace(/\/+$/, "");
        candidates.push({
            pkg: name,
            entry,
            // Sent to git verbatim, trailing slash included (see gitIgnoredSet).
            // Built from the registry's repo-relative dir so it stays correct once
            // ARCHI S10 nests packages one level deeper.
            query: `${pkgEntry.dir}/${target}`,
            rel: `${pkgEntry.dir}/${clean}`,
            abs: path.join(pkgEntry.absDir, clean),
        });
    }
}

const ignored = gitIgnoredSet(candidates.map((c) => c.query));
const missing = candidates.filter((c) => !ignored.has(c.query) && !fs.existsSync(c.abs));

// ⚠️ Les deux checks rapportent AVANT de sortir, et le script ne sort qu'une fois, tout
// en bas. Le check 1 faisait `process.exit(1)` sur place : le check 2 était alors
// INATTEIGNABLE dès qu'une entrée manquait, c'est-à-dire qu'un `files[]` fautif masquait
// un artefact embarqué. Trouvé en posant le check 2 — `probe-gate-visibility` restait
// rouge parce que la sonde porte un défaut de check 1 par construction, et le check 2
// n'avait jamais l'occasion de parler.
if (missing.length > 0) {
    console.error("ERROR [PKG-FILES]: package.json declares files[] entries that do not exist:");
    for (const { entry, rel } of missing) {
        // `rel` porte déjà le répertoire du registre. L'étiquette, elle, préfixait
        // `packages/` + dirName en dur — donc `packages/storage/package.json` pour un
        // paquet vivant en `packages/plugins/offline-ui/`. Chemin faux, non cliquable, et
        // invisible à la sonde dont l'aiguille apparaît dans les deux formes (T4.3).
        console.error(
            `  ${path.posix.dirname(rel)}/package.json — files[] "${entry}" → ${rel} not found`
        );
    }
    console.error("");
    console.error("npm drops these silently: the package publishes without them.");
}

// ─── PKG-FILES 2 (T4.3) — `files[]` n'embarque aucun répertoire d'artefact ────
//
// npm N'APPLIQUE PAS le `.gitignore` de la racine à l'intérieur d'un répertoire listé
// dans `files[]`. Tracé dans npm-packlist@8 → ignore-walk : chaque entrée de `files[]`
// devient une règle inversée (`!docs`, `!docs/**`) injectée sous le nom `package.json`,
// et les jeux sont évalués dans l'ordre `[defaultRules, package.json, .npmignore,
// .gitignore]` avec la DERNIÈRE règle correspondante gagnante. Le `.gitignore` racine
// est bien réinjecté, mais dans `defaultRules` — donc AVANT, donc écrasé. (C'est aussi
// pourquoi `dist/`, gitignoré, part bel et bien dans le tarball.)
//
// Conséquence : gitignorer un artefact ne le retire pas du paquet npm. La seule
// exclusion qui fonctionne est une NÉGATION dans `files[]`, placée APRÈS l'entrée qui la
// couvre. C'est cet invariant-là que ce check garde — statiquement, sans `npm pack`,
// donc sondable sans `npm install`.
//
// Périmètre = union de deux moitiés qui se compensent :
//   • les sorties DÉCLARÉES par un producteur (`typedoc.json` → `out`), vivantes même
//     sur un clone frais où rien n'a encore été généré ;
//   • les racines d'artefact présentes SUR DISQUE, qui couvrent ce qu'aucun JSON ne
//     déclare (`docs/public` sort de constantes JS de `deploy-docs.cjs`).

/** Les racines d'artefact d'un package : déclarées par un producteur, ou vues sur disque. */
function artifactRootsOf(pkgEntry) {
    const roots = new Set();
    for (const d of declaredOutputs()) {
        if (d.rel && d.rel.startsWith(`${pkgEntry.dir}/`)) roots.add(d.rel);
    }
    const walk = (abs, rel, depth) => {
        if (depth > 4 || !fs.existsSync(abs)) return;
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
            if (!e.isDirectory() || e.name === "node_modules") continue;
            const childRel = `${rel}/${e.name}`;
            const hit = generatedRootOf(childRel);
            if (hit && hit.root === childRel) roots.add(childRel);
            else walk(path.join(abs, e.name), childRel, depth + 1);
        }
    };
    walk(pkgEntry.absDir, pkgEntry.dir, 0);
    return [...roots];
}

const shipped = [];
for (const { pkgEntry, files } of filesByPkg) {
    for (const root of artifactRootsOf(pkgEntry)) {
        // Dernière règle gagnante : on cherche l'index de la dernière entrée qui
        // COUVRE cette racine, positive ou niée. Une négation placée avant l'entrée
        // qu'elle prétend corriger ne retire rien — npm publierait quand même.
        let coveredBy = -1;
        let negated = false;
        files.forEach((entry, i) => {
            if (typeof entry !== "string" || entry.length === 0) return;
            const isNeg = entry.startsWith("!");
            const target = (isNeg ? entry.slice(1) : entry).replace(/\/+$/, "");
            const abs = `${pkgEntry.dir}/${target}`;
            if (root === abs || root.startsWith(`${abs}/`)) {
                coveredBy = i;
                negated = isNeg;
            }
        });
        if (coveredBy >= 0 && !negated) {
            shipped.push({ pkgEntry, entry: files[coveredBy], root });
        }
    }
}

if (shipped.length > 0) {
    console.error("ERROR [PKG-FILES]: files[] ships GENERATED artifact directories:");
    for (const { pkgEntry, entry, root } of shipped) {
        console.error(`  ${pkgEntry.dir}/package.json — files[] "${entry}" embarque ${root}`);
    }
    console.error("");
    console.error('Ajouter une négation APRÈS l\'entrée qui la couvre, ex. "!docs/api/".');
    console.error(
        "Gitignorer ne suffit PAS : npm ignore le .gitignore dans un répertoire de files[]."
    );
}

// ─── PKG-FILES 3 (B-212/cartes du core, 10/08/2026) — une NÉGATION GLOBÉE doit retirer ──
//
// Le check 1 saute délibérément toute entrée globée (`:74`) : un glob ne se valide pas par
// existence, npm l'étend au moment du pack. Correct pour une entrée POSITIVE — `dist/**/*.js`
// qui ne matche rien ne fait qu'expédier moins. Faux pour une entrée NIÉE, et c'est la
// dissymétrie que ce check ferme.
//
// Une négation globée qui cesse de matcher **ne dit rien et ne retire rien** : le fichier
// qu'elle devait exclure retourne dans le tarball, la gate reste verte, et on ne le sait
// qu'en dépaquetant. C'est mot pour mot la classe que `CLAUDE.md` décrit pour les chemins
// codés en dur — « il cesse silencieusement de matcher, et la gate sort verte en n'ayant
// rien scanné ». Le dépôt n'avait aucune négation globée avant le 10/08/2026 ; la première
// (`!dist/**\/*.js.map` du core, qui retire 6 cartes de 872 Ko) est arrivée dans un angle
// mort, pas dans un filet.
//
// ⚠️ Le convertisseur ne couvre qu'un SOUS-ENSEMBLE de la syntaxe, et il REFUSE le reste
// plutôt que de le laisser passer. Accepter en silence une classe (`[abc]`, `{a,b}`) qu'il
// ne sait pas traduire produirait exactement le vert-sans-mesure qu'il existe pour empêcher.
//
// 🛑 CE QU'IL NE GARDE PAS, mesuré le jour de sa pose et écrit ici pour qu'on ne le lui
// prête pas. Vu rouge sur trois mutations (extension fautive, répertoire déplacé, syntaxe
// non supportée) et VERT sur celle qui compte le plus : **retirer la négation entièrement**.
// Il juge les négations PRÉSENTES, jamais l'absence d'une négation attendue — il ne peut
// pas, sans coder en dur la politique d'expédition de chaque paquet. Un `!…` supprimé
// remet donc 872 Ko de cartes dans le tarball du core sans un mot d'ici ; ce qui le voit
// est `npm pack --dry-run`, et le motif est au backlog. Une garde vue rouge sur une
// mutation peut rester creuse pour une autre : celle-ci l'est, et la limite est nommée.
const GLOB_SUPPORTED = /^[A-Za-z0-9_./*?-]+$/;

/**
 * Un glob de `files[]` en RegExp ancrée, sur le sous-ensemble supporté.
 * @param {string} glob Motif relatif au paquet, séparateurs POSIX, sans `!` de tête.
 * @returns {RegExp} Expression ancrée sur un chemin relatif au paquet.
 */
function globToRegExp(glob) {
    let re = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                // `**/` traverse zéro ou plusieurs segments ; `**` seul, le reste du chemin.
                if (glob[i + 2] === "/") {
                    re += "(?:[^/]+/)*";
                    i += 2;
                } else {
                    re += ".*";
                    i += 1;
                }
            } else {
                re += "[^/]*";
            }
        } else if (c === "?") re += "[^/]";
        else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
}

/** Tous les fichiers d'un paquet, relatifs à sa racine, `node_modules/` exclu. */
function filesUnder(absDir) {
    /** @type {string[]} */
    const out = [];
    const walk = (dir, rel) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_e) {
            return;
        }
        for (const e of entries) {
            if (e.name === "node_modules" || e.name === ".git") continue;
            const next = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(dir, e.name), next);
            else out.push(next);
        }
    };
    walk(absDir, "");
    return out;
}

/** @type {{pkg: string, entry: string, why: string}[]} */
const inertNegations = [];
let negatedGlobsChecked = 0;
let negatedGlobHits = 0;

for (const { pkgEntry, files } of filesByPkg) {
    /** @type {string[]|null} */
    let corpus = null;
    for (const entry of files) {
        if (typeof entry !== "string" || !entry.startsWith("!")) continue;
        const target = entry.slice(1);
        if (!/[*?[\]{}]/.test(target)) continue; // non globée — le check 1 s'en charge
        negatedGlobsChecked += 1;
        if (!GLOB_SUPPORTED.test(target)) {
            inertNegations.push({
                pkg: pkgEntry.dir,
                entry,
                why: "syntaxe hors du sous-ensemble supporté — ce check REFUSE de conclure plutôt que de sortir vert sans avoir mesuré",
            });
            continue;
        }
        if (corpus == null) corpus = filesUnder(pkgEntry.absDir);
        const re = globToRegExp(target);
        const hits = corpus.filter((f) => re.test(f));
        negatedGlobHits += hits.length;
        if (hits.length === 0) {
            inertNegations.push({
                pkg: pkgEntry.dir,
                entry,
                why: "ne matche AUCUN fichier sur le disque — l'exclusion est inerte, le tarball emporte ce qu'elle prétend retirer",
            });
        }
    }
}

if (inertNegations.length > 0) {
    console.error("ERROR [PKG-FILES]: négation globée qui ne retire rien :");
    for (const { pkg, entry, why } of inertNegations) {
        console.error(`  ${pkg}/package.json — files[] "${entry}" : ${why}`);
    }
    console.error("");
    console.error("Une négation qui ne matche rien est indiscernable d'une négation absente.");
    console.error("Vérifier par `npm pack --dry-run -w <paquet>` ce que le tarball emporte.");
}

if (missing.length > 0 || shipped.length > 0 || inertNegations.length > 0) {
    process.exit(1);
}

const checked = candidates.length - ignored.size;
console.log(
    `✅ [PKG-FILES] ${checked} files[] entries exist across ${packages.length} packages ` +
        `(${ignored.size} build outputs skipped), 0 generated artifact shipped, ` +
        `${negatedGlobsChecked} négation(s) globée(s) retirant ${negatedGlobHits} fichier(s).`
);
process.exit(0);
