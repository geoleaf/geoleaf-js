/**
 * gate-ledger.cjs — what each gate COSTS and how often it BITES, kept across runs.
 *
 * `ci-local.cjs` has always measured a duration per gate (`runStep` returns `ms`) and
 * always printed it in the end-of-run summary. Then the process exits and the number is
 * gone. Sixty days of that produced an apparatus whose cost nobody could state: gates
 * went from 14 to 111 with no doctrine of exit, because "which gate is expensive" and
 * "which gate has ever caught anything" were both unanswerable questions.
 *
 * This module answers them by appending one line per run to a ledger, and aggregating it.
 *
 * ## Where the ledger lives, and why it is OUTSIDE the repo
 *
 * `~/.cache/geoleaf/ci-local/runs.jsonl` (honouring `XDG_CACHE_HOME`).
 *
 * Not in the repo, and not merely git-ignored. A git-ignored file inside the tree would
 * be swept by `git clean -xdf` — the exact gesture used to reproduce a fresh clone —, it
 * would be a candidate for `audit:cleanup`, and it would have to be argued about in the
 * public partition. The measurement is a property of THIS WORKSTATION over time, not of
 * the repository, so it lives where workstation state lives.
 *
 * ⚠️ Consequence to know before trusting a report: the ledger is per-machine and starts
 * empty. A `--report` on a fresh machine is not "the gates never bit", it is "no run has
 * been recorded here yet". `formatReport` therefore prints the number of runs read, and
 * says so when there are none — a report that cannot distinguish the two would be the
 * same class of defect as a gate that exits green having read nothing.
 *
 * ## Recording NEVER changes a verdict
 *
 * Every write goes through a try/catch that swallows and reports. A full disk, a
 * read-only `$HOME`, a `$HOME` that does not exist under a CI runner — none of them may
 * turn a green run red at its very last step, after twelve minutes of work. The ledger
 * is an instrument, and an instrument that can fail the thing it measures is worse than
 * no instrument.
 *
 * ## Median, not mean
 *
 * A cold run (`npm ci`, empty turbo cache) costs an order of magnitude more than a warm
 * one for the same gate. A mean lets one cold run govern the ranking, so the ranking
 * would say "the build is expensive" every single time — true, useless, and it would
 * hide the twenty small gates that add up. The median answers "what does this gate cost
 * on a normal run"; the cumulative total answers "what has it cost me in total". Both
 * are printed, because they rank differently and the difference is the interesting part.
 *
 * ## What a BITE is, and what it is not
 *
 * A bite is a gate exiting non-zero in a recorded run. It is counted once per run, not
 * per finding.
 *
 * ⚠️ It is NOT "the gate found something". A gate that skips because its subject lives
 * outside the repo exits 0 and is not a bite — and that is precisely the class
 * `release-check.cjs --strict` exists to name. Nor does a zero-bite count mean a gate is
 * useless: a ratchet at zero debt is SUPPOSED to be silent, and its value is the day it
 * is not. Zero bites is an INPUT to the exit rule, never its verdict.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * The ledger's absolute path.
 *
 * `GEOLEAF_GATE_LEDGER` overrides it with a FILE path — that override is what lets the
 * ledger be seen to record, and seen to stop recording, without touching the real one.
 *
 * @returns {string} Absolute path to the JSONL ledger.
 */
function ledgerPath() {
    const override = process.env.GEOLEAF_GATE_LEDGER;
    if (override && override.trim() !== "") return path.resolve(override);
    const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(cache, "geoleaf", "ci-local", "runs.jsonl");
}

/**
 * Appends one run to the ledger. Never throws.
 *
 * @param {{startedAt: string, sha: string|null, flags: string[], results: {name: string, ok: boolean, ms: number, code: number|null}[]}} run The run to record.
 * @returns {{ok: boolean, path: string, error?: string}} Whether the append landed.
 */
function record(run) {
    const file = ledgerPath();
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // One line, appended: two concurrent runs cannot corrupt each other's
        // entries the way a read-modify-write of a JSON array would.
        fs.appendFileSync(file, JSON.stringify(run) + "\n", "utf8");
        return { ok: true, path: file };
    } catch (err) {
        return { ok: false, path: file, error: err.message };
    }
}

/**
 * Reads the ledger.
 *
 * A killed process can leave a half-written last line. Such a line is SKIPPED and
 * counted, never fatal: refusing to report because the tail is torn would lose ninety
 * days of good data to one interrupted run.
 *
 * @returns {{runs: object[], skipped: number, path: string, exists: boolean}} The parsed runs.
 */
function readRuns() {
    const file = ledgerPath();
    if (!fs.existsSync(file)) return { runs: [], skipped: 0, path: file, exists: false };
    const runs = [];
    let skipped = 0;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (line.trim() === "") continue;
        try {
            const parsed = JSON.parse(line);
            if (parsed && Array.isArray(parsed.results)) runs.push(parsed);
            else skipped++;
        } catch {
            skipped++;
        }
    }
    return { runs, skipped, path: file, exists: true };
}

/** @param {number[]} xs Sorted-or-not sample. @returns {number} The median. */
function median(xs) {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Folds the runs into one row per gate NAME.
 *
 * ⚠️ Keyed on the name, which is what the summary shows and what a reader recognises.
 * A renamed gate therefore starts a new row rather than inheriting the old one's
 * history — deliberate: the alternative is keying on the command, which changes for
 * reasons that have nothing to do with the gate's identity (a flag added, a workspace
 * filter). A split history is visible; a silently merged one is not.
 *
 * @param {object[]} runs Runs as returned by `readRuns`.
 * @returns {{name: string, runs: number, bites: number, medianMs: number, totalMs: number, lastBiteAt: string|null}[]} One row per gate, cost-ordered.
 */
function aggregate(runs) {
    const rows = new Map();
    for (const run of runs) {
        for (const r of run.results) {
            if (!r || typeof r.name !== "string") continue;
            let row = rows.get(r.name);
            if (!row) {
                row = { name: r.name, runs: 0, bites: 0, samples: [], lastBiteAt: null };
                rows.set(r.name, row);
            }
            row.runs++;
            row.samples.push(typeof r.ms === "number" ? r.ms : 0);
            if (r.ok === false) {
                row.bites++;
                row.lastBiteAt = run.startedAt || row.lastBiteAt;
            }
        }
    }
    return [...rows.values()]
        .map((row) => ({
            name: row.name,
            runs: row.runs,
            bites: row.bites,
            medianMs: median(row.samples),
            totalMs: row.samples.reduce((a, b) => a + b, 0),
            lastBiteAt: row.lastBiteAt,
        }))
        .sort((a, b) => b.totalMs - a.totalMs);
}

/** @param {number} ms Duration. @returns {string} Human duration, right-aligned. */
function dur(ms) {
    if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`.padStart(8);
    return `${(ms / 1000).toFixed(1)} s`.padStart(8);
}

/**
 * Renders the report.
 *
 * @returns {string[]} Lines to print.
 */
function formatReport() {
    const { runs, skipped, path: file, exists } = readRuns();
    const out = [];
    out.push(`\x1b[1m── Coût et morsures par gate ──\x1b[0m`);
    out.push(`  registre : ${file}`);

    if (!exists || runs.length === 0) {
        out.push("");
        out.push(
            `  \x1b[33mAucun run enregistré sur ce poste.\x1b[0m Le registre se remplit à chaque`
        );
        out.push(`  \x1b[2m  \`npm run ci:local\` ; il ne dit rien tant qu'il n'a rien vu.\x1b[0m`);
        return out;
    }

    const rows = aggregate(runs);
    const first = runs[0].startedAt || "?";
    const last = runs[runs.length - 1].startedAt || "?";
    out.push(
        `  ${runs.length} run(s) — du ${first} au ${last}${skipped ? ` · ${skipped} ligne(s) illisible(s), ignorée(s)` : ""}`
    );
    out.push("");
    out.push(`  \x1b[2m  médiane     cumul  runs  morsures  gate\x1b[0m`);

    for (const r of rows) {
        const silent = r.bites === 0;
        const bites = silent
            ? "\x1b[2m       0\x1b[0m"
            : `\x1b[33m${String(r.bites).padStart(8)}\x1b[0m`;
        out.push(
            `  ${dur(r.medianMs)}  ${dur(r.totalMs)}  ${String(r.runs).padStart(4)}  ${bites}  ${r.name}`
        );
    }

    const totalMs = rows.reduce((a, r) => a + r.totalMs, 0);
    const silent = rows.filter((r) => r.bites === 0);
    out.push("");
    out.push(`  Cumul de tous les runs : ${dur(totalMs).trim()}`);
    out.push(
        `  \x1b[2m${silent.length} gate(s) sur ${rows.length} n'ont jamais mordu ici — c'est une ENTRÉE de la\x1b[0m`
    );
    out.push(
        `  \x1b[2mrègle de sortie (CLAUDE.md §Admission et sortie des gates), jamais son verdict :\x1b[0m`
    );
    out.push(`  \x1b[2mun cliquet à zéro dette est censé rester muet.\x1b[0m`);
    return out;
}

module.exports = { ledgerPath, record, readRuns, aggregate, formatReport };
