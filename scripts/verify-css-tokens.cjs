#!/usr/bin/env node
"use strict";

/**
 * verify-css-tokens.cjs — Undefined-CSS-variable gate, for every published stylesheet.
 *
 * Fails when a stylesheet of the core, a plugin or a lib references `var(--gl-…)` for a token
 * that NO stylesheet defines, that NO code sets at runtime and that is no declared host hook. This is the defect class
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
 * REFERENCES are checked under the plugins, the libs — and, since 05/10/2026, the CORE.
 * It was left out when the gate was written, on an estimate of ~13 references; measured, it
 * held 23, of 16 tokens, in 10 sheets, 4 of them with no fallback at all — declarations that
 * simply dropped. They were sorted by one rule, and the gate now carries its three exits:
 *
 *   · set by JS → `RUNTIME_SET`, with its `setProperty` site;
 *   · left for the HOST to define → `HOST_HOOKS`, with the public page that says so — and the
 *     read must carry a fallback, since most hosts define nothing;
 *   · anything else → the reference is realigned on a name the theme defines, the way the
 *     plugin zone was. Two had no equivalent in the theme (a radius, a shadow): they are
 *     written as the literal they always resolved to, which is what they were.
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
    // The form overlay pinned to the visual viewport — all four written by one `sync()`.
    "--gl-form-viewport-top": "packages/libs/field-renderer/src/ui/visual-viewport.ts:65",
    "--gl-form-viewport-left": "packages/libs/field-renderer/src/ui/visual-viewport.ts:66",
    "--gl-form-viewport-width": "packages/libs/field-renderer/src/ui/visual-viewport.ts:67",
    "--gl-form-viewport-height": "packages/libs/field-renderer/src/ui/visual-viewport.ts:68",
    // The proximity bar, on the mobile layout: set on the main container while the bar is
    // shown, removed with it — the theme selector's offset reads them with a `0px` fallback.
    "--gl-proximity-bar-height":
        "packages/core/src/kernel/ui/mobile/mobile-toolbar-proximity.ts:203",
    "--gl-proximity-bar-gap": "packages/core/src/kernel/ui/mobile/mobile-toolbar-proximity.ts:204",
};

/**
 * Tokens the library READS and deliberately never defines: a host that sets one overrides a
 * default the library already has. Each entry names the PUBLIC page that tells the host so.
 *
 * 🛑 Unlike the citations of `RUNTIME_SET`, these are RESOLVED: the gate reads the page and
 * turns red if the token is no longer written there. A hook nobody is told about is not a
 * hook, it is an undefined variable with a story.
 *
 * ⚠️ And every read of a hook must carry a fallback (`var(--hook, …)`): the host that defines
 * nothing is the common case, and without one the declaration drops out of the cascade.
 *
 * @type {Record<string, string>}
 */
const HOST_HOOKS = {
    // Text on the accent. The themes set `--gl-color-accent-contrast`; a host that wants
    // another colour on its buttons defines this one, and the three reads fall back otherwise.
    "--gl-color-on-accent": "packages/core/docs/CHANGELOG.md",
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

// ── References: `var(--gl-x` under plugins/ + libs/ + the core ─────────────────
// The core by the registry, which THROWS if the package moves: a root that stopped matching
// would leave the gate green over nothing.
const REF_ROOTS = [
    path.join(PKG, "plugins"),
    path.join(PKG, "libs"),
    require("./lib/packages.cjs").requireByDirName("core").absDir,
];
const inRefScope = (f) => REF_ROOTS.some((r) => f.startsWith(r + path.sep));
const REF_RE = /var\(\s*(--gl-[a-z0-9-]+)/gi;

const violations = [];
/** @type {Array<{file: string, line: number, tok: string, fallback: boolean}>} */
const hookReads = [];
for (const f of srcCss) {
    if (!inRefScope(f)) continue;
    const lines = blankComments(fs.readFileSync(f, "utf8")).split("\n");
    lines.forEach((line, i) => {
        let m;
        REF_RE.lastIndex = 0;
        while ((m = REF_RE.exec(line))) {
            const tok = m[1].toLowerCase();
            if (defined.has(tok) || RUNTIME_SET[tok]) continue;
            if (HOST_HOOKS[tok]) {
                hookReads.push({
                    file: path.relative(ROOT, f),
                    line: i + 1,
                    tok,
                    // `var(--hook, …)`: what follows the name is a comma, not the closing paren.
                    fallback: /^\s*,/.test(line.slice(REF_RE.lastIndex)),
                });
                continue;
            }
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
            "  JS via setProperty() — l'ajouter à RUNTIME_SET dans ce script AVEC sa citation, OU —\n" +
            "  si elle est laissée à l'hôte — à HOST_HOOKS avec la page publique qui le lui dit.\n"
    );
    process.exit(1);
}

// ── Host hooks: declared in public, read with a fallback, and still read at all ─
const hookErrors = [];
for (const [tok, page] of Object.entries(HOST_HOOKS)) {
    const abs = path.join(ROOT, page);
    if (!fs.existsSync(abs) || !fs.readFileSync(abs, "utf8").includes(tok)) {
        hookErrors.push(
            `${tok} — déclaré crochet d'hôte, mais \`${page}\` ne le nomme pas (ou n'existe ` +
                `plus) : un crochet que personne n'annonce à l'hôte est une variable indéfinie.`
        );
    }
    if (defined.has(tok)) {
        hookErrors.push(
            `${tok} — déclaré crochet d'hôte ET défini par une feuille : il n'est plus laissé à ` +
                `l'hôte. Le retirer de HOST_HOOKS.`
        );
    }
    // (a hook a sheet defines is not tracked as read — it is already reported above)
    if (!defined.has(tok) && !hookReads.some((r) => r.tok === tok)) {
        hookErrors.push(`${tok} — déclaré crochet d'hôte, lu par aucune feuille : entrée périmée.`);
    }
}
for (const r of hookReads) {
    if (!r.fallback) {
        hookErrors.push(
            `${r.file}:${r.line} — lit le crochet d'hôte ${r.tok} SANS repli : chez l'hôte qui ne ` +
                `le définit pas, la déclaration sort de la cascade.`
        );
    }
}
if (hookErrors.length > 0) {
    console.error(
        `✖ verify-css-tokens : ${hookErrors.length} défaut(s) sur les crochets d'hôte.\n`
    );
    for (const e of hookErrors) console.error(`  ${e}`);
    process.exit(1);
}

console.log(
    `✔ verify-css-tokens : aucune variable --gl-* indéfinie dans le cœur, plugins/ et libs/ ` +
        `(${defined.size} tokens définis, ${Object.keys(RUNTIME_SET).length} posés au runtime, ` +
        `${Object.keys(HOST_HOOKS).length} crochet(s) d'hôte lu(s) ${hookReads.length} fois, ` +
        `${srcCss.filter(inRefScope).length} feuilles vérifiées).`
);
