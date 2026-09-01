#!/usr/bin/env node
/**
 * Port the workshop's state to the public repo `geoleaf/geoleaf-js`.
 *
 * Usage:
 *   node scripts/port-to-public.cjs              # dry-run: measures and describes, writes nothing
 *   node scripts/port-to-public.cjs --apply      # copies, commits and pushes
 *   node scripts/port-to-public.cjs --apply --no-push   # copies and commits, no push
 *   node scripts/port-to-public.cjs --keep-clone <dir>  # reuses/keeps a clone there
 *
 * ## Why this script exists
 *
 * Porting used to be a hand `cp`. Measured on 2026-08-11: the public repo was
 * **15 commits behind**, seven of them touching public docs — the 45 `docs/specs/`
 * sheets re-read, the example corpus grown from 88 to 148 files, and a copyable
 * configuration block declaring seven dead root keys. **Nothing flagged it**,
 * because no mechanism compared the two repos.
 *
 * ⚠️ And the cause is structural, not an oversight: the public clone **exists
 * nowhere on disk**. It is created, pushed, deleted. A script assuming a permanent
 * clone would have the same defect. This one **clones at every port**, which settles
 * the divergence by construction — we always start from the remote's real state,
 * never from a copy that drifted.
 *
 * ## What it refuses to do
 *
 * - run on a dirty working tree (the batch derives from `git ls-files`, which does
 *   not describe uncommitted modifications — the printed tally would lie);
 * - write a batch under the plausibility floor, or whose partition pattern removed
 *   nothing (`public-partition.cjs`);
 * - commit a clone whose `git ls-files` still contains a workshop path.
 *
 * Each of these three refusals was SEEN biting before the script was believed — a
 * proving pass, two mutations and one assertion.
 *
 * ## The step order is not arbitrary
 *
 * `ARBORESCENCE_QUALIFIEE.md` is regenerated **after** the `git add`, never before:
 * its generator reads `git ls-files` (`lib/source-inventory.cjs`), not the disk.
 * A tree regenerated before indexing describes the previous batch while exiting 0 —
 * what the public commits `18ccd025` and `ed7bbaf2` had to catch up by hand, twice
 * in a row.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const registry = require("./lib/packages.cjs");
const partition = require("./lib/public-partition.cjs");

const ROOT = registry.ROOT;
const PUBLIC_REMOTE = "https://github.com/geoleaf/geoleaf-js.git";
/** The repo expected at the remote's end, as `<org>/<name>`, for the identity assertion. */
const PUBLIC_SLUG = "geoleaf/geoleaf-js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const noPush = argv.includes("--no-push");
const keepCloneIdx = argv.indexOf("--keep-clone");
const keepClone = keepCloneIdx !== -1 ? argv[keepCloneIdx + 1] : null;

/**
 * Runs a command, throwing on failure rather than carrying on.
 *
 * @param {string} cmd Executable.
 * @param {string[]} args Arguments, not shell-interpreted.
 * @param {{cwd?: string, quiet?: boolean}} [opts]
 * @returns {string} The standard output, trimmed.
 */
function run(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, {
        cwd: opts.cwd ?? ROOT,
        encoding: "utf8",
        stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
        maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) throw res.error;
    if (res.status !== 0) {
        throw new Error(
            `port-to-public: \`${cmd} ${args.join(" ")}\` a rendu ${res.status}` +
                (res.stderr ? ` — ${String(res.stderr).trim()}` : "")
        );
    }
    return String(res.stdout ?? "").trim();
}

/**
 * The files git tracks, repo-relative POSIX paths.
 *
 * @param {string} cwd Root of the repo to query.
 * @returns {string[]}
 */
function trackedFiles(cwd) {
    const out = run("git", ["ls-files", "-z"], { cwd, quiet: true });
    return out.split("\0").filter(Boolean);
}

/**
 * Refuse to port from a dirty tree.
 *
 * ⚠️ This is not cleanliness on principle. The batch derives from `git ls-files`,
 * which describes **the index**, not the disk: an uncommitted modified file would be
 * copied in its current state while the printed tally describes it as the committed
 * version. The port would leave right and the commit message would be wrong.
 */
function assertCleanWorktree() {
    const dirty = run("git", ["status", "--porcelain"], { quiet: true });
    if (dirty) {
        const count = dirty.split("\n").length;
        throw new Error(
            `port-to-public: l'arbre de travail porte ${count} modification(s) non commitée(s).\n` +
                `  Le lot se dérive de \`git ls-files\` — porter maintenant copierait un état que\n` +
                `  le décompte ne décrit pas. Commiter d'abord, puis relancer.`
        );
    }
}

/**
 * Clones the public repo, and verifies it really is it.
 *
 * @returns {{dir: string, ephemeral: boolean}}
 */
function clonePublic() {
    const dir = keepClone ?? fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-public-"));
    const ephemeral = keepClone === null;

    if (fs.existsSync(path.join(dir, ".git"))) {
        console.log(`↻ Clone existant réutilisé : ${dir}`);
        run("git", ["fetch", "origin", "main"], { cwd: dir });
        run("git", ["reset", "--hard", "origin/main"], { cwd: dir });
        run("git", ["clean", "-fdx"], { cwd: dir });
    } else {
        console.log(`⇣ Clonage de ${PUBLIC_SLUG}…`);
        run("git", ["clone", "--quiet", PUBLIC_REMOTE, dir], { cwd: ROOT });
    }

    // Identity assertion: overwriting the wrong repo would be irreversible.
    const remote = run("git", ["remote", "get-url", "origin"], { cwd: dir, quiet: true });
    if (!remote.includes(PUBLIC_SLUG)) {
        throw new Error(
            `port-to-public: le clone pointe "${remote}", attendu "${PUBLIC_SLUG}". REFUS.`
        );
    }
    return { dir, ephemeral };
}

/**
 * Makes the clone identical to the public batch: copy what must be there, remove
 * the rest.
 *
 * @param {string} cloneDir Root of the clone.
 * @param {string[]} publicFiles Repo-relative POSIX paths to port.
 * @returns {{copied: number, removed: string[]}}
 */
function syncClone(cloneDir, publicFiles) {
    const wanted = new Set(publicFiles);

    // ① Remove from the clone every tracked file no longer in the batch. Without
    //    this pass, a file deleted here would survive there indefinitely — the
    //    silent form of divergence, and the hardest to see since it appears in no
    //    diff.
    const removed = [];
    for (const file of trackedFiles(cloneDir)) {
        if (wanted.has(file)) continue;
        const abs = path.join(cloneDir, file);
        if (fs.existsSync(abs)) fs.rmSync(abs);
        removed.push(file);
    }

    // ② Copy the batch. `copyFileSync` treats binaries and texts the same way.
    let copied = 0;
    for (const file of publicFiles) {
        const src = path.join(ROOT, file);
        const dest = path.join(cloneDir, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        copied++;
    }

    return { copied, removed };
}

/**
 * Appends the internal-apparatus block to the clone's `.gitignore`.
 *
 * ⚠️ **After** the copy, never before: step ② just overwrote the clone's
 * `.gitignore` with the workshop's, which does not carry these rules — and must not
 * (see the partition module). Laying the fragment first would amount to deleting it.
 *
 * @param {string} cloneDir Root of the clone.
 */
function appendGitignoreFragment(cloneDir) {
    const target = path.join(cloneDir, ".gitignore");
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (current.includes("Appareil INTERNE")) return; // already laid, idempotent port
    fs.writeFileSync(target, current + partition.gitignoreFragment(), "utf8");
}

/**
 * Last net: no workshop path may be indexed on the clone side.
 *
 * The only assertion judging the RESULT rather than the intent. The previous ones
 * verify the partition bit on the list; this one verifies what git is actually about
 * to commit — the only thing that leaves.
 *
 * @param {string} cloneDir Root of the clone.
 * @throws {Error} If an internal file survived.
 */
function assertNoInternalLeak(cloneDir) {
    const leaked = trackedFiles(cloneDir).filter((f) => partition.isInternal(f));
    if (leaked.length > 0) {
        throw new Error(
            `port-to-public: ${leaked.length} fichier(s) d'ATELIER sont indexés dans le clone —\n` +
                leaked
                    .slice(0, 20)
                    .map((f) => `    ${f}`)
                    .join("\n") +
                (leaked.length > 20 ? `\n    … et ${leaked.length - 20} autre(s)` : "") +
                `\n  REFUS avant commit. Le \`.gitignore\` du clone n'a pas mordu.`
        );
    }
}

/** @returns {void} */
function main() {
    console.log("── Portage vers le dépôt public ──\n");

    assertCleanWorktree();

    const head = run("git", ["rev-parse", "--short", "HEAD"], { quiet: true });
    const parts = partition.split(trackedFiles(ROOT));
    partition.assertPartitionSane(parts);

    // ⚠️ The tally prints BEFORE any write, and it breaks down by pattern: a total
    // alone cannot tell "39 files removed" from "39 files one single pattern
    // snatched".
    console.log(
        `Atelier @ ${head} — ${parts.publicFiles.length + parts.internalFiles.length} fichiers suivis`
    );
    console.log(`  → ${parts.publicFiles.length} portés au public`);
    console.log(`  → ${parts.internalFiles.length} retenus à l'atelier :`);
    for (const [pattern, files] of parts.byPattern) {
        console.log(`       ${String(files.length).padStart(4)}  ${pattern}`);
    }
    console.log();

    if (!apply) {
        console.log("[dry-run] Rien n'a été écrit. Relancer avec --apply pour porter.");
        return;
    }

    const { dir: cloneDir, ephemeral } = clonePublic();
    const before = run("git", ["rev-parse", "--short", "HEAD"], { cwd: cloneDir, quiet: true });

    try {
        const { copied, removed } = syncClone(cloneDir, parts.publicFiles);
        appendGitignoreFragment(cloneDir);
        console.log(`\n✓ ${copied} fichier(s) copié(s), ${removed.length} retiré(s) du clone.`);

        // Indexing precedes the tree's regeneration: the generator reads
        // `git ls-files`, so a tree produced before the `git add` describes the
        // PREVIOUS batch while exiting 0.
        run("git", ["add", "-A"], { cwd: cloneDir });

        console.log("↻ Régénération de l'arbre côté public…");
        run("node", ["scripts/generate-docs-tree.cjs"], { cwd: cloneDir });
        run("git", ["add", "-A"], { cwd: cloneDir });

        assertNoInternalLeak(cloneDir);

        const staged = run("git", ["diff", "--cached", "--name-only"], {
            cwd: cloneDir,
            quiet: true,
        });
        if (!staged) {
            console.log("\n= Le dépôt public est déjà à jour, rien à commiter.");
            return;
        }
        const changed = staged.split("\n").length;

        const message =
            `chore(sync): porter l'état de l'atelier — ${changed} fichier(s)\n\n` +
            `Source : ${head}. Portage dérivé par scripts/port-to-public.cjs :\n` +
            `${parts.publicFiles.length} fichiers publics, ${parts.internalFiles.length} retenus\n` +
            `à l'atelier par les motifs de scripts/lib/public-partition.cjs.\n`;
        run("git", ["commit", "-m", message], { cwd: cloneDir });
        const after = run("git", ["rev-parse", "--short", "HEAD"], { cwd: cloneDir, quiet: true });
        console.log(`\n✓ Commit ${before} → ${after} (${changed} fichier(s)).`);

        if (noPush) {
            console.log(`  --no-push : le clone reste local dans ${cloneDir}`);
            return;
        }
        run("git", ["push", "origin", "main"], { cwd: cloneDir });
        console.log(`✓ Poussé sur ${PUBLIC_SLUG}.`);
    } finally {
        if (ephemeral && !noPush) fs.rmSync(cloneDir, { recursive: true, force: true });
        else console.log(`\n  Clone conservé : ${cloneDir}`);
    }
}

try {
    main();
} catch (err) {
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
}
