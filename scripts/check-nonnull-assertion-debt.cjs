#!/usr/bin/env node
/**
 * @fileoverview NONNULL-ASSERTION-DEBT — the ratchet that keeps
 * `noUncheckedIndexedAccess` from being settled with complacency assertions.
 *
 * ## Why this gate exists
 *
 * The quality pass enabled `noUncheckedIndexedAccess` and settled **391 errors**. A
 * preliminary batch measured, by probe
 * (`eslint --stdin --rule '{"complexity":["warn",0]}'`), the cyclomatic-complexity
 * cost of each fix shape:
 *
 *        arr[i]!                        +0     ← FORBIDDEN
 *        `if` guard                     +1
 *        `??`                           +1
 *        `?.`                           +1
 *        ternary                        +1
 *        destructuring with default     +1 per binding
 *        `for..of` replacing an indexed loop   0 net
 *
 * **The only zero-cost fix is the one that must be proscribed**, and `complexity:
 * ["error", 20]` (`eslint.config.mjs`) is a one-way ratchet: the pressure pushes
 * structurally toward the assertion. Not a hypothesis — verified on the spot:
 * `offline/install.ts` was first fixed with an `asObject(...)!`, removed before
 * commit. Hence this ratchet, on the EOD-02 model
 * (`check-exact-optional-debt.cjs`), MH-02 and TSD-04: *without which a baseline is
 * a permit, not a debt register.*
 *
 * ## The four rules
 *
 *   NNA-04  **Zero `!` on an indexed read** (`arr[i]!`, `obj[k]!`) — no baseline, no
 *           exception. An asserted indexed read IS a silenced
 *           `noUncheckedIndexedAccess` error: the sweep goes green because the `!`
 *           is there. The rule that makes the tier true, and the only one without an
 *           escape.
 *   NNA-01  Any OTHER `!` or `as unknown` assertion must be in the baseline. A new
 *           one is an error: it cannot be born as debt.
 *   NNA-02  The baseline can only SHRINK. An entry gone from the code is an error
 *           until removed from the file.
 *   NNA-03  The corpus cannot be empty. A green gate that scanned nothing is the
 *           worst outcome (same class as EOD-03 and
 *           `typecheck-docs-examples.cjs`'s failure modes).
 *
 * ## Three design decisions, each motivated by a MEASURED defect
 *
 * **AST, never grep.** The preflight announced "130 `!` assertions", measured by a
 * text read. The AST visit finds **192**, i.e. 47 % more — and above all, it alone
 * can CLASSIFY: of those 192, exactly **10** bore on an indexed read, the 182 others
 * escaping `strictNullChecks` (the earlier tier), not this one. A counter that
 * cannot tell the two natures apart would have passed an earlier-tier debt purge for
 * this tier's work, or the reverse.
 *
 * **The distinction goes by the asserted expression's SHAPE**, not the file nor a
 * comment: `ts.isElementAccessExpression(node.expression)` separates `arr[i]!` from
 * `o.p!`, `x!` and `map.get(k)!` with no human convention to honour.
 *
 * **Perimeter derived from the registry.** `scripts/lib/packages.cjs`, never a
 * hard-coded `packages/<name>` glob. The naive `packages/*​/src` glob matches NEITHER
 * `packages/plugins/*` NOR `packages/libs/*` — the entirety of the plugins would sit
 * off the counter with nothing turning red. The class
 * `probe-gate-visibility.cjs` watches.
 *
 * ## What this gate does NOT guard
 *
 * The 180 residual assertions are `strictNullChecks` debt, frozen and named in the
 * internal debt register. Their decrease is separate work: mixing it in would make a
 * diff where what the tier proved can no longer be told from what was cleaned in
 * passing.
 *
 * ## Usage
 *
 *        node scripts/check-nonnull-assertion-debt.cjs
 *        node scripts/check-nonnull-assertion-debt.cjs --update-baseline
 *
 * ⚠️ `--update-baseline` is run AFTER fixing, never to silence. And it can do
 * NOTHING for NNA-04, which has no baseline.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "nonnull-assertion-debt.json");
const UPDATE = process.argv.includes("--update-baseline");

const SKIP_DIRS = new Set(["__tests__", "__mocks__", "node_modules", "dist", "coverage"]);

/**
 * The `src/` directories of every registry package.
 *
 * @returns {string[]} chemins absolus existants
 */
function sourceRoots() {
    return registry
        .all()
        .map((pkg) => path.join(ROOT, pkg.dir, "src"))
        .filter((dir) => fs.existsSync(dir));
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]} the subtree's `.ts`, tests and declarations excluded
 */
function collectTs(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectTs(full, out);
        } else if (
            (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
            !entry.name.endsWith(".d.ts") &&
            !/\.(test|spec)\./.test(entry.name)
        ) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Name of the enclosing function or member — serves as the key's stable
 * coordinate, in place of the line number, which an upstream insertion would stale.
 *
 * @param {import("typescript").Node} node
 * @param {import("typescript").SourceFile} sf
 * @returns {string}
 */
function enclosingName(node, sf) {
    for (let cur = node.parent; cur; cur = cur.parent) {
        if (
            (ts.isFunctionDeclaration(cur) ||
                ts.isMethodDeclaration(cur) ||
                ts.isPropertyDeclaration(cur) ||
                ts.isVariableDeclaration(cur) ||
                ts.isGetAccessor(cur) ||
                ts.isSetAccessor(cur)) &&
            cur.name
        ) {
            return cur.name.getText(sf);
        }
        if (ts.isConstructorDeclaration(cur)) return "constructor";
    }
    return "<module>";
}

/**
 * Stable key, WITHOUT a line number. Same reasoning as `entryKey()` in
 * `check-exact-optional-debt.cjs` and `diagnosticKey()` in
 * `typecheck-docs-examples.cjs`.
 *
 * @param {string} rel
 * @param {string} owner
 * @param {string} kind `!` or `as-unknown`
 * @param {string} text asserted expression, truncated
 * @returns {string}
 */
const entryKey = (rel, owner, kind, text) => `${rel}::${owner}::${kind}::${text}`;

/**
 * @returns {{ debt: string[], indexed: string[], scanned: number }} `debt` = the
 *   freezable assertions (NNA-01/02); `indexed` = the `arr[i]!`, which have no
 *   baseline (NNA-04)
 */
function scan() {
    const debt = [];
    const indexed = [];
    let scanned = 0;

    for (const root of sourceRoots()) {
        for (const file of collectTs(root)) {
            scanned++;
            const rel = path.relative(ROOT, file).split(path.sep).join("/");
            const sf = ts.createSourceFile(
                file,
                fs.readFileSync(file, "utf8"),
                ts.ScriptTarget.ES2022,
                true
            );

            const visit = (node) => {
                if (ts.isNonNullExpression(node)) {
                    const owner = enclosingName(node, sf);
                    const text = node.expression.getText(sf).replace(/\s+/g, " ").slice(0, 60);
                    if (ts.isElementAccessExpression(node.expression)) {
                        // NNA-04: the line IS useful here, the entry is never frozen.
                        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                        indexed.push(`${rel}:${line} — ${text}!`);
                    } else {
                        debt.push(entryKey(rel, owner, "!", text));
                    }
                }
                if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.UnknownKeyword) {
                    const owner = enclosingName(node, sf);
                    const text = node.expression.getText(sf).replace(/\s+/g, " ").slice(0, 60);
                    debt.push(entryKey(rel, owner, "as-unknown", text));
                }
                ts.forEachChild(node, visit);
            };
            visit(sf);
        }
    }
    return { debt: [...new Set(debt)].sort(), indexed: indexed.sort(), scanned };
}

const { debt, indexed, scanned } = scan();
const bar = "─".repeat(72);

// ── NNA-03 — a gate that scanned nothing proved nothing ─────────────────────────────────
if (scanned === 0) {
    console.error("ERROR [NONNULL-ASSERTION-DEBT/NNA-03]: corpus vide — 0 fichier scanné.");
    console.error("  Le registre de paquets ne résout aucun `src/`. La gate ne garde rien.");
    process.exit(2);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        // Indentation 4: Prettier owns `scripts/**/*.json` at `tabWidth: 4` and
        // would reformat the whole file at commit, making one line's removal
        // unreadable.
        JSON.stringify(
            {
                _comment:
                    "NONNULL-ASSERTION-DEBT — assertions `!` et `as unknown` gelées. Cette " +
                    "liste ne peut que RÉTRÉCIR (NNA-02). Elle NE contient PAS les `arr[i]!` : " +
                    "ceux-là sont interdits sans exception (NNA-04), parce qu'une lecture " +
                    "indexée assertée est une erreur `noUncheckedIndexedAccess` qu'on a tue. " +
                    "Le reste est de la dette `strictNullChecks` (palier Q3), instruite dans " +
                    "le registre de dette interne. Régénérer avec " +
                    "--update-baseline UNIQUEMENT après avoir corrigé, jamais pour faire taire.",
                _generated: "node scripts/check-nonnull-assertion-debt.cjs --update-baseline",
                count: debt.length,
                entries: debt,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [NONNULL-ASSERTION-DEBT] baseline régénérée — ${debt.length} entrée(s).`);
    process.exit(0);
}

// ── NNA-04 — no baseline, no exception ───────────────────────────────────────────────────
if (indexed.length > 0) {
    console.log(bar);
    console.error(
        `❌ [NONNULL-ASSERTION-DEBT/NNA-04] ${indexed.length} lecture(s) indexée(s) assertée(s) :`
    );
    for (const site of indexed) console.error(`     ${site}`);
    console.error(
        "\n  Un `arr[i]!` fait taire une erreur `noUncheckedIndexedAccess` : le sweep sort\n" +
            "  vert PARCE QUE l'assertion est là. Corriger le site — `for..of` ou `.entries()`\n" +
            "  quand la lecture est dans une boucle (coût nul), une garde qui narrow un local\n" +
            "  relu sinon. Cette règle n'a pas de baseline, par construction."
    );
    console.log(bar);
    process.exit(1);
}

if (!fs.existsSync(BASELINE)) {
    // An absent baseline is NOT an empty list: it would declare the whole surface
    // clean. Same refusal as `check-exact-optional-debt.cjs`.
    console.error("ERROR [NONNULL-ASSERTION-DEBT]: baseline absente.");
    console.error("  Run: node scripts/check-nonnull-assertion-debt.cjs --update-baseline");
    process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(debt);

const fresh = debt.filter((k) => !baseline.has(k)); // NNA-01
const stale = [...baseline].filter((k) => !seen.has(k)).sort(); // NNA-02

console.log(bar);

if (fresh.length === 0 && stale.length === 0) {
    console.log(
        `✅ [NONNULL-ASSERTION-DEBT] 0 \`arr[i]!\` (NNA-04) · ${debt.length} assertion(s) gelée(s) ` +
            `— baseline à jour (${scanned} fichiers, ${sourceRoots().length} paquets).`
    );
    console.log(bar);
    process.exit(0);
}

if (fresh.length > 0) {
    console.error(`❌ [NONNULL-ASSERTION-DEBT/NNA-01] ${fresh.length} assertion(s) NOUVELLE(S) :`);
    for (const k of fresh) console.error(`     + ${k}`);
    console.error(
        "\n  Une assertion ne peut pas NAÎTRE en dette. Corriger le site, ou — si le contrat\n" +
            "  la justifie vraiment — la geler explicitement avec --update-baseline, en\n" +
            "  motivant sur place."
    );
}

if (stale.length > 0) {
    console.error(
        `\n❌ [NONNULL-ASSERTION-DEBT/NNA-02] ${stale.length} entrée(s) de baseline sans site :`
    );
    for (const k of stale) console.error(`     - ${k}`);
    console.error(
        "\n  Ces assertions ont disparu du code — c'est une bonne nouvelle, mais la baseline\n" +
            "  doit l'enregistrer : `--update-baseline`. Une baseline qui garde des entrées\n" +
            "  mortes cesse de mesurer la dette réelle."
    );
}

console.log(bar);
process.exit(1);
