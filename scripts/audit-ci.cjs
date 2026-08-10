#!/usr/bin/env node
/**
 * Security roadmap S3 (3.1) — CI gate: production dependency audit (M7).
 *
 * Runs `npm audit --omit=dev` and FAILS the build on any High or Critical
 * vulnerability in the PRODUCTION dependency tree. Dev-only advisories
 * (vitepress/esbuild, nyc/depcheck — documented in roadmap S2.5) are excluded
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

// ⚠️ REFUS DE CONCLURE SUR UNE MESURE VIDE — mesuré le 01/08/2026, et c'est la classe
// gitleaks prise par l'autre bout.
//
// Quand le registre est injoignable (réseau, proxy, runner sans sortie), `npm audit --json`
// ne CASSE PAS : il rend un objet d'erreur et sort **0** —
//
//     $ npm_config_registry=http://127.0.0.1:9 npm audit --json ; echo $?
//     { "message": "request to …/security/audits/quick failed, reason: ECONNREFUSED",
//       "error": { "summary": "", "detail": "" } }
//     0
//
// Cet objet n'a pas de `metadata.vulnerabilities`. Le `|| {}` qui suivait le transformait
// donc en « 0 high, 0 critical », et CETTE GATE BLOQUANTE DE SÉCURITÉ annonçait
// « ✅ No High/Critical production vulnerabilities » SANS AVOIR RIEN MESURÉ. Vérifié
// empiriquement avant correction : sortie verte, exit 0.
//
// Un verdict de sécurité rassurant sur zéro mesure est pire qu'aucun verdict, parce qu'on le
// croit. Cette gate est la GARDE (production, High/Critical) : elle doit refuser de conclure,
// pas rassurer. Son pendant informatif (`audit-dev-report.cjs`) fait l'inverse, et c'est
// délibéré — un rapport qui n'a rien à rapporter ne bloque personne.
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
