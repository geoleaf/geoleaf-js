#!/usr/bin/env node
/**
 * GATE-PROBE: are the gates still SIGHTED on a nested package?
 *
 * ## The failure this exists to catch
 *
 * ARCHI S10 moves 13 plugins under `packages/plugins/` and 3 libraries under
 * `packages/libs/`. Before the regrouping, ten sites across eight gates enumerated
 * `packages/` one level deep and then did:
 *
 *     if (!fs.existsSync(srcDir)) continue;   // ← silent
 *
 * After the move those gates would have found `plugins/` and `libs/` with no
 * `src/`, skipped, and exited 0 having scanned NOTHING. Not a red build — a green
 * one, reporting zero violations across zero files. Six of the eight run in
 * `ci:local`.
 *
 * A second class fails differently and is worse: a hard-coded glob
 * (`packages/plugin-*​/src/**`) does not "miss" violations, it stops matching
 * anything — so an ESLint rule elevated to `error` silently reverts to `warn`.
 * Nothing is red, and there is no diff to blame.
 *
 * Neither class announces itself. The only way to know a gate still sees a
 * package is to give it a package with a known defect and check that it reacts.
 *
 * ## What this does
 *
 * Plants `packages/plugins/__probe__/` — a nested workspace carrying one deliberate
 * defect per gate — then asserts each gate reports it. Two families:
 *
 *   A. GATE VISIBILITY — the gate runs but no longer sees the file.
 *      Asserted by: the gate must mention `__probe__` in its output.
 *   B. RULE ARMAMENT — the rule stops existing rather than missing a violation.
 *      Asserted structurally: every ratchet glob must still match real files.
 *
 * ## Usage
 *
 *   node scripts/probe-gate-visibility.cjs          # plant, assert, clean up
 *   node scripts/probe-gate-visibility.cjs --keep   # leave the probe in place
 *
 * Exits 0 when every gate saw the probe, 1 otherwise. Always removes the probe and
 * restores package.json, including on error — a probe that leaks into the tree
 * would be worse than no probe.
 *
 * ⚠️ No `npm install` is needed: the registry derives from the workspace globs by
 * reading directories, and the gates scan files. Keeping install out makes this
 * runnable in a second, so it can be run BEFORE and AFTER the S10 move.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PROBE_REL = "packages/plugins/__probe__";
const PROBE_DIR = path.join(ROOT, PROBE_REL);
const PKG_JSON = path.join(ROOT, "package.json");
const KEEP = process.argv.includes("--keep");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    c: "\x1b[36m",
    d: "\x1b[2m",
    x: "\x1b[0m",
};

let pkgJsonBackup = null;
/** True only when THIS run created `packages/plugins/` — see cleanup(). */
let createdPluginsDir = false;

// ─── Probe fixture ────────────────────────────────────────────────────────────

/**
 * Write the nested probe package. Every file carries exactly one planted defect,
 * chosen to match what the target gate ACTUALLY tests for — not what it sounds
 * like it tests for.
 *
 * That distinction is not theoretical: the first version of this probe used
 * `(globalThis as { L?: … }).L?.marker` for the Leaflet check and reported
 * `verify-no-leaflet` as blind. The probe was wrong, not the gate — `L\.` does not
 * match `L?.`, and `(global|globalThis|window)\.L\b` requires adjacency that the
 * type assertion breaks. A probe not validated against the gate's real criteria
 * proves the opposite of what it appears to prove.
 */
function plantProbe() {
    if (fs.existsSync(PROBE_DIR)) {
        throw new Error(
            `${PROBE_REL} exists already — refusing to overwrite. Remove it by hand if it is a leftover.`
        );
    }
    createdPluginsDir = !fs.existsSync(path.join(ROOT, "packages", "plugins"));
    fs.mkdirSync(path.join(PROBE_DIR, "src", "lang"), { recursive: true });

    // check-package-files: a files[] entry that does not exist on disk.
    fs.writeFileSync(
        path.join(PROBE_DIR, "package.json"),
        JSON.stringify(
            {
                name: "@geoleaf-plugins/__probe__",
                version: "3.0.0",
                private: true,
                type: "module",
                // `docs`: embarks the artefact directory planted below,
                // which PKG-FILES' check 2 must refuse. `docs/` thus exists
                // on disk, and the original defect
                // (`THIS-FILE-DOES-NOT-EXIST.md`, check 1) stays intact —
                // two defects, two checks, one manifest.
                files: ["dist", "THIS-FILE-DOES-NOT-EXIST.md", "docs"],
                // SHIP-SPEC: `check-shipped-specifiers`' corpus is DERIVED
                // from the `exports` map — each target's root. Without this
                // map, the probe package would contribute no file and the
                // assertion below would pass GREEN proving nothing. The
                // failure mode this whole file hunts, so it had to be
                // written here rather than in the gate.
                exports: {
                    ".": {
                        types: "./dist/types/index.d.ts",
                        import: "./dist/index.js",
                    },
                },
            },
            null,
            4
        ) + "\n"
    );

    // verify-no-leaflet: a literal Leaflet import + a runtime `L.` call.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "entry.ts"),
        'import L from "leaflet";\n\nexport function probe() {\n    return L.marker([0, 0]);\n}\n'
    );

    // verify-plugin-core-boundary: a deep import into the core sources.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "deep-import.ts"),
        'import { Log } from "../../../core/src/utils/log/index.js";\n\nexport const probeLog = Log;\n'
    );

    // check-exact-optional-debt (EOD-01): a property widened to
    // `?: T | undefined`, outside the baseline. The gate derives its corpus
    // from `registry.all()`; if it stops enumerating nested packages, it
    // goes quiet here. The shape is chosen to be otherwise invisible to a
    // naive grep: the AST VISIT is what must see it.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "widened.ts"),
        "export interface ProbeWidened {\n    probeField?: string | undefined;\n}\n"
    );

    // check-nonnull-assertion-debt (NNA-04): an asserted indexed read. It
    // has NO baseline, so it turns red without needing to be kept off a
    // list — but it only turns red here if the gate still enumerates nested
    // packages. Same class as the previous one, and same reason to plant it
    // in `__probe__` rather than the core.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "asserted-index.ts"),
        "export function probeAsserted(xs: string[]): string {\n    return xs[0]!;\n}\n"
    );

    // verify-plugin-shared-fork: a LOCAL re-definition of a host-runtime canonical symbol.
    // `coreConfigGet` is a roadmap anchor, so if the gate's symbol-derivation ever silently
    // empties, this file stops being flagged — the probe catches BOTH the "gate blind to a
    // nested package" and the "gate scanning for nothing" modes. __probe__ has no baseline
    // entry, so PSF-01 must name this file.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "fork.ts"),
        "export function coreConfigGet(key, fallback) {\n    return fallback;\n}\n"
    );

    // check-event-map-coverage: a `geoleaf:*` event name absent from the
    // contract's two maps AND the baseline — so EM-01 must NAME it. The
    // gate is baseline-tolerant: it exits 0 as long as nothing NEW appears,
    // including on an empty corpus, where it would announce "none new, none
    // stale" having read nothing. Exactly the class this file hunts.
    // ⚠️ The literal is read from the AST, not grepped: writing it in a
    // comment would not do, it must be a real string in code.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "event.ts"),
        "export function probeEmit() {\n" +
            '    document.dispatchEvent(new CustomEvent("geoleaf:__probe__:untyped"));\n' +
            "}\n"
    );

    // check-facade-purity (plugin half): a facade that IMPLEMENTS instead
    // of delegating — mutable module state + a branch. The gate enumerates
    // `registry.all()` looking for `src/public-api.ts`; if it stops seeing
    // a nested package, it goes quiet here. It already errors on 0 files
    // found, but that does not say it sees them ALL — what this probe adds.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "public-api.ts"),
        "let _probeState = 0;\n\n" +
            "export function buildPublicApi() {\n" +
            "    return {\n" +
            "        bump: () => (_probeState > 0 ? _probeState : ++_probeState),\n" +
            "    };\n" +
            "}\n"
    );

    // check-i18n-dict-shape: a NESTED dictionary (value is an object, not a string).
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "lang", "lang-fr.ts"),
        'export const fr = {\n    probe: {\n        nested: "interdit — le dictionnaire doit être plat",\n    },\n};\n'
    );

    // purgecss / CSS scanning: a class that exists nowhere else.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "probe.css"),
        ".gl-probe-marker-class { color: red; }\n"
    );

    // verify-test-load-mode: a source module loaded through `require()`
    // from a test. The defect is the PAIR — a `require()` alone proves
    // nothing if it does not resolve to a real source, the gate would
    // ignore it.
    //
    // This site is ABSENT from the baseline by construction (the probe is
    // ephemeral), so it exercises exactly the case that counts: a NEW
    // `require()` must turn red. The gate's proof by mutation, and it runs
    // at every `ci:local` — where a proof written apart would have run once.
    fs.mkdirSync(path.join(PROBE_DIR, "__tests__"), { recursive: true });
    // The `@module` is PLANTED: it is MH-03's only live defect, the rule
    // holding at zero across the repo. Without it, the gate could never be
    // seen turning red again, and would stop being a guard. The tag does
    // not make the file documented — `extractHeader` discards `@` lines
    // from the prose —, so MH-01 keeps naming it and the family-A assertion
    // exercising it stays valid.
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "probe-load.ts"),
        "/**\n * @module sonde/probe-load\n */\nexport function probeLoaded() {\n    return true;\n}\n"
    );
    fs.writeFileSync(
        path.join(PROBE_DIR, "__tests__", "probe-load.test.js"),
        'const { probeLoaded } = require("../src/probe-load.ts");\n\n' +
            "// Never executed: the probe is not in `npm test`'s perimeter\n" +
            "// (the package has neither a `test` script nor a vitest.config.ts).\n" +
            "module.exports = { probeLoaded };\n"
    );

    // ── Variante SPECIFIER NU ──────────────────
    //
    // The gate only counted relative specifiers. `require("@core/…")` was
    // thus INVISIBLE to it — measured: 22 sites in the two plugins, 8 of
    // which loaded real core source, and one whole test file
    // (`cache-workflow-cross.integration.test.js`) was in no inventory.
    //
    // This probe lives in its OWN file: if bare-specifier detection
    // regresses, this file stops being named while `probe-load.test.js`
    // keeps being named — the failure designates the cause instead of
    // masking it.
    fs.writeFileSync(
        path.join(PROBE_DIR, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { "@probe/*": ["./src/*"] } } }, null, 4) + "\n"
    );
    fs.writeFileSync(
        path.join(PROBE_DIR, "src", "probe-bare.ts"),
        "export function probeBare() {\n    return true;\n}\n"
    );
    fs.writeFileSync(
        path.join(PROBE_DIR, "__tests__", "probe-bare.test.js"),
        'const { probeBare } = require("@probe/probe-bare.js");\n\n' +
            "// Same status as probe-load.test.js: never executed.\n" +
            "module.exports = { probeBare };\n"
    );

    // verify-repo-hygiene / check 1b: an undeclared `.cjs` at the package
    // ROOT — the exact shape of `packages/core/cov-check.cjs`, dead and
    // git-tracked for months. Planted outside `src/` on purpose: the
    // check's perimeter must be the whole package, not its `scripts/` (2 of
    // the 4 dead scripts were at the root, and `packages/core/scripts/` was
    // the repo's ONLY package `scripts/` — a check so bounded would have
    // scanned zero files as soon as it was deleted).
    //
    // And it is DELIBERATELY unindexed: which is what proves the check
    // reads the worktree and not only the index — the only reason it is
    // probeable.
    fs.writeFileSync(
        path.join(PROBE_DIR, "probe-throwaway.cjs"),
        '"use strict";\n\n// T3.5 probe — throwaway script at a package root.\nmodule.exports = { probe: true };\n'
    );

    // ── GENERATED artefact, and a producer writing outside the perimeter ──────
    //
    // `verify-repo-hygiene`'s check 5 forbids an artefact directory under
    // git control. Its perimeter is a list of relative FORMS
    // (`lib/generated-artifacts.cjs`), precisely so a core move does not
    // empty it: the earlier mistake was bounding a gate to the one
    // directory the sprint was deleting.
    //
    // This fixture is what makes that property VERIFIABLE: it plants the
    // `docs/api` form at a path nobody hardcoded. A regression towards an
    // absolute path (`packages/core/docs/api`) stops naming it.
    //
    // ⚠️ Its visibility DEPENDS on the anchoring of the `.gitignore`
    // patterns (`packages/core/docs/api/`). A generic `**/docs/api/` would
    // swallow this file: it would leave the `--others --exclude-standard`
    // corpus, and this assertion would pass GREEN proving nothing any more.
    // The reason the anchoring is not a style detail — and it is written
    // here because here is where it would be broken.
    fs.mkdirSync(path.join(PROBE_DIR, "docs", "api"), { recursive: true });
    fs.writeFileSync(
        path.join(PROBE_DIR, "docs", "api", "index.html"),
        "<!-- T4.1 probe — generated artifact under git control. -->\n"
    );

    // ARMING variant: a PRODUCER declaring it writes outside the known
    // forms. Without it, renaming `typedoc.json`'s `out` would disarm check
    // 5 with no file changing git status — hence silently, and that is
    // exactly the failure mode this file hunts. `declaredOutputs()` reads
    // the declaration instead of copying the path, this fixture proves it
    // still reads it.
    fs.writeFileSync(
        path.join(PROBE_DIR, "typedoc.json"),
        JSON.stringify({ out: "docs/__probe-api__" }, null, 4) + "\n"
    );

    // ── SHIP-SPEC — a PUBLISHED DECLARATION naming a `private`
    //    workspace, hence 404 on npm forever ─────────────────────────────────────
    //
    // The class that motivated the gate: six publishable `.d.ts` imported
    // packages absent from the registry, and NOTHING could see it —
    // workspace symlinks resolve them here, so `typecheck:consumer` stays
    // green (it compiles from `packages/core/examples/`, i.e. INSIDE the
    // monorepo) and PUB-TYPES does not compile at all.
    //
    // The fixture targets `@geoleaf/build-config` and not
    // `@geoleaf/host-runtime`: both are `private: true`, but the second was
    // the REAL target of the two already-fixed leaks. Picking the fixed
    // target would make the assertion look like a possible regression of
    // the fix; this one can only be satisfied by the RULE.
    //
    // ⚠️ The needle is `SHIP-SPEC-02`, not `__probe__`: two assertions
    // above already name this package for other motives, so `__probe__`
    // would be satisfied without the private-workspace rule having seen
    // anything. The precedent documented above for `MH-03` and check 5.
    fs.mkdirSync(path.join(PROBE_DIR, "dist", "types"), { recursive: true });
    fs.writeFileSync(
        path.join(PROBE_DIR, "dist", "types", "index.d.ts"),
        'import type { ProbeShipped } from "@geoleaf/build-config";\n' +
            "export declare function probeShipped(): ProbeShipped;\n"
    );
    fs.writeFileSync(
        path.join(PROBE_DIR, "dist", "index.js"),
        "export function probeShipped() {\n    return null;\n}\n"
    );

    // ── Variante .mjs ─────────────────────────────────────────────────────────
    //
    // Check 1b only tested `.cjs` when laid; the `.mjs` extension has its
    // OWN assertion, otherwise the `.cjs` fixture above would suffice to
    // pass it while the rule's whole ESM half could have regressed — same
    // pattern as `verify-test-load-mode`'s bare specifier above.
    //
    // This file also exercises, in the negative, the rollup configs'
    // STRUCTURAL exemption: it is named `probe-throwaway.mjs` and not
    // `rollup-quickfix.mjs`, but it is the same point — the exemption is
    // indexed on EXACT basenames (`rollup.config.mjs`,
    // `rollup.consumer.mjs`), not a `rollup*.mjs` glob that would have made
    // the prefix a hiding place.
    fs.writeFileSync(
        path.join(PROBE_DIR, "probe-throwaway.mjs"),
        "// T3.5 probe — throwaway ESM script at a package root.\nexport const probe = true;\n"
    );
}

/** Add `packages/plugins/*` to the workspace globs so the registry can see the probe. */
function declareNestedGlob() {
    pkgJsonBackup = fs.readFileSync(PKG_JSON, "utf8");
    const pkg = JSON.parse(pkgJsonBackup);
    if (!pkg.workspaces.includes("packages/plugins/*")) {
        // Inserted before the negations so `!packages/_*` still applies last.
        pkg.workspaces = pkg.workspaces
            .filter((w) => !w.startsWith("!"))
            .concat(["packages/plugins/*"])
            .concat(pkg.workspaces.filter((w) => w.startsWith("!")));
    }
    fs.writeFileSync(PKG_JSON, JSON.stringify(pkg, null, 4) + "\n");
}

/**
 * Remove ONLY what this script created.
 *
 * ⚠️ This function previously did `rmSync("packages/plugins", {recursive:true})`.
 * That was safe exactly as long as `packages/plugins/` did not otherwise exist —
 * and it stopped being safe the moment the regrouping made it the home of 13 plugins.
 * Running the probe then DELETED all 13 (557 files, recovered from the git index,
 * which held them because the move had been staged with `git mv`).
 *
 * The lesson is not "be careful with rm". It is that a cleanup routine must never
 * remove a path it did not create: `createdPluginsDir` records whether this run is
 * the one that made the directory, and nothing else is ever removed.
 */
function cleanup() {
    if (KEEP) return;
    fs.rmSync(PROBE_DIR, { recursive: true, force: true });
    // Only remove the parent if THIS run created it, and only when empty.
    if (createdPluginsDir) {
        try {
            fs.rmdirSync(path.join(ROOT, "packages", "plugins"));
        } catch {
            // Not empty — it holds real packages. Leaving it is the correct outcome.
        }
    }
    if (pkgJsonBackup !== null) fs.writeFileSync(PKG_JSON, pkgJsonBackup);
}

// ─── Assertions ───────────────────────────────────────────────────────────────

const results = [];

/**
 * Run a gate and assert it MENTIONS the probe.
 *
 * Mentioning matters more than exiting non-zero: a gate can legitimately be
 * baseline-tolerant and still exit 0, but if it never names the probe it did not
 * look at it. Silence is the failure mode being hunted.
 */
function assertGateSees(label, argv, needle = "__probe__") {
    const res = spawnSync("node", argv, { cwd: ROOT, encoding: "utf8" });
    const out = (res.stdout || "") + (res.stderr || "");
    const saw = out.includes(needle);
    results.push({
        label,
        ok: saw,
        detail: saw ? `exit ${res.status}` : `n'a jamais nommé la sonde (${needle})`,
    });
}

/** Assert a structural fact about the repo, evaluated by `fn`. */
function assertThat(label, fn, pending) {
    let ok = false;
    let detail = "";
    try {
        const r = fn();
        ok = r === true || (r && r.ok);
        detail = (r && r.detail) || "";
    } catch (err) {
        detail = err.message;
    }
    results.push({ label, ok, detail, pending });
}

/**
 * Checks known red, with the deadline that closes them.
 *
 * Those two are configuration GLOBS (`packages/*​/src/**`) that must change
 * exactly at the move, not before: fixing them separately would make the
 * regrouping commit inconsistent with the tree. They are thus expected red
 * until that sprint, and the probe says so instead of going quiet.
 *
 * Same pattern as `check-orphan-exports` and `check-config-consumers`: an
 * explicit baseline, rather than a durably red gate nobody reads any more.
 * A check NOT listed here that fails makes the probe exit 1.
 *
 * ⚠️ Emptying this list is part of the regrouping's exit criterion.
 */
const PENDING = {
    // Emptied by the regrouping, as its exit criterion required.
    //   - lint-staged: `packages/*/src/**` → `packages/**/src/**` (it only
    //     receives indexed files, so `node_modules` is beside the point).
    //   - purgecss: moved to the REGISTRY rather than a widened glob —
    //     `packages/**` traversed `node_modules` (13 dependency `.ts`
    //     entered the scanned content, which masks really dead CSS).
};

// ─── Run ──────────────────────────────────────────────────────────────────────

try {
    plantProbe();
    declareNestedGlob();

    console.log(`${C.c}── Sonde plantée : ${PROBE_REL} ──${C.x}\n`);

    // ── Family A — gate visibility ────────────────────────────────────────────
    console.log(`${C.d}Famille A — la gate voit-elle encore un package imbriqué ?${C.x}`);
    assertGateSees("verify-no-leaflet", ["scripts/verify-no-leaflet.cjs"]);
    assertGateSees("check-package-files", ["scripts/check-package-files.cjs"]);
    assertGateSees("check-versions", ["scripts/check-versions.cjs"]);
    assertGateSees("check-i18n-dict-shape", ["scripts/check-i18n-dict-shape.cjs"]);
    assertGateSees("count-any", ["scripts/count-any.cjs"]);
    // verify-plugin-shared-fork enumerates `registry.all()`: the __probe__
    // probe carries `src/fork.ts` (a `coreConfigGet` re-definition, outside
    // the baseline), so PSF-01 must name it. If the gate stops enumerating
    // nested packages, it goes quiet here.
    assertGateSees("verify-plugin-shared-fork", ["scripts/verify-plugin-shared-fork.cjs"]);
    // check-facade-purity: the probe carries a non-conformant
    // `src/public-api.ts` (mutable state + a ternary), so the gate's plugin
    // half must name it. Without it, the gate would stay green enumerating
    // only the packages it still sees.
    assertGateSees("check-facade-purity (plugins)", ["scripts/check-facade-purity.cjs"]);
    // check-exact-optional-debt: the probe carries `src/widened.ts`, a
    // widened property outside the baseline, so EOD-01 must name it.
    // Without this assertion, a gate that stopped enumerating nested
    // packages would exit green having scanned only the core.
    assertGateSees("check-exact-optional-debt", ["scripts/check-exact-optional-debt.cjs"]);
    // check-nonnull-assertion-debt: the probe carries
    // `src/asserted-index.ts`, an `xs[0]!`, so NNA-04 must name it. The
    // ratchet's baseline-less rule: if the gate stopped enumerating nested
    // packages, a plugin could settle its `noUncheckedIndexedAccess` errors
    // with assertions and nothing would turn red.
    assertGateSees("check-nonnull-assertion-debt", ["scripts/check-nonnull-assertion-debt.cjs"]);
    assertGateSees("verify-test-load-mode", ["scripts/verify-test-load-mode.cjs"]);
    // The BARE specifier has its own assertion: without it, the relative
    // probe would suffice to pass the check while half the forms escaped the gate.
    assertGateSees(
        "verify-test-load-mode (specifier nu)",
        ["scripts/verify-test-load-mode.cjs"],
        "probe-bare.test.js"
    );
    // ARCHI S11 — check-module-headers walks every package's `src/` through the registry.
    // The probe's own sources carry no module header and are absent from the baseline, so
    // MH-01 must name them. This is the check that would catch the inventory silently
    // ceasing to see a nested package: it would then report "0 new undocumented files"
    // and exit 0 — green, having scanned nothing, which is the exact class this file hunts.
    assertGateSees("check-module-headers", ["scripts/check-module-headers.cjs"]);
    // MH-03 forbids `@module`, and the rule holds at ZERO in the repo:
    // without a planted defect it can never turn red again. The needle is
    // `MH-03` and not `__probe__`, otherwise the assertion would already be
    // satisfied by MH-01, which names the probe for a whole other motive —
    // and MH-03 could stop seeing a nested package with nothing flagging
    // it. The defect lives in `src/probe-load.ts` (cf. plantProbe).
    assertGateSees("check-module-headers (MH-03)", ["scripts/check-module-headers.cjs"], "MH-03");
    // Same reason, same class. `check-event-map-coverage` is
    // baseline-tolerant: it exits 0 as long as no NEW name appears,
    // including on an empty corpus. The day `registry.all()` stops seeing a
    // package, it would announce "none new, none stale" — green, over zero
    // files read. The probe planted in `packages/plugins/__probe__/`
    // carries a `geoleaf:*` literal unknown to both maps and absent from
    // the baseline: the gate MUST name it.
    assertGateSees("check-event-map-coverage", ["scripts/check-event-map-coverage.cjs"]);
    // The repo no longer contains ANY `<pkg>/scripts/`, so a check bounded
    // that way would have stayed empty-green for life, with nothing to look
    // at. `probe-throwaway.cjs` is its only live defect: absent from
    // `CJS_OUTSIDE_SCRIPTS_ALLOWLIST` by construction, so the gate must
    // NAME it. The needle is the file name rather than `__probe__`,
    // otherwise another category mentioning the probe package would satisfy
    // the assertion without check 1b having seen anything.
    assertGateSees(
        "verify-repo-hygiene (cjs hors scripts/)",
        ["scripts/verify-repo-hygiene.cjs"],
        "probe-throwaway.cjs"
    );
    // The ESM half has its own assertion: check 1b only tested `.cjs` when
    // laid, and the `scripts/` register disciplined 64 `.cjs` for 0 `.mjs`
    // while new tooling is written in ESM. Without this line, the `.cjs`
    // fixture above would suffice to pass the check.
    assertGateSees(
        "verify-repo-hygiene (mjs hors scripts/)",
        ["scripts/verify-repo-hygiene.cjs"],
        "probe-throwaway.mjs"
    );
    // The three assertions of check 5 and its npm counterpart. Needles =
    // PATH fragments, never `__probe__` alone: two assertions above already
    // name this package via `probe-throwaway.*`, so `__probe__` would be
    // satisfied by another category without check 5 having seen anything
    // (the precedent is documented above).
    assertGateSees(
        "verify-repo-hygiene (artefact généré sous contrôle git)",
        ["scripts/verify-repo-hygiene.cjs"],
        "__probe__/docs/api"
    );
    assertGateSees(
        "verify-repo-hygiene (producteur hors périmètre)",
        ["scripts/verify-repo-hygiene.cjs"],
        "docs/__probe-api__"
    );
    assertGateSees(
        "check-package-files (artefact embarqué par files[])",
        ["scripts/check-package-files.cjs"],
        "__probe__/docs/api"
    );
    // SHIP-SPEC — the probe carries `dist/types/index.d.ts` importing
    // `@geoleaf/build-config`, a `private: true` workspace. SHIP-SPEC-02 is
    // WITHOUT a baseline, so the gate must NAME it, and its corpus derives
    // from `registry.all()`: the day the registry stopped seeing a nested
    // package, this assertion would fall before the gate announced
    // "0 leaks" over an amputated corpus. Needle = the rule's code.
    assertGateSees(
        "check-shipped-specifiers (SHIP-SPEC-02)",
        ["scripts/check-shipped-specifiers.cjs"],
        "SHIP-SPEC-02"
    );

    // LIC-HEADERS — the probe plants eight `src/*.ts` WITHOUT the `/*!`
    // banner, so LIC-01 must name them. The corpus comes from
    // `source-inventory.collect()`, which derives from `registry.all()`: if
    // the registry stopped seeing a nested package, the gate would announce
    // "canonical banner" over an amputated corpus — and its LIC-03 floor,
    // set at 700 files, would see nothing since the core alone weighs 530.
    // Exactly the blindness this probe exists to make loud.
    assertGateSees("check-license-headers (LIC-01 voit un paquet imbriqué)", [
        "scripts/check-license-headers.cjs",
    ]);

    // 🛑 **THIS ASSERTION WAS REWRITTEN — and its old shape illustrates
    // exactly what this probe exists to catch.**
    //
    // It said: "`verify-plugin-core-boundary` does not enumerate the
    // packages: it scans exactly the **2 keys** of its BASELINE, and only
    // prints a summary", then fell back on the RESOLUTION of two hardcoded
    // names (`editor`, `offline-ui`) for want of anything else to verify.
    // Three things in it were false or stale:
    //
    //   ① "2 keys" — only ONE remained, so the gate opened 1 plugin out of 12;
    //   ② `editor` was NOT in the BASELINE, so the probe verified the
    //      resolution of a target the gate never visited — it measured beside;
    //   ③ "only prints a summary" stopped being true the day the gate was fixed.
    //
    // ⚠️ **A probe that falls back on a weak property because the strong
    // one is unobservable must be reread when the target changes** —
    // otherwise it certifies a property nobody asks of it any more. The
    // gate now prints ITS PERIMETER; that is the strong property, and it is
    // finally observable.
    assertThat("verify-plugin-core-boundary : VOIT le deep import planté dans la sonde", () => {
        const res = spawnSync("node", ["scripts/verify-plugin-core-boundary.cjs"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        const out = `${res.stdout}${res.stderr}`;

        // 🛑 A FAILURE is expected: the probe's `deep-import.ts` carries
        // `import { Log } from "../../../core/src/utils/log/index.js"`, a
        // relative deep import into the core's sources. An exit 0 means the
        // gate did not see it.
        if (res.status === 0) {
            return { ok: false, detail: "exit 0 — le deep import planté est passé INAPERÇU" };
        }
        if (!out.includes("__probe__")) {
            return { ok: false, detail: "rouge, mais sans nommer `__probe__` — mauvaise cause" };
        }
        return { ok: true, detail: "PCB-01 nomme `__probe__` et son deep import relatif" };
    });

    // ── Family B — rule arming ────────────────────────────────────────────────
    console.log(`\n${C.d}Famille B — la règle existe-t-elle encore ?${C.x}`);

    // Same class as verify-plugin-core-boundary, found by sweep after the
    // probe revealed the pattern: paths hardcoded under `packages/` in
    // gates that do not enumerate. `verify-core-standalone` is the gravest
    // case — its rule is non-negotiable, and SYNC-01b would have stopped
    // scanning the connector without a word. `verify-repo-hygiene` likewise
    // lost its 700-line check.
    assertThat("gates à chemins durs : cibles mobiles résolues", () => {
        delete require.cache[require.resolve("./lib/packages.cjs")];
        const registry = require("./lib/packages.cjs");
        registry.reset();
        // `core` added. It was absent because its paths were LITERAL in
        // some fifteen gates, under the written justification that "the
        // core stays": nothing to resolve, hence nothing to watch. The
        // gates now go through the registry, and this check finally bears
        // on the package the repo reads most.
        // `host-runtime` added. It was absent while it had become the
        // target of 3 of `verify-seam-drift`'s 6 seams and the source of
        // `verify-plugin-shared-fork`'s derived symbol: two gates that stop
        // guarding anything if this package becomes unresolvable.
        const targets = ["core", "connector", "offline-ui", "field-renderer", "host-runtime"];
        const missing = [];
        for (const dirName of targets) {
            try {
                const srcDir = path.join(registry.requireByDirName(dirName).absDir, "src");
                if (!fs.existsSync(srcDir)) missing.push(dirName);
            } catch {
                missing.push(dirName);
            }
        }
        return {
            ok: missing.length === 0,
            // ⚠️ DERIVED count. It was written "4/4" hardcoded, and lied
            // the very second a 5th package was added: the probe announced
            // 4 targets having verified 5. A figure that cannot be wrong
            // because it measures nothing, in the very file that hunts this
            // shape of defect.
            detail: missing.length
                ? `introuvables : ${missing.join(", ")}`
                : `${targets.length}/${targets.length} résolues`,
        };
    });

    // `verify-seam-drift` had NO assertion in this probe, while its own
    // docblock (`:39-41`) claimed its protection. A docblock invoking a
    // gate that does not cover it is exactly the failure mode
    // `verify-host-contract-sync.cjs` describes.
    //
    // What is verified is not the drift (the gate does, and it throws) but
    // the registry's SHRINKAGE, its only mute failure until then: the
    // success message only counted the seams, never the files, and an
    // amputated `files[]` passed without a word. Historical proof in the
    // file itself: the `storage-contract` seam, since deleted, took the
    // counter from 4 to 3 with nothing observing it.
    //
    // The floor is read FROM the gate, never copied here — a figure
    // duplicated in a probe is a figure that will lie, which the previous
    // assertion reproached itself for.
    assertThat("verify-seam-drift : plancher de couverture présent et armé", () => {
        const src = fs.readFileSync(path.join(ROOT, "scripts", "verify-seam-drift.cjs"), "utf8");
        const floor = src.match(/const FLOOR = \{ seams: (\d+), files: (\d+) \}/);
        if (!floor) return { ok: false, detail: "FLOOR absent — le plancher a été retiré" };
        const guards =
            /SEAMS\.length < FLOOR\.seams \|\| fileCount < FLOOR\.files/.test(src) &&
            /fileCount = SEAMS\.reduce/.test(src);
        return {
            ok: guards,
            detail: guards
                ? `plancher ${floor[1]} seams / ${floor[2]} fichiers, comparaison en place`
                : "FLOOR déclaré mais jamais comparé — la gate ne garde rien",
        };
    });

    assertThat("registre : la sonde est énumérée", () => {
        delete require.cache[require.resolve("./lib/packages.cjs")];
        const registry = require("./lib/packages.cjs");
        registry.reset();
        const hit = registry.all().find((p) => p.dirName === "__probe__");
        return { ok: Boolean(hit), detail: hit ? hit.dir : "absente du registre" };
    });

    // `docs-paths.cjs` is the common root of SPECS-PATHS, GUIDES-PATHS and
    // TSDOC-PATHS, three gates laid between 11 and 12/08/2026 of which NONE
    // was exercised here.
    //
    // ⚠️ The risk is its own, and it is mute: these gates return "N paths
    // cited, 0 dead". If a sub-root stops resolving, the corpus falls to
    // zero and the verdict stays **green** — the exact shape of the "green
    // that scanned nothing" this probe hunts everywhere else. The module
    // defends itself with a `throw` in `requireRoot()`; what follows
    // verifies that defence STILL EXISTS, and that it bears on a non-empty
    // corpus.
    //
    // 📌 The INTERNAL root is deliberately out of scope: `docs-paths`
    // defers its assertion to the first `internal()`, precisely so the
    // public clone — which has no `_docs_projet/` — does not die at import.
    // Requiring its presence here would turn the probe red over there, i.e.
    // in the one repo where these three gates count most.
    assertThat("docs-paths : sous-racines résolues et corpus non vide", () => {
        delete require.cache[require.resolve("./lib/docs-paths.cjs")];
        const dp = require("./lib/docs-paths.cjs");

        // The module's guardrail, read IN its source: a removed `throw`
        // would make all the sub-roots silently optional.
        const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "docs-paths.cjs"), "utf8");
        if (!/function requireRoot[\s\S]*?throw new Error\(/.test(src)) {
            return {
                ok: false,
                detail: "requireRoot ne JETTE plus — une racine absente passerait",
            };
        }

        // Count DERIVED from the public sub-roots, never a copied list:
        // adding a 4th sub-root without exercising it here would be exactly
        // the neighbouring assertion's defect, which announced "4/4" while
        // verifying 5.
        const roots = ["specs", "reference", "guides"].map((k) => [k, dp[k]()]);
        const missing = roots.filter(([, abs]) => !fs.existsSync(abs)).map(([k]) => k);
        if (missing.length) return { ok: false, detail: `sous-racine(s) absente(s) : ${missing}` };

        const counts = roots.map(([k, abs]) => {
            const n = fs
                .readdirSync(abs, { recursive: true, withFileTypes: true })
                .filter((e) => e.isFile() && e.name.endsWith(".md")).length;
            return [k, n];
        });
        const empty = counts.filter(([, n]) => n === 0).map(([k]) => k);
        return {
            ok: empty.length === 0,
            detail: empty.length
                ? `corpus VIDE : ${empty.join(", ")} — la gate sortirait verte sans rien lire`
                : counts.map(([k, n]) => `${k} ${n}`).join(" · ") + " fichiers .md",
        };
    });

    // `deploy-docs.cjs` is the repo's most destructive script (recursive
    // `rmSync` on an EXTERNAL target) and it is invoked by NO CI: neither
    // `ci-local`, nor `ci.yml`, nor the hook. Its most important fix — the
    // destroy/verify order of `syncDir` — was thus only guarded by the
    // sprint's manual mutations. Here it is exercised at every `ci:local`.
    //
    // ⚠️ The case that counts is the NEGATIVE: absent source ⇒ the
    // destination must be INTACT. Before the fix, `rmSync(dest)` ran first
    // and `copyDir` settled for a `console.warn` — the published doc
    // vanished and the script exited 0.
    assertThat("deploy-docs : syncDir ne détruit pas avant de constater", () => {
        delete require.cache[require.resolve("./deploy-docs.cjs")];
        const { syncDir, resolveSiteRoot, DeployError } = require("./deploy-docs.cjs");
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-probe-deploy-"));
        const failures = [];
        const attend = (label, fn) => {
            try {
                fn();
                failures.push(`${label} : aucune erreur levée`);
            } catch (err) {
                if (!(err instanceof DeployError)) failures.push(`${label} : ${err.message}`);
            }
        };
        try {
            const dest = path.join(scratch, "docs");
            fs.mkdirSync(dest, { recursive: true });
            fs.writeFileSync(path.join(dest, "sentinelle.txt"), "DOC EN LIGNE");
            const alive = () => fs.existsSync(path.join(dest, "sentinelle.txt"));

            // 1. Absent source → throws, and the sentinel survives.
            attend("source absente", () => syncDir(path.join(scratch, "nexiste-pas"), dest));
            if (!alive()) failures.push("source absente : la destination a été DÉTRUITE");

            // 2. Empty source → same requirement. Publishing an empty
            //    directory erases the doc just as surely as a missing source.
            const vide = path.join(scratch, "vide");
            fs.mkdirSync(vide, { recursive: true });
            attend("source vide", () => syncDir(vide, dest));
            if (!alive()) failures.push("source vide : la destination a été DÉTRUITE");

            // 3. Real source → effective replacement. Without this positive
            //    case, a `syncDir` doing NOTHING ANY MORE would pass the two
            //    assertions above.
            const plein = path.join(scratch, "plein");
            fs.mkdirSync(plein, { recursive: true });
            fs.writeFileSync(path.join(plein, "index.html"), "<!doctype html>");
            try {
                syncDir(plein, dest);
            } catch (err) {
                failures.push(`source réelle : a jeté (${err.message})`);
            }
            if (!fs.existsSync(path.join(dest, "index.html"))) {
                failures.push("source réelle : rien n'a été copié");
            }
            if (alive()) failures.push("source réelle : la sentinelle survit — pas remplacé");

            // 4. The external target's guards, on the 3 values none must
            //    let through. `resolveSiteRoot` receives its parameters
            //    explicitly: the probe has no business mutating `process.env`.
            attend("racine FS", () => resolveSiteRoot(path.parse(ROOT).root, ROOT));
            attend("racine du dépôt", () => resolveSiteRoot(ROOT, ROOT));
            attend("chemin dans le dépôt", () => resolveSiteRoot(path.join(ROOT, "scripts"), ROOT));
            attend("variable vide", () => resolveSiteRoot("   ", ROOT));
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
        return {
            ok: failures.length === 0,
            detail: failures.length ? failures.join(" · ") : "3 cas syncDir + 4 gardes de cible",
        };
    });

    // Does the "every ci:local script is tracked" gate still resolve a
    // graph?
    //
    // Its failure mode is not turning red wrongly, it is shrinking: a
    // renamed `npm run`, a restructured table, and the graph falls to a few
    // scripts without a single error raised. "0 untracked scripts" then
    // becomes true and meaningless. It carries its own floor
    // (MIN_RESOLVED); this check verifies that floor is AMPLY cleared,
    // hence that it stays a floor and not a ceiling.
    assertThat("ci-scripts-tracked : le graphe d'invocation ne s'est pas effondré", () => {
        const res = spawnSync("node", ["scripts/verify-ci-scripts-tracked.cjs"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        const out = (res.stdout || "") + (res.stderr || "");
        const m = out.match(/(\d+) script\(s\) atteignable/);
        const n = m ? Number(m[1]) : 0;
        return {
            ok: res.status === 0 && n >= 40,
            detail:
                res.status !== 0
                    ? `exit ${res.status} — la gate elle-même est rouge`
                    : `${n} scripts résolus (attendu ≥ 40)`,
        };
    });

    // ── CI-PARITY — the three failure modes, replayed at every run ────────────
    //
    // The parity gate asserts every `ci.yml` gate is launched by `ci:local`
    // or exempted with its witness. A guard never SEEN turning red guards
    // nothing: these three assertions mutate a COPY of the workflow (the
    // `GEOLEAF_CI_WORKFLOW_DIR` hook) and require the exact diagnostic
    // code. The code, not a generic needle — this file already documents
    // twice that an over-wide needle gets satisfied by ANOTHER category
    // without the targeted check having seen anything.
    //
    // The hook exists for that and nothing else: without it, proving the
    // gate would require modifying the real `ci.yml` — so it would be done
    // once, at laying, and never again. Removing the hook turns these three
    // lines red, which is the goal.
    const parityMutation = (label, mutate, expectedCode) =>
        assertThat(`ci-parity : ${label} (${expectedCode})`, () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-parity-"));
            try {
                const src = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
                fs.writeFileSync(path.join(dir, "ci.yml"), mutate(src));
                const res = spawnSync("node", ["scripts/verify-ci-parity.cjs"], {
                    cwd: ROOT,
                    encoding: "utf8",
                    env: { ...process.env, GEOLEAF_CI_WORKFLOW_DIR: dir },
                });
                const out = (res.stdout || "") + (res.stderr || "");
                const named = out.includes(expectedCode);
                return {
                    ok: res.status !== 0 && named,
                    detail:
                        res.status === 0
                            ? `SORTIE VERTE sur un workflow muté — la gate ne voit pas ${expectedCode}`
                            : named
                              ? `rouge, et ${expectedCode} nommé`
                              : `rouge, mais ${expectedCode} jamais nommé (rougit pour une autre raison)`,
                };
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

    // 1. The property. `count-any.cjs` is chosen on purpose: it exists, it
    //    is declared, it is tracked, `npm run count:any` defines it — it
    //    thus clears all the neighbouring checks and can only fail ON parity.
    parityMutation(
        "une gate de ci.yml absente de STEPS",
        (src) =>
            `${src}\n            - name: Sonde de parite\n              run: node scripts/count-any.cjs\n`,
        "PARITY-03"
    );

    // 2. The rot. Removing an exemption's CAUSE must turn it red, not make
    //    it silently useless.
    parityMutation(
        "une exemption dont la cause a disparu",
        (src) =>
            src
                .split("\n")
                .filter((l) => !/^\s+- run: npm ci\s*$/.test(l))
                .join("\n"),
        "PARITY-04"
    );

    // 3. The blindness. On a truncated corpus, "0 uncovered leaves" is
    //    TRUE and meaningless: the gate must refuse to conclude instead of
    //    reassuring.
    // ⚠️ THE TRUNCATION IS DERIVED, AND IT IS BECAUSE A HARDCODED NUMBER
    // ROTTED. This mutation was `slice(0, 40)` until 09/08/2026. Then
    // `ci.yml`'s header grew — a `permissions:` block and a paragraph on
    // Node 20's end on the runners — and `jobs:` moved to line 43. The
    // first 40 lines thus no longer contained any job: the gate did turn
    // red, but on "unreadable corpus" and not on PARITY-01. The probe thus
    // failed flagging exactly what it exists to find — a guard no longer
    // turning red for the right reason — and the defect was not in the gate.
    //
    // 🛑 A collapsed corpus must stay READABLE. Cutting at `steps:`
    // produces "`steps:` with no step", another read error; a well-formed
    // workflow is needed whose counts pass under `FLOOR`'s floors
    // (`ci-parity.cjs`). Three steps do, and the number is small before all
    // the floors rather than tuned to one of them.
    parityMutation(
        "un corpus effondré (refus de conclure)",
        (src) => {
            const lines = src.split("\n");
            const stepsAt = lines.findIndex((l) => /^\s*steps:\s*$/.test(l));
            if (stepsAt === -1) {
                throw new Error(
                    "probe: aucun bloc `steps:` dans ci.yml — la mutation ne peut plus " +
                        "construire de corpus effondré, et la sonde rougirait pour une raison " +
                        "qui n'est pas celle qu'elle instruit."
                );
            }
            let seen = 0;
            let end = stepsAt + 1;
            for (; end < lines.length; end++) {
                if (/^\s+-\s/.test(lines[end]) && ++seen > 3) break;
            }
            return lines.slice(0, end).join("\n");
        },
        "PARITY-01"
    );

    // Counter-proof: without a mutation, the same gate must be GREEN.
    // Without this line, three reds would prove only one thing — that the
    // gate always turns red.
    assertThat("ci-parity : verte sur le workflow réel (contre-épreuve)", () => {
        const res = spawnSync("node", ["scripts/verify-ci-parity.cjs"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        return {
            ok: res.status === 0,
            detail: res.status === 0 ? "exit 0" : `exit ${res.status} — la gate est rouge en vrai`,
        };
    });

    // ── IMPL — "declared = executed" on what the repo loads WITHOUT importing ──
    //
    // 🛑 This gate guards a class no other sees, and it guards it on a repo
    // whose instrument is structurally blind to the defect: `ci.yml` and
    // `ci:local` both run under Node 22's npm, and the failure only appears
    // from npm 11 — which only `publish.yml` installs. In other words,
    // nobody here will ever see IMPL turn red "for real". Exactly the case
    // where a guard never seen red guards nothing, so the four codes are
    // exercised below, each by its own mutation.
    //
    // ⚠️ The gate's initial design leaned on the lockfile's
    // `peer + optional` marker; it was set aside on measurement, that
    // marker not being stable from one npm version to the next (npm 12 no
    // longer sets it at all). IMPL-03 still sweeps it, but as a net — and
    // IMPL-01/02 are what these probes must hold first.
    // ⚠️ `env` can be a FUNCTION, and receives what `before()` returned.
    // Not comfort: a literal value would be evaluated when `implMutation`
    // is called, hence BEFORE `before()` created the temporary directory it
    // is supposed to name.
    const implMutation = (label, expectedCode, opts = {}) =>
        assertThat(`impl : ${label} (${expectedCode})`, () => {
            const undo = opts.before ? opts.before() : null;
            const { after } = opts;
            try {
                const extraEnv = typeof opts.env === "function" ? opts.env(undo) : (opts.env ?? {});
                const res = spawnSync("node", ["scripts/verify-implicit-deps.cjs"], {
                    cwd: ROOT,
                    encoding: "utf8",
                    env: { ...process.env, ...extraEnv },
                });
                const out = `${res.stdout || ""}${res.stderr || ""}`;
                const named = out.includes(expectedCode);
                return {
                    ok: res.status !== 0 && named,
                    detail:
                        res.status === 0
                            ? `SORTIE VERTE sous mutation — la gate ne voit pas ${expectedCode}`
                            : named
                              ? `rouge (exit ${res.status}), et ${expectedCode} nommé`
                              : `rouge, mais ${expectedCode} jamais nommé (rougit pour une autre raison)`,
                };
            } finally {
                if (after) after(undo);
            }
        });

    // 1. The central property: a loaded package NOTHING declares. The name
    //    is a ghost on purpose — a real package could be declared one day,
    //    and the probe would then turn green for a reason not its own.
    implMutation("un paquet chargé que rien ne déclare", "IMPL-01", {
        env: { GEOLEAF_IMPLICIT_EXTRA: "__probe_undeclared_dep__" },
    });

    // 2. The defect already paid for: the declared copy is NOT the one
    //    that executes. 14 packages declared `happy-dom` and each received
    //    a nested copy Vitest never loaded — two minors apart, invisible
    //    their whole life. Reconstituted identically under the probe
    //    workspace, which `cleanup()` erases entirely.
    const probePkgJson = path.join(PROBE_DIR, "package.json");
    implMutation("une copie déclarée que rien ne charge", "IMPL-02", {
        before: () => {
            const backup = fs.readFileSync(probePkgJson, "utf8");
            const manifest = JSON.parse(backup);
            manifest.devDependencies = { ...manifest.devDependencies, "happy-dom": "^20.11.2" };
            fs.writeFileSync(probePkgJson, `${JSON.stringify(manifest, null, 4)}\n`);
            const nested = path.join(PROBE_DIR, "node_modules", "happy-dom");
            fs.mkdirSync(nested, { recursive: true });
            fs.writeFileSync(
                path.join(nested, "package.json"),
                `${JSON.stringify({ name: "happy-dom", version: "0.0.0-probe" })}\n`
            );
            return backup;
        },
        after: (backup) => {
            fs.rmSync(path.join(PROBE_DIR, "node_modules"), { recursive: true, force: true });
            if (backup !== null) fs.writeFileSync(probePkgJson, backup);
        },
    });

    // 3. The lockfile sweep. An orphan optional peerDependency at the root
    //    is exactly the shape under which `happy-dom` and `tsx` lived undeclared.
    implMutation("une peer optionnelle orpheline dans le lock", "IMPL-03", {
        env: (dir) => ({ GEOLEAF_LOCKFILE: path.join(dir, "package-lock.json") }),
        before: () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-impl-"));
            const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
            lock.packages["node_modules/__probe_phantom_peer__"] = {
                version: "9.9.9",
                dev: true,
                peer: true,
                optional: true,
            };
            fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock));
            return dir;
        },
        after: (dir) => {
            if (dir) fs.rmSync(dir, { recursive: true, force: true });
        },
    });

    // 4. The refusal to conclude. A gate reassuring over a corpus it could
    //    not read is worse than an absent gate — the failure mode this
    //    whole file pursues.
    implMutation("un lockfile illisible (refus de conclure)", "IMPL-04", {
        env: (dir) => ({ GEOLEAF_LOCKFILE: path.join(dir, "package-lock.json") }),
        before: () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-impl-ko-"));
            fs.writeFileSync(path.join(dir, "package-lock.json"), "pas du json");
            return dir;
        },
        after: (dir) => {
            if (dir) fs.rmSync(dir, { recursive: true, force: true });
        },
    });

    // Counter-proof: without a mutation, the gate must be GREEN — otherwise
    // the four reds above prove only one thing, that it always turns red.
    assertThat("impl : verte sur le dépôt réel (contre-épreuve)", () => {
        const res = spawnSync("node", ["scripts/verify-implicit-deps.cjs"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        return {
            ok: res.status === 0,
            detail: res.status === 0 ? "exit 0" : `exit ${res.status} — la gate est rouge en vrai`,
        };
    });

    // ── CONSUMER-CONTRACT — the gate that SKIPS by default, hence the most fragile ──
    //
    // 🛑 **The limit case of this whole file.» `verify-consumer-contract.cjs`
    // exits 0 skipping, with a named motive, as soon as `GEOLEAF_CONSUMERS`
    // is not defined — which is the case on the CI runner, the public
    // clone, and any machine where the operator has not exported the hook.
    // Its manifest lives at the consumer's: it names a client, a contact
    // and downstream-specific paths, and no default path is written in
    // `scripts/`, which ships entirely in the public clone.
    //
    // A gate whose NORMAL state is "skipped" is indistinguishable from a
    // dead gate. These three assertions are the only thing telling them
    // apart: they plant a FIXTURE manifest in a temporary directory, via
    // the hook, and require the EXACT diagnostic code. **They do not prove
    // the real manifest is read — they prove the gate STILL BITES**, and
    // the gate's docblock says it in those terms rather than implying it.
    //
    // The hook exists for that and nothing else, exactly like
    // `GEOLEAF_CI_WORKFLOW_DIR` above: without it, proving the gate would
    // require modifying the REAL manifest, in ANOTHER repo — so it would be
    // done once, at laying, and never again.
    const consumerFixture = (label, mutate, expectedNeedle, expectedStatus) =>
        assertThat(`consumer-contract : ${label}`, () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-consumers-"));
            try {
                // The fixture manifest is written HERE, never copied from a
                // machine path: a fixture depending on a file present on the
                // workstation would pass the probe for whoever has it and
                // turn red for everyone else.
                const base = {
                    consumer: "sonde-gate-probe",
                    manifest_version: "1.4.0",
                    repos: ["__probe__"],
                    contact: "sonde@example.invalid",
                    required: {
                        public: [{ path: "Core.getMap", provider: "core", usedBy: ["sonde"] }],
                        private_tolerated: [],
                        events: [],
                        dom_contract: [],
                    },
                    not_required: {},
                    requested: [],
                    requested_events: [],
                    withdrawn: {},
                    broken_since_v3: {},
                    out_of_scope: {},
                    oracles: {},
                    sequence: [],
                    policy: "sonde",
                };
                fs.writeFileSync(
                    path.join(dir, "sonde.consumer.json"),
                    JSON.stringify(mutate(base), null, 4) + "\n"
                );
                const res = spawnSync("node", ["scripts/verify-consumer-contract.cjs"], {
                    cwd: ROOT,
                    encoding: "utf8",
                    env: { ...process.env, GEOLEAF_CONSUMERS: dir },
                });
                const out = (res.stdout || "") + (res.stderr || "");
                const named = out.includes(expectedNeedle);
                return {
                    ok: res.status === expectedStatus && named,
                    detail:
                        res.status !== expectedStatus
                            ? `exit ${res.status} au lieu de ${expectedStatus}` +
                              (res.status === 0 ? " — SORTIE VERTE sur une fixture mutée" : "")
                            : named
                              ? `exit ${expectedStatus}, et ${expectedNeedle} nommé`
                              : `exit ${expectedStatus}, mais ${expectedNeedle} jamais nommé ` +
                                "(rougit pour une autre raison)",
                };
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

    // 1. THE PROPERTY — a `required.public` path that does not resolve must
    //    be NAMED. `Core.getMap` is chosen because it resolves today: only
    //    the mutated member must make the difference, and the assertion can
    //    thus only fail ON CC-01.
    consumerFixture(
        "un chemin required.public qui ne résout pas",
        (b) => {
            b.required.public.push({
                path: "Core.membreQuiNExistePas",
                provider: "core",
                usedBy: ["sonde"],
            });
            return b;
        },
        "CC-01",
        1
    );

    // 2. THE REFUSAL — an unknown top-level key must exit 2, not 1: it is
    //    not a contract regression, it is a schema the reader cannot read.
    //    Without this refusal, a new key at the consumer's would be
    //    verified by nobody and the gate would stay green on the part of
    //    the contract it ignores.
    consumerFixture(
        "une clé de premier niveau inconnue (refus de conclure)",
        (b) => ({ ...b, cleQueLeLecteurNeConnaitPas: true }),
        "CC-00",
        2
    );

    // 3. THE FILE BLINDNESS — a manifest OLDER than the floor must exit 2.
    //    The only guardrail against the "the gate read something else"
    //    mode: the real manifest lives in a third-party repo, on a branch,
    //    and a `git checkout` over there would suffice to put an earlier
    //    version under the gate's feet. Green = silent catastrophe; this
    //    check forbids it.
    consumerFixture(
        "un manifeste antérieur au plancher de version (cécité au fichier lu)",
        (b) => ({ ...b, manifest_version: "1.0.0" }),
        "plancher",
        2
    );

    // 4 and 5. THE DEPRECATION RATCHET — a path LEAVING `required.public`.
    //
    // 🛑 **The three fixtures above canNOT reach CC-10, and a naively
    // written fourth would have exited GREEN having exercised nothing.**
    // CC-10 compares the manifest to the `positives` baseline, which is
    // indexed PER CONSUMER: with the template's
    // `consumer: "sonde-gate-probe"`, there is nothing to compare and the
    // code falls on its "no positive list in baseline" note. The fixture
    // must therefore borrow the real baseline's identity AND paths.
    //
    // ⚠️ **It READS them instead of copying them.» A probe inscribing 45
    // hardcoded paths would become a fifth competing description of the
    // same surface — the failure mode this repo pays dearest, and one a
    // guard against hand-kept lists must not reproduce by being itself a
    // hand-kept list.
    //
    // BOTH assertions are inseparable: without the counter-proof, a red
    // proves only one thing — that the gate always turns red.
    {
        const baselineCC10 = JSON.parse(
            fs.readFileSync(path.join(ROOT, "scripts/.baselines/consumer-contract.json"), "utf8")
        );
        const posCC10 = (baselineCC10.positives ?? {})[baselineCC10._consumer];
        const RETIRE = "Config.clearThemesCache";

        // The common template: the fixture IS the baseline's consumer,
        // minus (or not) the witness entry. `provider` is taken from the
        // baseline — defaulting it to `core` would turn `Ws` and
        // `Measure.*` red in CC-01, hence turn the probe red for a foreign motive.
        const commeLaBaseline = (retirer) => (b) => ({
            ...b,
            consumer: baselineCC10._consumer,
            required: {
                ...b.required,
                public: posCC10.public
                    .filter((e) => !retirer || e.path !== RETIRE)
                    .map((e) => ({ path: e.path, provider: e.provider, usedBy: ["sonde"] })),
                events: posCC10.events.map((e) => ({ name: e.path, listenedBy: ["sonde"] })),
            },
        });

        if (!posCC10 || !posCC10.public.some((e) => e.path === RETIRE)) {
            // The witness vanished from the baseline: the assertion could no
            // longer show anything, and a probe that can no longer prove
            // must SAY so, never green out silently.
            assertThat("consumer-contract : le témoin de CC-10 existe encore en baseline", () => ({
                ok: false,
                detail:
                    `\`${RETIRE}\` n'est plus dans la baseline positive de ` +
                    `\`${baselineCC10._consumer}\` — les deux assertions CC-10 ne mordent plus. ` +
                    "Choisir un autre témoin `provider: core` et le nommer ici.",
            }));
        } else {
            consumerFixture(
                "un chemin QUITTE required.public sans dépréciation (cliquet CC-10)",
                commeLaBaseline(true),
                RETIRE, // the needle is the PATH, not "CC-10": a generic code gets
                1 //      satisfied by another error category carrying the same code
            );
            consumerFixture(
                "la même fixture, entrée NON retirée : CC-10 se tait (contre-épreuve)",
                commeLaBaseline(false),
                "engagement(s) du contrat inverse",
                0
            );
        }
    }

    // The throwaway patterns, on known-answer witnesses.
    //
    // Why a STRUCTURAL assertion and not a fixture, while everything else
    // in this file plants files: checks 1/2/3's corpus is
    // `getTrackedFiles()`, and the probe plants deliberately WITHOUT
    // indexing — which is what makes it harmless. A `fix-*.js` fixture laid
    // on disk would thus never be looked at, and the assertion would exit
    // green proving nothing: the very shape of the defect this file exists
    // to catch.
    //
    // The 4 NEGATIVE witnesses carry the real weight. The sprint's wording
    // proposed a pattern without a `\b` anchor; it takes
    // `prefix-loader.js`, `hotfix-runner.js` and `suffix_map.cjs` —
    // ordinary names. Removing the anchor turns this line red, and it alone.
    assertThat("hygiène : les motifs de jetables discriminent (7 témoins)", () => {
        delete require.cache[require.resolve("./lib/hygiene-patterns.cjs")];
        const { THROWAWAY_PATTERNS, THROWAWAY_WITNESSES } = require("./lib/hygiene-patterns.cjs");
        const wrong = THROWAWAY_WITNESSES.filter(
            (w) => THROWAWAY_PATTERNS.some((p) => p.re.test(w.path)) !== w.throwaway
        );
        return {
            ok: wrong.length === 0,
            detail: wrong.length
                ? wrong
                      .map((w) => `${w.path} (attendu ${w.throwaway ? "PRIS" : "ignoré"})`)
                      .join(", ")
                : `${THROWAWAY_WITNESSES.length}/${THROWAWAY_WITNESSES.length} témoins conformes`,
        };
    });

    // Same requirement for the ARTEFACT patterns, which just welcomed
    // `^artifacts/`. The 2 NEGATIVE witnesses carry the weight: `artifacts`
    // and `test-results` are ORDINARY directory names, legitimate inside a
    // package. Removing the `^` anchor turns this line red, and it alone.
    assertThat("hygiène : les motifs d'artefacts discriminent (7 témoins)", () => {
        delete require.cache[require.resolve("./lib/hygiene-patterns.cjs")];
        const { ARTIFACT_PATTERNS, ARTIFACT_WITNESSES } = require("./lib/hygiene-patterns.cjs");
        const wrong = ARTIFACT_WITNESSES.filter(
            (w) => ARTIFACT_PATTERNS.some((p) => p.re.test(w.path)) !== w.artifact
        );
        return {
            ok: wrong.length === 0,
            detail: wrong.length
                ? wrong
                      .map((w) => `${w.path} (attendu ${w.artifact ? "PRIS" : "ignoré"})`)
                      .join(", ")
                : `${ARTIFACT_WITNESSES.length}/${ARTIFACT_WITNESSES.length} témoins conformes`,
        };
    });

    assertThat("cliquet anti-any : les globs des DEUX cliquets matchent des fichiers réels", () => {
        // A ratchet glob that matches nothing does not fail — it releases the lock
        // in silence. This is the single cheapest guard against that.
        //
        // Two defects fixed here at once, both of the same shape:
        //
        //  1. This check used to re-list the 14 plugin NAMES by hand, a copy of
        //     ANY_HARDENED_PLUGIN_PACKAGES. A package added to the ratchet was therefore
        //     invisible to the probe — the guard against hand-maintained lists was itself
        //     a hand-maintained list.
        //  2. It never looked at the CORE ratchet (ANY_HARDENED, 12 globs) at all. That is
        //     precisely how 4 of those globs came to match zero files unnoticed
        //     (`utils/renderers`, `built-in/poi`, `built-in/filters`, `modules/optional` —
        //     directories emptied by the KERNEL sprints).
        //
        // Both are closed by reading the globs from the RESOLVED config module instead of
        // restating them: `eslint.config.mjs` is imported in a child process (it is ESM,
        // this script is CJS), and every block that elevates `no-explicit-any` to "error"
        // yields its `files`. The plugin globs come out already resolved through pkgGlob(),
        // so a package rename surfaces here too.
        const { globSync } = require("glob");
        const extract = `
            const cfg = (await import("./eslint.config.mjs")).default;
            const globs = [];
            for (const b of cfg) {
                if (b?.rules?.["@typescript-eslint/no-explicit-any"] !== "error") continue;
                for (const f of b.files ?? []) if (f.startsWith("packages/")) globs.push(f);
            }
            console.log(JSON.stringify(globs));
        `;
        const res = spawnSync("node", ["--input-type=module", "-e", extract], {
            cwd: ROOT,
            encoding: "utf8",
        });
        if (res.status !== 0) {
            return {
                ok: false,
                detail: `eslint.config.mjs illisible : ${(res.stderr || "").trim()}`,
            };
        }
        /** @type {string[]} */
        const globs = JSON.parse(res.stdout);
        // A ratchet that yields no glob at all is the worst outcome, and JSON.parse would
        // happily return [] for it — so the emptiness of the LIST is checked, not just of
        // each entry.
        if (globs.length === 0) return { ok: false, detail: "aucun glob de cliquet extrait" };
        const empty = globs.filter((g) => globSync(g, { cwd: ROOT }).length === 0);
        return {
            ok: empty.length === 0,
            detail: empty.length
                ? `verrous relâchés (${empty.length}/${globs.length}) : ${empty.join(", ")}`
                : `${globs.length}/${globs.length} armés`,
        };
    });

    assertThat("lint-staged : ses globs couvrent un package imbriqué", () => {
        const { minimatch } = require("minimatch");
        const pkg = JSON.parse(fs.readFileSync(PKG_JSON, "utf8"));
        const globs = Object.keys(pkg["lint-staged"] || {});
        const target = `${PROBE_REL}/src/entry.ts`;
        const matched = globs.filter((g) => minimatch(target, g));
        return {
            ok: matched.length > 0,
            detail: matched.length ? matched.join(", ") : `aucun glob ne couvre ${target}`,
        };
    });

    assertThat("purgecss : périmètre imbriqué, et sans node_modules", () => {
        const { globSync } = require("glob");
        delete require.cache[require.resolve("./lib/purgecss-config.cjs")];
        delete require.cache[require.resolve("./lib/packages.cjs")];
        const cfg = require("./lib/purgecss-config.cjs");

        const css = (cfg.CSS_GLOBS || []).flatMap((g) => globSync(g));
        const content = (cfg.CONTENT_GLOBS || []).flatMap((g) => globSync(g));
        const seesProbe = css.some((f) => f.includes("__probe__"));
        // Both halves count: an over-narrow glob misses live CSS and purges
        // it; an over-wide glob sucks in `node_modules` and masks dead CSS.
        const leaked = [...css, ...content].filter((f) => f.includes("node_modules"));

        if (!seesProbe) return { ok: false, detail: "sonde hors périmètre CSS" };
        if (leaked.length)
            return { ok: false, detail: `${leaked.length} fichier(s) de node_modules aspirés` };
        return {
            ok: true,
            detail: `${css.length} css / ${content.length} contenus, 0 node_modules`,
        };
    });

    // The property that JUSTIFIES `verify-e2e-coverage.cjs`'s existence.
    //
    // It cannot be observed on the `__probe__` fixture: the witness here is
    // EMPTY COVERAGE DATA, not a package. One is manufactured (a temporary
    // directory without a single `.json`) and both halves are verified:
    //
    //   1. BARE `nyc report` exits GREEN there —
    //      `istanbul-lib-coverage/lib/percent.js` returns 100 when
    //      `total === 0`, `blankSummary()` returns `pct: 'Unknown'`, and
    //      the comparison `'Unknown' < threshold` is `false`. That is the hole.
    //   2. the wrapper exits RED there, through its witness floor. That is
    //      the closure.
    //
    // If (1) ever turns red — an upstream nyc fix —, this assertion will
    // say so instead of letting the floor become dead code nobody motivates
    // any more.
    assertThat("couverture du boot : le plancher rattrape une donnée vide", () => {
        const vide = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-nyc-vide-"));
        try {
            const nu = spawnSync(
                "npx",
                ["nyc", "report", "--nycrc-path", "nyc.config.cjs", `--temp-dir=${vide}`],
                { cwd: ROOT, encoding: "utf8" }
            );
            const wrap = spawnSync("node", ["scripts/verify-e2e-coverage.cjs"], {
                cwd: ROOT,
                encoding: "utf8",
                env: { ...process.env, GEOLEAF_NYC_OUTPUT: vide },
            });

            const failures = [];
            if (nu.status !== 0) {
                failures.push(
                    `nyc nu sort ${nu.status} sur une donnée vide — le trou est refermé en amont, ` +
                        `le plancher du wrapper n'est plus motivé par ce cas (le documenter ou le retirer)`
                );
            }
            if (wrap.status === 0) {
                failures.push("le wrapper CONCLUT sur une donnée vide — le plancher ne mord pas");
            }
            return {
                ok: failures.length === 0,
                detail: failures.length
                    ? failures.join(" · ")
                    : `nyc nu = 0 (vert à tort), wrapper = ${wrap.status} (refuse de conclure)`,
            };
        } finally {
            fs.rmSync(vide, { recursive: true, force: true });
        }
    });

    // ── The shipped Service Worker is really IN ESLint's perimeter ──────────────
    //
    // `sw-core.js` ships in production (offline cache, IndexedDB,
    // Background Sync) and spent months outside all THREE nets at once:
    // ESLint `ignores`, `tsc` (`allowJs: false`) and `count-any` (which
    // only collects `.ts`). The `ignores` was lifted. Nothing keeps it from
    // coming back.
    //
    // Two ways to lose it silently, and that is why the check is here:
    //   - re-adding `"**/sw-core.js"` to the `ignores` (the pattern sat
    //     there ~1 year);
    //   - moving or renaming the file — in which case `eslint` exits 0 on a
    //     nonexistent path, which LOOKS like a success.
    // Both are thus verified: the file exists, AND ESLint really reads it.
    assertThat("sw-core.js : le SW livré est dans le périmètre d'ESLint", () => {
        const rel = "packages/core/src/kernel/storage/sw-core.js";
        if (!fs.existsSync(path.join(ROOT, rel))) {
            return { ok: false, detail: `${rel} introuvable — chemin à recaler ici même` };
        }
        const res = spawnSync("npx", ["eslint", rel, "--format", "json"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        let parsed;
        try {
            parsed = JSON.parse(res.stdout || "[]");
        } catch {
            return { ok: false, detail: `sortie eslint illisible (exit ${res.status})` };
        }
        const entry = parsed[0];
        if (!entry) return { ok: false, detail: "ESLint n'a produit aucun rapport" };
        // An ignored file produces ONE `null`-ruleId "File ignored…" message.
        const ignored = (entry.messages || []).some((m) => /File ignored/.test(m.message || ""));
        if (ignored) return { ok: false, detail: "ESLint l'IGNORE — l'entrée est revenue" };
        // Positive proof it was READ: its head directive suppresses its
        // console.*. 0 suppressions = either the file changed nature, or it
        // is not analysed.
        const suppressed = (entry.suppressedMessages || []).length;
        if (suppressed === 0) {
            return {
                ok: false,
                detail: "0 suppression : la directive `eslint-disable no-console` de tête ne porte plus rien — fichier non analysé, ou réécrit",
            };
        }
        return { ok: true, detail: `analysé, ${suppressed} no-console supprimés par sa directive` };
    });

    // PC-04-WIDE — the pure-ESM probe widened to registry.all() × the
    // whole package (tests/mocks included) + e2e/ + root. Reuses the
    // existing fixture rather than planting a new one: probe-load.test.js
    // and probe-bare.test.js already carry require()/module.exports in
    // __probe__/__tests__/ — outside the old PC-04's perimeter (which
    // excludes __tests__), inside the new one's. If this assertion goes
    // quiet again, either the registry.all() glob stopped seeing the nested
    // package, or the scan went back to src/ only.
    assertGateSees("PC-04-WIDE : ESM pur élargi voit un package imbriqué (tests compris)", [
        "scripts/verify-plugin-contract.cjs",
    ]);

    // ── Fix — a plugin rename that goes silent again ───────────────────────
    //
    // A `plugins/storage` → `plugins/offline-ui` rename bore on four axes;
    // two gates missed the rename with no red flagging it: the
    // `PLUGIN_BUDGETS_GZ_KB` key (fallen back on the default budget,
    // failing `build:deploy` on a plugin that had not grown) and the
    // `<script>` removal regex in `index.html` (stuck on the old name,
    // leaving an orphan tag produce a 404 on `deploy-core`). The two guards
    // added here must turn red on exactly that defect, or they guard it no
    // more than the original gates did.
    assertThat("check-bundle-size.cjs : clé de budget morte détectée", () => {
        const { assertBudgetKeysAlive, PLUGIN_BUDGETS_GZ_KB } = require(
            path.join(ROOT, "scripts", "check-bundle-size.cjs")
        );
        const PROBE_KEY = "__probe_dead_plugin__";
        // Shape kept in sync with the real table (02/08/2026 — two budgets per
        // plugin, `boot` and `total`). `assertBudgetKeysAlive()` only reads KEYS, so the
        // old flat `{warn, fail}` still passed — which is exactly why it had to be fixed
        // rather than left: a planted value that no longer matches the real shape is a
        // stale template sitting in the one file people copy probes from.
        PLUGIN_BUDGETS_GZ_KB[PROBE_KEY] = {
            boot: { warn: 1, fail: 2 },
            total: { warn: 1, fail: 2 },
        };
        try {
            assertBudgetKeysAlive();
            return {
                ok: false,
                detail: "n'a PAS jeté — une clé nommant un plugin disparu passerait inaperçue",
            };
        } catch (err) {
            return { ok: err.message.includes(PROBE_KEY), detail: err.message.split("\n")[0] };
        } finally {
            delete PLUGIN_BUDGETS_GZ_KB[PROBE_KEY];
        }
    });

    assertThat("build-deploy.cjs : <script> orphelin après retrait détecté", () => {
        const { stripPluginScript } = require(path.join(ROOT, "scripts", "build-deploy.cjs"));
        try {
            // Reproduces exactly the rename's defect: the bundle name is
            // present in the HTML but not in the `<script ... src="...">`
            // shape the regex removes — the regex thus matches nothing, just
            // as when it still targeted the old file name after a rename.
            stripPluginScript(
                '<div data-orphan="dist/geoleaf-offline-ui.plugin.js"></div>',
                "offline-ui",
                "__probe__"
            );
            return {
                ok: false,
                detail: "n'a PAS jeté — un tag survivant au retrait passerait inaperçu",
            };
        } catch (err) {
            return {
                ok: err.message.includes("still references"),
                detail: err.message.split("\n")[0],
            };
        }
    });
} finally {
    cleanup();
}

// ─── Report ───────────────────────────────────────────────────────────────────

console.log("");
let failed = 0;
let pendingCount = 0;
const unexpectedlyGreen = [];

for (const { label, ok, detail } of results) {
    const known = PENDING[label];
    let mark;
    if (ok) {
        mark = `${C.g}✓${C.x}`;
        // A pending item that passes means the debt was paid — the list must shrink,
        // otherwise it rots into a lie exactly like the two dead knip workspaces did.
        if (known) unexpectedlyGreen.push(label);
    } else if (known) {
        mark = `${C.y}⧗${C.x}`;
        pendingCount++;
    } else {
        mark = `${C.r}✗${C.x}`;
        failed++;
    }
    console.log(`  ${mark} ${label.padEnd(46)} ${C.d}${known && !ok ? known : detail}${C.x}`);
}

console.log("");
if (unexpectedlyGreen.length > 0) {
    console.log(
        `${C.r}✗ GATE-PROBE : ${unexpectedlyGreen.length} contrôle(s) listé(s) en attente passent désormais.${C.x}`
    );
    for (const l of unexpectedlyGreen) console.log(`${C.d}    retirer de PENDING : ${l}${C.x}`);
    process.exit(1);
}
if (failed > 0) {
    console.log(`${C.r}✗ GATE-PROBE : ${failed} contrôle(s) en échec non prévu.${C.x}`);
    console.log(
        `${C.d}  Une gate qui ne voit pas la sonde ne verra pas non plus un vrai défaut.${C.x}`
    );
    process.exit(1);
}
console.log(
    `${C.g}✓ GATE-PROBE : ${results.length - pendingCount}/${results.length} contrôles voient un package imbriqué.${C.x}`
);
if (pendingCount > 0) {
    console.log(
        `${C.y}  ${pendingCount} en attente du regroupement — vider PENDING fait partie de son critère de sortie.${C.x}`
    );
}
process.exit(0);
