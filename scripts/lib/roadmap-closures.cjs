/*!
 * GeoLeaf — roadmap-closure reader, shared between the generator and the gate.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Why this module exists
 *
 * A roadmap leaves the repo when it closes: it gets bumped, its revision line laid,
 * then it is copied out of the repo and removed from the index. Done as a single tree
 * operation, **the deletion swallows the edit** — git records only a deletion, and the
 * closure content never travels through a commit. It then exists only in an out-of-repo,
 * unversioned file.
 *
 * ⚠️ And no gate could see it, for a structural reason: the gates guarding the
 * `version:` / revision-table pair derive their corpus from `git ls-files`. A file
 * removed from the index **leaves the corpus**, the gate judges nothing anymore, and its
 * silence is indistinguishable from agreement.
 *
 * This module renders the facts git CAN establish about a removed roadmap: when it left,
 * and which `version:` its last committed state carried. That is the verifiable half;
 * the other — what the archived copy carries — lives outside the repo and cannot be
 * gated.
 */
"use strict";

const { execSync } = require("node:child_process");
const path = require("node:path");

const ROADMAPS_REL = "_docs_projet/travail/roadmaps";

/** @param {string} cmd @returns {string} */
function sh(cmd) {
    return execSync(cmd, { encoding: "utf8", maxBuffer: 1e9 });
}

/**
 * Reads the `version:` front-matter of a path at a given commit.
 *
 * @param {string} sha - Commit to read at.
 * @param {string} relPath - Repo-relative path.
 * @returns {string|null} The version, or `null` when absent or unreadable.
 */
function versionAt(sha, relPath) {
    if (!sha) return null;
    let text;
    try {
        text = sh(`git show ${sha}:${JSON.stringify(relPath)}`);
    } catch {
        return null;
    }
    const m = /^version:\s*(\S+)/m.exec(text);
    return m ? m[1] : null;
}

/**
 * Every roadmap that LEFT the repo, with what git can still say about it.
 *
 * ⚠️ A git deletion is not always a loss: `-M` distinguishes a real removal from a MOVE. The
 * two must not be conflated — a roadmap moved to `vision/` is still in the repo and has no
 * closure to record. Measured on this repo: 1 of the 67 deletions is a move.
 *
 * @returns {{name: string, relPath: string, date: string, sha: string, movedTo: string|null,
 *            versionInGit: string|null}[]} Newest first.
 */
function closedRoadmaps() {
    const raw = sh(
        `git log --diff-filter=D --name-only --format='%H|%ad' --date=short -- '${ROADMAPS_REL}/*.md'`
    );
    const out = [];
    let date = null;
    let sha = null;
    for (const line of raw.split("\n")) {
        if (line.includes("|")) {
            [sha, date] = line.split("|");
            continue;
        }
        const relPath = line.trim();
        if (!relPath.startsWith(`${ROADMAPS_REL}/`)) continue;

        const commits = sh(`git log --format=%h -- ${JSON.stringify(relPath)}`)
            .trim()
            .split("\n")
            .filter(Boolean);
        // commits[0] is the deletion itself; the closure state is the one BEFORE it.
        const parent = commits[1] || null;

        let movedTo = null;
        try {
            const names = sh(`git show -M --name-status --format='' ${sha}`);
            const hit = names
                .split("\n")
                .find((l) => /^R\d*\t/.test(l) && l.includes(`\t${relPath}\t`));
            if (hit) movedTo = hit.split("\t")[2] || null;
        } catch {
            /* an unreadable commit must not make a deletion pass for a move */
        }

        out.push({
            name: path.basename(relPath, ".md"),
            relPath,
            date,
            sha: sha.slice(0, 9),
            movedTo,
            versionInGit: versionAt(parent, relPath),
        });
    }
    return out;
}

module.exports = { ROADMAPS_REL, closedRoadmaps, versionAt };
