#!/usr/bin/env node
/**
 * deploy-docs.cjs
 *
 * Deployment pipeline for GeoLeaf public documentation:
 *   1. Regenerate TypeDoc API reference (v2.0.0)
 *   2. Copy docs/api/ → docs/public/api/ (VitePress static asset)
 *   3. Build VitePress → docs-dist/ (root — moved out of packages/)
 *   4. Sync docs-dist/ → <site>/docs/
 *   5. Auto-generate <site>/assets/data/news.json from CHANGELOG.md
 *
 * ## The ONLY publication channel for the docs (settled 2026-07-25)
 *
 * This publication is **manual**: `npm run docs:deploy`, launched by a human. No
 * GitHub workflow triggers it — `packages/core/.github/workflows/deploy-docs.yml`,
 * since deleted, never executed anyway (GitHub only reads workflows at the repo
 * root), and the account's Actions quota is scarce. Do not recreate one without
 * revisiting that arbitration: the repo would then have two documentation policies.
 *
 * ## Where this script writes — the two halves, and why they differ
 *
 * **Outside the repo** (steps 4 and 5), under `GEOLEAF_DOCS_SITE_ROOT`. This used
 * to be the repo's riskiest spot: the target was reached through FOUR hard-coded
 * `..`, and `syncDir` destroyed it recursively. On a machine where the repo is not
 * at that exact depth, what got destroyed was not determined. The variable is now
 * MANDATORY and defaultless — a default would have preserved the assumption being
 * removed.
 *
 * **Inside `packages/core/docs/`** (steps 1, 2 and 2b): `api/`, `public/api/` and
 * `public/logo.png`. ⚠️ Those three STAY in place, and it is no oversight:
 * `public/` is VitePress's static-assets directory, resolved against `srcDir` —
 * moving it would break the build. They are gitignored and excluded from `files[]`
 * by negation, so they are neither versioned nor published: the targeted defect is
 * handled, the location was not the defect.
 */

"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const registry = require("./lib/packages.cjs");

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");
// Resolved by the registry, never by `path.join(ROOT, "packages", "core")`: a
// hard-coded path does not break on a move, it silently stops matching.
// `requireByDirName` throws if the package cannot be found, the wanted behaviour
// here — this script writes, and a stale path would publish beside the target.
const CORE = registry.requireByDirName("core").absDir;
const DOCS_SRC = path.join(CORE, "docs");
const TYPEDOC_OUT = path.join(DOCS_SRC, "api");
const VITEPRESS_PUBLIC_API = path.join(DOCS_SRC, "public", "api");
const CHANGELOG_SRC = path.join(DOCS_SRC, "CHANGELOG.md");
const BUILD_OUT = path.join(ROOT, "docs-dist");

/**
 * Expected pipeline failure — a dubious target, an absent source.
 *
 * ⚠️ The guards THROW instead of calling `process.exit(1)`, and that is what makes
 * them PROVABLE. A `process.exit` kills the calling process:
 * `probe-gate-visibility.cjs` could not exercise them, and the costliest fix —
 * `syncDir`'s destroy/observe order — would be guarded by nothing at all. `main()`
 * catches and exits 1: command-line behaviour is unchanged.
 */
class DeployError extends Error {
    constructor(message) {
        super(message);
        this.name = "DeployError";
    }
}

/**
 * Published site root — `GEOLEAF_DOCS_SITE_ROOT`, mandatory, defaultless.
 *
 * The three external targets derive from it, so the repo's depth is assumed
 * nowhere. Validation runs BEFORE step 1: a wrong target must stop the script while
 * it has destroyed nothing yet, not when step 4 calls `rmSync`.
 */
function resolveSiteRoot(raw = process.env.GEOLEAF_DOCS_SITE_ROOT, root = ROOT) {
    if (!raw || !raw.trim()) {
        throw new DeployError(
            `GEOLEAF_DOCS_SITE_ROOT n'est pas définie.\n\n` +
                `  Ce script SUPPRIME récursivement <site>/docs/ avant de le réécrire, et\n` +
                `  écrit <site>/assets/data/news.json. Il n'a pas de cible par défaut : la\n` +
                `  précédente était atteinte par quatre « .. » en dur, ce qui rendait la\n` +
                `  cible indéterminée dès que le dépôt changeait de profondeur.\n\n` +
                `  Exemple :\n` +
                `    GEOLEAF_DOCS_SITE_ROOT=/chemin/vers/Sites_Web/geoleaf.dev npm run docs:deploy`
        );
    }

    const abs = path.resolve(raw);
    const fail = (why) => {
        throw new DeployError(`GEOLEAF_DOCS_SITE_ROOT « ${abs} » — ${why}`);
    };

    // The five guards bear on what is about to be DESTROYED. A recursive `rmSync`
    // whose target comes from an environment variable must fail on a dubious value,
    // never execute "just in case".
    if (abs === path.parse(abs).root) fail("c'est la racine du système de fichiers.");
    if (abs === root) fail("c'est la racine du dépôt.");
    if (!path.relative(root, abs).startsWith("..")) {
        fail("ce chemin est DANS le dépôt — la doc publiée vit dehors.");
    }
    if (!fs.existsSync(abs)) fail("ce répertoire n'existe pas.");
    if (!fs.statSync(abs).isDirectory()) fail("ce chemin n'est pas un répertoire.");

    return abs;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd, cwd = ROOT) {
    console.log(`\n▶ ${cmd}`);
    execSync(cmd, { cwd, stdio: "inherit" });
}

function copyDir(src, dest) {
    if (!fs.existsSync(src)) {
        console.warn(`  ⚠ Source not found, skipping copy: ${src}`);
        return;
    }
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Fully replaces `dest` with the contents of `src`.
 *
 * ⚠️ The ORDER is the key fix, and it was the script's costliest defect. Before:
 * `rmSync(dest)` first, `copyDir(src, dest)` next — and `copyDir` settles for a
 * `console.warn` when the source is missing. The external target was thus **erased
 * without being replaced, in exit 0**: the published docs vanished and the script
 * announced success. Not theoretical — `docs-dist/` moved out of `packages/`, and
 * during the window where `BUILD_OUT` still pointed at the old path, that is
 * exactly what an `npm run docs:deploy` would have done.
 *
 * Same family as the deleted mirror workflows' `continue`: a destructive device
 * treating an absent source as a benign case.
 */
function syncDir(src, dest) {
    if (!fs.existsSync(src)) {
        throw new DeployError(
            `source absente — ${src}\n` + `  Rien n'a été supprimé. La cible ${dest} est intacte.`
        );
    }
    if (fs.readdirSync(src).length === 0) {
        throw new DeployError(
            `source VIDE — ${src}\n` +
                `  Rien n'a été supprimé. Publier un répertoire vide effacerait la doc en ligne.`
        );
    }
    if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
    }
    copyDir(src, dest);
}

function countFiles(dir) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            if (entry.isDirectory()) walk(path.join(d, entry.name));
            else count++;
        }
    }
    walk(dir);
    return count;
}

/** Strip markdown bold, inline code, and links from a bullet text. */
function stripMarkdown(text) {
    return text
        .replaceAll("**", "")
        .replaceAll(/`([^`]+)`/g, "$1")
        .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
}

/** Resolve the section key from a ### heading line. */
function resolveSectionKey(heading, entry) {
    const sec = heading.toLowerCase();
    if (sec.includes("breaking")) {
        entry.breaking = true;
        return "breaking";
    }
    if (sec.includes("added") || sec.includes("ajout")) return "added";
    if (sec.includes("fixed") || sec.includes("correction")) return "fixed";
    if (sec.includes("removed") || sec.includes("suppri")) return "removed";
    return null;
}

/** Push a bullet text into the correct array of a version entry. */
function pushBullet(entry, sectionKey, text) {
    if (sectionKey === "added") entry.ajouts.push(text);
    else if (sectionKey === "fixed") entry.correctifs.push(text);
    else if (sectionKey === "removed") entry.suppressions.push(text);
}

/** Build a human-readable title from the first Added bullet. */
function buildTitle(version, ajouts) {
    if (!ajouts.length) return `GeoLeaf v${version}`;
    const firstBullet = ajouts[0].replace(/^[^:—–]+[:\-–]\s*/, "").substring(0, 60);
    return `GeoLeaf v${version} — ${firstBullet}`;
}

/** Process one line against the current version entry; return updated section key. */
function processLine(line, current, currentSection) {
    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) return resolveSectionKey(sectionMatch[1], current);

    const bulletMatch = line.match(/^- (.+)/);
    if (bulletMatch && currentSection) {
        const text = stripMarkdown(bulletMatch[1]);
        if (text.length >= 3) pushBullet(current, currentSection, text);
    }
    return currentSection;
}

/**
 * Parse CHANGELOG.md (Keep a Changelog format) and return the last N versions
 * as objects matching the news.json patchnotes schema.
 */
function parseChangelog(changelogPath, maxVersions = 5) {
    const lines = fs.readFileSync(changelogPath, "utf-8").split("\n");
    const versions = [];
    let current = null;
    let currentSection = null;

    for (const line of lines) {
        const versionMatch = line.match(/^## \[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/);
        if (versionMatch) {
            if (current) versions.push(current);
            if (versions.length >= maxVersions) break;
            current = {
                version: versionMatch[1],
                date: versionMatch[2],
                title: "",
                breaking: false,
                ajouts: [],
                correctifs: [],
                suppressions: [],
            };
            currentSection = null;
            continue;
        }
        if (current) currentSection = processLine(line, current, currentSection);
    }
    if (current && versions.length < maxVersions) versions.push(current);

    for (const v of versions) v.title = buildTitle(v.version, v.ajouts);
    return versions;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const SITE_ROOT = resolveSiteRoot();
    const LOGO_SRC = path.join(SITE_ROOT, "assets", "img", "geoleaf", "logo.png");
    const LOGO_DEST = path.join(DOCS_SRC, "public", "logo.png");
    const DEPLOY_TARGET = path.join(SITE_ROOT, "docs");
    const NEWS_JSON = path.join(SITE_ROOT, "assets", "data", "news.json");

    console.log("═══════════════════════════════════════════════");
    console.log("  GeoLeaf Docs Deploy Pipeline");
    console.log("═══════════════════════════════════════════════");
    console.log(`  Core    : ${CORE}`);
    console.log(`  Output  : ${BUILD_OUT}`);
    console.log(`  Site    : ${SITE_ROOT}  (GEOLEAF_DOCS_SITE_ROOT)`);
    console.log(`  Target  : ${DEPLOY_TARGET}  ⚠ supprimé puis réécrit`);
    console.log("═══════════════════════════════════════════════\n");

    // Step 1 — Regenerate TypeDoc
    console.log("── Step 1 : TypeDoc API reference ──────────────");
    run("npm run docs:api", CORE);
    console.log(`  ✓ TypeDoc output: ${TYPEDOC_OUT}`);

    // Step 2 — Copy api/ → public/api/ for VitePress static serving
    console.log("\n── Step 2 : Copy api/ → public/api/ ────────────");
    if (fs.existsSync(VITEPRESS_PUBLIC_API)) {
        fs.rmSync(VITEPRESS_PUBLIC_API, { recursive: true, force: true });
    }
    copyDir(TYPEDOC_OUT, VITEPRESS_PUBLIC_API);
    console.log(`  ✓ Copied ${countFiles(VITEPRESS_PUBLIC_API)} files to public/api/`);

    // Step 2b — Copy logo from the published site into docs/public/
    console.log("\n── Step 2b : Copy logo → docs/public/ ──────────");
    if (fs.existsSync(LOGO_SRC)) {
        fs.mkdirSync(path.dirname(LOGO_DEST), { recursive: true });
        fs.copyFileSync(LOGO_SRC, LOGO_DEST);
        console.log(`  ✓ Logo copied: ${LOGO_SRC} → ${LOGO_DEST}`);
    } else {
        console.warn(`  ⚠ Logo source not found, skipping: ${LOGO_SRC}`);
    }

    // Step 3 — Build VitePress
    console.log("\n── Step 3 : VitePress build ─────────────────────");
    run("npm run docs:build", CORE);
    console.log(`  ✓ Build output: ${BUILD_OUT} (${countFiles(BUILD_OUT)} files)`);

    // Step 4 — Sync to <site>/docs/
    // No prior `mkdirSync`: `syncDir` validates the source BEFORE touching the
    // target, and `copyDir` creates the destination. Creating the target upstream
    // amounted to preparing the ground for a deletion not yet authorised.
    console.log("\n── Step 4 : Sync to <site>/docs/ ───────────────");
    syncDir(BUILD_OUT, DEPLOY_TARGET);
    console.log(`  ✓ Deployed ${countFiles(DEPLOY_TARGET)} files to ${DEPLOY_TARGET}`);

    // Step 5 — Auto-generate news.json from CHANGELOG.md
    console.log("\n── Step 5 : Generate news.json ──────────────────");
    const patchnotes = parseChangelog(CHANGELOG_SRC);
    const newsData = {
        lastUpdated: new Date().toISOString().slice(0, 10),
        patchnotes,
    };
    fs.mkdirSync(path.dirname(NEWS_JSON), { recursive: true });
    fs.writeFileSync(NEWS_JSON, JSON.stringify(newsData, null, 2) + "\n", "utf-8");
    console.log(`  ✓ news.json updated (${patchnotes.length} versions) → ${NEWS_JSON}`);

    // ⚠️ A step 6 used to live here: `docs/CHANGELOG.md` →
    // `packages/core/CHANGELOG.md`, announced "(npm consumers)". It reached NO npm
    // consumer and was removed. Measured with `npm pack --dry-run -w @geoleaf/core`:
    // the tarball contains `docs/CHANGELOG.md` (174.2 KB) — i.e. the copy's SOURCE —
    // and no `CHANGELOG.md` at the package root. `files[]` lists `dist/`,
    // `README.md`, `docs/` and `LICENSE`; npm auto-adds only package.json, README
    // and LICENSE, not CHANGELOG. The written file was versioned noise: 35 KB, 0
    // referents.

    console.log("\n═══════════════════════════════════════════════");
    // The target is named, never assumed: "geoleaf.dev/docs/" was hard-coded here
    // and would have become false as soon as GEOLEAF_DOCS_SITE_ROOT pointed
    // elsewhere — precisely what has just been made possible.
    console.log(`  ✅ Deploy complete — ${DEPLOY_TARGET} updated`);
    console.log("═══════════════════════════════════════════════\n");
}

// ── Execution vs reading ─────────────────────────────────────────────────────
//
// This script is invoked by NO CI — not `ci-local.cjs`, not `ci.yml`, not the hook.
// It is launched by hand, rarely, and it is the repo's most destructive. Its most
// important fix (`syncDir`'s destroy/observe order) was thus guarded by nothing: it
// held only through manual mutations.
//
// The export closes that. `probe-gate-visibility.cjs` exercises `syncDir` and
// `resolveSiteRoot` on a temporary directory at every `ci:local`. Same gesture as
// for `ci-local.cjs`, for the same reason: a file that executes at import can be
// verified by nobody.
if (require.main === module) {
    try {
        main();
    } catch (err) {
        if (err instanceof DeployError) {
            console.error(`✘ deploy-docs : ${err.message}`);
            process.exit(1);
        }
        throw err;
    }
}

module.exports = { syncDir, resolveSiteRoot, DeployError };
