#!/usr/bin/env node
/**
 * validate-docs-examples.cjs
 *
 * Static analyser for code examples embedded in Markdown files inside docs/.
 *
 * Rules applied per language:
 *   json  — JSON.parse() validity check
 *   js/ts — phantom API patterns, wrong package names, stale CDN URLs; `Core.init` options
 *           (DOCS-CORE-INIT) and the engine global of npm recipes (DOCS-NPM-ENGINE)
 *   bash  — wrong npm install package names
 *   html  — stale CDN script/link src attributes; MapLibre loaded (HTML-04); `Core.init`
 *           options in inline scripts (DOCS-CORE-INIT)
 *
 * Exit code 0 — no violations
 * Exit code 1 — one or more violations detected
 *
 * Usage:
 *   node scripts/validate-docs-examples.cjs [--dir <path>] [--verbose]
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const dirArgIdx = args.indexOf("--dir");
const ROOT = process.cwd();
// The default comes from the registry (which throws); the `--dir` argument stays king.
const { extractTsdocExamples, sourceFiles, productDocsFiles } = require("./lib/tsdoc-examples.cjs");
const { readInterfaceMembers } = require("./lib/ts-decl-read.cjs");
const registry = require("./lib/packages.cjs");
// The cast makes the `ts.is*` guards narrow under checkJs — same reason as in
// `typecheck-docs-examples.cjs`.
const ts = /** @type {typeof import("typescript")} */ (require("typescript"));

// 2026-07-31 — the perimeter goes from ONE directory to the PRODUCT surfaces, and it is
// derived in `lib/tsdoc-examples.cjs` so `typecheck-docs-examples` reads exactly the
// same one (full rationale on `productDocsFiles`). `--dir` stays king and forces a
// single scope.
const DOCS_DIR = dirArgIdx >= 0 ? path.resolve(ROOT, args[dirArgIdx + 1]) : null;

// ---------------------------------------------------------------------------
// Violation rules
// ---------------------------------------------------------------------------

/**
 * @typedef {{ pattern: RegExp; message: string; severity: 'error' | 'warn' }} Rule
 */

// ---------------------------------------------------------------------------
// JSON example parsing (KERNEL S14)
// ---------------------------------------------------------------------------
//
// A raw `JSON.parse()` on the block was too strict for two idioms this
// documentation uses everywhere, and both are legitimate:
//
//   1. a leading `// path/to/file.json` comment naming the file being shown;
//   2. a FRAGMENT — one or more `"key": value` pairs excerpted from a larger
//      object, rather than a whole document.
//
// Under the strict rule those produced 6 failures across 3 files that were not
// defects at all. Since the gate had never actually run (it was wired into
// nothing until S14), nobody had seen them. Rejecting valid documentation style
// would have pushed authors to work around the gate — so the parser adapts, and
// keeps its real value: catching genuinely malformed JSON.

/** Strips leading `//` line comments used to name the file in an example. */
function stripLeadingComments(code) {
    return code.replace(/^\s*(?:\/\/[^\n]*\n)+/, "");
}

/**
 * Parses a JSON documentation example, tolerating a filename comment and
 * object fragments. Returns true when the block is well-formed.
 */
function isParseableJsonExample(code) {
    const body = stripLeadingComments(code).trim();
    if (!body) return true;
    try {
        JSON.parse(body);
        return true;
    } catch {
        // Retry as a fragment: `"a": 1, "b": 2` → `{ "a": 1, "b": 2 }`.
        try {
            JSON.parse(`{${body}}`);
            return true;
        } catch {
            return false;
        }
    }
}

/** The parse error to report, measured the same way as {@link isParseableJsonExample}. */
function jsonExampleError(code) {
    const body = stripLeadingComments(code).trim();
    try {
        JSON.parse(body);
        return "";
    } catch (err) {
        return err.message;
    }
}

/** @type {Rule[]} */
const JS_TS_RULES = [
    {
        pattern: /GeoLeaf\.GeoJSON\s*\.\s*(load|add|remove|clearAll|getAll|clear)\s*\(/,
        message:
            "Phantom API: GeoLeaf.GeoJSON has no public methods. Use GeoLeaf.LayerManager or configure via profile.",
        severity: "error",
    },
    // ── KERNEL S14 — ghosts found documented on npm while absent from the runtime ──
    // Each of these was a live page on the published docs site whose example threw a
    // TypeError if you copy-pasted it. They are pinned here so a doc rewrite cannot
    // reintroduce them silently.
    {
        pattern: /GeoLeaf\.Helpers\s*\.\s*createElement\s*\(/,
        message:
            'Phantom API: GeoLeaf.Helpers.createElement() was removed at KERNEL S10 (no callers; its option shape diverged — "styles" vs "style", innerHTML winning over textContent). Use GeoLeaf.Utils.createElement(tag, props, ...children).',
        severity: "error",
    },
    {
        pattern: /GeoLeaf\.Utils\s*\.\s*escapeHtml\s*\(/,
        message:
            "Phantom API: GeoLeaf.Utils.escapeHtml() was never mounted at runtime — it only ever existed on the dead utils-api.ts assembler, unreachable since the UMD builds went away in v2.0.0. Use GeoLeaf.Security.escapeHtml().",
        severity: "error",
    },
    {
        pattern: /\bAbstractRenderer\b/,
        message:
            "Phantom API: AbstractRenderer was purged as Leaflet-era dead code (commit 1b28fb91); its documentation page was removed at KERNEL S14. There is no such class in packages/core/src.",
        severity: "error",
    },
    {
        pattern: /GeoLeaf\.ThemeSelector/,
        message:
            "Stale API: GeoLeaf.ThemeSelector does not exist. Use GeoLeaf.Themes or UI.toggleTheme().",
        severity: "error",
    },
    // ── The POI dissolution, documented but not gated ──
    //
    // `GeoLeaf.POI` was removed from the core: a POI is now a generic GeoJSON point
    // layer. Three COPY-PASTABLE examples survived on the published docs
    // (`USER_GUIDE.md`, `helpers/`, `security/`) — an integrator copying them gets a
    // TypeError. The migration message is not invented: it is copied from
    // `docs/CHANGELOG.md` §[3.0.0], which already carries it word for word.
    //
    // ⚠️ THE SCOPE IS THE CODE BLOCK, and that is load-bearing. The same name appears
    // **legitimately** 6 times in PROSE: 5 in `CHANGELOG.md` under `## [3.0.0]` and 1
    // in `COOKBOOK.md` ("BREAKING — GeoLeaf.POI.init() no longer exists"). A breaking
    // register MUST name the removed API: it is the only information linking an
    // integrator's code to its migration. Yet this script only applies `JS_TS_RULES`
    // to fenced blocks — the exemption thus derives from the CORPUS, not from an
    // allow-list, and cannot drift. Implemented as a whole-file `grep`, this rule
    // would redden on the 6 legitimate ones and the next contributor would bypass it:
    // the very mechanics this script's header already describes for its JSON parser.
    // 🛑 **THIS MESSAGE PRESCRIBED A GHOST API WHILE FORBIDDING ANOTHER**
    // (fixed on 2026-08-11). It pointed to `GeoLeaf.AddPOI.*` /
    // `@geoleaf-plugins/addpoi`, i.e. the plugin **merged into `editor`**: a reader
    // following the remediation to the letter replaced a dissolved API with a
    // non-existent package. It is the very class this rule hunts, at the place that
    // hunts it — and no gate can see it: the scanned corpus is the `.md` files and the
    // `@example`s, never the rules' own text. The real surface is verified in
    // `packages/plugins/editor/src/public-api.ts` (facade mounted on `GeoLeaf.Editor`
    // by `entry.ts`): `AddForm` and `PlacementMode` are getters of that facade.
    {
        pattern: /GeoLeaf\s*\.\s*POI\s*\./,
        message:
            "Phantom API: GeoLeaf.POI was removed from the core at S9 (POI dissolution) — a POI is now a plain GeoJSON point layer. Read/mutate through GeoLeaf.Layers.getFeatures / getFeatureById / addFeature / mergeFeatures / setData; style and click-render per layer via layers.<id>.capabilities.{taxonomy,cluster,feature-info}. For interactive point creation use GeoLeaf.Editor.AddForm / GeoLeaf.Editor.PlacementMode (@geoleaf-plugins/editor).",
        severity: "error",
    },
    // ── The CSRF module, removed in 3.4.0 ──
    //
    // Its token was minted and checked in the browser: no server could verify it, so it
    // protected nothing while reading like a protection. The day it was removed, five code
    // blocks on the published docs still called it — two of them in a popup action handler
    // an integrator would copy as is. Same scope as the POI rule above, for the same reason:
    // the CHANGELOG must keep naming the removed API in prose.
    {
        pattern: /\bCSRFToken\b/,
        message:
            "Removed API: GeoLeaf.Security.CSRFToken was removed in 3.4.0 — its token was minted and checked in the browser, so no server could verify it. Authenticate writes with the bearer token of @geoleaf-plugins/connector, which adds it to the requests it intercepts.",
        severity: "error",
    },
    {
        pattern: /GeoLeaf\.BaseLayers/,
        message:
            'Wrong casing: use GeoLeaf.Baselayers (lowercase "l") or import { Baselayers } from "@geoleaf/core".',
        severity: "error",
    },
    {
        pattern: /cdn\.geoleaf\.js/,
        message:
            "Fictitious CDN: cdn.geoleaf.js does not exist. Use unpkg.com/@geoleaf/core or jsDelivr.",
        severity: "error",
    },
    {
        pattern: /unpkg\.com\/geoleaf@/,
        message: "Wrong package name in CDN URL: use unpkg.com/@geoleaf/core@<version>",
        severity: "error",
    },
    {
        pattern: /cdn\.jsdelivr\.net\/npm\/geoleaf@/,
        message: "Wrong package name in CDN URL: use cdn.jsdelivr.net/npm/@geoleaf/core@<version>",
        severity: "error",
    },
    {
        pattern: /from\s+["']geoleaf["']/,
        message: 'Wrong package name in import: use "@geoleaf/core" not "geoleaf".',
        severity: "error",
    },
    {
        pattern: /import GeoLeaf from\s+["']geoleaf["']/,
        message:
            'Wrong default import and package name. Use: import { Core } from "@geoleaf/core".',
        severity: "error",
    },
    {
        pattern: /require\s*\(\s*["']geoleaf["']\s*\)/,
        message: 'Wrong package name in require(): use "@geoleaf/core".',
        severity: "error",
    },
    // MapLibre 6 exports no `default`. This rule lives here, among the JS/TS rules,
    // and not among the HTML rules where its twin was first written: `html` blocks
    // ALSO go through JS_TS_RULES (see below), so placing it here makes it cover both
    // corpora, while the reverse left it inert on every `ts`/`js` block. A rule filed
    // in the wrong table goes green without ever looking at anything.
    {
        pattern: /import\s+\w+\s+from\s+["']maplibre-gl["']/,
        message:
            "Import par défaut de `maplibre-gl` — la v6 n'exporte pas de `default` (sa carte " +
            '`exports` n\'expose que `import`). Utiliser `import * as maplibregl from "maplibre-gl"` ' +
            "ou les exports nommés.",
        severity: "error",
    },
];

/** @type {Rule[]} */
const BASH_RULES = [
    {
        // Matches "npm install geoleaf" and "npm i geoleaf" but NOT "@geoleaf/..."
        pattern: /npm\s+(?:install|i)\s+geoleaf(?:\s|$)/,
        message:
            'Wrong package name: use "npm install @geoleaf/core leaflet" not "npm install geoleaf".',
        severity: "error",
    },
];

/** @type {Rule[]} */
const HTML_RULES = [
    {
        pattern: /src=["'][^"']*geoleaf@4\./,
        message: 'Stale CDN URL: old package name "geoleaf@4.x". Use "@geoleaf/core@1.1.1".',
        severity: "error",
    },
    {
        pattern: /href=["'][^"']*geoleaf@4\./,
        message: 'Stale CDN URL: old package name "geoleaf@4.x". Use "@geoleaf/core@1.1.1".',
        severity: "error",
    },
    {
        pattern: /cdn\.geoleaf\.js/,
        message: "Fictitious CDN: cdn.geoleaf.js does not exist.",
        severity: "error",
    },
    {
        pattern: /unpkg\.com\/geoleaf@/,
        message: "Wrong package name in CDN URL: use unpkg.com/@geoleaf/core@<version>",
        severity: "error",
    },
    // ─── MapLibre 6 — the three rules were FLIPPED ───────────────────────────
    // Until now they forbade `<script type="module" src="…maplibre-gl….js">`, because
    // v5 was distributed as a CLASSIC script (`main: dist/maplibre-gl.js`, no `module`
    // nor `exports`). **In v6 it is the reverse, and exactly the reverse**: the
    // distribution is ESM-only, `maplibre-gl.js` and `maplibre-gl-csp.js` are no
    // longer published at all, and the `exports` map only exposes `import`. The form
    // once forbidden became the only one that boots.
    //
    // ⚠️ The two old regexes could not be left in place "just in case": they look for
    // `…maplibre-gl[^"']*\.js`, a pattern an `.mjs` does NOT contain. Kept, they
    // would have come out green on anything — a decorative gate, which is worse than
    // an absent one. Same class as the earlier truncated corpus: the rule was right,
    // its instrument no longer carried.
    {
        pattern: /(?:src|href)=["'][^"']*maplibre-gl(?:-csp)?\.js(?![\w-])/,
        message:
            "Artefact MapLibre disparu : `maplibre-gl.js` / `maplibre-gl-csp.js` ne sont PLUS " +
            "publiés depuis la v6 (distribution ESM-only). Cette recette rend un 404. Charger " +
            '`maplibre-gl.mjs` en <script type="module">, ou le shim `vendor/maplibre-gl/global.mjs`.',
        severity: "error",
    },
    {
        // The symmetric case: an `.mjs` loaded as a CLASSIC script. The negative
        // lookahead spans the whole tag, so it covers BOTH attribute orders at once —
        // where the paired rules of before had to be written twice for the same reason.
        pattern: /<script(?![^>]*\stype=["']module["'])[^>]*\ssrc=["'][^"']*maplibre-gl[^"']*\.mjs/,
        message:
            "MapLibre `.mjs` chargé en script classique — un module ne s'exécute que sous " +
            'type="module". Sans lui le navigateur refuse le fichier et la carte ne boote pas.',
        severity: "error",
    },
];

// ---------------------------------------------------------------------------
// HTML-04 — the rule that guards an ABSENCE
// ---------------------------------------------------------------------------
//
// 🛑 The rules above, ALL of them, guard a faulty PRESENCE: they look for a pattern and
// redden when it is there. None can see what is MISSING — and the defect measured on
// 2026-08-08 is precisely an absence: complete recipes loading MapLibre's stylesheet
// and the GeoLeaf bundle, but never MapLibre's JavaScript. `geoleaf.esm.js` declares
// `maplibre-gl` as `external` (rollup.config.mjs) and only reaches it through
// `globalThis.maplibregl`; v6 being ESM-only, nothing sets that global on its own
// anymore. A recipe without the shim thus renders a page that does not boot.
//
// ⚠️ This defect was found and fixed TWICE with no gate retaining it — `usage-cdn.md`
// and the two READMEs — and it came back a third time in `USER_GUIDE.md` and `FAQ.md`,
// which the v6 pass had not swept. Three manual discoveries of the same class: that is
// what justifies a rule rather than one more re-read.
//
// THE CRITERION — and it is narrower than "the block cites the bundle", deliberately.
// Loading `geoleaf.esm.js` without MapLibre does NOT throw: the global is only read at
// map creation. The rule therefore only bites on blocks that BOOT a map. Blocks that
// illustrate something else (load order, `window.GeoLeaf` appearing, a config key)
// stay green without having to declare themselves — there are 6 in the corpus, and
// weighing them down with four shim lines would drown what they show.
//
// ⚠️ Comments are neutralized before the test. Without that, `NOTIFICATIONS_API.md`
// reddened on an "// After GeoLeaf.boot()" in a comment — the exact false positive
// PNC-02 and the ESM guard each already paid once. A guard's false positive costs more
// than a true negative: it sends someone to fix healthy code.

/** A block carrying this marker declares itself a fragment, and leaves HTML-04's field. */
const FRAGMENT_MARKER = /<!--\s*geoleaf:docs:fragment\b/;

/** Any shape whatsoever that loads MapLibre's JavaScript. */
const MAPLIBRE_JS_LOAD =
    /maplibre-gl[^"'\s]*\.mjs|from\s+["']maplibre-gl["']|global\.mjs|maplibre-gl[^"'\s]*\.js(?![\w-])/;

/** The block creates a map — there, and only there, is the global read. */
const BOOTS_A_MAP = /\b(?:GeoLeaf|Core)\s*\.\s*(?:init|boot)\s*\(|new\s+maplibregl\.Map\s*\(/;

const GEOLEAF_BUNDLE = /geoleaf\.esm\.js/;

/**
 * Neutralizes HTML and JS comments so a mere MENTION never reads as a call.
 * @param {string} code
 * @returns {string}
 */
function stripComments(code) {
    return code
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * HTML-04 — every `html` block booting a map with the GeoLeaf bundle must load MapLibre JS.
 * @param {string} code
 * @returns {{ message: string; severity: string; matchedText: string }[]}
 */
function checkMapLibrePresence(code) {
    if (FRAGMENT_MARKER.test(code)) return [];
    if (!GEOLEAF_BUNDLE.test(code)) return [];
    const bare = stripComments(code);
    if (!BOOTS_A_MAP.test(bare)) return [];
    if (MAPLIBRE_JS_LOAD.test(code)) return [];
    return [
        {
            message:
                "HTML-04 — cette recette boote une carte avec `geoleaf.esm.js` mais ne charge " +
                "JAMAIS le JavaScript de MapLibre. `maplibre-gl` est `external` dans le bundle : " +
                "il n'est atteint que par `globalThis.maplibregl`, et la v6 (ESM-only) ne pose " +
                'plus ce global. Ajouter le shim — `<script type="module">import * as maplibregl ' +
                'from "…/maplibre-gl@6/dist/maplibre-gl.mjs"; globalThis.maplibregl = maplibregl;' +
                '</script>` — ou, en auto-hébergé, `<script type="module" src="…/global.mjs">`. ' +
                "Si ce bloc est un fragment délibéré, le déclarer par " +
                "`<!-- geoleaf:docs:fragment — motif -->`.",
            severity: "error",
            matchedText: (code.match(GEOLEAF_BUNDLE) || ["geoleaf.esm.js"])[0],
        },
    ];
}

// ---------------------------------------------------------------------------
// DOCS-CORE-INIT and DOCS-NPM-ENGINE — a Quick Start that returns `null`
// ---------------------------------------------------------------------------
//
// 🛑 Measured on 2026-09-12: the first example of BOTH READMEs returned `null`, for two
// independent reasons, and this gate — whose corpus has carried both READMEs since 07-31 —
// said nothing about either.
//
//   1. `Core.init({ map: { target } })`. `Core.init` reads `mapId`: the `map` shape belongs to
//      `GeoLeaf.init()`, which normalises it. Same class in COOKBOOK and FAQ, with another key:
//      `Core.init({ mapId, configUrl })`, where `configUrl` is a `GeoLeaf.boot()` option the
//      facade ignores without a word — the map is created, no profile is ever loaded.
//   2. An npm recipe that never puts the engine on `globalThis.maplibregl`. The package reads
//      MapLibre ONLY from that global and imports no MapLibre value, so `new maplibregl.Map`
//      throws, the facade catches it, and `Core.init` returns `null` WITH a correct `mapId`.
//      HTML-04 guards the same absence, but only in `html` blocks citing `geoleaf.esm.js`: an
//      npm recipe never names the bundle, so it sat outside that rule by construction.
//
// ⚠️ Why a rule HERE and not in `typecheck-docs-examples.cjs`: that gate compiles `ts` blocks
// only, and the README blocks are `javascript` and `html`. Even compiled, the first defect
// would pass — `{ map }` yields TS2353 (excess property), which is not one of its defect
// codes. Compiling `js` blocks is a separate decision; this gate already READS them.
//
// ⚠️ The allowed keys are READ from the facade (`NormalizedInitOptions`), never copied here: a
// key list written in this file would go stale the day an option is added, and the rule
// would then redden on a correct example.

const CORE_INIT_CALL = /\bCore\s*\.\s*init\s*\(/;

/** A block declaring itself a fragment in JS: it leaves DOCS-NPM-ENGINE's field. */
const JS_FRAGMENT_MARKER = /\/\/\s*geoleaf:docs:fragment\b/;

/**
 * A VALUE import of the package or one of its subpaths — `import type` loads nothing at
 * runtime. Flat on purpose: an optional subpath group holding a `*` is the nested quantifier
 * `security/detect-unsafe-regex` refuses, and this file's suppression debt only shrinks.
 */
const IMPORTS_CORE_VALUE = /^\s*import\s+(?!type\b)[^;]*?from\s+["']@geoleaf\/core[^"']*["']/m;

/** The two shapes that put the engine where GeoLeaf reads it. */
const SETS_ENGINE_GLOBAL =
    /globalThis\s*\.\s*maplibregl\s*=|Object\s*\.\s*assign\s*\(\s*globalThis\s*,\s*\{[^}]*\bmaplibregl\b/;

/** @type {Set<string> | null} */
let coreInitKeys = null;

/**
 * The option keys `Core.init` reads, from the facade's own declaration (private `_` keys
 * excluded). Resolved through the package registry, which throws on a missing package; the
 * reader exits 2 when the interface cannot be found.
 * @returns {Set<string>}
 */
function readCoreInitKeys() {
    if (coreInitKeys) return coreInitKeys;
    const core = registry.byName("@geoleaf/core");
    if (!core) {
        console.error(
            "[validate-docs-examples] @geoleaf/core is absent from the package registry."
        );
        process.exit(2);
    }
    const facade = path.join(core.absDir, "src", "kernel", "map", "facade.ts");
    const members = /** @type {Set<string>} */ (
        readInterfaceMembers(facade, "NormalizedInitOptions", { tag: "DOCS-CORE-INIT" })
    );
    coreInitKeys = new Set([...members].filter((key) => !key.startsWith("_")));
    return coreInitKeys;
}

/**
 * `Core.init` or `<anything>.Core.init`.
 * @param {import("typescript").Expression} expr
 * @returns {boolean}
 */
function isCoreInitCallee(expr) {
    if (!ts.isPropertyAccessExpression(expr) || expr.name.text !== "init") return false;
    const owner = expr.expression;
    if (ts.isIdentifier(owner)) return owner.text === "Core";
    return ts.isPropertyAccessExpression(owner) && owner.name.text === "Core";
}

/**
 * DOCS-CORE-INIT — every `Core.init({…})` names `mapId` and only keys the facade reads.
 *
 * Parsed, not matched: an option spread over several lines, a nested object and a comment
 * mentioning `map:` are all read for what they are. A spread (`...options`, or the `...` of a
 * deliberate fragment) makes the key set unknowable, so only the NAMED keys are judged then.
 *
 * @param {string} code - JS/TS source — an html block's inline scripts are passed one by one.
 * @returns {{ message: string; severity: string; matchedText: string }[]}
 */
function checkCoreInitCalls(code) {
    if (!CORE_INIT_CALL.test(code)) return [];
    const allowed = readCoreInitKeys();
    const sf = ts.createSourceFile(
        "block.ts",
        code,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TS
    );
    const violations = [];
    /** @param {import("typescript").Node} node */
    const visit = (node) => {
        const arg = ts.isCallExpression(node) ? node.arguments[0] : undefined;
        if (arg && ts.isCallExpression(node) && isCoreInitCallee(node.expression)) {
            if (ts.isObjectLiteralExpression(arg)) {
                let spread = false;
                const keys = [];
                for (const prop of arg.properties) {
                    if (ts.isSpreadAssignment(prop)) spread = true;
                    else if (
                        prop.name &&
                        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
                    ) {
                        keys.push(prop.name.text);
                    }
                }
                const unknown = keys.filter((key) => !allowed.has(key));
                const known = [...allowed].map((key) => `\`${key}\``).join(", ");
                if (unknown.length > 0) {
                    violations.push({
                        message:
                            `DOCS-CORE-INIT — \`Core.init()\` ne lit pas ${unknown.map((k) => `\`${k}\``).join(", ")} : ` +
                            `il l'ignore sans un mot. Clés lues (NormalizedInitOptions) : ${known}. La forme ` +
                            "`{ map: { target } }` est celle de `GeoLeaf.init()` ; `configUrl` est une option " +
                            "de `GeoLeaf.boot()`.",
                        severity: "error",
                        matchedText: arg.getText(sf).slice(0, 80),
                    });
                }
                if (!spread && !keys.includes("mapId")) {
                    violations.push({
                        message:
                            "DOCS-CORE-INIT — `Core.init()` sans `mapId` journalise une erreur et rend " +
                            "`null` : l'exemple ne crée aucune carte.",
                        severity: "error",
                        matchedText: arg.getText(sf).slice(0, 80),
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return violations;
}

/**
 * The bodies of an html block's INLINE scripts — a `<script src>` runs nothing written here.
 * @param {string} html
 * @returns {string[]}
 */
function inlineScripts(html) {
    return [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
        (m) => m[1]
    );
}

/**
 * DOCS-NPM-ENGINE — HTML-04's twin for npm recipes: a js/ts block importing the package and
 * booting a map puts the engine on `globalThis.maplibregl`.
 * @param {string} code
 * @returns {{ message: string; severity: string; matchedText: string }[]}
 */
function checkNpmEngineGlobal(code) {
    if (JS_FRAGMENT_MARKER.test(code) || !IMPORTS_CORE_VALUE.test(code)) return [];
    const bare = stripComments(code);
    if (!BOOTS_A_MAP.test(bare) || SETS_ENGINE_GLOBAL.test(bare)) return [];
    return [
        {
            message:
                "DOCS-NPM-ENGINE — cette recette importe `@geoleaf/core` et boote une carte sans " +
                "poser le moteur sur `globalThis.maplibregl`, le seul endroit où GeoLeaf le lit : " +
                "`new maplibregl.Map` jette et `Core.init` rend `null`, même avec `mapId`. Ajouter " +
                '`import * as maplibregl from "maplibre-gl";` puis `Object.assign(globalThis, { maplibregl });` ' +
                "(la forme qui compile aussi en TypeScript). Si ce bloc est un fragment délibéré, le " +
                "déclarer par `// geoleaf:docs:fragment — motif`.",
            severity: "error",
            matchedText: (bare.match(BOOTS_A_MAP) || ["Core.init("])[0],
        },
    ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk a directory recursively and return all files matching the predicate.
 * @param {string} dir
 * @param {(f: string) => boolean} predicate
 * @returns {string[]}
 */
function walkDir(dir, predicate) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDir(full, predicate));
        } else if (predicate(full)) {
            results.push(full);
        }
    }
    return results;
}

/**
 * @typedef {{ lang: string; code: string; startLine: number }} CodeBlock
 */

/**
 * Extract fenced code blocks from Markdown content.
 * @param {string} content
 * @returns {CodeBlock[]}
 */
function extractCodeBlocks(content) {
    const blocks = [];
    const lines = content.split("\n");
    let inBlock = false;
    let lang = "";
    let blockLines = [];
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const fenceMatch = ln.match(/^```(\w*)/);

        if (!inBlock && fenceMatch) {
            inBlock = true;
            lang = fenceMatch[1].toLowerCase();
            blockLines = [];
            startLine = i + 1; // 1-based, pointing to the opening fence
            continue;
        }

        if (inBlock) {
            if (/^```/.test(ln)) {
                blocks.push({ lang, code: blockLines.join("\n"), startLine });
                inBlock = false;
                lang = "";
                blockLines = [];
            } else {
                blockLines.push(ln);
            }
        }
    }
    return blocks;
}

/**
 * Apply a set of rules to a code string.
 * Returns an array of { message, severity, matchedText } for each violation.
 * @param {string} code
 * @param {Rule[]} rules
 * @returns {{ message: string; severity: string; matchedText: string }[]}
 */
function applyRules(code, rules) {
    const violations = [];
    for (const rule of rules) {
        const m = code.match(rule.pattern);
        if (m) {
            violations.push({
                message: rule.message,
                severity: rule.severity,
                matchedText: m[0].trim().slice(0, 80),
            });
        }
    }
    return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const mdFiles = DOCS_DIR ? walkDir(DOCS_DIR, (f) => f.endsWith(".md")) : productDocsFiles();
const corpusLabel = DOCS_DIR ? DOCS_DIR : "les surfaces produit (racine + paquets + scaffold)";

if (mdFiles.length === 0) {
    console.error(`[validate-docs-examples] No .md files found in: ${corpusLabel}`);
    process.exit(1);
}

if (VERBOSE) {
    console.log(`[validate-docs-examples] Scanning ${mdFiles.length} files in ${corpusLabel}\n`);
}

/** @type {{ file: string; blockNum: number; lang: string; startLine: number; violations: any[] }[]} */
const allViolations = [];
let totalBlocks = 0;
let jsonErrors = 0;

for (const mdFile of mdFiles) {
    const content = fs.readFileSync(mdFile, "utf8");
    const blocks = extractCodeBlocks(content);
    const relFile = path.relative(ROOT, mdFile);
    let blockNum = 0;

    for (const block of blocks) {
        blockNum++;
        totalBlocks++;

        const lang = block.lang;
        let violations = [];

        // --- JSON blocks: parse validation ---
        if (lang === "json") {
            if (!isParseableJsonExample(block.code)) {
                jsonErrors++;
                violations.push({
                    message: `Invalid JSON: ${jsonExampleError(block.code)}`,
                    severity: "error",
                    matchedText: block.code.trim().slice(0, 80),
                });
            }
        }

        // --- JS/TS blocks: phantom API + package name checks ---
        if (lang === "js" || lang === "javascript" || lang === "ts" || lang === "typescript") {
            violations = violations.concat(applyRules(block.code, JS_TS_RULES));
            violations = violations.concat(checkCoreInitCalls(block.code));
            violations = violations.concat(checkNpmEngineGlobal(block.code));
        }

        // --- HTML blocks: CDN URL checks ---
        if (lang === "html") {
            violations = violations.concat(applyRules(block.code, HTML_RULES));
            // Also check for JS inside HTML
            violations = violations.concat(applyRules(block.code, JS_TS_RULES));
            // HTML-04 — guards the engine's ABSENCE in a recipe (see its block)
            violations = violations.concat(checkMapLibrePresence(block.code));
            // DOCS-CORE-INIT reads the inline scripts, the only JS the block runs
            for (const script of inlineScripts(block.code)) {
                violations = violations.concat(checkCoreInitCalls(script));
            }
        }

        // --- Bash/shell blocks: npm install package name check ---
        if (lang === "bash" || lang === "sh" || lang === "shell" || lang === "zsh") {
            violations = violations.concat(applyRules(block.code, BASH_RULES));
        }

        if (violations.length > 0) {
            allViolations.push({
                file: relFile,
                blockNum,
                lang,
                startLine: block.startLine,
                violations,
            });
        }
    }
}

// ---------------------------------------------------------------------------
// 2nd corpus — the sources' TSDoc `@example`s
//
// This deny-list had the right MOTIVE but the wrong CORPUS: it caught a ghost API in a
// `.md` and let it through in an `@example`, while both ship on npm and are
// copy-pastable identically. An `@example` citing `POIModule` (a long-dissolved class)
// lived that way in `core-module.contract.ts`.
//
// ⚠️ The corpus is shared with `typecheck-docs-examples.cjs` through
// `lib/tsdoc-examples.cjs`, not copied: two extractors would have diverged.
//
// ⚠️ And it is NOT `typecheck-docs-examples` that needed widening. That script already
// compiles these blocks, but it ignores `TS2304` ("Cannot find name") **rightly** —
// its header motivates it: an example often elides its setup, and surfacing that class
// would bury its eight real defects under seventy-five false ones. The right move is
// thus to extend the deny-list's corpus, not the compiler's codes.
const tsdocFiles = sourceFiles();
let tsdocBlocks = 0;
for (const srcFile of tsdocFiles) {
    const examples = extractTsdocExamples(fs.readFileSync(srcFile, "utf8"));
    const relFile = path.relative(ROOT, srcFile);
    let blockNum = 0;
    for (const ex of examples) {
        blockNum++;
        tsdocBlocks++;
        totalBlocks++;
        const violations = applyRules(ex.code, JS_TS_RULES)
            .concat(checkCoreInitCalls(ex.code))
            .concat(checkNpmEngineGlobal(ex.code));
        if (violations.length > 0) {
            allViolations.push({
                file: relFile,
                blockNum,
                lang: "@example",
                startLine: ex.startLine,
                violations,
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const sep = "─".repeat(72);
const errorCount = allViolations.reduce(
    (n, b) => n + b.violations.filter((v) => v.severity === "error").length,
    0
);
const warnCount = allViolations.reduce(
    (n, b) => n + b.violations.filter((v) => v.severity === "warn").length,
    0
);

if (allViolations.length === 0) {
    console.log(sep);
    console.log(`✅  validate-docs-examples — 0 violations`);
    console.log(
        `    Scanned ${mdFiles.length} .md + ${tsdocFiles.length} source(s), ` +
            `${totalBlocks} block(s) (${totalBlocks - tsdocBlocks} .md + ${tsdocBlocks} @example TSDoc)`
    );
    if (jsonErrors === 0) console.log(`    ✅  All JSON blocks are syntactically valid`);
    console.log(sep);
    process.exit(0);
} else {
    console.log(sep);
    console.log(
        `❌  validate-docs-examples — ${errorCount} error(s), ${warnCount} warning(s) across ${allViolations.length} block(s)\n`
    );
    console.log(`    Scanned ${mdFiles.length} file(s), ${totalBlocks} code block(s)\n`);

    for (const entry of allViolations) {
        const errLabel = entry.violations
            .map((v) => (v.severity === "error" ? "❌" : "⚠️"))
            .join(" ");
        console.log(
            `  ${errLabel}  ${entry.file} — block #${entry.blockNum} (${entry.lang}, line ~${entry.startLine})`
        );
        for (const v of entry.violations) {
            const icon = v.severity === "error" ? "  ❌" : "  ⚠️";
            console.log(`${icon}  ${v.message}`);
            if (VERBOSE) {
                console.log(`       matched: ${v.matchedText}`);
            }
        }
        console.log("");
    }
    console.log(sep);
    process.exit(errorCount > 0 ? 1 : 0);
}
