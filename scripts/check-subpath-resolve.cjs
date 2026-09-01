#!/usr/bin/env node
/**
 * Gate: does every `exports` subpath of every workspace actually resolve?
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
 * by a root `index.d.ts` nothing ever mounted, and the `ValidatorsAPI: void` declarations
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
 * ## ⚠️ Why "the same SET" and not "the same COUNT"
 *
 * The first version compared COUNTS. It held until the day four files were deleted
 * under `capabilities/`, three of which carried runtime: the tally flipped and the
 * gate announced "1 ghost".
 *
 * There were **32**. The `./capabilities/*` glob carries TWO asymmetries of opposite
 * sign, which almost cancelled out:
 *
 *   • 16 **type-only** modules (`*-types.d.ts`, `types.d.ts`) — a `.d.ts` without a
 *     `.js`. EXACTLY the defect this gate exists to catch: a VALUE import
 *     type-checks then throws `ERR_MODULE_NOT_FOUND`.
 *   • 17 **CSS** modules — a `.js` without a `.d.ts`, because a stylesheet turned
 *     module carries no declarations. Legitimate, and now recognized by a
 *     structural RULE (the stem ends in `.css`), not a nominative exemption.
 *
 * A counter cannot tell these two classes apart: it adds them with opposite signs.
 * The set comparison names them. The price is that the gate now tells the truth, and
 * the truth is bigger than what it announced — the 16 real ghosts are frozen in
 * `check-subpath-resolve.baseline.json`, a RATCHET that can only shrink.
 *
 * Rule 3 is not paranoia, it is this gate's own history: the prototype written during the audit
 * used `pkg.dir` (relative) instead of `pkg.absDir`, and when run from another cwd it resolved
 * nothing and reported success — the exact failure mode `probe-gate-visibility.cjs` exists to
 * catch. A gate that can pass without measuring anything is not a gate.
 *
 * ## ⚠️ Rule 0 — FRESHNESS: this gate refuses to measure a stale `dist/`
 *
 * Everything above reads from `dist/`, never `src/` — correctly, since the `exports`
 * map speaks of `dist/`. But that made the gate **green IN BOTH DIRECTIONS** as soon
 * as a build was missing, and both detections fell **together**:
 *
 *   • it found the STALE `.d.ts` back, hence marked the baseline entry "seen" — no
 *     ratchet;
 *   • it did not see the NEW ghost — no failure.
 *
 * No signal, in any direction. Measured on 2026-08-09: with a type-only source
 * planted in `capabilities/` and zero trace in `dist/`, the gate announced "130
 * targets resolve […] no asymmetry" and exited 0, on a `dist/` 26 minutes older than
 * `src/`.
 *
 * **The retained move adds no truth, it refuses to invent one**: if `src/`'s newest
 * file postdates the newest of the outputs, we exit failing with "blind, not green" —
 * the pattern this file already uses in rule 3. Resolving from `src/` was considered
 * and discarded: it would change what the gate ASSERTS, since `exports` does not
 * speak of `src/`.
 *
 * The output roots are **derived from the `exports` map itself** (first segment of
 * each relative target), never hard-written: a package emitting elsewhere than
 * `dist/` would stay covered, and a hard-coded path would silently stop matching —
 * the class `probe-gate-visibility.cjs` watches.
 *
 * 🛑 This rule assumes the build PRECEDES the gate. It does on both sides:
 * `ci-local.cjs` runs "Build (turbo)" well before it, and `ci.yml` does
 * `turbo run build` at the head of the same job. The gate is NOT in the `pre-commit`
 * hook, where `lint-staged` reformats sources mid-flight and would redden on a hook
 * artifact.
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
 * What a target resolves, as a SET of stems (what `*` captures) and not a count.
 *
 * An `exports` `*` crosses `/`, so the glob is matched against the whole published
 * tree, not a flat directory. For a `*`-less target, the stem is the empty string:
 * two non-glob targets then compare on their mere existence, the intended behaviour.
 *
 * @returns {Set<string>|null} the stems, or `null` for an external specifier (out of
 *   our remit: we do not verify someone else's disk).
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
 * A stylesheet turned module carries no declarations: `.js` without `.d.ts` is its
 * NORMAL shape, not a drift.
 *
 * A structural rule and not a list: it holds for every `.css` present and to come,
 * where a nominative exemption would have had to be lengthened at every new sheet —
 * and an exemption lengthened by routine stops being read.
 */
const isStyleModule = (stem) => stem.endsWith(".css");

/**
 * The date of the newest file under `dir`, or `null` if the directory is absent or
 * empty.
 *
 * DIRECTORIES are deliberately ignored: their mtime moves at every entry creation or
 * deletion, including for a temporary file that never changed any code. We would no
 * longer compare source states but traces of passage.
 *
 * @param {string} dir Absolute directory.
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
 * A package's output roots, DERIVED from its `exports` map.
 *
 * First segment of each relative target — `./dist/types/x.d.ts` → `dist`. Only
 * segments that are existing directories are kept, which sets `./package.json` aside
 * without naming it.
 *
 * @param {object} exportsMap The `package.json#exports` value.
 * @param {string} absDir The package's absolute directory.
 * @returns {string[]} Directory names, sorted.
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
 * Rule 0 — refuse to measure a `dist/` older than `src/`.
 *
 * @param {object[]} pkgs Packages carrying an `exports` map.
 * @returns {string[]} One message per stale package; empty if everything is fresh.
 */
function stalePackages(pkgs) {
    const stale = [];
    for (const pkg of pkgs) {
        const srcDir = path.join(pkg.absDir, "src");
        if (!fs.existsSync(srcDir)) continue; // package without sources here — nothing to compare
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

/** The known ghosts, frozen. Ratchet: this list can only SHRINK. */
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

    // 0. FRESHNESS — before any measurement. A stale `dist/` makes this gate green
    //    IN BOTH DIRECTIONS: it finds the previous `.d.ts` back, hence marks the
    //    baseline "seen", and does not see the new ghost. No signal, either way.
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
                // Several runtime conditions (`import`, `default`) designate the
                // same module: we keep the union, not the last read.
                const acc = stems.get(kind) ?? new Set();
                for (const s of set) acc.add(s);
                stems.set(kind, acc);
            }

            // 2. SYMMETRY — sets, not counts. Two classes, of different gravity.
            const T = stems.get("types");
            const R = stems.get("runtime");
            if (T === undefined || R === undefined) continue;

            // (a) GHOSTS — `.d.ts` without `.js`. A VALUE import type-checks then
            //     throws ERR_MODULE_NOT_FOUND. The defect this gate was born from.
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

            // (b) UNTYPED — `.js` without `.d.ts`. The import works, the integrator
            //     reaps a TS7016. A stylesheet is exempt by RULE, not by list.
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

    // 4. RATCHET — a baseline entry gone true must LEAVE. Otherwise the list
    //    fossilizes: it would describe a repaired defect, and the next reader would
    //    believe it remains to repair. The EM-02 and GLB-02 pattern.
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
