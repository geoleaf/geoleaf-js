#!/usr/bin/env node
"use strict";
/**
 * ci-push.cjs — `ci:local`, but in the runner's CONDITIONS. The green that
 * authorizes a push.
 *
 * ## The problem it solves, and why `ci:local` could not
 *
 * "Green locally means green at push" was never true on this repo. The cause was not
 * the gate LIST — it is in parity, and `verify-ci-parity.cjs` verifies it. It is
 * that `ci:local` does not run in the same conditions as CI, on five axes measured
 * on 2026-08-01:
 *
 *   • **it replays cached verdicts** — 19 HIT / 22 typecheck tasks, 32 / 36 test
 *     ones, on 4.3 GB of `.turbo`. CI has NO cache (`grep -c actions/cache ci.yml`
 *     → 0). A local green thus did not say "the checks passed" but "they passed one
 *     day, and turbo believes nothing moved";
 *   • **it sees git-ignored files** the runner will never have. `connector.local.js`,
 *     present on the machine since June, made 8 E2E specs green here and red there —
 *     for months, with nothing able to show it;
 *   • **its `node_modules` is accreted** by successive `npm install`s, not rebuilt;
 *   • **`process.env.CI` is absent** — yet `log.test.js` has a `test.skipIf(CI)` that
 *     CHANGES the measured coverage, and `playwright.config.js` changes `retries`
 *     and `forbidOnly`;
 *   • **the timezone differs** — `new Date(2026, 6, 23)` is not the same instant
 *     here and in UTC.
 *
 * None of these five axes closes by adding a gate. They close by changing the
 * CONDITIONS. That is all this script does.
 *
 * ## What it does
 *
 *   1. `git worktree add --detach` on HEAD → ONLY committed files
 *   2. a WITNESS: the room must be empty of any ignored/untracked file, otherwise it
 *      is not clean and the verdict would be worth nothing
 *   3. `npm ci` → the lockfile's tree
 *   4. `ci-local.cjs` with `CI=true`, `TZ=UTC`, `TURBO_FORCE=true`
 *   5. worktree removal, error case included
 *
 * ## ⚠️ What it does NOT close — to know before believing its green
 *
 *   • **parallelism**: this machine has more cores than a GitHub runner (2-4), and
 *     `maxWorkers` depends on it. A load-sensitive failure manifests at different
 *     rates on the two sides, by construction;
 *   • **network audits**: `npm audit` renders a verdict as a function of the advisory
 *     base AT INSTANT T, not of the commit;
 *   • **the browser version**: CI does `playwright install` at every run, the
 *     machine uses its cache;
 *   • **Node's minor**: `.nvmrc` only pins a major.
 *
 * These four are out of a workstation's reach, and the script STATES them at the end
 * of the run rather than let a total guarantee be believed.
 *
 * Usage:
 *   node scripts/ci-push.cjs            # the default mode's gates
 *   node scripts/ci-push.cjs --e2e      # + the 4 E2E steps (what CI really runs)
 *   node scripts/ci-push.cjs --keep     # keeps the room (diagnostic)
 *
 * Exit: 0 if everything passes in the runner's conditions, 1 otherwise.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const KEEP = process.argv.includes("--keep");
const PASS_THROUGH = process.argv.slice(2).filter((a) => a !== "--keep");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    c: "\x1b[36m",
    d: "\x1b[2m",
    b: "\x1b[1m",
    x: "\x1b[0m",
};

const run = (cmd, args, opts = {}) =>
    spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });

/** Paths the room must NOT contain: it is the property being sold. */
function assertCleanRoom(dir) {
    const res = run("git", ["status", "--porcelain", "--ignored=matching"], { cwd: dir });
    if (res.status !== 0) {
        throw new Error(`la chambre ne répond pas à git — ${(res.stderr || "").trim()}`);
    }
    const lines = (res.stdout || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        // `node_modules/` will appear AFTER `npm ci`; this witness runs BEFORE.
        .filter((l) => !/^!! node_modules\//.test(l));
    if (lines.length) {
        throw new Error(
            `la chambre n'est pas propre — ${lines.length} entrée(s) non suivie(s) ou ignorée(s) :\n` +
                lines
                    .slice(0, 10)
                    .map((l) => `      ${l}`)
                    .join("\n")
        );
    }
}

function main() {
    console.log(`${C.b}── CI-PUSH — ci:local dans les conditions du runner ──${C.x}`);

    // What will be VERIFIED is HEAD, not the worktree. An uncommitted modification
    // will not be tested, and a green obtained here would say nothing about it: we
    // say so before setting off.
    const dirty = run("git", ["status", "--porcelain"]).stdout.trim();
    if (dirty) {
        const n = dirty.split("\n").length;
        console.log(
            `  ${C.y}⚠ ${n} fichier(s) modifié(s) NON COMMITÉS — ils ne seront pas testés.${C.x}`
        );
        console.log(
            `  ${C.d}Ce run porte sur HEAD, c'est-à-dire sur ce qui partira au push.${C.x}`
        );
        // ⚠️ NON-OBVIOUS CONSEQUENCE, measured on 2026-08-01: the generated-artifact
        // FRESHNESS gates (`docs:tree:check`, `gen:*:check`) can go red HERE while
        // green on the machine. Their generators walk the DISK —
        // `lib/source-inventory.cjs` does `readdirSync`, never `git ls-files` — so
        // the committed artifact was produced from a DIRTY worktree. The room, for
        // its part, only sees HEAD. Gap measured that day: **+251 lines over
        // 6 files**, all modified by concurrent sessions and uncommitted.
        //
        // It is NOT a false positive: it is the exact finding that the committed
        // artifact does not match HEAD alone. But it is not repaired by
        // regenerating.
        console.log(
            `  ${C.d}    ⚠ Les gates de fraîcheur d'artefact généré peuvent rougir pour cette\n` +
                `      seule raison : leurs générateurs lisent le DISQUE, pas l'index.${C.x}`
        );
    }

    const head = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-cipush-"));
    let ok = false;

    try {
        console.log(`  chambre : ${C.d}${dir}${C.x}`);
        console.log(`  commit  : ${C.b}${head}${C.x}\n`);

        const add = run("git", ["worktree", "add", "--detach", "--quiet", dir, "HEAD"]);
        if (add.status !== 0) {
            throw new Error(`git worktree add a échoué — ${(add.stderr || "").trim()}`);
        }

        // WITNESS — without it, an accidentally polluted room would render a green
        // worth exactly as much as `ci:local`'s, and nobody would know.
        assertCleanRoom(dir);
        console.log(`  ${C.g}✓${C.x} témoin : aucun fichier ignoré ni non suivi dans la chambre`);

        console.log(`\n${C.c}── npm ci ──${C.x}`);
        const ci = run("npm", ["ci"], { cwd: dir, stdio: "inherit" });
        if (ci.status !== 0) {
            throw new Error(
                "`npm ci` a échoué dans la chambre. C'est un défaut RÉEL : la CI fera " +
                    "exactement la même chose sur un clone frais."
            );
        }

        console.log(`\n${C.c}── ci:local (CI=true, TZ=UTC, TURBO_FORCE=true) ──${C.x}`);
        const gates = run("node", ["scripts/ci-local.cjs", ...PASS_THROUGH], {
            cwd: dir,
            stdio: "inherit",
            env: {
                ...process.env,
                CI: "true",
                TZ: "UTC",
                // The worktree has no `.turbo` anyway, but a global cache
                // configuration would make the belt useful — and it costs nothing.
                TURBO_FORCE: "true",
            },
        });
        ok = gates.status === 0;
    } catch (err) {
        console.log(`\n${C.r}✗ CI-PUSH — la chambre n'a pas pu conclure${C.x}`);
        console.log(`  ${err.message}`);
    } finally {
        if (KEEP) {
            console.log(`\n${C.d}chambre conservée (--keep) : ${dir}${C.x}`);
            console.log(`${C.d}la retirer : git worktree remove --force ${dir}${C.x}`);
        } else {
            run("git", ["worktree", "remove", "--force", dir]);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    // ⚠️ THE STATEMENT IS MANDATORY, even on a green. An "everything is covered"
    // would be an over-statement, exactly the defect this script exists not to
    // repeat.
    console.log(`\n  ${C.y}⚠ Ce que la chambre propre ne couvre PAS :${C.x}`);
    for (const line of [
        `parallélisme — ce poste a ${os.availableParallelism ? os.availableParallelism() : "?"} cœurs, un runner GitHub 2 à 4`,
        "audits réseau — `npm audit` juge la base d'avis à l'instant T, pas le commit",
        "navigateur — la CI fait `playwright install` à chaque run, le poste utilise son cache",
        "Node — `.nvmrc` ne pin qu'une majeure (22), la mineure du runner flotte",
    ]) {
        console.log(`      ${C.d}• ${line}${C.x}`);
    }

    if (ok) {
        console.log(`\n${C.g}✓ CI-PUSH — vert dans les conditions du runner, sur ${head}.${C.x}`);
        process.exit(0);
    }
    console.log(`\n${C.r}✗ CI-PUSH — NE PAS POUSSER.${C.x}`);
    console.log(
        `  ${C.d}Un échec ici est un échec que la CI aurait rencontré, pour un run de quota.${C.x}`
    );
    process.exit(1);
}

if (require.main === module) {
    main();
}
