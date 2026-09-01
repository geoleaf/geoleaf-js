#!/usr/bin/env node
/**
 * SLOT — a toolbar slot declared twice must be declared IDENTICALLY.
 *
 * ## The defect this closes
 *
 * Every lazy plugin's toolbar slot is declared in TWO places with no link between them:
 * `apps/geoleaf-app/init.js` (`registerLazyForAction`, read before the bundle downloads)
 * and the plugin's own `entry.ts` (`registry.register({ ui })`, read once loaded). They
 * drifted on 4 slots out of 8 — `print`, `measure` and `editor` shipped with their
 * canonical `profileKey` inert in every delivered variant, because only one side had been
 * migrated. A profile writing the canonical key neither hid the button nor got an error.
 * The content was fixed on 20/08/2026; this gate is what keeps the two sides equal.
 *
 * ## What it compares, and what it deliberately does not
 *
 *   SLOT-01  For each action declared on BOTH sides, the visibility-deciding fields of
 *            each slot kind (mobileIcon / desktopTabButton) must be identical:
 *            `profileKey`, `legacyProfileKey`, `variant`. Icons and labels are NOT
 *            compared — they are presentation, and the app may legitimately inline a
 *            different SVG than the plugin ships.
 *   SLOT-02  Non-vacuity floor: fewer than 5 paired actions → refuse to conclude
 *            (a broken extractor must not pass as "all aligned").
 *   SLOT-03  An action declared in init.js but absent from every entry.ts (or the
 *            reverse) is reported — that is how the next `print` starts.
 *
 * ⚠️ The comparison is OPT-IN by action pair, never a uniform shape rule. Measured on this
 * repo (C-D1): forcing one visibility idiom on all slots made the position-share button
 * vanish from all four delivered variants, because its `enabled`/`showButton` pair has
 * inverted semantics on purpose. This gate only says "what you declared twice must match",
 * it never says what to declare.
 *
 * Extraction is AST-based (ts.createSourceFile on both files), not regex: the blocks are
 * multi-line object literals that a line-oriented grep misreads — that failure mode is
 * documented on this very line's first pre-flight.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { all, requireByDirName } = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const FLOOR = 5;
/** Fields that decide visibility/behaviour — the ones that MUST match. */
const COMPARED = ["profileKey", "legacyProfileKey", "variant"];

/** Literal value of a property assignment, or undefined when not a plain literal. */
function litOf(prop) {
    if (!ts.isPropertyAssignment(prop)) return undefined;
    const i = prop.initializer;
    if (ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i)) return i.text;
    if (i.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (i.kind === ts.SyntaxKind.FalseKeyword) return false;
    return undefined;
}

/** { mobileIcon: {...}, desktopTabButton: {...} } → comparable shape. */
function slotShape(objLit) {
    const out = {};
    for (const prop of objLit.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isObjectLiteralExpression(prop.initializer))
            continue;
        const kind = prop.name.getText().replace(/["']/g, "");
        if (kind !== "mobileIcon" && kind !== "desktopTabButton") continue;
        const fields = {};
        for (const p of prop.initializer.properties) {
            const name = ts.isPropertyAssignment(p) ? p.name.getText().replace(/["']/g, "") : "";
            if (COMPARED.includes(name)) fields[name] = litOf(p);
        }
        out[kind] = fields;
    }
    return out;
}

/** init.js side: every `registerLazyForAction("<action>", "<plugin>", {…})` call. */
function readInitSlots(file) {
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    const slots = new Map();
    // Annotated: without it the parameter inherits `sf`'s type by contextual inference and
    // every `ts.is*` guard collapses to `never` — the guards-to-`never` class, in the very gate that
    // was written the same day the rule went into the registry.
    (function visit(/** @type {import("typescript").Node} */ node) {
        if (
            ts.isCallExpression(node) &&
            node.expression.getText().endsWith("registerLazyForAction") &&
            node.arguments.length >= 3 &&
            ts.isStringLiteral(node.arguments[0]) &&
            ts.isObjectLiteralExpression(node.arguments[2])
        ) {
            slots.set(node.arguments[0].text, slotShape(node.arguments[2]));
        }
        ts.forEachChild(node, visit);
    })(sf);
    return slots;
}

/** entry.ts side: the `ui: {…}` block of `registry.register({ id, ui })`. */
function readEntrySlots(file) {
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    const found = new Map();
    (function visit(/** @type {import("typescript").Node} */ node) {
        if (ts.isObjectLiteralExpression(node)) {
            let id = null;
            let ui = null;
            for (const p of node.properties) {
                if (!ts.isPropertyAssignment(p)) continue;
                const name = p.name.getText().replace(/["']/g, "");
                if (name === "id" && ts.isStringLiteral(p.initializer)) id = p.initializer.text;
                if (name === "ui" && ts.isObjectLiteralExpression(p.initializer))
                    ui = p.initializer;
            }
            if (id && ui) found.set(id, slotShape(ui));
        }
        ts.forEachChild(node, visit);
    })(sf);
    return found;
}

const initFile = path.join(requireByDirName("geoleaf-app").absDir, "init.js");
const initSlots = readInitSlots(initFile);

const entrySlots = new Map();
for (const pkg of all()) {
    const entry = path.join(pkg.absDir, "src", "entry.ts");
    if (!fs.existsSync(entry)) continue;
    for (const [id, shape] of readEntrySlots(entry)) {
        if (Object.keys(shape).length > 0) entrySlots.set(id, { shape, file: entry });
    }
}

console.log(`\x1b[2m── SLOT — les deux déclarations d'un créneau sont identiques ──\x1b[0m`);
const paired = [...initSlots.keys()].filter((a) => entrySlots.has(a));
console.log(
    `  init.js : ${initSlots.size} créneau(x) · entry.ts : ${entrySlots.size} · appariés : ${paired.length}`
);

if (paired.length < FLOOR) {
    console.error(
        `❌ [SLOT-02] ${paired.length} action(s) appariée(s) — sous le plancher de ${FLOOR}.\n` +
            `   Un appariement aussi maigre signale un extracteur cassé, pas un dépôt aligné.`
    );
    process.exit(1);
}

let failed = false;
for (const action of paired) {
    const a = initSlots.get(action);
    const b = entrySlots.get(action).shape;
    for (const kind of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const fa = a[kind] ?? {};
        const fb = b[kind] ?? {};
        for (const field of COMPARED) {
            if ((fa[field] ?? null) !== (fb[field] ?? null)) {
                failed = true;
                console.error(
                    `❌ [SLOT-01] « ${action} » · ${kind}.${field} diverge :\n` +
                        `   init.js  → ${JSON.stringify(fa[field] ?? null)}\n` +
                        `   entry.ts → ${JSON.stringify(fb[field] ?? null)}  (${path.relative(ROOT, entrySlots.get(action).file)})`
                );
            }
        }
    }
}

const initOnly = [...initSlots.keys()].filter((a) => !entrySlots.has(a));
const entryOnly = [...entrySlots.keys()].filter((a) => !initSlots.has(a));
for (const a of initOnly)
    console.log(
        `  \x1b[33mℹ [SLOT-03]\x1b[0m « ${a} » déclaré dans init.js seulement — un seul écrivain, rien à comparer.`
    );
for (const a of entryOnly)
    console.log(`  \x1b[33mℹ [SLOT-03]\x1b[0m « ${a} » déclaré par son entry.ts seulement.`);

if (failed) process.exit(1);
console.log(
    `\x1b[32m✓ SLOT\x1b[0m — ${paired.length} créneau(x) apparié(s), aucune divergence sur ${COMPARED.join("/")}.`
);
