#!/usr/bin/env node
/**
 * check-dead-links.cjs
 *
 * Scans Markdown files across the configured scopes and reports broken internal links.
 * - Internal links: resolved relative to the source file, existence checked with fs.existsSync
 * - Anchor links: heading normalisation applied, presence checked in the target file
 * - External URLs (https?://): listed separately, not fetched
 *
 * Exit code 0 — no broken internal links
 * Exit code 1 — one or more broken internal links detected
 *
 * Usage:
 *   node scripts/check-dead-links.cjs [--dir <path>] [--verbose]
 *
 * Default perimeter: the public docs of `@geoleaf/core` (recursive) PLUS the ROOT's
 * markdown (depth 0). `--dir <path>` forces a single scope.
 */

"use strict";

const fs = require("fs");
const { createFenceTracker } = require("./lib/md-fences.cjs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const dirArgIdx = args.indexOf("--dir");
const CWD = process.cwd();
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");
// Anchored to the SCRIPT, never to `process.cwd()`: the root perimeter must be the
// same whatever the invocation directory.
const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * The default perimeter counts TWO scopes, no longer one.
 *
 * The ROOT's markdown was scanned by nothing, and that hole cost four very real 404s
 * in the public README: `packages/core/docs/poi/GeoLeaf_POI_README.md` (deleted at
 * `54b5651b`, POI subsystem long dissolved) and three `LICENCE` for `LICENSE`. It is
 * the exact replay of `b3d85253`/`MIGRATION_V1_V2.md` — the defect that had this gate
 * wired in the first place — one notch higher.
 *
 * ⚠️ `depth: 0` on the root is not a shortcut, it is THE contract: recursing from the
 * root would descend into `.git/`, `docs-dist/`, `coverage/`, `deploy/`,
 * `_archive_local/` and `.claude/worktrees/`. Giving them an exclusion list would be
 * an unbounded enumeration rotting in silence — the defect class an entire earlier
 * cleanup closed. `node_modules/` is the exception and is skipped by `walkDir` itself:
 * see the rationale on the function.
 *
 * ## 2026-07-31 — second half: package READMEs ENTER the perimeter
 *
 * ⚠️ This block carried the inverse rationale until 07-31 ("DELIBERATELY not extended
 * to `packages/*​/README.md`"), and **that rationale fell** — the target still existed,
 * it is the constraint that had disappeared. It is kept here rather than deleted,
 * because it says what was blocking and hence what had to be handled.
 *
 * Old rationale: `packages/core/README.md` pointed at `docs/api/index.html`, a TypeDoc
 * artifact both **gitignored** and **excluded from the tarball** (`files[]` carries
 * `!docs/api/`) — hence absent from a fresh clone AND from the published package.
 * Gating that file would have made it permanently red.
 *
 * What changed: the **target** was handled, not the generator.
 * `packages/core/README.md` is rewritten as storefront + pointers and now points at
 * the API reference **by its public URL**, an idiom `packages/core/docs/README.md:13`
 * already applied. No link to a generated artifact remains, hence nothing left to
 * expect from a fresh clone.
 *
 * ⚠️ And the hole this exclusion left was not theoretical. Measured at wiring time, on
 * files NO gate saw: `packages/core/README.md` pointed at
 * `docs/poi/GeoLeaf_POI_README.md` (a dissolved subsystem) — the **exact** replay of
 * the defect that had this gate wired, one notch lower; three published plugin READMEs
 * carried `[LICENSE](../../LICENSE)`, which resolves to `packages/LICENSE` and exists
 * **neither on GitHub nor in the tarball**; and `addpoi/docs/` carried 5 dead
 * table-of-contents anchors.
 *
 * Perimeter added, all **derived from `lib/packages.cjs`** — never a `packages/**`
 * glob, which would capture generated artifacts (`core/node_modules`, `core/dist`):
 *
 *   package READMEs      `<pkg>/*.md` at depth 0, the registry's 18
 *   package docs         `<pkg>/docs/` recursive (today `addpoi`, `offline-ui`)
 *   `.github/`           CODE_OF_CONDUCT · SECURITY · copilot-instructions — the
 *                        storefront GitHub shows in its own tabs
 *   `e2e/`               a procedure people execute, hence CURRENT state
 *   `_plugin-template/`  the SCAFFOLD: a dead link there is re-sown into every future
 *                        plugin. Outside `workspaces` (`!packages/_*`), hence absent
 *                        from the registry — the only hard-named path here, and it is
 *                        for that reason.
 *
 * No npm script nor CI wiring is added: the perimeter changes, the `check:links` name
 * does not. A separate `check:links:root` would be three more wirings not to forget
 * (`ci.yml`, `ci-local.cjs`, `.husky/pre-commit`) and a fourth desynchronization
 * point.
 *
 * ## 2026-07-27 — the INTERNAL docs enter the perimeter, through explicit scopes
 *
 * Second blind spot: `_docs_projet/` — the repo's biggest corpus, and the one every
 * session reads — was seen by nothing. It cost dearly twice in the single day of
 * 07-27: a sibling link between two `specs/contrats/` specs, and **20 dead links in
 * the two permanent registers**, broken by their own move from `travail/rapports/` to
 * `registres/` (7 × `../../archives/` instead of `../archives/`). These are the
 * documents that STEER the work: a dead link there costs more than elsewhere.
 *
 * ⚠️ **`_docs_projet/` is NOT added wholesale, and that is not caution.** Measured:
 * `archives/` alone returns **1,175 dead links** — and they are LEGITIMATE. An archive
 * document points at the code of its date, code deleted since; "fixing" it would turn
 * it into false testimony (rule stated in `_docs_projet/archives/README.md`): these
 * are RECORDS, to exclude by design.
 *
 * Gated, therefore, are only the directories whose content claims to describe the
 * CURRENT state:
 *
 *   `_docs_projet/` (depth 0)   ETAT · JOURNAL · INDEX · the 2 checklists
 *   `specs/`                    the frozen — where the sibling links live
 *   `registres/`                the living lists that steer the work
 *   `reference/`                the generated and the machine-read
 *   `travail/roadmaps/`         the active roadmaps
 *
 * Out of perimeter, deliberately: `archives/` (above), and
 * `travail/{audits,cdc,rapports}` — dated and perishable, `cdc/` among them being raw
 * material in the middle of being consumed.
 *
 * **Green at wiring time** (the 5 scopes at 0), hence **no baseline** — same regime as
 * `check-orphan-exports`. The gate can only bite on a fresh regression.
 *
 * ## 2026-08-10 — the SPLIT: 7 internal-doc scopes become 3 public scopes
 *
 * ⚠️ **The paragraph above describes a perimeter that no longer exists, and it is kept
 * because it says what was gated and why.** The docs split into two roots
 * (`lib/docs-paths.cjs`): `docs/` ships to the public repo, `_docs_projet/` stays in
 * the workshop. The perimeter follows the partition, not the old directory.
 *
 *   RETARGETED to `docs/`, **with `mustNotBeEmpty`**: `specs/` · `reference/` ·
 *   `guides/`
 *   REMOVED: the internal-docs root (depth 0) · `registres/` · `vision/` ·
 *            `travail/roadmaps/`
 *
 * The 4 removed are not a coverage loss lightly consented: they gate a corpus that
 * **will not be in the public clone**, and a scope whose directory is absent goes
 * green having read nothing — exactly the failure the 3 assertions below now forbid
 * on the public side. The day the internal docs get re-gated, it will be in their own
 * repo, with `--dir`.
 *
 * 🛑 **None of the 7 carried `mustNotBeEmpty`** — verified before moving anything. A
 * move done without laying the 3 assertions first would have taken `Scanned 172` to
 * ~110 **without a single line turning red**.
 *
 * ⚠️ **Known blind spot, not closed here**: the **badge** shape (an image nested in a
 * link) escapes the regex — a measured, accepted debt. It becomes visible in this new
 * perimeter; do not mistake it for a regression.
 */
const SCOPES =
    dirArgIdx >= 0
        ? [{ dir: path.resolve(CWD, args[dirArgIdx + 1]), depth: Infinity, label: "--dir" }]
        : [
              // The default comes from the registry, which throws.
              {
                  dir: path.join(registry.requireByDirName("core").absDir, "docs"),
                  depth: Infinity,
                  label: "docs publiques",
              },
              { dir: REPO_ROOT, depth: 0, label: "markdown de la racine" },
              // ── 2026-08-10 — the docs SPLIT, and the perimeter follows the split
              //
              // The 7 original internal-doc scopes become 3, and the 3 change NATURE:
              // they now describe a PUBLISHED surface, so each carries its
              // anti-empty-gate assertion. The 4 others (internal-docs root,
              // `registres/`, `vision/`, `travail/roadmaps/`) are REMOVED: what stays
              // under `_docs_projet/` does not ship to the public repo, and a scope
              // gating a corpus absent from the clone is a scope that will go green
              // reading nothing.
              //
              // 🛑 None of the 7 carried `mustNotBeEmpty`, and that hole is what made
              // the move dangerous: `walkDir` returns `[]` on an absent directory
              // (see its guard :265-267), so the gate would have announced "0 dead
              // links" over ~60 fewer files, while exiting 0. A gate does not lose
              // its target by reddening, it goes quiet — hence the three assertions
              // below.
              {
                  dir: docsPaths.specs(),
                  depth: Infinity,
                  label: "specs",
                  mustNotBeEmpty: true,
              },
              {
                  dir: docsPaths.reference(),
                  depth: Infinity,
                  label: "reference",
                  mustNotBeEmpty: true,
              },
              // Added on 2026-07-27 with the zone's exit: a guide describes a
              // procedure people execute, hence CURRENT state. 16 dead links at
              // wiring, all fixed before plugging in — green, no baseline, like the
              // other scopes.
              {
                  dir: docsPaths.guides(),
                  depth: Infinity,
                  label: "guides",
                  mustNotBeEmpty: true,
              },
              // ── 2026-07-31 — the PRODUCT surfaces (see the header, second half)
              //
              // Two SYNTHETIC scopes: their file list is computed from the registry
              // rather than walked from a directory. Declaring them as 18 entries
              // would make the perimeter line unreadable, and above all a package
              // with no `.md` at its root would then yield an empty scope without it
              // being a defect.
              {
                  label: "README des paquets",
                  files: registry
                      .all()
                      .flatMap((p) => walkDir(p.absDir, (f) => f.endsWith(".md"), 0)),
                  // What the assertion below verifies, and why it is not circular:
                  // the oracle is `fs.existsSync` on `<pkg>/README.md`, the thing
                  // under test is the scope's construction. A wrong `path.join` or a
                  // slipping depth leaves the file on disk and out of the scan —
                  // exactly the failure `packages.cjs` refuses to leave silent.
                  mustContain: registry
                      .all()
                      .map((p) => path.join(p.absDir, "README.md"))
                      .filter((f) => fs.existsSync(f)),
              },
              {
                  label: "docs des paquets",
                  files: registry
                      .all()
                      .flatMap((p) =>
                          walkDir(path.join(p.absDir, "docs"), (f) => f.endsWith(".md"))
                      ),
                  mustNotBeEmpty: true,
              },
              {
                  dir: path.join(REPO_ROOT, ".github"),
                  depth: Infinity,
                  label: "vitrine GitHub",
                  mustNotBeEmpty: true,
              },
              {
                  dir: path.join(REPO_ROOT, "e2e"),
                  depth: Infinity,
                  label: "e2e",
                  mustNotBeEmpty: true,
              },
              {
                  dir: path.join(REPO_ROOT, "packages", "_plugin-template"),
                  depth: Infinity,
                  label: "scaffold plugin",
                  mustNotBeEmpty: true,
              },
          ];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk a directory and return all files matching the predicate.
 *
 * ⚠️ `node_modules/` is skipped, and it is the ONLY excluded name. This file's header
 * already claimed the walker does not descend into it; that was false, and the 07-31
 * measurement says so: `--dir packages/build-config` returned **36 dead links, all in
 * `node_modules`** — a gate crying wolf on third-party code. Harmless while the
 * configured scopes contained none; blocking as soon as package roots are added, and
 * already harmful to the operator, whom the V3 overhaul's recipe has run
 * `--dir <directory>` document by document.
 *
 * One name, universal and bounded — not the unbounded enumeration the header refuses:
 * the other generated directories (`dist/`, `docs/api/`, `docs/public/`, `docs-dist/`)
 * carry no `.md` and are set aside by the predicate, not by a list.
 *
 * @param {string} dir
 * @param {(f: string) => boolean} predicate
 * @param {number} [maxDepth=Infinity] 0 = this directory ALONE, no recursion.
 * @returns {string[]}
 */
function walkDir(dir, predicate, maxDepth = Infinity) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (maxDepth > 0) results.push(...walkDir(full, predicate, maxDepth - 1));
        } else if (predicate(full)) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Extract all Markdown link targets from a file's text content.
 * Returns objects { target, line } where target is the raw href string.
 * Matches: [text](target) — skips image links ![...](...) as well as
 * HTML/JS code blocks delimited by ```...```.
 *
 * ⚠️ KNOWN, MEASURED BLIND SPOT, NOT FIXED HERE — the BADGE shape
 * `[![alt](image)](target)` is NOT extracted: the regex below consumes the image's
 * INNER link and stops before `](target)`. Verified by mutation — deliberately
 * breaking a `README.md` badge's target leaves this gate GREEN.
 *
 * `README.md` carries 5. Three pointed `LICENCE` for `LICENSE` and were fixed BY
 * HAND, since the gate could not do it. Widening the regex requires re-measuring the
 * 62 public documents (false-positive risk on nested images) — recorded as a named
 * follow-up rather than improvised in passing.
 *
 * @param {string} content
 * @returns {{ target: string; line: number }[]}
 */
function extractLinks(content) {
    const links = [];
    const lines = content.split("\n");
    // CommonMark-conformant tracking, SHARED with `extractAnchors` below.
    // The blind toggle (`inCodeBlock = !inCodeBlock` on any ```) got nested fences
    // wrong: the pattern was DUPLICATED here and there, so fixing one would have left
    // half the defect. The helper answers that duplication as much as the defect.
    const fences = createFenceTracker();

    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];

        if (fences.consume(ln)) continue;
        if (fences.inCode) continue;

        // Match [text](target) — exclude image syntax ![ and empty targets
        const linkRe = /(?<!!)\[(?:[^\]]*)\]\(([^)]+)\)/g;
        let m;
        while ((m = linkRe.exec(ln)) !== null) {
            const raw = m[1].trim();
            if (raw) links.push({ target: raw, line: i + 1 });
        }
    }
    return links;
}

/**
 * Normalise a heading text to a GitHub-style anchor ID.
 *
 * GitHub's algorithm (spec-accurate, Ruby \w is Unicode-aware):
 *   1. Convert to lowercase
 *   2. Remove everything that is not a Unicode letter/digit, underscore, space, or hyphen
 *      (em-dash, en-dash, colons, brackets, backticks etc. are stripped)
 *   3. Replace each space with a hyphen (no collapsing — consecutive spaces → consecutive hyphens)
 *
 * This means:
 *   "GeoLeafAPI — top-level API" → "geoleafapi--top-level-api"  (spaces around em-dash → --)
 *   "Recipe 1: Minimal Map"     → "recipe-1-minimal-map"
 *   "Config (v1.1)"             → "config-v11"
 *   "Synthèse chiffrée"         → "synthèse-chiffrée"           (Unicode letters preserved)
 *
 * @param {string} text  Raw heading text (with or without leading #)
 * @returns {string}
 */
function headingToAnchor(text) {
    return (
        text
            .toLowerCase()
            // Remove leading #+ from raw heading lines (when called on a full line)
            .replace(/^#+\s*/, "")
            // Strip everything that isn't a Unicode letter (\p{L}), digit (\p{N}), underscore, space, or hyphen
            // Note: \p{L} and \p{N} require the 'u' flag and correctly handle accented chars (é, è, ô…)
            .replace(/[^\p{L}\p{N}_\s-]/gu, "")
            .trim()
            // Replace each individual space with a hyphen (preserves consecutive spaces → consecutive hyphens)
            .replace(/ /g, "-")
    );
}

/**
 * Extract all heading anchors from a Markdown file.
 * @param {string} filePath
 * @returns {Set<string>}
 */
function extractAnchors(filePath) {
    const anchors = new Set();
    if (!fs.existsSync(filePath)) return anchors;
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    // SAME helper as `extractLinks`. This is where the duplication bit: both
    // extractors carried the same blindness, and the founding note insisted on that
    // point — "fixing one would leave half the defect".
    const fences = createFenceTracker();
    for (const ln of lines) {
        if (fences.consume(ln)) continue;
        if (fences.inCode) continue;
        const m = ln.match(/^(#{1,6})\s+(.+)/);
        if (m) anchors.add(headingToAnchor(m[2]));
    }
    return anchors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Readable label of a scope — `docs publiques (packages/core/docs)`. */
const scopeLabel = (s) =>
    s.dir ? `${s.label} (${path.relative(REPO_ROOT, s.dir) || "."})` : `${s.label} (dérivé)`;

/** A scope's files — computed list when provided, directory walk otherwise. */
const scopeFiles = (s) => s.files ?? walkDir(s.dir, (f) => f.endsWith(".md"), s.depth);

// ── Assertions anti-gate-vide, par scope
//
// The global "0 files in total" guard is no longer enough now that the perimeter is
// multiple: a scope finding nothing disappears into the sum of the others and the gate
// goes GREEN without having looked. It is the rule — a guard never seen red guards
// nothing — applied to the perimeter rather than the verdict.
//
// Two shapes, because the two failures differ:
//   `mustNotBeEmpty`  a hard-named directory a rename would make vanish
//   `mustContain`     a derived scope: the file is on disk, the scope's construction
//                     must bring it back. `packages.cjs` protects the package list,
//                     nothing protected the path drawn from it.
/**
 * The file count PER SCOPE, in declaration order.
 *
 * Added on 2026-08-10: until then the report only printed a TOTAL, even in
 * `--verbose`. A total is indistinguishable — `Scanned 172` stays `Scanned 172`
 * whether one scope lost 30 files while another gained 30. Yet that is precisely the
 * question one asks after a directory move, and the only one `mustNotBeEmpty` does
 * not answer: it separates "empty" from "non-empty", not "complete" from "amputated".
 *
 * @type {{label: string, n: number}[]}
 */
const scopeCounts = [];

for (const s of SCOPES) {
    const files = scopeFiles(s);
    scopeCounts.push({ label: scopeLabel(s), n: files.length });
    if (s.mustNotBeEmpty && files.length === 0) {
        console.error(`[check-dead-links] Scope VIDE : ${scopeLabel(s)} — périmètre déplacé ?`);
        process.exit(1);
    }
    const missing = (s.mustContain ?? []).filter((f) => !files.includes(f));
    if (missing.length > 0) {
        console.error(
            `[check-dead-links] Scope ${scopeLabel(s)} : ${missing.length} fichier(s) sur le disque hors du scan —\n` +
                missing.map((f) => `    ${path.relative(REPO_ROOT, f)}`).join("\n")
        );
        process.exit(1);
    }
}

// Deduplicated union: two scopes may overlap (`--dir .` against a defect, or a future
// docs root moved under the repo root).
const mdFiles = [...new Set(SCOPES.flatMap(scopeFiles))];

if (mdFiles.length === 0) {
    // The guard must name ALL scopes: with a multiple perimeter, citing only the
    // first would send the failure hunt to the wrong place.
    console.error(
        `[check-dead-links] Aucun .md trouvé dans : ${SCOPES.map(scopeLabel).join(" + ")}`
    );
    process.exit(1);
}

if (VERBOSE) {
    console.log(
        `[check-dead-links] Scan de ${mdFiles.length} fichier(s) — ${SCOPES.map(scopeLabel).join(" + ")}\n`
    );
}

const broken = [];
const externalLinks = [];

for (const mdFile of mdFiles) {
    const content = fs.readFileSync(mdFile, "utf8");
    const links = extractLinks(content);
    const relFile = path.relative(REPO_ROOT, mdFile);

    for (const { target, line } of links) {
        // Split anchor from file path
        const hashIdx = target.indexOf("#");
        const filePart = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
        const anchor = hashIdx >= 0 ? target.slice(hashIdx + 1) : null;

        // External link
        if (/^https?:\/\//i.test(filePart) || (!filePart && /^https?:\/\//i.test(target))) {
            externalLinks.push({ file: relFile, line, href: target });
            continue;
        }

        // Anchor-only link (within same file)
        if (!filePart) {
            if (anchor) {
                const anchors = extractAnchors(mdFile);
                if (!anchors.has(anchor)) {
                    broken.push({
                        file: relFile,
                        line,
                        href: target,
                        reason: `anchor #${anchor} not found in same file`,
                    });
                }
            }
            continue;
        }

        // Skip mailto / data URIs
        if (/^(mailto:|data:)/i.test(filePart)) continue;

        // Resolve the target file relative to the source file's directory.
        //
        // VitePress resolves extensionless links to `<link>.md` (that is the convention
        // the corpus is written in), so a bare `releases/PATCHNOTE_V2.0.0` is NOT dead.
        // Judging those by the GitHub convention produced 5 false positives and would
        // have made this gate permanently red the day it got wired — the anti-pattern
        // this repo avoids elsewhere (see .husky/pre-commit on check-config-consumers).
        // NB: do NOT gate this on `path.extname(filePart)` — a link such as
        // `releases/PATCHNOTE_V2.0.0` reports an extension of ".0" because of the
        // version dots, which would skip exactly the links that need resolving.
        let resolved = path.resolve(path.dirname(mdFile), filePart);

        if (!fs.existsSync(resolved) && fs.existsSync(`${resolved}.md`)) {
            resolved = `${resolved}.md`;
        }

        if (!fs.existsSync(resolved)) {
            broken.push({
                file: relFile,
                line,
                href: target,
                reason: `file not found: ${path.relative(REPO_ROOT, resolved)}`,
            });
            continue;
        }

        // If there is an anchor, verify it exists in the target file
        if (anchor) {
            // Target could be a directory — skip anchor check
            const stat = fs.statSync(resolved);
            if (stat.isFile()) {
                const anchors = extractAnchors(resolved);
                if (!anchors.has(anchor)) {
                    broken.push({
                        file: relFile,
                        line,
                        href: target,
                        reason: `anchor #${anchor} not found in ${path.relative(REPO_ROOT, resolved)}`,
                    });
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const sep = "─".repeat(72);

/** The perimeter, scope by scope, with its count — printed in both verdicts. */
function printScopes(indent) {
    console.log(`${indent}Scanned ${mdFiles.length} file(s) — ${scopeCounts.length} scope(s) :`);
    for (const { label, n } of scopeCounts) {
        console.log(`${indent}  ${String(n).padStart(4)}  ${label}`);
    }
}

if (broken.length === 0) {
    console.log(`${sep}`);
    console.log(`✅  check-dead-links — 0 broken internal links`);
    // `in docs/` was HARD-CODED, hence wrong as soon as the perimeter moved.
    printScopes("    ");
    if (externalLinks.length > 0) {
        console.log(
            `    ⚠️  ${externalLinks.length} external URL(s) not validated (use --verbose to list)`
        );
        if (VERBOSE) {
            console.log("\n  External URLs (not checked):");
            for (const { file, line, href } of externalLinks) {
                console.log(`    ${file}:${line}  →  ${href}`);
            }
        }
    }
    console.log(sep);
    process.exit(0);
} else {
    console.log(`${sep}`);
    console.log(`❌  check-dead-links — ${broken.length} broken internal link(s) found\n`);
    printScopes("  ");
    console.log("");
    for (const { file, line, href, reason } of broken) {
        console.log(`  ${file}:${line}`);
        console.log(`    link   : ${href}`);
        console.log(`    reason : ${reason}\n`);
    }
    if (externalLinks.length > 0) {
        console.log(
            `  ⚠️  ${externalLinks.length} external URL(s) not validated (use --verbose to list)`
        );
        if (VERBOSE) {
            console.log("\n  External URLs (not checked):");
            for (const { file, line, href } of externalLinks) {
                console.log(`    ${file}:${line}  →  ${href}`);
            }
        }
    }
    console.log(sep);
    process.exit(1);
}
