#!/usr/bin/env node
/**
 * Bundle size guard for @geoleaf/core.
 *
 * Gates on the artifact the browser actually downloads AND evaluates at boot:
 * the CDN entry `dist/geoleaf.esm.js` PLUS every chunk it imports **statically**
 * (`import …`/`export … from`). A `<script type="module">` resolves those static
 * imports synchronously before the entry finishes evaluating — so the real
 * load-time cost is the *transitive static-import closure*, not the entry alone.
 *
 * Why this rewrite (perf roadmap / audit d'extractibilité, 2026-06-27): the
 * previous gate measured ONLY `geoleaf.esm.js` (~70 KB gz) and treated every file
 * in `dist/chunks/` as "lazy load on demand". That is FALSE for the ~10 chunks the
 * entry imports statically (route/table/legend/labels/themes/poi/geojson/layers/
 * core-utils/search are eager) — it under-counted the boot cost ~3.4× (~245 KB gz
 * real). Worse, a heavy dependency leaking into a manualChunk (e.g. chunk-core-utils)
 * would NOT grow the entry, so the old gate could not catch it. We now follow the
 * static graph from the entry and gate on the summed gzip — the true boot budget.
 *
 * Dynamic `import("./chunks/…")` edges (the genuinely lazy chunks + their tiny
 * stubs) are intentionally NOT followed: they load on demand, off the boot path.
 *
 * Multi-variant safety: `dist/chunks/` may hold chunks from several builds (with
 * different hashes). Walking the static graph from the real entry selects only the
 * chunks belonging to THIS bundle — never a blind sum of the directory.
 *
 * Note: `dist/esm/bundle-esm-entry.js` is NOT a boot metric — it is the granular
 * (preserveModules) entry for bundlers, a list of re-exports; reported for info only.
 *
 * Per-plugin budgets (Plugin Contract v1, S14): each plugin's shipped bundle
 * `packages/plugins/<name>/dist/geoleaf-<name>.plugin.js` has its own gz budget
 * (override table + default). A missing bundle is skipped with a warning. ⚠️ Do not read
 * that path as authoritative — it is DERIVED from the workspace registry
 * (`PLUGIN_BUNDLES`, see its comment); this line is prose, and it said
 * `packages/plugin-<name>/` — the pre-ARCHI-S10.1 layout — until STRUCT S2.
 *
 * Sourcemaps (perf roadmap S4, F-TOOL-3): the core build EMITS `.map` files. They are
 * not loaded at boot (devtools fetch them on demand), so they are reported and
 * soft-warned only (never hard-fail).
 *
 * ⚠️ This block said "they ARE published to npm" until 2026-08-10, and that is no longer
 * true of the JS maps. `packages/core/package.json` now carries `!dist/**\/*.js.map` in
 * `files[]`: the six JS maps are EMITTED (this gate reads them, and so does
 * `listEagerSources` below, which is the primitive behind `size:example`) but are NOT
 * SHIPPED. The two verbs came apart, and the reason is measured: the core is the only
 * publishable package without `src/` in `files[]`, so its JS maps resolved on 0 of 243
 * sources FROM INSIDE THE TARBALL — dead weight for a consumer, live instrument here.
 * `dist/geoleaf-main.min.css.map` still ships and must: it carries its 35 sources inline,
 * so it is self-contained and resolves without `src/`. Full motive: backlog, the
 * "cartes JS du core" line settled on 2026-08-10.
 *
 * 🛑 Consequence for whoever reads a number here: this gate's figure measures the BUILD
 * OUTPUT, never the tarball. Do not quote it as "what npm ships" — `npm pack --dry-run`
 * is the only instrument that answers that question.
 *
 * Usage:
 *   node scripts/check-bundle-size.cjs            # core bundle — exits 1 on hard breach
 *   node scripts/check-bundle-size.cjs --plugins  # per-plugin bundles too
 *   require("./check-bundle-size.cjs").checkBundleSize({ log })       # from build-deploy
 *   require("./check-bundle-size.cjs").checkPluginBundles({ log })    # from build-deploy
 *
 * ## Sole size gate of the repo (T6.3, 2026-07-25)
 *
 * Until T6.3 a SECOND device called itself a size gate: `benchmark.cjs --ci`, wired
 * twice (ci.yml:147, ci-local.cjs:137). Its three assertions were all inert — the
 * tracked baseline `.benchmark-baseline.json` dated 2026-02-27 (Leaflet era) recorded
 * `geoleaf.esm.js` at 1 928 560 B against ~948 B measured today, i.e. −99.95 % against
 * a +5 % threshold, and the two others named `geoleaf-lite.esm.js`, an artifact deleted
 * at S4. It could only ever fail if its own baseline file disappeared. Two steps under
 * one label, and no stateable rule saying which one had authority.
 *
 * ⚠️ This file is now the ONLY device that can refuse a bundle regression, and it is
 * reached THREE ways — all three must stay:
 *   1. `npm run size`                                → ci.yml step + ci-local.cjs step
 *   2. `require()` from build-deploy.cjs:1090-1093   → every deploy variant build
 *   3. `require()` from golden-master.cjs:33         → the boot snapshot (bootGz)
 * Path (1) was ADDED by T6.3 and is not redundant with (2): before it, the budget sat
 * behind a deploy build, i.e. reachable only under `ci:local --e2e` and only at the
 * LAST step of the CI job. That blind spot is exactly what T6.3 closed — do not
 * "simplify" the step away as already covered.
 *
 * @version 2.4.0
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

// ── Boot payload budget (gzip, KB) — the REAL load-time cost ────────────
// = entry `geoleaf.esm.js` + transitive closure of statically-imported chunks.
// Anchored on the real measured eager-boot total (244.9 KB gz / 830.7 KB raw,
// 2026-06-27) with headroom: warn +10 %, fail +22 %. Margins picked to trip on a
// real regression (a heavy dep leaking into the eager path, INCLUDING via a
// manualChunk) without crying wolf on normal feature growth. Ratchet DOWN after
// each feature extraction (e.g. table → plugin ≈ −10.6 KB gz) so the gate keeps
// guarding the new, lighter boot floor.
const BOOT_FAIL_GZ_KB = 300; // HARD — exceeding fails the build
const BOOT_WARN_GZ_KB = 270; // SOFT — warning only

// ── Kernel CSS budget (gzip, KB) — added S12 ───────────────────────────
// `dist/geoleaf-main.min.css` is the single stylesheet every integrator loads
// (exposed as the `./style.css` export). Nothing measured it before: this script
// only ever looked at JS, there is no stylelint in the repo, and the
// `verify:purgecss` gate is vacuous (its safelist exempts ~everything `gl-*`).
// A CSS regression was therefore invisible — S12 found geoleaf-theme.css inlined
// TWICE (a nested @import without layer(), +5.4 KB raw) that had gone unnoticed.
// Anchored on the post-S12 measurement (17.9 KB gz) with the same intent as the
// boot budget: warn ~+17 %, fail ~+34 %. Ratchet DOWN after future purges.
const CSS_FAIL_GZ_KB = 24; // HARD
const CSS_WARN_GZ_KB = 21; // SOFT

// ── Entry-only thresholds — REMOVED (S5) ───────────────────────────────
// There used to be BUNDLE_WARN_GZ_KB = 85 / BUNDLE_FAIL_GZ_KB = 100 here, guarding the size
// of `geoleaf.esm.js` alone. Since `kernel-exports.ts` (S4) the entry is a 0.5 KB gz shim —
// its content moved into chunks — so an 85 KB threshold on it could not be reached by any
// regression. It measured nothing while looking like a guard, which is worse than no guard:
// the next reader would have trusted it. (The FAIL constant was exported but never even
// evaluated.) The entry size is still REPORTED below, as what it is: information.
// The real budget is the boot payload — entry + its static closure — above.

// ── Sourcemap budget (gzip, KB) — perf roadmap S4 ──────
// SOFT only — never gates the build (not a boot cost). Anchored with headroom — trips on a
// sourcemap config regression (e.g. maps doubling) only.
// Socle S5.6: the CLEAN-build baseline is ~275 KB gz (8 .map files), so 900 is well
// calibrated (~3× headroom). A reading in the thousands is almost always STALE ORPHANED
// .map files, not a regression: rollup's `output.dir` overwrites same-named chunks but never
// deletes renamed/removed ones, so repeated local builds pile up orphan chunk maps in
// dist/chunks/. Clean-rebuild (`rm -rf packages/core/dist`) before trusting a high number.
const SOURCEMAP_WARN_GZ_KB = 900; // SOFT — warning only, never fails

const ROOT = path.resolve(__dirname, "..");
// T5.5 — le core par le registre, comme les plugins plus bas (:144). Les deux moitiés de
// ce gate lisaient le même dépôt par deux moyens différents, et seule celle des plugins
// survivait à un déplacement. Un DIST périmé ne fait pas échouer le budget : `gzipKB`
// rend `null`, la mesure est sautée, et le gate de taille sort vert sans avoir pesé.
const CORE_DIR = require("./lib/packages.cjs").requireByDirName("core").absDir;
const DIST = path.join(CORE_DIR, "dist");
const BUNDLE_FILE = path.join(DIST, "geoleaf.esm.js"); // chunked CDN bundle — boot artifact
const BUNDLE_MAP = path.join(DIST, "geoleaf.esm.js.map"); // entry sourcemap — shipped, not booted
const CHUNKS_DIR = path.join(DIST, "chunks"); // lazy chunks (+ their .map files)
const GRANULAR_ENTRY = path.join(DIST, "esm", "bundle-esm-entry.js"); // bundler entry — info only

// ── Per-plugin budgets (gzip, KB) — Plugin Contract v1, S14 ──
//
// TWO budgets per plugin since B-107 (2026-08-02), because a plugin has TWO costs and
// one number could not express both:
//   - `boot`  — the ENTRY file alone: what a page pays to load the plugin.
//   - `total` — every `.js` emitted in the plugin's `dist/`: what npm ships, lazy
//               chunks included.
// They are equal for the ten single-file plugins; they diverge for the three that split.
//
// ⚠️ WHY BOTH, and not just the total that B-107 asked for. Budgeting only the total
// would LOSE the boot signal exactly where it matters most: `print` ships 375 KB gz but
// boots on 37, so its entry could double and still sit far under any total-based fail.
// Budgeting only the entry is the defect B-107 opened. Neither number alone guards.
//
// 🛑 AND B-107 UNDERSTATED ITS OWN GISEMENT — measured 2026-08-02, mode d'échec n° 1.
// It named `editor` (+46 KB gz of Terra Draw) as the case. There are THREE splitters,
// and `editor` is the SMALLEST of them:
//     editor          41.7 boot → 88.1 total   (+46.4, Terra Draw)
//     realtime-layer  11.6 boot → 223.4 total  (+211.8, protobuf)
//     print           37.4 boot → 375.7 total  (+338.3, jsPDF + html2canvas)
// ≈ 596 KB gz shipped and budgeted by nothing at all, not the 45.5 the line names.
//
// ANCHORING RULE, uniform and stated so it can be re-derived rather than guessed:
// warn = ceil(measured × 1.15), fail = ceil(measured × 1.30).
// The old table had no rule — its headroom ran from +1.5 % (`offline-ui`) to +217 %
// (`addpoi`), which is how B-107 ② happened: `addpoi` was budgeted 200/250 against 79
// measured, so it would have had to TRIPLE to warn. A guard never seen red guards nothing.
//
// ── RE-ANCHORED on the 2026-08-06 build (Sprint 6, S6a / 6.2b) ───────────────────────────
//
// The line above predicted it: « Ratchet DOWN after future purges — […] not minified yet
// (B-109), so their numbers WILL drop. » They did. 6.3′ turned `minify: true` on for the 13
// packages that were calling `pluginStack` without it (it is OPT-IN, and `editor` was the
// only one of fifteen to set it), and moved `offline-ui` onto the shared stack. Measured
// across every package bundle: 817 744 → 528 622 bytes gz, i.e. **−35 %**.
//
// 🛑 Why re-anchoring is NOT optional here, and why it needs its own line in the sprint:
// minifying makes every measure DROP, so no budget can fire on it. Nothing goes red, nothing
// asks to be looked at, and the table quietly becomes as slack as the one B-107 ② described.
// A budget that cannot fire is indistinguishable from no budget at all — which is the exact
// defect this table was rewritten to fix four days ago.
//
// ⚠️ Two near-false-positives retired in passing, both TIGHTER than the two called out on
// 08-02 (`measure` at 0.5 KB, `offline-ui` at 0.7): `editor` sat at 47.9 against a warn of
// 48 — **0.1 KB** — and it was never touched by 6.3′, since it was the one package already
// minified. Its margin had been eaten by the addpoi merge, not by a regression.
//
// ⚠️ `realtime-layer` boot: ceil(4.5 × 1.15) = 6 and ceil(4.5 × 1.30) = 6 collide at this
// size. `fail` is lifted to 7 by hand so the two thresholds stay distinct — a warn that is
// also a fail cannot warn.
const PLUGIN_DEFAULT_GZ_KB = { boot: { warn: 40, fail: 60 }, total: { warn: 40, fail: 60 } };
const PLUGIN_BUDGETS_GZ_KB = {
    // print — entry holds the print logic only; jsPDF (+ optional html2canvas/dompurify)
    // ships in lazy chunks loaded on first PDF export. The boot budget keeps guarding the
    // re-inline regression; the total budget is what finally counts the 338 KB gz of chunks.
    print: { boot: { warn: 20, fail: 23 }, total: { warn: 287, fail: 324 } }, // 17.4 / 248.7
    // realtime-layer — protobuf decoding split into lazy chunks. Its old 100/130 budget sat
    // on an 11.6 KB entry: it could not fire either, for the same reason as addpoi.
    // ⚠️ boot `fail` lifted 6 → 7 by hand: at 4.5 KB the ×1.15 and ×1.30 rules collide.
    "realtime-layer": { boot: { warn: 6, fail: 7 }, total: { warn: 41, fail: 46 } }, // 4.5 / 35.2
    // editor — Terra Draw in a lazy chunk (manualChunks), loaded on first drawing tool.
    // ⚠️ Was 48/55 against 47.9 measured — 0.1 KB from crying wolf, the tightest of the table.
    // 6.2c: B-145 removed 337 LOC of dead read surface from `field-renderer`, which `editor`
    // is now the only package to inline — 47.9 → 47.0 boot, 94.3 → 93.4 total.
    editor: { boot: { warn: 55, fail: 62 }, total: { warn: 108, fail: 122 } }, // 47.0 / 93.4
    // cog — geotiff.js. Minified at 6.3′: 161.8 → 99.7 KB gz.
    cog: { boot: { warn: 115, fail: 130 }, total: { warn: 115, fail: 130 } }, // 99.7
    // offline-ui (renamed from `storage` at STRUCT S3.1, 26/07/2026 — this key drifted for a
    // few hours and the plugin silently fell back to PLUGIN_DEFAULT_GZ_KB, see
    // assertBudgetKeysAlive() below): UI only since S14 Phase B — the offline engine
    // (IndexedDB / cache / download / sync) moved in-core (dynamic import(), out of this
    // budget). ⚠️ It was measured at 73.3 against a warn of 74 — 0.7 KB from crying wolf.
    // ⚠️ It was the LAST package on a hand-rolled rollup stack — no shared `pluginStack`, so
    // no `minify` flag to turn on. Moved onto the stack at 6.3′: 79.4 → 31.5 KB gz, −59 %.
    // Re-anchored again at 6.2c: B-144 took `field-renderer` off its dependency list, and the
    // responsive modal that came with the import went with it — 31.5 → 28.7.
    "offline-ui": { boot: { warn: 33, fail: 38 }, total: { warn: 33, fail: 38 } }, // 28.7
    // measure — Turf. ⚠️ Was measured at 44.5 against a warn of 45: 0.5 KB from firing, on
    // no regression at all. Re-anchored like the rest.
    measure: { boot: { warn: 25, fail: 28 }, total: { warn: 25, fail: 28 } }, // 21.5
    "file-import": { boot: { warn: 21, fail: 24 }, total: { warn: 21, fail: 24 } }, // 17.9
    flatgeobuf: { boot: { warn: 16, fail: 18 }, total: { warn: 16, fail: 18 } }, // 13.6
    // geocoding: zero npm deps (native fetch) + a small copied pill-search/CSS.
    geocoding: { boot: { warn: 8, fail: 9 }, total: { warn: 8, fail: 9 } }, // 6.6
    // table: zero npm deps — renderer + selection + export + the in-house OOXML (.xlsx)
    // writer inlined (rollup inlineDynamicImports).
    table: { boot: { warn: 19, fail: 21 }, total: { warn: 19, fail: 21 } }, // 16.0
    // taxonomy + feature-info reclassified into @geoleaf/core (SR0) — no longer standalone
    // plugin bundles; their weight is counted in the core boot closure (`npm run size`).
    connector: { boot: { warn: 11, fail: 13 }, total: { warn: 11, fail: 13 } }, // 9.5
    websocket: { boot: { warn: 5, fail: 6 }, total: { warn: 5, fail: 6 } }, // 4.3
};
// Plugins to scan — derived from package.json#workspaces (ARCHI S9.4), not typed
// out. The BUDGETS above stay hand-written on purpose: they are data (a measured
// threshold per plugin), whereas the list of plugins is a fact about the repo that
// can be read. Deriving the path also survives ARCHI S10 moving plugins under
// `packages/plugins/`, which the previous `path.join(ROOT, "packages", ...)`
// template would not have.
const PLUGIN_BUNDLES = require("./lib/packages.cjs")
    .plugins()
    .map((p) => ({
        name: p.pluginName,
        file: path.join(p.absDir, "dist", p.bundleFile),
    }));

// ── Default minimal logger (overridable by the caller) ──
const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
};
const defaultLog = {
    ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
    err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
    info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
    warn: (m) => console.log(`${C.yellow}⚠${C.reset}  ${m}`),
    section: (m) => console.log(`\n${C.cyan}── ${m} ──${C.reset}\n`),
};

/** Gzipped size of a file, in KB. Returns null if the file is missing. */
function gzipKB(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return zlib.gzipSync(fs.readFileSync(filePath), { level: 9 }).length / 1024;
}

/** Raw size of a file, in KB. Returns null if the file is missing. */
function rawKB(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).size / 1024;
}

const fmt = (kb) => (kb == null ? "—" : `${kb.toFixed(1)} KB`);

/**
 * Extracts the STATIC import specifiers of a module's source.
 * Matches `… from "x"` (import/export-from) and side-effect `import "x"`.
 * Excludes dynamic `import("x")` (no `from`, and `import(` ≠ `import"`).
 * @param {string} code
 * @returns {string[]} unique specifiers
 */
function staticImportSpecifiers(code) {
    const specs = new Set();
    let m;
    const fromRe = /(?<![\w$.])from\s*["']([^"']+)["']/g;
    while ((m = fromRe.exec(code))) specs.add(m[1]);
    const sideRe = /(?<![\w$.])import\s*["']([^"']+)["']/g;
    while ((m = sideRe.exec(code))) specs.add(m[1]);
    return [...specs];
}

/**
 * Measures the REAL eager boot payload of a minified entry: the entry plus the
 * transitive closure of the chunks it imports STATICALLY, staying inside `distDir`.
 * Dynamic `import()` edges are not followed. Generalized from the default full
 * bundle to any preset output (S0) — `measureEagerBoot()` is the thin wrapper.
 * `chunkFiles` (added S4) is the chunk list the walk already computed — it used to be
 * thrown away and only its `.size` returned. `listEagerSources()` needs it to recover the
 * SOURCE paths behind the minified chunks, which is the only way to prove a capability is
 * really absent from a bundle rather than merely absent from its module registry.
 *
 * @param {string} entryFile path to the minified entry bundle
 * @param {string} distDir   dir the static closure must stay within
 * @returns {{ gz: number, raw: number, chunks: number, chunkFiles: string[] } | null} null if entry missing
 */
function measureEagerBootAt(entryFile, distDir) {
    if (!fs.existsSync(entryFile)) return null;
    const distRoot = path.resolve(distDir);
    const entry = path.resolve(entryFile);
    const visited = new Set();
    const chunks = new Set();
    const queue = [entry];
    while (queue.length) {
        const f = queue.pop();
        if (visited.has(f)) continue;
        visited.add(f);
        if (!fs.existsSync(f)) continue;
        const code = fs.readFileSync(f, "utf8");
        for (const spec of staticImportSpecifiers(code)) {
            if (!spec.startsWith(".")) continue; // skip bare/external (e.g. maplibre-gl)
            const resolved = path.resolve(path.dirname(f), spec);
            if (!resolved.startsWith(distRoot)) continue; // stay inside distDir
            if (!visited.has(resolved)) {
                queue.push(resolved);
                if (resolved !== entry) chunks.add(resolved);
            }
        }
    }
    let gz = gzipKB(entry) || 0;
    let raw = rawKB(entry) || 0;
    for (const c of chunks) {
        gz += gzipKB(c) || 0;
        raw += rawKB(c) || 0;
    }
    return { gz, raw, chunks: chunks.size, chunkFiles: [...chunks] };
}

/**
 * The SOURCE files inside a bundle's eager boot closure (S4).
 *
 * Walks the same static-import closure as {@link measureEagerBootAt}, then reads each
 * artifact's `.map` and unions its `sources` array. Minified chunks say nothing about what
 * went into them; their sourcemaps say everything.
 *
 * This is the primitive behind `size:example`, and the only honest way to check the claim
 * "capability X is not in this bundle". Checking `GeoLeaf._registry` would NOT do: a
 * capability can be absent from the registry (gated off at runtime) and still be sitting in
 * the file, downloaded on every page load. That gap is precisely the phantom saving S4 had
 * to close — the removed `lazy/{legend,labels,themes}` shells produced exactly it.
 *
 * @param {string} entryFile path to the minified entry bundle
 * @param {string} distDir   dir the static closure must stay within
 * @returns {string[] | null} source paths (as recorded in the sourcemaps), or null if the
 *   entry is missing. Empty array if the build carries no sourcemaps.
 */
function listEagerSources(entryFile, distDir) {
    const boot = measureEagerBootAt(entryFile, distDir);
    if (boot == null) return null;
    const sources = new Set();
    for (const artifact of [path.resolve(entryFile), ...boot.chunkFiles]) {
        const mapFile = `${artifact}.map`;
        if (!fs.existsSync(mapFile)) continue;
        let map;
        try {
            map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
        } catch (_e) {
            continue; // unreadable map — skip, never throw from a measurement
        }
        for (const s of map.sources || []) sources.add(s.replace(/\\/g, "/"));
    }
    return [...sources];
}

/**
 * The default full-bundle eager boot payload — the hard-gated CDN metric.
 * Thin wrapper over {@link measureEagerBootAt} with the fixed full entry/dist.
 * @returns {{ gz: number, raw: number, chunks: number } | null} null if entry missing
 */
function measureEagerBoot() {
    return measureEagerBootAt(BUNDLE_FILE, DIST);
}

/**
 * Generalized static-import closure from an arbitrary entry, staying inside
 * `rootDir`. Returns gzipped + raw KB of the entry plus every module it imports
 * STATICALLY (dynamic `import()` not followed). Unlike {@link measureEagerBootAt}
 * it resolves missing extensions, so it works on `preserveModules` outputs whose
 * import specifiers carry no `.js`. Consumed by `golden-master.cjs`.
 * @param {string} entryFile absolute path to the entry module
 * @param {string} rootDir   absolute dir the closure must stay within
 * @returns {{ gz: number, raw: number, modules: number } | null} null if entry missing
 */
function measureStaticClosure(entryFile, rootDir) {
    if (!fs.existsSync(entryFile)) return null;
    const root = path.resolve(rootDir);
    const entry = path.resolve(entryFile);
    const visited = new Set();
    const modules = new Set();
    const queue = [entry];
    while (queue.length) {
        const f = queue.pop();
        if (visited.has(f)) continue;
        visited.add(f);
        if (!fs.existsSync(f)) continue;
        const code = fs.readFileSync(f, "utf8");
        for (const spec of staticImportSpecifiers(code)) {
            if (!spec.startsWith(".")) continue; // skip bare/external (e.g. maplibre-gl)
            let resolved = path.resolve(path.dirname(f), spec);
            if (!fs.existsSync(resolved)) {
                if (fs.existsSync(`${resolved}.js`)) resolved = `${resolved}.js`;
                else if (fs.existsSync(path.join(resolved, "index.js")))
                    resolved = path.join(resolved, "index.js");
            }
            if (!resolved.startsWith(root)) continue; // stay inside this variant's dist
            if (!visited.has(resolved)) {
                queue.push(resolved);
                if (resolved !== entry) modules.add(resolved);
            }
        }
    }
    let gz = gzipKB(entryFile) || 0;
    let raw = rawKB(entryFile) || 0;
    for (const c of modules) {
        gz += gzipKB(c) || 0;
        raw += rawKB(c) || 0;
    }
    return { gz, raw, modules: modules.size };
}

/**
 * Gzipped + raw size of the core sourcemaps (entry map + all dist/chunks/*.map).
 * @returns {{ gz: number, raw: number, files: number } | null} null if no map found.
 */
function measureSourcemaps() {
    let gz = 0;
    let raw = 0;
    let files = 0;
    const add = (filePath) => {
        const g = gzipKB(filePath);
        if (g == null) return;
        gz += g;
        raw += rawKB(filePath);
        files += 1;
    };
    add(BUNDLE_MAP);
    if (fs.existsSync(CHUNKS_DIR)) {
        for (const name of fs.readdirSync(CHUNKS_DIR)) {
            if (name.endsWith(".map")) add(path.join(CHUNKS_DIR, name));
        }
    }
    return files === 0 ? null : { gz, raw, files };
}

/**
 * Checks the CDN bundle against the budget policy.
 * Hard gate = the eager boot payload (entry + statically-imported chunks).
 * @param {{ log?: typeof defaultLog }} [opts]
 * @returns {boolean} true if no hard budget is breached (build may proceed)
 */
function checkBundleSize(opts = {}) {
    const log = opts.log || defaultLog;
    log.section("📦 Budget bundle (@geoleaf/core)");

    const boot = measureEagerBoot();
    if (boot == null) {
        log.warn(
            `No built bundle found at ${path.relative(ROOT, BUNDLE_FILE)} — run a build first. Skipping budget check.`
        );
        return true;
    }

    const entryGz = gzipKB(BUNDLE_FILE);
    const entryRaw = rawKB(BUNDLE_FILE);
    const granularGz = gzipKB(GRANULAR_ENTRY);

    // The REAL boot cost: entry + the chunks it imports statically (the browser
    // loads them synchronously at boot). This is the hard-gated metric.
    log.info(
        `Boot payload (entry + ${boot.chunks} static chunks) : ${fmt(boot.gz)} gz / ${fmt(boot.raw)} raw — REAL load-time cost`
    );
    log.info(
        `            budget: warn > ${BOOT_WARN_GZ_KB} KB gz, fail > ${BOOT_FAIL_GZ_KB} KB gz`
    );
    log.info(
        `Entry only  geoleaf.esm.js : ${fmt(entryGz)} gz / ${fmt(entryRaw)} raw (a shim since kernel-exports — informational, NOT a budget)`
    );
    log.info(
        `Granular entry (bundlers, info only) : ${fmt(granularGz)} gz — dynamic import() chunks load on demand`
    );
    log.info("MapLibre GL JS — external peer dependency, out of bundle.");

    let ok = true;
    if (boot.gz > BOOT_FAIL_GZ_KB) {
        log.err(
            `Boot payload budget exceeded: ${boot.gz.toFixed(1)} KB gz > ${BOOT_FAIL_GZ_KB} KB gz. A heavy import likely leaked into the eager path (entry or a statically-imported chunk).`
        );
        ok = false;
    } else if (boot.gz > BOOT_WARN_GZ_KB) {
        log.warn(
            `Boot payload ${boot.gz.toFixed(1)} KB gz > ${BOOT_WARN_GZ_KB} KB gz soft threshold — review recent additions.`
        );
    } else {
        log.ok(`Boot payload within budget (${boot.gz.toFixed(1)} / ${BOOT_FAIL_GZ_KB} KB gz).`);
    }
    // Sourcemaps — tracked, soft-warn only. EMITTED, not shipped: see the file header.
    const maps = measureSourcemaps();
    if (maps == null) {
        log.info("Sourcemaps : none found (build without sourcemap, or pre-build) — skipping.");
    } else {
        log.info(
            `Sourcemaps (.map, ${maps.files} files) : ${fmt(maps.gz)} gz / ${fmt(maps.raw)} raw — build output, NOT in the npm tarball (JS maps excluded by files[])`
        );
        log.info(
            `            budget: warn > ${SOURCEMAP_WARN_GZ_KB} KB gz (soft — never fails the build)`
        );
        if (maps.gz > SOURCEMAP_WARN_GZ_KB) {
            log.warn(
                `Sourcemaps ${maps.gz.toFixed(1)} KB gz > ${SOURCEMAP_WARN_GZ_KB} KB gz soft threshold — check the sourcemap config (a regression may have inflated them).`
            );
        } else {
            log.ok(
                `Sourcemaps within soft budget (${maps.gz.toFixed(1)} / ${SOURCEMAP_WARN_GZ_KB} KB gz).`
            );
        }
    }

    return ok;
}

/**
 * Every key of `PLUGIN_BUDGETS_GZ_KB` must name a plugin that still exists in the
 * registry. Same doctrine as `test-scope.cjs`'s `assertExclusionKeysAlive()`: a
 * dead key is always an error (a plugin was renamed or removed and the override
 * wasn't re-keyed), whereas a plugin ABSENT from this table is the normal case —
 * it just falls back to `PLUGIN_DEFAULT_GZ_KB`.
 *
 * This is exactly the failure that let `offline-ui` (renamed from `storage` at
 * STRUCT S3.1) fall off its real 74/86 KB budget onto the default 40/60 KB one —
 * silently, because a stale object key is not a syntax error. `fail: 60` then
 * looked like "a heavy import leaked in" when nothing had leaked at all.
 *
 * @returns {void}
 */
function assertBudgetKeysAlive() {
    const alive = new Set(PLUGIN_BUNDLES.map((p) => p.name));
    const dead = Object.keys(PLUGIN_BUDGETS_GZ_KB).filter((name) => !alive.has(name));
    if (dead.length) {
        throw new Error(
            `check-bundle-size.cjs: PLUGIN_BUDGETS_GZ_KB names a plugin that no longer exists — ` +
                `it no longer overrides anything, and the plugin it meant has silently fallen back to ` +
                `PLUGIN_DEFAULT_GZ_KB.\n` +
                dead.map((name) => `  - "${name}"`).join("\n") +
                `\nKnown plugins: ${PLUGIN_BUNDLES.map((p) => p.name).join(", ")}\n` +
                `Re-key the entry on the plugin's current name, or remove it if the override no longer applies.`
        );
    }
}

/**
 * Every `.js` file a plugin ships, gzipped, in KB — entry included, lazy chunks included.
 *
 * This is the half B-107 was missing: the gate weighed `dist/<entry>.js` and nothing else,
 * so anything rollup moved into a `manualChunks` split left the budget WITHOUT A DECISION.
 * `.map` files are deliberately excluded — sourcemaps ship to npm but are never fetched by
 * a running page, and the core half of this script tracks them under their own soft budget.
 *
 * @param {string} distDir absolute path to the plugin's `dist/`
 * @returns {{ total: number, files: {name: string, gz: number}[] } | null} null if unbuilt
 */
function pluginDistWeight(distDir) {
    if (!fs.existsSync(distDir)) return null;
    const files = fs
        .readdirSync(distDir)
        .filter((f) => f.endsWith(".js"))
        .map((f) => ({ name: f, gz: gzipKB(path.join(distDir, f)) }))
        .filter((f) => f.gz != null)
        .sort((a, b) => b.gz - a.gz);
    if (!files.length) return null;
    return { total: files.reduce((s, f) => s + f.gz, 0), files };
}

/**
 * Verdict of one measurement against one { warn, fail } pair.
 * @returns {"fail"|"warn"|"ok"}
 */
function budgetVerdict(gz, budget) {
    if (gz > budget.fail) return "fail";
    if (gz > budget.warn) return "warn";
    return "ok";
}

/**
 * Checks each plugin against its per-plugin budgets — BOOT (entry alone) and TOTAL
 * (every emitted `.js`). See PLUGIN_BUDGETS_GZ_KB for why both are needed.
 * @param {{ log?: typeof defaultLog }} [opts]
 * @returns {boolean} true if no hard budget is breached (build may proceed)
 */
function checkPluginBundles(opts = {}) {
    const log = opts.log || defaultLog;
    assertBudgetKeysAlive();
    log.section("📦 Budget bundle (plugins) — boot (entrée) + total (tout le dist/)");

    let allOk = true;
    for (const { name, file } of PLUGIN_BUNDLES) {
        const budget = PLUGIN_BUDGETS_GZ_KB[name] || PLUGIN_DEFAULT_GZ_KB;
        const boot = gzipKB(file);
        if (boot == null) {
            log.warn(
                `${name}: no built bundle at ${path.relative(ROOT, file)} — run a build first. Skipping.`
            );
            continue;
        }
        const weight = pluginDistWeight(path.dirname(file));
        const total = weight ? weight.total : boot;
        const split = weight && weight.files.length > 1;

        const bootVerdict = budgetVerdict(boot, budget.boot);
        const totalVerdict = budgetVerdict(total, budget.total);
        if (bootVerdict === "fail" || totalVerdict === "fail") allOk = false;

        // A split plugin gets its chunk list printed on breach: "the total is over" is not
        // actionable on its own — which chunk grew is.
        const detail = split
            ? ` [${weight.files.map((f) => `${f.name} ${f.gz.toFixed(1)}`).join(" · ")}]`
            : "";

        if (bootVerdict === "fail") {
            log.err(
                `${name}: boot ${boot.toFixed(1)} KB gz > ${budget.boot.fail} KB gz (fail). A heavy import likely leaked into the entry.${detail}`
            );
        } else if (bootVerdict === "warn") {
            log.warn(
                `${name}: boot ${boot.toFixed(1)} KB gz > ${budget.boot.warn} KB gz (warn) — review recent additions.`
            );
        }

        // Only reported for a SPLIT plugin: on a single-file one the total IS the entry, so
        // printing it again would double every breach and make the gate look twice as loud as
        // it is. The budget still applies — `allOk` was computed above, before this guard.
        if (split && totalVerdict === "fail") {
            log.err(
                `${name}: total ${total.toFixed(1)} KB gz > ${budget.total.fail} KB gz (fail). A lazy chunk grew, or a new one appeared.${detail}`
            );
        } else if (split && totalVerdict === "warn") {
            log.warn(
                `${name}: total ${total.toFixed(1)} KB gz > ${budget.total.warn} KB gz (warn) — review the chunk list.${detail}`
            );
        }

        if (bootVerdict === "ok" && totalVerdict === "ok") {
            const totalCol = split ? ` · total ${total.toFixed(1)} / ${budget.total.fail}` : "";
            log.ok(`${name}: boot ${boot.toFixed(1)} / ${budget.boot.fail} KB gz${totalCol}`);
        }
    }
    return allOk;
}

/**
 * Checks the shipped kernel stylesheet against the CSS budget.
 * @param {{ log?: typeof defaultLog }} [opts]
 * @returns {boolean} true if the hard budget holds (build may proceed)
 */
function checkCssBundle(opts = {}) {
    const log = opts.log || defaultLog;
    log.section("🎨 Budget CSS (@geoleaf/core)");

    const file = path.join(DIST, "geoleaf-main.min.css");
    const gz = gzipKB(file);
    if (gz == null) {
        log.warn(
            `no built stylesheet at ${path.relative(ROOT, file)} — run a build first. Skipping.`
        );
        return true;
    }
    if (gz > CSS_FAIL_GZ_KB) {
        log.err(
            `geoleaf-main.min.css: ${gz.toFixed(1)} KB gz > ${CSS_FAIL_GZ_KB} KB gz (fail). ` +
                `Check for a duplicated @import (a nested one without layer() inlines its target twice).`
        );
        return false;
    }
    if (gz > CSS_WARN_GZ_KB) {
        log.warn(
            `geoleaf-main.min.css: ${gz.toFixed(1)} KB gz > ${CSS_WARN_GZ_KB} KB gz (warn) — review recent additions.`
        );
        return true;
    }
    log.ok(`geoleaf-main.min.css: ${gz.toFixed(1)} / ${CSS_FAIL_GZ_KB} KB gz`);
    return true;
}

module.exports = {
    checkBundleSize,
    checkPluginBundles,
    checkCssBundle,
    assertBudgetKeysAlive,
    // Exported for probe-gate-visibility.cjs's mutation test only — it plants a
    // dead key on this SAME object and asserts assertBudgetKeysAlive() throws, then
    // removes it. Not meant for consumption otherwise; the getter functions above
    // are the real API.
    PLUGIN_BUDGETS_GZ_KB,
    measureEagerBoot,
    measureEagerBootAt,
    measureStaticClosure,
    listEagerSources,
    gzipKB,
    BOOT_FAIL_GZ_KB,
    BOOT_WARN_GZ_KB,
    CSS_FAIL_GZ_KB,
    CSS_WARN_GZ_KB,
};

// Run standalone
if (require.main === module) {
    const withPlugins = process.argv.includes("--plugins");
    const coreOk = checkBundleSize();
    const cssOk = checkCssBundle();
    const pluginsOk = withPlugins ? checkPluginBundles() : true;
    process.exitCode = coreOk && cssOk && pluginsOk ? 0 : 1;
}
