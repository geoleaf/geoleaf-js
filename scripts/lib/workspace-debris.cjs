/**
 * workspace-debris.cjs — the GHOST packages an interrupted run leaves under `packages/`.
 *
 * Two verification scripts plant a REAL workspace under `packages/plugins/` then erase it
 * in a `finally`. A `finally` does not survive a `SIGKILL` — timeout, machine cut, two
 * concurrent `ci:local` runs one of which gets killed. The directory stays, it matches
 * the `packages/plugins/*` glob, and **it becomes a package of the repo**.
 *
 * ⚠️ **Measured twice, on two different producers, and no message named the cause.** On
 * 2026-08-19, a surviving `zz-scaffold-*` turned **seventeen** gates red — deploy build,
 * dead code, tree, CSS, TSDoc, API surface — each reporting its own symptom on a corpus
 * a ghost package had widened. On 2026-08-22, the same thing with **six** reds, this
 * time on a `__probe__` left by `probe-gate-visibility.cjs`. The cost is not the outage,
 * it is the diagnosis: nothing in seventeen messages points at an untracked directory.
 *
 * 🛑 **And the second producer stayed OUTSIDE the detector for three days.** The refusal
 * laid on 08-19 filtered `name.startsWith("zz-scaffold-")` — one producer out of two.
 * The 08-22 `__probe__` walked right past a guard written exactly for it. That is this
 * module's rationale: one derived table, shared by its two readers.
 *
 * ## What this module does NOT do
 *
 * It erases nothing, deliberately. Cleaning at startup would amount to erasing a
 * directory one did not create — the class of move that cost `probe-gate-visibility.cjs`
 * 13 real plugins (557 files) before it gave itself its `createdPluginsDir`. **Naming
 * without erasing** is the compromise: it also covers `SIGKILL`, which nothing can
 * intercept.
 *
 * ⚠️ Nor does it detect "a new package not yet `git add`ed". The discriminant is a table
 * of NAMED patterns, never "what git does not track": the latter would make `ci:local`
 * refuse anyone scaffolding a plugin by hand — a permanently red guard, hence disarmed
 * within the week.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * The debris producers, and the pattern by which what they leave is recognized.
 *
 * `anchors` is what keeps this table from silently ceasing to bite: each anchor is a
 * literal that MUST stay present in the producing script. Renaming a fixture without
 * touching here makes the guard go red instead of blinding the detector — exactly the
 * class `probe-gate-visibility.cjs` exists to catch, applied to itself.
 */
const PRODUCERS = [
    {
        script: "scripts/verify-plugin-scaffold.cjs",
        scope: "packages/plugins",
        match: { kind: "prefix", value: "zz-scaffold-" },
        anchors: ["zz-scaffold-full", "zz-scaffold-bare"],
        note: "les deux formes échafaudées par SCAF-01, effacées dans un `finally`",
    },
    {
        script: "scripts/probe-gate-visibility.cjs",
        scope: "packages/plugins",
        match: { kind: "exact", value: "__probe__" },
        anchors: ["packages/plugins/__probe__"],
        note: "le workspace de sonde ; `--keep` le laisse DÉLIBÉRÉMENT en place",
    },
];

/** True if `name` is a residue of producer `p`. */
function nameMatches(name, p) {
    return p.match.kind === "prefix" ? name.startsWith(p.match.value) : name === p.match.value;
}

/**
 * The residues present on disk, each with the producer that explains it.
 *
 * @param {string} root Repo root.
 * @returns {Array<{ path: string, producer: string, note: string }>} Relative paths, sorted.
 */
function findDebris(root) {
    const found = [];
    const scopes = [...new Set(PRODUCERS.map((p) => p.scope))];
    for (const scope of scopes) {
        const dir = path.join(root, scope);
        if (!fs.existsSync(dir)) continue;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            const p = PRODUCERS.find((x) => x.scope === scope && nameMatches(e.name, x));
            if (p) found.push({ path: `${scope}/${e.name}`, producer: p.script, note: p.note });
        }
    }
    return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The producers the table above no longer bites for — script gone, or anchor absent.
 *
 * A pattern that stops matching does not redden on its own: it finds zero residue and
 * goes green. This is the only thing separating "no residue" from "the detector went
 * blind".
 *
 * @param {string} root Repo root.
 * @returns {Array<{ script: string, motif: string }>} Empty while the table is still anchored.
 */
function unanchoredProducers(root) {
    const broken = [];
    for (const p of PRODUCERS) {
        const file = path.join(root, p.script);
        if (!fs.existsSync(file)) {
            broken.push({ script: p.script, motif: "le script producteur n'existe plus" });
            continue;
        }
        const src = fs.readFileSync(file, "utf8");
        const missing = p.anchors.filter((a) => !src.includes(a));
        if (missing.length > 0) {
            broken.push({
                script: p.script,
                motif: `littéral absent du script : ${missing.join(", ")}`,
            });
        }
    }
    return broken;
}

module.exports = { PRODUCERS, findDebris, unanchoredProducers };
