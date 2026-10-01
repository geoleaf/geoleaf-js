#!/usr/bin/env node
/**
 * NF — production `fetch` calls carry a cancellation path, under a shrinking baseline.
 *
 * ## The defect this holds
 *
 * A `fetch` with no `signal` can neither time out nor be aborted: a stalled request from a
 * teardown-heavy path (profile switch, layer reload) keeps running, and its `.then` fires
 * into a world that moved on. The repo fixed a first perimeter, then measured that the
 * deposit was wider than the perimeter — this gate is what keeps the count honest and
 * falling instead of re-measured by hand every sprint.
 *
 * ## What counts as covered, and why this is AST and not grep
 *
 * A call is COVERED when its options argument mentions a `signal` key — including the
 * conditional idiom `fetch(url, signal ? { signal } : undefined)`, which a naive "has a
 * second argument with signal on the same line" grep both over- and under-counts. The
 * line's own pre-flight documented that failure: a windowed grep counted prose and missed
 * multi-line options. So: ts.createSourceFile per file, every CallExpression whose callee
 * is `fetch`, and a scan of the SECOND argument's subtree for an identifier or property
 * named `signal`. A spread also counts as covered — the signal may travel inside, and
 * flagging it would punish the composable idiom the fix itself uses — but ONLY as a direct
 * property of the options object: `fetch(url, { ...opts, method })`.
 *
 * ⚠️ Any spread anywhere in the subtree used to count, `headers: { ...extra }` included — a
 * place where no signal can travel. Three fetches with no timeout passed for cancellable on
 * that account: an upload that lost its photo when it stalled (fixed), the config-loader
 * transit helper, and the print fallback's POST.
 *
 * What this deliberately does NOT prove: that a timeout is attached to the signal. That is
 * a dataflow property; the complement is the call-site review each ratchet descent does.
 *
 * ⚠️ What it does not SEE either: a second naked fetch in a function already frozen. The
 * baseline is a set of `file::function` keys — the per-key counts are computed below and
 * never compared — so the print fallback's POST sits behind the key its other fetch froze.
 *
 * ## Four frozen sites are REFUSALS, not remainders (arbitrated 17/08/2026, carried here
 * ## 25/08/2026 when the register line closed onto this gate)
 *
 * The governing principle: the cancellation boundary is the LIFECYCLE OWNER, not the fetch.
 * Equipping a site that has no owner produces "a controller no lifecycle governs" — a zero
 * counter and an illusion of coverage. All four show naked at the AST, each with its
 * measured ground. ⚠️ This paragraph said "three of the four" until 01/10/2026, and that the
 * config-loader helper was "covered since": it was the spread in its `headers` being counted.
 *   · `config/loader.ts` (`_doFetch`) — a transit helper: it hands the response to its
 *     caller, who owns the lifecycle. Equipping it would make `signal` a public option of
 *     the config loader.
 *   · `dropdown.ts` (field-renderer) — no lifecycle owner; equipping it would widen a PUBLISHED
 *     contract, and `replaceWith` on a detached node is already a no-op.
 *   · `style-loader-core.ts` — writes only into a cache keyed profile:layer:style; a correct
 *     entry arriving late is still correct.
 *   · `loader/single-layer.ts` — returns a value into the pipeline, no visible teardown.
 * They stay in the baseline ON PURPOSE. The reopen signal is a site GAINING an owner —
 * a teardown path appearing around it — never a re-reading of this list.
 *
 *   NF-01  a naked fetch in a file:function absent from the baseline → ERROR.
 *   NF-02  a baseline entry no longer observed → ERROR until tightened (ratchet down).
 *   NF-03  fewer than 10 fetch calls found in total → refuse to conclude (broken glob).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, ".baselines", "naked-fetch.json");
const UPDATE = process.argv.includes("--update-baseline");
const FLOOR = 10;

/** Every production .ts under the workspaces' src/, tests and mocks excluded. */
function sourceFiles() {
    const out = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (["node_modules", "dist", "coverage", "__tests__", "__mocks__"].includes(e.name))
                continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
        }
    };
    for (const base of ["packages/core/src", "packages/plugins", "packages/libs"]) {
        const abs = path.join(ROOT, base);
        if (base === "packages/core/src") walk(abs);
        else {
            let entries;
            try {
                entries = fs.readdirSync(abs, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const e of entries) if (e.isDirectory()) walk(path.join(abs, e.name, "src"));
        }
    }
    return out.sort();
}

/**
 * The object literals sitting in OPTIONS position: the argument itself, or what a
 * conditional, a parenthesis or a type assertion wraps around one.
 *
 * @param {import("typescript").Node} node The options argument, or a sub-expression of it.
 * @returns {import("typescript").ObjectLiteralExpression[]} Those literals; none for a call or an identifier.
 */
function optionObjects(node) {
    if (ts.isObjectLiteralExpression(node)) return [node];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
        return optionObjects(node.expression);
    }
    if (ts.isConditionalExpression(node)) {
        return [...optionObjects(node.whenTrue), ...optionObjects(node.whenFalse)];
    }
    return [];
}

/**
 * True when the options argument carries a `signal`, or may carry one through a spread.
 *
 * @param {import("typescript").Node} node The second argument of a `fetch` call.
 * @returns {boolean} Whether the call counts as covered.
 */
function mentionsSignal(node) {
    // `...opts` may carry the signal inside — but only as a DIRECT property of the options
    // object. A spread nested deeper (`headers: { ...extra }`) carries headers, not a signal.
    if (optionObjects(node).some((o) => o.properties.some((p) => ts.isSpreadAssignment(p)))) {
        return true;
    }
    let found = false;
    (function scan(/** @type {import("typescript").Node} */ n) {
        if (found) return;
        if (ts.isIdentifier(n) && n.text === "signal") {
            found = true;
            return;
        }
        ts.forEachChild(n, scan);
    })(node);
    return found;
}

/** Name of the enclosing function-like, for a line-free baseline key. */
function enclosingName(/** @type {import("typescript").Node} */ node) {
    let cur = node.parent;
    while (cur) {
        if (
            ts.isFunctionDeclaration(cur) ||
            ts.isMethodDeclaration(cur) ||
            ts.isFunctionExpression(cur) ||
            ts.isArrowFunction(cur)
        ) {
            if (cur.name && ts.isIdentifier(cur.name)) return cur.name.text;
            const p = cur.parent;
            if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
            if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
        }
        cur = cur.parent;
    }
    return "(module)";
}

const observed = new Map(); // key -> count
let totalFetch = 0;
for (const file of sourceFiles()) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    (function visit(/** @type {import("typescript").Node} */ node) {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "fetch"
        ) {
            totalFetch++;
            const opts = node.arguments[1];
            const covered = opts !== undefined && mentionsSignal(opts);
            if (!covered) {
                const key = `${rel}::${enclosingName(node)}`;
                observed.set(key, (observed.get(key) ?? 0) + 1);
            }
        }
        ts.forEachChild(node, visit);
    })(sf);
}

const observedKeys = [...observed.keys()].sort();
console.log(`\x1b[2m── NF — les fetch de production portent un chemin d'annulation ──\x1b[0m`);
console.log(
    `  ${totalFetch} appel(s) fetch en production · ${observedKeys.length} site(s) NU(S) (fichier::fonction)`
);

if (totalFetch < FLOOR) {
    console.error(
        `❌ [NF-03] ${totalFetch} fetch trouvés — sous le plancher de ${FLOOR} : corpus cassé, refus de conclure.`
    );
    process.exit(1);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            {
                _comment:
                    "NF-01/02 — sites `fetch` de production SANS clé `signal` dans leurs options, gelés à la pose. Liste DÉCROISSANTE : corriger un site (poser le signal + son timeout) puis resserrer via --update-baseline. Clés sans numéro de ligne — les lignes dérivent sans information. Ce que le gel ne prouve PAS : qu'un timeout est attaché au signal (propriété de flux de données) — c'est la revue du site, à chaque descente, qui le vérifie.",
                _generated: "node scripts/check-naked-fetch.cjs --update-baseline",
                count: observedKeys.length,
                entries: observedKeys,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`\x1b[32m✓\x1b[0m baseline écrite — ${observedKeys.length} entrée(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`❌ [NF] baseline absente — première pose : --update-baseline`);
    process.exit(1);
}
const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).entries);
const neuf = observedKeys.filter((k) => !baseline.has(k));
const gueris = [...baseline].filter((k) => !observed.has(k)).sort();

let failed = false;
if (neuf.length) {
    failed = true;
    console.error(`❌ [NF-01] ${neuf.length} fetch NU(S) nouveau(x) :`);
    for (const k of neuf) console.error(`   + ${k}`);
    console.error(`   Poser un signal (et son timeout) — ne pas élargir la baseline (I3).`);
}
if (gueris.length) {
    failed = true;
    console.error(`❌ [NF-02] ${gueris.length} entrée(s) guérie(s) — resserrer :`);
    for (const k of gueris.slice(0, 10)) console.error(`   − ${k}`);
    console.error(`   \x1b[2mnode scripts/check-naked-fetch.cjs --update-baseline\x1b[0m`);
}
if (failed) process.exit(1);
console.log(`\x1b[32m✓ NF\x1b[0m — aucun fetch nu nouveau (${baseline.size} gelé(s)).`);
