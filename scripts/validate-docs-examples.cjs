#!/usr/bin/env node
/**
 * validate-docs-examples.cjs
 *
 * Static analyser for code examples embedded in Markdown files inside docs/.
 *
 * Rules applied per language:
 *   json  — JSON.parse() validity check
 *   js/ts — phantom API patterns, wrong package names, stale CDN URLs
 *   bash  — wrong npm install package names
 *   html  — stale CDN script/link src attributes
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
// T5.5 — le défaut vient du registre (qui jette), l'argument `--dir` reste roi.
const { extractTsdocExamples, sourceFiles, productDocsFiles } = require("./lib/tsdoc-examples.cjs");

// 31/07/2026 — le périmètre passe de UN répertoire aux surfaces PRODUIT, et il est dérivé
// dans `lib/tsdoc-examples.cjs` pour que `typecheck-docs-examples` lise exactement le même
// (motif complet sur `productDocsFiles`). `--dir` reste roi et force un scope unique.
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
    // ── Doc V3 Étape 3 item 4 — la dissolution POI (S9), documentée mais pas gatée ──
    //
    // `GeoLeaf.POI` a été retiré du core : une POI est désormais une couche point GeoJSON
    // générique. Trois exemples COPIABLES survivaient sur la doc publiée
    // (`USER_GUIDE.md`, `helpers/`, `security/`) — un intégrateur qui les recopie prend un
    // TypeError. Le message de migration n'est pas inventé : il est recopié de
    // `docs/CHANGELOG.md` §[3.0.0], qui le porte déjà mot pour mot.
    //
    // ⚠️ LA PORTÉE EST LE BLOC DE CODE, et c'est load-bearing. Le même nom apparaît
    // **légitimement** 6 fois en PROSE : 5 dans `CHANGELOG.md` sous `## [3.0.0]` et 1 dans
    // `COOKBOOK.md` (« BREAKING — GeoLeaf.POI.init() no longer exists »). Un registre de
    // rupture DOIT nommer l'API retirée : c'est la seule information qui relie le code d'un
    // intégrateur à sa migration. Or ce script n'applique `JS_TS_RULES` qu'aux blocs
    // clôturés — l'exemption découle donc du CORPUS, pas d'une allow-list, et ne peut pas
    // dériver. Implémentée comme un `grep` de fichier entier, cette règle rougirait sur les
    // 6 légitimes et le contributeur suivant la contournerait : c'est la mécanique que
    // l'en-tête de ce script décrit déjà pour son parseur JSON.
    // 🛑 **CE MESSAGE A PRESCRIT UNE API FANTÔME PENDANT QU'IL EN INTERDISAIT UNE AUTRE**
    // (corrigé le 11/08/2026). Il renvoyait vers `GeoLeaf.AddPOI.*` / `@geoleaf-plugins/addpoi`,
    // c'est-à-dire le plugin **fusionné dans `editor` au Sprint 5** : un lecteur qui suivait la
    // remédiation à la lettre remplaçait une API dissoute par un paquet inexistant. C'est la
    // classe même que cette règle traque, à l'endroit qui la traque — et aucune gate ne peut la
    // voir : le corpus scanné, ce sont les `.md` et les `@example`, jamais le texte des règles.
    // La surface réelle est vérifiée dans `packages/plugins/editor/src/public-api.ts` (façade
    // montée sur `GeoLeaf.Editor` par `entry.ts`) : `AddForm` et `PlacementMode` sont des
    // getters de cette façade.
    {
        pattern: /GeoLeaf\s*\.\s*POI\s*\./,
        message:
            "Phantom API: GeoLeaf.POI was removed from the core at S9 (POI dissolution) — a POI is now a plain GeoJSON point layer. Read/mutate through GeoLeaf.Layers.getFeatures / getFeatureById / addFeature / mergeFeatures / setData; style and click-render per layer via layers.<id>.capabilities.{taxonomy,cluster,feature-info}. For interactive point creation use GeoLeaf.Editor.AddForm / GeoLeaf.Editor.PlacementMode (@geoleaf-plugins/editor).",
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
    // MapLibre 6 n'exporte pas de `default`. Cette règle vit ici, dans les règles JS/TS, et
    // non parmi les règles HTML où sa jumelle a d'abord été écrite : les blocs `html` passent
    // AUSSI par JS_TS_RULES (voir plus bas), donc la placer ici la fait porter sur les deux
    // corpus, tandis que l'inverse la laissait inerte sur tout bloc `ts`/`js`. Une règle rangée
    // dans le mauvais tableau sort verte sans jamais rien regarder.
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
    // ─── MapLibre 6 — les trois règles ont été RETOURNÉES ────────────────────
    // Elles interdisaient jusqu'ici `<script type="module" src="…maplibre-gl….js">`, parce que
    // la v5 était distribuée en script CLASSIQUE (`main: dist/maplibre-gl.js`, sans `module`
    // ni `exports`). **En v6 c'est l'inverse, et exactement l'inverse** : la distribution est
    // ESM-only, `maplibre-gl.js` et `maplibre-gl-csp.js` ne sont plus publiés du tout, et la
    // carte `exports` n'expose que `import`. La forme autrefois interdite est devenue la
    // seule qui boote.
    //
    // ⚠️ Les deux anciennes regexes ne pouvaient pas être laissées en place « au cas où » :
    // elles cherchent `…maplibre-gl[^"']*\.js`, motif qu'un `.mjs` ne contient PAS. Conservées,
    // elles seraient sorties vertes sur n'importe quoi — une gate décorative, ce qui est pire
    // qu'une gate absente. C'est la même classe que le corpus tronqué de 6.7b : la règle avait
    // raison, son instrument ne portait plus.
    {
        pattern: /(?:src|href)=["'][^"']*maplibre-gl(?:-csp)?\.js(?![\w-])/,
        message:
            "Artefact MapLibre disparu : `maplibre-gl.js` / `maplibre-gl-csp.js` ne sont PLUS " +
            "publiés depuis la v6 (distribution ESM-only). Cette recette rend un 404. Charger " +
            "`maplibre-gl.mjs` en <script type=\"module\">, ou le shim `vendor/maplibre-gl/global.mjs`.",
        severity: "error",
    },
    {
        // Le symétrique : un `.mjs` chargé en script CLASSIQUE. La négative lookahead porte sur
        // la balise entière, donc elle couvre les DEUX ordres d'attributs d'un coup — là où les
        // deux règles jumelées d'avant devaient être écrites en double pour la même raison.
        pattern: /<script(?![^>]*\stype=["']module["'])[^>]*\ssrc=["'][^"']*maplibre-gl[^"']*\.mjs/,
        message:
            "MapLibre `.mjs` chargé en script classique — un module ne s'exécute que sous " +
            'type="module". Sans lui le navigateur refuse le fichier et la carte ne boote pas.',
        severity: "error",
    },
];

// ---------------------------------------------------------------------------
// HTML-04 — la règle qui garde une ABSENCE
// ---------------------------------------------------------------------------
//
// 🛑 Les règles ci-dessus, TOUTES, gardent une PRÉSENCE fautive : elles cherchent un motif et
// rougissent quand il est là. Aucune ne peut voir ce qui MANQUE — et le défaut mesuré le
// 08/08/2026 est précisément une absence : des recettes complètes qui chargent la feuille de
// style de MapLibre et le bundle GeoLeaf, mais jamais le JavaScript de MapLibre. `geoleaf.esm.js`
// déclare `maplibre-gl` en `external` (rollup.config.mjs) et ne l'atteint que par
// `globalThis.maplibregl` ; la v6 étant ESM-only, plus rien ne pose ce global tout seul. Une
// recette sans shim rend donc une page qui ne boote pas.
//
// ⚠️ Ce défaut a été trouvé et corrigé DEUX FOIS sans qu'une gate le retienne — `usage-cdn.md`
// et les deux README (6.7b) —, et il est revenu une troisième fois dans `USER_GUIDE.md` et
// `FAQ.md`, que la passe v6 n'a pas balayés. Trois découvertes manuelles de la même classe :
// c'est ce qui justifie une règle plutôt qu'une relecture de plus.
//
// LE CRITÈRE — et il est plus étroit que « le bloc cite le bundle », délibérément. Charger
// `geoleaf.esm.js` sans MapLibre ne lève PAS : le global n'est lu qu'à la création de la carte.
// La règle ne mord donc que sur les blocs qui BOOTENT une carte. Les blocs qui illustrent
// autre chose (ordre de chargement, apparition de `window.GeoLeaf`, une clé de config) restent
// verts sans avoir à se déclarer — il y en a 6 dans le corpus, et les alourdir de quatre lignes
// de shim noierait ce qu'ils montrent.
//
// ⚠️ Les commentaires sont neutralisés avant le test. Sans ça, `NOTIFICATIONS_API.md` rougissait
// sur un « // After GeoLeaf.boot() » en commentaire — le faux positif exact que PNC-02 et la
// garde ESM ont déjà payé chacune une fois. Un faux positif de garde coûte plus cher qu'un vrai
// négatif : il envoie corriger du code sain.

/** Un bloc qui porte ce marqueur déclare être un fragment, et sort du champ de HTML-04. */
const FRAGMENT_MARKER = /<!--\s*geoleaf:docs:fragment\b/;

/** Une forme, quelle qu'elle soit, qui charge le JavaScript de MapLibre. */
const MAPLIBRE_JS_LOAD =
    /maplibre-gl[^"'\s]*\.mjs|from\s+["']maplibre-gl["']|global\.mjs|maplibre-gl[^"'\s]*\.js(?![\w-])/;

/** Le bloc crée une carte — c'est là, et seulement là, que le global est lu. */
const BOOTS_A_MAP = /\b(?:GeoLeaf|Core)\s*\.\s*(?:init|boot)\s*\(|new\s+maplibregl\.Map\s*\(/;

const GEOLEAF_BUNDLE = /geoleaf\.esm\.js/;

/**
 * Neutralise commentaires HTML et JS pour qu'une simple MENTION ne se lise jamais comme un appel.
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
 * HTML-04 — tout bloc `html` qui boote une carte avec le bundle GeoLeaf doit charger MapLibre JS.
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
                "</script>` — ou, en auto-hébergé, `<script type=\"module\" src=\"…/global.mjs\">`. " +
                "Si ce bloc est un fragment délibéré, le déclarer par " +
                "`<!-- geoleaf:docs:fragment — motif -->`.",
            severity: "error",
            matchedText: (code.match(GEOLEAF_BUNDLE) || ["geoleaf.esm.js"])[0],
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
        }

        // --- HTML blocks: CDN URL checks ---
        if (lang === "html") {
            violations = violations.concat(applyRules(block.code, HTML_RULES));
            // Also check for JS inside HTML
            violations = violations.concat(applyRules(block.code, JS_TS_RULES));
            // HTML-04 — la seule règle du fichier qui garde une ABSENCE (voir son bloc)
            violations = violations.concat(checkMapLibrePresence(block.code));
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
// 2ᵉ corpus (B-75) — les `@example` du TSDoc des sources
//
// Cette deny-list avait le bon MOTIF mais le mauvais CORPUS : elle attrapait une API
// fantôme dans un `.md` et la laissait passer dans un `@example`, alors que les deux
// partent sur npm et sont copiables-collables à l'identique. Un `@example` citant
// `POIModule` (classe dissoute au S9) a vécu ainsi dans `core-module.contract.ts`.
//
// ⚠️ Le corpus est partagé avec `typecheck-docs-examples.cjs` via
// `lib/tsdoc-examples.cjs`, il n'est pas recopié : deux extracteurs auraient divergé.
//
// ⚠️ Et ce n'est PAS `typecheck-docs-examples` qu'il fallait élargir. Ce script-là
// compile déjà ces blocs, mais il ignore `TS2304` (« Cannot find name ») **à raison** —
// son en-tête le motive : un exemple élide souvent son setup, et remonter cette classe
// enterrerait ses huit défauts réels sous soixante-quinze faux. Le geste juste est donc
// d'étendre le corpus de la deny-list, pas les codes du compilateur.
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
        const violations = applyRules(ex.code, JS_TS_RULES);
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
