#!/usr/bin/env node
/**
 * SIGN — the installed dependency tree carries VALID registry signatures.
 *
 * ## What this closes
 *
 * `npm audit --omit=dev` (audit-ci.cjs, M7) judges KNOWN advisories. It says nothing about
 * whether the tarballs npm installed are the ones the registry signed. `npm audit signatures`
 * does: it verifies each installed package against the registry's ECDSA signature (and, where
 * present, its attestations). A tampered mirror, a hijacked package, or a bit-flipped tarball
 * shows up here — not in the advisory audit. Measured green at laying: 1110/1110 verified.
 *
 * ## Why the HUMAN output, not `--json`
 *
 * 🛑 `npm audit signatures --json` returns ONLY `{"invalid":[],"missing":[]}` — no counter.
 * A registry that is unreachable, or that verified ZERO packages, produces the SAME empty
 * object as "everything verified". Parsing the JSON would make this gate green on nothing —
 * the exact failure `audit-ci.cjs` documents at length for `npm audit`. So this gate parses
 * the human line `"N packages have verified registry signatures"` and REFUSES to conclude
 * when that count is absent or zero: a reassuring verdict on an empty measurement is worse
 * than no verdict, because it gets believed.
 *
 *   SIGN-01  a non-zero exit → invalid or missing signatures (or a hard error) → FAIL.
 *   SIGN-02  exit 0 but no "N ... verified registry signatures" line, or N == 0 → REFUSE
 *            (registry unreachable / nothing measured).
 *
 * Usage: node scripts/verify-registry-signatures.cjs (from repo root)
 */
"use strict";

const { spawnSync } = require("node:child_process");

// On Windows `npm` resolves to npm.cmd, which Node refuses to spawn without a shell
// (CVE-2024-27980). Ubuntu/WSL honour shell:false; Windows keeps the shell for the .cmd.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPM_SHELL = process.platform === "win32";

const res = spawnSync(NPM, ["audit", "signatures"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: NPM_SHELL,
    maxBuffer: 32 * 1024 * 1024,
});

const out = `${res.stdout || ""}\n${res.stderr || ""}`;

// SIGN-01 — a non-zero status means invalid/missing signatures, or a hard failure.
if (res.status !== 0) {
    console.error(
        "❌ [SIGN-01] `npm audit signatures` a échoué — signature(s) invalide(s)/manquante(s) ou erreur dure."
    );
    console.error(out.trim().slice(0, 4000));
    process.exit(1);
}

// SIGN-02 — refuse to conclude on an empty measurement.
const m = out.match(/(\d[\d,]*)\s+packages? have verified registry signatures/);
const verified = m ? Number(m[1].replace(/,/g, "")) : 0;
if (!m || verified === 0) {
    console.error(
        "❌ [SIGN-02] aucune ligne « N packages have verified registry signatures » (ou N = 0).\n" +
            "  → REFUS DE CONCLURE : registre injoignable ou rien mesuré. `--json` ne porte pas ce\n" +
            "    décompte (seulement {invalid,missing}), d'où la lecture de la sortie humaine.\n" +
            "  Vérifier l'accès au registre, puis relancer."
    );
    console.error(out.trim().slice(0, 2000));
    process.exit(1);
}

const att = out.match(/(\d[\d,]*)\s+packages? have verified attestations/);
console.log(
    `✅ [SIGN] ${verified} paquet(s) à signature de registre vérifiée` +
        (att ? ` · ${att[1]} avec attestation(s) de provenance` : "") +
        " — aucune invalide ni manquante."
);
process.exit(0);
