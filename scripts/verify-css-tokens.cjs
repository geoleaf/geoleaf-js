#!/usr/bin/env node
"use strict";

/**
 * verify-css-tokens.cjs — Undefined-CSS-variable gate for the plugin zone (PLUGINS S10).
 *
 * Fails when a plugin/lib stylesheet references `var(--gl-…)` for a token that NO
 * stylesheet defines and that NO code sets at runtime. This is the defect class
 * PLUGINS S4, S7 and S10 each found by hand: an undefined custom property silently
 * resolves to its hard-coded fallback, so the declaration is invisible to the
 * theme system — dead in dark mode, dead under the alt themes — or, when written
 * without a fallback, drops out of the cascade entirely (a `box-shadow` that never
 * paints, an orange button that turns blue on hover). None of it errors; none of
 * it is caught by typecheck, lint or the dead-CSS gate.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 * DEFINITIONS are collected from EVERY workspace stylesheet, so a plugin may
 * legitimately consume a token the core theme defines (`geoleaf-theme.css`).
 * REFERENCES are checked only under `packages/plugins/**` and `packages/libs/**`
 * — the zone this sprint owns and has cleaned. Core's own stylesheets are NOT yet
 * clean of this defect (~13 refs under `core/src/capabilities/**` as of S10, e.g.
 * `--gl-color-text-primary`, `--gl-shadow-strong`, `--gl-color-bg-alt`): that is
 * the CAPACITÉS zone. Add `path.join(PKG, "core")` to REF_ROOTS once those are
 * resolved, and the gate widens with no other change.
 *
 * ── Runtime-set allowlist ────────────────────────────────────────────────────
 * A handful of tokens are written by JS via `element.style.setProperty()` and so
 * appear in no stylesheet by design (drag positions, dynamic max-heights). Each
 * entry below MUST cite its write site — the SAME doctrine as the purgecss
 * safelist: the criterion is the assignment site, not "the tool currently
 * complains". If you cannot cite a `setProperty` call, the reference is a typo,
 * not a runtime token, and it does not belong here.
 *
 * No baseline: PLUGINS S10 chantier B drove the plugin zone to zero undefined
 * refs, so the floor is a hard zero, not a frozen set. A new violation is a new
 * bug — fix the token name or add a *cited* runtime-set entry.
 *
 * Usage:  node scripts/verify-css-tokens.cjs
 */

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./lib/packages.cjs");

/**
 * Tokens written at runtime by JS; each cites its production `setProperty` site.
 *
 * ⚠️ These citations are PROSE — this script does not resolve them, so nothing
 * keeps them from rotting. They still carried the removed `plugin-` prefix and
 * stale line numbers; fixed on 2026-07-25. Re-verify them by hand when touching
 * one of the cited sites.
 */
const RUNTIME_SET = {
    "--gl-measure-top": "packages/plugins/measure/src/floating-menu.ts:206",
    "--gl-measure-left": "packages/plugins/measure/src/floating-menu.ts:207",
    "--gl-measure-max-h": "packages/plugins/measure/src/floating-menu.ts:337",
    // ALL FOUR edges, now. `_applyPosition` sets them through a template-literal
    // helper (`--gl-editor-${edge}`, floating-menu.ts), hence INVISIBLE to a
    // literal grep: this table carries the knowledge, not the code.
    "--gl-editor-top":
        "packages/plugins/editor/src/sub-menu/floating-menu.ts:241, :509 (+ host-runtime/src/ui/drag.ts:66)",
    "--gl-editor-left":
        "packages/plugins/editor/src/sub-menu/floating-menu.ts:242, :511 (+ host-runtime/src/ui/drag.ts:65)",
    "--gl-editor-right": "packages/plugins/editor/src/sub-menu/floating-menu.ts:243, :512",
    "--gl-editor-bottom": "packages/plugins/editor/src/sub-menu/floating-menu.ts:244, :510",
};

const PKG = path.join(ROOT, "packages");
const SKIP_DIR = new Set(["node_modules", "dist", "coverage", "docs"]);

/** Recursively collect `src/**​/*.css` under a directory, skipping generated trees. */
function walkCss(dir, out) {
    let ents;
    try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of ents) {
        if (e.isDirectory()) {
            if (!SKIP_DIR.has(e.name)) walkCss(path.join(dir, e.name), out);
        } else if (e.isFile() && e.name.endsWith(".css")) {
            out.push(path.join(dir, e.name));
        }
    }
}

/** Blank out `/* … *​/` comment bodies while KEEPING newlines, so line numbers
 *  and token references inside prose do not reach the scanners. */
function blankComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

const allCss = [];
walkCss(PKG, allCss);
const srcCss = allCss.filter((f) => f.includes(`${path.sep}src${path.sep}`));

// ── Definitions: every `--gl-x:` assignment, across ALL workspace src CSS ──────
const defined = new Set();
const DEF_RE = /(--gl-[a-z0-9-]+)\s*:/gi;
for (const f of srcCss) {
    const css = blankComments(fs.readFileSync(f, "utf8"));
    let m;
    while ((m = DEF_RE.exec(css))) defined.add(m[1].toLowerCase());
}

// ── References: `var(--gl-x` under plugins/ + libs/ only ───────────────────────
const REF_ROOTS = [path.join(PKG, "plugins"), path.join(PKG, "libs")];
const inRefScope = (f) => REF_ROOTS.some((r) => f.startsWith(r + path.sep));
const REF_RE = /var\(\s*(--gl-[a-z0-9-]+)/gi;

const violations = [];
for (const f of srcCss) {
    if (!inRefScope(f)) continue;
    const lines = blankComments(fs.readFileSync(f, "utf8")).split("\n");
    lines.forEach((line, i) => {
        let m;
        REF_RE.lastIndex = 0;
        while ((m = REF_RE.exec(line))) {
            const tok = m[1].toLowerCase();
            if (defined.has(tok) || RUNTIME_SET[tok]) continue;
            violations.push({ file: path.relative(ROOT, f), line: i + 1, tok });
        }
    });
}

if (violations.length > 0) {
    console.error(
        `✖ verify-css-tokens : ${violations.length} référence(s) à une variable CSS --gl-* ni définie ni posée au runtime.\n`
    );
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  →  var(${v.tok})`);
    }
    console.error(
        "\n  Une variable indéfinie retombe silencieusement sur son fallback en dur :\n" +
            "  la déclaration devient insensible au thème (morte en dark et sous les thèmes alt),\n" +
            "  ou disparaît si aucun fallback n'est fourni. Corriger le NOM du token (l'aligner\n" +
            "  sur un token réel de geoleaf-theme.css), OU — si la variable est bien posée par du\n" +
            "  JS via setProperty() — l'ajouter à RUNTIME_SET dans ce script AVEC sa citation.\n"
    );
    process.exit(1);
}

console.log(
    `✔ verify-css-tokens : aucune variable --gl-* indéfinie dans plugins/ + libs/ ` +
        `(${defined.size} tokens définis, ${Object.keys(RUNTIME_SET).length} posés au runtime, ` +
        `${srcCss.filter(inRefScope).length} feuilles vérifiées).`
);
