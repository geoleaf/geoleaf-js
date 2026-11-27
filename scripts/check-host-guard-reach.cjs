#!/usr/bin/env node
/**
 * check-host-guard-reach.cjs — HGR: no plugin or lib rule loses its field colours to the
 * core's host guard.
 *
 * ## The defect class
 *
 * The core's host guard (`src/css/geoleaf-host-guard.css`) is UNLAYERED on purpose: it writes
 * `color` and `background: revert-layer` on every GeoLeaf field, which drops every unlayered
 * declaration of those properties and hands them back to the `gl.*` layers. That is right for
 * the core, whose sheets live in those layers. It is wrong for a plugin or a lib: their sheets
 * are adopted OUTSIDE the layers (`csp-style-inject.mjs`), so between the guard and them
 * specificity decides. A plugin rule at the guard's specificity or below loses; no layer
 * styles the plugin's field; the browser's own grey and white come back — over a black panel
 * in the dark theme. Nothing errors, every unit test passes (jsdom computes no cascade), and
 * the defect is only seen in a browser, in the dark theme.
 *
 * ## What this catches that nothing else does
 *
 * `verify-css-tokens` checks that a `var(--gl-*)` EXISTS, `verify-css-accent-contrast` that a
 * text reads on its accent, CCO that a class is owned: none of them computes a cascade between
 * two sheets. This gate does, for the one pair of unlayered sheets where it matters.
 *
 * ## How it reads
 *
 * - The guard is READ, never copied: its reverted properties, the fields it targets (the
 *   element names inside its selector) and its specificity come from the core's sheet. A
 *   stronger guard turns this gate red instead of leaving it green on a stale figure.
 * - Which classes sit on a field is DERIVED from the sources of every workspace package: a
 *   class literal passed with `"input" | "select" | "textarea"` to an element factory, or set
 *   (`className`, `classList.add`) on a variable created as one. The count is printed; zero
 *   is a blind instrument and fails.
 * - Every unlayered rule of every NON-core package sheet whose subject names such a class (or
 *   the field element with a guard-matching class) and sets a reverted property, without
 *   `!important`, must outrank the guard. Equal counts as lost: which of two equal rules wins
 *   depends on adoption order, which no sheet controls.
 *
 * The core is out of scope by construction: its sheets are imported into `gl.*` layers by
 * `geoleaf-main.css`, and handing a field back to those layers is the guard's purpose.
 *
 * Fix of a hit: raise ONLY the reverted declarations into a rule that outranks the guard
 * (e.g. scoped under the component's root), so the cascade of the other properties — and of
 * their `!important` — does not move.
 *
 * Usage:  node scripts/check-host-guard-reach.cjs
 * Exit 0 = no rule reverted by the guard, 1 = violations, 2 = instrument blind.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");
const registry = require("./lib/packages.cjs");

const { ROOT } = registry;
const SKIP_DIR = new Set(["node_modules", "dist", "coverage", ".turbo", "__tests__", "__mocks__"]);
const SOURCE_RE = /\.(?:[cm]?[jt]s)$/;
const TEST_RE = /\.(?:test|spec)\.[cm]?[jt]s$/;

/** @typedef {[number, number, number]} Specificity */

/**
 * @param {Specificity} a
 * @param {Specificity} b
 * @returns {number}
 */
function compare(a, b) {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Splits a selector list on top-level commas only, so `:is(a, b)` stays whole.
 * @param {string} list
 * @returns {string[]}
 */
function splitList(list) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < list.length; i++) {
        const ch = list[i];
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        else if (ch === "," && depth === 0) {
            parts.push(list.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(list.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * @param {string} selector
 * @param {number} from
 * @param {string} open
 * @param {string} close
 * @returns {number}
 */
function closing(selector, from, open, close) {
    let depth = 0;
    for (let j = from; j < selector.length; j++) {
        if (selector[j] === open) depth++;
        else if (selector[j] === close && --depth === 0) return j;
    }
    throw new Error(`unbalanced selector: ${selector}`);
}

/**
 * @param {string} list
 * @returns {Specificity}
 */
function maxOf(list) {
    /** @type {Specificity} */
    let best = [0, 0, 0];
    for (const s of splitList(list).map(specificity)) if (compare(s, best) > 0) best = s;
    return best;
}

/**
 * Selector specificity (Selectors Level 4: `:is`/`:not`/`:has` take their strongest argument,
 * `:where` counts zero, legacy one-colon pseudo-elements count as elements).
 * @param {string} selector
 * @returns {Specificity}
 */
function specificity(selector) {
    /** @type {Specificity} */
    const s = [0, 0, 0];
    let i = 0;
    while (i < selector.length) {
        const ch = selector[i];
        if (ch === "#") {
            s[0]++;
            i++;
        } else if (ch === ".") {
            s[1]++;
            i++;
        } else if (ch === "[") {
            s[1]++;
            i = closing(selector, i, "[", "]") + 1;
            continue;
        } else if (ch === ":") {
            const pseudoElement = selector[i + 1] === ":";
            const name = (/^::?([a-zA-Z-]+)/.exec(selector.slice(i))?.[1] ?? "").toLowerCase();
            i += (pseudoElement ? 2 : 1) + name.length;
            let args = null;
            if (selector[i] === "(") {
                const end = closing(selector, i, "(", ")");
                args = selector.slice(i + 1, end);
                i = end + 1;
            }
            if (pseudoElement || ["before", "after", "first-line", "first-letter"].includes(name))
                s[2]++;
            else if (name === "where") {
                /* zero */
            } else if (["is", "not", "has", "matches"].includes(name) && args !== null) {
                const t = maxOf(args);
                s[0] += t[0];
                s[1] += t[1];
                s[2] += t[2];
            } else s[1]++;
            continue;
        } else if (/[a-zA-Z*]/.test(ch)) {
            const word = (/^[a-zA-Z][\w-]*|^\*/.exec(selector.slice(i)) ?? ["*"])[0];
            if (word !== "*") s[2]++;
            i += word.length;
            continue;
        }
        // The rest of a class or id name, or one combinator / whitespace character.
        const from = i;
        while (i < selector.length && /[\w-]/.test(selector[i])) i++;
        if (i === from) i++;
    }
    return s;
}

/**
 * The subject compound of a complex selector: what follows its last top-level combinator.
 * @param {string} selector
 * @returns {string}
 */
function subjectOf(selector) {
    let depth = 0;
    let cut = 0;
    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i];
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        else if (depth === 0 && /[\s>+~]/.test(ch)) cut = i + 1;
    }
    return selector.slice(cut).trim();
}

/**
 * Classes and element name of a compound, ignoring what sits inside a functional pseudo-class
 * (`:not(.x)` does not put `.x` on the element).
 * @param {string} compound
 * @returns {{ element: string | null, classes: string[] }}
 */
function readCompound(compound) {
    let flat = "";
    let depth = 0;
    for (const ch of compound) {
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        else if (depth === 0) flat += ch;
    }
    const element = /^[a-zA-Z][\w-]*/.exec(flat)?.[0]?.toLowerCase() ?? null;
    const classes = [...flat.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    return { element, classes };
}

/**
 * @param {import("postcss").Node} node
 * @returns {boolean}
 */
function isLayeredOrKeyframe(node) {
    for (let p = node.parent; p && p.type !== "root"; p = p.parent) {
        if (p.type === "atrule") {
            const name = /** @type {import("postcss").AtRule} */ (p).name;
            if (name === "layer" || /keyframes$/.test(name)) return true;
        }
    }
    return false;
}

/**
 * @param {string} dir
 * @param {(name: string) => boolean} keep
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(dir, keep, out) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name), keep, out);
        } else if (e.isFile() && keep(e.name)) out.push(path.join(dir, e.name));
    }
    return out;
}

/** @param {string} abs */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

// ─── 1. The guard, read from the core's sheet ───────────────────────────────────────────────

const core = registry.byName("@geoleaf/core");
if (!core) throw new Error("check-host-guard-reach: @geoleaf/core is not a workspace package.");
const GUARD_SHEET = path.join(core.absDir, "src", "css", "geoleaf-host-guard.css");
if (!fs.existsSync(GUARD_SHEET)) {
    console.error(`✖ HGR — feuille de garde introuvable : ${rel(GUARD_SHEET)}`);
    process.exit(2);
}

/** @type {{ elements: Set<string>, prefix: string, props: Set<string>, sp: Specificity } | null} */
let guard = null;
/** @type {{ classes: string[], props: Set<string>, sp: Specificity }[]} */
const classGuards = [];

postcss.parse(fs.readFileSync(GUARD_SHEET, "utf8"), { from: GUARD_SHEET }).walkRules((rule) => {
    if (isLayeredOrKeyframe(rule)) return;
    const props = new Set();
    rule.walkDecls((d) => {
        if (d.value.trim() === "revert-layer") props.add(d.prop.toLowerCase());
    });
    if (props.size === 0) return;
    for (const sel of rule.selectors) {
        const fields = [...sel.matchAll(/\b(select|input|textarea|button)\b/g)].map((m) => m[1]);
        const prefix = /\[class\^="([\w-]+)"\]/.exec(sel)?.[1];
        const sp = specificity(sel);
        if (fields.length > 0 && prefix) {
            if (!guard || compare(sp, guard.sp) > 0)
                guard = { elements: new Set(fields), prefix, props, sp };
        } else if (/^\.[\w.-]+$/.test(sel.trim())) {
            classGuards.push({ classes: readCompound(sel.trim()).classes, props, sp });
        }
    }
});

if (!guard) {
    console.error(
        `✖ HGR — aucune règle de champ en revert-layer lue dans ${rel(GUARD_SHEET)} : ` +
            "l'instrument ne sait plus ce que la garde annule."
    );
    process.exit(2);
}
const FIELD_GUARD = guard;

/**
 * Does the guard revert this property? `background` reverts every `background-*` longhand.
 * @param {Set<string>} props
 * @param {string} prop
 * @returns {boolean}
 */
function reverted(props, prop) {
    const p = prop.toLowerCase();
    if (props.has(p)) return true;
    return props.has("background") && p.startsWith("background-");
}

// ─── 2. Which classes sit on a field, derived from the sources ──────────────────────────────

const FIELD_ALT = [...FIELD_GUARD.elements].join("|");
// `factory("input", "gl-a gl-b", …)` and `factory("input", { className: "gl-a" })`.
const FACTORY_RE = new RegExp(
    `\\(\\s*["'](${FIELD_ALT})["']\\s*,\\s*(?:["'\`]([^"'\`]*)["'\`]|\\{[^}]*?class(?:Name)?\\s*:\\s*["'\`]([^"'\`]*)["'\`])`,
    "g"
);
// `const v = document.createElement("input")` / `createEl("select", …)`.
const VAR_RE = new RegExp(
    `(?:const|let|var)\\s+(\\w+)\\s*(?::[^=]+)?=\\s*[\\w.]*\\(\\s*["'](${FIELD_ALT})["']`,
    "g"
);

/** @type {Map<string, string>} class → first source that puts it on a field */
const fieldClasses = new Map();
/**
 * @param {string | undefined} literal
 * @param {string} where
 */
function addClasses(literal, where) {
    if (!literal) return;
    for (const c of literal.split(/\s+/)) {
        // A template hole (`gl-x--${state}`) leaves no static class: only whole names count.
        if (c.startsWith(FIELD_GUARD.prefix) && /^[\w-]+$/.test(c) && !fieldClasses.has(c))
            fieldClasses.set(c, where);
    }
}

let sourceCount = 0;
for (const pkg of registry.all()) {
    const files = walk(
        path.join(pkg.absDir, "src"),
        (n) => SOURCE_RE.test(n) && !TEST_RE.test(n) && !n.endsWith(".d.ts"),
        []
    );
    for (const file of files) {
        sourceCount++;
        const src = fs.readFileSync(file, "utf8");
        const where = rel(file);
        for (const m of src.matchAll(FACTORY_RE)) addClasses(m[2] ?? m[3], where);
        for (const m of src.matchAll(VAR_RE)) {
            const v = m[1];
            const setRe = new RegExp(
                `\\b${v}\\.(?:className\\s*=\\s*["'\`]([^"'\`]*)["'\`]|classList\\.add\\(([^)]*)\\))`,
                "g"
            );
            for (const s of src.matchAll(setRe)) {
                if (s[1] !== undefined) addClasses(s[1], where);
                else for (const q of s[2].matchAll(/["'`]([^"'`]*)["'`]/g)) addClasses(q[1], where);
            }
        }
    }
}

if (fieldClasses.size === 0) {
    console.error(
        `✖ HGR — aucune classe de champ dérivée de ${sourceCount} source(s) : instrument aveugle.`
    );
    process.exit(2);
}

// ─── 3. Every unlayered rule of a non-core sheet ────────────────────────────────────────────

/** @type {string[]} */
const sheets = [];
for (const pkg of registry.all()) {
    if (pkg.name === core.name) continue;
    walk(path.join(pkg.absDir, "src"), (n) => n.endsWith(".css"), sheets);
}
if (sheets.length === 0) {
    console.error("✖ HGR — aucune feuille de greffon ou de lib trouvée : instrument aveugle.");
    process.exit(2);
}

/** @type {string[]} */
const violations = [];
let examined = 0;
for (const sheet of sheets) {
    postcss.parse(fs.readFileSync(sheet, "utf8"), { from: sheet }).walkRules((rule) => {
        if (isLayeredOrKeyframe(rule)) return;
        /** @type {string[]} */
        const props = [];
        rule.each((n) => {
            if (n.type === "decl" && !n.important) props.push(n.prop);
        });
        if (props.length === 0) return;
        for (const sel of rule.selectors) {
            if (sel.includes("::")) continue; // a pseudo-element is not the field itself
            const subject = readCompound(subjectOf(sel));
            const sp = specificity(sel);
            examined++;
            const isField =
                subject.classes.some((c) => fieldClasses.has(c)) ||
                (subject.element !== null &&
                    FIELD_GUARD.elements.has(subject.element) &&
                    subject.classes.some((c) => c.startsWith(FIELD_GUARD.prefix)));
            /** @type {{ props: Set<string>, sp: Specificity }[]} */
            const bars = [];
            if (isField) bars.push(FIELD_GUARD);
            for (const g of classGuards)
                if (g.classes.every((c) => subject.classes.includes(c))) bars.push(g);
            for (const bar of bars) {
                if (compare(sp, bar.sp) > 0) continue;
                const lost = props.filter((p) => reverted(bar.props, p));
                if (lost.length === 0) continue;
                violations.push(
                    `${rel(sheet)}:${rule.source?.start?.line ?? 0}  ${sel.trim()} ` +
                        `(${sp.join(",")}) ≤ (${bar.sp.join(",")}) — perd : ${[...new Set(lost)].join(", ")}`
                );
            }
        }
    });
}

const perimeter =
    `garde ${rel(GUARD_SHEET)} : ${[...FIELD_GUARD.elements].join("/")} ` +
    `[class^="${FIELD_GUARD.prefix}"] en (${FIELD_GUARD.sp.join(",")}), ` +
    `annule ${[...FIELD_GUARD.props].join(", ")} ; ${fieldClasses.size} classe(s) de champ ` +
    `dérivées de ${sourceCount} source(s) ; ${sheets.length} feuille(s) hors cœur, ` +
    `${examined} sélecteur(s) examinés.`;

if (violations.length > 0) {
    console.error(
        `✖ HGR — ${violations.length} règle(s) hors couche perdent leurs couleurs face à la ` +
            `garde d'hôte du cœur :\n`
    );
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        "\n  Remède : monter SEULEMENT les déclarations annulées dans une règle de spécificité\n" +
            "  supérieure (par ex. sous la racine du composant), sans toucher aux autres propriétés.\n" +
            `  Périmètre : ${perimeter}`
    );
    process.exit(1);
}
console.log(`✔ HGR — aucune règle de greffon ou de lib annulée par la garde d'hôte. ${perimeter}`);
