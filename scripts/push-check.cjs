#!/usr/bin/env node
// @ts-check
"use strict";
/**
 * PUSH-CHECK — what a push to the workshop repo must pass, decided from what it sends.
 *
 * Usage:
 *   node scripts/push-check.cjs            # decides, then runs the short set when it may
 *   node scripts/push-check.cjs --dry-run  # decides and prints, runs nothing
 * Exit code: 0 = the push may go · 1 = a gate failed, or `ci:local` is required first.
 *
 * ## Why it exists
 *
 * The push protocol asked for a full `ci:local` before EVERY push — more than ten minutes —
 * including pushes that carry only workshop files: the journal, the status card, a roadmap,
 * an acceptance run. None of those files ships to the public repo, and almost no `ci:local`
 * gate judges them. The protocol stays exact by deriving the cost from the diff instead of
 * from a judgement of "heavy" or "risky", which nobody can verify afterwards.
 *
 * ## The decision
 *
 * The BASE is the latest `ci:local` run of the ledger (`lib/gate-ledger.cjs`) that passed
 * every gate on a CLEAN tracked tree, at a commit that is an ancestor of `HEAD`. The diff is
 * `base..HEAD`, every path classified by `lib/public-partition.cjs` — the same boundary the
 * port to the public repo uses, so the two can never disagree.
 *
 *   - no such base               → `ci:local` required (nothing proves the shared ancestor);
 *   - one PUBLIC path in the diff → `ci:local` required, the paths named — a reformatted
 *     public file counts exactly like an edited one;
 *   - only workshop paths        → the SHORT SET below, then the push may go.
 *
 * ## The short set, and what it does NOT cover — said plainly
 *
 * `atelier:check` (the gates whose subject lives in the workshop), the guards (`test:guards`,
 * which read the journal and the registers), the secret scan of the pushed range, repo
 * hygiene (it walks every git-visible file), and ESLint on the workshop scripts of the diff.
 *
 * A `ci:local` gate that reads workshop files and is not in this set is NOT run. The cost of
 * such a miss is bounded by construction: a workshop file never reaches the public repo nor a
 * deliverable, so the miss surfaces as a red at the next full `ci:local` — the next push that
 * carries a public file — and never as a shipped defect. The secret scan is in the set
 * because that is the one class where "later" is too late: a pushed secret is published.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const NPM_SHELL = process.platform === "win32";

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    c: "\x1b[36m",
    d: "\x1b[2m",
    x: "\x1b[0m",
};

/** Lintable extensions: a workshop script in the diff is linted, its prose is not. */
const LINTABLE = /\.(?:c|m)?[jt]s$/;

/**
 * The commands of the short set. ESLint is added by `shortSet()` when the diff carries a
 * lintable workshop file.
 */
const SHORT_SET = [
    { name: "Gates de l'atelier (atelier:check)", run: ["node", "scripts/atelier-check.cjs"] },
    { name: "Gardes (test:guards)", run: ["npx", "turbo", "run", "test:guards"] },
    { name: "Secrets de la plage poussée (gitleaks)", run: ["node", "scripts/gitleaks-local.cjs"] },
    { name: "Hygiène du dépôt", run: ["node", "scripts/verify-repo-hygiene.cjs"] },
];

/**
 * The latest ledger run that may serve as a base.
 *
 * @param {Array<{sha?: string|null, clean?: boolean, results?: Array<{ok: boolean}>}>} runs
 *   Ledger rows, oldest first (the ledger's own order).
 * @param {(sha: string) => boolean} isAncestor Whether `sha` is an ancestor of `HEAD`.
 * @returns {string|null} The base SHA, or null when no run qualifies.
 */
function findBase(runs, isAncestor) {
    for (let i = runs.length - 1; i >= 0; i--) {
        const run = runs[i];
        const green =
            Array.isArray(run.results) && run.results.length > 0 && run.results.every((r) => r.ok);
        // `clean` is absent from the rows written before it existed: absent is NOT clean.
        if (green && run.clean === true && run.sha && isAncestor(run.sha)) return run.sha;
    }
    return null;
}

/**
 * What the push needs, from the base and the paths of `base..HEAD`.
 *
 * @param {{base: string|null, files: string[], isInternal: (f: string) => boolean}} input
 * @returns {{verdict: "ci-local"|"court", reason: string, publicFiles: string[]}}
 */
function decide({ base, files, isInternal }) {
    if (!base) {
        return {
            verdict: "ci-local",
            reason: "aucun ci:local vert, sur arbre propre, n'est un ancêtre de HEAD",
            publicFiles: [],
        };
    }
    const publicFiles = files.filter((f) => !isInternal(f));
    if (publicFiles.length > 0) {
        return {
            verdict: "ci-local",
            reason: `${publicFiles.length} fichier(s) public(s) depuis le dernier vert ${base}`,
            publicFiles,
        };
    }
    return {
        verdict: "court",
        reason: `${files.length} fichier(s), tous de l'atelier, depuis le dernier vert ${base}`,
        publicFiles: [],
    };
}

/**
 * The short set for this diff: the fixed commands, plus ESLint on its lintable files.
 *
 * @param {string[]} existingFiles Paths of the diff still present on disk.
 * @returns {Array<{name: string, run: string[]}>}
 */
function shortSet(existingFiles) {
    const lintable = existingFiles.filter((f) => LINTABLE.test(f));
    if (lintable.length === 0) return SHORT_SET;
    return [
        ...SHORT_SET,
        {
            name: `ESLint sur ${lintable.length} script(s) de l'atelier`,
            run: ["npx", "eslint", "--max-warnings", "0", "--no-warn-ignored", ...lintable],
        },
    ];
}

/**
 * @param {string[]} gitArgs
 * @returns {{ok: boolean, out: string}}
 */
function git(gitArgs) {
    const r = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8" });
    return { ok: r.status === 0, out: (r.stdout || "").trim() };
}

function main() {
    const DRY = process.argv.includes("--dry-run");
    const partition = require("./lib/public-partition.cjs");
    const { readRuns } = require("./lib/gate-ledger.cjs");

    if (git(["status", "--porcelain", "--untracked-files=no"]).out !== "") {
        console.log(
            `${C.r}✗ PUSH-CHECK${C.x} — arbre suivi modifié : committer ou mettre de côté d'abord.`
        );
        return 1;
    }
    if (git(["rev-list", "--count", "@{upstream}..HEAD"]).out === "0") {
        console.log(`${C.g}✓ PUSH-CHECK${C.x} — rien à pousser.`);
        return 0;
    }

    const isAncestor = (/** @type {string} */ sha) =>
        spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: ROOT }).status === 0;
    const base = findBase(readRuns().runs, isAncestor);
    const files = base
        ? git(["diff", "--name-only", `${base}..HEAD`])
              .out.split("\n")
              .filter(Boolean)
        : [];
    const d = decide({ base, files, isInternal: partition.isInternal });

    if (d.verdict === "ci-local") {
        console.log(`${C.y}✗ PUSH-CHECK${C.x} — ci:local requis : ${d.reason}.`);
        for (const f of d.publicFiles.slice(0, 15)) console.log(`   ${f}`);
        if (d.publicFiles.length > 15) console.log(`   … et ${d.publicFiles.length - 15} autre(s)`);
        console.log(
            `${C.d}   Lancer \`npm run ci:local\` (commande nue), puis \`npm run push:check\`.${C.x}`
        );
        return 1;
    }

    const steps = shortSet(files.filter((f) => fs.existsSync(path.join(ROOT, f))));
    console.log(`${C.c}PUSH-CHECK${C.x} — ensemble court : ${d.reason}.`);
    if (DRY) {
        for (const s of steps) console.log(`   ${s.name}  ${C.d}${s.run.join(" ")}${C.x}`);
        return 0;
    }
    const failed = [];
    for (const s of steps) {
        console.log(`\n${C.c}── ${s.name} ──${C.x}`);
        const r = spawnSync(s.run[0], s.run.slice(1), {
            cwd: ROOT,
            stdio: "inherit",
            shell: NPM_SHELL,
        });
        if (r.status !== 0) failed.push(s.name);
    }
    if (failed.length) {
        console.log(
            `\n${C.r}✗ PUSH-CHECK${C.x} — ${failed.length} en échec : ${failed.join(", ")}.`
        );
        return 1;
    }
    console.log(
        `\n${C.g}✓ PUSH-CHECK${C.x} — ${steps.length}/${steps.length}, le push peut partir.`
    );
    return 0;
}

module.exports = { findBase, decide, shortSet, SHORT_SET };

if (require.main === module) process.exit(main());
