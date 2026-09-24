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
 * ## What it does not judge
 *
 * The rest of the search is inherited as it was: a substring, so a read or a comment carrying
 * the literal counts; a `.class` needle keeps its dot, so it is met by a stylesheet rule, never
 * by a `className` write; a valued attribute selector keeps its quotes. Those are limits of
 * the rule, not of this lib, and they are recorded where the rule is documented.
 */
"use strict";

const path = require("node:path");

const { collectSources } = require("./event-names.cjs");

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
 * @returns {{literal: string, datasetKey: string | null}} The needles.
 */
function needlesOf(selector) {
    const literal = selector.replace(/^#/, "").replace(/^\[|\]$/g, "");
    const bare = /^\[(data-[a-z0-9-]+)\]$/.exec(selector);
    return { literal, datasetKey: bare ? datasetKeyOf(bare[1]) : null };
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

/**
 * True if a source text places the anchor the needles describe.
 *
 * @param {{text: string, writes?: Set<string>}} source - A file's content; `writes` caches
 *   its `dataset` keys across calls and is filled on first need.
 * @param {{literal: string, datasetKey: string | null}} needles - From {@link needlesOf}.
 * @returns {boolean} Whether the literal is there, or the key is written.
 */
function isPlaced(source, needles) {
    if (source.text.includes(needles.literal)) return true;
    if (!needles.datasetKey) return false;
    source.writes ??= datasetWrites(source.text);
    return source.writes.has(needles.datasetKey);
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
    datasetWrites,
    isPlaced,
    resolveAnchorProvider,
    anchorCorpus,
};
