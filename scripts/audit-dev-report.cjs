#!/usr/bin/env node
/**
 * Roadmap nettoyage — Sprint 1 (tâche 1.5, S-4) — visibility-only audit gate.
 *
 * Runs `npm audit --json` on the FULL dependency tree (prod + dev) and logs
 * every High/Critical advisory found, WITHOUT failing the build. The blocking
 * gate (`scripts/audit-ci.cjs`) already covers production dependencies; this
 * step exists only so a new devDependency vulnerability is visible in CI logs
 * the day it appears — it never turns the pipeline red, because some current
 * dev-only advisories (vite/esbuild via vitepress) have no available fix and
 * would otherwise leave the gate permanently, uselessly red.
 *
 * Usage: node scripts/audit-dev-report.cjs (from repo root)
 */

const { spawnSync } = require("node:child_process");

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPM_SHELL = process.platform === "win32";
const REPORT_LEVELS = ["high", "critical"];

function runAudit() {
    const res = spawnSync(NPM, ["audit", "--json"], {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: NPM_SHELL,
        maxBuffer: 32 * 1024 * 1024,
    });

    // ⚠️ UN INCIDENT D'INFRASTRUCTURE N'EST PAS UN VERDICT, et cette gate est INFORMATIVE.
    //
    // Ces deux chemins sortaient en 1. Or l'étape qui les lance s'appelle « Security audit —
    // full dependency tree (informational, non-blocking) » et n'a AUCUN `continue-on-error`
    // (mesuré le 01/08/2026 : 0 occurrence dans tout `ci.yml`). Un hoquet de
    // `registry.npmjs.org` — réseau, proxy, timeout — transformait donc une étape déclarée
    // informative en ÉCHEC DUR du job, pendant que le poste, servi par son `~/.npm/_cacache`,
    // sortait 0. Vert local, rouge distant, sans qu'une ligne de code ait bougé.
    //
    // Le libellé disait la vérité sur l'INTENTION et le code disait l'inverse. On aligne le
    // code : cette gate ne rend un verdict que lorsqu'elle a pu MESURER quelque chose. Elle
    // n'a jamais bloqué sur une vulnérabilité (`process.exit(0)` en fin de fichier) — elle ne
    // doit pas davantage bloquer sur son propre outillage.
    //
    // ⚠️ Ce qu'on accepte en échange, et c'est le vrai coût : un `npm audit` qui échoue
    // silencieusement N'AVERTIT PLUS DE RIEN. D'où le message en ERROR, bruyant, et le fait
    // que la gate BLOQUANTE de sécurité — `audit-ci.cjs`, prod-only, High/Critical — garde
    // son `exit 1`. Celle-ci est un rapport ; celle-là est la garde.
    const bail = (msg, detail) => {
        console.error(`ERROR [audit-dev-report]: ${msg}`);
        if (detail) console.error(detail);
        console.error(
            "  → gate INFORMATIVE : aucun verdict rendu, sortie 0. La gate bloquante " +
                "(audit-ci.cjs, dépendances de production) est inchangée."
        );
        process.exit(0);
    };

    if (!res.stdout) {
        bail("npm audit produced no output.", res.stderr && res.stderr.trim());
        return null;
    }

    try {
        return JSON.parse(res.stdout);
    } catch (e) {
        bail(`could not parse npm audit JSON — ${e.message}`, res.stdout.slice(0, 2000));
        return null;
    }
}

const report = runAudit();

// Même mesure vide que dans `audit-ci.cjs` (voir son commentaire pour la démonstration),
// traitée à l'INVERSE parce que cette gate-ci est un RAPPORT et non une garde : elle le dit
// fort et sort 0. Ce qui compte est qu'elle ne prétende plus « aucune advisory » alors
// qu'elle n'a rien pu mesurer.
if (!report || !report.metadata || !report.metadata.vulnerabilities) {
    console.error("ERROR [audit-dev-report]: le rapport npm audit ne porte AUCUN décompte.");
    if (report && report.message) console.error(`  motif npm : ${report.message}`);
    console.error(
        "  → gate INFORMATIVE : aucun verdict rendu, sortie 0. La garde bloquante\n" +
            "    (audit-ci.cjs, dépendances de production) REFUSE de conclure dans ce cas."
    );
    process.exit(0);
}
const counts = report.metadata.vulnerabilities; // garanti non nul par la garde ci-dessus
const high = counts.high || 0;
const critical = counts.critical || 0;
const moderate = counts.moderate || 0;
const low = counts.low || 0;
const notable = high + critical;

if (notable > 0) {
    console.warn(
        `⚠️  [audit-dev-report] ${notable} High/Critical advisor${notable === 1 ? "y" : "ies"} ` +
            "across the FULL dependency tree (prod+dev) — informational only, does not fail CI:"
    );
    const vulns = report.vulnerabilities || {};
    for (const [name, v] of Object.entries(vulns)) {
        if (REPORT_LEVELS.includes(v.severity)) {
            const fix = v.fixAvailable ? "fix available" : "no fix available";
            console.warn(`  - ${name} (${v.severity}, ${fix})`);
        }
    }
    console.warn(
        "   Production dependencies are already blocking via scripts/audit-ci.cjs. " +
            "Review this list when triaging security work."
    );
} else {
    console.log(
        `✅ [audit-dev-report] No High/Critical advisories (moderate: ${moderate}, low: ${low}).`
    );
}

// Always exit 0 — this step is visibility-only, never a blocking gate.
process.exit(0);
