#!/usr/bin/env node
/**
 * audit-cleanup.cjs
 *
 * Orchestrateur d'audit pour la campagne cleanup GeoLeaf-JS.
 * Lance sequentiellement : knip → ts-prune → depcheck (x3) → jscpd → madge (x3) → purgecss
 * Sauvegarde les rapports bruts JSON dans _docs_projet/travail/audits/
 *
 * Usage: node scripts/audit-cleanup.cjs
 */

"use strict";

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Patch minimatch for Node 24+ compatibility.
// depcheck 1.4.7 uses `const { default: minimatch } = require('minimatch')` but
// minimatch v9+ no longer exposes a .default property in CJS interop.
(function patchMinimatch() {
    try {
        const mm = require("minimatch");
        if (typeof mm.default === "undefined" && typeof mm.minimatch === "function") {
            Object.defineProperty(mm, "default", {
                value: mm.minimatch,
                writable: true,
                configurable: true,
            });
        }
    } catch (_) {}
})();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = path.resolve(__dirname, "..");

// ⚠️ SAUT NOMMÉ — ce script ÉCRIT dans l'atelier, qui n'existe pas sur le dépôt public.
//
// Troisième et dernier lecteur d'`internal()`, traité comme les deux autres pour que la règle
// soit uniforme : un lecteur du corpus interne saute, en le disant, quand le corpus n'est pas
// là. ⚠️ Il n'est PAS câblé dans `ci:local` — contrairement aux deux autres —, donc il ne
// bloquait rien ; il aurait planté au visage d'un contributeur du dépôt public qui le lance,
// ce qui est un défaut d'accueil et pas un défaut de gate.
if (!docsPaths.internalRootExists()) {
    console.log(
        "⏭️  [AUDIT-CLEANUP] SAUTÉ — la racine INTERNE est absente : " +
            docsPaths.rel(docsPaths.INTERNAL_ROOT)
    );
    console.log(
        "    Ce n'est pas un vert : aucun audit n'a été lancé, et rien n'a été écrit. Ce\n" +
            "    script produit des sorties d'ATELIER ; sur le dépôt public elles n'ont pas de\n" +
            "    destination. Ailleurs, poser GEOLEAF_INTERNAL_DOCS_ROOT."
    );
    process.exit(0);
}

// Racine INTERNE : les sorties brutes d'audit ne partent pas dans le dépôt public.
// ⚠️ Le répertoire lui-même n'existe pas aujourd'hui — ce script le crée. Ce qui est
// gardé ici est sa RACINE, pas le sous-répertoire : c'est le seul niveau qui bouge.
const AUDIT_DIR = docsPaths.internal("travail", "audits");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);

const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m",
};

const c = (col, str) => `${colors[col]}${str}${colors.reset}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(c("cyan", `  Created: ${path.relative(ROOT, dir)}`));
    }
}

function saveReport(filename, content) {
    const outPath = path.join(AUDIT_DIR, filename);
    fs.writeFileSync(outPath, content, "utf8");
    console.log(c("green", `  Saved:   ${path.relative(ROOT, outPath)}`));
}

function runTool(label, cmd, opts = {}) {
    console.log(c("bold", `\n[${label}]`) + " Running: " + c("cyan", cmd));
    try {
        const result = execSync(cmd, {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 50 * 1024 * 1024, // 50 MB
            ...opts,
        });
        return { ok: true, output: result || "" };
    } catch (err) {
        // Many audit tools exit with code != 0 when issues are found — that is normal.
        const output = (err.stdout || "") + (err.stderr || "");
        if (!output && !err.stdout) {
            console.warn(c("yellow", `  Warning: no output captured (exit ${err.status})`));
        }
        return { ok: false, output: output || "", exitCode: err.status };
    }
}

/**
 * Discover every workspace under packages/ (excludes `_*` templates and any
 * folder without both `src/` and `package.json`). Resolves a madge entry point
 * per package: core → bundle entry, field-renderer → index, plugins → entry.
 * @returns {Array<{name: string, dir: string, entry: string|null, tsconfig: string|null}>}
 */
function discoverPackages() {
    const out = [];
    // ARCHI S9.5 — from the workspace registry, not a one-level readdirSync.
    for (const pkg of require("./lib/packages.cjs").all()) {
        const e = { name: pkg.dirName };
        const dir = pkg.absDir;
        if (!fs.existsSync(path.join(dir, "src"))) continue;
        const candidates =
            e.name === "core"
                ? ["src/bundle-esm-entry.ts"]
                : ["src/entry.ts", "src/index.ts", "src/public-api.ts"];
        let entry = null;
        for (const cand of candidates) {
            if (fs.existsSync(path.join(dir, cand))) {
                entry = cand;
                break;
            }
        }
        out.push({
            name: e.name,
            dir,
            entry,
            tsconfig: fs.existsSync(path.join(dir, "tsconfig.json"))
                ? `packages/${e.name}/tsconfig.json`
                : null,
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function runKnip() {
    const { output } = runTool("knip", "npx knip --reporter json");
    let parsed;
    try {
        parsed = JSON.parse(output);
    } catch {
        // knip may print warnings before the JSON — extract the JSON part
        const jsonStart = output.indexOf("{");
        const jsonEnd = output.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
            try {
                parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
            } catch {
                parsed = { raw: output, error: "Could not parse JSON" };
            }
        } else {
            parsed = { raw: output, error: "No JSON found in output" };
        }
    }
    saveReport("knip-report.json", JSON.stringify(parsed, null, 2));
}

function runTsPrune() {
    // ts-prune outputs text lines: "file.ts:line - symbolName (used in module)"
    // T5.5 — le `--project` vient du registre. Un chemin périmé ferait sortir ts-prune en
    // erreur d'outil, que `runTool` avale : l'audit conclurait « 0 export inutilisé ».
    const corePkg = require("./lib/packages.cjs").requireByDirName("core");
    const tsconfig = path.posix.join(corePkg.dir, "tsconfig.json");
    const { output } = runTool("ts-prune", `npx ts-prune --project ${tsconfig}`, {
        stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = output
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
            const match = l.match(/^(.+):(\d+) - (.+?)(\s+\(used in module\))?$/);
            if (!match) return { raw: l };
            return {
                file: match[1],
                line: parseInt(match[2], 10),
                symbol: match[3].trim(),
                usedInModule: !!match[4],
            };
        });
    saveReport(
        "ts-prune-report.json",
        JSON.stringify({ timestamp: TIMESTAMP, count: lines.length, items: lines }, null, 2)
    );
}

async function runDepcheck() {
    // Uses programmatic API instead of CLI to avoid minimatch.default crash on Node 24.
    // Covers every workspace (was: core + storage + addpoi only).
    const depcheck = require("depcheck");
    const packages = discoverPackages();
    for (const pkg of packages) {
        console.log(
            c("bold", `\n[depcheck:${pkg.name}]`) +
                " Running programmatic API on " +
                c("cyan", pkg.dir)
        );
        try {
            const result = await new Promise((resolve) => {
                depcheck(pkg.dir, { skipMissing: false }, (unused) => resolve(unused));
            });
            saveReport(
                `depcheck-${pkg.name}.json`,
                JSON.stringify({ timestamp: TIMESTAMP, package: pkg.name, ...result }, null, 2)
            );
        } catch (err) {
            console.warn(c("yellow", `  depcheck:${pkg.name} error: ${err.message}`));
            saveReport(
                `depcheck-${pkg.name}.json`,
                JSON.stringify(
                    { timestamp: TIMESTAMP, package: pkg.name, error: err.message },
                    null,
                    2
                )
            );
        }
    }
}

function runJscpd() {
    // jscpd --reporters json writes to ./report/jscpd-report.json by default
    // We redirect to our audit dir with --output
    const jscpdOut = path.join(AUDIT_DIR, "jscpd-raw");
    ensureDir(jscpdOut);
    // Scan every workspace src/ (was: core only) to baseline plugin duplication.
    const srcArgs = discoverPackages()
        .map((p) => `packages/${p.name}/src`)
        .join(" ");
    const { output } = runTool(
        "jscpd",
        `npx jscpd ${srcArgs} --reporters json --output "${jscpdOut}" --min-lines 5 --min-tokens 50 --ignore "**/__tests__/**,**/dist/**,**/node_modules/**"`
    );
    // jscpd writes jscpd-report.json inside the output dir
    const reportFile = path.join(jscpdOut, "jscpd-report.json");
    if (fs.existsSync(reportFile)) {
        const raw = fs.readFileSync(reportFile, "utf8");
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = { raw, error: "Could not parse JSON" };
        }
        saveReport(
            "jscpd-report.json",
            JSON.stringify({ timestamp: TIMESTAMP, ...parsed }, null, 2)
        );
    } else {
        saveReport(
            "jscpd-report.json",
            JSON.stringify(
                { timestamp: TIMESTAMP, error: "jscpd report file not found", stdout: output },
                null,
                2
            )
        );
    }
}

function parseMadgeOutput(output) {
    let parsed;
    try {
        parsed = JSON.parse(output);
    } catch {
        const jsonStart = output.indexOf("{");
        const jsonEnd = output.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
            try {
                parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
            } catch {
                parsed = { error: "Could not parse JSON" };
            }
        } else {
            parsed = { error: "No JSON found in output" };
        }
    }
    return parsed;
}

function runMadge() {
    // One dependency graph per workspace (was: core + storage + addpoi only).
    const targets = discoverPackages();

    for (const target of targets) {
        if (!target.entry) {
            console.warn(
                c("yellow", `  Skipping madge for ${target.name} — no entry point resolved`)
            );
            saveReport(
                `madge-${target.name}.json`,
                JSON.stringify(
                    { timestamp: TIMESTAMP, skipped: true, reason: "no entry point resolved" },
                    null,
                    2
                )
            );
            continue;
        }
        const entryAbs = path.join(target.dir, target.entry);
        const tsconfigAbs = target.tsconfig ? path.join(ROOT, target.tsconfig) : null;
        const tsconfigFlag =
            tsconfigAbs && fs.existsSync(tsconfigAbs) ? `--ts-config "${tsconfigAbs}" ` : "";
        const { output } = runTool(
            `madge:${target.name}`,
            `npx madge --json ${tsconfigFlag}"${entryAbs}"`
        );
        const parsed = parseMadgeOutput(output);
        const moduleCount =
            typeof parsed === "object" && !parsed.error ? Object.keys(parsed).length : "unknown";
        saveReport(
            `madge-${target.name}.json`,
            JSON.stringify(
                { timestamp: TIMESTAMP, package: target.name, moduleCount, graph: parsed },
                null,
                2
            )
        );
    }
}

async function runPurgecss() {
    // Uses programmatic API via the shared config (also consumed by the CI
    // dead-CSS gate, scripts/verify-purgecss.cjs) — single source of truth for
    // CSS sources, content globs and safelist. S7.2 widened content to every
    // workspace + HTML templates / demo.
    const { purge } = require("./lib/purgecss-config.cjs");

    console.log(c("bold", "\n[purgecss]") + " Running programmatic API on all workspace CSS");

    const { cssFiles, results } = await purge();

    if (cssFiles.length === 0) {
        saveReport(
            "purgecss-report.json",
            JSON.stringify({ timestamp: TIMESTAMP, error: "No CSS files found" }, null, 2)
        );
        return;
    }

    console.log(`  Found ${cssFiles.length} CSS files`);

    const summary = results.map((r) => ({
        file: r._file ? path.relative(ROOT, r._file).replace(/\\/g, "/") : "unknown",
        rejectedCount: r.rejected ? r.rejected.length : 0,
        rejected: r.rejected || [],
    }));

    const totalRejected = summary.reduce((n, r) => n + r.rejectedCount, 0);
    saveReport(
        "purgecss-report.json",
        JSON.stringify(
            { timestamp: TIMESTAMP, cssFiles: cssFiles.length, totalRejected, files: summary },
            null,
            2
        )
    );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log(c("bold", "\n=== GeoLeaf-JS Audit Cleanup ==="));
    console.log(`Timestamp : ${TIMESTAMP}`);
    console.log(`Output    : ${path.relative(ROOT, AUDIT_DIR)}\n`);

    ensureDir(AUDIT_DIR);

    const steps = [
        { name: "knip", fn: runKnip },
        { name: "ts-prune", fn: runTsPrune },
        { name: "depcheck", fn: runDepcheck },
        { name: "jscpd", fn: runJscpd },
        { name: "madge", fn: runMadge },
        { name: "purgecss", fn: runPurgecss },
    ];

    const results = [];
    for (const step of steps) {
        try {
            await step.fn();
            results.push({ tool: step.name, status: "ok" });
        } catch (err) {
            console.error(c("red", `  Error running ${step.name}: ${err.message}`));
            results.push({ tool: step.name, status: "error", message: err.message });
        }
    }

    // Summary
    saveReport(
        "audit-summary.json",
        JSON.stringify({ timestamp: TIMESTAMP, steps: results }, null, 2)
    );

    console.log(c("bold", "\n=== Summary ==="));
    for (const r of results) {
        const icon = r.status === "ok" ? c("green", "✔") : c("red", "✘");
        console.log(`  ${icon} ${r.tool}`);
    }
    console.log();

    const failed = results.filter((r) => r.status === "error");
    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error(c("red", `Fatal: ${err.message}`));
    process.exit(1);
});
