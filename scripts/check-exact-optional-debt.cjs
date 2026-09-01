#!/usr/bin/env node
/**
 * @fileoverview EXACT-OPTIONAL-DEBT — the ratchet that keeps
 * `exactOptionalPropertyTypes` from being settled by type widening.
 *
 * ## Why this gate exists
 *
 * The quality pass enabled `exactOptionalPropertyTypes` and settled **95 errors**.
 * Each could be fixed in two opposite ways:
 *
 *   1. **Widen the target** — `prop?: T` becomes `prop?: T | undefined`. One line,
 *      the compiler goes quiet… and the property regains EXACTLY the semantics it
 *      had before the option. Zero guarantee bought, two days spent.
 *   2. **Fix the site** — conditional insertion, or default applied at the
 *      producer. The property is really absent when absent, so a
 *      `{...defaults, ...profile}` can no longer crush a default with `undefined`.
 *
 * All 95 were settled by (2), **without a single widening**. Nothing afterwards
 * distinguishes a legitimate, commented `?: T | undefined` from one placed to
 * silence `tsc` — the failure mode "a number that cannot be re-measured does not go
 * stale, it fossilises". Hence this ratchet, on the model of MH-02
 * (`check-module-headers.cjs`) and TSD-04 (`check-tsdoc-conformity.cjs`): *without
 * which a baseline is a permit, not a debt register.*
 *
 * ## The three rules
 *
 *   EOD-01  Every optional property whose OWN type contains `undefined`
 *           (`prop?: T | undefined`) must be in the baseline. A new one is an
 *           error: it cannot be born as debt.
 *   EOD-02  The baseline can only SHRINK. An entry whose property vanished, or is
 *           no longer widened, is an error until removed.
 *   EOD-03  The corpus cannot be empty. A gate going green having scanned nothing
 *           is the worst outcome (same class as the failure modes listed in
 *           `typecheck-docs-examples.cjs`).
 *
 * ## Two design decisions, each motivated by a MEASURED defect
 *
 * **AST, never grep.** A `grep` on `?:` + `| undefined` surfaces **83 lines** on
 * this repo; the AST visit finds **0**. The 83 are casts (`as {x?: T} | undefined`)
 * and PARAMETER unions (`onToggle?: (id: string | undefined) => void`) — the `?`
 * and the `| undefined` there belong to two different constructs. A ceiling built
 * on that grep would have allowed 21 free widenings, more than the work produced:
 * the check would have been inert end to end.
 * Second defect, caused by the very gesture under watch: `.prettierrc.json`
 * carries `printWidth: 100` and `lint-staged` runs `prettier --write` at every
 * commit. Adding ` | undefined` to a 92-character declaration breaks it into
 * multi-line — measured, **212 properties** would flip. A line-by-line counter thus
 * goes blind exactly when the edit it watches is made.
 *
 * **Perimeter derived from the registry.** `scripts/lib/packages.cjs`, never a
 * hard-coded `packages/<name>` glob. The naive `packages/*\/src` glob matches
 * NEITHER `packages/plugins/*` NOR `packages/libs/*` — 15 of the 17 packages,
 * hence all the plugins, would sit off the counter with nothing turning red. The
 * class `probe-gate-visibility.cjs` watches.
 *
 * ## Usage
 *
 *        node scripts/check-exact-optional-debt.cjs
 *        node scripts/check-exact-optional-debt.cjs --update-baseline
 *
 * ⚠️ `--update-baseline` is run AFTER fixing, never to silence. Each added entry
 * must carry, in the code, a comment naming the consumer (`path:line`) for which
 * "absent" and "present valued `undefined`" really are equivalent.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "exact-optional-debt.json");
const UPDATE = process.argv.includes("--update-baseline");

const SKIP_DIRS = new Set(["__tests__", "node_modules", "dist", "coverage"]);

/**
 * The `src/` directories of every registry package, including those outside
 * `workspaces` (the `_plugin-template` scaffold inherits the same base tsconfig,
 * hence the option).
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
 * @returns {string[]} the subtree's `.ts`, tests and artifacts excluded
 */
function collectTs(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectTs(full, out);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

/**
 * A property is "widened" when it carries BOTH the `?` and an `undefined` in its
 * OWN type. A callback parameter's type does not count: it is a different node.
 *
 * @param {import("typescript").Node} node
 * @returns {boolean}
 */
function isWidenedOptional(node) {
    if (!ts.isPropertySignature(node) && !ts.isPropertyDeclaration(node)) return false;
    if (!node.questionToken || !node.type) return false;
    if (!ts.isUnionTypeNode(node.type)) return false;
    return node.type.types.some((t) => t.kind === ts.SyntaxKind.UndefinedKeyword);
}

/**
 * Stable key, WITHOUT a line number — an upstream insertion must not stale the
 * entry. Same reasoning as `diagnosticKey()` in `typecheck-docs-examples.cjs`.
 *
 * @param {string} rel
 * @param {string} owner conteneur (interface / classe / `<module>`)
 * @param {string} prop
 * @returns {string}
 */
const entryKey = (rel, owner, prop) => `${rel}::${owner}::${prop}`;

/** @returns {string[]} the widened sites found in the corpus */
function scan() {
    const found = [];
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
                if (isWidenedOptional(node)) {
                    const owner =
                        node.parent && node.parent.name ? node.parent.name.getText() : "<module>";
                    found.push(entryKey(rel, owner, node.name.getText()));
                }
                ts.forEachChild(node, visit);
            };
            visit(sf);
        }
    }
    return { found: [...new Set(found)].sort(), scanned };
}

const { found, scanned } = scan();

// ── EOD-03 — a gate that scanned nothing proved nothing ──────────────────────────────────
if (scanned === 0) {
    console.error("ERROR [EXACT-OPTIONAL-DEBT/EOD-03]: corpus vide — 0 fichier scanné.");
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
                    "EXACT-OPTIONAL-DEBT — propriétés élargies en `?: T | undefined`, gelées. " +
                    "Cette liste ne peut que RÉTRÉCIR (EOD-02). Régénérer avec --update-baseline " +
                    "UNIQUEMENT après avoir corrigé, jamais pour faire taire. Chaque entrée doit " +
                    "porter dans le code un commentaire nommant le consommateur pour lequel " +
                    "« absent » et « présent valant undefined » sont équivalents.",
                _generated: "node scripts/check-exact-optional-debt.cjs --update-baseline",
                count: found.length,
                entries: found,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [EXACT-OPTIONAL-DEBT] baseline régénérée — ${found.length} entrée(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    // An absent baseline is NOT an empty list: it would declare the whole surface
    // clean. Same refusal as `check-namespace-typing-coverage.cjs`.
    console.error("ERROR [EXACT-OPTIONAL-DEBT]: baseline absente.");
    console.error("  Run: node scripts/check-exact-optional-debt.cjs --update-baseline");
    process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(found);

const fresh = found.filter((k) => !baseline.has(k)); // EOD-01
const stale = [...baseline].filter((k) => !seen.has(k)).sort(); // EOD-02

const bar = "─".repeat(72);
console.log(bar);

if (fresh.length === 0 && stale.length === 0) {
    console.log(
        `✅ [EXACT-OPTIONAL-DEBT] ${found.length} élargissement(s) — baseline à jour ` +
            `(${scanned} fichiers, ${sourceRoots().length} paquets).`
    );
    console.log(bar);
    process.exit(0);
}

if (fresh.length > 0) {
    console.error(`❌ [EXACT-OPTIONAL-DEBT/EOD-01] ${fresh.length} élargissement(s) NOUVEAU(X) :`);
    for (const k of fresh) console.error(`     + ${k}`);
    console.error(
        "\n  `?: T | undefined` rend à la propriété la sémantique d'avant l'option : la clé peut\n" +
            "  redevenir présente valant `undefined`, donc écraser un défaut dans un merge par spread.\n" +
            "  Corriger le SITE (insertion conditionnelle, ou défaut appliqué chez le producteur)\n" +
            "  plutôt que la cible. Si l'élargissement est réellement justifié, commenter le site en\n" +
            "  nommant son consommateur, puis --update-baseline."
    );
}

if (stale.length > 0) {
    console.error(`\n❌ [EXACT-OPTIONAL-DEBT/EOD-02] ${stale.length} entrée(s) PÉRIMÉE(S) :`);
    for (const k of stale) console.error(`     - ${k}`);
    console.error("\n  Ces propriétés ne sont plus élargies (ou n'existent plus). Les retirer :");
    console.error("  node scripts/check-exact-optional-debt.cjs --update-baseline");
}

console.log(bar);
process.exit(1);
