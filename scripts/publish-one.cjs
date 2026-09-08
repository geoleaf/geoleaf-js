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
 *
 * 🛑 USE IT TO INSPECT A TARBALL TOO — a bare `npm publish --workspace=@geoleaf/core
 * --dry-run` is NOT a harmless dry run. It triggers `prepublishOnly`, hence
 * `rimraf dist`, so it silently STRIPS the workshop's 21 CSS stubs from disk and hands
 * back a file list that has none. Measured 2026-09-04: 0 `*.css.d.ts` that way, 21
 * through this script. "Nothing was published" is true; "nothing changed" is not.
 * Recovering costs one `node scripts/emit-css-type-stubs.cjs`, and knowing to run it
 * costs more.
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

    // 🛑 The skip applies to the DRY RUN TOO, and the `!dryRun` that used to stand here
    // is what made the rehearsal unfaithful on the one point it exists to rehearse.
    // `npm publish --dry-run` still asks the registry, and still answers `E403 You
    // cannot publish over the previously published versions` — so a package already at
    // this version turned the rehearsal RED while the real publication would have
    // skipped it and carried on. Seen on run 34173334174 (2026-09-08), which died on
    // `@geoleaf-plugins/file-import@1.0.5`, at parity with the registry.
    //
    // ⚠️ What the old form ALSO cost, and it is worse than the red: the skip branch was
    // never exercised by a rehearsal, so nothing could catch it going wrong — which is
    // how it stayed broken from its own writing until 2026-08-15 (see the comment above
    // on `pkg.manifest`).
    if (alreadyPublished(name, version)) {
        // ⚠️ Skipped, NOT published — and the output must say so, else a green run
        // reads as a publication that did not happen.
        console.log(
            `${C.y}↷ ${name}@${version} — DÉJÀ au registre, sauté${dryRun ? " (répétition à blanc)" : " (reprise de run)"}.${C.x}`
        );
        process.exit(0);
    }

    console.log(`→ Publishing ${name}@${version}${dryRun ? " (dry-run)" : ""}…`);
    // Explicit `--access public` rather than inherited from `publishConfig`: a
    // scoped package goes `restricted` when the flag is absent.
    //
    // 🛑 `--ignore-scripts` IS LOAD-BEARING, and the proof is at the REGISTRY, not in
    // this file. Without it npm runs the published workspace's `prepublishOnly`, which
    // for `@geoleaf/core` is `npm run build` = `rimraf dist && rollup … && tsc …` — a
    // chain that never calls `emit-css-type-stubs.cjs`. The publish therefore UNDOES
    // the workflow step that declares itself to decide the tarballs' content
    // (`publish.yml`, "Stubs de type CSS"), one step after it ran.
    //
    // Measured on `@geoleaf/core@3.1.0`, the `latest` at the time: **0** `*.css.d.ts`
    // in the published tarball against **21** on disk. Every consumer compiling with
    // `skipLibCheck: false` got TS2882 on the shipped `.d.ts`.
    //     curl -s "https://data.jsdelivr.com/v1/packages/npm/@geoleaf/core@3.1.0?structure=flat"
    // ⚠️ The core is the ONLY package whose build purges `dist/` — the others run a
    // bare `rollup -c`, so their own stubs survive their own `prepublishOnly`. Do not
    // read that as "the others are fine": measured the same day, four ALREADY-PUBLISHED
    // packages are missing declarations from their tarball at an equal version, for a
    // different reason — they were published before the stub emitter was fixed, and
    // never republished. `PUB-04` carries that debt and blocks any new occurrence.
    //
    // ⚠️ NOT the `ignore-scripts` the security remediation ruled out on 2026-08-31:
    // that one was `npm ci` — INSTALL time, esbuild's postinstall and husky's
    // `prepare`. This is PACK time, and it skips only the published workspace's own
    // lifecycle. Same word, different subject.
    //
    // ⚠️ THE COUNTERPART, and it must be read before removing the flag: the build is
    // now the CALLER's responsibility. `publish.yml` builds, emits the stubs and
    // re-asserts them (`--check`) before this runs; `release:check` does the same
    // locally. A manual publication goes through THIS script — which is why the root
    // `publish:*` scripts were routed here rather than kept as bare `npm publish`.
    const cmd =
        `npm publish --workspace=${name} --access public --ignore-scripts` +
        `${dryRun ? " --dry-run" : ""}`;
    try {
        execSync(cmd, { stdio: "inherit" });
    } catch {
        console.error(`${C.r}✗ ${name}@${version} — publication ÉCHOUÉE.${C.x}`);
        process.exit(1);
    }
    console.log(`${C.g}✓ ${name}@${version} publié.${C.x}`);
}

main();
