/**
 * check-dynamic-key-writes.cjs — prototype-pollution ratchet on dynamic-key writes.
 *
 * ## Why this exists
 *
 * Sprint 5 closed a prototype-pollution hole in `setValueByPath`. It was not a new
 * bug: it was a sink an earlier hardening sweep had simply not reached. Nothing
 * prevented the next one from appearing the same way — a reviewer has to notice, by
 * eye, that `bag[k] = v` takes `k` from parsed JSON. Sprint 13.2 found three more,
 * all reachable from a profile.
 *
 * This gate mechanises the question `docs/security/SECURITY_CONTRACT.md §5` asks a
 * human reviewer: *does every new writer-by-dynamic-key apply a guard?*
 *
 * ## What it flags
 *
 * Every `X[k] = …` where `k` is not a literal and not an obvious numeric index.
 * Compound assignments (`+=`, `??=`) are deliberately out of scope: they cannot
 * re-parent — `__proto__ += s` stringifies rather than invoking the setter.
 *
 * ## How it decides a write is guarded — three tiers
 *
 *   1. CANONICAL GUARD — the enclosing function imports and calls `isUnsafeKey` /
 *      `hasUnsafeSegment` from `utils/general/object-path-guard.ts`. This is a
 *      syntactic property, checkable without dataflow analysis, and it is the reason
 *      Sprint 13.2 consolidated four divergent private blocklists into one module:
 *      before it, a gate could only recognise four ad-hoc spellings and would have
 *      gone blind on the fifth.
 *   2. ALLOWLIST — protected by something *stricter* than the blocklist (a kebab-case
 *      allowlist regex, a hardcoded key list, a numeric index). Each entry carries a
 *      one-line reason. These are decisions, not debt.
 *   3. BASELINE — known, unguarded, not addressed. Mostly code-originated keys that
 *      never touch external JSON. This is debt, recorded so it stays visible.
 *
 * Tier 1 proves "the guard is in scope and used in this function", NOT "this exact
 * value is filtered". That is the honest limit of a syntactic gate; the complement is
 * the test suite (`__tests__/security/`, `__tests__/config/module-config-pollution`),
 * not more static analysis.
 *
 * ## Why not ESLint
 *
 * No core rule does dataflow, and `security/detect-object-injection` is explicitly
 * disabled in `eslint.config.mjs` — it would flag all 54 sites without distinguishing
 * the guarded ones. The repo's own answer to "known state + block only what's new" is
 * a baselined script (`check-orphan-exports.cjs`, `check-config-consumers.cjs`).
 *
 * GREEN on wiring: the baseline is generated from the current tree, so the gate ships
 * green and blocks only additions — the repo's "no permanently-red gate" rule.
 *
 * Usage:  node scripts/check-dynamic-key-writes.cjs [--update-baseline]
 * Exit codes: 0 no new unguarded sink · 1 new unguarded sink · 2 tooling error.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
// T5.5 — par le registre. Gate de surface XSS : un périmètre muet la ferait annoncer
// « aucune écriture à clé dynamique » sans avoir ouvert un fichier.
const SRC_DIR = path.join(require("./lib/packages.cjs").requireByDirName("core").absDir, "src");
const BASELINE_FILE = path.join(__dirname, "check-dynamic-key-writes.baseline.json");
const GUARD_MODULE = "object-path-guard.js";
const GUARD_FNS = new Set(["isUnsafeKey", "hasUnsafeSegment"]);

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

/** Relative path normalised to `/` — `path.relative` yields `\` on Windows. */
function normPath(p) {
    return p.split(path.sep).join("/");
}

/**
 * Sites protected by a mechanism STRICTER than the blocklist, or by construction.
 * Keyed `file|function|keyExpression` — never by line, so the entry survives edits
 * above it. Adding one is a claim; the string after it is where you justify it.
 */
const ALLOWLIST = new Map([
    [
        "packages/core/src/capabilities/legend/legend-generator.ts|_resolveIdsFromWhen|key",
        "key is a value of the hardcoded _FIELD_CATEGORY_MAP, typed as the union " +
            '"categoryId" | "subCategoryId" — it cannot be an arbitrary string',
    ],
    [
        "packages/core/src/capabilities/legend/legend-generator.ts|applyOpacityProperties|prop",
        'iterates the `opacityProps` param, whose only caller passes the literal ["fillOpacity"] (l.346)',
    ],
    [
        "packages/core/src/capabilities/permalink/permalink-url.ts|_pruneToFields|key",
        "iterates DEFAULT_PERMALINK_FIELDS — a hardcoded readonly array of 7 string " +
            "literals typed PermalinkField (constants.ts:45-53). The key never comes from " +
            "the parsed URL: the untrusted `fields` param is only READ (`fields.includes(key)`), " +
            "never iterated, so it cannot introduce a key of its own",
    ],
]);

/**
 * Identifier names that unambiguously hold a numeric loop counter.
 *
 * Deliberately short. An earlier version also listed `k`, `n`, `pos`, `len` and
 * `count`, and the gate's own bilateral probe caught it: `for (const [k, v] of
 * Object.entries(untrusted)) bag[k] = v` is the single most common shape of this bug,
 * and `k` there means *key*, not index — the gate silently passed the exact sink it
 * exists to catch. A security gate must fail toward flagging: a false positive costs
 * one baseline line with a justification, a false negative costs a vulnerability.
 */
const NUMERIC_IDENT = /^(i|j|idx|index)$/;

/** A key expression that provably cannot carry a polluting string. */
function isProvablySafeKey(arg) {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        // A LITERAL "__proto__" is still worth a finding — it is never accidental.
        return arg.text !== "__proto__" && arg.text !== "constructor" && arg.text !== "prototype";
    }
    if (ts.isNumericLiteral(arg)) return true;
    if (ts.isIdentifier(arg) && NUMERIC_IDENT.test(arg.text)) return true;
    // `a[i - 1]`, `a[n + 1]`, `a[arr.length - 1]` — arithmetic yields a number.
    if (
        ts.isBinaryExpression(arg) &&
        (arg.operatorToken.kind === ts.SyntaxKind.MinusToken ||
            arg.operatorToken.kind === ts.SyntaxKind.PlusToken) &&
        ts.isNumericLiteral(arg.right)
    ) {
        return true;
    }
    return false;
}

/**
 * Names that count as "calling the canonical guard" inside this file: the imported
 * bindings (alias-aware), plus any module-level function that itself calls one.
 *
 * The second part matters — `built-in/config/storage.ts` wraps the guard in a local
 * `_isUnsafeKey()` that adds a `Log.warn`, and its three writers call the wrapper, not
 * the import. Without transitive resolution the gate would report the repo's
 * best-guarded sinks as unguarded, and the obvious fix would be to allowlist them,
 * i.e. to stop checking the one module that most needs checking. Iterated to a
 * fixpoint so a wrapper-of-a-wrapper resolves too.
 */
function collectGuardBindings(sf) {
    const names = new Set();
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st)) continue;
        const spec = st.moduleSpecifier;
        if (!ts.isStringLiteral(spec) || !spec.text.endsWith(GUARD_MODULE)) continue;
        const nb = st.importClause && st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
            for (const el of nb.elements) {
                const original = (el.propertyName || el.name).text;
                if (GUARD_FNS.has(original)) names.add(el.name.text);
            }
        }
    }
    if (names.size === 0) return names;

    // Fixpoint: a module-level function calling a known guard name becomes one.
    let grew = true;
    while (grew) {
        grew = false;
        for (const st of sf.statements) {
            let fnName = null;
            let body = null;
            if (ts.isFunctionDeclaration(st) && st.name && st.body) {
                fnName = st.name.text;
                body = st.body;
            } else if (ts.isVariableStatement(st)) {
                for (const d of st.declarationList.declarations) {
                    if (
                        ts.isIdentifier(d.name) &&
                        d.initializer &&
                        (ts.isArrowFunction(d.initializer) ||
                            ts.isFunctionExpression(d.initializer))
                    ) {
                        fnName = d.name.text;
                        body = d.initializer.body;
                    }
                }
            }
            if (!fnName || !body || names.has(fnName)) continue;
            let calls = false;
            (function scan(n) {
                if (calls) return;
                if (
                    ts.isCallExpression(n) &&
                    ts.isIdentifier(n.expression) &&
                    names.has(n.expression.text)
                ) {
                    calls = true;
                    return;
                }
                ts.forEachChild(n, scan);
            })(body);
            if (calls) {
                names.add(fnName);
                grew = true;
            }
        }
    }
    return names;
}

/** Nearest enclosing function-like ancestor, or the source file. */
function enclosingFunction(node) {
    let cur = node.parent;
    while (cur) {
        if (
            ts.isFunctionDeclaration(cur) ||
            ts.isFunctionExpression(cur) ||
            ts.isArrowFunction(cur) ||
            ts.isMethodDeclaration(cur) ||
            ts.isConstructorDeclaration(cur) ||
            ts.isGetAccessor(cur) ||
            ts.isSetAccessor(cur)
        ) {
            return cur;
        }
        cur = cur.parent;
    }
    return null;
}

/**
 * Readable, stable name for the enclosing function — used in the finding key.
 *
 * Walks outwards past anonymous callbacks until something is named, so a write inside
 * `xs.forEach((x) => …)` is attributed to the enclosing named function rather than to
 * `<anonymous>`. Baseline keys have to survive edits: `<anonymous>` collides as soon as
 * a file has two callbacks, and changes meaning when one is added.
 */
function enclosingFunctionName(node) {
    let cur = node;
    for (;;) {
        const fn = enclosingFunction(cur);
        if (!fn) return "<top-level>";
        if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
        // `const foo = () => {}` / `foo: function () {}` — take the binding's name.
        const p = fn.parent;
        if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
        if (p && ts.isPropertyAssignment(p) && p.name) return p.name.getText();
        if (p && ts.isMethodDeclaration(p) && p.name) return p.name.getText();
        cur = fn; // anonymous — attribute to whatever encloses it
    }
}

/**
 * True when one of the canonical guard bindings is referenced inside the enclosing
 * function.
 *
 * Any *reference* counts, not just a direct call: `setValueByPath` guards with
 * `parts.some(_isUnsafeKey)`, where the guard is an argument and the callee is
 * `parts.some`. Requiring a direct call would report the sink Sprint 5 was written to
 * close as unguarded — the exact inversion this gate exists to prevent.
 *
 * This is the gate's honest ceiling: it proves the guard is in scope and used in this
 * function, not that this particular value flows through it. Proving the latter needs
 * dataflow; the complement here is the test suite, not more static analysis.
 */
function isGuardedHere(node, guardNames) {
    if (guardNames.size === 0) return false;
    const fn = enclosingFunction(node);
    if (!fn) return false;
    let found = false;
    (function scan(n) {
        if (found) return;
        if (ts.isIdentifier(n) && guardNames.has(n.text)) {
            found = true;
            return;
        }
        ts.forEachChild(n, scan);
    })(fn);
    return found;
}

function walkTsFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkTsFiles(full, out);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
    }
    return out;
}

/** Collects every unguarded dynamic-key write in the tree. */
function collectFindings() {
    const findings = [];
    for (const file of walkTsFiles(SRC_DIR)) {
        const rel = normPath(path.relative(ROOT, file));
        const sf = ts.createSourceFile(
            file,
            fs.readFileSync(file, "utf8"),
            ts.ScriptTarget.ES2022,
            true
        );
        const guardNames = collectGuardBindings(sf);

        (function visit(node) {
            if (
                ts.isBinaryExpression(node) &&
                node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isElementAccessExpression(node.left) &&
                !isProvablySafeKey(node.left.argumentExpression)
            ) {
                if (!isGuardedHere(node, guardNames)) {
                    const fn = enclosingFunctionName(node);
                    const keyText = node.left.argumentExpression.getText(sf);
                    findings.push({
                        key: `${rel}|${fn}|${keyText}`,
                        file: rel,
                        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                        fn,
                        keyText,
                    });
                }
            }
            ts.forEachChild(node, visit);
        })(sf);
    }
    return findings.filter((f) => !ALLOWLIST.has(f.key));
}

function readBaseline() {
    if (!fs.existsSync(BASELINE_FILE)) return { sinks: [] };
    try {
        return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    } catch {
        return null;
    }
}

function writeBaseline(findings) {
    // Deduplicated on purpose: the key is fichier|fonction|expression, so two writes
    // sharing all three collapse to one entry. That is the price of a key that
    // survives refactors — a line-indexed baseline would be unique but would rot at
    // the first edit above it. `count` reports the unique keys actually stored, not
    // the raw finding count, so the file does not claim more than it holds.
    const keys = [...new Set(findings.map((f) => f.key))].sort();
    const payload = {
        _comment:
            "Écritures à clé dynamique connues et NON gardées, figées pour que le gate ne bloque " +
            "que sur une NOUVELLE. Ce n'est PAS une liste de vulnérabilités : la plupart de ces " +
            "clés sont code-originées et ne viennent jamais d'un JSON externe. Ce qui est " +
            "intentionnellement sûr (index numérique, liste de clés en dur, allowlist plus " +
            "stricte) va dans ALLOWLIST, DANS le script, avec sa justification — pas ici. " +
            "L'identité d'une entrée est fichier|fonction|expression-de-clé, PAS le numéro de " +
            "ligne : une baseline indexée par ligne se périme au premier refactor. Corollaire " +
            "assumé : deux écritures identiques dans la même fonction ne comptent que pour une.",
        generated: "S13.2",
        count: keys.length,
        sinks: keys,
    };
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 4)}\n`, "utf8");
}

function checkDynamicKeyWrites({ update = false } = {}) {
    const findings = collectFindings();

    if (update) {
        writeBaseline(findings);
        console.log(
            `${C.green}✓${C.reset}  check-dynamic-key-writes: baseline régénérée ` +
                `(${findings.length} sink(s) figé(s)).`
        );
        return 0;
    }

    const baseline = readBaseline();
    if (baseline === null) {
        console.error(`${C.red}✖${C.reset}  baseline illisible: ${normPath(BASELINE_FILE)}`);
        return 2;
    }
    const known = new Set(baseline.sinks || []);
    const fresh = findings.filter((f) => !known.has(f.key));
    const stale = [...known].filter((k) => !findings.some((f) => f.key === k));

    if (fresh.length === 0) {
        console.log(
            `${C.green}✔${C.reset} check-dynamic-key-writes: aucune NOUVELLE écriture à clé ` +
                `dynamique non gardée (${known.size} déjà en baseline).`
        );
        if (stale.length > 0) {
            console.log(
                `${C.dim}ℹ ${stale.length} entrée(s) de baseline obsolète(s) — régénérer avec ` +
                    `\`node scripts/check-dynamic-key-writes.cjs --update-baseline\` pour resserrer le plancher.${C.reset}`
            );
        }
        return 0;
    }

    console.error(
        `\n${C.red}✖  ${fresh.length} écriture(s) à clé dynamique sans garde anti-prototype-pollution${C.reset}\n`
    );
    for (const f of fresh) {
        console.error(`    ${C.cyan}${f.file}:${f.line}${C.reset}`);
        console.error(`${C.dim}      dans ${f.fn}() — clé : \`${f.keyText}\`${C.reset}`);
    }
    console.error(
        `\n  Une écriture \`X[k] = …\` dont \`k\` n'est pas un littéral peut être routée vers le\n` +
            `  setter \`__proto__\` dès que \`k\` vient d'un JSON.parse — qui produit \`__proto__\` en\n` +
            `  propriété PROPRE, donc énumérée par Object.keys/entries (contrairement à un\n` +
            `  littéral objet, où la clé règle le prototype et n'est jamais listée).\n\n` +
            `  Trois issues :\n` +
            `    1. GARDER — importer le garde canonique et l'appeler dans la même fonction :\n` +
            `${C.dim}         import { isUnsafeKey } from ".../utils/general/object-path-guard.js";\n` +
            `         if (isUnsafeKey(k)) continue;${C.reset}\n` +
            `    2. SÛR PAR CONSTRUCTION (index numérique, liste de clés en dur, allowlist plus\n` +
            `       stricte) → ajouter le site à ALLOWLIST dans ce script, AVEC sa justification.\n` +
            `    3. PASSIF ASSUMÉ, non traité maintenant :\n` +
            `${C.dim}         node scripts/check-dynamic-key-writes.cjs --update-baseline${C.reset}\n` +
            `       et le justifier dans le message de commit.\n\n` +
            `  Contrat : packages/core/docs/security/SECURITY_CONTRACT.md §5\n`
    );
    return 1;
}

if (require.main === module) {
    console.log(`\n${C.cyan}── 🛡️  Écritures à clé dynamique (prototype pollution) ──${C.reset}\n`);
    try {
        process.exitCode = checkDynamicKeyWrites({
            update: process.argv.includes("--update-baseline"),
        });
    } catch (err) {
        console.error(`${C.red}✖${C.reset}  erreur d'outillage : ${err.message}`);
        process.exitCode = 2;
    }
    console.log("");
}

module.exports = { checkDynamicKeyWrites, collectFindings };
