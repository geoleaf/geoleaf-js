#!/usr/bin/env node
/*!
 * NAMESPACE-TYPING: the `GeoLeaf.*` surface can no longer widen without being typed.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## The finding
 *
 * `GeoLeafGlobal` (`packages/core/src/global.d.ts`) carries a
 * `[key: string]: unknown` tail. Every namespace key it does not declare falls into
 * it and renders `unknown`. When this gate opened: 89 keys on the post-boot
 * namespace, **28 declared**. The 61 others were not "half typed", they were not
 * typed at all — the compiler had nothing to verify on their assignments.
 *
 * ## Three rules, and the third is the one that prevents cheating
 *
 *   HOST-04  A corpus key absent from `GeoLeafGlobal` AND the baseline → ERROR.
 *            A NEW key cannot be born untyped.
 *   HOST-05  A baseline entry now typed, or out of the corpus → ERROR until removed.
 *            The baseline can only SHRINK. Same invariant as EM-02
 *            (`check-event-map-coverage.cjs`), MH-02 and PCB-02; the wording is
 *            theirs.
 *   HOST-06  An EMPTY declaration does not count as typing. `unknown`, `any`,
 *            `object`, `{}` and bare `Record<string, unknown>` verify nothing.
 *
 * ⚠️ HOST-06 is no refinement, it is what keeps the gate from being decorative.
 * Without it, the entire baseline settles by declaring 61 members `unknown`: the list
 * drops to zero, the percentage shows 100 %, and not a single assignment is verified
 * more. Exactly the boundary gate's defect (`verify-core-standalone`, whose regex had
 * stopped matching after a directory rename) — a guard going green while guarding
 * nothing anymore. Measurement at opening: of the 28 declared members, **9 precise**,
 * **18 inline objects carrying their own tail**, **1 empty**
 * (`UI?: Record<string, unknown>`).
 *
 * ## What this gate does NOT measure: a percentage
 *
 * A percentage is a FALSE ratchet. It climbs when an untyped key is REMOVED — one
 * removal batch took it from 27 % to 31 % by taking 13 `_` keys out of the
 * namespace, without a single type line being written. The gate thus keeps a
 * NOMINATIVE LIST, like EM-02. The percentage prints on the last line, for
 * information, and governs nothing.
 *
 * ## The two sources, both read off the AST
 *
 *   corpus  `EXPECTED_FACADE_KEYS` from `scripts/lib/namespace-surface.mjs` — the
 *           surface's single description; also HOST-SYNC's oracle.
 *   oracle  `GeoLeafGlobal`'s named members, with their type TEXT (HOST-06).
 *
 * No copied list: `lib/ts-decl-read.cjs` refuses to conclude on five impossible-read
 * shapes, plus the `extends` clause — an inherited member would be invisible here.
 *
 * Usage:
 *   node scripts/check-namespace-typing-coverage.cjs                  # gate
 *   node scripts/check-namespace-typing-coverage.cjs --update-baseline
 * Exit codes: 0 green · 1 regression (HOST-04/05/06) · 2 tooling error.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
const { readInterfaceMembers, readExportedStringArray } = require("./lib/ts-decl-read.cjs");

const TAG = "NAMESPACE-TYPING";
const ROOT = registry.ROOT;

// Resolved through the registry — a hard-coded `packages/core` would stop matching at
// the first move, and the gate would go green having read nothing
// (cf. probe-gate-visibility.cjs).
const CORE_DIR = registry.requireByDirName("core").absDir;

const GLOBAL_DTS = path.join(CORE_DIR, "src", "global.d.ts");
const SURFACE = path.join(ROOT, "scripts", "lib", "namespace-surface.mjs");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "namespace-typing-coverage.json");

const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    d: "\x1b[2m",
    c: "\x1b[36m",
    y: "\x1b[33m",
    x: "\x1b[0m",
};

/**
 * Types that type nothing (HOST-06).
 *
 * `Record<string, unknown>` is in it, deliberately: it accepts any object and renders
 * `unknown` on every access — a member so declared is indistinguishable from the very
 * tail one seeks to empty.
 */
const VACUOUS = new Set(["unknown", "any", "object", "{}", "Record<string, unknown>"]);

/** A member declared by an INLINE object carrying its own tail: typed, but open. */
const OPEN_TAIL_RE = /\[\s*key\s*:\s*string\s*\]\s*:\s*unknown/;

const normalise = (t) => t.replace(/\s+/g, " ").trim();

function loadBaseline() {
    if (!fs.existsSync(BASELINE)) {
        console.error(
            `ERROR [${TAG}]: baseline absente — ${path.relative(ROOT, BASELINE)}\n` +
                "Une baseline manquante n'est pas une liste vide : ce serait déclarer typée\n" +
                "toute la surface. Générer : node scripts/check-namespace-typing-coverage.cjs " +
                "--update-baseline"
        );
        process.exit(2);
    }
    return new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).keys);
}

function writeBaseline(keys) {
    const sorted = [...keys].sort();
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "Clés de EXPECTED_FACADE_KEYS que GeoLeafGlobal " +
                    "(packages/core/src/global.d.ts) ne type pas, ou type de façon VIDE " +
                    "(unknown/any/object/{}/Record<string, unknown> — HOST-06). Cette liste ne " +
                    "peut que RÉTRÉCIR (HOST-05) : déclarez le membre, puis retirez sa ligne. Ne " +
                    "jamais y ajouter à la main — une clé neuve doit naître typée (HOST-04). " +
                    "⚠️ Les clés `_` restantes relèvent de la dette service-locator et ont " +
                    "vocation à SORTIR du namespace — mais c'est un chantier d'architecture qui " +
                    "touche la séquence de boot B1→B11, pas un préalable au typage. Ce commentaire " +
                    "a dit « elles ne se typent pas » jusqu'au 23/08/2026, et c'était FAUX : huit " +
                    "clés `_` portent déjà une forme réelle dans global.d.ts, dont `_VectorTiles` " +
                    "et `_Cluster`, qui sont précisément deux des clés de cette dette. Un `typeof " +
                    "import(...)` est type-only, effacé à la compilation : il n'ajoute aucune arête " +
                    "statique et n'entrave donc pas l'optionalité des capacités. Typer DÉCRIT ce " +
                    "qui existe, cela ne sanctionne rien — le `@internal` dit déjà que ce n'est pas " +
                    "une API d'intégrateur —, et cela retire un `unknown` d'un contrat PUBLIÉ.",
                _generated: "node scripts/check-namespace-typing-coverage.cjs --update-baseline",
                count: sorted.length,
                keys: sorted,
            },
            null,
            // 4, not 2 — Prettier owns `scripts/**/*.json` at `tabWidth: 4` and would
            // reformat the whole file at commit, turning one line's removal into an
            // unreadable diff. Same reason as check-event-map-coverage.cjs.
            4
        ) + "\n"
    );
}

// ── Lecture ──────────────────────────────────────────────────────────────────────────
const corpus = readExportedStringArray(SURFACE, "EXPECTED_FACADE_KEYS", { tag: TAG });
const members = readInterfaceMembers(GLOBAL_DTS, "GeoLeafGlobal", { tag: TAG, withTypes: true });

// ── Non-emptiness ────────────────────────────────────────────────────────────────────
// An empty corpus and an empty interface agree perfectly and prove nothing. The
// floors sit well below today's values (89 / 28): they catch a collapsed instrument,
// not a surface that legitimately slimmed.
if (corpus.size < 50) {
    console.error(
        `ERROR [${TAG}]: le corpus ne rend que ${corpus.size} clé(s) (plancher 50). ` +
            "Sous le plancher, la gate REFUSE de conclure — elle serait verte en n'ayant rien lu."
    );
    process.exit(2);
}
if (members.size === 0) {
    console.error(
        `ERROR [${TAG}]: \`GeoLeafGlobal\` ne déclare aucun membre. La gate refuse de conclure.`
    );
    process.exit(2);
}

// ── Mesure ───────────────────────────────────────────────────────────────────────────
const typed = new Set();
const vacuous = new Map(); // name → empty type (HOST-06)
const openTail = []; // typed yet carrying their own tail — informative

for (const [name, type] of members) {
    const t = normalise(type);
    if (t === "" || VACUOUS.has(t)) {
        vacuous.set(name, t === "" ? "(aucun)" : t);
        continue;
    }
    typed.add(name);
    if (OPEN_TAIL_RE.test(t)) openTail.push(name);
}

/** Untyped = absent from the members, OR present but declared empty (HOST-06). */
const untyped = [...corpus].filter((k) => !typed.has(k)).sort();

if (UPDATE_BASELINE) {
    writeBaseline(untyped);
    console.log(
        `${C.g}✓${C.x} ${TAG}: baseline régénérée (${untyped.length} clé(s) non typée(s) figée(s) ` +
            `dans ${path.relative(ROOT, BASELINE)}).`
    );
    process.exit(0);
}

const baseline = loadBaseline();

// An untyped key not in the baseline is a regression. Two shapes, two messages:
// HOST-04 the key is not declared at all · HOST-06 it IS declared, but empty.
// The second is the workaround move: declaring `unknown` to remove the baseline line
// would settle the list without one more assignment getting verified.
const regressions = untyped.filter((k) => !baseline.has(k));
const host04 = regressions.filter((k) => !vacuous.has(k));
const host06 = regressions.filter((k) => vacuous.has(k));

// HOST-05 — baseline entry gone false: now typed, or out of the corpus.
const host05 = [...baseline].filter((k) => typed.has(k) || !corpus.has(k)).sort();

// Empty members ALREADY in the baseline: known debt, not a regression. Shown in the
// clear rather than melted into the total — otherwise "62 untyped" would suggest 62
// absences, while one of them is a declaration that looks like one.
const vacuousKnown = [...vacuous.keys()].filter((k) => baseline.has(k)).sort();

let failed = false;

if (host04.length > 0) {
    failed = true;
    console.error(
        `${C.r}✗${C.x} [${TAG}/HOST-04] ${host04.length} clé(s) du namespace ne sont pas typées ` +
            "dans `GeoLeafGlobal` et ne sont pas en baseline :"
    );
    for (const k of host04) console.error(`    ${k}`);
    console.error(
        `${C.d}    Une clé NEUVE naît typée. Déclarez-la dans packages/core/src/global.d.ts\n` +
            `    — en ligne, jamais par \`extends\` (le lecteur n'itère que les membres déclarés).${C.x}`
    );
}

if (host05.length > 0) {
    failed = true;
    console.error(
        `${C.r}✗${C.x} [${TAG}/HOST-05] ${host05.length} entrée(s) de baseline ne sont plus vraies :`
    );
    for (const k of host05) {
        console.error(`    ${k} — ${typed.has(k) ? "désormais typée" : "absente du corpus"}`);
    }
    console.error(
        `${C.d}    La baseline est un registre de dette, pas un laissez-passer : elle ne peut que\n` +
            `    rétrécir. Retirez la ligne, ou régénérez (--update-baseline).${C.x}`
    );
}

if (host06.length > 0) {
    failed = true;
    console.error(
        `${C.r}✗${C.x} [${TAG}/HOST-06] ${host06.length} membre(s) de \`GeoLeafGlobal\` sont ` +
            "déclarés sans rien typer, hors baseline :"
    );
    for (const k of host06) console.error(`    ${k}: ${vacuous.get(k)}`);
    console.error(
        `${C.d}    \`unknown\`, \`any\`, \`object\`, \`{}\` et \`Record<string, unknown>\` nu ne\n` +
            `    vérifient aucune affectation : le membre est indiscernable de la traîne qu'il est\n` +
            `    censé vider. Écrivez la forme réelle — au besoin \`typeof import("./…").X\`, qui\n` +
            `    laisse le compilateur l'inférer.${C.x}`
    );
}

if (failed) process.exit(1);

// ── Rapport ──────────────────────────────────────────────────────────────────────────
const pct = ((typed.size / corpus.size) * 100).toFixed(1);

console.log(`${C.c}── 🏷️  Typage du namespace GeoLeaf ──${C.x}\n`);
console.log(
    `${C.g}✓${C.x}  aucune clé neuve non typée ; baseline ${baseline.size} (ne peut que rétrécir).`
);
if (vacuousKnown.length > 0) {
    console.log(
        `${C.y}ℹ${C.x}  ${vacuousKnown.length} membre(s) déclarés mais VIDES, déjà en baseline : ` +
            `${vacuousKnown.join(", ")} ${C.d}(HOST-06 les compte non typés)${C.x}`
    );
}
if (openTail.length > 0) {
    console.log(
        `${C.y}ℹ${C.x}  ${openTail.length} membre(s) typés portent encore leur propre traîne ` +
            `\`[key: string]: unknown\` ${C.d}(gisement des traînes, non bloquant)${C.x}`
    );
}
// Informative, NEVER assertive — see the docblock: a percentage climbs when an
// untyped key is removed, so it cannot serve as a ratchet.
console.log(
    `${C.d}   ${typed.size}/${corpus.size} clés typées — ${pct} % (informatif, n'asservit rien).${C.x}`
);
process.exit(0);
