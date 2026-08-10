#!/usr/bin/env node
/*!
 * NAMESPACE-TYPING : la surface `GeoLeaf.*` ne peut plus s'élargir sans être typée.
 * © 2026 Mattieu Pottier — MIT — API publique S4.2
 *
 * ## Le constat
 *
 * `GeoLeafGlobal` (`packages/core/src/global.d.ts`) porte une traîne `[key: string]: unknown`.
 * Toute clé du namespace qu'elle ne déclare pas y tombe et rend `unknown`. À l'ouverture de
 * cette gate : 89 clés au namespace post-boot, **28 déclarées**. Les 61 autres n'étaient pas
 * « à moitié typées », elles n'étaient pas typées du tout — le compilateur n'avait rien à
 * vérifier sur leurs affectations.
 *
 * ## Trois règles, et la troisième est celle qui empêche de tricher
 *
 *   HOST-04  Une clé du corpus absente de `GeoLeafGlobal` ET de la baseline → ERREUR.
 *            Une clé NEUVE ne peut pas naître non typée.
 *   HOST-05  Une entrée de baseline désormais typée, ou sortie du corpus → ERREUR jusqu'à
 *            son retrait. La baseline ne peut que RÉTRÉCIR. Même invariant que EM-02
 *            (`check-event-map-coverage.cjs`), MH-02 et PCB-02 ; la formulation est la leur.
 *   HOST-06  Une déclaration VIDE ne compte pas comme un typage. `unknown`, `any`, `object`,
 *            `{}` et `Record<string, unknown>` nu ne vérifient rien.
 *
 * ⚠️ HOST-06 n'est pas un raffinement, c'est ce qui empêche la gate d'être décorative. Sans
 * elle, la baseline entière se solde en déclarant 61 membres `unknown` : la liste tombe à
 * zéro, le pourcentage affiche 100 %, et pas une seule affectation n'est vérifiée de plus.
 * C'est exactement le défaut du gate de frontière au Sprint 4 (`verify-core-standalone`, dont
 * la regex avait cessé de matcher après un renommage de répertoire) — une garde qui sort verte
 * en ne gardant plus rien. Mesure à l'ouverture : sur les 28 membres déclarés, **9 précis**, **18 objets en
 * ligne portant leur propre traîne**, **1 vide** (`UI?: Record<string, unknown>`).
 *
 * ## Ce que cette gate NE mesure PAS : un pourcentage
 *
 * Un pourcentage est un cliquet FAUX. Il monte quand on RETIRE une clé non typée — le lot
 * S4.3 l'a fait passer de 27 % à 31 % en sortant 13 clés `_` du namespace, sans qu'une seule
 * ligne de type soit écrite. La gate tient donc une LISTE NOMINATIVE, comme EM-02. Le
 * pourcentage est imprimé en dernière ligne, à titre informatif, et n'asservit rien.
 *
 * ## Les deux sources, toutes deux lues sur AST
 *
 *   corpus  `EXPECTED_FACADE_KEYS` de `scripts/lib/namespace-surface.mjs` — la description
 *           unique de la surface, posée au S4.1 ; c'est aussi l'oracle de HOST-SYNC.
 *   oracle  les membres nommés de `GeoLeafGlobal`, avec le TEXTE de leur type (HOST-06).
 *
 * Aucune liste recopiée : `lib/ts-decl-read.cjs` refuse de conclure sur cinq formes de
 * lecture impossible, plus la clause `extends` — un membre hérité serait invisible ici.
 *
 * Usage :
 *   node scripts/check-namespace-typing-coverage.cjs                  # gate
 *   node scripts/check-namespace-typing-coverage.cjs --update-baseline
 * Exit codes : 0 vert · 1 régression (HOST-04/05/06) · 2 erreur d'outillage.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
const { readInterfaceMembers, readExportedStringArray } = require("./lib/ts-decl-read.cjs");

const TAG = "NAMESPACE-TYPING";
const ROOT = registry.ROOT;

// Résolu par le registre — un `packages/core` en dur cesserait de matcher au premier
// déplacement, et la gate sortirait verte en n'ayant rien lu (cf. probe-gate-visibility.cjs).
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
 * Types qui ne typent rien (HOST-06).
 *
 * `Record<string, unknown>` y figure et c'est délibéré : il accepte n'importe quel objet et
 * rend `unknown` sur chaque accès — un membre ainsi déclaré est indiscernable de la traîne
 * qu'on cherche justement à vider.
 */
const VACUOUS = new Set(["unknown", "any", "object", "{}", "Record<string, unknown>"]);

/** Un membre déclaré par un objet EN LIGNE qui porte sa propre traîne : typé, mais ouvert. */
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
                    "API publique S4.2 — clés de EXPECTED_FACADE_KEYS que GeoLeafGlobal " +
                    "(packages/core/src/global.d.ts) ne type pas, ou type de façon VIDE " +
                    "(unknown/any/object/{}/Record<string, unknown> — HOST-06). Cette liste ne " +
                    "peut que RÉTRÉCIR (HOST-05) : déclarez le membre, puis retirez sa ligne. Ne " +
                    "jamais y ajouter à la main — une clé neuve doit naître typée (HOST-04). Les " +
                    "clés `_` restantes relèvent de la dette D-14 (service-locator) et sortent du " +
                    "namespace, elles ne se typent pas.",
                _generated: "node scripts/check-namespace-typing-coverage.cjs --update-baseline",
                count: sorted.length,
                keys: sorted,
            },
            null,
            // 4, et pas 2 — Prettier possède `scripts/**/*.json` à `tabWidth: 4` et
            // reformaterait tout le fichier au commit, transformant le retrait d'une ligne
            // en diff illisible. Même raison que check-event-map-coverage.cjs.
            4
        ) + "\n"
    );
}

// ── Lecture ──────────────────────────────────────────────────────────────────────────
const corpus = readExportedStringArray(SURFACE, "EXPECTED_FACADE_KEYS", { tag: TAG });
const members = readInterfaceMembers(GLOBAL_DTS, "GeoLeafGlobal", { tag: TAG, withTypes: true });

// ── Non-vacuité ──────────────────────────────────────────────────────────────────────
// Un corpus vide et une interface vide s'accordent parfaitement et ne prouvent rien. Les
// planchers sont très en dessous des valeurs du jour (89 / 28) : ils attrapent un instrument
// effondré, pas une surface qui aurait légitimement maigri.
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
const vacuous = new Map(); // nom → type vide (HOST-06)
const openTail = []; // typés mais portant leur propre traîne — informatif

for (const [name, type] of members) {
    const t = normalise(type);
    if (t === "" || VACUOUS.has(t)) {
        vacuous.set(name, t === "" ? "(aucun)" : t);
        continue;
    }
    typed.add(name);
    if (OPEN_TAIL_RE.test(t)) openTail.push(name);
}

/** Non typée = absente des membres, OU présente mais déclarée vide (HOST-06). */
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

// Une clé non typée qui n'est pas en baseline est une régression. Deux formes, deux messages :
// HOST-04 la clé n'est pas déclarée du tout · HOST-06 elle EST déclarée, mais vide.
// Le second est le geste de contournement : déclarer `unknown` pour retirer la ligne de
// baseline solderait la liste sans faire vérifier une seule affectation de plus.
const regressions = untyped.filter((k) => !baseline.has(k));
const host04 = regressions.filter((k) => !vacuous.has(k));
const host06 = regressions.filter((k) => vacuous.has(k));

// HOST-05 — entrée de baseline devenue fausse : désormais typée, ou sortie du corpus.
const host05 = [...baseline].filter((k) => typed.has(k) || !corpus.has(k)).sort();

// Membres vides DÉJÀ en baseline : de la dette connue, pas une régression. Affichés en clair
// plutôt que fondus dans le total — sans quoi « 62 non typées » laisserait croire 62 absences,
// alors que l'une d'elles est une déclaration qui a l'air d'en être une.
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
            `\`[key: string]: unknown\` ${C.d}(gisement B-13, non bloquant)${C.x}`
    );
}
// Informatif, JAMAIS assertif — voir le docblock : un pourcentage monte quand on retire une
// clé non typée, il ne peut donc pas servir de cliquet.
console.log(
    `${C.d}   ${typed.size}/${corpus.size} clés typées — ${pct} % (informatif, n'asservit rien).${C.x}`
);
process.exit(0);
