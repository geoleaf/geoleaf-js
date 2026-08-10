#!/usr/bin/env node
/**
 * Plugin Contract v1 conformity checker.
 *
 * Verifies every plugin package against the frozen architecture spec
 * (docs/specs/contrats/PLUGIN_ARCHITECTURE_SPEC.md §2/§9)
 * and the convergence roadmap
 * (_docs_projet/archives/roadmap_feature-plugin-architecture.md).
 *
 * Checks (PC-*):
 *   PC-01 src/entry.ts exists                          (§8)
 *   PC-02 entry.ts calls plugins.register()            (INV-REG)
 *   PC-03 register() meta is complete                  (INV-REG)
 *   PC-04 pure ESM — no require()/module.exports       (INV-ESM) — plugins' src/ only,
 *         __tests__/__mocks__ excluded (see PC-04-WIDE below for the full sweep)
 *   PC-05 package.json conformity                      (INV-ESM, §7)
 *   PC-07 no raw innerHTML outside Security helpers    (INV-SEC)
 *   PC-08 source files <= 700 lines                    (INV-FILE)
 *   PC-09 tests under src/__tests__/                   (§8)
 *   PC-10 maplibre-gl externalized => peerDependency   (INV-EXT)
 *   PC-11 version token in register()                  (INV-REG §4)
 *   PC-12 Rollup output geoleaf-<name>.plugin.js, ESM  (§7)
 *   PC-13 CSS via CSSOM — no <style>/postcss inject:true (INV-CSS)
 *
 *   PC-04-WIDE (Q2.4, roadmap_qualite-lint-typage-esm) — pure ESM across the WHOLE
 *         repo, not just plugins/src/: registry.all() × full package dir (tests and
 *         mocks included, not excluded), plus e2e/ and root-level *.js. The narrower
 *         PC-04 above stays as-is (scoped exclusion is deliberate for that check —
 *         see checkSources); this is a second, wider sweep with its own exception:
 *         a file that locally shims `const require = createRequire(import.meta.url)`
 *         is trusted — its require() calls target a genuine CommonJS file (`.cjs`,
 *         or an npm package resolved via a CJS-only `require.resolve` option), which
 *         is the one exception CLAUDE.md carves out of "ESM pur". `.cjs`/`.mjs` files
 *         are out of scope by extension (unambiguous either way).
 *
 * Modes:
 *   default        WARN — full report, always exit 0
 *   --fail         exit 1 if any non-grandfathered violation remains (S14)
 *   --plugin=<n>   restrict the scan to one plugin (per-sprint usage)
 *   --quiet        print the summary only
 *
 * Known limits: PC-03 extracts the register() argument with a naive balanced
 * parentheses walk (comments containing "(" may skew it) — acceptable in
 * WARN mode, revisit at S14 if needed.
 *
 * Usage: node scripts/verify-plugin-contract.cjs (from repo root)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// ─── Scanned plugins ──────────────────────────────────────────────────────────
// Derived from package.json#workspaces via the single registry (ARCHI S9.4), not
// hand-typed. The previous 13-entry literal was one of SEVEN copies of this list
// in the repo, and they had already drifted (knip.json still declared two packages
// deleted months earlier). The registry cannot disagree with npm, because npm and
// it read the same globs.
//
// `dir` is now the FULL repo-relative path ("packages/plugin-table"), not the bare
// basename it used to be — so ARCHI S10 moving plugins under `packages/plugins/`
// costs nothing here. Use `dirName` when the basename is what you mean.
//
// field-renderer is intentionally absent: it is a shared internal library
// (npm dependency, no runtime register()) — see spec §0 and EXCLUDED_LIBS below.
// feature-info + taxonomy were reclassified into @geoleaf/core (SR0).
const registry = require("./lib/packages.cjs");
const PLUGINS = registry.plugins().map((p) => ({
    dir: p.dir,
    dirName: p.dirName,
    name: p.pluginName,
    pkgName: p.name,
}));

// ─── Shared internal libraries — NOT plugins (spec §0) ────────────────────────
// A shared internal library is an ESM npm package imported by one or more
// plugins but which never calls register() and never enriches GeoLeaf.* — it is
// out of the Plugin Contract scope. Listed explicitly so the assertion below
// makes the exclusion executable, not merely documentary: re-adding one of
// these names to PLUGINS throws at load instead of silently auditing a library.
// ARCHI S4 — was "form-renderer", a name renamed away in June 2026. The assertion
// below could no longer match anything: it guarded a package that does not exist,
// so the exclusion had quietly become documentary again — the very failure mode the
// comment above says it exists to prevent.
const EXCLUDED_LIBS = ["field-renderer"];
for (const lib of EXCLUDED_LIBS) {
    if (PLUGINS.some((p) => p.name === lib || p.dirName === `plugin-${lib}`)) {
        throw new Error(
            `"${lib}" is a shared internal library (spec §0), not a plugin — remove it from PLUGINS.`
        );
    }
}

// ─── Grandfathered exceptions ─────────────────────────────────────────────────
// Documented transition-period exceptions (decisions of 2026-06-08). Each
// entry is reported as 🛡 and never counted as a violation, even with --fail.
// EMPTIED at S14 closure: the contract is frozen, 11/11 plugins compliant —
// no transition exception remains. The two former PC-NS entries (addpoi /
// storage deprecated namespace aliases) expired with the v1 freeze. The
// structure is kept dormant for any future RFC-approved exception.
const GRANDFATHERED = [];

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FAIL_MODE = args.includes("--fail");
const QUIET = args.includes("--quiet");
const pluginFlag = args.find((a) => a.startsWith("--plugin="));
const ONLY_PLUGIN = pluginFlag ? pluginFlag.split("=")[1] : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isCommentOnly(line) {
    const t = line.trim();
    return (
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith("*/") ||
        t === ""
    );
}

/** Recursively collect source files under dir, skipping excluded folders. */
function collectSources(dir, extensions, results, excludes = []) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!["node_modules", "dist", ".git", ...excludes].includes(e.name)) {
                collectSources(full, extensions, results, excludes);
            }
        } else if (extensions.test(e.name)) {
            results.push(full);
        }
    }
}

/** Extract the first register(...) argument block via balanced parentheses. */
function extractRegisterBlock(content) {
    const match = content.match(/plugins\s*\??\.\s*register\s*(?:\?\.)?\s*\(/);
    if (!match) return null;
    let depth = 1;
    const start = match.index + match[0].length;
    for (let i = start; i < content.length; i++) {
        const ch = content[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
            depth--;
            if (depth === 0) return content.slice(start, i);
        }
    }
    return content.slice(start);
}

function rel(full) {
    return path.relative(ROOT, full).replace(/\\/g, "/");
}

// ─── Checks ───────────────────────────────────────────────────────────────────
// Each check pushes findings: { check, level: "violation"|"info", message }

function checkEntry(plugin, ctx, findings) {
    // PC-01
    if (!fs.existsSync(ctx.entryPath)) {
        findings.push({
            check: "PC-01",
            level: "violation",
            message: `missing src/entry.ts`,
        });
        return;
    }
    const content = fs.readFileSync(ctx.entryPath, "utf8");

    // PC-02
    if (!/plugins\s*\??\.\s*register\s*(?:\?\.)?\s*\(/.test(content)) {
        findings.push({
            check: "PC-02",
            level: "violation",
            message: `entry.ts does not call plugins.register()`,
        });
    } else {
        // PC-03 — meta completeness inside the register() argument
        const block = extractRegisterBlock(content);
        if (block) {
            // A `type` field was required here until 19/07/2026. It classified plugins
            // for two console reports that have since merged into one, leaving the field
            // with no reader at all — so PC-03 no longer asks for it. See ARCHI S2.
            const required = [
                { key: "version", re: /\bversion\s*:/ },
                { key: "label", re: /\blabel\s*:/ },
                { key: "healthCheck", re: /\bhealthCheck\s*:/ },
            ];
            for (const { key, re } of required) {
                if (!re.test(block)) {
                    findings.push({
                        check: "PC-03",
                        level: "violation",
                        message: `register() meta is missing "${key}"`,
                    });
                }
            }
        }
    }

    // PC-11 — version token
    if (/GeoLeaf\._version/.test(content)) {
        findings.push({
            check: "PC-11",
            level: "violation",
            message: `register() uses GeoLeaf._version (core version) instead of the plugin's own injected token`,
        });
    } else if (/__GEOLEAF_VERSION__/.test(content)) {
        // unified token — target form, OK
    } else if (/__GEOLEAF_[A-Z_]+_VERSION__/.test(content)) {
        findings.push({
            check: "PC-11",
            level: "info",
            message: `dedicated version token — normalize to the unified __GEOLEAF_VERSION__ token in this plugin's sprint`,
        });
    } else {
        findings.push({
            check: "PC-11",
            level: "violation",
            message: `no version token found in entry.ts`,
        });
    }
}

function checkSources(plugin, ctx, findings) {
    const files = [];
    collectSources(ctx.srcPath, /\.(ts|js)$/, files, ["__tests__", "__mocks__"]);

    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n");

        lines.forEach((line, i) => {
            if (isCommentOnly(line)) return;
            // PC-04 — pure ESM
            if (/\brequire\s*\(/.test(line) || /\bmodule\.exports\b/.test(line)) {
                findings.push({
                    check: "PC-04",
                    level: "violation",
                    message: `CommonJS syntax at ${rel(file)}:${i + 1}`,
                });
            }
            // PC-07 — raw HTML injection outside Security helpers.
            // Conventions aligned with scripts/audit-innerhtml.cjs:
            // "// SAFE:" marker, empty-string clears and Security/escapeHtml
            // sanitized lines are accepted.
            // The marker is accepted on the assignment line OR an adjacent
            // line: prettier may split a long `innerHTML =` across lines and
            // push the `// SAFE:` comment onto the previous/next line (cf.
            // plugin-print S9→S13 false positive).
            if (line.includes("SAFE:")) return;
            if (i > 0 && lines[i - 1].includes("SAFE:")) return;
            if (i + 1 < lines.length && lines[i + 1].includes("SAFE:")) return;
            if (line.includes("escapeHtml") || line.includes("Security.")) return;
            if (/\.(innerHTML|outerHTML)\s*=\s*(""|'')\s*;?\s*$/.test(line)) return;
            if (
                /\.(innerHTML|outerHTML)\s*\+?=/.test(line) ||
                /\binsertAdjacentHTML\s*\(/.test(line) ||
                /\bdocument\.write\s*\(/.test(line)
            ) {
                findings.push({
                    check: "PC-07",
                    level: "violation",
                    message: `raw HTML injection at ${rel(file)}:${i + 1}`,
                });
            }
        });
    }

    // PC-08 — file size cap (includes CSS)
    const sizedFiles = [];
    collectSources(ctx.srcPath, /\.(ts|js|css)$/, sizedFiles, ["__tests__", "__mocks__"]);
    for (const file of sizedFiles) {
        const content = fs.readFileSync(file, "utf8");
        // wc -l semantics: a trailing newline does not start an extra line.
        const count = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
        if (count > 700) {
            findings.push({
                check: "PC-08",
                level: "violation",
                message: `${rel(file)} has ${count} lines (cap: 700)`,
            });
        }
    }
}

function checkCssInjection(plugin, ctx, findings) {
    // PC-13 — CSS injected CSP-safe (INV-CSS): plugin CSS must go through the
    // CSSOM (constructable stylesheets / applyCssText), never a <style> element.
    // A <style> element (and its textContent) is subject to `style-src` and is
    // blocked under a strict `style-src 'self'` (no 'unsafe-inline').

    // (a) rollup.config.mjs — postcss inject:true emits the styleInject helper,
    //     which creates a <style> at module-eval. Use inject: cspStyleInject.
    if (fs.existsSync(ctx.rollupPath)) {
        const rollup = fs.readFileSync(ctx.rollupPath, "utf8");
        if (/\binject\s*:\s*true\b/.test(rollup)) {
            findings.push({
                check: "PC-13",
                level: "violation",
                message: `rollup postcss uses inject:true (<style> via styleInject) — use inject: cspStyleInject or extract`,
            });
        }
    }

    // (b) src — a hand-rolled <style> element violates strict style-src.
    const files = [];
    collectSources(ctx.srcPath, /\.(ts|js)$/, files, ["__tests__", "__mocks__"]);
    for (const file of files) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
            if (isCommentOnly(line)) return;
            if (/createElement\s*\(\s*["']style["']\s*\)/.test(line)) {
                findings.push({
                    check: "PC-13",
                    level: "violation",
                    message: `<style> element created at ${rel(file)}:${i + 1} — inject CSS via the CSSOM (adoptedStyleSheets / applyCssText)`,
                });
            }
        });
    }
}

function checkPackageJson(plugin, ctx, findings) {
    // PC-05
    if (!fs.existsSync(ctx.pkgPath)) {
        findings.push({ check: "PC-05", level: "violation", message: `missing package.json` });
        return null;
    }
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(ctx.pkgPath, "utf8"));
    } catch (e) {
        findings.push({
            check: "PC-05",
            level: "violation",
            message: `unparseable package.json (${e.message})`,
        });
        return null;
    }
    if (pkg.type !== "module") {
        findings.push({
            check: "PC-05",
            level: "violation",
            message: `"type" must be "module" (got ${JSON.stringify(pkg.type)})`,
        });
    }
    if (pkg.name !== plugin.pkgName) {
        findings.push({
            check: "PC-05",
            level: "violation",
            message: `"name" is ${JSON.stringify(pkg.name)}, expected "${plugin.pkgName}"`,
        });
    }
    if (!/^\d+\.\d+\.\d+/.test(pkg.version || "")) {
        findings.push({
            check: "PC-05",
            level: "violation",
            message: `"version" is not SemVer (got ${JSON.stringify(pkg.version)})`,
        });
    }
    if (!pkg.license || typeof pkg.license !== "string") {
        findings.push({
            check: "PC-05",
            level: "violation",
            message: `"license" is missing or empty`,
        });
    }
    if (!pkg.publishConfig) {
        findings.push({
            check: "PC-05",
            level: "info",
            message: `no "publishConfig" — verify the target registry before publishing`,
        });
    }
    return pkg;
}

function checkRollup(plugin, ctx, pkg, findings) {
    // PC-12
    if (!fs.existsSync(ctx.rollupPath)) {
        findings.push({
            check: "PC-12",
            level: "violation",
            message: `missing rollup.config.mjs`,
        });
        return;
    }
    const content = fs.readFileSync(ctx.rollupPath, "utf8");
    const expectedBundle = `geoleaf-${plugin.name}.plugin.js`;
    if (!content.includes(expectedBundle)) {
        findings.push({
            check: "PC-12",
            level: "violation",
            message: `Rollup output is not "${expectedBundle}"`,
        });
    }
    if (!/format:\s*["']es["']/.test(content)) {
        findings.push({
            check: "PC-12",
            level: "violation",
            message: `Rollup output format is not "es"`,
        });
    }

    // PC-10 — maplibre externalized => peerDependency declared
    if (pkg) {
        const externalizesMaplibre = /maplibre-gl/.test(content);
        const peer = pkg.peerDependencies && pkg.peerDependencies["maplibre-gl"];
        const dep = pkg.dependencies && pkg.dependencies["maplibre-gl"];
        if (externalizesMaplibre && !peer) {
            findings.push({
                check: "PC-10",
                level: "violation",
                message: `maplibre-gl referenced in rollup.config.mjs but missing from peerDependencies`,
            });
        }
        if (dep) {
            findings.push({
                check: "PC-10",
                level: "violation",
                message: `maplibre-gl must be a peerDependency, not a dependency (it would be bundled)`,
            });
        }
    }
}

function checkTests(plugin, ctx, findings) {
    // PC-09 — tests live under src/__tests__/
    const testsDir = path.join(ctx.srcPath, "__tests__");
    let hasTestFiles = false;
    if (fs.existsSync(testsDir)) {
        const testFiles = [];
        collectSources(testsDir, /\.test\.(ts|js)$/, testFiles);
        hasTestFiles = testFiles.length > 0;
    }
    if (!hasTestFiles) {
        findings.push({
            check: "PC-09",
            level: "violation",
            message: `no test files under src/__tests__/ (canonical location)`,
        });
    }
}

// ─── PC-04-WIDE — ESM purity, whole repo ──────────────────────────────────────
// Q2.4 (roadmap_qualite-lint-typage-esm). registry.all() covers packages that PLUGINS
// never did — core, the 2 internal libs, build-config, apps/geoleaf-app — and the full
// package directory, not just src/: __tests__ and __mocks__ ARE in scope here, unlike
// checkSources' PC-04. e2e/ and root-level *.js are scanned too — the two other CJS
// foyers this sprint closed.
const registryAll = registry.all().map((p) => path.join(ROOT, p.dir));
const ROOT_JS = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => !e.isDirectory() && /\.js$/.test(e.name))
    .map((e) => path.join(ROOT, e.name));

function scanEsmPurityWide() {
    const findings = [];
    const zones = [
        ...registryAll.map((dir) => ({ dir, label: null })),
        { dir: "e2e", label: "e2e/" },
    ];

    for (const { dir, label } of zones) {
        const files = [];
        collectSources(dir, /\.(ts|js)$/, files, []);
        for (const file of files) {
            const content = fs.readFileSync(file, "utf8");
            // A file that locally shims require() via createRequire is trusted — see
            // header comment. Its require() calls target a genuine CommonJS file.
            if (content.includes("createRequire(")) continue;
            const lines = content.split("\n");
            lines.forEach((line, i) => {
                if (isCommentOnly(line)) return;
                if (/\brequire\s*\(/.test(line) || /\bmodule\.exports\b/.test(line)) {
                    findings.push({
                        check: "PC-04-WIDE",
                        level: "violation",
                        message: `CommonJS syntax at ${rel(file)}:${i + 1} (zone: ${label || rel(dir)})`,
                    });
                }
            });
        }
    }

    // Root-level *.js — non-recursive, scripts/ stays out of scope by arbitrage.
    for (const file of ROOT_JS) {
        const content = fs.readFileSync(file, "utf8");
        if (content.includes("createRequire(")) continue;
        const lines = content.split("\n");
        lines.forEach((line, i) => {
            if (isCommentOnly(line)) return;
            if (/\brequire\s*\(/.test(line) || /\bmodule\.exports\b/.test(line)) {
                findings.push({
                    check: "PC-04-WIDE",
                    level: "violation",
                    message: `CommonJS syntax at ${rel(file)}:${i + 1} (zone: root)`,
                });
            }
        });
    }

    return findings;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

function isGrandfathered(pluginName, check) {
    return GRANDFATHERED.find((g) => g.plugin === pluginName && g.check === check);
}

function scanPlugin(plugin) {
    const base = path.join(ROOT, plugin.dir);
    const ctx = {
        srcPath: path.join(base, "src"),
        entryPath: path.join(base, "src", "entry.ts"),
        pkgPath: path.join(base, "package.json"),
        rollupPath: path.join(base, "rollup.config.mjs"),
    };
    const findings = [];
    checkEntry(plugin, ctx, findings);
    checkSources(plugin, ctx, findings);
    checkCssInjection(plugin, ctx, findings);
    const pkg = checkPackageJson(plugin, ctx, findings);
    checkRollup(plugin, ctx, pkg, findings);
    checkTests(plugin, ctx, findings);

    // Split findings into violations / grandfathered / infos
    const violations = [];
    const shielded = [];
    const infos = [];
    for (const f of findings) {
        if (f.level === "info") {
            infos.push(f);
        } else if (isGrandfathered(plugin.name, f.check)) {
            shielded.push({ ...f, grandfathered: isGrandfathered(plugin.name, f.check) });
        } else {
            violations.push(f);
        }
    }
    return { plugin, violations, shielded, infos };
}

const targets = ONLY_PLUGIN ? PLUGINS.filter((p) => p.name === ONLY_PLUGIN) : PLUGINS;
if (ONLY_PLUGIN && targets.length === 0) {
    console.error(
        `Unknown plugin "${ONLY_PLUGIN}". Known: ${PLUGINS.map((p) => p.name).join(", ")}`
    );
    process.exit(1);
}

const results = targets.map(scanPlugin);

if (!QUIET) {
    console.log("Plugin Contract v1 — conformity report");
    console.log("(spec: docs/specs/contrats/PLUGIN_ARCHITECTURE_SPEC.md)\n");
    for (const { plugin, violations, shielded, infos } of results) {
        const status = violations.length === 0 ? "✅" : "⚠️ ";
        console.log(`${status} ${plugin.pkgName} (${plugin.dir})`);
        for (const v of violations) {
            console.log(`   ⚠️  [${v.check}] ${v.message}`);
        }
        for (const s of shielded) {
            console.log(
                `   🛡  [${s.check}] GRANDFATHERED (until ${s.grandfathered.until}) — ${s.grandfathered.reason}`
            );
        }
        for (const i of infos) {
            console.log(`   ℹ️  [${i.check}] ${i.message}`);
        }
    }
    console.log("");
}

const totalViolations = results.reduce((n, r) => n + r.violations.length, 0);
const totalShielded = results.reduce((n, r) => n + r.shielded.length, 0);
const totalInfos = results.reduce((n, r) => n + r.infos.length, 0);
const compliant = results.filter((r) => r.violations.length === 0).length;

console.log(
    `${compliant}/${results.length} plugins compliant — ${totalViolations} violation(s), ` +
        `${totalShielded} grandfathered, ${totalInfos} info(s) — mode ${FAIL_MODE ? "FAIL" : "WARN"}`
);

// PC-04-WIDE runs regardless of --plugin — it sweeps the whole repo, not one plugin.
const wideFindings = scanEsmPurityWide();
if (!QUIET) {
    const status = wideFindings.length === 0 ? "✅" : "⚠️ ";
    console.log(
        `\n${status} PC-04-WIDE — ESM purity, whole repo (registry.all() × full package + e2e/ + root)`
    );
    for (const f of wideFindings) {
        console.log(`   ⚠️  [${f.check}] ${f.message}`);
    }
}
console.log(
    `PC-04-WIDE: ${wideFindings.length} violation(s) — mode ${FAIL_MODE ? "FAIL" : "WARN"}`
);

if (FAIL_MODE && (totalViolations > 0 || wideFindings.length > 0)) {
    console.error("\nERROR: non-grandfathered violations remain (Plugin Contract v1).");
    process.exit(1);
}
process.exit(0);
