#!/usr/bin/env node
/**
 * MOD-HEADERS: every NEW source file must carry a module header (ARCHI S11).
 *
 * ## Why a baseline and not a flat rule
 *
 * 318 of 808 source files carry no module header. Turning that into a hard rule today
 * would mean writing 318 descriptions in one pass — and a description is the one kind
 * of statement no gate can check: a sentence that confidently describes the wrong
 * thing is indistinguishable, to every tool here, from a correct one. This repo has
 * been bitten by exactly that class often enough to name it (`index.d.ts` was edited
 * by four sprints while describing exports that no longer existed).
 *
 * So: the existing 318 are frozen in a baseline, and the gate holds two invariants.
 *
 *   MH-01  A file absent from the baseline MUST carry a module header.
 *          → a new file cannot arrive undocumented, which is what makes the generated
 *            tree converge instead of rotting.
 *   MH-02  The baseline MUST shrink. An entry whose file now has a header (or no
 *          longer exists) is an ERROR until it is removed from the baseline.
 *          → without it, a baseline is a permission slip rather than a debt register.
 *            Same reasoning as PCB-02 in `verify-plugin-core-boundary.cjs`.
 *   MH-03  No source file may carry an `@module` tag (STRUCT S5).
 *          → and this one has NO baseline, on purpose: the 514 tags were deleted rather
 *            than repaired, so the rule holds at zero. See below for why deleting beat
 *            fixing, and why a baseline here would be dead weight.
 *
 * ## Why `@module` is BANNED and not maintained (STRUCT S5, 26/07/2026)
 *
 * Measured before deciding: 478 files carried the tag in their leading block, 36 more
 * elsewhere — 514 total. Of those, only 274 matched the file's own path. The remaining
 * 204 were spread over four mutually inconsistent conventions (src-relative path,
 * `GeoLeaf.*` namespace, barrel-named-after-its-folder, plugin-prefixed), so **43 % of
 * the tags pointed somewhere that did not exist.**
 *
 * And nothing read them. `moduleTag` was written into the inventory and consumed by
 * NOTHING; `packages/core/typedoc.json` is `entryPointStrategy: "resolve"`, which walks
 * imports from one entry point and never reads a per-file `@module` — verified against
 * the generated output, where no tag value appears at all. The tag's only remaining
 * function was orienting a human, and it misled 43 % of the time.
 *
 * A tag required to equal its own file's path carries no information: its only two
 * states are "correct" and "drifted". So it is banned, not synchronised. Restoring it
 * later, should TypeDoc ever move to `expand`, is a script that regenerates 514 tags
 * from 514 paths — the option is deferred at low cost, not lost.
 *
 * ⚠️ Out of scope, knowingly: `scripts/*.cjs` (the gate reads `collect()`, which is
 * packages-only by default) and `.d.ts` / `__tests__` files, which `collect()` skips.
 * Their tags were removed by hand for uniformity but are NOT guarded here.
 *
 * The definition of "documented" is NOT restated here — it is imported from
 * `lib/source-inventory.cjs`, the same module the generator reads. A gate and its
 * generator that each own a copy of the rule drift apart, and the disagreement shows
 * up as a green gate on a file the doc reports as missing.
 *
 * Usage: node scripts/check-module-headers.cjs                (gate)
 *        node scripts/check-module-headers.cjs --update-baseline
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const inventory = require("./lib/source-inventory.cjs");

const ROOT = inventory.ROOT;
const BASELINE = path.join(ROOT, "scripts", ".baselines", "module-headers.json");
const UPDATE = process.argv.includes("--update-baseline");

const { files } = inventory.collect();
const undocumented = files
    .filter((f) => !f.documented)
    .map((f) => f.rel)
    .sort();

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "ARCHI S11 — source files with no module header, frozen. This list may " +
                    "only SHRINK (MH-02): document a file, then remove its line. Never add " +
                    "to it by hand — a new file must be born documented (MH-01).",
                _generated: "node scripts/check-module-headers.cjs --update-baseline",
                files: undocumented,
            },
            null,
            // 4, not 2: Prettier owns this file (`tabWidth: 4`, lint-staged runs it on
            // `*.json`). At 2 the hook silently reformatted every line on commit, so a
            // one-entry shrink of the baseline showed up as a 643-line diff — unreviewable
            // exactly when a reviewer needs to see WHICH entry moved.
            4
        ) + "\n"
    );
    console.log(`✅ [MOD-HEADERS] baseline written — ${undocumented.length} undocumented files.`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error("ERROR [MOD-HEADERS]: baseline missing.");
    console.error("Run: node scripts/check-module-headers.cjs --update-baseline");
    process.exit(1);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).files);
const documentedNow = new Set(files.filter((f) => f.documented).map((f) => f.rel));
const known = new Set(files.map((f) => f.rel));

// MH-01 — undocumented AND absent from the baseline.
const newlyUndocumented = undocumented.filter((rel) => !baseline.has(rel));

// MH-02 — baseline entries that are no longer true.
const staleEntries = [...baseline].filter((rel) => documentedNow.has(rel) || !known.has(rel));

// MH-03 — no `@module` tag at all. `hasModuleTag` is derived from the RAW source in
// source-inventory, not from `moduleTag`: keying this on the parsed header would have
// missed 34 of the 514 tags and sorted green. No baseline — the rule holds at zero.
const withModuleTag = files
    .filter((f) => f.hasModuleTag)
    .map((f) => f.rel)
    .sort();

let failed = false;

if (newlyUndocumented.length > 0) {
    failed = true;
    console.error(
        `ERROR [MOD-HEADERS/MH-01]: ${newlyUndocumented.length} source file(s) carry no module header:`
    );
    for (const rel of newlyUndocumented) console.error(`  ${rel}`);
    console.error("");
    console.error(
        "Add a JSDoc block after the license banner saying what the file is for. It feeds " +
            "ARBORESCENCE_QUALIFIEE.md — a file without one renders as 'non documenté'."
    );
}

if (staleEntries.length > 0) {
    failed = true;
    console.error(
        `ERROR [MOD-HEADERS/MH-02]: ${staleEntries.length} baseline entr(y|ies) are no longer true:`
    );
    for (const rel of staleEntries) {
        console.error(`  ${rel} — ${known.has(rel) ? "now documented" : "no longer exists"}`);
    }
    console.error("");
    console.error(
        "The baseline is a debt register, not a permission slip: it may only shrink. " +
            "Run: node scripts/check-module-headers.cjs --update-baseline"
    );
}

if (withModuleTag.length > 0) {
    failed = true;
    console.error(
        `ERROR [MOD-HEADERS/MH-03]: ${withModuleTag.length} source file(s) carry an \`@module\` tag:`
    );
    for (const rel of withModuleTag) console.error(`  ${rel}`);
    console.error("");
    console.error(
        "`@module` is banned in this repo, not maintained (STRUCT S5): nothing reads it — " +
            'TypeDoc runs `entryPointStrategy: "resolve"` and never looks at a per-file tag — ' +
            "and 204 of the 478 tags named a path that did not exist. Delete the line. " +
            "The file's path already says where the file is."
    );
}

if (failed) process.exit(1);

const pct = (((files.length - undocumented.length) / files.length) * 100).toFixed(1);
console.log(
    `✅ [MOD-HEADERS] ${files.length - undocumented.length}/${files.length} files documented ` +
        `(${pct} %); ${baseline.size} in the baseline, none new, none stale; 0 \`@module\` tag.`
);
process.exit(0);
