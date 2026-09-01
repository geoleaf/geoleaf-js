#!/usr/bin/env node
/**
 * BUILD-DET: two identical builds must produce identical artefacts.
 *
 * ## What this gate watches
 *
 * The `@geoleaf/core` build produced 7 chunks whose NAME changed at every build,
 * for byte-for-byte identical content (`.js` and `.js.map`). Cause:
 * `rollup-plugin-postcss@4.0.2` serialises a **Map** in its `augmentChunkHash`,
 * hence in the CSS modules' transformation order — which is not stable. Rollup
 * adds that value to EVERY chunk's hash.
 *
 * The fix lives in `packages/build-config/rollup.mjs` (`withStableChunkHash`).
 * This gate exists because a non-determinism fix cannot be seen: nothing breaks
 * when it disappears, the build stays green, and one only notices by observing
 * caches that no longer hit.
 *
 * ## What non-determinism costs, and why it is worth a gate
 *
 *  - Turborepo cache invalidated at every build (nothing ever reusable);
 *  - a `deploy/` differing at every generation without a single code change —
 *    hence an unreadable deployment diff;
 *  - browser cache broken on identical chunks, the exact inverse of what a
 *    content hash is for;
 *  - any "dist byte-for-byte identical" verification becomes impossible, and it
 *    is precisely the tool that proved the refactors' neutrality.
 *
 * ## Usage
 *
 *   node scripts/check-build-determinism.cjs            # 2 builds, compares everything
 *   node scripts/check-build-determinism.cjs --package @geoleaf-plugins/table
 *   node scripts/check-build-determinism.cjs --deploy    # 2 `build:deploy`, compare `deploy/`
 *   node scripts/check-build-determinism.cjs --deploy --reuse-built   # 1 single build (wired in ci:local)
 *
 * ⚠️ **"wired in CI" was WRONG until 2026-08-26, and in the direction that misleads.**
 * This gate is wired in `ci:local` only (`package.json` → `check:determinism:deploy:ci`,
 * `ci-local.cjs`); `grep -n determinism .github/workflows/ci.yml` renders **nothing**.
 * It is a deliberate local-only leaf — exactly what the CI-parity gate reports in its
 * non-blocking direction — not an omission. Reading "CI" as the remote workflow made
 * one believe a determinism regression would be caught on push. It would not.
 *
 * ## The `--deploy` mode
 *
 * 🛑 **The default mode NEVER sees `deploy/`** — it builds `@geoleaf/core` through
 * `npx rollup -c` and compares `packages/core/dist/`. Yet the costliest
 * non-determinism did not live there: `build-deploy.cjs` set a `?v=<Date.now()>`
 * on the entry and the plugins, and a timestamped `CACHE_VERSION` on the service
 * worker. Two deployments of the same source thus produced different URLs for
 * identical bytes — ~101 KB gz re-downloaded at every release, and a pre-cache
 * fully rebuilt at every `activate`.
 *
 * ⚠️ **The gate as first announced looked only at the `?v=`, and it would have
 * gone GREEN on a still-broken deployment**: the `CACHE_VERSION` would have kept
 * changing, hence `activate` purging, hence the install refetching everything —
 * the hashed `?v=` gain cancelled, with no assertion moving. This mode compares
 * **the whole deploy**, `sw-core.js` included.
 *
 * Costly by construction (two full builds), hence NOT wired in pre-commit — nor,
 * for the same reason, in `ci:local`'s default path: `--deploy` chains two full
 * `build:deploy`, which would add several minutes to every run.
 *
 * ⚠️ **A gate nobody launches guards nothing.** The two moments where this one
 * must be executed, and where its absence would cost the most:
 *   - before a release / going live — that is where non-determinism gets paid,
 *     in useless re-downloads for every visitor;
 *   - after any change to `rollup.config.mjs`, `build-deploy.cjs` or
 *     `lib/bundle-profiles.cjs` — the three places the three known
 *     non-determinism sources came from.
 * It is carried by the final release review.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const registry = require("./lib/packages.cjs");

const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", c: "\x1b[36m", x: "\x1b[0m" };

const DEPLOY_MODE = process.argv.includes("--deploy");

/**
 * Takes the PRESENT `deploy/` as the first build, instead of making one.
 *
 * 🛑 **This is what makes the gate wirable.** At two builds it costs ~100 s;
 * `ci:local` ALREADY builds `deploy/` at the "Build deploy variants" step, right
 * before. Starting from that result brings the cost to **a single build
 * (~50 s)** — the difference between a gate one wires and a gate reserved to a
 * flag, i.e. never executed.
 *
 * ⚠️ **Only makes sense IMMEDIATELY after a build.** On a stale `deploy/`, the
 * comparison pits old against new: the red would be real (the deploy does not
 * match the sources) but its message would speak of determinism, sending the
 * search to the wrong place. Outside that coupling, use `--deploy` alone.
 */
const REUSE_BUILT = process.argv.includes("--reuse-built");

const argName = (() => {
    const i = process.argv.indexOf("--package");
    return i !== -1 ? process.argv[i + 1] : "@geoleaf/core";
})();

const pkg = registry.byName(argName);
if (!pkg) {
    console.error(`check-build-determinism: unknown package "${argName}".`);
    process.exit(1);
}

const distDir = path.join(pkg.absDir, "dist");

/** Hash every file under dist/, keyed by path relative to dist/. */
function snapshot() {
    /** @type {Record<string,string>} */
    const out = {};
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else {
                const rel = path.relative(distDir, full).split(path.sep).join("/");
                out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
            }
        }
    };
    walk(distDir);
    return out;
}

function build(label) {
    fs.rmSync(distDir, { recursive: true, force: true });
    const res = spawnSync("npx", ["rollup", "-c"], {
        cwd: pkg.absDir,
        encoding: "utf8",
        stdio: "pipe",
    });
    if (res.status !== 0) {
        console.error(`${C.r}✗${C.x} build ${label} en échec :`);
        console.error((res.stderr || res.stdout || "").split("\n").slice(-15).join("\n"));
        process.exit(1);
    }
    return snapshot();
}

const DEPLOY_DIR = path.join(registry.ROOT, "deploy");

/**
 * `deploy/`'s fingerprint, pre-compressed artifacts excluded.
 *
 * ⚠️ `.gz`/`.br` are excluded: their header can carry a timestamp depending on
 * the implementation, which would redden the gate on a property that is not the
 * measured one. Their source is compared, so a real divergence still shows.
 * ⚠️ `deploy-coverage/` is excluded: it is produced by ANOTHER script, from an
 * instrumented build, and is not what `build:deploy` generates.
 */
function snapshotDeploy() {
    /** @type {Record<string,string>} */
    const out = {};
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === "deploy-coverage") continue;
                walk(full);
            } else if (!/\.(gz|br)$/.test(e.name)) {
                const rel = path.relative(DEPLOY_DIR, full).split(path.sep).join("/");
                out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
            }
        }
    };
    walk(DEPLOY_DIR);
    return out;
}

function buildDeploy(label) {
    const res = spawnSync("npm", ["run", "build:deploy"], {
        cwd: registry.ROOT,
        encoding: "utf8",
        stdio: "pipe",
        shell: process.platform === "win32",
    });
    if (res.status !== 0) {
        console.error(`${C.r}✗${C.x} build:deploy ${label} en échec :`);
        console.error((res.stderr || res.stdout || "").split("\n").slice(-15).join("\n"));
        process.exit(1);
    }
    return snapshotDeploy();
}

const subject = DEPLOY_MODE ? "deploy/ (build:deploy)" : argName;
console.log(`${C.c}── Déterminisme du build — ${subject} ──${C.x}`);
console.log(
    `${C.d}   ${DEPLOY_MODE && REUSE_BUILT ? "le deploy/ existant contre un build neuf" : "deux builds complets"}, ` +
        `${DEPLOY_MODE ? "deploy/" : "dist/"} comparé fichier par fichier${C.x}\n`
);

let a, b;
if (DEPLOY_MODE) {
    a = REUSE_BUILT ? snapshotDeploy() : buildDeploy("1");
    if (REUSE_BUILT && Object.keys(a).length === 0) {
        console.error(`${C.r}✗ BUILD-DET : \`--reuse-built\` mais \`deploy/\` est vide.${C.x}`);
        console.error(`  Ce mode suppose un build immédiatement antérieur. Sans lui, lancer`);
        console.error(`  \`npm run check:determinism:deploy\` (deux builds).`);
        process.exit(1);
    }
    b = buildDeploy(REUSE_BUILT ? "2 (le 1er est le deploy/ existant)" : "2");
} else {
    a = build("1");
    b = build("2");
}

if (Object.keys(a).length === 0) {
    // Anti-empty-gate: two empty directories are "identical" and prove nothing.
    console.error(`${C.r}✗ BUILD-DET : aucun fichier scanné — le périmètre est vide.${C.x}`);
    process.exit(1);
}

const namesA = Object.keys(a).sort();
const namesB = Object.keys(b).sort();

const onlyA = namesA.filter((n) => !(n in b));
const onlyB = namesB.filter((n) => !(n in a));
const differing = namesA.filter((n) => n in b && a[n] !== b[n]);

if (onlyA.length === 0 && onlyB.length === 0 && differing.length === 0) {
    console.log(`${C.g}✓ BUILD-DET : ${namesA.length} fichiers identiques sur deux builds.${C.x}`);
    process.exit(0);
}

console.error(`${C.r}✗ BUILD-DET : le build n'est pas déterministe.${C.x}\n`);

// Renamed files are the signature of an unstable content hash — the exact defect
// this gate was written for. Report them as such rather than as add/remove noise.
if (onlyA.length && onlyB.length) {
    console.error(`  ${onlyA.length} fichier(s) ont changé de NOM entre deux builds identiques :`);
    for (const n of onlyA.slice(0, 8)) console.error(`    build 1 : ${n}`);
    for (const n of onlyB.slice(0, 8)) console.error(`    build 2 : ${n}`);
    console.error(`\n  ${C.d}Un nom qui bouge à contenu constant = un hash de contenu instable.`);
    console.error(
        `  ${C.d}Piste connue : un plugin dont \`augmentChunkHash\` sérialise une Map ou un Set`
    );
    console.error(
        `  ${C.d}(ordre d'insertion non stable). Cf. withStableChunkHash dans build-config/rollup.mjs.${C.x}`
    );
} else {
    if (onlyA.length)
        console.error(`  présents au build 1 seulement : ${onlyA.slice(0, 5).join(", ")}`);
    if (onlyB.length)
        console.error(`  présents au build 2 seulement : ${onlyB.slice(0, 5).join(", ")}`);
}

if (differing.length) {
    console.error(`\n  ${differing.length} fichier(s) de même nom mais de contenu différent :`);
    for (const n of differing.slice(0, 8)) console.error(`    ${n}`);
    console.error(
        `  ${C.d}Chercher une date, un horodatage, un chemin absolu ou un aléa dans le build.${C.x}`
    );
}

process.exit(1);
