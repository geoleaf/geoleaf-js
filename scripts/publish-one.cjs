#!/usr/bin/env node
/**
 * publish-one.cjs — publishes ONE named workspace, skipping what the registry
 * already carries.
 *
 * Usage : node scripts/publish-one.cjs <npm-name> [--dry-run]
 *
 * ## Why this script exists, and why NOT inside `publish-plugins.cjs`
 *
 * `publish.yml` publishes `@geoleaf/core` then `@geoleaf/field-renderer` BEFORE
 * the 12 plugins — the 12 declare the core at `^3.0.0`, and `editor` additionally
 * declares `field-renderer`. Those two steps were BARE `npm publish`: on a version
 * already at the registry, npm returns `E403` and the workflow dies at its first
 * step, never reaching what it exists to publish. Measured on 2026-08-15, with
 * `core@3.0.0` and `field-renderer@1.0.0` published since 08-12.
 *
 * 🛑 THIS IS NOT A WIDENING OF `publish-plugins.cjs`, deliberately. Its
 * `PUBLISHED_PLUGINS` list is a hand-written POLICY, and its header explicitly
 * forbids widening it as a refactoring side effect — "publishing is externally
 * visible and hard to walk back". Publishing the core through a script named
 * "publish-plugins", or adding it an `--only` able to target off-list, would work
 * around that rule instead of honouring it. This script therefore takes its
 * subject AS AN ARGUMENT, with no list to widen.
 *
 * ⚠️ It is no shortcut to publish anything: it refuses a workspace unknown to
 * `packages.cjs`, and a `private` workspace.
 */
"use strict";

const { execSync } = require("child_process");
const registry = require("./lib/packages.cjs");
const { alreadyPublished } = require("./lib/npm-registry.cjs");

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };

function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const name = args.find((a) => !a.startsWith("--"));

    if (!name) {
        console.error(`${C.r}✗ usage : node scripts/publish-one.cjs <nom-npm> [--dry-run]${C.x}`);
        process.exit(1);
    }

    // Refusal of an unknown subject: `npm publish --workspace=<unknown>` would fail
    // anyway, but much further along and with a message that does not name the cause.
    const pkg = registry.byName(name);
    if (!pkg) {
        console.error(`${C.r}✗ \`${name}\` n'est pas un workspace de ce dépôt.${C.x}`);
        process.exit(1);
    }
    if (pkg.private) {
        console.error(
            `${C.r}✗ \`${name}\` est \`private\` — il n'a rien à faire au registre.${C.x}`
        );
        process.exit(1);
    }

    // 🛑 `pkg.manifest.version`, NOT `pkg.version` — `byName()` returns
    // `{name, dir, absDir, dirName, private, manifest}` and exposes NO root-level
    // `version`. Reading `pkg.version` yields `undefined`, `npm view <name>@undefined`
    // fails, detection concludes "not published" and the script publishes what it
    // was meant to skip. Exactly the defect that lived in `publish-plugins.cjs`
    // (see there).
    const { version } = pkg.manifest;

    if (!dryRun && alreadyPublished(name, version)) {
        // ⚠️ Skipped, NOT published — and the output must say so, else a green run
        // reads as a publication that did not happen.
        console.log(`${C.y}↷ ${name}@${version} — DÉJÀ au registre, sauté (reprise de run).${C.x}`);
        process.exit(0);
    }

    console.log(`→ Publishing ${name}@${version}${dryRun ? " (dry-run)" : ""}…`);
    // Explicit `--access public` rather than inherited from `publishConfig`: a
    // scoped package goes `restricted` when the flag is absent.
    const cmd = `npm publish --workspace=${name} --access public${dryRun ? " --dry-run" : ""}`;
    try {
        execSync(cmd, { stdio: "inherit" });
    } catch {
        console.error(`${C.r}✗ ${name}@${version} — publication ÉCHOUÉE.${C.x}`);
        process.exit(1);
    }
    console.log(`${C.g}✓ ${name}@${version} publié.${C.x}`);
}

main();
