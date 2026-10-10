#!/usr/bin/env node
/**
 * @fileoverview DOC-CONFIG-DEFAULTS — does the integrator guide announce the same default
 * as the configuration inventory, and as the code constant it claims to describe?
 *
 * ## The hole this gate closes
 *
 * A default value written in the integrator guide was read by NOTHING.
 * `check-config-coverage.cjs` confronts the schemas with the inventory's KEY column,
 * never its `Défaut` column; `check-doc-config-examples.cjs` reads the copy-pastable JSON
 * blocks. A wrong default in a table cell is neither. It is the costliest shape a
 * documentation defect can take: the integrator discovers it in production, on a
 * behaviour nothing announced.
 *
 * ## What is judged — a CONCORDANCE, and it must be said here
 *
 * 🛑 **The inventory is NOT an oracle of truth for defaults.** It is hand-curated and its
 * `Défaut` column is gated by nothing else. This gate therefore proves that two documents
 * AGREE, not that either is right: **two texts wrong together come out green.** What it
 * buys is narrower and real — a default can no longer be corrected in one document while
 * the other keeps the old value, which is how every divergence met so far was born.
 *
 * Truth is only reached where a row is BOUND to a code constant (DCD-05), by a marker
 * placed above its table:
 *
 *     <!-- geoleaf:docs:default <key> <repo-relative path> <CONSTANT> -->
 *
 * A binding that resolves nothing — file moved, constant renamed, initialiser no longer a
 * literal — is a refusal (DCD-03), never a green skip. The path is a real one on purpose:
 * the docs' path gate reads it too, so a moved file is reported twice rather than never.
 *
 * ## The five rules
 *
 *   DCD-01  No NEW divergence: the guide and the inventory state different defaults for
 *           the same key — including "one states a default, the other states none".
 *   DCD-02  The baseline can only SHRINK. An entry fixed in the docs must leave the file.
 *   DCD-03  Nothing judged, an unreadable table, or a binding resolving nothing is a
 *           refusal: a green gate that looked at nothing is the worst outcome.
 *   DCD-04  No NEW unjudged row: a key the inventory does not know, or a default written
 *           as prose on either side. The blind spot is frozen so it cannot grow in silence.
 *   DCD-05  A row bound to a code constant states that constant's value. No baseline: the
 *           marker is opt-in, so there is no debt to freeze.
 *
 * ## Two shapes are read, because the first one alone was blind
 *
 * A default lives either in a cell under a `Défaut` header, or INLINE in a description
 * (`défaut : X`, `Défaut `X``) of a table that has no such column. The case that opened
 * this class — a streaming ceiling announced at half its real value — was of the second
 * shape. A gate bounded to the columns would have stayed blind to it.
 *
 * In a table that HAS a `Défaut` column, inline mentions are not read: the column is the
 * statement, and a description may legitimately cite a neighbouring key's default.
 *
 * ## Cell grammar
 *
 * A JSON literal between backticks at the head of the cell, or a bare
 * `true|false|null|number`, then free gloss. `—` means "no default". Digit separators
 * (`100_000`, `50 000`) are normalised and values are compared, not strings. Anything
 * else is PROSE: not judged, frozen (DCD-04).
 *
 * Instance placeholders are equivalent: `basemaps.{id}.x`, `basemaps.<id>.x` and
 * `basemaps[].x` name the same key.
 *
 * ## Keys written as the integrator writes them
 *
 * A module's block lives in its own file, where a key is written RELATIVE to the block:
 * `render.popup.showIconCategory`, not `modules.taxonomy.render.popup.showIconCategory`.
 * The guide keeps that notation — it is the one that gets copied — and a marker above
 * the table tells this gate where the block is mounted:
 *
 *     <!-- geoleaf:docs:key-prefix modules.taxonomy -->
 *
 * A wrong or missing prefix does not skip green: the rows become keys the inventory
 * does not know, i.e. new DCD-04 entries.
 *
 * ## What this gate does NOT guard
 *
 * - The truth of a default both documents agree on (see above).
 * - A default asserted in prose with no literal (`Défaut : la valeur d'actionId`).
 * - Prose outside tables, and every document other than the guide.
 * - Inline mentions in a table with no key column: counted, frozen, never compared.
 *
 * ## Usage
 *
 *        node scripts/check-doc-config-defaults.cjs
 *        node scripts/check-doc-config-defaults.cjs --report
 *        node scripts/check-doc-config-defaults.cjs --update-baseline
 *
 * `--report` lists every non-concordant statement with its line in both documents.
 *
 * ⚠️ `--update-baseline` runs AFTER fixing the docs, never to silence a new divergence.
 *
 * `GEOLEAF_DCD_GUIDE` and `GEOLEAF_DCD_INVENTORY` substitute the two documents. They exist
 * for `probe-gate-visibility.cjs` and nothing else: without them, proving this gate would
 * require mutating the real guide — so it would be done once, at wiring, and never again.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const docsPaths = require("./lib/docs-paths.cjs");
const lib = require("./lib/config-defaults-read.cjs");

const { DEFAULT_HEADER, hasUnit, parseStated, render, canonicalKey } = lib;

const ROOT = path.resolve(__dirname, "..");
const GUIDE = process.env.GEOLEAF_DCD_GUIDE
    ? path.resolve(process.env.GEOLEAF_DCD_GUIDE)
    : docsPaths.reference("GEOLEAF-JS_GUIDE_CONFIGURATIONS_COMPLET.md");
const INVENTORY = process.env.GEOLEAF_DCD_INVENTORY
    ? path.resolve(process.env.GEOLEAF_DCD_INVENTORY)
    : docsPaths.reference("inventaire_config_parametres.md");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "doc-config-defaults.json");
const UPDATE = process.argv.includes("--update-baseline");
const REPORT = process.argv.includes("--report");

const KEY_HEADER = /^(param[èe]tre|cl[ée]|option|propri[ée]t[ée]|r[ée]glage)$/i;
const SECTION_HEADER = /^section$/i;
// `défaut`, an optional colon, then a TOKEN: bold, backticked, a bare number, or an
// upper-case word (`ON`). Ordinary prose (`par défaut du serveur`) carries no token.
// A bare number is matched GREEDILY with its separators and trailing punctuation, which
// `parseLiteral` trims: a tighter pattern needs a quantifier nested in an optional group.
const MENTION =
    /\b[Dd]éfaut(?: appliqué si absent)?\s*:?\s*(\*\*[^*]+\*\*|`[^`]+`|-?\d[\d\s_.,]*|[A-Z]{2,}\b)/g;
// The mirrored shape: the literal first, then the word — `` `true` (défaut) ``.
const MENTION_AFTER = /(`[^`]+`)\s*\(défaut\)/g;

/**
 * @typedef {import("./lib/config-defaults-read.cjs").Stated} Stated
 * @typedef {import("./lib/config-defaults-read.cjs").Binding} Binding
 * @typedef {import("./lib/config-defaults-read.cjs").Table} Table
 */

/**
 * Refuses to go on. Exit 2 is reserved to "the gate could not look", as opposed to
 * exit 1, "the gate looked and the docs are wrong".
 *
 * @param {string} message
 * @returns {never}
 */
function refuse(message) {
    console.error(`ERROR [DOC-CONFIG-DEFAULTS/DCD-03]: ${message}`);
    process.exit(2);
}

/**
 * Runs a read of the shared library, and turns what it could not read into a refusal.
 *
 * @template T
 * @param {() => T} read
 * @returns {T}
 */
function reading(read) {
    try {
        return read();
    } catch (err) {
        return refuse(/** @type {Error} */ (err).message);
    }
}

/**
 * Reads the literal a binding points at.
 *
 * @param {Binding} binding
 * @returns {Stated}
 */
function readConstant(binding) {
    const file = path.resolve(ROOT, binding.file);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
        refuse(
            `liaison ligne ${binding.line} : fichier ${binding.file} introuvable dans le dépôt.`
        );
    }
    // The name comes from a document and goes into a pattern: an identifier, or nothing.
    if (!/^[A-Za-z_$][\w$]*$/.test(binding.constant)) {
        refuse(`liaison ligne ${binding.line} : « ${binding.constant} » n'est pas un identifiant.`);
    }
    const source = fs.readFileSync(file, "utf8");
    const decl = new RegExp(
        `^\\s*(?:export\\s+)?const\\s+${binding.constant}\\s*(?::[^=]+)?=\\s*([^;\\n]+);`,
        "m"
    ).exec(source);
    if (!decl) {
        refuse(
            `liaison ligne ${binding.line} : constante ${binding.constant} absente de ${binding.file}.`
        );
    }
    const stated = parseStated(decl[1]);
    if (stated.kind !== "lit") {
        refuse(`liaison ligne ${binding.line} : ${binding.constant} n'est pas un littéral.`);
    }
    return stated;
}

/**
 * The keys a row is about: every backticked token of its key cell, prefixed by its
 * `Section` cell when the table has one.
 *
 * @param {string[]} cells
 * @param {number} keyCol
 * @param {number} sectionCol
 * @returns {string[]}
 */
function rowKeys(cells, keyCol, sectionCol) {
    const keys = [...(cells[keyCol] || "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (sectionCol < 0) return keys;
    const section = (cells[sectionCol] || "").replace(/`/g, "").trim();
    return keys.length > 0 ? keys.map((k) => `${section}.${k}`) : [section];
}

/**
 * The defaults a row states: its `Défaut` cell, or the inline mentions of its other
 * cells when the table has no such column.
 *
 * @param {string[]} cells
 * @param {number} keyCol
 * @param {number} defCol
 * @returns {Stated[]}
 */
function rowStatements(cells, keyCol, defCol) {
    if (defCol >= 0) return [parseStated(cells[defCol] || "")];
    const prose = cells.filter((_, i) => i !== keyCol).join(" | ");
    const mirrored = [...prose.matchAll(MENTION_AFTER)].map((m) => parseStated(m[1]));
    return mirrored.concat(
        [...prose.matchAll(MENTION)].map((m) => {
            const token = m[1];
            if (/^[A-Z]{2,}$/.test(token)) return { kind: /** @type {const} */ ("prose") };
            const after = prose.slice((m.index ?? 0) + m[0].length);
            if (/^-?\d/.test(token) && hasUnit(token, after)) {
                return { kind: /** @type {const} */ ("prose") };
            }
            return parseStated(token);
        })
    );
}

/**
 * Judges every default the guide states.
 *
 * @returns {{ entries: string[], bound: string[], report: string[], stats: Record<string, number> }}
 */
function scan() {
    const inventory = reading(() => lib.readInventory(INVENTORY));
    const tables = reading(() =>
        lib.readTables(fs.readFileSync(GUIDE, "utf8"), (heading) => {
            const numbered = /^##\s+(\S+?)\.\s/.exec(heading);
            return numbered ? `§${numbered[1]}` : undefined;
        })
    );

    /** @type {Set<string>} */
    const entries = new Set();
    /** @type {string[]} */
    const bound = [];
    /** @type {string[]} */
    const report = [];
    const stats = { tables: 0, columnRows: 0, mentions: 0, agree: 0, bindings: 0, inventory: 0 };
    for (const rows of inventory.values()) stats.inventory += rows.length;

    for (const table of tables) {
        const keyCol = table.headers.findIndex((h) => KEY_HEADER.test(h));
        const defCol = table.headers.findIndex((h) => DEFAULT_HEADER.test(h));
        const sectionCol = table.headers.findIndex((h) => SECTION_HEADER.test(h));
        if (defCol >= 0 && keyCol < 0) {
            refuse(`tableau à colonne « Défaut » sans colonne de clé (ligne ${table.line}).`);
        }
        if (defCol >= 0) stats.tables++;

        for (const row of table.rows) {
            const statements = rowStatements(row.cells, keyCol, defCol);
            if (statements.length === 0) continue;
            if (defCol >= 0) stats.columnRows++;
            else stats.mentions += statements.length;

            const keys = keyCol >= 0 ? rowKeys(row.cells, keyCol, sectionCol) : [];
            // Line numbers go to the report only: an entry carrying one would go stale
            // at the first row inserted above it.
            /** @param {string} verdict @param {string} key @param {string} detail @param {string} [where] */
            const note = (verdict, key, detail, where = "") => {
                entries.add(`${verdict} :: ${table.section} :: ${key} :: ${detail}`);
                report.push(`  L${row.line} ${verdict} — ${key} : ${detail}${where}`);
            };
            if (keys.length === 0) {
                const first = /`([^`]+)`/.exec(row.cells.join(" "));
                note("non-jugé", first ? first[1] : "?", "mention en ligne sans colonne de clé");
                continue;
            }

            for (const written of keys) {
                // A binding names the key as the row writes it; the inventory knows it
                // by its full path.
                const key = table.prefix ? `${table.prefix}.${written}` : written;
                for (const stated of statements) {
                    const binding = table.bindings.find((b) => b.key === written);
                    if (binding) {
                        binding.used = true;
                        stats.bindings++;
                        const constant = readConstant(binding);
                        if (render(stated) !== render(constant)) {
                            bound.push(
                                `${table.section} :: ${key} :: guide ${render(stated)} ≠ ` +
                                    `${binding.constant} ${render(constant)} (${binding.file})`
                            );
                        }
                        continue;
                    }
                    const known = inventory.get(canonicalKey(key));
                    if (!known) {
                        note("non-jugé", key, "clé inconnue de l'inventaire");
                    } else if (stated.kind === "prose") {
                        note("non-jugé", key, "prose au guide");
                    } else if (known.some((k) => render(k.stated) === render(stated))) {
                        stats.agree++;
                    } else if (known.every((k) => k.stated.kind === "prose")) {
                        note("non-jugé", key, "prose à l'inventaire");
                    } else {
                        const theirs = known.map((k) => render(k.stated)).join(" / ");
                        const where = ` (inventaire L${known.map((k) => k.line).join(", L")})`;
                        note(
                            "divergence",
                            key,
                            `guide ${render(stated)} ≠ inventaire ${theirs}`,
                            where
                        );
                    }
                }
            }
        }
        const idle = table.bindings.find((b) => !b.used);
        if (idle)
            refuse(`liaison ligne ${idle.line} : la clé « ${idle.key} » n'est pas au tableau.`);
    }
    return { entries: [...entries].sort(), bound, report, stats };
}

const { entries, bound, report, stats } = scan();
const bar = "─".repeat(72);
const perimeter =
    `${stats.tables} tableaux à colonne « Défaut », ${stats.columnRows} lignes, ` +
    `${stats.mentions} mention(s) en ligne ; ${stats.agree} concordance(s) avec les ` +
    `${stats.inventory} lignes de l'inventaire`;

// ── DCD-03 — a gate that judged nothing proved nothing ───────────────────────────────────
if (stats.tables === 0 || stats.inventory === 0 || stats.agree === 0) {
    refuse(
        `rien n'a été jugé — ${perimeter}. C'est la gate qui est aveugle, pas le guide qui est juste.`
    );
}

/**
 * Prints DCD-05's failures, if any.
 *
 * @returns {boolean} `true` when DCD-05 failed
 */
function reportBound() {
    if (bound.length === 0) return false;
    console.error(
        `❌ [DOC-CONFIG-DEFAULTS/DCD-05] ${bound.length} défaut(s) contredit(s) par le code :`
    );
    for (const b of bound) console.error(`     ✗ ${b}`);
    console.error(
        "\n  Cette ligne du guide est LIÉE à une constante du code par un marqueur\n" +
            "  `<!-- geoleaf:docs:default … -->` : elle doit en annoncer la valeur. Corriger le\n" +
            "  guide — la constante fait foi."
    );
    return true;
}

if (REPORT) {
    console.log(bar);
    console.log(`[DOC-CONFIG-DEFAULTS] ${perimeter}.`);
    for (const line of report) console.log(line);
    for (const b of bound) console.log(`  liaison — ${b}`);
    console.log(bar);
    process.exit(0);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        // Indentation 4: Prettier owns `scripts/**/*.json` at `tabWidth: 4`.
        JSON.stringify(
            {
                _comment:
                    "DOC-CONFIG-DEFAULTS — défauts que le guide intégrateur et l'inventaire de " +
                    "configuration n'annoncent pas de la même façon (`divergence`), et lignes que " +
                    "la gate ne sait pas juger (`non-jugé` : clé inconnue de l'inventaire, ou " +
                    "défaut écrit en prose). Cette liste ne peut que RÉTRÉCIR (DCD-02) et aucune " +
                    "entrée ne peut y NAÎTRE (DCD-01, DCD-04). Régénérer avec --update-baseline " +
                    "UNIQUEMENT après avoir corrigé la doc, jamais pour faire taire un écart neuf.",
                _generated: "node scripts/check-doc-config-defaults.cjs --update-baseline",
                count: entries.length,
                entries,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [DOC-CONFIG-DEFAULTS] baseline régénérée — ${entries.length} entrée(s).`);
    // DCD-05 has no baseline: regenerating the others' does not silence it.
    process.exit(reportBound() ? 1 : 0);
}

if (!fs.existsSync(BASELINE)) {
    // An absent baseline is NOT an empty list: it would declare the guide concordant.
    console.error("ERROR [DOC-CONFIG-DEFAULTS]: baseline absente.");
    console.error("  Run: node scripts/check-doc-config-defaults.cjs --update-baseline");
    process.exit(2);
}

/** @type {Set<string>} */
const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(entries);

const fresh = entries.filter((e) => !baseline.has(e));
const freshDivergent = fresh.filter((e) => e.startsWith("divergence")); // DCD-01
const freshUnjudged = fresh.filter((e) => e.startsWith("non-jugé")); // DCD-04
const stale = [...baseline].filter((e) => !seen.has(e)).sort(); // DCD-02

console.log(bar);

const boundFailed = reportBound();
if (fresh.length === 0 && stale.length === 0 && !boundFailed) {
    console.log(`✅ [DOC-CONFIG-DEFAULTS] ${entries.length} entrée(s) gelée(s) — baseline à jour`);
    console.log(`   (${perimeter}).`);
    console.log(
        `   DCD-05 — ${stats.bindings} défaut(s) lié(s) à une constante du code, concordant(s).`
    );
    console.log(bar);
    process.exit(0);
}

if (freshDivergent.length > 0) {
    console.error(
        `❌ [DOC-CONFIG-DEFAULTS/DCD-01] ${freshDivergent.length} divergence(s) NEUVE(S) :`
    );
    for (const e of freshDivergent) console.error(`     + ${e}`);
    console.error(
        "\n  Le guide intégrateur et l'inventaire de configuration n'annoncent pas le même\n" +
            "  défaut pour cette clé. L'un des deux ment à l'intégrateur : lire le consommateur\n" +
            "  dans le code, puis corriger le document fautif — pas forcément le guide."
    );
}

if (freshUnjudged.length > 0) {
    console.error(
        `\n❌ [DOC-CONFIG-DEFAULTS/DCD-04] ${freshUnjudged.length} ligne(s) non jugée(s) NEUVE(S) :`
    );
    for (const e of freshUnjudged) console.error(`     + ${e}`);
    console.error(
        "\n  Cette ligne annonce un défaut que la gate ne sait pas confronter. Écrire la clé\n" +
            "  par son chemin complet, l'inscrire à l'inventaire si elle y manque, écrire le\n" +
            "  défaut en littéral entre accents graves — ou la lier à sa constante du code."
    );
}

if (stale.length > 0) {
    console.error(
        `\n❌ [DOC-CONFIG-DEFAULTS/DCD-02] ${stale.length} entrée(s) de baseline sans site :`
    );
    for (const e of stale) console.error(`     - ${e}`);
    console.error(
        "\n  Ces lignes ont été corrigées — bonne nouvelle, mais la baseline doit\n" +
            "  l'enregistrer : `--update-baseline`. Une baseline qui garde des entrées mortes\n" +
            "  cesse de mesurer la dette réelle."
    );
}

console.log(bar);
process.exit(1);
