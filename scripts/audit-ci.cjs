#!/usr/bin/env node
/**
 * Security roadmap S3 (3.1) — CI gate: production dependency audit (M7).
 *
 * Runs `npm audit --omit=dev` and FAILS the build on any High or Critical
 * vulnerability in the PRODUCTION dependency tree. Dev-only advisories
 * (vitepress/esbuild, nyc/depcheck — documented) are excluded
 * via `--omit=dev` and never block the gate.
 *
 * Usage: node scripts/audit-ci.cjs (from repo root)
 *
 * NOTE: GitHub Actions CI is frozen until 2026-07-01; this gate is wired into
 * .github/workflows/ci.yml but only executes on the first push after the thaw.
 */

const { spawnSync } = require("node:child_process");

// On Windows `npm` resolves to npm.cmd, which Node refuses to spawn without a
// shell (CVE-2024-27980). The gate runs on CI (ubuntu) and WSL where shell:false
// is honoured; Windows keeps the shell only because of the .cmd wrapper.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPM_SHELL = process.platform === "win32";
const FAIL_LEVELS = ["high", "critical"];

function runAudit() {
    const res = spawnSync(NPM, ["audit", "--omit=dev", "--json"], {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: NPM_SHELL,
        maxBuffer: 32 * 1024 * 1024,
    });

    // `npm audit` exits non-zero when advisories exist; the JSON report is still
    // written to stdout, so a non-zero status alone is not an error here.
    if (!res.stdout) {
        console.error("ERROR [audit-ci]: npm audit produced no output.");
        if (res.stderr) console.error(res.stderr.trim());
        process.exit(1);
    }

    try {
        return JSON.parse(res.stdout);
    } catch (e) {
        console.error("ERROR [audit-ci]: could not parse npm audit JSON —", e.message);
        console.error(res.stdout.slice(0, 2000));
        process.exit(1);
    }
}

const report = runAudit();

// ⚠️ REFUSAL TO CONCLUDE ON AN EMPTY MEASUREMENT — measured on 2026-08-01, and it
// is the gitleaks class taken from the other end.
//
// When the registry is unreachable (network, proxy, runner without egress),
// `npm audit --json` does NOT BREAK: it returns an error object and exits **0** —
//
//     $ npm_config_registry=http://127.0.0.1:9 npm audit --json ; echo $?
//     { "message": "request to …/security/audits/quick failed, reason: ECONNREFUSED",
//       "error": { "summary": "", "detail": "" } }
//     0
//
// That object has no `metadata.vulnerabilities`. The `|| {}` that followed thus
// turned it into "0 high, 0 critical", and THIS BLOCKING SECURITY GATE announced
// "✅ No High/Critical production vulnerabilities" HAVING MEASURED NOTHING. Verified
// empirically before the fix: green output, exit 0.
//
// A reassuring security verdict on zero measurement is worse than no verdict,
// because it gets believed. This gate is the GUARD (production, High/Critical): it
// must refuse to conclude, not reassure. Its informative counterpart
// (`audit-dev-report.cjs`) does the opposite, deliberately — a report with nothing
// to report blocks nobody.
if (!report.metadata || !report.metadata.vulnerabilities) {
    console.error("ERROR [audit-ci]: le rapport npm audit ne porte AUCUN décompte.");
    if (report.message) console.error(`  motif npm : ${report.message}`);
    console.error(
        "  → REFUS DE CONCLURE. Un « aucune vulnérabilité » sur une mesure vide serait vrai\n" +
            "    et vide de sens. Vérifier l'accès au registre, puis relancer."
    );
    process.exit(1);
}

const counts = report.metadata.vulnerabilities;
const high = counts.high || 0;
const critical = counts.critical || 0;
const blocking = high + critical;

if (blocking > 0) {
    const plural = blocking === 1 ? "y" : "ies";
    console.error(
        `ERROR [audit-ci]: ${blocking} blocking production vulnerabilit${plural} ` +
            `(${critical} critical, ${high} high). Run \`npm audit --omit=dev\` for details.`
    );
    // List the offending advisories when the npm v7+ schema is available.
    const vulns = report.vulnerabilities || {};
    for (const [name, v] of Object.entries(vulns)) {
        if (FAIL_LEVELS.includes(v.severity)) {
            console.error(`  - ${name} (${v.severity})`);
        }
    }
    process.exit(1);
}

const moderate = counts.moderate || 0;
const low = counts.low || 0;
console.log(
    "✅ [audit-ci] No High/Critical production vulnerabilities " +
        `(moderate: ${moderate}, low: ${low}; dev-only advisories excluded).`
);
process.exit(0);
