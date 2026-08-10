#!/usr/bin/env node
/**
 * Dead-code gate (knip wrapper).
 *
 * ## Why a wrapper at all
 *
 * NOT because knip's exit code is broken. This header used to claim that
 * `totalErrorCount` resolved to `NaN` under knip 5.85, so `NaN > max-issues` was
 * always false and knip exited 0 while reporting issues. **Measured on 25/07/2026:
 * false.** Knip 5.85 exits 1 on the 160 signals of this repo, with the `symbols`
 * reporter and with `--reporter json` alike. The claim survived because nobody
 * re-ran the check after the version that motivated it.
 *
 * The real reason is the **baseline contract**, which knip cannot express: fail only
 * on a signal ABSENT from a frozen set, and let that set shrink but never grow.
 * Knip's own `--max-issues` is a count, not a set — it would accept a brand-new dead
 * export as long as an old one disappeared the same day.
 *
 * ## Reporters
 *
 * Two of them, deliberately:
 *   - `json` → stdout, parsed below. It is the only reporter with a stable machine
 *     shape.
 *   - `lib/knip-hints-reporter.mjs` → stderr, because the `json` reporter emits NO
 *     `configurationHints` (see `knip/dist/reporters/json.js`). Every hint knip
 *     produced used to be dropped on the floor, and `knip.js` quietly accumulated
 *     seven entries matching nothing — the exact rot its own header claims to have
 *     killed. Hints are now **blocking**: a config entry that matches nothing is a
 *     lie about what the gate audits, so it fails the run.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const KNIP_BIN = path.join(ROOT, "node_modules", "knip", "bin", "knip.js");
const HINTS_REPORTER = "./scripts/lib/knip-hints-reporter.mjs";

/** Prefix emitted by {@link HINTS_REPORTER} — keep in sync with that file. */
const HINT_PREFIX = "knip-hint";

const res = spawnSync(
    process.execPath,
    [KNIP_BIN, "--no-progress", "--reporter", "json", "--reporter", HINTS_REPORTER],
    {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
    }
);

// Surface knip's own stderr (warnings, configuration hints) for visibility.
if (res.stderr && res.stderr.trim()) process.stderr.write(res.stderr);

/** Configuration hints, extracted from the lines {@link HINTS_REPORTER} wrote. */
const hints = (res.stderr || "")
    .split("\n")
    .filter((l) => l.startsWith(HINT_PREFIX))
    .map((l) => l.slice(HINT_PREFIX.length).trim());

if (res.error || res.status === 2) {
    if (res.stdout) process.stdout.write(res.stdout);
    console.error("\n✖ knip failed to run (see above).");
    process.exit(2);
}

let data;
try {
    data = JSON.parse(res.stdout);
} catch {
    if (res.stdout) process.stdout.write(res.stdout);
    console.error("\n✖ could not parse knip JSON output.");
    process.exit(2);
}

// Every array-shaped category the json reporter can emit — `nsExports`, `nsTypes`
// and `classMembers` included. Those three are off by default
// (`knip/dist/util/get-included-issue-types.js#defaultExcludedIssueTypes`), so they
// change nothing today; they were missing here, which means any future `include`
// would have had its findings silently dropped by this loop instead of gating.
const CATEGORIES = [
    "dependencies",
    "devDependencies",
    "optionalPeerDependencies",
    "unlisted",
    "binaries",
    "unresolved",
    "exports",
    "nsExports",
    "types",
    "nsTypes",
    "duplicates",
    "catalog",
];

const lines = [];

// Unused FILES arrive in two different shapes, and both are read on purpose.
//
// knip 5.85 emitted a top-level `files: string[]`. knip 6 moved them into a per-issue
// `files: [{ name }]` category instead — and because `"files"` is not in CATEGORIES
// (a file is not a symbol; it carries no `line`), this loop dropped the repo's ONLY
// real finding, `sidepanel-renderer.contract.ts`, while knip's own reporter printed it.
// The gate went green announcing "no unused files" about a run that found one. Measured
// at the 6.29.0 bump on 26/07/2026, which is exactly the silent breakage the bump was
// sequenced late to expose. Both shapes stay handled: reverting the version must not
// re-break the gate in the other direction.
for (const file of data.files || []) {
    lines.push(`  ${"file".padEnd(10)} ${file}`);
}
for (const issue of data.issues || []) {
    for (const e of Array.isArray(issue.files) ? issue.files : []) {
        // Same rendering as the 5.85 branch above, so baseline keys stay stable.
        lines.push(`  ${"file".padEnd(10)} ${typeof e === "string" ? e : e.name}`);
    }
    for (const cat of CATEGORIES) {
        const entries = issue[cat];
        if (Array.isArray(entries)) {
            for (const e of entries) {
                lines.push(`  ${cat.padEnd(10)} ${e.name}  ${issue.file}:${e.line ?? ""}`);
            }
        }
    }
    // `enumMembers` and `classMembers` are the two map-shaped categories
    // (parent symbol → members), so they cannot go through the loop above.
    for (const cat of ["enumMembers", "classMembers"]) {
        const members = issue[cat];
        if (!members || typeof members !== "object") continue;
        const label = cat === "enumMembers" ? "enumMember" : "classMember";
        for (const parent of Object.keys(members)) {
            const arr = members[parent];
            if (!Array.isArray(arr)) continue;
            for (const e of arr) {
                lines.push(
                    `  ${label.padEnd(10)} ${parent}.${e.name}  ${issue.file}:${e.line ?? ""}`
                );
            }
        }
    }
}

// ── Shape invariant: knip found issues, so this parser must have found some too ──
//
// The one class of failure this gate cannot survive is a JSON reporter whose shape it
// no longer understands: every branch above then yields nothing, and the gate prints
// "no unused files, dependencies, exports or types" about a run full of them. That is
// not hypothetical — it is what the knip 6 bump did on 26/07/2026 (see the `files`
// comment above), and the only reason it was caught is that someone happened to run the
// default reporter side by side.
//
// knip exits 1 when it reports issues and 0 when it does not. So `exit 1 + zero parsed
// lines` is a contradiction between the tool and its reader, and it can only mean the
// contract drifted. Fail as a RUN error (exit 2), not as a finding: there is nothing to
// baseline and nothing to fix in the source tree — the parser is what is wrong.
if (res.status === 1 && lines.length === 0) {
    if (res.stdout) process.stdout.write(res.stdout);
    console.error(
        `\n✖ dead-code: knip a sorti exit 1 (donc il a trouvé des signaux) mais ce script ` +
            `n'en a lu AUCUN.\nLa forme du reporter \`json\` a changé et le parseur ne la ` +
            `comprend plus — comparer avec \`npx knip --no-progress\` et remettre ` +
            `CATEGORIES / la lecture des \`files\` en phase. Ne PAS régénérer la baseline : ` +
            `elle se solderait à vide en gelant une cécité.`
    );
    process.exit(2);
}

// The lazy-chunk orphan gate (scripts/check-lazy-orphans.cjs) was folded in here until S5.
// It is gone with the machinery it guarded: `src/lazy/` no longer exists, the whole
// dynamic-import composition root was removed, and there is no second, knip-invisible
// entry graph left to police. The tree-shaking gate (`npm run size:example`) is what now
// guards the composition boundary — and it measures the artifact, not the source.

// ── Baseline ────────────────────────────────────────────────────────────────
//
// Added at API S2.4b, when `@geoleaf/core` entered knip's field of view for the first
// time. Until then the `"./dist/*"` passthrough in the package's `exports` made knip
// treat every file under `src/` as an entry point — and an entry is never "unused" —
// so ~470 files reported 0 issues. Removing that subpath fixed the blindness and
// surfaced 160 signals in one go.
//
// Those 160 were triaged one by one against the whole monorepo (API S2.4c): 116 are
// consumed by shipped code (barrel re-exports knip counts twice), 39 are used inside
// their own file, 3 by tests only, 1 was already exempt — and **0 were actionable**.
// The baseline froze a state believed CLEAN. It was not a debt ledger; it was the price
// of knip's barrel semantics.
//
// Same contract as `check-orphan-exports.baseline.json`: the gate fails only on a
// signal ABSENT from the baseline, and the baseline may only shrink. Regenerate
// deliberately with `--update-baseline`, never to silence a fresh finding.
//
// ── 26/07/2026: 158 rows → 1, and why that is NOT a silencing ────────────────
//
// The rule above forbids regenerating to silence a finding. This shrink is the other
// case: the gate's SCOPE changed, its verdict did not. `knip.js` now carries
// `ignoreIssues: { "packages/core/src/**": ["exports","types"] }` — motive written out
// in full there. Paying 157 frozen rows to re-assert a triage that found 0 actionable
// items bought nothing, and it set the odds of any future alarm in that category at
// ~27 % correct. The signals were not hidden; the category was retired, on the core
// only, with `check-orphan-exports.cjs` left as sole gate on that angle.
//
// What remains is 1 row, and it is REAL debt, deliberately out of scope for this lot:
// `packages/core/src/contracts/sidepanel-renderer.contract.ts` — its interfaces are
// redeclared in `capabilities/feature-info/types.ts` and the two copies have already
// diverged (`SidePanelFeatureDetail` vs `GeoLeafFeatureClickDetail`). It is tracked as
// **B-22** in `_docs_projet/registres/backlog_technique.md`.
//
// ⚠️ It is NOT blocked. An earlier draft of this comment said "which copy is canonical
// depends on Q1 of the API audit §8" — Q1 was decided on 25/07/2026 (yes, extension
// contracts are public), and B-22 records the answer: THIS file is the canonical one,
// and `feature-info/types.ts` must point at it instead of keeping a second copy. What
// remains is the work, not the decision — and it carries its own pre-flight, because
// two copies that have drifted do not reunify by deleting the one presumed obsolete.
//
// A baseline of one entry, naming its backlog item, is the whole point of the mechanism.

const BASELINE_PATH = path.join(__dirname, "check-dead-code.baseline.json");

/** Baseline keys ignore the line number — a symbol must not reappear on edit. */
const keyOf = (line) => line.trim().replace(/:\d+\s*$/, "");

if (process.argv.includes("--update-baseline")) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(lines.map(keyOf).sort(), null, 2) + "\n");
    console.log(`✓ dead-code: baseline régénérée (${lines.length} signal(aux) figé(s)).`);
    process.exit(0);
}

let baseline = [];
if (fs.existsSync(BASELINE_PATH)) {
    try {
        baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    } catch {
        console.error(`✖ dead-code: ${BASELINE_PATH} illisible.`);
        process.exit(2);
    }
}
const known = new Set(baseline);
const fresh = lines.filter((l) => !known.has(keyOf(l)));
const stale = baseline.filter((k) => !lines.some((l) => keyOf(l) === k));

// ── Configuration hints ─────────────────────────────────────────────────────
//
// Blocking, and NOT baselined. A hint means a `knip.js` entry matches nothing, so
// unlike a dead export it is never a structural false positive to be argued and
// frozen — it is always removable, in the file itself, in one edit. Baselining it
// would recreate exactly the blindness this gate exists to prevent.
if (hints.length > 0) {
    console.error(
        `✖ dead-code: ${hints.length} entrée(s) de configuration morte(s) dans knip.js :\n`
    );
    for (const hint of hints) console.error(`  ${hint}`);
    console.error(
        `\nCes entrées ne matchent rien — les retirer de knip.js. Une config qui décrit ` +
            `un état révolu ment sur ce que la gate audite.`
    );
    process.exit(1);
}

if (fresh.length === 0) {
    if (lines.length === 0) console.log("✓ knip: no unused files, dependencies, exports or types.");
    else console.log(`✓ knip: aucun NOUVEAU signal (${baseline.length} déjà en baseline).`);
    if (stale.length)
        console.log(
            `ℹ ${stale.length} entrée(s) de baseline obsolète(s) — resserrer avec \`--update-baseline\`.`
        );
    process.exit(0);
}

console.error(
    `✖ dead-code: ${fresh.length} NOUVEAU(X) signal(aux) (${baseline.length} en baseline) :\n`
);
console.error(fresh.join("\n"));
console.error(
    `\nCorriger, ou — si c'est un faux positif structurel — l'argumenter et régénérer la baseline.`
);
process.exit(1);
