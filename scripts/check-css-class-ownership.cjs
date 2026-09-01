#!/usr/bin/env node
/**
 * CCO — a CSS class written by one package and defined by another is a DECLARED coupling.
 *
 * ## The convention this enforces (decided 24-25/08/2026)
 *
 * A `gl-*` class belongs to the package whose stylesheet DEFINES it. Another package may
 * WRITE that class only as a declared design-system usage, listed below with its reason.
 * Anything else is a silent cross-package dependency: the writer relies on a sheet it does
 * not carry, and a rename on the defining side breaks rendering with no signal anywhere —
 * sourcemap-based duplication scans are structurally blind to it (measured: the most
 * reliable of two instruments returned zero here, looking like it had searched).
 *
 * ## The instrument — the line's own, never reformulated
 *
 * Four syntactic positions, exactly those of the 19/08 census: `createEl(tag, "…")`,
 * `_el(tag, "…")`, `classList.add/remove/toggle(…)`, `.className = "…"`. Adding a position
 * changes the count — re-measure with THIS motif before touching the tables.
 *
 *   CCO-01  an observed coupling (class :: writer → definer) absent from both tables → ERROR.
 *   CCO-02  a table entry no longer observed → ERROR until removed (both tables shrink-only).
 *   CCO-03  fewer than 300 class-position tokens found → refuse to conclude (broken glob).
 *
 * Classes written somewhere but defined NOWHERE are a different family (no owner at all,
 * possibly styled via parent/attribute selectors) — counted, printed, deliberately not judged
 * here: mixing the two families would render one number and teach nothing.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { all } = require("./lib/packages.cjs");

const FLOOR = 300;

/**
 * Declared design-system usages — the writer knowingly uses a class the definer owns.
 * Key: `class :: writer`. Value: why this is usage, not leakage.
 */
const ASSUMED = {
    // Core's map toolbar is the design system every toolbar plugin plugs into: a plugin
    // marking its own button active writes core's state modifier by contract.
    "gl-map-toolbar__btn :: connector": "toolbar button — core's toolbar design system",
    "gl-map-toolbar__btn--active :: editor": "toolbar active state — core's toolbar system",
    "gl-map-toolbar__btn--active :: geocoding": "toolbar active state — core's toolbar system",
    "gl-map-toolbar__btn--active :: measure": "toolbar active state — core's toolbar system",
    "gl-map-toolbar__btn--active :: table": "toolbar active state — core's toolbar system",
    // field-renderer widgets only ever render inside a GeoLeaf page, where core's sheet is
    // loaded by construction — shared button/rating styles are usage, not a hidden edge.
    "gl-btn :: field-renderer": "shared button system — core sheet present by construction",
    "gl-btn--primary :: field-renderer": "shared button system — idem",
    "gl-rating :: field-renderer": "rating widget styles ship with core — idem",
    // editor BUNDLES field-renderer (declared devDependency, inlined at build): writing the
    // form system's classes is using the library it embeds.
    "gl-form-field :: editor": "field-renderer form system — editor bundles it",
    "gl-form-input :: editor": "field-renderer form system — editor bundles it",
    "gl-form-label :: editor": "field-renderer form system — editor bundles it",
    "gl-form-modal-overlay :: editor": "field-renderer modal system — editor bundles it",
    "gl-form-modal-panel :: editor": "field-renderer modal system — editor bundles it",
    "gl-form-modal__btn :: editor": "field-renderer modal system — editor bundles it",
    "gl-form-modal__delete-body :: editor": "field-renderer modal system — editor bundles it",
    "gl-form-modal__delete-title :: editor": "field-renderer modal system — editor bundles it",
    "gl-form-modal__footer :: editor": "field-renderer modal system — editor bundles it",
    "gl-form-modal__layer :: editor": "field-renderer modal system — editor bundles it",
    // host-runtime ships the tooltip helper AND its stylesheet: plugins writing the class
    // use the helper's design contract.
    "gl-tooltip :: editor": "host-runtime tooltip system",
    "gl-tooltip :: measure": "host-runtime tooltip system",
};

/**
 * Accidental couplings — frozen debt, shrink-only.
 *
 * ✅ **EMPTY since 26/08/2026.** The six entries were host-runtime, the BASE layer, writing
 * classes defined only in field-renderer, a library layered ABOVE it — an inverted direction
 * with no declared edge, which is what made them leakage rather than usage. They are gone
 * because host-runtime now SHIPS the rules it writes: `src/css/modal-shell.css` and
 * `src/css/confirm-dialog.css`.
 *
 * 🛑 **It was not a cosmetic debt, and the cost had already been paid.** `offline-ui` is eager,
 * calls `confirmDialog()` at four sites and does NOT depend on field-renderer, while `editor`
 * — which does — is lazy. So on any fresh page the confirm dialog rendered unstyled AND off
 * screen: measured on the deployed build, `position: static`, `z-index: auto`, y=720 in a
 * 720-tall viewport. Each of those calls is awaited, so the action hung on a button nobody
 * could see. Same defect as the routing panel, met from another side.
 *
 * ⚠️ **The instruction here said "own the styles under a host-runtime PREFIX", and that half
 * was NOT followed — deliberately.** Renaming would break consumers: the downstream
 * consumption manifest pins `.gl-form-modal-overlay` and `.gl-form-modal__btn-cancel` as DOM
 * anchors (v1.21.0). The rules are therefore owned under the SAME names, duplicated with
 * field-renderer rather than moved — `responsive-modal.ts` writes those classes on its own,
 * without going through `createModalShell`, so moving them would leave it depending on a
 * module its graph may tree-shake away. The two copies must stay byte-equivalent.
 *
 * Before/after DOM proof (C-D4): `position: static` → `fixed`, `z-index: auto` → `10000`,
 * y=720 → 0, on a page where `editor` was never loaded.
 */
const ACCIDENTAL = {};

const writers = new Map(); // class -> Set(pkg dir name)
const definers = new Map();
let positions = 0;

function scanTs(pkg, file) {
    const src = fs.readFileSync(file, "utf8");
    const lists = [];
    for (const m of src.matchAll(/\b(?:createEl|_el)\(\s*"[^"]+"\s*,\s*"([^"]*)"/g))
        lists.push(m[1]);
    for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
        for (const lit of m[1].matchAll(/"([^"]+)"/g)) lists.push(lit[1]);
    }
    for (const m of src.matchAll(/\.className\s*=\s*"([^"]*)"/g)) lists.push(m[1]);
    for (const list of lists)
        for (const cls of list.split(/\s+/)) {
            if (!/^gl-[A-Za-z0-9_-]+$/.test(cls)) continue;
            positions++;
            if (!writers.has(cls)) writers.set(cls, new Set());
            writers.get(cls).add(pkg);
        }
}
function scanCss(pkg, file) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/\.(gl-[A-Za-z0-9_-]+)/g)) {
        if (!definers.has(m[1])) definers.set(m[1], new Set());
        definers.get(m[1]).add(pkg);
    }
}
for (const pkg of all()) {
    const name = path.basename(pkg.absDir);
    const walk = (dir) => {
        let es;
        try {
            es = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of es) {
            if (["node_modules", "dist", "coverage", "__tests__", "__mocks__"].includes(e.name))
                continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) scanTs(name, p);
            else if (e.name.endsWith(".css")) scanCss(name, p);
        }
    };
    walk(path.join(pkg.absDir, "src"));
}

const observed = new Set();
let undefinedCount = 0;
for (const [cls, ws] of writers) {
    const ds = definers.get(cls) ?? new Set();
    if (ds.size === 0) {
        undefinedCount++;
        continue;
    }
    for (const w of ws) if (!ds.has(w)) observed.add(`${cls} :: ${w}`);
}

console.log(
    `\x1b[2m── CCO — un couplage CSS inter-paquets est déclaré, ou il n'existe pas ──\x1b[0m`
);
console.log(
    `  ${positions} position(s) de classe · ${writers.size} classes · ` +
        `${observed.size} couplage(s) observé(s) · ${undefinedCount} classe(s) sans définition (famille distincte, non jugée)`
);

if (positions < FLOOR) {
    console.error(
        `❌ [CCO-03] ${positions} positions — sous le plancher de ${FLOOR} : corpus cassé, refus de conclure.`
    );
    process.exit(1);
}

const declared = new Set([...Object.keys(ASSUMED), ...Object.keys(ACCIDENTAL)]);
let failed = false;
const neuf = [...observed].filter((k) => !declared.has(k)).sort();
if (neuf.length) {
    failed = true;
    console.error(`❌ [CCO-01] ${neuf.length} couplage(s) NON DÉCLARÉ(S) :`);
    for (const k of neuf)
        console.error(
            `   + ${k}  (défini par : ${[...(definers.get(k.split(" :: ")[0]) ?? [])].join("+")})`
        );
    console.error(`   Définir la classe chez l'écrivain, ou déclarer l'usage ici avec son motif.`);
}
const perime = [...declared].filter((k) => !observed.has(k)).sort();
if (perime.length) {
    failed = true;
    console.error(
        `❌ [CCO-02] ${perime.length} entrée(s) déclarée(s) qui ne s'observent plus — retirer :`
    );
    for (const k of perime) console.error(`   − ${k}`);
}
if (failed) process.exit(1);
console.log(
    `\x1b[32m✓ CCO\x1b[0m — ${observed.size} couplage(s), tous déclarés (${Object.keys(ASSUMED).length} assumés · ${Object.keys(ACCIDENTAL).length} accidentels gelés, liste décroissante).`
);
