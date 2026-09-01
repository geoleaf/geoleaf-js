#!/usr/bin/env node
/**
 * IMPL: the dependencies the repo LOADS without IMPORTING are declared, and the
 * declared copy really is the one that executes.
 *
 * ## Why this gate exists — the blind-spot class no other sees
 *
 * All the repo's dependency guards start from an import:
 *
 *   - `check-shipped-specifiers.cjs` (SHIP-SPEC-01) reads the bare specifiers of the
 *     published package's REACHABLE files — hence code, hence `import`/`require`;
 *   - `knip` (`unlisted` category) reads the sources' module graph.
 *
 * One class remains that neither can see: a package the repo loads **without ever
 * importing it**. Two cases measured on 2026-08-15:
 *
 *   - `happy-dom` — named by a STRING (`environment: "happy-dom"` in
 *     14 `vitest.config.ts`). Vitest is what imports it, from its own `dist/`;
 *   - `tsx` — injected into `NODE_OPTIONS` by `ensure-tsx-node-options.mjs`. A
 *     command-line option, not a module-graph edge.
 *
 * Neither was declared by what loads it. Both were present at the root as
 * **auto-installed optional peerDependencies** (`vitest → happy-dom: "*"`,
 * `vite → tsx`) — a property nobody asked for. `npm ci` under Node 22's npm (10.9.x)
 * carried it forward; a recomputation under npm ≥ 11 removed it, and the whole test
 * suite died on "Cannot find package 'tsx'". Yet **only `publish.yml` climbs to
 * npm ≥ 11** (trusted-publishing requirement): `ci.yml` like `ci:local` are
 * structurally blind to this defect.
 *
 * ## The second, quieter defect: DECLARED ≠ EXECUTED
 *
 * 14 packages declared `happy-dom: "^20.11.2"` and each received a nested copy at
 * 20.11.2. **None was ever loaded.** `environment: "happy-dom"` is a Vitest
 * *builtin* environment, which does `await import('happy-dom')` from
 * `vitest/dist/` — resolution thus starts there and always reaches the ROOT, which
 * carried 20.9.0. Fourteen decorative declarations, and two minors of gap between
 * the announced version and the one that runs.
 *
 * That gap is not cosmetic: happy-dom ≥ 20.11 sets `window.OffscreenCanvas`, which
 * 20.9 does not. Two production `typeof OffscreenCanvas !== "undefined"` thus
 * flipped onto a surface whose `getContext("2d")` returns `null`. The day anything
 * aligned the root, 8 `cog` tests and the core's hatch rendering fell — without a
 * single line of code changing.
 *
 * ## What this gate does NOT do, and why
 *
 * 🛑 **It does not lean on the lockfile's `peer + optional` marker.** That was the
 * initial design ("verify-peer-hoist"), and measurement ruled it out: that marker
 * **is not stable from one npm version to the next**. Measured on 2026-08-15 on the
 * same repo —
 *
 *     npm 10.9.8   happy-dom   peer=true  optional=true
 *     npm 12.0.2   happy-dom   peer=false optional=false
 *     npm 10.9.8   @esbuild/linux-x64   peer=true  optional=true
 *     npm 12.0.2   @esbuild/linux-x64   peer=false optional=true
 *
 * — under npm 12 the "root, peer AND optional" set is **empty**. A gate built on it
 * would thus have scanned zero entries while going green: exactly the failure mode
 * this repo hunts. The marker stays swept by IMPL-03, but as a net BEFORE, never as
 * a floor.
 *
 * The foundation is elsewhere: an EXPLICIT table of the packages the tooling loads
 * without importing, each carrying its rationale and its load position. A table goes
 * stale, but it goes stale **loudly** (IMPL-04), where a marker changing semantics
 * goes stale in silence.
 *
 *   IMPL-01  each table entry is declared by at least one manifest of the repo
 *   IMPL-02  the copy resolved from the LOAD POSITION is the same as the one
 *            resolved from each declaring manifest — that is "declared = executed"
 *   IMPL-03  lock sweep: a root `peer+optional` entry without `os`/`cpu` that no
 *            manifest declares is flagged. Can legitimately see nothing (cf. above),
 *            so its tally prints and NEVER serves as a floor
 *   IMPL-04  refusal to conclude (exit 2): empty table, unreadable lock, or load
 *            position not found — an entry whose probe no longer resolves describes
 *            a mount that no longer exists
 *
 * ## Environment hooks (for `probe-gate-visibility.cjs`)
 *
 *   GEOLEAF_LOCKFILE        — target another lockfile (IMPL-03)
 *   GEOLEAF_IMPLICIT_EXTRA  — add a name to the table (IMPL-01/02), to prove the
 *                             rule on a package nothing declares
 *
 * Exit 0 = conforming · 1 = violation · 2 = the gate refuses to conclude.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const registry = require("./lib/packages.cjs");

const ROOT = registry.ROOT;

// ─── The table — a package loaded without being imported, and why ─────────────
//
// ⚠️ Each entry carries its RATIONALE and its LOAD POSITION. The rationale says why
// no static analysis can see this package; the position says where the real
// resolution starts, which is almost never the declaring package. An entry without
// both would be indistinguishable from an ordinary dependency — which knip and
// SHIP-SPEC already cover.

const IMPLICIT_TOOLCHAIN = [
    {
        name: "happy-dom",
        why:
            'Nommé par une CHAÎNE (`environment: "happy-dom"`), jamais importé. C\'est un ' +
            "environnement builtin de Vitest : il fait `await import('happy-dom')` depuis son " +
            "propre dist/, donc la copie qui s'exécute est celle résolvable depuis vitest — " +
            "jamais celle qu'un paquet déclare à côté de son vitest.config.ts.",
        loadFrom: () => path.join(path.dirname(require.resolve("vitest/package.json")), "dist"),
    },
    {
        name: "tsx",
        why:
            "Injecté dans NODE_OPTIONS par `packages/build-config/vitest/ensure-tsx-node-options.mjs`, " +
            "qui l'impose à TOUTES les suites. Une option de ligne de commande n'est pas une arête " +
            "du graphe de modules : ni knip ni SHIP-SPEC ne peuvent la voir.",
        loadFrom: () => registry.requireByDirName("build-config").absDir,
    },
];

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/**
 * A package's root directory, through Node's `node_modules` climb.
 *
 * Deliberately done by hand rather than
 * `require.resolve(name + "/package.json")`: not every package exposes
 * `./package.json` in its `exports` map, and a resolution failure would then be
 * indistinguishable from a real absence.
 *
 * @param {string} name - package name.
 * @param {string} fromDir - directory the resolution starts from.
 * @returns {string | null} real path of the package's directory, or `null`.
 */
function resolvePkgDir(name, fromDir) {
    let dir = path.resolve(fromDir);
    for (;;) {
        const candidate = path.join(dir, "node_modules", name, "package.json");
        if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** @param {string} pkgDir @returns {string} */
function versionOf(pkgDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
    } catch {
        return "?";
    }
}

/**
 * Readable path: repo-relative when inside it, ABSOLUTE otherwise.
 *
 * The probes' `GEOLEAF_LOCKFILE` lives in `/tmp`; a `path.relative` would render
 * "../../../../../tmp/…" there, which nobody re-reads. A gate message one cannot
 * read is no better than silence.
 *
 * @param {string} p
 * @returns {string}
 */
function rel(p) {
    const r = path.relative(ROOT, p);
    if (r.startsWith("..") || path.isAbsolute(r)) return p;
    return r.split(path.sep).join("/") || ".";
}

/**
 * Every manifest of the repo: the root plus each workspace.
 *
 * ⚠️ Derived from `lib/packages.cjs`, NEVER a `packages/**` glob — which would
 * capture `dist/` and `node_modules/`, and suggest declarations that are not ours.
 *
 * @returns {{name: string, dir: string, file: string, deps: Record<string, string>}[]}
 */
function allManifests() {
    const out = [];
    const rootJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    out.push({
        name: rootJson.name || "<racine>",
        dir: ROOT,
        file: "package.json",
        deps: {
            ...rootJson.dependencies,
            ...rootJson.devDependencies,
            ...rootJson.peerDependencies,
            ...rootJson.optionalDependencies,
        },
    });
    for (const pkg of registry.all()) {
        const m = pkg.manifest;
        out.push({
            name: pkg.name,
            dir: pkg.absDir,
            file: `${rel(pkg.absDir)}/package.json`,
            deps: {
                ...m.dependencies,
                ...m.devDependencies,
                ...m.peerDependencies,
                ...m.optionalDependencies,
            },
        });
    }
    return out;
}

// ─── Execution ────────────────────────────────────────────────────────────────

const problems = [];
const refuse = (code, msg) => {
    console.error(`ERROR [${code}]: ${msg}`);
    process.exit(2);
};

const table = [...IMPLICIT_TOOLCHAIN];
const extra = process.env.GEOLEAF_IMPLICIT_EXTRA;
if (extra) {
    for (const name of extra
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        table.push({
            name,
            why: "Entrée injectée par GEOLEAF_IMPLICIT_EXTRA (sonde).",
            loadFrom: () => ROOT,
        });
    }
}

// IMPL-04 — anti-empty-gate floor. Without it, an inadvertently emptied table would
// go green having verified nothing, exactly the defect the gate hunts.
if (table.length === 0) {
    refuse(
        "IMPL-04",
        "la table IMPLICIT_TOOLCHAIN est vide — rien à vérifier, donc rien à conclure."
    );
}

const manifests = allManifests();
if (manifests.length < 2) {
    refuse(
        "IMPL-04",
        `${manifests.length} manifeste(s) lu(s) — le registre des workspaces n'a rien rendu, la gate refuse de conclure.`
    );
}

// ─── IMPL-01 / IMPL-02 ────────────────────────────────────────────────────────

for (const entry of table) {
    let loadDir;
    try {
        loadDir = entry.loadFrom();
    } catch (err) {
        refuse(
            "IMPL-04",
            `position de chargement de « ${entry.name} » introuvable (${err.message}) — l'entrée décrit un montage qui n'existe plus.`
        );
    }

    const declarers = manifests.filter((m) => entry.name in m.deps);

    if (declarers.length === 0) {
        problems.push({
            code: "IMPL-01",
            lines: [
                `« ${entry.name} » est chargé par l'outillage mais AUCUN manifeste du dépôt ne le déclare.`,
                `  motif : ${entry.why}`,
                `  il n'est résolvable que par ce que npm a bien voulu poser à la racine — une propriété que personne n'a demandée.`,
            ],
        });
        continue;
    }

    const loaded = resolvePkgDir(entry.name, loadDir);
    if (!loaded) {
        problems.push({
            code: "IMPL-01",
            lines: [
                `« ${entry.name} » est déclaré par ${declarers.map((d) => d.name).join(", ")} mais INTROUVABLE depuis sa position de chargement.`,
                `  position : ${rel(loadDir)}`,
            ],
        });
        continue;
    }

    // IMPL-02 — "declared = executed". Comparison of REAL PATHS, not semver ranges:
    // two copies of one version satisfy the same range while being two different
    // files, and precisely that case (14 nested copies, one loaded) let a two-minor
    // gap through for the declaration's whole life.
    for (const d of declarers) {
        const seen = resolvePkgDir(entry.name, d.dir);
        if (seen && seen !== loaded) {
            problems.push({
                code: "IMPL-02",
                lines: [
                    `« ${entry.name} » : ${d.name} déclare ${d.deps[entry.name]} mais ce n'est PAS la copie qui s'exécute.`,
                    `  déclarée  → ${rel(seen)} (v${versionOf(seen)})`,
                    `  exécutée  → ${rel(loaded)} (v${versionOf(loaded)}), résolue depuis ${rel(loadDir)}`,
                    `  motif : ${entry.why}`,
                ],
            });
        }
    }
}

// ─── IMPL-03 — lockfile sweep ─────────────────────────────────────────────────

const lockPath = process.env.GEOLEAF_LOCKFILE || path.join(ROOT, "package-lock.json");
let lock;
try {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
} catch (err) {
    refuse("IMPL-04", `lockfile illisible (${rel(lockPath)}) : ${err.message}`);
}
if (!lock.packages || typeof lock.packages !== "object") {
    refuse("IMPL-04", `lockfile sans carte « packages » (${rel(lockPath)}) — format inattendu.`);
}

const declaredAnywhere = new Set(manifests.flatMap((m) => Object.keys(m.deps)));
let sweptCount = 0;

for (const [key, meta] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/")) continue;
    const name = key.slice("node_modules/".length);
    if (name.includes("/node_modules/")) continue; // nested, not root
    if (!meta.peer || !meta.optional) continue;
    if (meta.os || meta.cpu) continue; // platform binary: optional by design
    sweptCount++;
    if (!declaredAnywhere.has(name)) {
        problems.push({
            code: "IMPL-03",
            lines: [
                `« ${name} » (v${meta.version}) est à la racine du lock en peerDependency OPTIONNELLE, et aucun manifeste du dépôt ne le déclare.`,
                `  il disparaîtra au premier recalcul par un npm qui ne reconduit pas ce choix.`,
            ],
        });
    }
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

if (problems.length > 0) {
    for (const p of problems) {
        console.error(`ERROR [${p.code}]: ${p.lines[0]}`);
        for (const l of p.lines.slice(1)) console.error(l);
        console.error("");
    }
    console.error(`✗ IMPL : ${problems.length} violation(s).`);
    process.exit(1);
}

console.log(`✅ [IMPL-01] ${table.length} paquet(s) chargé(s) sans import : tous déclarés.`);
console.log(`✅ [IMPL-02] déclaré = exécuté sur les ${table.length} entrée(s).`);
console.log(
    `✅ [IMPL-03] ${sweptCount} entrée(s) racine peer+optional hors binaires de plateforme, aucune orpheline.`
);
if (sweptCount === 0) {
    // Not a failure: npm ≥ 12 no longer sets that marker (cf. docblock). Saying it
    // out loud keeps a reader from taking that green for a proof it is not.
    console.log(
        `   ↳ ⚠️ 0 entrée balayée — ce npm ne pose pas le marqueur peer+optional. IMPL-03 n'a rien prouvé ici ; ce sont IMPL-01/02 qui portent la garde.`
    );
}
console.log(
    `   périmètre : ${manifests.length} manifestes (racine + ${manifests.length - 1} workspaces), lock ${rel(lockPath)}.`
);
process.exit(0);
