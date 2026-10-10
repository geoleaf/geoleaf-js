/**
 * WHERE is a DOM anchor placed? — the search half of the DOM contract (CC-08).
 *
 * ## Why this lib exists
 *
 * A consumer declares, in `required.dom_contract`, the selectors it reads in OUR DOM. For an
 * entry of `owner: "library"`, `verify-consumer-contract.cjs` must find the selector in the
 * sources of the package that places the node. Two things decide whether that search can see
 * a live anchor, and both used to be wrong:
 *
 *   • WHICH package — the core was the only corpus, so an anchor placed by a lib (a form
 *     modal of `field-renderer`) could not be declared without turning red. The entry now
 *     names its `provider`, with the grammar `required.public` already uses: `core` by
 *     default, `plugin:<dir>`, `lib:<dir>`. The search stays in THAT package: a selector is
 *     not unique across the monorepo (a plugin stylesheet targets a core panel, another plugin
 *     puts the same `data-*` name on a different node), so a corpus wide enough to hold every
 *     placer holds foreign witnesses too, and an anchor the core stopped placing would stay
 *     green on them.
 *   • WHICH form — `el.dataset["glActionId"] = …` places `data-gl-action-id` without ever
 *     writing it. The camelCase key is accepted, but ONLY in a write position: a bare
 *     `layerId` substring is in a hundred files that place nothing.
 *
 * ## A placement, by selector FORM
 *
 * The search was a substring of the selector, in scripts and stylesheets alike: an anchor the
 * package stopped placing stayed green as long as one of its files READ it, styled it, or
 * named it in a comment. What places a node is not what names it, and it depends on the form:
 *
 *   • `#id` — an assignment (`.id = "x"`), an `id: "x"` key handed to a DOM helper,
 *     `setAttribute("id", "x")`, `id="x"` in markup, a PREFIX the rest of the id is computed
 *     onto (`"gl-rp-pane-" + id`) — or a constant holding the id, PROVIDED some file of the
 *     package writes it. A constant only ever handed to `getElementById` places nothing, and
 *     the core has one.
 *   • `.class` — the name standing as a WORD of a string literal in a script, not behind a dot
 *     and not handed to a read (`classList.contains`, `classList.remove`,
 *     `getElementsByClassName`). ⚠️ Wider than the id rule, and measured before being chosen:
 *     of the classes the core's stylesheets target, more are placed through a helper
 *     (`el("div", "gl-x")`), a ternary or a lookup table than by `className =` — no list of
 *     write positions holds them. What tells a placement from a read, for a class, is the dot.
 *   • `[attr]` — `setAttribute` / `toggleAttribute`, the attribute in markup, or a `dataset`
 *     write. `[attr='v']` — the same, with THAT value written; a computed value proves nothing.
 *   • anything else (a compound selector) — the historical substring, stylesheets included.
 *     The rule cannot say what places a relation between two nodes.
 *
 * A stylesheet places nothing, and neither does a comment. A word boundary applies everywhere:
 * `gl-right-panel` is not found in `gl-right-panel-open`.
 *
 * ## What it still does not judge
 *
 * A read-only constant holding a CLASS counts — the price of the wider class rule. An id built
 * entirely at run time has no literal to find. And the search is textual: it does not follow
 * data, it recognises the positions the repository writes in.
 */
"use strict";

const path = require("node:path");

const { collectSources } = require("./event-names.cjs");

/**
 * @typedef {{kind: "id" | "class" | "attr" | "other", name: string, value: string | null}} SelectorForm
 * What decides how a selector's placement is recognised: its form, the name it carries, and
 * the value an attribute selector asks for.
 *
 * @typedef {{literal: string, datasetKey: string | null} & SelectorForm} Needles
 * What a selector is searched by.
 */

/** What an anchor search reads: scripts, and the stylesheets that target the node. */
const ANCHOR_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".css"]);

/**
 * The `dataset` key of a `data-*` attribute name, as the DOM derives it.
 *
 * Drops the `data-` prefix, then turns each `-` followed by a lowercase letter into that
 * letter uppercased (`data-gl-rp-tab` → `glRpTab`). A hyphen before anything else stays:
 * `data-col-2` → `col-2`, which only the bracket form can write.
 *
 * @param {string} attr - An attribute name.
 * @returns {string | null} The key, or `null` when the name has no `dataset` form.
 */
function datasetKeyOf(attr) {
    if (typeof attr !== "string" || !attr.startsWith("data-")) return null;
    const rest = attr.slice("data-".length);
    // An uppercase letter has no dataset form: the DOM lowercases attribute names.
    if (rest === "" || /[A-Z]/.test(rest)) return null;
    return rest.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * The needles a selector is searched by.
 *
 * `literal` is the historical needle, unchanged: `#` dropped, surrounding brackets dropped,
 * anything else as written. `datasetKey` is added for a bare `[data-…]` selector only — a
 * valued one (`[data-x='v']`) keeps its literal alone.
 *
 * @param {string} selector - A `dom_contract` selector.
 * @returns {Needles} The needles, and the selector's form.
 */
function needlesOf(selector) {
    const literal = selector.replace(/^#/, "").replace(/^\[|\]$/g, "");
    const bare = /^\[(data-[a-z0-9-]+)\]$/.exec(selector);
    return { literal, datasetKey: bare ? datasetKeyOf(bare[1]) : null, ...formOf(selector) };
}

/**
 * The form of a selector — what decides how its placement is recognised.
 *
 * @param {string} selector - A `dom_contract` selector.
 * @returns {SelectorForm}
 */
function formOf(selector) {
    let m = /^#([A-Za-z_][\w-]*)$/.exec(selector);
    if (m) return { kind: "id", name: m[1], value: null };
    m = /^\.(-?[A-Za-z_][\w-]*)$/.exec(selector);
    if (m) return { kind: "class", name: m[1], value: null };
    m = /^\[([A-Za-z_][\w:.-]*)\]$/.exec(selector);
    if (m) return { kind: "attr", name: m[1], value: null };
    m = /^\[([A-Za-z_][\w:.-]*)=(["']?)([^"'\]]*)\2\]$/.exec(selector);
    if (m) return { kind: "attr", name: m[1], value: m[3] };
    return { kind: "other", name: selector, value: null };
}

// The three write positions of a `dataset` key. Static patterns — the key is compared after
// the match, never spliced into a pattern. `=(?!=)` keeps comparisons out, and tolerates a
// value that starts on the next line.
const DOT_WRITE = /\.dataset\.([A-Za-z_$][\w$]*)\s*=(?!=)/g;
const BRACKET_WRITE = /\bdataset\[\s*(["'`])([^"'`\]]+)\1\s*\]\s*=(?!=)/g;
const OBJECT_LITERAL = /\bdataset\s*:\s*\{([^}]*)\}/g;
const OBJECT_KEY = /(?:^|[\s,])(["']?)([A-Za-z_$][\w$-]*)\1\s*:/g;

/**
 * Every `dataset` key WRITTEN by a source text.
 *
 * Three positions: `el.dataset.key = …`, `el.dataset["key"] = …`, and a key of a
 * `dataset: { key: … }` object literal handed to a DOM helper.
 *
 * @param {string} text - A source file's content.
 * @returns {Set<string>} The keys written.
 */
function datasetWrites(text) {
    const keys = new Set();
    for (const m of text.matchAll(DOT_WRITE)) keys.add(m[1]);
    for (const m of text.matchAll(BRACKET_WRITE)) keys.add(m[2]);
    for (const obj of text.matchAll(OBJECT_LITERAL)) {
        for (const m of obj[1].matchAll(OBJECT_KEY)) keys.add(m[2]);
    }
    return keys;
}

/** A string delimiter, as a character class. */
const Q = "[\"'`]";

/** Escapes a literal for use inside a pattern built at run time. */
function esc(literal) {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A script's text with its comments removed — a comment naming an anchor places nothing.
 * Whole-line `//` comments and `/* … *\/` blocks; a trailing comment after code stays, on
 * purpose: telling it from a `//` inside a string would take a tokenizer.
 *
 * @param {{text: string, code?: string}} source
 * @returns {string}
 */
function codeOf(source) {
    source.code ??= source.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return source.code;
}

/**
 * The identifiers a script declares with exactly this string as their value.
 *
 * @param {string} code - A script, comments removed.
 * @param {string} value - The string looked for.
 * @returns {string[]}
 */
function constantsHolding(code, value) {
    const decl = new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::\\s*[^=;\\n]+)?=\\s*${Q}${esc(value)}${Q}`,
        "g"
    );
    return [...code.matchAll(decl)].map((m) => m[1]);
}

/** Does a script write an id — directly, or onto a prefix of it? */
function writesId(code, name) {
    const n = esc(name);
    if (
        new RegExp(
            `\\.id\\s*=(?!=)\\s*${Q}${n}${Q}` + // el.id = "x"
                `|\\bid\\s*:\\s*${Q}${n}${Q}` + // { id: "x" }
                `|setAttribute\\(\\s*${Q}id${Q}\\s*,\\s*${Q}${n}${Q}` +
                `|\\bid=\\\\?["']${n}\\\\?["']` // id="x" in markup
        ).test(code)
    ) {
        return true;
    }
    // A prefix the rest is computed onto: `"gl-rp-pane-" + id`, or the same in a template.
    const prefixed = /\.id\s*=(?!=)\s*(?:(["'])([^"'`\n]+)\1\s*\+|`([^`$\n]+)\$\{)/g;
    for (const m of code.matchAll(prefixed)) {
        const prefix = m[2] ?? m[3];
        if (prefix.length > 0 && prefix.length < name.length && name.startsWith(prefix))
            return true;
    }
    return false;
}

/** Does a script write an id THROUGH this identifier? */
function writesIdThrough(code, identifier) {
    const i = esc(identifier);
    return new RegExp(
        `\\.id\\s*=(?!=)\\s*${i}\\b|\\bid\\s*:\\s*${i}\\b|setAttribute\\(\\s*${Q}id${Q}\\s*,\\s*${i}\\b`
    ).test(code);
}

/**
 * Is the string that follows `before` the argument of a call that READS a class, or takes it
 * away — `classList.contains`, `classList.remove`, `getElementsByClassName`?
 *
 * @param {string} before - The code leading up to the string's opening quote.
 * @returns {boolean}
 */
function isClassRead(before) {
    const open = before.lastIndexOf("(");
    // No call open at this point, or one that closed before the string.
    if (open < 0 || before.indexOf(")", open) >= 0) return false;
    return /(?:\.contains|\.remove|getElementsByClassName)\s*$/.test(before.slice(0, open));
}

/** Does a script hold the class as a word of a string literal that is not a read? */
function writesClass(code, name) {
    // A word: not glued to a longer name, and not behind the dot (or `#`) of a selector.
    const word = new RegExp(`(?<![\\w.#-])${esc(name)}(?![\\w-])`);
    // Template literals are read up to their first interpolation: `gl-x${variant}` holds `gl-x`.
    const literal = /(["'])((?:(?!\1)[^\\\n]|\\.)*)\1|`([^`$]*)/g;
    for (const m of code.matchAll(literal)) {
        if (!word.test(m[2] ?? m[3] ?? "")) continue;
        if (isClassRead(code.slice(Math.max(0, m.index - 120), m.index))) continue;
        return true;
    }
    return false;
}

/** Does a script write an attribute — and, when one is asked for, THAT value? */
function writesAttribute(source, needles) {
    const code = codeOf(source);
    const n = esc(needles.name);
    if (needles.value === null) {
        if (new RegExp(`(?:set|toggle)Attribute\\(\\s*${Q}${n}${Q}`).test(code)) return true;
        // In markup: the name after a space, inside a tag, valued or not.
        if (new RegExp(`<[a-zA-Z][^<>]*\\s${n}(?:=|[\\s>/])`).test(code)) return true;
    } else {
        const v = esc(needles.value);
        if (new RegExp(`setAttribute\\(\\s*${Q}${n}${Q}\\s*,\\s*${Q}${v}${Q}`).test(code))
            return true;
        if (new RegExp(`<[a-zA-Z][^<>]*\\s${n}=\\\\?["']${v}\\\\?["']`).test(code)) return true;
    }
    const key = datasetKeyOf(needles.name);
    if (!key) return false;
    if (needles.value === null) {
        source.writes ??= datasetWrites(source.text);
        return source.writes.has(key);
    }
    const k = esc(key);
    const v = esc(needles.value);
    return new RegExp(
        `\\.dataset\\.${k}\\s*=(?!=)\\s*${Q}${v}${Q}|\\bdataset\\[\\s*${Q}${k}${Q}\\s*\\]\\s*=(?!=)\\s*${Q}${v}${Q}`
    ).test(code);
}

/**
 * True if ONE source places the anchor the needles describe — see the header for what a
 * placement is, form by form. A constant holding an id counts here when the same file writes
 * it; {@link isPlacedInCorpus} looks for the write across the package.
 *
 * @param {{text: string, css?: boolean, writes?: Set<string>, code?: string}} source - A file's
 *   content; `css` marks a stylesheet. `writes` and `code` are caches, filled on first need.
 * @param {Needles} needles - From {@link needlesOf}.
 * @returns {boolean}
 */
function isPlaced(source, needles) {
    if (needles.kind === "other") return source.text.includes(needles.literal);
    // A stylesheet targets a node; it never places one.
    if (source.css) return false;
    const code = codeOf(source);
    if (needles.kind === "class") return writesClass(code, needles.name);
    if (needles.kind === "attr") return writesAttribute(source, needles);
    if (writesId(code, needles.name)) return true;
    return constantsHolding(code, needles.name).some((id) => writesIdThrough(code, id));
}

/**
 * True if a PACKAGE places the anchor: one of its files does, or — for an id — one declares a
 * constant holding it and another writes that constant.
 *
 * @param {Array<{text: string, css?: boolean}>} sources - The package's files.
 * @param {Needles} needles - From {@link needlesOf}.
 * @returns {boolean}
 */
function isPlacedInCorpus(sources, needles) {
    if (sources.some((src) => isPlaced(src, needles))) return true;
    if (needles.kind !== "id") return false;
    const scripts = sources.filter((src) => !src.css);
    const constants = new Set(
        scripts.flatMap((src) => constantsHolding(codeOf(src), needles.name))
    );
    if (constants.size === 0) return false;
    return scripts.some((src) => [...constants].some((id) => writesIdThrough(codeOf(src), id)));
}

/**
 * The package an entry's `provider` designates, or why it designates none.
 *
 * `core` (the default), `plugin:<dir>` for a package of `registry.plugins()`, `lib:<dir>` for
 * any other package that ships code (`exports` in its manifest) — which excludes the demo
 * app: it places what a HOST places, and counting it would green a library obligation on a
 * host placement.
 *
 * @param {unknown} provider - The entry's `provider`, possibly absent.
 * @param {typeof import("./packages.cjs")} registry - The package registry.
 * @returns {{pkg: {name: string, dirName: string, absDir: string}} | {refusal: string}}
 */
function resolveAnchorProvider(provider, registry) {
    const p = provider ?? "core";
    if (p === "core") return { pkg: registry.requireByDirName("core") };
    if (typeof p !== "string") {
        return { refusal: `\`provider\` n'est pas une chaîne (\`${JSON.stringify(p)}\`).` };
    }
    const colon = p.indexOf(":");
    const kind = colon < 0 ? p : p.slice(0, colon);
    const dirName = colon < 0 ? "" : p.slice(colon + 1);
    if (kind === "plugin") {
        const pkg = registry.plugins().find((x) => x.dirName === dirName);
        return pkg ? { pkg } : { refusal: `\`${p}\` : aucun plugin de ce répertoire.` };
    }
    if (kind === "lib") {
        const pkg = registry.all().find((x) => x.dirName === dirName);
        if (!pkg) return { refusal: `\`${p}\` : aucun paquet de ce répertoire.` };
        if (pkg.dirName === "core") {
            return { refusal: `\`${p}\` : le cœur se désigne par \`core\`.` };
        }
        if (pkg.name.startsWith("@geoleaf-plugins/")) {
            return { refusal: `\`${p}\` : un plugin se désigne par \`plugin:${dirName}\`.` };
        }
        if (!pkg.manifest.exports) {
            return {
                refusal:
                    `\`${p}\` : ce paquet n'expose aucun code (\`exports\` absent) — une ` +
                    'application pose ce que pose un HÔTE, déclarer `owner: "host"`.',
            };
        }
        return { pkg };
    }
    return {
        refusal:
            `\`provider\` inconnu (\`${p}\`) — les seules formes reconnues sont \`core\`, ` +
            "`plugin:<répertoire>` et `lib:<répertoire>`.",
    };
}

/**
 * The files an anchor of `pkg` is searched in: its `src/`, scripts and stylesheets, without
 * tests and without declaration files (a `.d.ts` places nothing — its only anchors are in
 * doc comments).
 *
 * @param {{absDir: string}} pkg - A registry entry.
 * @returns {string[]} Absolute paths.
 */
function anchorCorpus(pkg) {
    return collectSources(path.join(pkg.absDir, "src"), [], ANCHOR_EXTS).filter(
        (f) => !f.endsWith(".d.ts")
    );
}

module.exports = {
    datasetKeyOf,
    needlesOf,
    formOf,
    datasetWrites,
    isPlaced,
    isPlacedInCorpus,
    resolveAnchorProvider,
    anchorCorpus,
};
