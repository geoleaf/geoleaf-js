#!/usr/bin/env node
// @ts-check
/**
 * build-deploy-coverage.cjs — Build instrumented bundle for E2E coverage
 *
 * Workflow:
 * 1. Save current (clean) dist/ files
 * 2. Run rollup with COVERAGE=true → instrumented ESM bundle in packages/core/dist/
 * 3. Copy deploy/deploy-core → deploy/deploy-coverage
 * 4. Replace JS bundles in deploy-coverage/dist/ with instrumented versions
 * 5. Restore original dist/ files
 *
 * ## `deploy-coverage` is TOOLING, not a deliverable (T2, arbitrage Q2)
 *
 * The two shipped variants are `deploy-core` and `deploy-full` (`deploy-addpoi` left
 * with the merged plugin).
 * `deploy-coverage` is a FOURTH folder that is served (port 8769, vhost
 * `demo.coverage.geoleaf.local.test`) but never delivered: it is `deploy-core` with an
 * Istanbul-instrumented bundle and a CSP relaxed to allow `unsafe-eval`. **It does not
 * ship, it measures** — 4 specs of the main suite
 * read their coverage from it. Kept for that reason, and documented here so nobody
 * mistakes it for a delivery target or "cleans it up" as a stray copy.
 *
 * It reads only DERIVED artefacts — `deploy/deploy-core` and `packages/core/dist` —
 * never the app's sources, which is why T2 (moving the app to `apps/geoleaf-app/`)
 * required no change here. ⚠️ But it goes STALE the moment `deploy-core` is rebuilt:
 * regenerate it after every `build:deploy` or the E2E run times out on a missing 8769.
 *
 * Usage: node scripts/build-deploy-coverage.cjs
 * Prerequisite: deploy/deploy-core must already exist (run npm run build:deploy first)
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// @security (audit L1) Disable the shell on POSIX (CI ubuntu + WSL). Static
// literal args only; on Windows `npx` resolves to npx.cmd which Node refuses to
// spawn without a shell (CVE-2024-27980), so the shell is retained there only.
const NPM_SHELL = process.platform === "win32";

const ROOT = path.resolve(__dirname, "..");
const DEPLOY_CORE = path.join(ROOT, "deploy", "deploy-core");
const DEPLOY_COV = path.join(ROOT, "deploy", "deploy-coverage");
// Through the registry, which throws. `CORE_PKG_DIR` also serves as `cwd` for both
// rollup calls (steps 1 and 4): a stale path there would fail the build with a tool
// message, no gate — this script would then leave `deploy-coverage` on its old
// instrumented bundles, served as-is by the 8769 vhost.
const CORE_PKG_DIR = require("./lib/packages.cjs").requireByDirName("core").absDir;
const CORE_DIST = path.join(CORE_PKG_DIR, "dist");

/**
 * Empties `packages/core/dist/` before a direct rollup call.
 *
 * This file's two `npx rollup -c` calls short-circuit the `rimraf dist &&` the core's
 * `build` script carries, and rollup does not wipe its output directory: without this
 * purge, each pass LAYERS its set of hashed chunks over the previous one. See step 1's
 * comment and `scripts/check-dist-integrity.cjs`, the guard that makes the defect
 * visible.
 *
 * @param {string} phase Label of the pass, for the trace.
 */
function purgeCoreDist(phase) {
    if (fs.existsSync(CORE_DIST)) {
        fs.rmSync(CORE_DIST, { recursive: true, force: true });
        log.ok(`dist/ vidé avant le build ${phase}`);
    }
}

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
};
const log = {
    ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
    err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
    info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
    section: (m) => console.log(`\n${C.cyan}── ${m} ──${C.reset}\n`),
};

/**
 * Recursive directory copy, with an optional per-file filter.
 *
 * @param {string} src
 * @param {string} dest
 * @param {(name: string) => boolean} [keepFile] receives the BASENAME of each regular file;
 *   return `false` to skip it. Omitted ⇒ copy all. Added with the sourcemap purge,
 *   same rationale as its twin in `build-deploy.cjs`: a wholesale `copyDir`
 *   reintroduces sourcemaps without any line of the script naming them.
 */
function copyDirRecursive(src, dest, keepFile) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirRecursive(s, d, keepFile);
        else if (!keepFile || keepFile(entry.name)) fs.copyFileSync(s, d);
    }
}

// ── Pre-checks ──────────────────────────────────────────
if (!fs.existsSync(DEPLOY_CORE)) {
    log.err("deploy/deploy-core not found. Run 'npm run build:deploy' first.");
    process.exit(1);
}

// ── Step 1: Build instrumented core ─────────────────────
log.section("🔬 Building instrumented core (COVERAGE=true)");

// ⚠️ SECOND CAUSE of the chunk layering — found on 2026-08-06, and it is NOT the
// first: the turbo cache is one, real and canary-proven; but it does not suffice to
// explain it here.
//
// The core's script does `rimraf dist && rollup -c` (`package.json`). This file calls
// `npx rollup -c` DIRECTLY, at steps 1 and 4 — hence WITHOUT the `rimraf`. Rollup
// writes its hashed chunks over those already present instead of replacing them: after
// step 1, `core/dist/chunks/` carries the instrumented AND the non-instrumented
// chunks, step 3 copies BOTH to `deploy-coverage`, and step 4 adds a third set.
//
// Measured: `packages/core/dist/chunks/` comes out CLEAN of a
// `turbo run build --force`, then goes double again after this single script. Purging
// before each rollup is the missing move.
purgeCoreDist("instrumenté");

const buildResult = spawnSync("npx", ["rollup", "-c"], {
    cwd: CORE_PKG_DIR,
    stdio: "inherit",
    shell: NPM_SHELL,
    env: { ...process.env, COVERAGE: "true" },
});

if (buildResult.status !== 0) {
    log.err("Instrumented build failed — aborting.");
    process.exit(1);
}
log.ok("Instrumented build succeeded");

// ── Step 2: Copy deploy-core → deploy-coverage ──────────
log.section("📁 Creating deploy/deploy-coverage");

if (fs.existsSync(DEPLOY_COV)) {
    fs.rmSync(DEPLOY_COV, { recursive: true, force: true });
}
// 🛑 `deploy-core`'s PRE-COMPRESSED files are NOT copied, and that is this line's
// central fix, not an optimization.
//
// This script copies a FULLY BUILT variant then overwrites only part of it: the `.js`
// switch to the instrumented version, the `.gz`/`.br` stayed those of the CLEAN
// build. Yet the dev nginx carries `gzip_static on`: it serves the `.gz` in
// preference to the named file. The browser thus received **`deploy-core`'s entry**,
// non-instrumented, which imports `deploy-core`'s chunks — absent from this variant,
// since the instrumented chunks carry other content hashes. Result measured on
// 2026-08-08: 3 chunks in 404, the entry module never instantiates,
// `window.GeoLeaf` and `window.__coverage__` stay `undefined`, and the 7
// `07-boot-sequence` tests fail — **the instrument measuring the SHIPPED bundle's
// coverage was dead, with nothing saying so.**
//
// ⚠️ The symptom POINTED AT THE WRONG CULPRIT. The three 404s also match, exactly, the
// three `<link rel="modulepreload">` inherited from `deploy-core` — hence a first
// diagnosis accusing the preload block. It is indeed incoherent, but a failed preload
// only warns: it does not keep a module from executing. The deciding proof is not the
// 404 list, it is that the served `.gz` contains NO instrumentation marker.
//
// Purge rather than regenerate: this variant is a test instrument served locally, no
// gate expects compressed files in it (`check-app-payload` documents it as ungated,
// `check-build-determinism` excludes it), and an absent file cannot diverge from its
// source.
const PRECOMPRESSED = /\.(gz|br)$/;
copyDirRecursive(DEPLOY_CORE, DEPLOY_COV, (n) => !PRECOMPRESSED.test(n));
log.ok("Copied deploy-core → deploy-coverage (sans les pré-compressés)");

// ── Step 2b: Relax CSP for Istanbul (needs 'unsafe-eval' for Function()) ──
const indexPath = path.join(DEPLOY_COV, "index.html");
if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, "utf8");
    html = html.replace(/script-src\s+'self'/, "script-src 'self' 'unsafe-eval'");
    fs.writeFileSync(indexPath, html, "utf8");
    log.ok("CSP relaxed: added 'unsafe-eval' for Istanbul instrumentation");
}

// ── Step 3: Replace JS with instrumented versions ───────
log.section("🔄 Replacing JS bundles with instrumented versions");

// Copy main ESM bundle
const esmSrc = path.join(CORE_DIST, "geoleaf.esm.js");
const esmDest = path.join(DEPLOY_COV, "dist", "geoleaf.esm.js");
if (fs.existsSync(esmSrc)) {
    fs.copyFileSync(esmSrc, esmDest);
    log.ok("geoleaf.esm.js (instrumented)");
}

// The `geoleaf.esm.js.map` copy is REMOVED, and the rule holds here TOO.
//
// This variant is a test instrument, never served in production: the disclosure
// argument motivating the purge does not apply the same way, and an exemption would
// have been defensible. Verified before deciding: **nothing reads this sourcemap** —
// boot coverage goes through the istanbul global `window.__coverage__`, not through a
// remapping. The exemption would thus have cost an asymmetry to document and defend,
// for no use. A uniform rule is shorter to hold than a rule with a justified special
// case.

// Copy instrumented chunks — without their sourcemaps, same rationale.
const chunksSrc = path.join(CORE_DIST, "chunks");
const chunksDest = path.join(DEPLOY_COV, "dist", "chunks");
if (fs.existsSync(chunksSrc)) {
    if (fs.existsSync(chunksDest)) {
        fs.rmSync(chunksDest, { recursive: true, force: true });
    }
    copyDirRecursive(chunksSrc, chunksDest, (n) => !n.endsWith(".map"));
    const count = fs.readdirSync(chunksDest).filter((f) => f.endsWith(".js")).length;
    log.ok(`${count} chunk(s) copied`);
}

// ── Step 3b: realign the `<link rel="modulepreload">` — second defect ──
//
// `index.html` is copied from `deploy-core`, so its preload block names the CLEAN
// build's chunks. The instrumented chunks carry other content hashes: the three links
// fell in 404 at every load.
//
// ⚠️ This defect is REAL but it was NOT the outage's cause, and conflating the two
// cost an entire first diagnosis. A failed preload warns, it does not keep a module
// from executing — the outage came from the stale `.gz` served by `gzip_static` (see
// step 2). Both produce exactly the same three 404s, which makes the symptom
// ambiguous: the `.gz`'s content, not the 404 list, is what decided.
//
// Fixed rather than removed: the preload is part of the page shape `07-boot-sequence`
// observes. The realignment goes by chunk-name PREFIX — never by list position, which
// says nothing — and a prefix with no match FAILS the build instead of letting a mute
// 404 come back.
if (fs.existsSync(indexPath) && fs.existsSync(chunksDest)) {
    const present = fs.readdirSync(chunksDest).filter((f) => f.endsWith(".js"));
    let html = fs.readFileSync(indexPath, "utf8");
    let realigned = 0;
    const unresolved = [];

    html = html.replace(
        /(<link rel="modulepreload" href="dist\/chunks\/)([^"]+)(")/g,
        (whole, head, file, tail) => {
            if (present.includes(file)) return whole; // already right
            // `geoleaf-chunk-core-utils-BNNAnI8S.js` → prefix `geoleaf-chunk-core-utils-`
            const prefix = file.replace(/-[A-Za-z0-9_-]+\.js$/, "-");
            const match = present.find((f) => f.startsWith(prefix));
            if (!match) {
                unresolved.push(file);
                return whole;
            }
            realigned++;
            return head + match + tail;
        }
    );

    if (unresolved.length) {
        log.err(
            `${unresolved.length} modulepreload sans chunk correspondant : ` +
                `${unresolved.join(", ")}. Ils partiraient en 404 à chaque chargement et ` +
                `feraient échouer toute spec assertant « 0 erreur console ».`
        );
        process.exit(1);
    }
    fs.writeFileSync(indexPath, html, "utf8");
    log.ok(`${realigned} modulepreload réaligné(s) sur les chunks instrumentés`);
}

// ── Step 4: Rebuild clean core (restore non-instrumented dist/) ──
log.section("🔨 Rebuilding clean core (restoring dist/)");

// Same rationale as at step 1: without this purge, the non-instrumented set adds
// itself to the instrumented set step 1 just produced, and `core/dist/` ends up with
// both.
purgeCoreDist("propre");

const cleanBuild = spawnSync("npx", ["rollup", "-c"], {
    cwd: CORE_PKG_DIR,
    stdio: "inherit",
    shell: NPM_SHELL,
});

if (cleanBuild.status !== 0) {
    log.err(
        "Clean rebuild failed — dist/ may still contain instrumented code. Run 'npm run build:core' manually."
    );
} else {
    log.ok("Clean dist/ restored");
}

// Purge of orphaned `sourceMappingURL`s, and GUARD.
//
// ⚠️ This pass is indispensable HERE and cannot be delegated to `build-deploy.cjs`,
// for a reason of ORDER: this script copies the INSTRUMENTED bundles from `CORE_DIST`
// **after** build-deploy cleaned `deploy-core`. The files thus arrive fresh, comment
// intact. Measured on 2026-08-08: `deploy-coverage` came out at 0 sourcemaps but
// **6 orphaned `sourceMappingURL`s**, each a 404 in devtools — half the defect
// repaired, the other reformed right after, by a script the first pass did not see.
{
    const stripped = [];
    const sweep = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                sweep(p);
                continue;
            }
            if (!/\.(js|css)$/.test(e.name)) continue;
            const before = fs.readFileSync(p, "utf8");
            const after = before.replace(
                /\s*(?:\/\/|\/\*)#\s*sourceMappingURL=[^\s*]+\s*(?:\*\/)?\s*$/,
                "\n"
            );
            if (after !== before) {
                fs.writeFileSync(p, after);
                stripped.push(path.relative(DEPLOY_COV, p));
            }
        }
    };
    sweep(DEPLOY_COV);
    log.ok(`sourceMappingURL retirés — ${stripped.length} fichier(s)`);

    const leaked = [];
    const findMaps = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) findMaps(p);
            else if (e.name.endsWith(".map")) leaked.push(path.relative(DEPLOY_COV, p));
        }
    };
    findMaps(DEPLOY_COV);
    if (leaked.length) {
        log.err(
            `${leaked.length} sourcemap(s) dans deploy-coverage : ${leaked.join(", ")}. ` +
                `Le déployé n'en expédie AUCUNE. Filtrer la copie, ne pas retirer la garde.`
        );
        process.exit(1);
    }
    log.ok("aucune sourcemap dans deploy-coverage");
}

/**
 * GUARD — no pre-compressed file, and the served entry IS the instrumented one.
 *
 * Two checks, because one alone would let half the class through:
 *
 * ① No `.gz`/`.br` in the variant. Under `gzip_static on`, a stale compressed file is
 *   served IN PLACE of the named file — the disk can thus be right while the browser
 *   receives something else. That is precisely what made the defect invisible: every
 *   verification read the `.js`, and nginx served the `.gz`.
 *
 * ② The entry carries an instrumentation marker. ① alone would go green on a
 *   `deploy-coverage` where the `.js` overwrite had failed — the variant would then be
 *   coherent and perfectly useless, which is the worst state: `verify-e2e-coverage`
 *   would measure a NON-instrumented bundle and render 0 % with no error saying so.
 */
{
    const compressed = [];
    const findCompressed = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) findCompressed(p);
            else if (/\.(gz|br)$/.test(e.name)) compressed.push(path.relative(DEPLOY_COV, p));
        }
    };
    findCompressed(DEPLOY_COV);
    if (compressed.length) {
        log.err(
            `${compressed.length} pré-compressé(s) dans deploy-coverage : ` +
                `${compressed.slice(0, 5).join(", ")}${compressed.length > 5 ? "…" : ""}. ` +
                `Le nginx de dev porte \`gzip_static on\` et les servirait À LA PLACE des ` +
                `fichiers instrumentés — la variante boote alors du code NON instrumenté, ou ` +
                `ne boote pas du tout. Ne pas régénérer : ne pas copier.`
        );
        process.exit(1);
    }

    const entry = path.join(DEPLOY_COV, "dist", "geoleaf.esm.js");
    if (!fs.existsSync(entry)) {
        log.err("dist/geoleaf.esm.js absent de deploy-coverage.");
        process.exit(1);
    }
    if (!fs.readFileSync(entry, "utf8").includes("__coverage__")) {
        log.err(
            "dist/geoleaf.esm.js ne porte AUCUN marqueur d'instrumentation. La " +
                "variante servirait un bundle propre, et `verify-e2e-coverage` rendrait 0 % " +
                "sans qu'aucune erreur ne le signale."
        );
        process.exit(1);
    }
    log.ok("aucun pré-compressé, et l'entrée est instrumentée");
}

log.section("✅ deploy/deploy-coverage ready (port 8769)");
const covSize = (function calcSize(dir) {
    let bytes = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) bytes += calcSize(p);
        else bytes += fs.statSync(p).size;
    }
    return bytes;
})(DEPLOY_COV);
log.info(`Total size: ${(covSize / 1024).toFixed(0)} KB`);
