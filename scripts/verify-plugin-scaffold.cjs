#!/usr/bin/env node
/**
 * SCAFFOLD: the plugin template produces a plugin that compiles and conforms.
 *
 * ## Why this gate exists — the template is the one package nothing reads
 *
 * `packages/_plugin-template/` is invisible to every standing check, and for two
 * INDEPENDENT reasons that happen to overlap:
 *
 *   - it sits in ESLint's `ignores` (`eslint.config.mjs`), legitimately — its
 *     `__PLUGIN_NAME__` / `__PLUGIN_PKG__` tokens are not valid TypeScript, so linting or
 *     typechecking the template ITSELF is not merely unhelpful, it is impossible;
 *   - it sits outside the `workspaces` globs (`!packages/_*`), so `registry.all()` never
 *     returns it and the gates derived from it — `verify-plugin-contract.cjs`,
 *     `count-any.cjs`, `test-scope.cjs`, the root typecheck — do not know it exists.
 *
 * Neither is a bug. Together they make a file that every future plugin is BORN FROM, and
 * that nothing verifies. The cost is measured twice over:
 *
 *   - the `const _g = globalThis as any` accessor survived here until 31/07/2026,
 *     "invisible to BOTH guards" (`entry.ts` says so in its own header), so every plugin
 *     ever scaffolded was born with the two `as any` that `@geoleaf/host-runtime` exists
 *     to remove;
 *   - on 08/08/2026 the template was found declaring its toolbar button under
 *     `ui.show<Namespace>` while its own `config.ts` read `modules.<id>` — a violation of
 *     **INV-CONFIG**, a FROZEN invariant of Plugin Contract v1, and the only line of the
 *     §9 checklist carrying no executable `PC-` check beside it. A plugin scaffolded from
 *     it had a button that the configuration its own file documented could not switch on.
 *
 * ## The mechanism — check the OUTPUT, since the input cannot be checked
 *
 * The template cannot be compiled; its substituted output can. So this gate scaffolds into
 * a disposable package, runs the real tools on the result, and removes it. That is the only
 * channel through which a file full of placeholders can be held to the same bar as the code
 * it generates.
 *
 *   SCAF-01  `create-plugin.cjs` exits 0 — it runs its own PC-01…PC-12 + INV-CONFIG checks
 *   SCAF-02  the generated sources compile under the package tsconfig (`tsc --noEmit`)
 *   SCAF-03  the generated package satisfies Plugin Contract v1 (`--plugin=<id>`)
 *   SCAF-04  flag gating emits the right file set — the anti-vacuity assertion: without it
 *            a scaffold producing an EMPTY `src/` would satisfy SCAF-01…03 by having
 *            nothing to fault
 *
 * Both scaffold shapes are exercised (`--ui --i18n`, and bare), because the flags select
 * different files and different gated blocks — a template correct in one shape and broken
 * in the other is exactly what a single-variant gate would miss.
 *
 * ## Prerequisite, asserted rather than assumed
 *
 * SCAF-02 needs `@geoleaf/core`'s emitted types. `ci:local` runs `turbo run build` long
 * before this gate, so the condition holds there; run standalone on a clean tree it does
 * not. The gate FAILS on the missing prerequisite instead of skipping — a gate that goes
 * green having compiled nothing is the failure mode this whole file is about.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CORE_TYPES = path.join(ROOT, "packages", "core", "dist", "types");

/**
 * The two shapes under test. Names are prefixed `zz-` so they sort last and read as
 * disposable; a collision with a real plugin aborts loudly in `create-plugin.cjs` rather
 * than clobbering it.
 */
const SHAPES = [
    {
        id: "zz-scaffold-full",
        flags: ["--ui", "--i18n"],
        // [relative path, must exist]
        files: [
            ["src/entry.ts", true],
            ["src/config.ts", true],
            ["src/public-api.ts", true],
            ["src/css/geoleaf-zz-scaffold-full.css", true],
            ["src/lang/lang-fr.ts", true],
            ["README.template.md", false], // template-only doc, never emitted
        ],
    },
    {
        id: "zz-scaffold-bare",
        flags: [],
        files: [
            ["src/entry.ts", true],
            // ⚠️ `config.ts` MUST be emitted without `--ui`. It was skipped until
            // 08/08/2026, lumped in with the stylesheets, so a non-UI plugin was scaffolded
            // with no way to read its own `modules.<id>` branch. Config is not a UI concern.
            ["src/config.ts", true],
            ["src/public-api.ts", true],
            ["src/css.d.ts", false],
            ["src/lang/lang-fr.ts", false],
        ],
    },
];

const errors = [];
/** Absolute dirs THIS run created — the only paths `cleanup()` may ever remove. */
const created = [];

/**
 * Remove ONLY what this run created.
 *
 * ⚠️ The rule is not "be careful with rm", it is that a cleanup routine must never remove a
 * path it did not create. `probe-gate-visibility.cjs` learned it by deleting 13 real plugins
 * (557 files) with an `rmSync` on a directory it had merely assumed was its own. Here, a dir
 * is pushed to `created` only after `create-plugin.cjs` reported success on a path that
 * provably did not exist beforehand.
 */
function cleanup() {
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
}

/** Run a command, returning `{ code, out }` with stdout and stderr merged. */
function run(cmd, args, cwd) {
    const r = spawnSync(cmd, args, { cwd: cwd || ROOT, encoding: "utf8", shell: false });
    return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}

// ─── Prerequisite ─────────────────────────────────────────────────────────────

if (!fs.existsSync(CORE_TYPES)) {
    console.error(
        `\n✘ SCAFFOLD: prerequisite missing — ${path.relative(ROOT, CORE_TYPES)}/ does not ` +
            `exist, so SCAF-02 would typecheck against an untyped '@geoleaf/core'.\n\n` +
            `  Build first:  npx turbo run build\n\n` +
            `  This is a failure and not a skip on purpose: a gate that reports success ` +
            `having compiled nothing is the exact defect this gate exists to catch.\n`
    );
    process.exit(1);
}

// ─── Assertions ───────────────────────────────────────────────────────────────

try {
    for (const shape of SHAPES) {
        const destRel = path.posix.join("packages", "plugins", shape.id);
        const destDir = path.join(ROOT, "packages", "plugins", shape.id);

        if (fs.existsSync(destDir)) {
            errors.push(
                `SCAF-00 ${destRel}/ already exists — a previous run left debris, or a real ` +
                    `package took the name. Inspect and remove it by hand; this gate will ` +
                    `not delete a directory it did not create.`
            );
            continue;
        }

        // SCAF-01 — the scaffold builds and passes its own self-checks.
        const scaffold = run("node", [
            "scripts/create-plugin.cjs",
            shape.id,
            ...shape.flags,
        ]);
        if (scaffold.code !== 0) {
            errors.push(
                `SCAF-01 create-plugin.cjs exited ${scaffold.code} for "${shape.id}" ` +
                    `(${shape.flags.join(" ") || "no flags"}) —\n${indent(scaffold.out)}`
            );
            continue;
        }
        created.push(destDir);

        // SCAF-04 — flag gating emits the right files. Checked BEFORE the expensive steps:
        // it is the assertion that proves the following two had a subject at all.
        for (const [rel, mustExist] of shape.files) {
            const present = fs.existsSync(path.join(destDir, rel));
            if (present !== mustExist)
                errors.push(
                    `SCAF-04 "${shape.id}" (${shape.flags.join(" ") || "no flags"}): ` +
                        `${rel} is ${present ? "present" : "absent"}, expected ` +
                        `${mustExist ? "present" : "absent"} — check shouldSkip() and the ` +
                        `/* <ui> */ · /* <i18n> */ blocks in create-plugin.cjs.`
                );
        }

        // SCAF-02 — the generated TypeScript compiles.
        const tsc = run("npx", ["tsc", "--noEmit"], destDir);
        if (tsc.code !== 0)
            errors.push(
                `SCAF-02 "${shape.id}" does not typecheck —\n${indent(tsc.out)}\n` +
                    `  The template itself cannot be typechecked (placeholder tokens are not ` +
                    `valid TS); this is the only channel that holds it to the bar.`
            );

        // SCAF-03 — the generated package satisfies Plugin Contract v1.
        const contract = run("node", [
            "scripts/verify-plugin-contract.cjs",
            `--plugin=${shape.id}`,
            "--fail",
            "--quiet",
        ]);
        if (contract.code !== 0)
            errors.push(`SCAF-03 "${shape.id}" violates Plugin Contract v1 —\n${indent(contract.out)}`);
    }
} finally {
    cleanup();
}

function indent(text) {
    return (text || "(no output)")
        .split("\n")
        .map((l) => `      ${l}`)
        .join("\n");
}

if (errors.length) {
    console.error(`\n✘ SCAFFOLD: ${errors.length} violation(s) —\n`);
    for (const e of errors) console.error(`  • ${e}\n`);
    process.exit(1);
}

// ⚠️ Counts are DERIVED, never written beside the list — a written total is a second source
// of truth that can only diverge (B-43, and the same doctrine as APP-TEMPLATE's HELD list).
const CHECKS = ["self-checks", "typecheck", "Plugin Contract v1", "sélection par drapeau"];
console.log(
    `✔ SCAFFOLD: packages/_plugin-template/ — ${SHAPES.length} formes scaffoldées ` +
        `(${SHAPES.map((s) => s.id.replace("zz-scaffold-", "")).join(", ")}), ` +
        `${CHECKS.length} contrôles chacun (${CHECKS.join(", ")}).`
);
