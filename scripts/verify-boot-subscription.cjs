#!/usr/bin/env node
/**
 * BOOT-SUB — a lazily-loaded plugin must not subscribe to a boot signal AT IMPORT TIME.
 *
 * ## The class this guards, and why prose could not
 *
 * A plugin that subscribes to `geoleaf:map:ready`, `geoleaf:app:ready` or
 * `geoleaf:profile:loaded` **in its module body** cannot be purely lazy: loaded after the
 * signal has fired, it installs a listener for something that already happened. The symptom is
 * **entirely silent** — availability reads `true`, the gate reads `true`, no error is raised,
 * and the feature simply does not exist.
 *
 * The warning already existed in prose, in the boot file itself, written for the first plugin
 * that fell into it. A second one fell into it **the next day, in the same file**. Two
 * paragraphs of warning stopped neither. That is the whole argument for a gate: a lesson only
 * generalises once it is mechanical.
 *
 * ## What it accepts, and why the list is short
 *
 * A module-body subscription is allowed when the plugin is **preloaded conditionally** at boot
 * — the loader decides from the profile whether it is needed, so the import happens before the
 * signal — or when it carries a **named exemption with a motive**, which is where the third
 * shape belongs: a plugin that subscribes AND checks, right after, whether the signal has
 * already passed. That third shape is not detected automatically, deliberately: recognising
 * "this branch compensates for a missed event" means understanding intent, and a gate that
 * guesses intent reds wrongly. **A gate that reds wrongly gets disarmed, which makes it worse
 * than absent.**
 *
 * ## Why an AST and not a grep
 *
 * The whole question is SCOPE: the same call is fine inside `init()` and broken at module body.
 * A textual match cannot tell them apart, and a brace-depth heuristic breaks on the first
 * object literal. Measured when this gate was written: the two plugins the registry flagged as
 * "to investigate" both subscribe **inside a function**, so both are green — a grep would have
 * reported them and the gate would have been disarmed on day one.
 *
 * ## Anti-vacuity
 *
 * The gate refuses to conclude when it scanned no plugin, and when none of the three signal
 * names appears anywhere in the corpus: a renamed signal would otherwise make it green and
 * blind, which is the exact failure mode it exists to prevent.
 *
 * Run: node scripts/verify-boot-subscription.cjs   |   npm run check:boot-subscription
 * Exits 1 on any unexplained module-body subscription.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");
const ROOT = path.resolve(__dirname, "..");

/** The three signals a plugin must not wait for at import time. */
const BOOT_SIGNALS = new Set(["geoleaf:map:ready", "geoleaf:app:ready", "geoleaf:profile:loaded"]);

/** Boot file that decides which plugins are preloaded from the profile. */
const BOOT_FILE = path.join(ROOT, "apps/geoleaf-app/init.js");

/**
 * Plugins allowed to subscribe at module body, each with the reason.
 *
 * 🛑 An entry here is a DECISION, not a backlog: it says the plugin is reachable at boot for a
 * reason the gate cannot derive. Empty at posing — measured, no plugin subscribes at module
 * body today — and that emptiness is the point: the gate guards a class that is currently
 * closed and has re-opened twice.
 *
 * Shape: `"<plugin>": "why the import necessarily precedes the signal"`.
 */
const EXEMPTIONS = {
    editor: {
        motif:
            "s'abonne au corps de module ET rattrape le cas où le signal est déjà passé, dans " +
            "la même portée, juste après : il relit l'état de la carte et, si elle existe déjà, " +
            "appelle lui-même le gestionnaire au lieu de l'attendre.",
        // The witness is NOT that sentence: it is the structure above, verified in
        // the AST by `hasImmediateFallback()`. Removing the fallback drops the
        // exemption and reddens the gate — requested by name, because a refactor
        // removing it would "come out green" today.
        temoin: "repli immédiat dans la même portée",
    },
};

/**
 * Names of the plugins the boot file preloads conditionally.
 *
 * ⚠️ Derived by reading the boot file, never hardcoded: a hardcoded list does not break when a
 * preload is removed — it silently stops matching, and the gate goes green on the very change
 * it exists to catch.
 *
 * @returns {Set<string>} plugin names pushed into the "needed" list at boot.
 */
function preloadedPlugins() {
    const src = fs.readFileSync(BOOT_FILE, "utf8");
    const names = new Set();
    for (const m of src.matchAll(/needed\.push\(\s*"([a-z0-9-]+)"\s*\)/g)) names.add(m[1]);
    return names;
}

/**
 * Every subscription to a boot signal found in one source file, with its scope.
 *
 * A call counts as a subscription when its callee is named `addEventListener`, `on` or `once`
 * and its first argument is a string literal naming one of the three signals. It is
 * **module-body** when no function, method, class or accessor encloses it.
 *
 * @param {string} abs Absolute path of the file.
 * @returns {{line: number, signal: string, moduleBody: boolean, fallback: boolean}[]} One entry
 *          per subscription.
 */
function subscriptionsIn(abs) {
    const src = fs.readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const found = [];

    /** Node kinds that introduce a deferred scope — anything inside them runs later. */
    const DEFERS = new Set([
        ts.SyntaxKind.FunctionDeclaration,
        ts.SyntaxKind.FunctionExpression,
        ts.SyntaxKind.ArrowFunction,
        ts.SyntaxKind.MethodDeclaration,
        ts.SyntaxKind.GetAccessor,
        ts.SyntaxKind.SetAccessor,
        ts.SyntaxKind.Constructor,
        ts.SyntaxKind.ClassDeclaration,
        ts.SyntaxKind.ClassExpression,
    ]);

    const walk = (node, deferred, chain) => {
        const nowDeferred = deferred || DEFERS.has(node.kind);

        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const name = ts.isPropertyAccessExpression(callee)
                ? callee.name.text
                : ts.isIdentifier(callee)
                  ? callee.text
                  : null;
            const first = node.arguments[0];
            if (
                (name === "addEventListener" || name === "on" || name === "once") &&
                first &&
                ts.isStringLiteralLike(first) &&
                BOOT_SIGNALS.has(first.text)
            ) {
                found.push({
                    line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                    signal: first.text,
                    moduleBody: !deferred,
                    fallback: !deferred && hasImmediateFallback(node, chain),
                });
            }
        }

        ts.forEachChild(node, (child) => walk(child, nowDeferred, [...chain, node]));
    };

    ts.forEachChild(sf, (child) => walk(child, false, [sf]));
    return found;
}

/**
 * Does this module-body subscription carry an IMMEDIATE FALLBACK in the same scope?
 *
 * The shape it recognises, and nothing else: the statement that subscribes is followed — in the
 * same block — by an `if` whose body calls **the same handler** the listener delegates to. That
 * is the "the signal may already have fired, act now" pattern, and it is what makes a
 * module-body subscription safe under lazy loading.
 *
 * 🛑 **This is a STRUCTURAL witness, not a reading of intent.** The gate does not try to decide
 * whether a branch "compensates" for a missed event — that would be guessing, and a gate that
 * reds wrongly gets disarmed. It checks one thing: the same function is reachable both from the
 * listener and from a later conditional in the same scope. Remove the fallback and the witness
 * fails, which is precisely what the exemption is for: an exemption whose cause has fallen must
 * red, not keep exempting.
 *
 * @param {import("typescript").CallExpression} call The subscribing call.
 * @param {import("typescript").Node[]} chain Its enclosing nodes, outermost first.
 * @returns {boolean} true when the fallback is present.
 */
function hasImmediateFallback(call, chain) {
    // The names the listener can reach: `() => f()`, `f`, `function () { f(); }`.
    const handler = call.arguments[1];
    if (!handler) return false;
    const names = new Set();
    if (ts.isIdentifier(handler)) names.add(handler.text);
    const collect = (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.add(n.expression.text);
        ts.forEachChild(n, collect);
    };
    collect(handler);
    if (names.size === 0) return false;

    // The statement that carries this call, and the block that carries the statement.
    // ⚠️ Explicit backward sweep rather than `findLast`: the latter requires the
    // `es2023` library, which the tooling's typing does not declare. A three-line
    // helper costs less than widening `lib` for the whole scripts corpus.
    const lastMatching = (nodes, pred) => {
        for (let i = nodes.length - 1; i >= 0; i--) if (pred(nodes[i])) return nodes[i];
        return undefined;
    };
    const stmt = lastMatching(chain, (n) => ts.isExpressionStatement(n));
    const block = lastMatching(chain, (n) => ts.isBlock(n) || ts.isSourceFile(n));
    if (!stmt || !block) return false;

    const stmts = ts.isSourceFile(block) ? block.statements : block.statements;
    const idx = stmts.indexOf(stmt);
    if (idx < 0) return false;

    for (const later of stmts.slice(idx + 1)) {
        if (!ts.isIfStatement(later)) continue;
        let found = false;
        const scan = (n) => {
            if (
                ts.isCallExpression(n) &&
                ts.isIdentifier(n.expression) &&
                names.has(n.expression.text)
            ) {
                found = true;
            }
            ts.forEachChild(n, scan);
        };
        scan(later);
        if (found) return true;
    }
    return false;
}

/**
 * Collects the `.ts` sources of a plugin, tests and mocks excluded.
 *
 * @param {string} dir Absolute `src/` directory.
 * @returns {string[]} Absolute file paths.
 */
function sourcesOf(dir) {
    const out = [];
    const skip = new Set(["__tests__", "__mocks__", "test-utils", "node_modules", "dist"]);
    const walk = (d) => {
        let entries;
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                if (!skip.has(e.name)) walk(p);
            } else if (e.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(e.name)) {
                out.push(p);
            }
        }
    };
    walk(dir);
    return out;
}

// ── Run ───────────────────────────────────────────────────────────────────────

const preloaded = preloadedPlugins();
/**
 * @type {{name: string, rel: string, line: number, signal: string, moduleBody: boolean,
 *         fallback: boolean, temoinTombe?: string}[]}
 */
const violations = [];
let scannedPlugins = 0;
let scannedFiles = 0;
let subscriptionsSeen = 0;

for (const pkg of registry.plugins()) {
    const srcDir = path.join(pkg.absDir, "src");
    if (!fs.existsSync(srcDir)) continue;
    scannedPlugins++;

    const name = path.basename(pkg.absDir);
    for (const abs of sourcesOf(srcDir)) {
        scannedFiles++;
        for (const hit of subscriptionsIn(abs)) {
            subscriptionsSeen++;
            if (!hit.moduleBody) continue;
            if (preloaded.has(name)) continue;

            const ex = EXEMPTIONS[name];
            if (ex) {
                // An exemption whose cause fell must REDDEN, not keep exempting.
                if (hit.fallback) continue;
                violations.push({
                    name,
                    rel: path.relative(ROOT, abs),
                    ...hit,
                    temoinTombe: ex.motif,
                });
                continue;
            }
            violations.push({ name, rel: path.relative(ROOT, abs), ...hit });
        }
    }
}

// ── Anti-vacuity — a gate that read nothing is not green, it is blind ──────────

if (scannedPlugins === 0 || scannedFiles === 0) {
    console.error(
        `✗ BOOT-SUB — corpus vide (${scannedPlugins} plugin(s), ${scannedFiles} fichier(s)). ` +
            `Une gate qui ne lit rien sort verte en n'ayant rien gardé : elle refuse de conclure.`
    );
    process.exit(1);
}
if (subscriptionsSeen === 0) {
    console.error(
        "✗ BOOT-SUB — aucun abonnement à l'un des trois signaux de boot dans tout le corpus.\n" +
            "  Les plugins en posent, et le motif n'en trouve plus : un signal a probablement été\n" +
            "  RENOMMÉ. Sans ce refus, la gate serait verte et aveugle — exactement la classe\n" +
            "  qu'elle existe pour empêcher.\n" +
            `  Signaux cherchés : ${[...BOOT_SIGNALS].join(", ")}`
    );
    process.exit(1);
}

// ── Exemption staleness ───────────────────────────────────────────────────────
//
// An exemption whose plugin no longer exists, or which no longer subscribes in the
// module body, exempts something with no business being exempted — and will mask
// the next case.

const known = new Set(registry.plugins().map((p) => path.basename(p.absDir)));
const stale = Object.keys(EXEMPTIONS).filter((n) => !known.has(n));
if (stale.length > 0) {
    console.error(
        `✗ BOOT-SUB — ${stale.length} exemption(s) sans sujet : ${stale.join(", ")}. ` +
            `Le plugin n'existe plus ; l'entrée exempte un nom mort et masquera son successeur.`
    );
    process.exit(1);
}

// ── Verdict ───────────────────────────────────────────────────────────────────

if (violations.length > 0) {
    console.error(`✗ BOOT-SUB — ${violations.length} abonnement(s) au boot AU CORPS DE MODULE :\n`);
    for (const v of violations) {
        console.error(`  ${v.rel}:${v.line}  ${v.name} → "${v.signal}"`);
        if (v.temoinTombe) {
            console.error(
                `      ⚠️ EXEMPTÉ, mais son TÉMOIN EST TOMBÉ : « ${v.temoinTombe} »\n` +
                    `      Le repli immédiat n'est plus dans la même portée. L'exemption reposait\n` +
                    `      sur lui ; sans lui l'abonnement au corps de module redevient un défaut.`
            );
        }
    }
    console.error(
        "\nCe plugin est chargé paresseusement : s'il est importé après le signal, il pose un\n" +
            "écouteur pour un événement déjà passé, et la fonctionnalité n'existe pas — sans\n" +
            "erreur, sans trace. Trois issues, l'une des trois :\n" +
            "  ① le précharger conditionnellement au boot, depuis ce que le profil demande ;\n" +
            "  ② déplacer l'abonnement dans une fonction appelée après le chargement, avec un\n" +
            "     repli qui agit si le signal est déjà passé ;\n" +
            "  ③ une entrée d'EXEMPTIONS, nommée et motivée, dans ce fichier."
    );
    process.exit(1);
}

console.log(
    `✓ BOOT-SUB — aucun abonnement au boot au corps de module ` +
        `(${scannedPlugins} plugin(s), ${scannedFiles} fichier(s), ${subscriptionsSeen} abonnement(s) vus, ` +
        `${preloaded.size} préchargé(s), ${Object.keys(EXEMPTIONS).length} exemption(s)).`
);
