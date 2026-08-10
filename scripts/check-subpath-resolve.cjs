#!/usr/bin/env node
/**
 * Gate: does every `exports` subpath of every workspace actually resolve? (API S2)
 *
 * ## Why this exists
 *
 * `verify-published-types.cjs` checks that a `types` condition **exists** in the `exports` map and
 * that its target is on disk. It never looks at the `import`/`default` branch. That blind spot is
 * not theoretical — the API audit of 24/07/2026 found `@geoleaf/core` shipping **13 subpaths whose
 * `.d.ts` resolved and whose `.js` did not**:
 *
 *     "./facades/*": { "types": "./dist/types/api/geoleaf.*.d.ts",   // 28 files → resolved
 *                      "import": "./dist/esm/api/geoleaf.*.js" }     // 15 files → 13 missing
 *
 * Rollup's `preserveModules` elides a module that is nothing but a re-export shell — correctly, it
 * has no code to emit. But the glob in `exports` kept advertising all 28. The consequence is the
 * worst shape a packaging bug can take: `import { Core } from "@geoleaf/core/facades/core.js"`
 * **type-checks**, then throws `ERR_MODULE_NOT_FOUND` at run time. TypeScript actively vouches for
 * a module the bundle does not contain.
 *
 * This is the same "ghost API" class the repo has fought twice before — `GeoLeaf.Events` declared
 * by a root `index.d.ts` nothing ever mounted (S13.7), and the `ValidatorsAPI: void` declarations
 * (S10). Both times the `.d.ts` asserted a surface the bundle did not have. Here it came back
 * through packaging, where no gate was watching.
 *
 * ## What it checks
 *
 *   1. **RESOLVE** — every non-glob target in every `exports` map exists on disk.
 *   2. **SYMMETRY** — for a given subpath, the `types` branch and the runtime branch must resolve
 *      the *same set* of files. Type-only subpaths (a `types` condition with no runtime
 *      condition) are exempt by construction: they declare types and promise no module.
 *   3. **NON-VACUITY** — the gate fails if it scanned zero packages or zero targets.
 *
 * ## ⚠️ Pourquoi « le même ENSEMBLE » et non « le même NOMBRE » (API publique S4.6b)
 *
 * La première version comparait des COMPTES. Elle a tenu jusqu'au jour où l'on a supprimé, sous
 * `capabilities/`, quatre fichiers dont trois portaient du runtime : le décompte a basculé et la
 * gate a annoncé « 1 fantôme ».
 *
 * Il y en avait **32**. Le glob `./capabilities/*` porte DEUX asymétries de sens opposé, qui
 * s'annulaient presque :
 *
 *   • 16 modules **type-only** (`*-types.d.ts`, `types.d.ts`) — un `.d.ts` sans `.js`. C'est
 *     EXACTEMENT le défaut que cette gate existe pour attraper : un import de VALEUR type-checke
 *     puis lève `ERR_MODULE_NOT_FOUND`.
 *   • 17 modules **CSS** — un `.js` sans `.d.ts`, parce qu'une feuille de style transformée en
 *     module ne porte pas de déclarations. Légitime, et désormais reconnu par une RÈGLE
 *     structurelle (le stem finit par `.css`), pas par une exemption nominative.
 *
 * Un compteur ne peut pas distinguer ces deux classes : il les additionne avec un signe opposé.
 * La comparaison d'ensembles les nomme. Le prix est que la gate dit maintenant la vérité, et la
 * vérité est plus grande que ce qu'elle annonçait — les 16 fantômes réels sont figés dans
 * `check-subpath-resolve.baseline.json`, un CLIQUET qui ne peut que rétrécir.
 *
 * Rule 3 is not paranoia, it is this gate's own history: the prototype written during the audit
 * used `pkg.dir` (relative) instead of `pkg.absDir`, and when run from another cwd it resolved
 * nothing and reported success — the exact failure mode `probe-gate-visibility.cjs` exists to
 * catch. A gate that can pass without measuring anything is not a gate.
 *
 * ## ⚠️ Règle 0 — FRAÎCHEUR : cette gate refuse de mesurer un `dist/` périmé (B-25)
 *
 * Tout ce qui précède se lit dans `dist/`, jamais dans `src/` — c'est correct, puisque la carte
 * `exports` parle de `dist/`. Mais ça rendait la gate **verte DANS LES DEUX SENS** dès qu'un
 * build manquait, et les deux détections tombaient **ensemble** :
 *
 *   • elle retrouvait le `.d.ts` PÉRIMÉ, donc marquait l'entrée de baseline « vue » — pas de
 *     cliquet ;
 *   • elle ne voyait pas le fantôme NEUF — pas d'échec.
 *
 * Aucun signal, dans aucune direction. Mesuré le 09/08/2026 : avec une source type-only plantée
 * dans `capabilities/` et zéro trace dans `dist/`, la gate annonçait « 130 cibles résolvent […]
 * aucune asymétrie » et sortait 0, sur un `dist/` de 26 minutes plus vieux que `src/`.
 *
 * **Le geste retenu n'ajoute aucune vérité, il refuse d'en inventer une** : si le fichier le plus
 * récent de `src/` est postérieur au plus récent des sorties, on sort en échec avec « aveugle,
 * pas verte » — le patron que ce fichier emploie déjà en règle 3. Résoudre depuis `src/` avait été
 * envisagé et écarté : ça changerait ce que la gate AFFIRME, puisque `exports` ne parle pas de
 * `src/`.
 *
 * Les racines de sortie sont **dérivées de la carte `exports` elle-même** (premier segment de
 * chaque cible relative), jamais écrites en dur : un paquet qui émettrait ailleurs que dans
 * `dist/` resterait couvert, et un chemin en dur cesserait silencieusement de matcher — la classe
 * que `probe-gate-visibility.cjs` surveille.
 *
 * 🛑 Cette règle suppose que le build PRÉCÈDE la gate. C'est le cas des deux côtés :
 * `ci-local.cjs` lance « Build (turbo) » bien avant elle, et `ci.yml` fait `turbo run build` en
 * tête du même job. La gate n'est PAS dans le hook `pre-commit`, où `lint-staged` reformate les
 * sources en cours de route (B-27) et ferait rougir sur un artefact de hook.
 */

const fs = require("fs");
const path = require("path");
const packages = require("./lib/packages.cjs");

const C = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

/** Conditions that promise a loadable module (as opposed to declarations). */
const RUNTIME_CONDITIONS = new Set(["import", "require", "default", "node", "browser"]);

/** Walks a directory tree, returning every file path relative to `root`. */
function walk(dir, root, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs, root, acc);
        else acc.push(path.relative(root, abs).split(path.sep).join("/"));
    }
    return acc;
}

/**
 * Flattens an `exports` value into `{ condition, target }` pairs.
 * Nested condition objects inherit the innermost condition name.
 */
function flatten(value, condition, acc = []) {
    if (typeof value === "string") acc.push({ condition, target: value });
    else if (value && typeof value === "object")
        for (const [key, nested] of Object.entries(value)) flatten(nested, key, acc);
    return acc;
}

/**
 * Ce qu'une cible résout, en ENSEMBLE de stems (ce que `*` capture) et non en compte.
 *
 * Un `*` d'`exports` traverse les `/`, donc le glob est matché contre tout l'arbre publié, pas
 * contre un répertoire plat. Pour une cible sans `*`, le stem est la chaîne vide : deux cibles
 * non-glob se comparent alors sur leur seule existence, ce qui est le comportement voulu.
 *
 * @returns {Set<string>|null} les stems, ou `null` pour un specifier externe (hors de notre
 *   ressort : on ne vérifie pas le disque d'autrui).
 */
function matchStems(target, absDir, treeCache) {
    if (!target.startsWith(".")) return null; // external / bare specifier — not ours to check
    const rel = target.replace(/^\.\//, "");
    if (!rel.includes("*")) {
        return fs.existsSync(path.join(absDir, rel)) ? new Set([""]) : new Set();
    }
    const [prefix, suffix] = rel.split("*");
    if (!treeCache.has(absDir)) treeCache.set(absDir, walk(absDir, absDir));
    return new Set(
        treeCache
            .get(absDir)
            .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
            .map((f) => f.slice(prefix.length, f.length - suffix.length))
    );
}

/**
 * Une feuille de style transformée en module ne porte pas de déclarations : `.js` sans `.d.ts`
 * est sa forme NORMALE, pas une dérive.
 *
 * C'est une règle structurelle et non une liste : elle vaut pour tout `.css` présent et à venir,
 * là où une exemption nominative aurait dû être allongée à chaque nouvelle feuille — et une
 * exemption qu'on allonge par routine cesse d'être lue.
 */
const isStyleModule = (stem) => stem.endsWith(".css");

/**
 * La date du fichier le plus récent sous `dir`, ou `null` si le répertoire est absent ou vide.
 *
 * Les RÉPERTOIRES sont délibérément ignorés : leur mtime bouge à chaque création ou suppression
 * d'entrée, y compris pour un fichier temporaire qui n'a jamais rien changé au code. On ne
 * comparerait plus des états de source mais des traces de passage.
 *
 * @param {string} dir Répertoire absolu.
 * @returns {{mtime: number, file: string}|null}
 */
function newestFile(dir) {
    if (!fs.existsSync(dir)) return null;
    let best = null;
    for (const rel of walk(dir, dir)) {
        const { mtimeMs } = fs.statSync(path.join(dir, rel));
        if (best === null || mtimeMs > best.mtime) best = { mtime: mtimeMs, file: rel };
    }
    return best;
}

/**
 * Les racines de sortie d'un paquet, DÉRIVÉES de sa carte `exports`.
 *
 * Premier segment de chaque cible relative — `./dist/types/x.d.ts` → `dist`. Seuls les segments
 * qui sont des répertoires existants sont retenus, ce qui écarte `./package.json` sans avoir à le
 * nommer.
 *
 * @param {object} exportsMap La valeur de `package.json#exports`.
 * @param {string} absDir Répertoire absolu du paquet.
 * @returns {string[]} Noms de répertoires, triés.
 */
function outputRoots(exportsMap, absDir) {
    const roots = new Set();
    for (const value of Object.values(exportsMap)) {
        for (const { target } of flatten(value, "default")) {
            if (typeof target !== "string" || !target.startsWith("./")) continue;
            const first = target.slice(2).split("/")[0];
            if (!first) continue;
            const abs = path.join(absDir, first);
            if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) roots.add(first);
        }
    }
    return [...roots].sort();
}

/**
 * Règle 0 — refuser de mesurer un `dist/` plus vieux que `src/` (B-25).
 *
 * @param {object[]} pkgs Paquets portant une carte `exports`.
 * @returns {string[]} Un message par paquet périmé ; vide si tout est frais.
 */
function stalePackages(pkgs) {
    const stale = [];
    for (const pkg of pkgs) {
        const srcDir = path.join(pkg.absDir, "src");
        if (!fs.existsSync(srcDir)) continue; // paquet sans sources ici — rien à comparer
        const newestSrc = newestFile(srcDir);
        if (newestSrc === null) continue;

        const roots = outputRoots(pkg.manifest.exports, pkg.absDir);
        if (roots.length === 0) {
            stale.push(
                `${pkg.name} — aucune racine de sortie n'existe sur le disque ; le paquet n'a jamais été construit.`
            );
            continue;
        }

        let newestOut = null;
        for (const root of roots) {
            const cand = newestFile(path.join(pkg.absDir, root));
            if (cand && (newestOut === null || cand.mtime > newestOut.mtime)) newestOut = cand;
        }
        if (newestOut === null) {
            stale.push(`${pkg.name} — ${roots.join(", ")} est vide ; rien à mesurer.`);
            continue;
        }
        if (newestSrc.mtime > newestOut.mtime) {
            const delta = Math.round((newestSrc.mtime - newestOut.mtime) / 1000);
            stale.push(
                `${pkg.name} — src/${newestSrc.file} est postérieur de ${delta} s au plus récent de ${roots.join(", ")}/.`
            );
        }
    }
    return stale;
}

const BASELINE_PATH = path.join(__dirname, "check-subpath-resolve.baseline.json");

/** Les fantômes connus, figés. Cliquet : cette liste ne peut que RÉTRÉCIR. */
function loadBaseline() {
    try {
        return new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).phantoms ?? []);
    } catch {
        return new Set();
    }
}

function checkSubpathResolve() {
    const ok = (m) => console.log(`${C.green}✓${C.reset}  ${m}`);
    const err = (m) => console.error(`${C.red}✗${C.reset}  ${m}`);
    const dim = (m) => console.log(`${C.dim}   ${m}${C.reset}`);

    const failures = [];
    let scannedPackages = 0;
    let scannedTargets = 0;
    const treeCache = new Map();
    const baseline = loadBaseline();
    const seenBaseline = new Set();

    const withExports = packages
        .all()
        .filter((p) => p.manifest && p.manifest.exports && typeof p.manifest.exports === "object");

    // 0. FRAÎCHEUR — avant toute mesure. Un `dist/` périmé rend cette gate verte DANS LES DEUX
    //    SENS (B-25) : elle retrouve le `.d.ts` d'avant, donc marque la baseline « vue », et ne
    //    voit pas le fantôme neuf. Aucun signal, dans aucune direction.
    const staleBuilds = stalePackages(withExports);
    if (staleBuilds.length) {
        err(`${staleBuilds.length} paquet(s) ont un \`dist/\` plus ancien que leurs sources :`);
        console.log("");
        for (const s of staleBuilds) dim(s);
        console.log("");
        dim("Cette gate lit `dist/`, jamais `src/`. Sur un `dist/` périmé elle retrouve le");
        dim("`.d.ts` d'AVANT — donc elle marque la baseline « vue » ET rate le fantôme neuf.");
        dim("Les deux détections tombent ensemble : elle serait verte sans avoir rien gardé.");
        dim("Elle est donc AVEUGLE, pas verte. Reconstruire (`npx turbo run build`) et relancer.");
        return false;
    }

    for (const pkg of withExports) {
        const exportsMap = pkg.manifest.exports;
        scannedPackages++;

        for (const [subpath, value] of Object.entries(exportsMap)) {
            const pairs = flatten(value, "default");
            const stems = new Map();

            for (const { condition, target } of pairs) {
                const set = matchStems(target, pkg.absDir, treeCache);
                if (set === null) continue;
                scannedTargets++;

                // 1. RESOLVE
                if (set.size === 0)
                    failures.push(
                        `${pkg.name}  ${subpath}  [${condition}]  →  ${target}  ${C.dim}(résout 0 fichier)${C.reset}`
                    );

                const kind =
                    condition === "types"
                        ? "types"
                        : RUNTIME_CONDITIONS.has(condition)
                          ? "runtime"
                          : null;
                if (!kind) continue;
                // Plusieurs conditions runtime (`import`, `default`) désignent le même module :
                // on garde l'union, pas la dernière lue.
                const acc = stems.get(kind) ?? new Set();
                for (const s of set) acc.add(s);
                stems.set(kind, acc);
            }

            // 2. SYMMETRY — ensembles, pas comptes. Deux classes, de gravité différente.
            const T = stems.get("types");
            const R = stems.get("runtime");
            if (T === undefined || R === undefined) continue;

            // (a) FANTÔMES — `.d.ts` sans `.js`. Un import de VALEUR type-checke puis lève
            //     ERR_MODULE_NOT_FOUND. C'est le défaut qui a fait naître cette gate.
            for (const stem of [...T].filter((s) => !R.has(s)).sort()) {
                const key = `${pkg.name}${subpath.slice(1)}${stem}`;
                if (baseline.has(key)) {
                    seenBaseline.add(key);
                    continue;
                }
                failures.push(
                    `${pkg.name}  ${subpath}  ${C.dim}FANTÔME — \`${stem}\` a des types, pas de module${C.reset}`
                );
            }

            // (b) NON TYPÉS — `.js` sans `.d.ts`. L'import marche, l'intégrateur récolte un
            //     TS7016. Une feuille de style est exemptée par RÈGLE, pas par liste.
            for (const stem of [...R].filter((s) => !T.has(s) && !isStyleModule(s)).sort()) {
                failures.push(
                    `${pkg.name}  ${subpath}  ${C.dim}NON TYPÉ — \`${stem}\` a un module, pas de types${C.reset}`
                );
            }
        }
    }

    // 3. NON-VACUITY
    if (scannedPackages === 0 || scannedTargets === 0) {
        err(
            `SUBPATH-RESOLVE n'a rien mesuré (${scannedPackages} paquet(s), ${scannedTargets} cible(s)) — la gate est aveugle, pas verte.`
        );
        return false;
    }

    // 4. CLIQUET — une entrée de baseline devenue vraie doit SORTIR. Sans ça, la liste
    //    fossilise : elle décrirait un défaut réparé, et le prochain lecteur croirait qu'il
    //    reste à réparer. C'est le patron d'EM-02 et de GLB-02.
    const stale = [...baseline].filter((k) => !seenBaseline.has(k)).sort();
    if (stale.length) {
        err(`${stale.length} entrée(s) de baseline ne sont plus vraies :`);
        for (const s of stale) dim(`${s} — n'est plus un fantôme`);
        console.log("");
        dim("La baseline est un registre de dette, pas un droit acquis : elle ne peut que");
        dim("rétrécir. Retirez ces entrées de check-subpath-resolve.baseline.json.");
        return false;
    }

    if (failures.length) {
        err(`${failures.length} sous-chemin(s) public(s) ne tiennent pas leur promesse :`);
        console.log("");
        for (const f of failures) dim(f);
        console.log("");
        dim("Un subpath dont les types résolvent et pas le runtime type-checke puis lève");
        dim("ERR_MODULE_NOT_FOUND. Soit la cible est émise, soit le subpath est retiré.");
        return false;
    }

    ok(
        `${scannedTargets} cibles \`exports\` résolvent sur ${scannedPackages} paquets ; aucune asymétrie types/runtime.`
    );
    return true;
}

if (require.main === module) {
    console.log(`\n${C.cyan}── 🔗 Résolution des sous-chemins publics ──${C.reset}\n`);
    process.exitCode = checkSubpathResolve() ? 0 : 1;
}

module.exports = { checkSubpathResolve };
