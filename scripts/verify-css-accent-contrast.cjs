#!/usr/bin/env node
"use strict";

/**
 * verify-css-accent-contrast.cjs — Text-on-accent contrast gate, for every published stylesheet.
 *
 * Fails when a rule paints its background with the theme accent (`--gl-color-accent`,
 * `--gl-color-accent-hover`) and writes on it a text colour that does not reach 4.5:1 — in ANY
 * theme (none, light, dark) under ANY palette the core declares.
 *
 * ── What it catches that nothing else does ────────────────────────────────────
 * `verify-css-tokens.cjs` judges that a token EXISTS, not that it can be READ on its background.
 * The defect is a pairing: `--gl-color-text-inverse`, `--gl-color-bg-surface` or a literal `#fff`
 * on an accent that the light theme makes pale — 1.39:1 on the primary button of the offline
 * window, green through every other gate. The theme declares the colour that reads on its
 * accent, `--gl-color-accent-contrast`; this gate is what holds a sheet to it, by computing the
 * ratio rather than by naming a forbidden token — half the faulty rules wrote a literal.
 *
 * ── How a theme context is resolved ───────────────────────────────────────────
 * Custom properties INHERIT: a declaration on `<body>` wins over one on `<html>` whatever the
 * specificity of either selector. The token blocks therefore stack by ELEMENT, not by cascade
 * order: `:root` then `:root[data-gl-palette]` on the root element, then `.gl-theme-*` and
 * `:root[data-gl-palette] .gl-theme-*` on the body. That is why a dark palette that does not
 * redeclare `--gl-color-accent-contrast` reads the base dark theme's, not its own root's.
 *
 * ── The reverse pairing: the accent AS a text colour ──────────────────────────
 * The accent is a FILL. Written as a text colour on a surface it fails in seven theme contexts
 * out of nine — 1.46:1 in the light theme, 2.80:1 with no theme class at all. Two rules:
 *
 *   · no rule may write `color: var(--gl-color-accent…)`. The text counterpart is
 *     `--gl-color-accent-text`, which each theme sets to what reads on ITS surfaces;
 *   · that token is computed, in every context, against the three backgrounds an accent text
 *     sits on: the surface, the muted surface, and the accent's own soft veil over the
 *     surface (the « active item » look).
 *
 * ── The accent as an outline ──────────────────────────────────────────────────
 * A focus ring is a graphical object that IS the sign of a state: 3:1 against its ground
 * (WCAG 1.4.11), where the accent reaches 1.46:1 in the light theme. No rule may write
 * `outline: … var(--gl-color-accent…)`; the ring is `--gl-color-focus-ring`, computed in every
 * context against the surface and the muted surface. The accent may stay as the FALLBACK of
 * that read, for a sheet loaded under an older core.
 *
 * ⚠️ BORDERS ARE NOT JUDGED. A border in the accent is a decoration as often as it is the only
 * sign of a state, and nothing in a stylesheet tells the two apart.
 *
 * ── What it does NOT judge, and prints ────────────────────────────────────────
 *   · a rule with an accent background and no text colour of its own, when the same selector
 *     without its state pseudo-classes declares none either — the text is carried by a child
 *     (a modal header and its title). An accessibility scan of the open surface covers that;
 *   · a text colour it cannot resolve to a literal (`inherit`, `currentColor`, `color-mix()`);
 *   · CSS written as a string in a `.ts` file — counted, not parsed.
 *
 * No baseline: the floor is a hard zero. A new violation is a new unreadable control.
 *
 * Usage:  node scripts/verify-css-accent-contrast.cjs
 */

const fs = require("fs");
const path = require("path");
const postcss = require("postcss");
const { all, ROOT } = require("./lib/packages.cjs");

const MIN_RATIO = 4.5;
const SKIP_DIR = new Set(["node_modules", "dist", "coverage", "docs", "__tests__", "__mocks__"]);
const ACCENT_BG_RE = /^var\(\s*(--gl-color-accent(?:-hover)?)\s*[,)]/;
const ACCENT_AS_TEXT_RE = /^var\(\s*--gl-color-accent\s*[,)]/;
const ACCENT_TEXT = "--gl-color-accent-text";
/** WCAG 1.4.11 — a graphical object that conveys a state, against what it is drawn on. */
const MIN_GRAPHIC_RATIO = 3;
const FOCUS_RING = "--gl-color-focus-ring";
/**
 * The FIRST token an outline reads. The accent nested as the fallback of another read
 * (`var(--gl-color-focus-ring, var(--gl-color-accent))`) is not the colour the outline takes.
 */
const FIRST_VAR_RE = /var\(\s*(--[\w-]+)/;
const TS_ACCENT_BG_RE = /background(?:-color)?\s*:\s*var\(\s*--gl-color-accent(?:-hover)?\s*[,)]/;
const STATE_PSEUDO_RE =
    /:(?:hover|focus-visible|focus-within|focus|active|not\([^)]*\)|disabled|enabled)/g;

/**
 * Recursively collect the files with a given extension under a package's `src/`.
 * @param {string} dir
 * @param {string} ext
 * @param {string[]} out
 */
function walk(dir, ext, out) {
    /** @type {import("fs").Dirent[]} */
    let ents;
    try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of ents) {
        if (e.isDirectory()) {
            if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name), ext, out);
        } else if (e.isFile() && e.name.endsWith(ext)) {
            out.push(path.join(dir, e.name));
        }
    }
}

/** @type {string[]} */
const cssFiles = [];
/** @type {string[]} */
const tsFiles = [];
for (const pkg of all()) {
    walk(path.join(pkg.absDir, "src"), ".css", cssFiles);
    walk(path.join(pkg.absDir, "src"), ".ts", tsFiles);
}

/** @param {string} f */
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

// ── Token blocks, keyed by the element they land on ───────────────────────────
/** @typedef {Record<string, string>} Tokens */
/** @type {{ root: Tokens, theme: Record<string, Tokens>, palettes: Record<string, { root: Tokens, theme: Record<string, Tokens> }> }} */
const blocks = { root: {}, theme: { light: {}, dark: {} }, palettes: {} };

const SEL_ROOT = /^:root$/;
const SEL_THEME = /^\.gl-theme-(light|dark)$/;
const SEL_PALETTE = /^:root\[data-gl-palette="([a-z0-9-]+)"\]$/;
const SEL_PALETTE_THEME = /^:root\[data-gl-palette="([a-z0-9-]+)"\]\s+\.gl-theme-(light|dark)$/;

/** @param {string} name */
function paletteBlock(name) {
    if (!blocks.palettes[name]) {
        blocks.palettes[name] = { root: {}, theme: { light: {}, dark: {} } };
    }
    return blocks.palettes[name];
}

/**
 * The token bag a selector feeds, or `null` when it is not a theme block.
 * @param {string} selector
 * @returns {Tokens | null}
 */
function bagFor(selector) {
    let m;
    if (SEL_ROOT.test(selector)) return blocks.root;
    if ((m = SEL_THEME.exec(selector))) return blocks.theme[m[1]];
    if ((m = SEL_PALETTE.exec(selector))) return paletteBlock(m[1]).root;
    if ((m = SEL_PALETTE_THEME.exec(selector))) return paletteBlock(m[1]).theme[m[2]];
    return null;
}

/** @param {import("postcss").Rule} rule */
function insideMedia(rule) {
    /** @type {import("postcss").Node | undefined} */
    let p = rule.parent;
    while (p) {
        if (p.type === "atrule" && /** @type {import("postcss").AtRule} */ (p).name === "media") {
            return true;
        }
        p = p.parent;
    }
    return false;
}

/** @type {Map<string, import("postcss").Root>} */
const parsed = new Map();
for (const f of cssFiles) {
    const root = postcss.parse(fs.readFileSync(f, "utf8"), { from: f });
    parsed.set(f, root);
    root.walkRules((rule) => {
        if (insideMedia(rule)) return;
        for (const selector of rule.selectors) {
            const bag = bagFor(selector.trim());
            if (!bag) continue;
            rule.walkDecls(/^--gl-/, (d) => {
                bag[d.prop] = d.value.trim();
            });
        }
    });
}

const paletteNames = Object.keys(blocks.palettes).sort();
if (!blocks.root["--gl-color-accent"] || !blocks.theme.dark["--gl-color-accent"]) {
    console.error(
        "❌ [CSS-ACCENT-CONTRAST] no theme block declares `--gl-color-accent` — the gate would judge nothing. The theme sheet moved or its selectors changed."
    );
    process.exit(1);
}
if (paletteNames.length === 0) {
    console.error(
        '❌ [CSS-ACCENT-CONTRAST] no `:root[data-gl-palette="…"]` block found — the palettes would go unjudged. Their selectors changed.'
    );
    process.exit(1);
}

/** @typedef {{ label: string, theme: string, tokens: Tokens }} Context */
/** @type {Context[]} */
const contexts = [];
for (const palette of [null, ...paletteNames]) {
    for (const theme of ["none", "light", "dark"]) {
        const p = palette ? blocks.palettes[palette] : null;
        contexts.push({
            label: `${palette ?? "default"}/${theme}`,
            theme,
            tokens: {
                ...blocks.root,
                ...(p ? p.root : {}),
                ...(theme === "none" ? {} : blocks.theme[theme]),
                ...(p && theme !== "none" ? p.theme[theme] : {}),
            },
        });
    }
}

// ── Colour resolution ─────────────────────────────────────────────────────────
/** @typedef {[number, number, number, number]} Rgba */
/** @type {Record<string, Rgba>} */
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };

/**
 * Split `var(--x, fallback)` into its name and its fallback, honouring nested parentheses.
 * @param {string} value
 * @returns {{ name: string, fallback: string | null } | null}
 */
function parseVar(value) {
    const m = /^var\(\s*(--[a-z0-9-]+)\s*/i.exec(value);
    if (!m || !value.endsWith(")")) return null;
    const rest = value.slice(m[0].length, -1).trim();
    if (rest === "") return { name: m[1], fallback: null };
    if (!rest.startsWith(",")) return null;
    return { name: m[1], fallback: rest.slice(1).trim() };
}

/**
 * Resolve a CSS colour value to RGBA in a theme context, or `null` when it is not a literal.
 * @param {string} raw
 * @param {Tokens} tokens
 * @param {number} [depth]
 * @returns {Rgba | null}
 */
function resolveColor(raw, tokens, depth = 0) {
    const value = raw.replace(/\s*!important\s*$/, "").trim();
    if (depth > 8) return null;
    const lower = value.toLowerCase();
    if (NAMED[lower]) return NAMED[lower];
    let m;
    if ((m = /^#([0-9a-f]{3,8})$/.exec(lower))) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
        if (h.length !== 6 && h.length !== 8) return null;
        const n = (/** @type {number} */ i) => parseInt(h.slice(i, i + 2), 16);
        return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
    }
    if ((m = /^rgba?\(([^)]+)\)$/.exec(lower))) {
        const parts = m[1].split(/[\s,/]+/).filter(Boolean);
        if (parts.length < 3 || parts.some((p) => !/^[\d.]+%?$/.test(p))) return null;
        const alpha =
            parts[3] === undefined
                ? 1
                : parts[3].endsWith("%")
                  ? parseFloat(parts[3]) / 100
                  : parseFloat(parts[3]);
        return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]), alpha];
    }
    const v = parseVar(value);
    if (v) {
        const hit = tokens[v.name];
        if (hit !== undefined) return resolveColor(hit, tokens, depth + 1);
        if (v.fallback !== null) return resolveColor(v.fallback, tokens, depth + 1);
    }
    return null;
}

/** @param {Rgba} fg @param {Rgba} bg @returns {Rgba} */
function over(fg, bg) {
    const a = fg[3];
    return [
        fg[0] * a + bg[0] * (1 - a),
        fg[1] * a + bg[1] * (1 - a),
        fg[2] * a + bg[2] * (1 - a),
        1,
    ];
}

/** @param {Rgba} c */
function luminance(c) {
    const ch = (/** @type {number} */ v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

/** @param {Rgba} fg @param {Rgba} bg */
function contrast(fg, bg) {
    const a = luminance(over(fg, bg));
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ── Judging ───────────────────────────────────────────────────────────────────
/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const unjudged = [];
let judgedRules = 0;
let judgedPairs = 0;

/**
 * The value of a rule's own declaration of `prop` (last one wins), or `null`.
 * @param {import("postcss").Rule} rule
 * @param {string[]} props
 */
function ownDecl(rule, props) {
    /** @type {string | null} */
    let found = null;
    rule.each((node) => {
        if (node.type === "decl" && props.includes(node.prop)) found = node.value.trim();
    });
    return found;
}

for (const [file, root] of parsed) {
    /** Text colour by exact selector, for the rules that inherit it from their resting state. */
    /** @type {Map<string, string>} */
    const colorBySelector = new Map();
    root.walkRules((rule) => {
        const color = ownDecl(rule, ["color"]);
        if (color === null) return;
        for (const s of rule.selectors) colorBySelector.set(s.trim(), color);
    });

    root.walkRules((rule) => {
        const bg = ownDecl(rule, ["background", "background-color"]);
        if (bg === null) return;
        const bgToken = ACCENT_BG_RE.exec(bg);
        if (!bgToken) return;
        const where = `${rel(file)}:${rule.source?.start?.line ?? 0}`;
        const ownColor = ownDecl(rule, ["color"]);

        for (const rawSelector of rule.selectors) {
            const selector = rawSelector.trim();
            const resting = selector.replace(STATE_PSEUDO_RE, "").trim();
            const color = ownColor ?? colorBySelector.get(resting) ?? null;
            if (color === null) {
                unjudged.push(`${where}  ${selector} — no text colour on the rule`);
                continue;
            }
            const only = /\.gl-theme-dark\b/.test(selector)
                ? "dark"
                : /\.gl-theme-light\b/.test(selector)
                  ? "light"
                  : null;
            let judged = false;
            for (const ctx of contexts) {
                if (only && ctx.theme !== only) continue;
                const bgRgba = resolveColor(`var(${bgToken[1]})`, ctx.tokens);
                const fgRgba = resolveColor(color, ctx.tokens);
                if (!bgRgba || !fgRgba) continue;
                judged = true;
                judgedPairs++;
                const ratio = contrast(fgRgba, bgRgba);
                if (ratio < MIN_RATIO) {
                    violations.push(
                        `${where}  ${selector}\n      ${color} on ${bgToken[1]} — ${ratio.toFixed(2)}:1 under ${ctx.label}`
                    );
                }
            }
            if (judged) judgedRules++;
            else unjudged.push(`${where}  ${selector} — text colour \`${color}\` is not a literal`);
        }
    });
}

// ── The accent as a text colour ───────────────────────────────────────────────
let accentTextReads = 0;
for (const [file, root] of parsed) {
    root.walkDecls("color", (d) => {
        const value = d.value.trim();
        if (value.startsWith(`var(${ACCENT_TEXT}`)) accentTextReads++;
        if (!ACCENT_AS_TEXT_RE.test(value)) return;
        const rule = /** @type {import("postcss").Rule} */ (d.parent);
        violations.push(
            `${rel(file)}:${d.source?.start?.line ?? 0}  ${rule.selector?.split("\n").join(" ") ?? "?"}\n      the accent is written as a TEXT colour — read \`var(${ACCENT_TEXT})\`, the accent is a fill`
        );
    });
}
let accentTextPairs = 0;
for (const ctx of contexts) {
    const fg = resolveColor(`var(${ACCENT_TEXT})`, ctx.tokens);
    if (!fg) {
        violations.push(
            `theme context ${ctx.label}\n      \`${ACCENT_TEXT}\` is not declared, or not a literal`
        );
        continue;
    }
    const surface = resolveColor("var(--gl-color-bg-surface)", ctx.tokens);
    const muted = resolveColor("var(--gl-color-bg-surface-muted)", ctx.tokens);
    const soft = resolveColor("var(--gl-color-accent-soft)", ctx.tokens);
    /** @type {Array<[string, Rgba | null]>} */
    const grounds = [
        ["--gl-color-bg-surface", surface],
        ["--gl-color-bg-surface-muted", muted],
        ["--gl-color-accent-soft over the surface", soft && surface ? over(soft, surface) : null],
    ];
    for (const [name, bg] of grounds) {
        if (!bg) {
            violations.push(`theme context ${ctx.label}\n      \`${name}\` does not resolve`);
            continue;
        }
        accentTextPairs++;
        const ratio = contrast(fg, bg);
        if (ratio < MIN_RATIO) {
            violations.push(
                `theme context ${ctx.label}\n      \`${ACCENT_TEXT}\` on ${name} — ${ratio.toFixed(2)}:1`
            );
        }
    }
}

// ── The accent as an outline ────────────────────────────────────────────────
// An outline is the ring a focused or targeted control is drawn with: a graphical object that
// IS the sign of a state, held to 3:1 against what it is drawn on. The accent, a fill, reaches
// 1.46:1 on the light theme's surface. `--gl-color-focus-ring` is the token every theme sets
// for that job; a sheet may keep the accent as the FALLBACK of that read, for an older core.
let focusRingReads = 0;
for (const [file, root] of parsed) {
    root.walkDecls(/^outline(-color)?$/, (d) => {
        const value = d.value.trim();
        if (value.includes(`var(${FOCUS_RING}`)) focusRingReads++;
        if (FIRST_VAR_RE.exec(value)?.[1] !== "--gl-color-accent") return;
        const rule = /** @type {import("postcss").Rule} */ (d.parent);
        violations.push(
            `${rel(file)}:${d.source?.start?.line ?? 0}  ${rule.selector?.split("\n").join(" ") ?? "?"}\n      the accent is written as an OUTLINE — read \`var(${FOCUS_RING}, …)\`, the ring each theme sets to be seen on its surfaces`
        );
    });
}
let focusRingPairs = 0;
for (const ctx of contexts) {
    const ring = resolveColor(`var(${FOCUS_RING})`, ctx.tokens);
    if (!ring) {
        violations.push(
            `theme context ${ctx.label}\n      \`${FOCUS_RING}\` is not declared, or not a literal`
        );
        continue;
    }
    for (const name of ["--gl-color-bg-surface", "--gl-color-bg-surface-muted"]) {
        const bg = resolveColor(`var(${name})`, ctx.tokens);
        if (!bg) {
            violations.push(`theme context ${ctx.label}\n      \`${name}\` does not resolve`);
            continue;
        }
        focusRingPairs++;
        const ratio = contrast(ring, bg);
        if (ratio < MIN_GRAPHIC_RATIO) {
            violations.push(
                `theme context ${ctx.label}\n      \`${FOCUS_RING}\` on ${name} — ${ratio.toFixed(2)}:1, under ${MIN_GRAPHIC_RATIO}:1`
            );
        }
    }
}

const tsOutOfScope = tsFiles.filter((f) => TS_ACCENT_BG_RE.test(fs.readFileSync(f, "utf8")));

const line = "─".repeat(72);
console.log(line);
if (judgedRules === 0) {
    console.error(
        "❌ [CSS-ACCENT-CONTRAST] no rule with an accent background was judged — the gate reads nothing. Check the accent token names."
    );
    console.log(line);
    process.exit(1);
}
const scope = `${cssFiles.length} sheet(s), ${judgedRules} accent surface(s), ${contexts.length} theme context(s) (${contexts.map((c) => c.label).join(", ")}), ${judgedPairs} pair(s) computed`;
if (violations.length > 0) {
    console.error(
        `❌ [CSS-ACCENT-CONTRAST] ${violations.length} defect(s) — a text under ${MIN_RATIO}:1, or the accent used as a text colour`
    );
    for (const v of violations) console.error(`  ❌ ${v}`);
    console.error(
        "\n    Pair an accent background with `var(--gl-color-accent-contrast)`. If the pair fails in ONE\n    context only, the theme block of that context is missing the token."
    );
} else {
    console.log(
        `✅ [CSS-ACCENT-CONTRAST] every text on an accent background and the accent's text colour on every surface reach ${MIN_RATIO}:1, every focus ring ${MIN_GRAPHIC_RATIO}:1`
    );
}
console.log(`    ${scope}`);
console.log(
    `    \`${ACCENT_TEXT}\` : read by ${accentTextReads} declaration(s), computed on ${accentTextPairs} ground(s) across the contexts`
);
console.log(
    `    \`${FOCUS_RING}\` : read by ${focusRingReads} outline(s), computed on ${focusRingPairs} ground(s) at ${MIN_GRAPHIC_RATIO}:1`
);
if (unjudged.length > 0) {
    console.log(`    ↳ not judged (${unjudged.length}) — text carried elsewhere than the rule:`);
    for (const u of unjudged) console.log(`        ${u}`);
}
if (tsOutOfScope.length > 0) {
    console.log(
        `    ↳ out of scope: ${tsOutOfScope.length} \`.ts\` file(s) write an accent background in a CSS string — ${tsOutOfScope.map(rel).join(", ")}`
    );
}
console.log(line);
process.exit(violations.length > 0 ? 1 : 0);
