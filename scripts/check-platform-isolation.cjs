#!/usr/bin/env node
/**
 * @file check-platform-isolation.cjs
 * @description PLATFORM-ISO — the navigation plugin touches browser platform APIs from
 * `src/platform/` and from nowhere else.
 *
 * ## What it asserts
 *
 *   PI-00  The corpus is identified. Three outcomes, and only one of them is a verdict:
 *          the package is in the registry (scan), the package is on disk but not yet in
 *          the registry (scan, with a note), or neither (SKIP — explicitly not a green).
 *   PI-01  No `navigator.geolocation`, `speechSynthesis` or `navigator.wakeLock` outside
 *          `src/platform/`.
 *   PI-02  Anti-empty-corpus floor. The package exists but zero files were scanned — the
 *          gate would report "no violation" while measuring nothing.
 *
 * ## Why the scope is the plugin and NOT the repository (decision D9)
 *
 * Measured on 2026-08-20 and again on 2026-08-21: the repository already carries seven
 * legitimate `navigator.geolocation` sites outside any `platform/` directory — the core
 * geolocation capability (`capabilities/geolocation/`) and the GPS tool of `measure`.
 * Swept repository-wide, this gate would be BORN RED on code it has no business judging,
 * and a gate born red gets disarmed. The isolation being defended is an architectural
 * property of THIS plugin: three adapters are the single point of contact with the
 * browser, which is what makes a later native port tractable.
 *
 * ## Why the registry AND the disk, rather than either alone
 *
 * A hard-coded path does not break when a package moves: it stops matching, in silence,
 * and the gate goes green having scanned nothing. That is why the package is resolved
 * through `lib/packages.cjs` first.
 *
 * But the registry alone has the mirror blindness: a directory that exists on disk
 * without a `package.json` is invisible to `workspaces`, so a registry-only gate would
 * SKIP over a real, populated source tree and call it "not there yet". Both lookups are
 * therefore performed, and their DISAGREEMENT is reported rather than silently resolved.
 *
 * ## What this gate does NOT catch, and it matters before trusting it
 *
 * It reads the syntax tree, so a comment or a string mentioning `navigator.geolocation`
 * is correctly ignored — but an alias defeats it (`const n = navigator; n.geolocation`),
 * and so does a dynamic access (`navigator["geo" + "location"]`). It is a tripwire on
 * the obvious form, not a proof of isolation. The three names come from D9 and are not
 * a list to grow by analogy: adding one is a decision about what "platform" means, not
 * a maintenance act.
 *
 * Usage:  node scripts/check-platform-isolation.cjs
 * Exit codes: 0 conforming or motivated skip · 1 violation or collapsed corpus · 2 tooling error.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");
const ROOT = registry.ROOT;

/** The package this gate defends, by its manifest name. */
const PKG_NAME = "@geoleaf-plugins/navigation";

/**
 * Where the package lives when the registry cannot see it yet.
 *
 * Named ONCE, here, next to the registry lookup it backs up — never used as the primary
 * resolution. See the header: this exists to catch the registry and the disk disagreeing,
 * which is the failure a registry-only gate cannot report.
 */
const FALLBACK_DIR = path.join(ROOT, "packages", "plugins", "navigation");

/** The directory that is ALLOWED to touch the platform, relative to the package. */
const ADAPTERS_DIR = path.join("src", "platform");

/** Directories that carry no shipped code, skipped by scope rather than by name list. */
const PRUNED = new Set(["node_modules", "dist", "coverage", "__tests__", "__mocks__"]);

/** Files that are not shipped code, skipped by scope for the same reason. */
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Extensions the TypeScript parser is asked to read. */
const SOURCE_RE = /\.[cm]?[jt]sx?$/;

/**
 * The forbidden accesses, from decision D9 — verbatim, and closed.
 *
 * @type {{re: RegExp, label: string}[]}
 */
const FORBIDDEN = [
    { re: /^(globalThis\.|window\.)?navigator\.geolocation$/, label: "navigator.geolocation" },
    { re: /^(globalThis\.|window\.)?speechSynthesis$/, label: "speechSynthesis" },
    { re: /^(globalThis\.|window\.)?navigator\.wakeLock$/, label: "navigator.wakeLock" },
];

/**
 * Every source file under `dir`, recursively, minus the pruned scopes.
 *
 * @param {string} dir Absolute directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function sourceFiles(dir) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} d */
    function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) {
                if (PRUNED.has(e.name)) continue;
                walk(path.join(d, e.name));
            } else if (SOURCE_RE.test(e.name) && !TEST_FILE_RE.test(e.name)) {
                out.push(path.join(d, e.name));
            }
        }
    }
    walk(dir);
    return out;
}

/**
 * The forbidden accesses in one file, read from the syntax tree.
 *
 * Property accesses are matched on their printed text, so `window.navigator.geolocation`
 * and `navigator.geolocation` both land; a bare `speechSynthesis` identifier is matched
 * only when it is NOT the right-hand side of a property access, which is what keeps
 * `myAdapter.speechSynthesis` from being reported as a platform call.
 *
 * @param {string} abs Absolute file path.
 * @returns {{line: number, label: string, text: string}[]}
 */
function violationsIn(abs) {
    const src = ts.createSourceFile(
        abs,
        fs.readFileSync(abs, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    /** @type {{line: number, label: string, text: string}[]} */
    const hits = [];

    /** @param {import("typescript").Node} node */
    function visit(node) {
        /** @type {string | null} */
        let text = null;
        if (ts.isPropertyAccessExpression(node)) {
            text = node.getText(src);
        } else if (
            ts.isIdentifier(node) &&
            node.text === "speechSynthesis" &&
            !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        ) {
            text = node.text;
        }

        if (text !== null) {
            const flat = text.replace(/\s+/g, "");
            for (const f of FORBIDDEN) {
                if (f.re.test(flat)) {
                    const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
                    hits.push({ line: line + 1, label: f.label, text: flat });
                    break;
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(src);
    return hits;
}

// ─── PI-00 — identify the corpus, or refuse to conclude ──────────────────────

const inRegistry = registry.all().find((p) => p.name === PKG_NAME);
const onDisk = fs.existsSync(FALLBACK_DIR) && fs.statSync(FALLBACK_DIR).isDirectory();

if (!inRegistry && !onDisk) {
    console.log(
        `⏭️  [PLATFORM-ISO/PI-00] SAUTÉ — le paquet \`${PKG_NAME}\` n'existe ni au registre ` +
            `ni sur le disque.`
    );
    console.log(
        `    chemin essayé : ${path.relative(ROOT, FALLBACK_DIR)}\n` +
            `    🛑 Ce n'est PAS un vert : rien n'a été scanné, donc rien n'est prouvé. Le plugin\n` +
            `    naît au sprint 1 ; ce saut deviendra un verdict le jour où il aura des sources.`
    );
    process.exit(0);
}

const pkgDir = inRegistry ? inRegistry.absDir : FALLBACK_DIR;

if (!inRegistry) {
    console.log(
        `ℹ️  [PLATFORM-ISO/PI-00] le répertoire existe mais le paquet n'est PAS au registre — ` +
            `il n'a pas encore de \`package.json\`, donc \`workspaces\` ne le voit pas.`
    );
    console.log(`    Scanné quand même : ${path.relative(ROOT, pkgDir)}`);
}

// ─── PI-01 / PI-02 — balayer ─────────────────────────────────────────────────

/** @type {string[]} */
let files;
try {
    files = sourceFiles(pkgDir);
} catch (err) {
    console.error(`ERROR [PLATFORM-ISO]: lecture de ${path.relative(ROOT, pkgDir)} — ${err}`);
    process.exit(2);
}

const adaptersAbs = path.join(pkgDir, ADAPTERS_DIR);
/** @type {{rel: string, line: number, label: string, text: string}[]} */
const pi01 = [];
let scannedOutsideAdapters = 0;

for (const abs of files) {
    if (abs.startsWith(adaptersAbs + path.sep)) continue;
    scannedOutsideAdapters += 1;
    for (const v of violationsIn(abs)) {
        pi01.push({ rel: path.relative(ROOT, abs), line: v.line, label: v.label, text: v.text });
    }
}

// PI-02 — the floor. A package present but without a single source outside the
// adapters would render "0 violations" having measured nothing: the false-green
// this repo names its costliest class.
if (files.length === 0) {
    console.error(
        `ERROR [PLATFORM-ISO/PI-02]: ${path.relative(ROOT, pkgDir)} existe mais ne porte ` +
            `AUCUN fichier source scannable.`
    );
    console.error(
        "  Un « 0 violation » obtenu sur un corpus vide est indiscernable d'une conformité.\n" +
            "  Vérifier les extensions attendues et les répertoires élagués AVANT de toucher au seuil."
    );
    process.exit(1);
}

if (pi01.length > 0) {
    console.error(
        `ERROR [PLATFORM-ISO/PI-01]: ${pi01.length} accès plateforme hors \`${ADAPTERS_DIR}\` :`
    );
    for (const v of pi01) console.error(`  ${v.rel}:${v.line} — ${v.label}  (\`${v.text}\`)`);
    console.error("");
    console.error(
        `  Le geste : déplacer l'appel dans \`${ADAPTERS_DIR}/\` et le consommer par son\n` +
            "  adaptateur. Les trois adaptateurs SONT le seul point de contact avec le navigateur —\n" +
            "  c'est cette propriété qui rend un portage natif ultérieur possible, et elle ne\n" +
            "  survit pas à une exception."
    );
    process.exit(1);
}

const adaptersCount = files.length - scannedOutsideAdapters;
console.log(
    `✅ [PLATFORM-ISO] ${scannedOutsideAdapters} fichier(s) hors \`${ADAPTERS_DIR}\` sans accès ` +
        `plateforme, ${adaptersCount} dans les adaptateurs (non jugés, c'est leur rôle).`
);
console.log(
    `   périmètre : ${path.relative(ROOT, pkgDir)} — ${files.length} source(s), ` +
        `hors ${[...PRUNED].join(", ")} et hors *.test.* / *.spec.*`
);
process.exit(0);
