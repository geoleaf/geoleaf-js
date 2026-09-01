#!/usr/bin/env node
/**
 * Visibility-only audit gate.
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

    // ⚠️ AN INFRASTRUCTURE INCIDENT IS NOT A VERDICT, and this gate is INFORMATIVE.
    //
    // These two paths exited 1. Yet the step launching them is named "Security audit —
    // full dependency tree (informational, non-blocking)" and has NO
    // `continue-on-error` (measured on 2026-08-01: 0 occurrences in all of `ci.yml`).
    // A `registry.npmjs.org` hiccup — network, proxy, timeout — thus turned a step
    // declared informative into a HARD job FAILURE, while the workstation, served by
    // its `~/.npm/_cacache`, exited 0. Green locally, red remotely, without a line of
    // code moving.
    //
    // The label told the truth about the INTENT and the code said the opposite. We
    // align the code: this gate only renders a verdict when it could MEASURE
    // something. It never blocked on a vulnerability (`process.exit(0)` at file end) —
    // it must not block on its own tooling either.
    //
    // ⚠️ What is accepted in exchange, and it is the real cost: an `npm audit` that
    // fails silently WARNS OF NOTHING ANYMORE. Hence the loud ERROR message, and the
    // fact that the BLOCKING security gate — `audit-ci.cjs`, prod-only,
    // High/Critical — keeps its `exit 1`. This one is a report; that one is the guard.
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

// Same empty measurement as in `audit-ci.cjs` (see its comment for the
// demonstration), handled the OPPOSITE way because this gate is a REPORT and not a
// guard: it says it loudly and exits 0. What matters is that it no longer claims "no
// advisories" when it could measure nothing.
if (!report || !report.metadata || !report.metadata.vulnerabilities) {
    console.error("ERROR [audit-dev-report]: le rapport npm audit ne porte AUCUN décompte.");
    if (report && report.message) console.error(`  motif npm : ${report.message}`);
    console.error(
        "  → gate INFORMATIVE : aucun verdict rendu, sortie 0. La garde bloquante\n" +
            "    (audit-ci.cjs, dépendances de production) REFUSE de conclure dans ce cas."
    );
    process.exit(0);
}
const counts = report.metadata.vulnerabilities; // guaranteed non-null by the guard above
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
