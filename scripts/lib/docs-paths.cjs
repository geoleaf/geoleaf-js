#!/usr/bin/env node
/**
 * DOCUMENTATION roots — one definition, fifteen readers.
 *
 * Readers: the 11 scripts that write or read a `reference/` artifact
 * (`generate-docs-tree`, `gen-api-surface`, `gen-attributes-report`,
 * `gen-profile-schema-reference`, `gen-config-reference`, `check-tsdoc-conformity`,
 * `check-config-coverage`, `check-config-consumers`, `check-dead-links`,
 * `audit-report-freshness`, `audit-cleanup`) and the 3 guards under
 * `packages/core/__tests__/guards/` that read `specs/`. A second list would diverge — same
 * rationale as `lib/packages.cjs`, `lib/source-inventory.cjs` and
 * `lib/generated-artifacts.cjs`.
 *
 * ## Two roots, because the documentation SPLITS
 *
 * Taking the repo public splits `_docs_projet/` in two:
 *
 *   `docs/`           PUBLIC    — `specs/`, `reference/`, `guides/`
 *   `_docs_projet/`   INTERNAL  — `ETAT`, `JOURNAL`, `INDEX`, the 2 checklists,
 *                                 `registres/`, `travail/`, `vision/`
 *
 * The two roots coincide before the move and diverge after it: this is the only place in
 * the repo that knows it, and that is why the switch fits in one line.
 * ⚠️ **Never derive one from the other** — `internal("specs")` must stay wrong, not become
 * a synonym. A permissive helper would make the split invisible to readers.
 *
 * ## Why this module THROWS — and why the two roots do not throw at the same moment
 *
 * The eleven scripts shared a single shape:
 *
 *     const OUT = path.join(ROOT, "_docs_projet", "reference", "X.md");
 *
 * Moving the directory does not break them: it makes them **mute**. A generator then
 * writes its artifact to a path nobody reads anymore, and a gate walking an absent
 * directory returns `[]` — hence "0 dead links across 0 files", **exit 0**. That is the
 * failure mode measured on the 7 `_docs_projet` scopes of `check-dead-links.cjs`, none of
 * which carried `mustNotBeEmpty`.
 *
 * Throwing turns the silent disappearance into a loud failure. A reader that no longer
 * finds its root must stop, not carry on looking at nothing — that is the `packages.cjs`
 * doctrine ("a registry that silently returns fewer packages than it should is worse than
 * no registry"), applied to the docs.
 *
 * ⚠️ **But the two roots do not have the same existence, and since 2026-08-10 they no
 * longer assert at the same instant.** `DOCS_ROOT` is checked **at load time**: it exists
 * everywhere, public repo included, so demanding it early is free. `INTERNAL_ROOT` is
 * checked **at the first `internal()` call**, because it **legitimately does not exist**
 * in the public clone — the public split removes it there, deliberately.
 *
 * 🛑 **The rationale — worth reading before "restoring the symmetry".** The load-time
 * assertion was right as long as the danger was a **silent** move; once the removal was
 * **intended**, the same line became a full stop. Measured on the real clone: the **16**
 * files requiring this module threw, including **11 `ci:local` gates**, while **only 3**
 * ever call `internal()`. Thirteen public readers were halted by an assertion that does
 * not concern them — and `ci:local` on the clone, "the only measurement that counts" of
 * the public split, could not even start.
 *
 * 📌 **This deferral costs the three real readers NOTHING, and that is verifiable**:
 * `audit-cleanup.cjs`, `audit-report-freshness.cjs` and `check-config-consumers.cjs` call
 * `internal()` at **module scope**, not inside a function. The throw thus moves from this
 * module's line to their own first line — **same execution instant, same message**. It
 * changes who dies, not when.
 *
 * ## The two environment overrides, and what they are really for
 *
 * `GEOLEAF_DOCS_ROOT` and `GEOLEAF_INTERNAL_DOCS_ROOT` are not there for flexibility: they
 * exist to **put the fifteen readers to the test while the net is still up**, before any
 * move. Two distinct injections, two distinct failures:
 *
 *   NON-EXISTENT root → this module throws        (the reader dies loudly)
 *   EMPTY but existing root → it does not throw   (`mustNotBeEmpty` is what must bite)
 *
 * Conflating the two would make an anti-empty-gate assertion look proven when it was the
 * root guard that spoke.
 *
 * Usage :
 *   const docsPaths = require("./lib/docs-paths.cjs");
 *   docsPaths.reference("API_SURFACE.txt");        // <repo>/docs/reference/API_SURFACE.txt
 *   docsPaths.specs("capacites");                  // <repo>/docs/specs/capacites
 *   docsPaths.internal("travail", "rapports");     // <repo>/_docs_projet/travail/rapports
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Resolves a root: the environment override if set, otherwise the default.
 *
 * A relative override is resolved from the repo root and not from `process.cwd()` — gates
 * get invoked from anywhere, and a path depending on the current directory would bring
 * back exactly the instability this module removes.
 *
 * @param {string} envName Name of the environment variable.
 * @param {string} fallbackRel Default path, repo-relative.
 * @returns {string} Absolute path.
 */
function resolveRoot(envName, fallbackRel) {
    const raw = process.env[envName];
    return raw && raw.length > 0 ? path.resolve(REPO_ROOT, raw) : path.join(REPO_ROOT, fallbackRel);
}

/**
 * Root of the PUBLIC docs — `specs/`, `reference/`, `guides/`.
 *
 * ⚠️ This is THE line the 2026-08-10 move flipped, and the only one: all fifteen readers
 * followed without any being touched. Before it, the fourteen that can throw were SEEN
 * throwing on a non-existent root — while `_docs_projet/` was still there, hence while a
 * green still meant something.
 */
const DOCS_ROOT = resolveRoot("GEOLEAF_DOCS_ROOT", "docs");

/** Root of the INTERNAL docs — `registres/`, `travail/`, `vision/`, and the 5 head files. */
const INTERNAL_ROOT = resolveRoot("GEOLEAF_INTERNAL_DOCS_ROOT", "_docs_projet");

/**
 * Throws if the root is absent or not a directory.
 *
 * The message names the override: without it, an operator who just moved a directory reads
 * "not found" and hunts for a typo, when the answer is one line of this file.
 *
 * @param {string} abs Absolute path to check.
 * @param {string} label Readable name of the root.
 * @param {string} envName Environment variable that overrides it.
 */
function requireRoot(abs, label, envName) {
    let ok = false;
    try {
        ok = fs.statSync(abs).isDirectory();
    } catch {
        ok = false;
    }
    if (!ok) {
        throw new Error(
            `docs-paths.cjs — racine ${label} introuvable : ${abs}\n` +
                `  Ce module JETTE plutôt que de laisser un lecteur marcher un répertoire absent\n` +
                `  et rendre « 0 résultat » en sortant 0. Corriger le chemin, ou poser ${envName}.`
        );
    }
}

requireRoot(DOCS_ROOT, "PUBLIQUE", "GEOLEAF_DOCS_ROOT");

/**
 * The INTERNAL root's assertion is run only once — see §"Why this module THROWS": it is
 * deferred to the first `internal()` because the public clone legitimately lacks that
 * directory, and 13 of the 16 readers never touch it.
 */
let internalRootChecked = false;

/** A path under the PUBLIC root. */
const docs = (...seg) => path.join(DOCS_ROOT, ...seg);

/** A path under `docs/reference/` — the generated and the machine-read. */
const reference = (...seg) => docs("reference", ...seg);

/** A path under `docs/specs/` — the 45 frozen spec sheets. */
const specs = (...seg) => docs("specs", ...seg);

/** A path under `docs/guides/` — the procedures. */
const guides = (...seg) => docs("guides", ...seg);

/**
 * A path under the INTERNAL root — what does not ship to the public repo.
 *
 * ⚠️ **THIS is where the internal root is asserted**, at first call and not at module
 * load: a reader that never calls `internal()` has no reason to die because
 * `_docs_projet/` is absent, and it is absent **by construction** in the public clone.
 * The loud failure is fully preserved for whoever uses it.
 *
 * @param {...string} seg Path segments under the internal root.
 * @returns {string} Absolute path.
 * @throws {Error} If the internal root is absent or not a directory.
 */
const internal = (...seg) => {
    if (!internalRootChecked) {
        requireRoot(INTERNAL_ROOT, "INTERNE", "GEOLEAF_INTERNAL_DOCS_ROOT");
        internalRootChecked = true;
    }
    return path.join(INTERNAL_ROOT, ...seg);
};

/**
 * Does the INTERNAL root exist? A predicate that **never throws**.
 *
 * ⚠️ **It exists for one case only, and widening it would denature it**: a reader of the
 * internal corpus running on the **public repo**, where `_docs_projet/` is absent **by
 * decision** (the public split removes it). There, throwing teaches nothing — the absence
 * is the contract. Such a reader must **SKIP while saying so**, the
 * `CONSUMER-CONTRACT/CC-00` pattern, never green out in silence.
 *
 * 🛑 **Do not use it to dodge a throw in the workshop.** Here, an absent internal root is
 * a defect, and `internal()` must keep dying loudly: that is the whole doctrine of §"Why
 * this module THROWS". The predicate separates "absent because this repo does not carry
 * it" from "absent because something is broken" — the two are byte-identical, and only
 * the caller knows which of the two worlds it runs in.
 *
 * 📌 It answers `false` **only** on a non-existent or non-directory root. A present but
 * **EMPTY** root returns `true`: `mustNotBeEmpty` is what must bite there, a distinction
 * §"The two environment overrides" already draws and that must not be blurred.
 *
 * @returns {boolean} `true` if the internal root is an existing directory.
 */
function internalRootExists() {
    try {
        return fs.statSync(INTERNAL_ROOT).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Repo-relative path, POSIX separators — for gate messages.
 *
 * Gates print paths people paste into an editor; a backslash survives that badly, and a
 * machine-local absolute path has no place in shared output.
 *
 * @param {string} abs
 * @returns {string}
 */
const rel = (abs) => path.relative(REPO_ROOT, abs).replaceAll("\\", "/");

module.exports = {
    REPO_ROOT,
    DOCS_ROOT,
    INTERNAL_ROOT,
    docs,
    reference,
    specs,
    guides,
    internal,
    internalRootExists,
    rel,
};
